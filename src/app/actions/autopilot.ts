"use server";

import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { getAutopilot, saveAutopilot, type AutopilotConfig } from "@/lib/autopilot";
import { sendSuggestedReply } from "@/lib/replies";
import { requireCtx } from "@/lib/session";
import { act } from "./util";

export async function autopilotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const cur = await getAutopilot(c.workspace.id);
    const num = (k: string, d: number) => {
      const v = Number(fd.get(k));
      return Number.isFinite(v) && String(fd.get(k) ?? "").trim() !== "" ? Math.max(0, v) : d;
    };
    const next: AutopilotConfig = {
      ...cur,
      on: fd.get("on") === "on",
      steps: cur.steps.map((s) => ({ ...s, on: fd.get(`step_on_${s.id}`) === "on", afterHours: num(`step_h_${s.id}`, s.afterHours) })),
      slas: cur.slas.map((s) => ({ ...s, maxDays: num(`sla_${s.stage}`, s.maxDays) })),
      nurtureDays: num("nurtureDays", cur.nurtureDays),
      nurtureMax: num("nurtureMax", cur.nurtureMax),
      replies: (["off", "draft", "auto"].includes(String(fd.get("replies"))) ? fd.get("replies") : cur.replies) as AutopilotConfig["replies"],
    };
    await saveAutopilot(c.workspace.id, next);
    await audit(c.workspace.id, c.user.id, "autopilot_saved", undefined, { after: next });
    return { ok: true, message: "Saved" };
  });
}

export async function sendReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const text = String(fd.get("text") || "").trim();
    if (!text) throw new Error("Write the reply.");
    const r = await sendSuggestedReply(c.workspace.id, String(fd.get("taskId")), text, c.user.id);
    return { ok: !r.startsWith("Blocked"), message: r, ...(r.startsWith("Blocked") ? { error: r } : {}) };
  });
}
