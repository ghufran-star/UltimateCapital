import { audit, json, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { Authority, buyerAuthority, Calculation, nearAgreement, resolveParams, sellerAuthority } from "./rules";
import { fullName, usd } from "./util";
import { activeRuleSet, latestValuation } from "./valuation";

// Opportunities: stages, offer authority, near-agreement verification, approvals.

export async function setStage(ws: string, opportunityId: string, stage: string, actor: string, exception?: string | null) {
  const before = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  await db.opportunity.update({ where: { id: opportunityId }, data: { stage, ...(exception !== undefined ? { exception } : {}) } });
  await audit(ws, actor, "stage_changed", { type: "opportunity", id: opportunityId }, { before: { stage: before.stage, exception: before.exception }, after: { stage, exception } });
}

async function calcFor(opportunityId: string) {
  const v = await latestValuation(opportunityId);
  if (!v || v.blocked) return { v, calc: null as Calculation | null };
  return { v, calc: v.result as unknown as Calculation };
}

/** What the negotiation agent may say. The ceiling is never revealed; the final step needs owner approval. */
export async function sellerAuthorityFor(ws: string, opportunityId: string, sellerPrice: number | null, actor: string): Promise<Authority> {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  if (sellerPrice && (!opp.sellerLowest || sellerPrice < opp.sellerLowest)) {
    await db.opportunity.update({ where: { id: opportunityId }, data: { sellerLowest: Math.round(sellerPrice) } });
    await emit(ws, "opportunity.seller_moved", { type: "opportunity", id: opportunityId });
  }
  const { v, calc } = await calcFor(opportunityId);
  if (!calc) {
    return {
      offerNow: null,
      ifCounteredUpTo: null,
      needsApproval: false,
      message: `We can't give a number yet${v?.blocked ? ` (${v.blocked})` : ""}. Say we'll look at everything and come back with a written offer, and agree when.`,
    };
  }
  const ours = await db.offer.findMany({ where: { opportunityId, side: "seller", by: "us" } });
  let ladder = calc.sellerOffers;
  if (!opp.approvedAt) ladder = ladder.slice(0, -1); // final step only after owner verification
  const a = sellerAuthority(ladder, ours.map((o) => o.price), sellerPrice ?? opp.sellerLowest);
  if (a.needsApproval && !opp.approvedAt) {
    await requestFinalApproval(ws, opportunityId, actor, "Seller wants more than the pre-approved range");
    return { ...a, message: "You've reached your authority. Tell them you'll take it to your manager today and confirm, and agree a time to call back." };
  }
  return a;
}

export async function buyerAuthorityFor(ws: string, opportunityId: string, contactId: string, buyerOffer: number | null): Promise<Authority> {
  const { calc } = await calcFor(opportunityId);
  if (!calc) return { offerNow: null, ifCounteredUpTo: null, needsApproval: false, message: "Pricing isn't final yet. Ask what they'd pay for it and log it with record_offer." };
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const contract = opp.contractPrice || calc.contractPrice;
  const { params } = resolveParams((await activeRuleSet(ws)).data, {});
  const rounds = params.buyerRoundFees.map((f) => Math.min(contract + f, Math.floor(calc.investorMaxPrice / 100) * 100)).filter((x) => x >= contract + params.minFee);
  const floor = contract + params.minFee;
  const presented = await db.offer.findMany({ where: { opportunityId, side: "buyer", contactId, by: "us" } });
  const a = buyerAuthority([...new Set(rounds)].sort((x, y) => y - x), floor, presented.map((o) => o.price), buyerOffer);
  if (a.offerNow && !presented.some((o) => o.price === a.offerNow)) {
    await db.offer.create({ data: { opportunityId, side: "buyer", contactId, round: presented.length + 1, price: a.offerNow, by: "us", authority: "rule", valuationId: undefined } });
  }
  return a;
}

/** When the seller gets close to our numbers: verification pack to the owner + demand campaign, at once. */
export async function checkNearAgreement(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  if (opp.verificationSentAt || !opp.sellerLowest) return;
  const { calc } = await calcFor(opportunityId);
  if (!calc) return;
  const { params } = resolveParams((await activeRuleSet(ws)).data, { state: opp.property.state, market: opp.property.city, zip: opp.property.zip, propertyType: opp.property.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: opp.property.conditionTier, arv: calc.arv });
  if (!nearAgreement(opp.sellerLowest, calc.maxBuy, params)) return;
  await createTask(ws, { kind: "verification_pack", title: "Send verification pack to owner", entityType: "opportunity", entityId: opportunityId, priority: 1, dedupeKey: `verify:${opportunityId}` });
  await createTask(ws, { kind: "demand_campaign", title: "Start anonymous buyer demand check", entityType: "opportunity", entityId: opportunityId, priority: 1, payload: { mode: "anonymous" }, dedupeKey: `demand:${opportunityId}` });
}

async function requestFinalApproval(ws: string, opportunityId: string, requestedBy: string, why: string) {
  const existing = await db.approval.findFirst({ where: { workspaceId: ws, entityId: opportunityId, kind: "final_offer", status: "pending" } });
  if (existing) return existing;
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const { calc } = await calcFor(opportunityId);
  const ap = await db.approval.create({
    data: {
      workspaceId: ws,
      kind: "final_offer",
      entityType: "opportunity",
      entityId: opportunityId,
      title: `Approve final offer: ${opp.property.address}`,
      detail: json({ why, sellerLowest: opp.sellerLowest, maxBuy: calc?.maxBuy, proposedPrice: Math.min(opp.sellerLowest || Infinity, calc?.maxBuy || 0) || calc?.maxBuy }),
      requestedBy,
    },
  });
  await db.opportunity.update({ where: { id: opportunityId }, data: { exception: "APPROVAL_REQUIRED" } });
  await notify(ws, "Approval needed", ap.title, `/approvals#${ap.id}`);
  return ap;
}

export async function sendVerificationPack(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true, interests: true } });
  const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
  const { v, calc } = await calcFor(opportunityId);
  const lastCalls = opp.sellerId ? await db.interaction.findMany({ where: { contactId: opp.sellerId, summary: { not: null } }, orderBy: { createdAt: "desc" }, take: 3 }) : [];
  const p = opp.property;
  const lines = [
    `VERIFICATION PACK — ${p.address}, ${p.city}, ${p.state} ${p.zip}`,
    ``,
    `Seller: ${seller ? fullName(seller) : "?"} · lowest price indicated ${usd(opp.sellerLowest)} · asking ${usd(opp.askingPrice)}`,
    `Motivation: ${opp.motivation || "?"} · timeline: ${opp.timeline || "?"} · decision makers: ${opp.decisionMakers || "?"}`,
    `Property: ${p.beds ?? "?"} bd / ${p.baths ?? "?"} ba · ${p.sqft ?? "?"} sq ft · built ${p.yearBuilt ?? "?"} · ${p.propertyType} · ${p.occupancy || "occupancy ?"} · condition ${p.conditionTier || "?"}`,
    p.titleFlags.length ? `Title flags: ${p.titleFlags.join(", ")}` : "",
    ``,
    calc ? calc.formula.join("\n") : "Valuation incomplete.",
    v ? `Repairs: ${usd(v.repairsLow)} – ${usd(v.repairsHigh)} (likely ${usd(v.repairsLikely)}) · confidence ${Math.round(v.confidence * 100)}%` : "",
    calc ? `Investor at round 1: net ${usd(calc.investorAtRounds[0]?.net)} (${Math.round((calc.investorAtRounds[0]?.netPct || 0) * 100)}%)` : "",
    ``,
    `Recent conversations:`,
    ...lastCalls.map((c) => `- ${c.createdAt.toDateString()}: ${c.summary}`),
    ``,
    `Matching buyers so far: ${opp.interests.length} · interested: ${opp.interests.filter((i) => ["INTERESTED", "DUE_DILIGENCE", "OFFER_SUBMITTED"].includes(i.stage)).length}`,
    `The anonymous buyer demand check has started. Approve in the app to send the final offer and contract.`,
  ].filter((x) => x !== "");
  const ap = await requestFinalApproval(ws, opportunityId, "system", "Seller is close to our numbers");
  await db.approval.update({ where: { id: ap.id }, data: { detail: json({ ...(ap.detail as object), pack: lines.join("\n") }) } });
  await db.opportunity.update({ where: { id: opportunityId }, data: { verificationSentAt: new Date() } });
  const owner = await db.membership.findFirst({ where: { workspaceId: ws, role: "owner" }, include: { user: true } });
  if (owner && (await setting(ws, "RESEND_API_KEY"))) {
    const { sendEmail } = await import("./comms");
    const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "") || "";
    await sendEmail(ws, { to: owner.user.email, subject: `Verify deal: ${p.address}`, text: `${lines.join("\n")}\n\nReview: ${base}/deals/${opportunityId}`, skipChecks: true }).catch((e) => console.error(e));
  }
  return "Verification pack sent";
}

/** Owner decisions on approvals. */
export async function decideApproval(ws: string, approvalId: string, decision: "approved" | "rejected", userId: string, note?: string, price?: number | null) {
  const ap = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
  if (ap.workspaceId !== ws || ap.status !== "pending") throw new Error("This approval isn't pending.");
  await db.approval.update({ where: { id: ap.id }, data: { status: decision, decidedBy: userId, decidedAt: new Date(), note } });
  await audit(ws, userId, `approval_${decision}`, { type: ap.entityType, id: ap.entityId }, { meta: { kind: ap.kind, note, price } });
  const d = (ap.detail || {}) as Record<string, unknown>;
  if (decision === "rejected") {
    if (ap.entityType === "opportunity") await db.opportunity.update({ where: { id: ap.entityId }, data: { exception: null } }).catch(() => null);
    return;
  }
  switch (ap.kind) {
    case "final_offer": {
      const opp = await db.opportunity.findUniqueOrThrow({ where: { id: ap.entityId } });
      const agreed = price || (d.proposedPrice as number) || null;
      await db.opportunity.update({
        where: { id: opp.id },
        data: { approvedAt: new Date(), exception: null, contractPrice: agreed || opp.contractPrice, stage: "CONTRACT_PREPARATION" },
      });
      if (agreed) await db.offer.create({ data: { opportunityId: opp.id, side: "seller", contactId: opp.sellerId, round: 99, price: agreed, by: "us", authority: "approved", status: "proposed" } });
      await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opp.id });
      await createTask(ws, { kind: "review", title: "Prepare and send the seller contract", entityType: "opportunity", entityId: opp.id, priority: 1, assignee: userId, dedupeKey: `contract:${opp.id}` });
      break;
    }
    case "emd": {
      const pay = await db.payment.findFirst({ where: { workspaceId: ws, opportunityId: ap.entityId, kind: "emd", status: { in: ["due", "awaiting_approval"] } } });
      if (pay) await db.payment.update({ where: { id: pay.id }, data: { status: "approved" } });
      break;
    }
    case "payment":
      await db.payment.update({ where: { id: ap.entityId }, data: { status: "approved" } }).catch(() => null);
      break;
    case "agent_request":
    case "offer_over_limit":
      if (ap.entityType === "opportunity" && price) {
        await db.offer.create({ data: { opportunityId: ap.entityId, side: "seller", round: 98, price, by: "us", authority: "approved" } });
        await db.opportunity.update({ where: { id: ap.entityId }, data: { exception: null } });
      }
      break;
  }
}

export async function createOpportunity(ws: string, o: { propertyId: string; sellerId?: string | null; campaignId?: string | null; dealType?: string; exitStrategy?: string; actor: string }) {
  const opp = await db.opportunity.create({
    data: { workspaceId: ws, propertyId: o.propertyId, sellerId: o.sellerId || null, campaignId: o.campaignId || null, dealType: o.dealType || "assignment", exitStrategy: o.exitStrategy || "flip", stage: "NEW" },
  });
  await audit(ws, o.actor, "opportunity_created", { type: "opportunity", id: opp.id });
  return opp;
}
