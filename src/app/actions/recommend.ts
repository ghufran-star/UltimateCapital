"use server";

import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { createTask } from "@/lib/engine";
import { assertDeal, requireCtx } from "@/lib/session";
import { fullName, int, str, usd } from "@/lib/util";
import { act } from "./util";

async function record(ws: string, userId: string, o: { key: string; opportunityId: string; action: string; price: number | null; status: "acted" | "dismissed"; taken?: string; reasons?: string[] }) {
  await db.recommendation.upsert({
    where: { workspaceId_key: { workspaceId: ws, key: o.key } },
    create: { workspaceId: ws, key: o.key, opportunityId: o.opportunityId, action: o.action, price: o.price, status: o.status, taken: o.taken, reasons: o.reasons || [], decidedBy: userId, decidedAt: new Date() },
    update: { status: o.status, taken: o.taken, decidedBy: userId, decidedAt: new Date() },
  });
  await audit(ws, userId, `recommendation_${o.status}`, { type: "opportunity", id: o.opportunityId }, { meta: { action: o.action, price: o.price, taken: o.taken } });
}

/** One click on a recommendation: send the letter, book the call, pitch investors, park the deal, value it, or dismiss. */
export async function recAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const key = String(fd.get("key"));
    const action = String(fd.get("action"));
    const price = int(fd.get("price")) || null;
    const what = String(fd.get("do"));
    const base = { key, opportunityId: id, action, price, reasons: fd.getAll("reason").map(String).slice(0, 8) };
    if (what === "dismiss") {
      await record(ws, c.user.id, { ...base, status: "dismissed" });
      return { ok: true, message: "Dismissed" };
    }
    if (what === "letter") {
      if (!price) throw new Error("No price on this recommendation.");
      const { letterDefaults, offerLimit, sendOfferLetter } = await import("@/lib/offerletter");
      const lim = await offerLimit(id, price);
      if (lim.over && !["owner", "admin"].includes(c.role)) throw new Error(`${usd(price)} is above the max buy of ${usd(lim.maxBuy)}. Only the owner can send it.`);
      const u = await db.user.findUnique({ where: { id: c.user.id } });
      const fields = await letterDefaults(ws, id, price, { name: c.user.name, email: c.user.email, phone: u?.phone });
      const r = await sendOfferLetter(ws, { opportunityId: id, fields, actor: c.user.id, channels: ["email", "sms"], authority: lim.over ? "owner_override" : "recommended" });
      await record(ws, c.user.id, { ...base, status: "acted", taken: "offer_letter" });
      return { ok: true, message: r.message };
    }
    if (what === "call") {
      if (!opp.sellerId) throw new Error("This deal has no seller.");
      await createTask(ws, { kind: "call", title: price ? `Negotiate toward ${usd(price)} (recommended)` : "Follow-up call (recommended)", reason: price ? `Target ${usd(price)}; stay within the max buy unless the owner approves more.` : undefined, contactId: opp.sellerId, entityType: "opportunity", entityId: id, assignee: "agent:negotiation", priority: 1, dueAt: new Date(Date.now() + 5 * 60_000), payload: { agentRole: "negotiation", opportunityId: id, fallbackToTeam: true }, dedupeKey: `reccall:${id}` });
      await record(ws, c.user.id, { ...base, status: "acted", taken: "call" });
      return { ok: true, message: opp.autopilotOff ? "Call booked (this deal's autopilot is off, so it waits for you to turn it on or call yourself)" : "Negotiation call booked" };
    }
    if (what === "pitch") {
      const ids = fd.getAll("ids").map(String);
      if (!ids.length) throw new Error("Tick the investors to pitch.");
      const mode = ["UNDER_CONTRACT", "DISPOSITION", "CLOSING"].includes(opp.stage) ? "full" : "anonymous";
      let n = 0;
      for (const contactId of ids) {
        const it = await db.buyerInterest.findUnique({ where: { opportunityId_contactId: { opportunityId: id, contactId } } });
        if (!it) continue;
        await createTask(ws, { kind: "buyer_outreach", title: `Present deal (${mode === "anonymous" ? "anonymous demand check" : "full"}, recommended fit)`, entityType: "opportunity", entityId: id, contactId, payload: { mode, manual: true }, dueAt: new Date(Date.now() + n * 60_000), dedupeKey: `outreach:${id}:${contactId}:${mode}` });
        n++;
      }
      await record(ws, c.user.id, { ...base, status: "acted", taken: "pitch" });
      return { ok: true, message: `Sending to ${n} investor${n === 1 ? "" : "s"}` };
    }
    if (what === "pass") {
      await db.opportunity.update({ where: { id }, data: { autopilotOff: true, nextStep: "Passed for now: recheck in 30 days" } });
      if (opp.sellerId) await createTask(ws, { kind: "follow_up", title: "Recheck the seller we passed on: has their number moved?", contactId: opp.sellerId, entityType: "opportunity", entityId: id, assignee: opp.assigneeId || undefined, dueAt: new Date(Date.now() + 30 * 86_400_000), dedupeKey: `recheck:${id}` });
      await record(ws, c.user.id, { ...base, status: "acted", taken: "pass" });
      return { ok: true, message: "Parked: automation off for this deal, reminder in 30 days" };
    }
    if (what === "value") {
      await createTask(ws, { kind: "valuation", title: "Value the property", entityType: "opportunity", entityId: id, dueAt: new Date(), dedupeKey: `val:${id}`, payload: { force: true } });
      await record(ws, c.user.id, { ...base, status: "acted", taken: "valuation" });
      return { ok: true, message: "Valuation queued" };
    }
    throw new Error("Unknown action.");
  });
}

/** AI second opinion on one deal (only runs when pressed; uses your Claude key). */
export async function aiOpinionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    const opp = await db.opportunity.findUniqueOrThrow({ where: { id }, include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, offers: { orderBy: { createdAt: "asc" }, omit: { pdf: true } }, interests: { include: { contact: true } } } });
    const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
    const facts = await db.fact.findMany({ where: { workspaceId: ws, supersededAt: null, entityId: { in: [id, opp.propertyId, ...(opp.sellerId ? [opp.sellerId] : [])] } }, take: 60, orderBy: { createdAt: "desc" } });
    const talks = opp.sellerId ? await db.interaction.findMany({ where: { workspaceId: ws, contactId: opp.sellerId, summary: { not: null } }, orderBy: { createdAt: "desc" }, take: 8, select: { channel: true, createdAt: true, summary: true, outcome: true } }) : [];
    const calc = opp.valuations[0]?.result as Record<string, unknown> | undefined;
    const { claudeJson } = await import("@/lib/claude");
    const out = await claudeJson<{ action: "sign" | "negotiate" | "pass"; price: number; reasons: string[]; risks: string[] }>(ws, {
      kind: "analysis",
      maxTokens: 2000,
      prompt: `You advise a real estate wholesaler. Decide: sign the seller now, negotiate to a specific price, or pass. Never recommend paying above the max buy unless investor demand clearly supports it, and say so if you do.
Property: ${opp.property.address}, ${opp.property.city} ${opp.property.state} · ${opp.property.propertyType} · ${opp.property.beds ?? "?"}bd/${opp.property.baths ?? "?"}ba · ${opp.property.sqft ?? "?"} sqft · condition ${opp.property.conditionTier ?? "?"} · situations ${opp.property.situations.join(", ") || "none"}
Numbers: ${calc ? `ARV ${usd(calc.arv as number)}, repairs ${usd(calc.repairs as number)}, max buy ${usd(calc.maxBuy as number)}, investor max ${usd(calc.investorMaxPrice as number)}` : "no valuation"}
Seller: ${seller ? fullName(seller) : "?"} · asking ${usd(opp.askingPrice)} · lowest ${usd(opp.sellerLowest)} · motivation ${opp.motivation || "?"} · timeline ${opp.timeline || "?"}
Offers so far: ${opp.offers.map((o) => `${o.side} ${o.by} ${usd(o.price)} ${o.status}`).join("; ") || "none"}
Investors: ${opp.interests.length} matched, ${opp.interests.filter((i) => i.serious).length} serious, prices mentioned: ${opp.interests.map((i) => i.priceMentioned).filter(Boolean).map((p) => usd(p)).join(", ") || "none"}
Facts: ${facts.map((f) => `${f.field}=${JSON.stringify(f.value)}`).join("; ").slice(0, 3000) || "none"}
Recent conversations: ${talks.map((t) => `${t.channel} ${t.outcome || ""}: ${t.summary}`).join(" | ").slice(0, 3000) || "none"}`,
      schema: { type: "object", properties: { action: { type: "string", enum: ["sign", "negotiate", "pass"] }, price: { type: "number", description: "Price to sign at or negotiate to (0 for pass)" }, reasons: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } } }, required: ["action", "price", "reasons", "risks"] },
    });
    const price = out.price ? Math.round(out.price / 500) * 500 : null;
    await db.recommendation.create({ data: { workspaceId: ws, key: `${id}:ai:${Date.now()}`, opportunityId: id, action: out.action, price, source: "ai", reasons: [...out.reasons, ...out.risks.map((r) => `Risk: ${r}`)].slice(0, 10), decidedBy: c.user.id } });
    await audit(ws, c.user.id, "ai_second_opinion", { type: "opportunity", id }, { after: { action: out.action, price } });
    return { ok: true, message: `AI: ${out.action}${price ? ` at ${usd(price)}` : ""}` };
  });
}

/** Note on how a recommendation turned out when the deal ends without a clean stage. */
export async function recOutcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("recommendationId"));
    const outcome = str(fd.get("outcome"));
    await db.recommendation.updateMany({ where: { id, workspaceId: c.workspace.id }, data: { outcome: outcome === "won" || outcome === "lost" ? outcome : null, outcomeAt: new Date() } });
    return { ok: true, message: "Saved" };
  });
}
