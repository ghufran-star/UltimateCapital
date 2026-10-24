"use server";

import { db } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { act } from "./util";

type R = { ok?: boolean; error?: string; message?: string; interactionId?: string };

async function wrap(fn: () => Promise<R>): Promise<R> {
  const r = await act(async () => (await fn()) as never);
  return r as R;
}

/** One tap after a call: what happened. Books the follow-up. */
export async function callOutcomeAction(o: { contactId: string; opportunityId?: string; interactionId?: string; callKey?: string; outcome: string; note?: string; callbackAt?: string; memberId?: string; campaignId?: string }): Promise<R> {
  return wrap(async () => {
    const c = await requireCtx("calls", { write: true });
    const ws = c.workspace.id;
    // From the power dialer: the campaign keeps its own queue, then the next person loads.
    if (o.memberId && o.campaignId) {
      const { nextLead, recordOutcome } = await import("@/lib/dialer");
      await recordOutcome(ws, c.user.id, o.memberId, { outcome: o.outcome, note: o.note, callbackAt: o.callbackAt ? new Date(o.callbackAt) : null });
      await nextLead(ws, c.user.id, o.campaignId).catch(() => null);
      return { ok: true, message: "Saved. Next person loaded." };
    }
    let interactionId = o.interactionId || null;
    if (!interactionId && o.callKey) {
      const it = await db.interaction.findFirst({ where: { workspaceId: ws, intel: { path: ["callKey"], equals: o.callKey } }, select: { id: true } });
      interactionId = it?.id || null;
    }
    const { applyCallOutcome } = await import("@/lib/outcomes");
    const r = await applyCallOutcome(ws, c.user.id, { contactId: o.contactId, opportunityId: o.opportunityId || null, interactionId, outcome: o.outcome, note: o.note, callbackAt: o.callbackAt ? new Date(o.callbackAt) : null });
    return { ok: true, message: `Saved: ${r.label}`, interactionId: r.interactionId };
  });
}

/** Test mode: a pretend call (no sound) that goes through the same steps. */
export async function pretendCallAction(o: { contactId: string; opportunityId?: string; seconds: number }): Promise<R> {
  return wrap(async () => {
    const c = await requireCtx("calls", { write: true });
    if (!c.workspace.isDemo) throw new Error("Pretend calls are only for test mode.");
    const ct = await db.contact.findFirstOrThrow({ where: { id: o.contactId, workspaceId: c.workspace.id } });
    const it = await db.interaction.create({ data: { workspaceId: c.workspace.id, contactId: ct.id, opportunityId: o.opportunityId || null, channel: "call", direction: "outbound", provider: "twilio", status: "done", outcome: "conversation", durationSec: Math.max(5, Math.round(o.seconds)), toAddr: ct.phone, summary: "Pretend call in test mode (no sound).", intel: { human: c.user.id, via: "browser", pretend: true } } });
    await db.contact.update({ where: { id: ct.id }, data: { lastContactAt: new Date() } });
    return { ok: true, interactionId: it.id };
  });
}

/** Fallback when in-app calling isn't set up: we ring your mobile, then connect the contact. */
export async function ringMyPhoneAction(o: { contactId: string; opportunityId?: string }): Promise<R> {
  return wrap(async () => {
    const c = await requireCtx("calls", { write: true });
    if (!c.user.phone) throw new Error("Add your mobile number in Settings → My profile first.");
    const { bridgeCall } = await import("@/lib/comms");
    const id = await bridgeCall(c.workspace.id, c.user.phone, o.contactId, c.user.id, { opportunityId: o.opportunityId });
    return { ok: true, interactionId: id, message: "Calling your phone now. Answer it and we connect them." };
  });
}
