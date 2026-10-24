import { audit } from "./audit";
import { db } from "./db";
import { createTask, emit } from "./engine";

// One-tap call outcomes: after any call the team makes, one tap records what happened and
// books the right follow-up. Works for in-app calls, "ring my phone" calls and logged calls.

export const CALL_OUTCOMES = [
  { key: "interested", label: "Interested", tone: "good", final: true },
  { key: "callback", label: "Call back", tone: "", final: false },
  { key: "not_now", label: "Not now", tone: "", final: true },
  { key: "price_high", label: "Price too high", tone: "warn", final: true },
  { key: "not_interested", label: "Not interested", tone: "bad", final: true },
  { key: "no_answer", label: "No answer", tone: "", final: false },
  { key: "voicemail", label: "Left voicemail", tone: "", final: false },
  { key: "wrong_number", label: "Wrong number", tone: "bad", final: true },
  { key: "dnc", label: "Do not call", tone: "bad", final: true },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];

const DAY = 864e5;

export async function applyCallOutcome(
  ws: string,
  userId: string,
  o: { contactId: string; opportunityId?: string | null; interactionId?: string | null; outcome: string; note?: string | null; callbackAt?: Date | null; campaignId?: string | null }
) {
  const def = CALL_OUTCOMES.find((x) => x.key === o.outcome);
  if (!def) throw new Error("Pick what happened on the call.");
  const contact = await db.contact.findFirstOrThrow({ where: { id: o.contactId, workspaceId: ws } });
  const opp = o.opportunityId
    ? await db.opportunity.findFirst({ where: { id: o.opportunityId, workspaceId: ws } })
    : await db.opportunity.findFirst({ where: { workspaceId: ws, sellerId: contact.id }, orderBy: { updatedAt: "desc" } });
  const note = o.note?.trim() || null;
  // The call itself: the one just made through the app, else a new logged call.
  const recent = o.interactionId
    ? await db.interaction.findFirst({ where: { id: o.interactionId, workspaceId: ws } })
    : await db.interaction.findFirst({ where: { workspaceId: ws, contactId: contact.id, channel: "call", provider: { in: ["twilio", "manual"] }, createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } }, orderBy: { createdAt: "desc" } });
  const it = recent
    ? await db.interaction.update({ where: { id: recent.id }, data: { outcome: o.outcome, status: "done", body: note ? `${recent.body && !recent.body.startsWith("Caller notes:") ? `${recent.body}\n\n` : ""}Caller notes: ${note}` : recent.body, summary: note?.slice(0, 200) || recent.summary || def.label, opportunityId: recent.opportunityId || opp?.id } })
    : await db.interaction.create({ data: { workspaceId: ws, contactId: contact.id, opportunityId: opp?.id, campaignId: o.campaignId || null, channel: "call", direction: "outbound", provider: "manual", outcome: o.outcome, body: note ? `Caller notes: ${note}` : null, summary: note?.slice(0, 200) || def.label, status: "done", intel: { human: userId } } });
  await db.contact.update({ where: { id: contact.id }, data: { lastContactAt: new Date() } });

  const who = contact.firstName || "them";
  // Team follow-ups are "follow_up" tasks (a person does them); "call" tasks are AI calls.
  const task = (title: string, inDays: number, kind = "follow_up") =>
    createTask(ws, { kind, title, contactId: contact.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || contact.id, assignee: opp?.assigneeId || contact.assigneeId || userId, priority: inDays <= 1 ? 1 : 2, dueAt: new Date(Date.now() + inDays * DAY), dedupeKey: `followup:${contact.id}` });

  switch (o.outcome) {
    case "interested":
      if (opp && ["NEW", "ELIGIBLE", "OUTREACH"].includes(opp.stage)) await db.opportunity.update({ where: { id: opp.id }, data: { stage: "ENGAGED", assigneeId: opp.assigneeId || userId } });
      await db.contact.update({ where: { id: contact.id }, data: { assigneeId: contact.assigneeId || userId } });
      await createTask(ws, { kind: "follow_up", title: `Follow up: ${who} is interested`, contactId: contact.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || contact.id, assignee: userId, priority: 1, dueAt: new Date(Date.now() + 4 * 3600_000), dedupeKey: `interested:${contact.id}` });
      break;
    case "callback":
      // In a campaign the dialer re-queues the contact itself.
      if (!o.campaignId) await createTask(ws, { kind: "follow_up", title: `Call ${who} back`, contactId: contact.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || contact.id, assignee: userId, priority: 1, dueAt: o.callbackAt || new Date(Date.now() + DAY), dedupeKey: `followup:${contact.id}` });
      if (opp) await db.opportunity.update({ where: { id: opp.id }, data: { nextStep: `Call back ${o.callbackAt ? o.callbackAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "tomorrow"}` } });
      break;
    case "not_now":
      await task(`Check in with ${who}: has anything changed?`, 90, "follow_up");
      if (opp) await db.opportunity.update({ where: { id: opp.id }, data: { nextStep: "Check in again in 3 months" } });
      break;
    case "price_high":
      await task(`${who} wanted more: try again`, 30, "follow_up");
      if (opp) await db.opportunity.update({ where: { id: opp.id }, data: { nextStep: "Price too high: try again in 30 days" } });
      break;
    case "not_interested":
      if (opp) await db.opportunity.update({ where: { id: opp.id }, data: { exception: "DECLINED", nextStep: null } });
      break;
    case "no_answer":
    case "voicemail":
      if (!o.campaignId) await task(`Try ${who} again`, 1);
      break;
    case "wrong_number":
      if (contact.phone) await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: contact.phone, source: "internal", reason: `Wrong number for ${contact.firstName} ${contact.lastName}`.trim() } }).catch(() => null);
      await db.contact.update({ where: { id: contact.id }, data: { phone: contact.phone2 || null, phone2: null, phoneStatus: null, notes: `${contact.notes ? `${contact.notes}\n` : ""}Wrong number: ${contact.phone}` } });
      break;
    case "dnc":
      await emit(ws, "contact.opt_out", { type: "contact", id: contact.id }, { reason: "Asked not to be called (team call)", source: "opt_out" });
      break;
  }
  if (note) await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  await audit(ws, userId, "call_outcome", { type: "contact", id: contact.id }, { meta: { outcome: o.outcome, interactionId: it.id } });
  return { interactionId: it.id, final: def.final, label: def.label };
}
