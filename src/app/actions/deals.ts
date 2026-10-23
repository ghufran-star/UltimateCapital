"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { emit } from "@/lib/engine";
import { startDemandCampaign } from "@/lib/matching";
import type { Calculation } from "@/lib/rules";
import { assertDeal, dealScope, requireCtx } from "@/lib/session";
import { fullName, int, str, usd } from "@/lib/util";
import { act } from "./util";

const UNDER_CONTRACT = ["UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"];

/** Remembers which columns you want on the deals table (per browser). */
export async function dealColumnsAction(fd: FormData) {
  const cols = fd.getAll("cols").map(String).filter(Boolean);
  (await cookies()).set("uc_deal_cols", cols.join(","), { path: "/", maxAge: 365 * 864e5 / 1000, sameSite: "lax" });
  const back = String(fd.get("back") || "/deals");
  redirect(back.startsWith("/deals") ? back : "/deals");
}

/** Pitch one deal to matching investors: anonymous demand check before a contract, full details after. */
export async function pitchDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const mode = UNDER_CONTRACT.includes(opp.stage) ? "full" : "anonymous";
    const msg = await startDemandCampaign(c.workspace.id, id, mode);
    await audit(c.workspace.id, c.user.id, "pitched_manually", { type: "opportunity", id }, { meta: { mode } });
    return { ok: true, message: `${mode === "full" ? "Marketing" : "Anonymous demand check"}: ${msg}` };
  });
}

/** Bulk actions on selected deals. */
export async function bulkDealsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) throw new Error("Tick at least one deal.");
    const deals = await db.opportunity.findMany({ where: { id: { in: ids }, workspaceId: ws, ...dealScope(c) } });
    const what = String(fd.get("bulk") || "");
    let n = 0;
    if (what === "pitch") {
      for (const d of deals) {
        await startDemandCampaign(ws, d.id, UNDER_CONTRACT.includes(d.stage) ? "full" : "anonymous");
        n++;
      }
      return { ok: true, message: `Pitching ${n} deal${n === 1 ? "" : "s"} to matching investors` };
    }
    if (what === "autopilot_off" || what === "autopilot_on") {
      const r = await db.opportunity.updateMany({ where: { id: { in: deals.map((d) => d.id) } }, data: { autopilotOff: what === "autopilot_off" } });
      await audit(ws, c.user.id, what, undefined, { meta: { ids } });
      return { ok: true, message: `Autopilot ${what === "autopilot_off" ? "off" : "on"} for ${r.count} deals` };
    }
    if (what === "assign") {
      const to = str(fd.get("assignee"));
      if (to && !(await db.membership.findFirst({ where: { workspaceId: ws, userId: to } }))) throw new Error("Pick a team member.");
      const r = await db.opportunity.updateMany({ where: { id: { in: deals.map((d) => d.id) } }, data: { assigneeId: to } });
      await audit(ws, c.user.id, "bulk_assign", undefined, { meta: { ids, to } });
      return { ok: true, message: `${r.count} deals ${to ? "assigned" : "unassigned"}` };
    }
    if (what === "revalue") {
      for (const d of deals) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: d.id });
      return { ok: true, message: `Re-valuing ${deals.length} deals` };
    }
    throw new Error("Pick what to do with the selected deals.");
  });
}

/** A manual offer to the seller: recorded and sent by text and/or email (checked against DNC and hours). */
export async function makeOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const price = int(fd.get("price"));
    if (!price) throw new Error("Enter the offer price.");
    const v = await db.valuation.findFirst({ where: { opportunityId: id }, orderBy: { createdAt: "desc" } });
    const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
    const over = calc ? price > calc.maxBuy && !opp.approvedAt : false;
    if (over) {
      if (!["owner", "admin"].includes(c.role)) throw new Error(`That's above the max buy of ${usd(calc!.maxBuy)}. Ask the owner to approve it first.`);
      if (fd.get("confirmOver") !== "on") throw new Error(`That's ${usd(price - calc!.maxBuy)} above the max buy. Tick the box to confirm you're overriding the rules.`);
    }
    const count = await db.offer.count({ where: { opportunityId: id, side: "seller" } });
    await db.offer.create({ data: { opportunityId: id, side: "seller", contactId: opp.sellerId, round: count + 1, price, by: "us", authority: over ? "owner_override" : "manual", response: str(fd.get("note")) } });
    if (["NEW", "ELIGIBLE", "OUTREACH", "ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY"].includes(opp.stage)) {
      await db.opportunity.update({ where: { id }, data: { stage: "NEGOTIATION" } });
    }
    await audit(ws, c.user.id, "manual_offer", { type: "opportunity", id }, { after: { price, over } });
    const channels = fd.getAll("send").map(String);
    const sent: string[] = [];
    if (channels.length && opp.sellerId) {
      const seller = await db.contact.findUniqueOrThrow({ where: { id: opp.sellerId } });
      const prop = await db.property.findUniqueOrThrow({ where: { id: opp.propertyId } });
      const text = (str(fd.get("message")) || `Hi ${seller.firstName || fullName(seller)}, following up on ${prop.address}: we can offer ${usd(price)} cash, as-is, no agent fees, closing on your timeline. A written agreement would follow for you to review.`).replace("{{price}}", usd(price));
      const comms = await import("@/lib/comms");
      if (channels.includes("sms")) sent.push(`text: ${(await comms.sendSms(ws, { contactId: seller.id, body: text, opportunityId: id })) || "sent"}`);
      if (channels.includes("email") && seller.email) sent.push(`email: ${(await comms.sendEmail(ws, { to: seller.email, subject: `Our offer for ${prop.address}`, text, contactId: seller.id, opportunityId: id })) || "sent"}`);
      if (channels.includes("email") && !seller.email) sent.push("email: no address on file");
    }
    return { ok: true, message: `Offer of ${usd(price)} recorded${sent.length ? `. ${sent.join(" · ")}` : ""}` };
  });
}

/** Send the deal to investors you pick by hand (contact caps overridden; DNC and opt-outs still apply). */
export async function pitchSelectedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) throw new Error("Tick the investors to send it to.");
    const mode = UNDER_CONTRACT.includes(opp.stage) ? "full" : "anonymous";
    const { createTask } = await import("@/lib/engine");
    let n = 0;
    for (const contactId of ids) {
      const it = await db.buyerInterest.findUnique({ where: { opportunityId_contactId: { opportunityId: id, contactId } } });
      if (!it) continue;
      await createTask(ws, { kind: "buyer_outreach", title: `Present deal (${mode === "anonymous" ? "anonymous demand check" : "full"}, picked by hand)`, entityType: "opportunity", entityId: id, contactId, payload: { mode, manual: true }, dueAt: new Date(Date.now() + n * 60_000), dedupeKey: `outreach:${id}:${contactId}:${mode}` });
      n++;
    }
    await audit(ws, c.user.id, "pitched_selected", { type: "opportunity", id }, { meta: { mode, contacts: ids } });
    return { ok: true, message: `Sending to ${n} investor${n === 1 ? "" : "s"} (${mode === "anonymous" ? "anonymous" : "with full details"})` };
  });
}

/** Add any investor to a deal by hand, matched or not. */
export async function addBuyerToDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    const contactId = String(fd.get("contactId") || "");
    const b = await db.contact.findFirst({ where: { id: contactId, workspaceId: c.workspace.id, kind: "buyer" } });
    if (!b) throw new Error("Pick an investor.");
    await db.buyerInterest.upsert({
      where: { opportunityId_contactId: { opportunityId: id, contactId } },
      create: { opportunityId: id, contactId, stage: "MATCHED", fitScore: 0, reasons: ["Added by hand"], notes: str(fd.get("note")) },
      update: { notes: str(fd.get("note")) ?? undefined },
    });
    await audit(c.workspace.id, c.user.id, "buyer_added_by_hand", { type: "opportunity", id }, { meta: { contactId } });
    return { ok: true, message: `${fullName(b)} added to the deal` };
  });
}

/** Email the title company yourself; replies come back to the deal's inbox. */
export async function emailTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    const tx = await db.transaction.findUnique({ where: { opportunityId: id }, include: { titleCompany: true } });
    const to = str(fd.get("to")) || tx?.titleCompany?.email;
    if (!to) throw new Error("Choose the title company on this deal first, or type an email address.");
    const subject = str(fd.get("subject"));
    const text = str(fd.get("body"));
    if (!subject || !text) throw new Error("Write a subject and a message.");
    const { dealInboxAddress } = await import("@/lib/title");
    const replyTo = tx ? await dealInboxAddress(ws, tx.inboxAlias) : null;
    const attachments: { filename: string; content: Buffer }[] = [];
    if (fd.get("attachContracts") === "on") {
      const ks = await db.contract.findMany({ where: { opportunityId: id, finalPdf: { not: null } } });
      for (const k of ks) attachments.push({ filename: `${k.kind}-signed.pdf`, content: Buffer.from(k.finalPdf!) });
    }
    const { sendEmail } = await import("@/lib/comms");
    await sendEmail(ws, { to, subject, text, opportunityId: id, replyTo: replyTo || undefined, attachments, skipChecks: true });
    await audit(ws, c.user.id, "title_emailed", { type: "opportunity", id }, { meta: { to, subject, attachments: attachments.length } });
    return { ok: true, message: `Sent to ${to}` };
  });
}

/** Correct something the AI recorded: the new value is stored as verified and the old one kept in history. */
export async function correctFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const ws = c.workspace.id;
    const factId = str(fd.get("factId"));
    const value = str(fd.get("value"));
    if (factId) {
      const f = await db.fact.findFirstOrThrow({ where: { id: factId, workspaceId: ws } });
      await db.fact.update({ where: { id: f.id }, data: { supersededAt: new Date() } });
      if (fd.get("remove") !== "1") {
        if (!value) throw new Error("Type the correct value, or remove it.");
        await db.fact.create({ data: { workspaceId: ws, entityType: f.entityType, entityId: f.entityId, field: f.field, value, kind: "verified", confidence: 1, conflictsWith: f.id } });
      }
      await audit(ws, c.user.id, fd.get("remove") === "1" ? "fact_removed" : "fact_corrected", { type: f.entityType, id: f.entityId }, { before: { [f.field]: f.value }, after: fd.get("remove") === "1" ? undefined : { [f.field]: value } });
      return { ok: true, message: "Corrected" };
    }
    const entityType = String(fd.get("entityType"));
    const entityId = String(fd.get("entityId"));
    const field = str(fd.get("field"));
    if (!field || !value) throw new Error("Type what it is and its value.");
    await db.fact.create({ data: { workspaceId: ws, entityType, entityId, field: field.toLowerCase().replace(/\s+/g, "_"), value, kind: "verified", confidence: 1 } });
    await audit(ws, c.user.id, "fact_added", { type: entityType, id: entityId }, { after: { [field]: value } });
    return { ok: true, message: "Added" };
  });
}

/** Edit the AI-written situation summary and open questions on a person. */
export async function editSummaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const id = String(fd.get("contactId"));
    const ct = await db.contact.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const summary = str(fd.get("summary"));
    const openQuestions = String(fd.get("openQuestions") || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10);
    await db.contact.update({ where: { id }, data: { summary, openQuestions } });
    await audit(c.workspace.id, c.user.id, "summary_edited", { type: "contact", id }, { before: { summary: ct.summary, openQuestions: ct.openQuestions }, after: { summary, openQuestions } });
    return { ok: true, message: "Saved" };
  });
}

/** Reassign a task to someone (or to an AI agent). */
export async function assignTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const t = await db.task.findFirstOrThrow({ where: { id: String(fd.get("taskId")), workspaceId: c.workspace.id } });
    const to = str(fd.get("assignee"));
    await db.task.update({ where: { id: t.id }, data: { assignee: to } });
    await audit(c.workspace.id, c.user.id, "task_assigned", { type: "task", id: t.id }, { before: { assignee: t.assignee }, after: { assignee: to } });
    return { ok: true, message: "Reassigned" };
  });
}
