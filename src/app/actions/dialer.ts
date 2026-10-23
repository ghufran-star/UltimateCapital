"use server";

import type { ActionState } from "@/components/client";
import { bridgeCall } from "@/lib/comms";
import { db } from "@/lib/db";
import { nextLead, recordOutcome, skipLead } from "@/lib/dialer";
import { requireCtx } from "@/lib/session";
import { str } from "@/lib/util";
import { act } from "./util";

export async function dialerNextAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const campaignId = String(fd.get("campaignId"));
    const m = await nextLead(c.workspace.id, c.user.id, campaignId);
    return m ? { ok: true } : { ok: true, message: "Nobody is due to be called right now." };
  });
}

export async function dialerCallAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    if (!c.user.phone) throw new Error("Add your mobile in Settings → My profile. We ring you first, then connect the contact.");
    const m = await db.campaignMember.findFirstOrThrow({ where: { id: String(fd.get("memberId")), lockedBy: c.user.id } });
    const opp = m.propertyId ? await db.opportunity.findFirst({ where: { workspaceId: c.workspace.id, propertyId: m.propertyId } }) : null;
    await bridgeCall(c.workspace.id, c.user.phone, m.contactId, c.user.id, { campaignId: m.campaignId, opportunityId: opp?.id });
    return { ok: true, message: "Calling your phone now. Answer it and we connect the contact." };
  });
}

export async function dialerOutcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const memberId = String(fd.get("memberId"));
    const cb = str(fd.get("callbackAt"));
    await recordOutcome(c.workspace.id, c.user.id, memberId, { outcome: String(fd.get("outcome") || ""), note: str(fd.get("note")), callbackAt: cb ? new Date(cb) : null });
    if (fd.get("next") === "1") await nextLead(c.workspace.id, c.user.id, String(fd.get("campaignId")));
    return { ok: true, message: "Saved" };
  });
}

export async function dialerSkipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    await skipLead(c.workspace.id, c.user.id, String(fd.get("memberId")));
    await nextLead(c.workspace.id, c.user.id, String(fd.get("campaignId")));
    return { ok: true };
  });
}
