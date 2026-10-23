import { audit, json, notify } from "./audit";
import { db } from "./db";
import { activePack } from "./eligibility";
import { createTask } from "./engine";
import { Calculation, investorView, resolveParams, TIER_ORDER, Tier } from "./rules";
import { PROPERTY_TYPES } from "./rules";
import { fullName, usd } from "./util";
import { activeRuleSet, latestValuation } from "./valuation";

// Buyer matching (hard buy-box filters, then ranking), hot-deal score, and disposition outreach
// that respects each investor's contact limits, buying timeline and fatigue.

const typeLabel = (k: string) => PROPERTY_TYPES.find((t) => t.key === k)?.label || k;

export async function runMatching(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const v = await latestValuation(opportunityId);
  if (!v || v.blocked) return "No usable valuation yet";
  const calc = v.result as unknown as Calculation;
  const p = opp.property;
  const rs = await activeRuleSet(ws);
  const { params } = resolveParams(rs.data, { state: p.state, market: p.city, zip: p.zip, propertyType: p.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: p.conditionTier, arv: calc.arv });
  const price = calc.buyerRounds[0] || calc.floor;

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
      if (box.maxPrice && calc.floor > box.maxPrice) fail(`even our floor ${usd(calc.floor)} is above their max ${usd(box.maxPrice)}`);
      if (box.minBeds && (p.beds || 0) < box.minBeds) fail(`${p.beds ?? "?"} beds`);
      if (box.minBaths && (p.baths || 0) < box.minBaths) fail(`${p.baths ?? "?"} baths`);
      if (box.minSqft && (p.sqft || 0) < box.minSqft) fail(`${p.sqft ?? "?"} sq ft`);
      if (box.maxCondition && p.conditionTier && TIER_ORDER.indexOf(p.conditionTier as Tier) > TIER_ORDER.indexOf(box.maxCondition as Tier)) fail(`${p.conditionTier} rehab is more than they take on`);
      if (box.occupancyOk.length && p.occupancy && !box.occupancyOk.includes(p.occupancy)) fail(`${p.occupancy}-occupied`);
      if (box.strategy && box.strategy !== "any" && opp.exitStrategy === "rental" && box.strategy === "flip") fail("rental deal, flip buyer");
      // The investor's own profit requirement (net and/or gross) at the price we'd present.
      const ip = { ...params, investor: { ...params.investor, profitBasis: (box.profitBasis as "net" | "gross" | "both") || params.investor.profitBasis, minProfitPct: box.minProfitPct ?? params.investor.minProfitPct, minNetProfit: box.minNetProfit ?? params.investor.minNetProfit } };
      const effectivePrice = box.maxPrice ? Math.min(price, box.maxPrice) : price;
      const iv = investorView(Math.max(effectivePrice, calc.floor), calc.arv, calc.repairs, ip, v.rent);
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
  if (calc && interested.some((i) => i.priceMentioned && i.priceMentioned >= calc.floor)) score += 10;
  score += Math.min(10, Math.round(serious.reduce((a, i) => a + i.contact.reliability, 0) / Math.max(1, serious.length) / 10));
  score = Math.max(0, Math.min(100, score));
  await db.opportunity.update({ where: { id: opportunityId }, data: { hotScore: score } });

  const rs = await activeRuleSet(ws);
  const { params } = resolveParams(rs.data, { state: opp.property.state, propertyType: opp.property.propertyType });
  if (!opp.emdRecommendedAt && serious.length >= params.hotDeal.minSerious && score >= params.hotDeal.minScore) {
    const pack = await activePack(ws, opp.property.state);
    const emd = pack?.contracts.typicalEmd || 1000;
    await db.opportunity.update({ where: { id: opportunityId }, data: { emdRecommendedAt: new Date() } });
    await db.payment.create({ data: { workspaceId: ws, opportunityId, kind: "emd", direction: "out", amount: emd, status: "awaiting_approval", payee: "Title / escrow company", note: "Hot deal: recommended earnest money" } });
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
async function canSendDeal(ws: string, contactId: string) {
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const { params } = resolveParams((await activeRuleSet(ws)).data, {});
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
      ? `Off-market lead: ${parts.join(", ")}. Would you buy at that number? Reply YES for details when available.`
      : `New deal: ${parts.join(", ")}. ${pack?.wholesaling.disclosureText || ""} Reply for photos and access.`;
  return body.replace(/\s+/g, " ").trim();
}

export async function outreachToBuyer(ws: string, opportunityId: string, contactId: string, mode: string) {
  const blocked = await canSendDeal(ws, contactId);
  if (blocked) {
    await db.buyerInterest.updateMany({ where: { opportunityId, contactId }, data: { notes: `Not sent: ${blocked}` } });
    return `Skipped: ${blocked}`;
  }
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const v = await latestValuation(opportunityId);
  const calc = v?.result as unknown as Calculation | undefined;
  const price = calc?.buyerRounds[0] || null;
  const text = await dealTeaser(ws, opportunityId, mode, price);
  const comms = await import("./comms");
  let r = "";
  const channel = c.preferredChannel || (c.phone ? "sms" : c.email ? "email" : "call");
  if (channel === "email" && c.email) r = await comms.sendEmail(ws, { to: c.email, contactId, subject: mode === "anonymous" ? "Off-market lead — would you buy at this number?" : "New deal for you", text, opportunityId });
  else if (channel === "call") r = await comms.placeCall(ws, { contactId, agentRole: "disposition", opportunityId });
  else r = await comms.sendSms(ws, { contactId, body: text, opportunityId });
  if (r.startsWith("Blocked")) return r;
  await db.buyerInterest.updateMany({ where: { opportunityId, contactId }, data: { stage: "PRESENTED", presentedAt: new Date() } });
  if (price) await db.offer.create({ data: { opportunityId, side: "buyer", contactId, round: 1, price, by: "us", authority: "rule" } });
  await db.contact.update({ where: { id: contactId }, data: { ignoredInRow: { increment: 1 } } });
  return r;
}
