"use server";

import type { ActionState } from "@/components/client";
import { requireCtx } from "@/lib/session";
import { getCompliance, saveCompliance } from "@/lib/switches";
import { act } from "./util";

async function ownerOnly() {
  const c = await requireCtx("settings", { write: true });
  if (c.role !== "owner") throw new Error("Only the owner can change these switches.");
  return c;
}

/** AI disclosure, recording notice and owner-location hours, with optional per-state exceptions. */
export async function saveCallingRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await ownerOnly();
    const cur = await getCompliance(c.workspace.id);
    const on = (k: string) => fd.get(k) === "on";
    const states: typeof cur.states = {};
    for (const [k, v] of fd.entries()) {
      const m = /^st_(ai|rec)_([A-Z]{2})$/.exec(k);
      if (!m || (v !== "on" && v !== "off")) continue;
      const st = (states[m[2]] ||= {});
      if (m[1] === "ai") st.aiDisclosure = v === "on";
      else st.recordingNotice = v === "on";
    }
    const changed = await saveCompliance(c.workspace.id, { ...cur, aiDisclosure: on("aiDisclosure"), recordingNotice: on("recordingNotice"), ownerHours: on("ownerHours"), states }, c.user.id);
    return { ok: true, message: Object.keys(changed).length ? "Saved and logged. AI callers pick this up on their next call." : "No changes." };
  });
}

/** Cold outreach mode: owner only, typed confirmation to turn on. */
export async function coldOutreachAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await ownerOnly();
    const cur = await getCompliance(c.workspace.id);
    const turnOn = fd.get("mode") === "on";
    if (turnOn && String(fd.get("confirm") || "").trim().toUpperCase() !== "TURN ON") throw new Error('Type TURN ON to confirm.');
    await saveCompliance(c.workspace.id, { ...cur, coldOutreach: turnOn, ...(turnOn ? { coldConfirmedAt: new Date().toISOString(), coldConfirmedBy: c.user.id } : {}) }, c.user.id);
    return { ok: true, message: turnOn ? "Cold outreach mode is on. Logged." : "Cold outreach mode is off." };
  });
}
