import { db } from "./db";
import { checkEligibility } from "./eligibility";
import { applyCallOutcome, CALL_OUTCOMES } from "./outcomes";

// Power dialer for the team: one contact at a time, locked to the caller, checked for compliance
// before it's shown, with one-click outcomes that schedule the follow-up.

export const OUTCOMES = CALL_OUTCOMES;

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
  const m = await db.campaignMember.findFirstOrThrow({ where: { id: memberId, lockedBy: userId, campaign: { workspaceId: ws } }, include: { campaign: true } });
  const retryGap = Number(((m.campaign.settings || {}) as { retryGapHours?: number }).retryGapHours || 24);
  const opp = m.propertyId ? await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: m.propertyId } }) : null;
  const r = await applyCallOutcome(ws, userId, { contactId: m.contactId, opportunityId: opp?.id, outcome: o.outcome, note: o.note, callbackAt: o.callbackAt, campaignId: m.campaignId });
  const data: { status: string; lastOutcome: string; lockedBy: null; lockedAt: null; attempts: { increment: number }; nextAttemptAt?: Date | null } = { status: r.final ? "done" : "retry", lastOutcome: o.outcome, lockedBy: null, lockedAt: null, attempts: { increment: 1 } };
  if (o.outcome === "callback") data.nextAttemptAt = o.callbackAt || new Date(Date.now() + 24 * 3600_000);
  else if (!r.final) data.nextAttemptAt = new Date(Date.now() + retryGap * 3600_000);
  await db.campaignMember.update({ where: { id: m.id }, data });
}

export async function skipLead(ws: string, userId: string, memberId: string) {
  await db.campaignMember.updateMany({ where: { id: memberId, lockedBy: userId, campaign: { workspaceId: ws } }, data: { status: "retry", lockedBy: null, lockedAt: null, nextAttemptAt: new Date(Date.now() + 3600_000) } });
}
