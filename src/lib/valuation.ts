import { audit, json } from "./audit";
import { claudeJson } from "./claude";
import { setting } from "./config";
import { db } from "./db";
import { emit } from "./engine";
import {
  calculate,
  DEFAULT_RULESET,
  estimateRepairs,
  resolveParams,
  RuleSetData,
  Tier,
  TIER_ORDER,
  tiersFromOverall,
} from "./rules";

// Property research & valuation: comps → ARV, condition → repairs, rules → offer limits.
// Every number is stored with the rule version that produced it. Weak evidence blocks firm numbers.

export async function activeRuleSet(ws: string) {
  let rs = await db.ruleSet.findFirst({ where: { workspaceId: ws, active: true }, orderBy: { version: "desc" } });
  if (!rs) {
    rs = await db.ruleSet.create({ data: { workspaceId: ws, version: 1, active: true, rules: json(DEFAULT_RULESET), note: "Starting rules" } });
  }
  return { id: rs.id, version: rs.version, data: rs.rules as unknown as RuleSetData };
}

type Comp = { address: string; price: number; sqft?: number; beds?: number; baths?: number; date?: string; distance?: number; source: string };

const RENTCAST_TYPE: Record<string, string> = { sfr: "Single Family", condo_th: "Condo", "2_4": "Multi-Family", "5_plus": "Apartment", mobile: "Manufactured", land: "Land" };

async function rentcast(ws: string, p: { address: string; city: string; state: string; zip: string; propertyType: string; beds: number | null; baths: number | null; sqft: number | null }) {
  const key = await setting(ws, "RENTCAST_API_KEY");
  if (!key) return null;
  const q = new URLSearchParams({ address: `${p.address}, ${p.city}, ${p.state} ${p.zip}`, compCount: "15" });
  if (RENTCAST_TYPE[p.propertyType]) q.set("propertyType", RENTCAST_TYPE[p.propertyType]);
  if (p.beds) q.set("bedrooms", String(p.beds));
  if (p.baths) q.set("bathrooms", String(p.baths));
  if (p.sqft) q.set("squareFootage", String(p.sqft));
  const get = async (path: string) => {
    const res = await fetch(`https://api.rentcast.io/v1${path}?${q}`, { headers: { "X-Api-Key": key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`RentCast ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  // Each property's comps are paid for once per 14 days; the cache is keyed by every input that changes the answer.
  const cacheKey = `rentcast:${q.toString()}`;
  const hit = await db.apiCache.findUnique({ where: { key: cacheKey } });
  let value: Record<string, unknown>;
  let rent: Record<string, unknown> | null;
  if (hit && Date.now() - +hit.createdAt < 14 * 864e5) {
    ({ value, rent } = hit.value as unknown as { value: Record<string, unknown>; rent: Record<string, unknown> | null });
  } else {
    value = await get("/avm/value");
    rent = await get("/avm/rent/long-term").catch(() => null);
    await db.apiCache.upsert({ where: { key: cacheKey }, create: { key: cacheKey, value: json({ value, rent }) }, update: { value: json({ value, rent }), createdAt: new Date() } });
  }
  const comps: Comp[] = ((value.comparables as Record<string, unknown>[]) || []).map((c) => ({
    address: String(c.formattedAddress || ""),
    price: Number(c.price || 0),
    sqft: Number(c.squareFootage || 0) || undefined,
    beds: Number(c.bedrooms || 0) || undefined,
    baths: Number(c.bathrooms || 0) || undefined,
    date: String(c.removedDate || c.listedDate || c.lastSeenDate || ""),
    distance: Number(c.distance || 0) || undefined,
    source: "RentCast",
  }));
  return { asIs: Number(value.price || 0) || null, comps, rent: rent ? Number(rent.rent || 0) || null : null };
}

/** ARV from comps: upper-quartile price per sq ft × subject sq ft (renovated comps sell at the top of the range). */
function arvFromComps(comps: Comp[], sqft: number | null) {
  const ppsf = comps.filter((c) => c.price && c.sqft).map((c) => c.price / c.sqft!).sort((a, b) => a - b);
  if (ppsf.length < 3 || !sqft) {
    const prices = comps.map((c) => c.price).filter(Boolean).sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length * 0.75)] : null;
  }
  return Math.round((ppsf[Math.floor(ppsf.length * 0.75)] * sqft) / 1000) * 1000;
}

async function webResearch(ws: string, p: { address: string; city: string; state: string; zip: string; beds: number | null; baths: number | null; sqft: number | null; propertyType: string }) {
  const { claudeText } = await import("./claude");
  const notes = await claudeText(ws, {
    kind: "fast",
    webSearch: 5,
    maxTokens: 3000,
    messages: [
      {
        role: "user",
        content: `Find recent (last 12 months) sold comparable properties for: ${p.address}, ${p.city}, ${p.state} ${p.zip} (${p.beds ?? "?"} bed, ${p.baths ?? "?"} bath, ${p.sqft ?? "?"} sq ft, ${p.propertyType}). Prefer renovated sales within 1 mile and similar size. List each with address, sale price, sale date, sq ft and URL. Also give a typical monthly rent.`,
      },
    ],
  });
  const out = await claudeJson<{ comps: { address: string; price: number; sqft: number; date: string; url: string }[]; rent: number }>(ws, {
    kind: "fast",
    prompt: `Extract the comparable sales and rent from these notes. Only include sales with a price.\n\n${notes}`,
    schema: {
      type: "object",
      properties: {
        comps: { type: "array", items: { type: "object", properties: { address: { type: "string" }, price: { type: "number" }, sqft: { type: "number" }, date: { type: "string" }, url: { type: "string" } }, required: ["address", "price", "sqft", "date", "url"] } },
        rent: { type: "number" },
      },
      required: ["comps", "rent"],
    },
  });
  return { comps: out.comps.map((c) => ({ ...c, source: `Web research (unverified): ${c.url}` })) as Comp[], rent: out.rent || null };
}

export async function runValuation(ws: string, opportunityId: string, opts: { actor: string; arvOverride?: number; repairsOverride?: number } = { actor: "system" }) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const p = opp.property;
  const rs = await activeRuleSet(ws);
  const facts = { state: p.state, market: p.city, zip: p.zip, propertyType: p.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: p.conditionTier, occupancy: p.occupancy, titleFlags: p.titleFlags };

  // ----- value -----
  const overrides = await db.fact.findMany({ where: { workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: { in: ["arv", "repairs"] }, kind: "verified", supersededAt: null } });
  const manualArv = opts.arvOverride || Number(overrides.find((f) => f.field === "arv")?.value) || null;
  const manualRepairs = opts.repairsOverride || Number(overrides.find((f) => f.field === "repairs")?.value) || null;

  let comps: Comp[] = [];
  let asIs: number | null = null;
  let rent: number | null = p.rentEstimate;
  let arv: number | null = manualArv;
  let confidence = manualArv ? 0.9 : 0.4;
  const blockedReasons: string[] = [];
  try {
    const rc = await rentcast(ws, p);
    if (rc) {
      comps = rc.comps;
      asIs = rc.asIs;
      rent = rc.rent || rent;
      if (!arv) {
        arv = arvFromComps(comps, p.sqft);
        confidence = comps.length >= 5 ? 0.7 : 0.5;
      }
    } else if (!arv) {
      const w = await webResearch(ws, p);
      comps = w.comps;
      rent = w.rent || rent;
      arv = arvFromComps(comps, p.sqft);
      confidence = comps.length >= 4 ? 0.5 : 0.3;
    }
  } catch (e) {
    blockedReasons.push(`Comps unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!arv) blockedReasons.push("No ARV: add comps data (RentCast key) or enter a verified ARV.");
  if (comps.length && comps.length < 3 && !manualArv) blockedReasons.push("Fewer than 3 comparable sales.");

  // ----- repairs -----
  const { params } = resolveParams(rs.data, { ...facts, arv });
  const cond = (p.condition as { items?: Record<string, { tier: Tier; reason?: string }> } | null)?.items || {};
  let tiers: Record<string, Tier> = {};
  const reasons: Record<string, string> = {};
  if (Object.keys(cond).length) {
    for (const [k, v] of Object.entries(cond)) {
      if (TIER_ORDER.includes(v.tier)) tiers[k] = v.tier;
      if (v.reason) reasons[k] = v.reason;
    }
  } else if (p.conditionTier) {
    tiers = tiersFromOverall(rs.data.playbook, p.conditionTier as Tier);
  } else if (!manualRepairs) {
    blockedReasons.push("Property condition unknown: complete property discovery.");
  }
  const rep = estimateRepairs(rs.data.playbook, tiers, params, { sqft: p.sqft, baths: p.baths }, reasons);
  const repairs = manualRepairs || rep.likely;
  if (!p.sqft) {
    confidence -= 0.1;
    blockedReasons.push("Square footage unknown.");
  }

  const calc = calculate({ arv: arv || 0, repairs, params, exit: opp.exitStrategy, rent, contractPrice: opp.contractPrice });
  const blocked = blockedReasons.length ? blockedReasons.join(" ") : null;
  const v = await db.valuation.create({
    data: {
      opportunityId: opp.id,
      ruleSetId: rs.id,
      ruleVersion: rs.version,
      asIs,
      arv,
      rent,
      repairsLow: manualRepairs || rep.low,
      repairsLikely: repairs,
      repairsHigh: manualRepairs || rep.high,
      repairItems: json(rep.lines),
      comps: json(comps.slice(0, 15)),
      result: json(calc),
      confidence: Math.max(0.1, Math.min(0.95, confidence)),
      blocked,
    },
  });
  const early = ["NEW", "ELIGIBLE", "OUTREACH", "ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING"];
  await db.opportunity.update({
    where: { id: opp.id },
    data: blocked ? { exception: "VALUATION_BLOCKED", stage: early.includes(opp.stage) ? "UNDERWRITING" : opp.stage } : { exception: opp.exception === "VALUATION_BLOCKED" ? null : opp.exception, stage: early.includes(opp.stage) ? "OFFER_READY" : opp.stage },
  });
  await audit(ws, opts.actor, "valuation", { type: "opportunity", id: opp.id }, { after: { arv, repairs, maxBuy: calc.maxBuy, ruleVersion: rs.version, blocked } });
  if (!blocked) {
    await emit(ws, "opportunity.valued", { type: "opportunity", id: opp.id });
    if (opp.sellerLowest) await emit(ws, "opportunity.seller_moved", { type: "opportunity", id: opp.id });
  }
  return blocked ? `Blocked: ${blocked}` : `Max buy $${calc.maxBuy.toLocaleString()}`;
}

/** The deal's own resolved rules (defaults + every matching variation). Every price lock uses this. */
export async function dealParams(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const v = await latestValuation(opportunityId);
  const rs = await activeRuleSet(ws);
  const p = opp.property;
  return resolveParams(rs.data, { state: p.state, market: p.city, zip: p.zip, propertyType: p.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: p.conditionTier, occupancy: p.occupancy, titleFlags: p.titleFlags, arv: v?.arv ?? null }).params;
}

export async function latestValuation(opportunityId: string) {
  return db.valuation.findFirst({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
}
