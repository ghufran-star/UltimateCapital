"use server";

import type { ActionState } from "@/components/client";
import { syncRetellCalls } from "@/lib/comms";
import { requireCtx } from "@/lib/session";
import { act } from "./util";

export async function syncCallsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const hours = Math.min(24 * 30, Number(fd.get("hours")) || 72);
    return { ok: true, message: await syncRetellCalls(c.workspace.id, hours) };
  });
}

/** Check phone numbers in bulk: "sellers", "buyers", "campaign:<id>" or "contact:<id>". */
export async function checkNumbersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const ws = c.workspace.id;
    const scope = String(fd.get("scope") || "");
    const { db } = await import("@/lib/db");
    const { checkContactNumber, queueNumberChecks, STATUS_LABEL } = await import("@/lib/numbers");
    const paid = fd.get("paid") === "on" ? true : undefined;
    if (scope.startsWith("contact:")) {
      const ct = await db.contact.findFirstOrThrow({ where: { id: scope.slice(8), workspaceId: ws } });
      const s = await checkContactNumber(ws, ct.id, { paid });
      return { ok: true, message: s ? `Number: ${STATUS_LABEL[s] || s}` : "No phone number" };
    }
    let ids: string[] = [];
    if (scope === "sellers" || scope === "buyers") ids = (await db.contact.findMany({ where: { workspaceId: ws, kind: scope === "buyers" ? "buyer" : { not: "buyer" }, phone: { not: null }, doNotContact: false }, select: { id: true } })).map((x) => x.id);
    else if (scope.startsWith("campaign:")) ids = (await db.campaignMember.findMany({ where: { campaignId: scope.slice(9), campaign: { workspaceId: ws } }, select: { contactId: true } })).map((x) => x.contactId);
    if (!ids.length) throw new Error("No numbers to check.");
    const n = await queueNumberChecks(ws, ids, paid);
    return { ok: true, message: `Checking ${n} numbers in the background. Results show on each contact.` };
  });
}
