import { json } from "./audit";
import { db } from "./db";

// Event-driven task engine. Events describe what happened; handlers turn them into tasks;
// tasks are deduplicated so the same work is never done twice.

export async function emit(ws: string, type: string, entity?: { type: string; id: string }, data?: unknown) {
  await db.event.create({
    data: { workspaceId: ws, type, entityType: entity?.type, entityId: entity?.id, data: data === undefined ? undefined : json(data) },
  });
}

export type NewTask = {
  kind: string;
  title: string;
  reason?: string;
  entityType?: string;
  entityId?: string;
  contactId?: string;
  assignee?: string;
  channel?: string;
  priority?: number;
  dueAt?: Date;
  payload?: unknown;
  cancelIf?: string;
  dedupeKey?: string;
};

/** Creates a task, or refreshes the open one with the same dedupe key instead of duplicating it. */
export async function createTask(ws: string, t: NewTask) {
  if (t.dedupeKey) {
    const open = await db.task.findFirst({ where: { workspaceId: ws, dedupeKey: t.dedupeKey, status: { in: ["open", "running"] } } });
    if (open) {
      return db.task.update({
        where: { id: open.id },
        data: {
          title: t.title,
          reason: t.reason ?? open.reason,
          dueAt: t.dueAt && t.dueAt < open.dueAt ? t.dueAt : open.dueAt,
          payload: t.payload === undefined ? undefined : json(t.payload),
        },
      });
    }
  }
  return db.task.create({
    data: {
      workspaceId: ws,
      kind: t.kind,
      title: t.title,
      reason: t.reason,
      entityType: t.entityType,
      entityId: t.entityId,
      contactId: t.contactId,
      assignee: t.assignee,
      channel: t.channel,
      priority: t.priority ?? 2,
      dueAt: t.dueAt ?? new Date(),
      payload: t.payload === undefined ? undefined : json(t.payload),
      cancelIf: t.cancelIf,
      dedupeKey: t.dedupeKey,
    },
  });
}

export async function cancelTasks(ws: string, where: { contactId?: string; entityId?: string; kinds?: string[] }, why: string) {
  await db.task.updateMany({
    where: {
      workspaceId: ws,
      status: "open",
      ...(where.contactId ? { contactId: where.contactId } : {}),
      ...(where.entityId ? { entityId: where.entityId } : {}),
      ...(where.kinds ? { kind: { in: where.kinds } } : {}),
    },
    data: { status: "cancelled", result: why },
  });
}

/** Tasks the worker runs by itself. Everything else waits for a person (or a phone agent via campaigns). */
export const AUTO_TASKS = new Set([
  "process_interaction",
  "valuation",
  "matching",
  "hot_score",
  "call",
  "sms",
  "email",
  "buyer_outreach",
  "chase_title",
  "verification_pack",
  "demand_campaign",
  "contract_deadline",
  "send_contract",
  "dnc_scrub",
  "number_check",
  "transcribe_call",
  "offer_letter",
  "contract_reminder",
  "ai_reply",
  "photo_repairs",
  "call_qa",
  "bank_sync",
]);

// ---------- Event handlers ----------

export async function handleEvent(e: { id: string; workspaceId: string; type: string; entityType: string | null; entityId: string | null; data: unknown }) {
  const ws = e.workspaceId;
  const d = (e.data || {}) as Record<string, unknown>;
  switch (e.type) {
    case "interaction.created":
      if (e.entityId) {
        await createTask(ws, {
          kind: "process_interaction",
          title: "Read conversation and update records",
          entityType: "interaction",
          entityId: e.entityId,
          dedupeKey: `intel:${e.entityId}`,
        });
        const it = await db.interaction.findUnique({ where: { id: e.entityId }, select: { direction: true, channel: true, contactId: true } });
        if (it?.direction === "inbound" && it.contactId && ["sms", "email"].includes(it.channel)) {
          // Reply after the conversation has been read, so the reply knows what was just learned.
          await createTask(ws, { kind: "ai_reply", title: "Answer the message", entityType: "interaction", entityId: e.entityId, contactId: it.contactId, dueAt: new Date(Date.now() + 90_000), dedupeKey: `aireply:${e.entityId}` });
        }
      }
      break;
    case "contact.opt_out": {
      const { optOut } = await import("./eligibility");
      if (e.entityId) await optOut(ws, e.entityId, String(d.reason || "Asked not to be contacted"), String(d.source || "opt_out"));
      break;
    }
    case "property.changed":
    case "opportunity.facts_changed":
      if (e.entityId) {
        const opps =
          e.entityType === "property"
            ? await db.opportunity.findMany({ where: { workspaceId: ws, propertyId: e.entityId, stage: { notIn: ["CLOSED"] } } })
            : [{ id: e.entityId }];
        for (const o of opps) {
          await createTask(ws, {
            kind: "valuation",
            title: "Recalculate valuation",
            reason: "Property or deal details changed",
            entityType: "opportunity",
            entityId: o.id,
            dedupeKey: `valuation:${o.id}`,
            dueAt: new Date(Date.now() + 60_000),
          });
        }
      }
      break;
    case "opportunity.valued":
    case "buybox.changed":
      if (e.type === "buybox.changed") {
        const open = await db.opportunity.findMany({
          where: { workspaceId: ws, stage: { in: ["NEGOTIATION", "CONTRACT_PREPARATION", "UNDER_CONTRACT", "DISPOSITION", "OFFER_READY"] } },
          select: { id: true },
        });
        for (const o of open) await createTask(ws, { kind: "matching", title: "Re-run buyer matching", entityType: "opportunity", entityId: o.id, dedupeKey: `matching:${o.id}` });
      } else if (e.entityId) {
        await createTask(ws, { kind: "matching", title: "Match buyers", entityType: "opportunity", entityId: e.entityId, dedupeKey: `matching:${e.entityId}` });
      }
      break;
    case "opportunity.seller_moved":
      if (e.entityId) {
        const { checkNearAgreement } = await import("./deals");
        await checkNearAgreement(ws, e.entityId);
      }
      break;
    case "interest.updated":
      if (e.entityId) await createTask(ws, { kind: "hot_score", title: "Update hot-deal score", entityType: "opportunity", entityId: e.entityId, dedupeKey: `hot:${e.entityId}` });
      break;
    case "contract.effective":
      if (e.entityId) {
        const { onContractEffective } = await import("./contracts");
        await onContractEffective(ws, e.entityId);
      }
      break;
    case "contract.ended":
      if (e.entityId) {
        await db.campaign.updateMany({ where: { workspaceId: ws, opportunityId: e.entityId, status: "running" }, data: { status: "paused" } });
        await cancelTasks(ws, { entityId: e.entityId, kinds: ["buyer_outreach", "demand_campaign"] }, "Contract ended: disposition stopped");
      }
      break;
  }
}

export async function runEvents(limit = 25) {
  const events = await db.event.findMany({ where: { handledAt: null, workspace: { isDemo: false } }, orderBy: { createdAt: "asc" }, take: limit });
  for (const e of events) {
    try {
      await handleEvent(e);
      await db.event.update({ where: { id: e.id }, data: { handledAt: new Date() } });
    } catch (err) {
      console.error("[event]", e.type, err);
      await db.event.update({ where: { id: e.id }, data: { handledAt: new Date(), error: String(err).slice(0, 500) } });
      await (await import("./digest")).alertFailure(e.workspaceId, `Automation error: ${e.type}`, String(err)).catch(() => null);
    }
  }
  return events.length;
}

// ---------- Task execution ----------

export async function executeTask(t: { id: string; workspaceId: string; kind: string; title: string; entityType: string | null; entityId: string | null; contactId: string | null; payload: unknown; attempts: number }) {
  const ws = t.workspaceId;
  const p = (t.payload || {}) as Record<string, unknown>;
  switch (t.kind) {
    case "process_interaction":
      return (await import("./intel")).processInteraction(ws, t.entityId!);
    case "valuation":
      return (await import("./valuation")).runValuation(ws, t.entityId!, { actor: "system" });
    case "matching":
      return (await import("./matching")).runMatching(ws, t.entityId!);
    case "hot_score":
      return (await import("./matching")).updateHotScore(ws, t.entityId!);
    case "verification_pack":
      return (await import("./deals")).sendVerificationPack(ws, t.entityId!);
    case "demand_campaign":
      return (await import("./matching")).startDemandCampaign(ws, t.entityId!, String(p.mode || "anonymous"));
    case "buyer_outreach":
      return (await import("./matching")).outreachToBuyer(ws, t.entityId!, t.contactId!, String(p.mode || "anonymous"), Number(p.step || 1), Boolean(p.manual));
    case "call": {
      const r = await (await import("./comms")).placeCall(ws, { contactId: t.contactId!, agentRole: String(p.agentRole || "seller_acquisition"), opportunityId: (p.opportunityId as string) || undefined, campaignId: (p.campaignId as string) || undefined, memberId: (p.memberId as string) || undefined });
      // Autopilot steps the AI may not do (e.g. no AI-voice consent) go to a person instead of being dropped.
      if (p.fallbackToTeam && r.startsWith("Blocked") && !/do not contact|opted out|litigator|invalid|suppress/i.test(r)) {
        const opp = p.opportunityId ? await db.opportunity.findUnique({ where: { id: String(p.opportunityId) } }) : null;
        await createTask(ws, { kind: "follow_up", title: `${t.title.replace(/^Autopilot: /, "")} (call by a person)`, reason: r, contactId: t.contactId!, entityType: t.entityType || undefined, entityId: t.entityId || undefined, assignee: opp?.assigneeId || undefined, priority: 1, dedupeKey: `team:${t.id}` });
        return `${r} → handed to the team`;
      }
      return r;
    }
    case "sms": {
      const r = await (await import("./comms")).sendSms(ws, { contactId: t.contactId!, body: String(p.body || ""), opportunityId: (p.opportunityId as string) || undefined, memberId: (p.memberId as string) || undefined, campaignId: (p.campaignId as string) || undefined });
      if (p.memberId && !r.startsWith("Rescheduled")) {
        const blocked = r.startsWith("Blocked");
        await db.campaignMember.update({ where: { id: String(p.memberId) }, data: blocked ? { status: "blocked", blockedReason: r.slice(9, 200) } : { lastOutcome: r.startsWith("Rescheduled") ? "rescheduled" : "texted" } }).catch(() => null);
      }
      return r;
    }
    case "email":
      return (await import("./comms")).sendEmail(ws, { to: String(p.to || ""), contactId: t.contactId || undefined, subject: String(p.subject || ""), text: String(p.text || ""), opportunityId: (p.opportunityId as string) || undefined });
    case "chase_title":
      return (await import("./title")).chaseTitle(ws, t.entityId!);
    case "contract_deadline":
      return (await import("./contracts")).deadlineReminder(ws, t.entityId!, String(p.which || ""));
    case "send_contract":
      return (await import("./contracts")).sendForSignature(ws, t.entityId!, "system");
    case "call_qa":
      return (await import("./qa")).reviewCall(ws, t.entityId!);
    case "bank_sync":
      return (await import("./bank")).syncBank(ws);
    case "photo_repairs":
      return (await import("./photos")).repairsFromPhotos(ws, t.entityId!);
    case "ai_reply":
      return (await import("./replies")).replyToInbound(ws, t.entityId!);
    case "contract_reminder":
      return (await import("./contracts")).signingReminder(ws, t.entityId!);
    case "number_check":
      return (await import("./numbers")).checkNumbers(ws, ((p.contactIds as string[]) || []).slice(0, 500), { paid: p.paid === undefined ? undefined : Boolean(p.paid) });
    case "offer_letter":
      return (await import("./offerletter")).letterAfterVerbal(ws, t.entityId!, Number(p.price), String(p.interactionId || ""));
    case "transcribe_call":
      return (await import("./transcribe")).transcribeInteraction(ws, t.entityId!);
    case "dnc_scrub":
      return (await import("./dnc")).scrubContacts(ws, ((p.contactIds as string[]) || []).slice(0, 500));
  }
  return "nothing to do";
}

export async function runTasks(limit = 10) {
  await db.task.updateMany({ where: { status: "running", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "open" } });
  const due = await db.task.findMany({
    where: { status: "open", dueAt: { lte: new Date() }, kind: { in: [...AUTO_TASKS] }, workspace: { isDemo: false } },
    orderBy: [{ priority: "asc" }, { dueAt: "asc" }],
    take: limit,
  });
  let n = 0;
  const CONTACT_KINDS = ["call", "sms", "email", "buyer_outreach", "demand_campaign"];
  for (const t of due) {
    // A deal with autopilot off gets no automatic contact; the task waits for someone to run it.
    if (CONTACT_KINDS.includes(t.kind) && t.entityType === "opportunity" && t.entityId) {
      const o = await db.opportunity.findUnique({ where: { id: t.entityId }, select: { autopilotOff: true } });
      if (o?.autopilotOff) {
        await db.task.update({ where: { id: t.id }, data: { dueAt: new Date(Date.now() + 864e5), result: "Waiting: autopilot is off for this deal. Run it yourself from the task list." } });
        continue;
      }
    }
    const claimed = await db.task.updateMany({ where: { id: t.id, status: "open" }, data: { status: "running", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    n++;
    try {
      const result = await executeTask(t);
      await db.task.update({ where: { id: t.id }, data: { status: "done", result: typeof result === "string" ? result.slice(0, 500) : "done" } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retry = t.attempts + 1 < 3 && !/not allowed|blocked|suppressed|no .* key|not set/i.test(msg);
      await db.task.update({
        where: { id: t.id },
        data: { status: retry ? "open" : "failed", result: msg.slice(0, 500), dueAt: retry ? new Date(Date.now() + 5 * 60_000 * (t.attempts + 1)) : undefined },
      });
      if (!retry) await (await import("./digest")).alertFailure(t.workspaceId, `Task failed: ${t.title}`, msg, t.entityType === "opportunity" && t.entityId ? `/deals/${t.entityId}` : "/ops?tab=tasks").catch(() => null);
    }
  }
  return n;
}
