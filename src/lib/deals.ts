import { audit, json, notify } from "./audit";
import { shortType } from "./catalog";
import { setting } from "./config";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { Authority, buyerAuthority, calculate, Calculation, nearAgreement, sellerAuthority } from "./rules";
import { fullName, usd } from "./util";
import { dealParams, latestValuation } from "./valuation";

// Opportunities: stages, offer authority, near-agreement verification, approvals.

export async function setStage(ws: string, opportunityId: string, stage: string, actor: string, exception?: string | null) {
  const before = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  await db.opportunity.update({ where: { id: opportunityId }, data: { stage, ...(exception !== undefined ? { exception } : {}) } });
  await audit(ws, actor, "stage_changed", { type: "opportunity", id: opportunityId }, { before: { stage: before.stage, exception: before.exception }, after: { stage, exception } });
}

export async function calcFor(opportunityId: string) {
  const v = await latestValuation(opportunityId);
  if (!v || v.blocked) return { v, calc: null as Calculation | null };
  return { v, calc: v.result as unknown as Calculation };
}

/**
 * The purchase price buyer pricing is based on: the approved contract price; before approval, the seller's
 * lowest number when it's within our max buy (the presumptive price); otherwise the rules' contract price.
 */
export function contractBasis(opp: { contractPrice: number | null; sellerLowest: number | null; approvedAt: Date | null }, calc: Calculation) {
  if (opp.contractPrice && opp.approvedAt) return opp.contractPrice;
  if (opp.sellerLowest && opp.sellerLowest <= calc.maxBuy) return Math.min(opp.sellerLowest, calc.maxBuy);
  return opp.contractPrice || calc.contractPrice;
}

/** Buyer asking prices and the floor for a given contract price, under the deal's own rules. */
export function buyerLadder(contract: number, calc: Calculation, params: { buyerRoundFees: number[]; minFee: number }) {
  const floor = contract + params.minFee;
  const cap = Math.floor(calc.investorMaxPrice / 100) * 100;
  const rounds = [...new Set(params.buyerRoundFees.map((f) => Math.max(floor, Math.min(contract + f, cap))))].sort((a, b) => b - a);
  return { rounds, floor };
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
  const params = await dealParams(ws, opportunityId);
  const { rounds, floor } = buyerLadder(contractBasis(opp, calc), calc, params);
  const presented = await db.offer.findMany({ where: { opportunityId, side: "buyer", contactId, by: "us" } });
  const approvedLow = presented.filter((o) => o.authority === "approved").map((o) => o.price);
  const effFloor = Math.min(floor, ...approvedLow);
  const a = buyerAuthority(rounds, effFloor, presented.filter((o) => o.authority !== "approved").map((o) => o.price), buyerOffer);
  if (buyerOffer && buyerOffer < effFloor) {
    await requestApproval(ws, opportunityId, "price_below_floor", `Buyer offered ${usd(buyerOffer)}, below the ${usd(floor)} floor`, `agent:disposition`, { price: buyerOffer, floor, contactId });
  }
  if (a.offerNow && !presented.some((o) => o.price === a.offerNow)) {
    await db.offer.create({ data: { opportunityId, side: "buyer", contactId, round: presented.length + 1, price: a.offerNow, by: "us", authority: "rule" } });
  }
  return a;
}

export async function requestApproval(ws: string, opportunityId: string, kind: string, title: string, requestedBy: string, detail: Record<string, unknown>) {
  const existing = await db.approval.findFirst({ where: { workspaceId: ws, entityId: opportunityId, kind, status: "pending" } });
  if (existing) return existing;
  const ap = await db.approval.create({ data: { workspaceId: ws, kind, entityType: "opportunity", entityId: opportunityId, title, detail: json(detail), requestedBy } });
  await notify(ws, "Approval needed", title, `/approvals#${ap.id}`);
  return ap;
}

/** When the seller gets close to our numbers: verification pack to the owner + demand campaign, at once. */
export async function checkNearAgreement(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  if (opp.verificationSentAt || !opp.sellerLowest) return;
  const { calc } = await calcFor(opportunityId);
  if (!calc) return;
  const params = await dealParams(ws, opportunityId);
  if (!nearAgreement(opp.sellerLowest, calc.maxBuy, params)) return;
  await createTask(ws, { kind: "verification_pack", title: "Send verification pack to owner", entityType: "opportunity", entityId: opportunityId, priority: 1, dedupeKey: `verify:${opportunityId}` });
  const { getAutonomy } = await import("./controls");
  if ((await getAutonomy(ws)).demandCheck === "auto") {
    await createTask(ws, { kind: "demand_campaign", title: "Start anonymous buyer demand check", entityType: "opportunity", entityId: opportunityId, priority: 1, payload: { mode: "anonymous" }, dedupeKey: `demand:${opportunityId}` });
  } else {
    await requestApproval(ws, opportunityId, "demand_check", `Start the anonymous buyer check for ${opp.property.address}?`, "system", { mode: "anonymous" });
  }
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
    `Property: ${p.beds ?? "?"} bd / ${p.baths ?? "?"} ba · ${p.sqft ?? "?"} sq ft · built ${p.yearBuilt ?? "?"} · ${shortType(p.propertyType)} · ${p.occupancy || "occupancy ?"} · condition ${p.conditionTier || "?"}`,
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
/** What a given purchase price does to our fee and the investor's margin, under the deal's rules. */
export async function priceImpact(ws: string, opportunityId: string, price: number) {
  const v = await latestValuation(opportunityId);
  if (!v || v.blocked) return null;
  const calc = v.result as unknown as Calculation;
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const params = await dealParams(ws, opportunityId);
  const at = calculate({ arv: calc.arv, repairs: calc.repairs, params, exit: opp.exitStrategy, rent: v.rent, contractPrice: price });
  return {
    maxBuy: calc.maxBuy,
    over: price - calc.maxBuy,
    viable: at.viable,
    floor: at.floor,
    investorMax: at.investorMaxPrice,
    feeRound1: at.ourFeeAtRounds[0] ?? 0,
    text: `At ${usd(price)} (${price > calc.maxBuy ? `${usd(price - calc.maxBuy)} above` : "within"} the ${usd(calc.maxBuy)} max buy): our fee at round 1 would be ${usd(at.ourFeeAtRounds[0] ?? 0)}, the floor ${usd(at.floor)}, and the investor's maximum ${usd(at.investorMaxPrice)}.${at.viable ? "" : " The deal would NOT work for an investor at our minimum fee."}`,
  };
}

export async function decideApproval(ws: string, approvalId: string, decision: "approved" | "rejected", userId: string, note?: string, price?: number | null, overLock = false) {
  const ap = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
  if (ap.workspaceId !== ws || ap.status !== "pending") throw new Error("This approval isn't pending.");
  if (decision === "approved" && ap.entityType === "opportunity" && ["final_offer", "offer_over_limit", "agent_request", "offer_letter"].includes(ap.kind) && ap.requestedBy !== "agent:disposition") {
    const d0 = (ap.detail || {}) as Record<string, unknown>;
    const p0 = price || (d0.proposedPrice as number) || (d0.price as number) || null;
    if (p0) {
      const impact = await priceImpact(ws, ap.entityId, p0);
      if (impact && impact.over > 0 && !overLock) throw new Error(`${impact.text} Tick "approve above the max buy" to confirm.`);
    }
  }
  await db.approval.update({ where: { id: ap.id }, data: { status: decision, decidedBy: userId, decidedAt: new Date(), note } });
  await audit(ws, userId, `approval_${decision}`, { type: ap.entityType, id: ap.entityId }, { meta: { kind: ap.kind, note, price } });
  const d = (ap.detail || {}) as Record<string, unknown>;
  // Close the loop: a decision on something the negotiator asked for books the call that delivers it.
  if (["agent_request", "offer_over_limit"].includes(ap.kind) && ap.entityType === "opportunity" && ap.requestedBy !== "agent:disposition") {
    const o = await db.opportunity.findUnique({ where: { id: ap.entityId } });
    if (o?.sellerId) {
      await createTask(ws, { kind: "call", title: decision === "approved" ? "Deliver the approved offer to the seller" : "Tell the seller where we landed", reason: note || undefined, contactId: o.sellerId, entityType: "opportunity", entityId: o.id, assignee: "agent:negotiation", priority: 1, dueAt: new Date(Date.now() + 10 * 60_000), payload: { agentRole: "negotiation", opportunityId: o.id, fallbackToTeam: true }, dedupeKey: `approvalcall:${ap.id}` });
    }
  }
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
      const { getAutonomy } = await import("./controls");
      let sent = false;
      if ((await getAutonomy(ws)).sendSellerContract === "auto") {
        const { defaultTemplate, prepareContract, sendForSignature } = await import("./contracts");
        const t = await defaultTemplate(ws, opp.id, "seller_purchase");
        if (t && !t.body.startsWith("SAMPLE ONLY")) {
          try {
            const k = await prepareContract(ws, { opportunityId: opp.id, templateId: t.id, userId });
            await sendForSignature(ws, k.id, userId);
            sent = true;
          } catch (e) {
            await notify(ws, "Contract not sent automatically", e instanceof Error ? e.message : String(e), `/deals/${opp.id}?tab=contracts`);
          }
        }
      }
      if (!sent) await createTask(ws, { kind: "review", title: "Prepare and send the seller contract", entityType: "opportunity", entityId: opp.id, priority: 1, assignee: userId, dedupeKey: `contract:${opp.id}` });
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
    case "demand_check":
    case "full_marketing":
      await createTask(ws, { kind: "demand_campaign", title: ap.kind === "demand_check" ? "Start anonymous buyer demand check" : "Market the deal to matching buyers (with disclosure)", entityType: "opportunity", entityId: ap.entityId, priority: 1, payload: { mode: ap.kind === "demand_check" ? "anonymous" : "full" }, dedupeKey: `demand:${ap.entityId}:${ap.kind}` });
      break;
    case "price_below_floor": {
      const cid = (d.contactId as string) || null;
      const p = price || (d.price as number) || null;
      if (p && cid) await db.offer.create({ data: { opportunityId: ap.entityId, side: "buyer", contactId: cid, round: 97, price: p, by: "us", authority: "approved" } });
      await db.opportunity.update({ where: { id: ap.entityId }, data: { exception: null } }).catch(() => null);
      break;
    }
    case "offer_letter": {
      const p = price || (d.price as number);
      if (p) {
        const { letterDefaults, sendOfferLetter } = await import("./offerletter");
        const u = await db.user.findUnique({ where: { id: userId } });
        const fields = await letterDefaults(ws, ap.entityId, p, u ? { name: u.name, email: u.email, phone: u.phone } : undefined);
        const r = await sendOfferLetter(ws, { opportunityId: ap.entityId, fields, actor: userId, channels: ["email", "sms"], auto: true, interactionId: (d.interactionId as string) || undefined, authority: "approved" });
        await notify(ws, "Offer letter sent", r.message, `/deals/${ap.entityId}#offers`);
      }
      break;
    }
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
