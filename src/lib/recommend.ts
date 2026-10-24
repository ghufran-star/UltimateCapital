import type { Prisma } from "@prisma/client";
import { label as catLabel, LEAD_SOURCES, PROPERTY_TYPES, SITUATIONS } from "./catalog";
import { db } from "./db";
import { dealRow, type DealRow } from "./dealrows";
import { resolveParams } from "./rules";
import { fullName, usd } from "./util";
import { activeRuleSet } from "./valuation";

// Recommendations: what to do with each seller (sign / negotiate to $X / pass), which investors fit best,
// and which deals are most likely to close. Computed from your numbers and your own history (free);
// an AI second opinion is only run when someone presses the button.

export type Action = "sign" | "negotiate" | "first_offer" | "pass" | "value" | "push_buyers";

export type Rec = {
  key: string;
  opportunityId: string;
  action: Action;
  price: number | null;
  priority: number; // higher = decide sooner
  headline: string;
  reasons: string[];
  row: DealRow;
  stage: string;
  sellerId: string | null;
  autopilotOff: boolean;
};

export type Lift = { feature: string; value: string; n: number; won: number; lift: number };

const ENDED_LOST = ["DECLINED", "WITHDRAWN", "CONTRACT_FAILED", "OWNERSHIP_DISPUTE"];
const UNDER_CONTRACT = ["UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"];

/** Win rates by lead source, situation, property type, state and price gap, from deals that have finished. */
export async function learn(ws: string) {
  const done = await db.opportunity.findMany({
    where: { workspaceId: ws, OR: [{ stage: "CLOSED" }, { exception: { in: ENDED_LOST } }] },
    select: { stage: true, leadSource: true, sellerLowest: true, askingPrice: true, property: { select: { state: true, propertyType: true, situations: true } }, valuations: { orderBy: { createdAt: "desc" }, take: 1, select: { result: true, blocked: true } } },
  });
  const won = done.filter((d) => d.stage === "CLOSED").length;
  const base = done.length ? won / done.length : 0;
  const buckets = new Map<string, { feature: string; value: string; n: number; won: number }>();
  const add = (feature: string, value: string | null | undefined, w: boolean) => {
    if (!value) return;
    const k = `${feature}:${value}`;
    const b = buckets.get(k) || { feature, value, n: 0, won: 0 };
    b.n++;
    if (w) b.won++;
    buckets.set(k, b);
  };
  for (const d of done) {
    const w = d.stage === "CLOSED";
    add("source", d.leadSource, w);
    add("type", d.property.propertyType, w);
    add("state", d.property.state, w);
    for (const s of d.property.situations) add("situation", s, w);
    const calc = d.valuations[0] && !d.valuations[0].blocked ? (d.valuations[0].result as { maxBuy?: number }) : null;
    const num = d.sellerLowest ?? d.askingPrice;
    if (calc?.maxBuy && num) add("gap", gapBucket((num - calc.maxBuy) / calc.maxBuy), w);
  }
  const ALPHA = 4; // pulls small samples toward the average
  const lifts: Lift[] = [...buckets.values()].map((b) => ({ ...b, lift: base ? (b.won + ALPHA * base) / (b.n + ALPHA) / base : 1 }));
  return { finished: done.length, won, base, lifts };
}

function gapBucket(g: number) {
  if (g <= 0) return "at or under max buy";
  if (g <= 0.05) return "within 5% of max buy";
  if (g <= 0.15) return "5–15% over max buy";
  return "15%+ over max buy";
}

const featureLabel = (l: Lift) =>
  l.feature === "source" ? catLabel(LEAD_SOURCES, l.value) : l.feature === "situation" ? catLabel(SITUATIONS, l.value) : l.feature === "type" ? catLabel(PROPERTY_TYPES, l.value) : l.feature === "state" ? l.value : l.value;
export const liftLabel = (l: Lift) => `${featureLabel(l)}${l.feature === "state" ? " deals" : ""}`;

/** Every open deal: the decision to make on the seller, a closing-likelihood score, and why. */
export async function recommendations(ws: string, scope: Prisma.OpportunityWhereInput = {}) {
  const rs = await activeRuleSet(ws);
  const learned = await learn(ws);
  const liftOf = (feature: string, value?: string | null) => (value ? learned.lifts.find((l) => l.feature === feature && l.value === value && l.n >= 3) : undefined);
  const deals = await db.opportunity.findMany({
    where: { workspaceId: ws, ...scope, stage: { notIn: ["CLOSED"] }, OR: [{ exception: null }, { exception: { notIn: [...ENDED_LOST, "DO_NOT_CONTACT"] } }] },
    include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, interests: { select: { serious: true, priceMentioned: true, stage: true } } },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });
  const sellers = await db.contact.findMany({ where: { id: { in: deals.map((d) => d.sellerId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true, company: true, doNotContact: true } });
  const recs: Rec[] = [];
  const hot: { row: DealRow; score: number; reasons: string[]; opportunityId: string; stage: string }[] = [];
  for (const d of deals) {
    const seller = sellers.find((s) => s.id === d.sellerId) || null;
    const row = dealRow(d, rs.data, seller);
    const v = d.valuations[0];
    const calc = v && !v.blocked ? (v.result as { maxBuy: number; sellerOffers: number[]; arv: number }) : null;
    const { params } = resolveParams(rs.data, { state: d.property.state, market: d.property.city, zip: d.property.zip, propertyType: d.property.propertyType, dealType: d.dealType, exit: d.exitStrategy, conditionTier: d.property.conditionTier, occupancy: d.property.occupancy, titleFlags: d.property.titleFlags, arv: calc?.arv });
    const serious = d.interests.filter((i) => i.serious);
    const bestBuyer = Math.max(0, ...d.interests.map((i) => i.priceMentioned || 0));
    const num = d.sellerLowest ?? d.askingPrice;
    const under = UNDER_CONTRACT.includes(d.stage);

    // ---- closing likelihood (0–100), adjusted by what has worked for you before
    let score = d.hotScore || 0;
    const why: string[] = [];
    if (serious.length) {
      score += Math.min(20, serious.length * 7);
      why.push(`${serious.length} serious investor${serious.length > 1 ? "s" : ""}`);
    }
    if (calc && num && num <= calc.maxBuy) {
      score += 15;
      why.push(`seller's ${usd(num)} is within the max buy`);
    } else if (calc && num && num - calc.maxBuy <= calc.maxBuy * 0.05) {
      score += 8;
      why.push(`seller only ${usd(num - calc.maxBuy)} above the max buy`);
    }
    if (under) {
      score += 15;
      why.push("under contract");
    }
    let mult = 1;
    for (const l of [liftOf("source", d.leadSource), liftOf("type", d.property.propertyType), liftOf("state", d.property.state), ...d.property.situations.map((s) => liftOf("situation", s))]) {
      if (!l) continue;
      mult *= Math.min(1.6, Math.max(0.6, l.lift));
      if (l.lift >= 1.3) why.push(`${liftLabel(l)} close ${l.lift.toFixed(1)}× your average`);
      if (l.lift <= 0.7) why.push(`${liftLabel(l)} close less often for you (${l.lift.toFixed(1)}×)`);
    }
    score = Math.round(Math.max(0, Math.min(100, score * mult)));
    hot.push({ row, score, reasons: why.slice(0, 4), opportunityId: d.id, stage: d.stage });

    // ---- the decision on the seller (only before a contract)
    if (under || d.stage === "CONTRACT_PREPARATION" || !seller || seller.doNotContact) continue;
    const base = { opportunityId: d.id, row, stage: d.stage, sellerId: d.sellerId, autopilotOff: d.autopilotOff };
    if (!calc) {
      recs.push({ ...base, key: `${d.id}:value:`, action: "value", price: null, priority: 10, headline: "Value it first", reasons: [v?.blocked ? `Valuation blocked: ${v.blocked}` : "No valuation yet, so there's no max buy to judge the seller's number against."] });
      continue;
    }
    const fee = row.fee;
    const reasons: string[] = [];
    if (fee !== null) reasons.push(`Projected fee ${usd(fee)} at ${usd(row.buyerPrice)} to investors (min fee ${usd(params.minFee)})`);
    if (serious.length) reasons.push(`${serious.length} serious investor${serious.length > 1 ? "s" : ""}${bestBuyer ? `, best number mentioned ${usd(bestBuyer)}` : ""}`);
    if (d.motivation) reasons.push(`Motivation: ${d.motivation.slice(0, 80)}`);
    if (d.timeline) reasons.push(`Timeline: ${d.timeline.slice(0, 60)}`);
    if (!num) {
      const first = calc.sellerOffers[0] ?? calc.maxBuy;
      recs.push({ ...base, key: `${d.id}:first_offer:${first}`, action: "first_offer", price: first, priority: 30 + Math.min(20, serious.length * 5), headline: `Make the first offer: ${usd(first)}`, reasons: ["The seller hasn't named a number yet.", `Your ladder opens at ${usd(first)} and stops at ${usd(calc.maxBuy)}.`, ...reasons] });
      continue;
    }
    const gap = num - calc.maxBuy;
    // What buyer demand supports: the best investor number minus your minimum fee.
    const demandCap = bestBuyer ? bestBuyer - params.minFee : 0;
    if (gap <= 0) {
      recs.push({ ...base, key: `${d.id}:sign:${num}`, action: "sign", price: num, priority: 100 + serious.length * 5, headline: `Sign at ${usd(num)}`, reasons: [`Seller's ${usd(num)} is ${usd(-gap)} under your max buy of ${usd(calc.maxBuy)}.`, ...reasons] });
    } else if (gap <= calc.maxBuy * 0.15 || demandCap >= num) {
      const target = demandCap >= num ? num : calc.maxBuy;
      const r = [`Seller wants ${usd(num)}; your max buy is ${usd(calc.maxBuy)} (gap ${usd(gap)}, ${Math.round((gap / calc.maxBuy) * 100)}%).`];
      if (demandCap >= num) r.push(`Investor demand supports it: ${usd(bestBuyer)} offered leaves your ${usd(params.minFee)} minimum fee at ${usd(num)}. Going above the max buy needs the owner's approval.`);
      recs.push({ ...base, key: `${d.id}:negotiate:${target}`, action: "negotiate", price: target, priority: 70 - Math.round((gap / calc.maxBuy) * 100) + serious.length * 5, headline: `Negotiate to ${usd(target)}`, reasons: [...r, ...reasons] });
    } else {
      recs.push({ ...base, key: `${d.id}:pass:${num}`, action: "pass", price: null, priority: 5, headline: "Pass for now", reasons: [`Seller wants ${usd(num)}, ${usd(gap)} (${Math.round((gap / calc.maxBuy) * 100)}%) over your max buy, with no investor demand to cover it.`, "Park it and check back in 30 days; motivation often changes.", ...reasons] });
    }
  }
  // Under-contract deals with weak buyer interest: push them to the best-fit investors.
  for (const d of deals.filter((x) => UNDER_CONTRACT.includes(x.stage) && x.stage !== "CLOSED")) {
    if (d.interests.some((i) => i.serious)) continue;
    const row = dealRow(d, rs.data, sellers.find((s) => s.id === d.sellerId) || null);
    recs.push({ key: `${d.id}:push_buyers:`, opportunityId: d.id, row, stage: d.stage, sellerId: d.sellerId, autopilotOff: d.autopilotOff, action: "push_buyers", price: null, priority: 90, headline: "Under contract with no serious investor yet", reasons: [`${d.interests.length} matched investor${d.interests.length === 1 ? "" : "s"}, none serious. Pitch the best fits below.`] });
  }
  // Hide what's been acted on or dismissed (a new price or action shows again).
  const decided = await db.recommendation.findMany({ where: { workspaceId: ws, key: { in: recs.map((r) => r.key) }, status: { in: ["acted", "dismissed"] } }, select: { key: true } });
  const hide = new Set(decided.map((x) => x.key));
  return {
    recs: recs.filter((r) => !hide.has(r.key)).sort((a, b) => b.priority - a.priority),
    hot: hot.sort((a, b) => b.score - a.score),
    learned,
  };
}

/** The investors most likely to buy this deal: fit, seriousness, how they've done with you before. */
export async function bestInvestors(ws: string, opportunityIds: string[], per = 5) {
  if (!opportunityIds.length) return new Map<string, { contactId: string; name: string; score: number; why: string[]; stage: string }[]>();
  const ints = await db.buyerInterest.findMany({
    where: { opportunityId: { in: opportunityIds }, stage: { notIn: ["REJECTED", "WITHDRAWN"] }, contact: { doNotContact: false } },
    include: { contact: { select: { id: true, firstName: true, lastName: true, company: true, fundsVerified: true } } },
  });
  const cids = [...new Set(ints.map((i) => i.contactId))];
  const history = await db.buyerInterest.findMany({ where: { contactId: { in: cids }, opportunity: { workspaceId: ws } }, select: { contactId: true, stage: true, respondedAt: true, presentedAt: true } });
  const out = new Map<string, { contactId: string; name: string; score: number; why: string[]; stage: string }[]>();
  for (const id of opportunityIds) {
    const list = ints
      .filter((i) => i.opportunityId === id)
      .map((i) => {
        const h = history.filter((x) => x.contactId === i.contactId);
        const closed = h.filter((x) => ["AGREEMENT_EXECUTED", "CLOSING", "COMPLETED"].includes(x.stage)).length;
        const presented = h.filter((x) => x.presentedAt).length;
        const replied = h.filter((x) => x.respondedAt).length;
        const why: string[] = [`fit ${i.fitScore}`];
        let s = i.fitScore;
        if (i.serious) (s += 20), why.push("serious on this deal");
        if (i.priceMentioned) (s += 10), why.push(`said ${usd(i.priceMentioned)}`);
        if (closed) (s += 15 * Math.min(3, closed)), why.push(`${closed} deal${closed > 1 ? "s" : ""} done with you`);
        if (i.contact.fundsVerified) (s += 10), why.push("funds verified");
        if (presented >= 3) {
          const rate = replied / presented;
          s += Math.round(rate * 10) - (rate < 0.2 ? 10 : 0);
          why.push(`replies ${Math.round(rate * 100)}% of the time`);
        }
        if (i.stage === "NO_RESPONSE") s -= 15;
        return { contactId: i.contactId, name: fullName(i.contact), score: s, why, stage: i.stage };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, per);
    out.set(id, list);
  }
  return out;
}

/** Marks recommendations whose deals have since finished as won or lost. */
export async function syncOutcomes(ws: string) {
  const open = await db.recommendation.findMany({ where: { workspaceId: ws, outcome: null, status: "acted" }, select: { id: true, opportunityId: true } });
  if (!open.length) return;
  const deals = await db.opportunity.findMany({ where: { id: { in: [...new Set(open.map((o) => o.opportunityId))] } }, select: { id: true, stage: true, exception: true } });
  for (const r of open) {
    const d = deals.find((x) => x.id === r.opportunityId);
    const outcome = !d ? "lost" : d.stage === "CLOSED" ? "won" : d.exception && ENDED_LOST.includes(d.exception) ? "lost" : null;
    if (outcome) await db.recommendation.update({ where: { id: r.id }, data: { outcome, outcomeAt: new Date() } });
  }
}

/** How following (or ignoring) the recommendations has worked out. */
export async function track(ws: string) {
  const rows = await db.recommendation.findMany({ where: { workspaceId: ws, status: { in: ["acted", "dismissed"] } }, select: { action: true, status: true, outcome: true } });
  const by = (f: (r: (typeof rows)[number]) => boolean) => {
    const x = rows.filter(f);
    const done = x.filter((r) => r.outcome);
    return { n: x.length, finished: done.length, won: done.filter((r) => r.outcome === "won").length };
  };
  return { followed: by((r) => r.status === "acted" && r.action !== "pass"), passed: by((r) => r.status === "acted" && r.action === "pass"), dismissed: by((r) => r.status === "dismissed") };
}
