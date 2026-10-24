"use server";

import type { ActionState } from "@/components/client";
import { addPause, approvalByToken, DEFAULT_AUTONOMY, getAutonomy, removePause, saveAutonomy, useApprovalLink, type Autonomy } from "@/lib/controls";
import { db } from "@/lib/db";
import { decideApproval } from "@/lib/deals";
import { requireCtx } from "@/lib/session";
import { int, str } from "@/lib/util";
import { act } from "./util";

export async function pauseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("approve", { write: true });
    if (fd.get("remove")) {
      await removePause(c.workspace.id, String(fd.get("pauseId")), c.user.id);
      return { ok: true, message: "Resumed" };
    }
    const scope = String(fd.get("scope") || "all");
    const value = scope === "all" ? null : str(fd.get("value"));
    if (scope !== "all" && !value) throw new Error("Pick what to pause.");
    await addPause(c.workspace.id, scope, scope === "state" ? value!.toUpperCase() : value, str(fd.get("reason")), c.user.id);
    return { ok: true, message: scope === "all" ? "All outreach paused" : "Paused" };
  });
}

export async function autonomyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("approve", { write: true });
    if (c.role !== "owner") throw new Error("Only the owner can change what runs automatically.");
    const a: Autonomy = {
      ...DEFAULT_AUTONOMY,
      ...(await getAutonomy(c.workspace.id)),
      emdAutoUnder: int(fd.get("emdAutoUnder")) ?? 0,
      paymentAutoUnder: int(fd.get("paymentAutoUnder")) ?? 0,
      demandCheck: fd.get("demandCheck") === "ask" ? "ask" : "auto",
      fullMarketing: fd.get("fullMarketing") === "ask" ? "ask" : "auto",
      sendSellerContract: fd.get("sendSellerContract") === "auto" ? "auto" : "manual",
      offerLetter: fd.get("offerLetter") === "ask" ? "ask" : fd.get("offerLetter") === "off" ? "off" : "auto",
      dailySpendCap: int(fd.get("dailySpendCap")) || null,
      approvalTexts: fd.get("approvalTexts") === "on",
    };
    await saveAutonomy(c.workspace.id, a);
    const { audit } = await import("@/lib/audit");
    await audit(c.workspace.id, c.user.id, "autonomy_saved", undefined, { after: a });
    return { ok: true, message: "Saved" };
  });
}

/** Decide an approval from the one-time link sent by text or email (no sign-in needed; the link is the key). */
export async function linkDecisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const r = await approvalByToken(String(fd.get("token") || ""));
    if (!r) throw new Error("This link has expired or was already used. Open the app to decide.");
    if (r.approval.status !== "pending") throw new Error("Already decided.");
    const decision = fd.get("decision") === "approved" ? "approved" : "rejected";
    await decideApproval(r.approval.workspaceId, r.approval.id, decision, r.link.userId, str(fd.get("note")) || "Decided from link", int(fd.get("price")), fd.get("overLock") === "on");
    await useApprovalLink(r.link.id);
    await db.approvalLink.updateMany({ where: { approvalId: r.approval.id, usedAt: null }, data: { usedAt: new Date() } });
    return { ok: true, message: decision === "approved" ? "Approved. You can close this page." : "Rejected. You can close this page." };
  });
}
