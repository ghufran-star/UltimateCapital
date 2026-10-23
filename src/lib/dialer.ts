import { audit } from "./audit";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { checkEligibility } from "./eligibility";

// Power dialer for the team: one contact at a time, locked to the caller, checked for compliance
// before it's shown, with one-click outcomes that schedule the follow-up.

export const OUTCOMES = [
  { key: "no_answer", label: "No answer", final: false },
  { key: "voicemail", label: "Left voicemail", final: false },
  { key: "callback", label: "Call back later", final: false },
  { key: "interested", label: "Interested", final: true },
  { key: "not_interested", label: "Not interested", final: true },
  { key: "wrong_number", label: "Wrong number", final: true },
  { key: "dnc", label: "Do not call", final: true },
] as const;

const LOCK_MINUTES = 20;

export async function currentLead(ws: string, userId: string, campaignId: string) {
  return db.campaignMember.findFirst({ where: { campaignId, lockedBy: userId, status: "in_progress", campaign: { workspaceId: ws } }, include: { contact: true } });
}

/** Locks the next contact this person may call now. Skips (and reschedules or blocks) anyone who fails the checks. */
export async function nextLead(ws: string, userId: string, campaignId: string) {
  const camp = await db.campaign.findFirstOrThrow({ where: { id: campaignId, workspaceId: ws } });
  if (camp.status !== "running") throw new Error("Start the campaign first (Campaigns → Start).");
  await db.campaignMember.updateMany({ where: { campaignId, status: "in_progress", lockedAt: { lt: new Date(Date.now() - LOCK_MINUTES * 60_000) } }, data: { status: "retry", lockedBy: null, lockedAt: null } });
  const mine = await currentLead(ws, userId, campaignId);
  if (mine) return mine;
  const settings = (camp.settings || {}) as { maxAttempts?: number };
  for (let page = 0; page < 5; page++) {
    const batch = await db.campaignMember.findMany({
      where: { campaignId, status: { in: ["pending", "retry"] }, lockedBy: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
      take: 20,
    });
    if (!batch.length) return null;
    for (const m of batch) {
      if (m.attempts >= (settings.maxAttempts || 3)) {
        await db.campaignMember.update({ where: { id: m.id }, data: { status: "done", lastOutcome: m.lastOutcome || "max_attempts" } });
        continue;
      }
      const e = await checkEligibility(ws, m.contactId, "human_call");
      if (!e.ok) {
        await db.campaignMember.update({ where: { id: m.id }, data: e.retryAt ? { status: "retry", nextAttemptAt: e.retryAt, lastOutcome: "rescheduled" } : { status: "blocked", blockedReason: e.reason?.slice(0, 200) } });
        continue;
      }
      const got = await db.campaignMember.updateMany({ where: { id: m.id, lockedBy: null }, data: { status: "in_progress", lockedBy: userId, lockedAt: new Date() } });
      if (got.count) return db.campaignMember.findUniqueOrThrow({ where: { id: m.id }, include: { contact: true } });
    }
  }
  return null;
}

export async function recordOutcome(ws: string, userId: string, memberId: string, o: { outcome: string; note?: string | null; callbackAt?: Date | null }) {
  const m = await db.campaignMember.findFirstOrThrow({ where: { id: memberId, lockedBy: userId, campaign: { workspaceId: ws } }, include: { campaign: true, contact: true } });
  const def = OUTCOMES.find((x) => x.key === o.outcome);
  if (!def) throw new Error("Pick an outcome.");
  const retryGap = Number(((m.campaign.settings || {}) as { retryGapHours?: number }).retryGapHours || 24);
  const opp = m.propertyId ? await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: m.propertyId } }) : null;
  // The call itself (if placed through the app in the last 2 hours) gets the outcome and the note.
  const call = await db.interaction.findFirst({ where: { workspaceId: ws, contactId: m.contactId, channel: "call", direction: "outbound", createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } }, orderBy: { createdAt: "desc" } });
  const body = o.note?.trim() || null;
  const it = call
    ? await db.interaction.update({ where: { id: call.id }, data: { outcome: o.outcome, status: "done", body: body ? `Caller notes: ${body}` : call.body, summary: body?.slice(0, 200) || call.summary, opportunityId: call.opportunityId || opp?.id } })
    : await db.interaction.create({ data: { workspaceId: ws, contactId: m.contactId, opportunityId: opp?.id, campaignId: m.campaignId, channel: "call", direction: "outbound", provider: "manual", outcome: o.outcome, body: body ? `Caller notes: ${body}` : null, summary: body?.slice(0, 200) || def.label, status: "done" } });
  await db.contact.update({ where: { id: m.contactId }, data: { lastContactAt: new Date() } });
  const data: { status: string; lastOutcome: string; lockedBy: null; lockedAt: null; attempts: { increment: number }; nextAttemptAt?: Date | null } = { status: def.final ? "done" : "retry", lastOutcome: o.outcome, lockedBy: null, lockedAt: null, attempts: { increment: 1 } };
  if (o.outcome === "callback") data.nextAttemptAt = o.callbackAt || new Date(Date.now() + 24 * 3600_000);
  else if (!def.final) data.nextAttemptAt = new Date(Date.now() + retryGap * 3600_000);
  await db.campaignMember.update({ where: { id: m.id }, data });
  if (o.outcome === "dnc") await emit(ws, "contact.opt_out", { type: "contact", id: m.contactId }, { reason: "Asked not to be called (team call)", source: "opt_out" });
  if (o.outcome === "wrong_number") await db.contact.update({ where: { id: m.contactId }, data: { phone: null, notes: `${m.contact.notes ? `${m.contact.notes}\n` : ""}Wrong number: ${m.contact.phone}` } });
  if (o.outcome === "interested") {
    if (opp && ["NEW", "ELIGIBLE", "OUTREACH"].includes(opp.stage)) await db.opportunity.update({ where: { id: opp.id }, data: { stage: "ENGAGED", assigneeId: opp.assigneeId || userId } });
    await db.contact.update({ where: { id: m.contactId }, data: { assigneeId: m.contact.assigneeId || userId } });
    await createTask(ws, { kind: "follow_up", title: `Follow up: ${m.contact.firstName} is interested`, contactId: m.contactId, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || m.contactId, assignee: userId, priority: 1, dueAt: new Date(Date.now() + 4 * 3600_000), dedupeKey: `interested:${m.contactId}` });
  }
  if (o.outcome === "not_interested" && opp) await db.opportunity.update({ where: { id: opp.id }, data: { exception: "DECLINED" } });
  if (body) await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  await audit(ws, userId, "dialer_outcome", { type: "contact", id: m.contactId }, { meta: { outcome: o.outcome, campaignId: m.campaignId } });
}

export async function skipLead(ws: string, userId: string, memberId: string) {
  await db.campaignMember.updateMany({ where: { id: memberId, lockedBy: userId, campaign: { workspaceId: ws } }, data: { status: "retry", lockedBy: null, lockedAt: null, nextAttemptAt: new Date(Date.now() + 3600_000) } });
}
