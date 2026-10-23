import { randomBytes } from "node:crypto";
import { audit, json, notify } from "./audit";
import { db } from "./db";
import { activePack } from "./eligibility";
import { createTask } from "./engine";
import { Calculation, investorView, TIER_ORDER, Tier } from "./rules";
import { PROPERTY_TYPES } from "./rules";
import { fullName, usd } from "./util";
import { dealParams, latestValuation } from "./valuation";

// Buyer matching (hard buy-box filters, then ranking), hot-deal score, and disposition outreach
// that respects each investor's contact limits, buying timeline and fatigue.

const typeLabel = (k: string) => PROPERTY_TYPES.find((t) => t.key === k)?.label || k;

export async function runMatching(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const v = await latestValuation(opportunityId);
  if (!v || v.blocked) return "No usable valuation yet";
  const calc = v.result as unknown as Calculation;
  const p = opp.property;
  const params = await dealParams(ws, opportunityId);
  const { buyerLadder, contractBasis } = await import("./deals");
  const ladder = buyerLadder(contractBasis(opp, calc), calc, params);
  const price = ladder.rounds[0] || ladder.floor;
  const floor = ladder.floor;

  const buyers = await db.contact.findMany({
    where: { workspaceId: ws, kind: "buyer", doNotContact: false, buyBoxes: { some: { active: true } } },
    include: { buyBoxes: { where: { active: true } } },
  });
  const matched: string[] = [];
  for (const b of buyers) {
    let best: { boxId: string; score: number; reasons: string[] } | null = null;
    for (const box of b.buyBoxes) {
      const why: string[] = [];
      const fail = (r: string) => why.push(`✗ ${r}`);
      const has = (list: string[], v: string | null | undefined) => !list.length || (v ? list.map((x) => x.toLowerCase()).includes(v.toLowerCase()) : false);
      if (!has(box.states, p.state)) fail(`state ${p.state}`);
      if (!has(box.markets, p.city)) fail(`market ${p.city}`);
      if (box.zips.length && !box.zips.includes(p.zip)) fail(`ZIP ${p.zip}`);
      if (box.excludedZips.includes(p.zip)) fail(`excluded ZIP ${p.zip}`);
      if (!has(box.propertyTypes, p.propertyType)) fail(typeLabel(p.propertyType));
      if (box.minPrice && price < box.minPrice) fail(`price below their ${usd(box.minPrice)} minimum`);
      if (box.maxPrice && floor > box.maxPrice) fail(`even our floor ${usd(floor)} is above their max ${usd(box.maxPrice)}`);
      if (box.minBeds && (p.beds || 0) < box.minBeds) fail(`${p.beds ?? "?"} beds`);
      if (box.minBaths && (p.baths || 0) < box.minBaths) fail(`${p.baths ?? "?"} baths`);
      if (box.minSqft && (p.sqft || 0) < box.minSqft) fail(`${p.sqft ?? "?"} sq ft`);
      if (box.maxCondition && p.conditionTier && TIER_ORDER.indexOf(p.conditionTier as Tier) > TIER_ORDER.indexOf(box.maxCondition as Tier)) fail(`${p.conditionTier} rehab is more than they take on`);
      if (box.occupancyOk.length && p.occupancy && !box.occupancyOk.includes(p.occupancy)) fail(`${p.occupancy}-occupied`);
      if (box.strategy && box.strategy !== "any" && opp.exitStrategy === "rental" && box.strategy === "flip") fail("rental deal, flip buyer");
      // The investor's own profit requirement (net and/or gross) at the price we'd present.
      const ip = { ...params, investor: { ...params.investor, profitBasis: (box.profitBasis as "net" | "gross" | "both") || params.investor.profitBasis, minProfitPct: box.minProfitPct ?? params.investor.minProfitPct, minNetProfit: box.minNetProfit ?? params.investor.minNetProfit } };
      const effectivePrice = box.maxPrice ? Math.min(price, box.maxPrice) : price;
      const iv = investorView(Math.max(effectivePrice, floor), calc.arv, calc.repairs, ip, v.rent);
      if (!iv.meets) fail(`their ${ip.investor.profitBasis} profit at ${usd(iv.price)} would be ${usd(iv.net)} (${Math.round(iv.netPct * 100)}%)`);
      if (opp.exitStrategy === "rental" && box.minCapRate && (iv.capRate || 0) < box.minCapRate) fail(`cap rate ${((iv.capRate || 0) * 100).toFixed(1)}%`);
      if (why.length) continue;
      const reasons = [`✓ fits "${box.name}"`, `✓ investor net ${usd(iv.net)} (${Math.round(iv.netPct * 100)}%) at ${usd(iv.price)}`];
      let score = 50;
      score += Math.round((b.reliability - 50) / 3);
      if (b.fundsVerified) (score += 10), reasons.push("✓ funds verified");
      else reasons.push("• funds not verified");
      if (b.buyingPerMonth) score += Math.min(10, Math.round(b.buyingPerMonth * 3));
      if (b.dealsClosed) score += Math.min(10, b.dealsClosed * 2);
      if (b.lastContactAt && Date.now() - +b.lastContactAt < 30 * 864e5) score += 5;
      score += Math.min(10, Math.round((iv.netPct - ip.investor.minProfitPct) * 50));
      if (b.ignoredInRow >= params.investorContact.fatigueAfter) (score -= 15), reasons.push("• ignored recent deals");
      if (b.nextBuyingAt && b.nextBuyingAt > new Date()) (score -= 20), reasons.push(`• not buying until ${b.nextBuyingAt.toDateString()}`);
      score = Math.max(1, Math.min(100, score));
      if (!best || score > best.score) best = { boxId: box.id, score, reasons };
    }
    if (!best) continue;
    matched.push(b.id);
    await db.buyerInterest.upsert({
      where: { opportunityId_contactId: { opportunityId, contactId: b.id } },
      create: { opportunityId, contactId: b.id, buyBoxId: best.boxId, fitScore: best.score, reasons: json(best.reasons), stage: "MATCHED" },
      update: { buyBoxId: best.boxId, fitScore: best.score, reasons: json(best.reasons) },
    });
  }
  // Matches that no longer fit (criteria or deal changed) are dropped if nothing has happened yet.
  await db.buyerInterest.deleteMany({ where: { opportunityId, stage: "MATCHED", contactId: { notIn: matched } } });
  await audit(ws, "system", "matching", { type: "opportunity", id: opportunityId }, { after: { matched: matched.length } });
  return `${matched.length} matching buyers`;
}

export async function updateHotScore(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const ints = await db.buyerInterest.findMany({ where: { opportunityId }, include: { contact: true } });
  const presented = ints.filter((i) => i.presentedAt);
  const interested = ints.filter((i) => ["INTERESTED", "DUE_DILIGENCE", "OFFER_SUBMITTED", "TERMS_AGREED", "AGREEMENT_EXECUTED"].includes(i.stage));
  const serious = interested.filter((i) => i.serious);
  const v = await latestValuation(opportunityId);
  const calc = v?.result as unknown as Calculation | undefined;
  let score = 0;
  score += Math.min(40, serious.length * 20);
  score += Math.min(15, (interested.length - serious.length) * 5);
  const responseRate = presented.length ? interested.length / presented.length : 0;
  score += Math.round(responseRate * 15);
  const speeds = interested.filter((i) => i.presentedAt && i.respondedAt).map((i) => (+i.respondedAt! - +i.presentedAt!) / 3600_000);
  if (speeds.length) score += Math.max(0, 10 - Math.round(Math.min(...speeds) / 2));
  if (calc) {
    const { buyerLadder, contractBasis } = await import("./deals");
    const fl = buyerLadder(contractBasis(opp, calc), calc, await dealParams(ws, opportunityId)).floor;
    if (interested.some((i) => i.priceMentioned && i.priceMentioned >= fl)) score += 10;
  }
  score += Math.min(10, Math.round(serious.reduce((a, i) => a + i.contact.reliability, 0) / Math.max(1, serious.length) / 10));
  score = Math.max(0, Math.min(100, score));
  await db.opportunity.update({ where: { id: opportunityId }, data: { hotScore: score } });

  const params = await dealParams(ws, opportunityId);
  if (!opp.emdRecommendedAt && serious.length >= params.hotDeal.minSerious && score >= params.hotDeal.minScore) {
    const pack = await activePack(ws, opp.property.state);
    const emd = pack?.contracts.typicalEmd || 1000;
    await db.opportunity.update({ where: { id: opportunityId }, data: { emdRecommendedAt: new Date() } });
    const { getAutonomy } = await import("./controls");
    const auto = emd <= (await getAutonomy(ws)).emdAutoUnder;
    await db.payment.create({ data: { workspaceId: ws, opportunityId, kind: "emd", direction: "out", amount: emd, status: auto ? "approved" : "awaiting_approval", payee: "Title / escrow company", note: auto ? "Hot deal: earnest money approved automatically (under your limit)" : "Hot deal: recommended earnest money" } });
    if (auto) {
      await notify(ws, `🔥 Hot deal (${score})`, `${serious.length} serious investors on ${opp.property.address}. Earnest money ${usd(emd)} approved automatically under your limit; verify wire instructions before paying.`, `/deals/${opportunityId}?tab=closing`);
      return `Hot score ${score}`;
    }
    const ap = await db.approval.create({
      data: {
        workspaceId: ws,
        kind: "emd",
        entityType: "opportunity",
        entityId: opportunityId,
        title: `🔥 Hot deal: place earnest money on ${opp.property.address}?`,
        detail: json({ score, serious: serious.map((s) => fullName(s.contact)), emd }),
        requestedBy: "system",
      },
    });
    await notify(ws, `🔥 Hot deal (${score})`, `${serious.length} serious investors on ${opp.property.address}. Recommend earnest money ${usd(emd)}.`, `/approvals#${ap.id}`);
  }
  return `Hot score ${score}`;
}

/** Contact limits for new deals: weekly/monthly caps, stated timeline, fatigue. */
async function canSendDeal(ws: string, contactId: string, opportunityId: string) {
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const params = await dealParams(ws, opportunityId);
  if (c.doNotContact) return "Do not contact";
  if (c.nextBuyingAt && c.nextBuyingAt > new Date()) return `Not buying until ${c.nextBuyingAt.toDateString()}`;
  const wk = await db.buyerInterest.count({ where: { contactId, presentedAt: { gte: new Date(Date.now() - 7 * 864e5) } } });
  const mo = await db.buyerInterest.count({ where: { contactId, presentedAt: { gte: new Date(Date.now() - 30 * 864e5) } } });
  if (wk >= (c.maxDealsPerWeek ?? params.investorContact.maxDealsPerWeek)) return "Weekly deal limit reached";
  if (mo >= (c.maxDealsPerMonth ?? params.investorContact.maxDealsPerMonth)) return "Monthly deal limit reached";
  if (c.ignoredInRow >= params.investorContact.fatigueAfter) {
    await createTask(ws, { kind: "follow_up", title: `Check in with ${fullName(c)}: ignored ${c.ignoredInRow} deals`, contactId, dedupeKey: `fatigue:${contactId}` });
    return "Fatigue: ignored recent deals";
  }
  return null;
}

export async function startDemandCampaign(ws: string, opportunityId: string, mode: string) {
  await runMatching(ws, opportunityId);
  const ints = await db.buyerInterest.findMany({ where: { opportunityId, stage: { in: ["MATCHED", "CONTACT_ELIGIBLE"] } }, orderBy: { fitScore: "desc" }, take: 25 });
  let i = 0;
  for (const it of ints) {
    await createTask(ws, {
      kind: "buyer_outreach",
      title: `Present deal (${mode === "anonymous" ? "anonymous demand check" : "full"})`,
      entityType: "opportunity",
      entityId: opportunityId,
      contactId: it.contactId,
      payload: { mode },
      dueAt: new Date(Date.now() + i++ * 3 * 60_000),
      dedupeKey: `outreach:${opportunityId}:${it.contactId}:${mode}`,
    });
  }
  await audit(ws, "system", "demand_campaign", { type: "opportunity", id: opportunityId }, { meta: { mode, buyers: ints.length } });
  return `${ints.length} buyers queued`;
}

/** Short code that ties a buyer's reply to the right deal ("YES 7F3A"). */
export const dealCode = (opportunityId: string) => opportunityId.slice(-4).toUpperCase();

export async function dealTeaser(ws: string, opportunityId: string, mode: string, price: number | null) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const p = opp.property;
  const v = await latestValuation(opportunityId);
  const pack = await activePack(ws, p.state);
  const where = mode === "anonymous" ? `in ${p.city} ${p.zip}` : `at ${p.address}, ${p.city} ${p.zip}`;
  const parts = [
    `${p.beds ?? "?"}/${p.baths ?? "?"} ${typeLabel(p.propertyType).toLowerCase()} ${where}`,
    p.sqft ? `${p.sqft.toLocaleString()} sq ft` : "",
    p.conditionTier ? `${p.conditionTier} rehab` : "",
    v?.arv ? `ARV est. ${usd(v.arv)}` : "",
    v?.repairsLikely ? `repairs est. ${usd(v.repairsLikely)}` : "",
    price ? `around ${usd(price)}` : "",
  ].filter(Boolean);
  const body =
    mode === "anonymous"
      ? `Off-market lead ${dealCode(opportunityId)}: ${parts.join(", ")}. Would you buy at that number? Reply YES ${dealCode(opportunityId)} for details when available.`
      : `New deal ${dealCode(opportunityId)}: ${parts.join(", ")}. ${pack?.wholesaling.disclosureText || ""} Reply ${dealCode(opportunityId)} for photos and access.`;
  return body.replace(/\s+/g, " ").trim();
}

/** The order an investor is reached in: their preferred channel first, then text, email and an AI call. */
function sequenceFor(c: { preferredChannel: string | null; phone: string | null; email: string | null }) {
  const out: string[] = [];
  const add = (ch: string) => {
    if (out.includes(ch)) return;
    if ((ch === "sms" || ch === "call") && !c.phone) return;
    if (ch === "email" && !c.email) return;
    out.push(ch);
  };
  if (c.preferredChannel) add(c.preferredChannel);
  ["sms", "email", "call"].forEach(add);
  return out;
}
const STEP_GAP_HOURS = [4, 20]; // step 2 four hours after step 1, step 3 twenty hours after step 2

/**
 * Presents a deal to one investor as a short sequence (e.g. text → email → AI call), stopping the moment
 * they respond. The investor's weekly/monthly limits and buying timeline are checked once, before step 1.
 */
export async function outreachToBuyer(ws: string, opportunityId: string, contactId: string, mode: string, step = 1) {
  const interest = await db.buyerInterest.findUnique({ where: { opportunityId_contactId: { opportunityId, contactId } } });
  if (!interest) return "No longer a match";
  if (step > 1 && (interest.respondedAt || !["MATCHED", "CONTACT_ELIGIBLE", "PRESENTED"].includes(interest.stage))) return "They responded: sequence stopped";
  if (step === 1) {
    const blocked = await canSendDeal(ws, contactId, opportunityId);
    if (blocked) {
      await db.buyerInterest.update({ where: { id: interest.id }, data: { notes: `Not sent: ${blocked}` } });
      return `Skipped: ${blocked}`;
    }
  }
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const seq = sequenceFor(c);
  const channel = seq[step - 1];
  if (!channel) return "Sequence finished";
  const v = await latestValuation(opportunityId);
  const calc = v && !v.blocked ? (v.result as unknown as Calculation) : undefined;
  let price: number | null = null;
  if (calc) {
    const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    const { buyerLadder, contractBasis } = await import("./deals");
    // Before contract this is the presumptive price: the seller's own number plus our round-1 fee.
    price = buyerLadder(contractBasis(opp, calc), calc, await dealParams(ws, opportunityId)).rounds[0] ?? null;
  }
  const token = interest.portalToken || randomBytes(18).toString("base64url");
  if (!interest.portalToken) await db.buyerInterest.update({ where: { id: interest.id }, data: { portalToken: token } });
  const { setting } = await import("./config");
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  const link = base ? ` See it and reply: ${base}/d/${token}` : "";
  const text = (await dealTeaser(ws, opportunityId, mode, price)) + link;
  const comms = await import("./comms");
  let r = "";
  if (channel === "email") r = await comms.sendEmail(ws, { to: c.email!, contactId, subject: mode === "anonymous" ? `Off-market lead ${dealCode(opportunityId)}: would you buy at this number?` : `New deal ${dealCode(opportunityId)} for you`, text, opportunityId });
  else if (channel === "call") r = await comms.placeCall(ws, { contactId, agentRole: "disposition", opportunityId });
  else r = await comms.sendSms(ws, { contactId, body: text, opportunityId });
  const failed = r.startsWith("Blocked");
  if (!interest.presentedAt && !failed) {
    await db.buyerInterest.update({ where: { id: interest.id }, data: { stage: "PRESENTED", presentedAt: new Date() } });
    if (price) await db.offer.create({ data: { opportunityId, side: "buyer", contactId, round: 1, price, by: "us", authority: "rule" } });
    await db.contact.update({ where: { id: contactId }, data: { ignoredInRow: { increment: 1 } } });
  }
  await db.buyerInterest.update({ where: { id: interest.id }, data: { seqStep: step } });
  // A blocked channel moves straight on to the next one; otherwise wait for a reply first.
  if (seq[step]) {
    await createTask(ws, {
      kind: "buyer_outreach",
      title: `Follow up on deal ${dealCode(opportunityId)} by ${seq[step] === "sms" ? "text" : seq[step]}`,
      entityType: "opportunity",
      entityId: opportunityId,
      contactId,
      payload: { mode, step: step + 1 },
      dueAt: new Date(Date.now() + (failed ? 60_000 : (STEP_GAP_HOURS[step - 1] ?? 24) * 3600_000)),
      dedupeKey: `outreach:${opportunityId}:${contactId}:${mode}:${step + 1}`,
    });
  }
  return `${channel}: ${r}`;
}
