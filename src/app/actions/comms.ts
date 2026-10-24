"use server";

import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { createTask, emit } from "@/lib/engine";
import { saveFile } from "@/lib/files";
import { requireCtx } from "@/lib/session";
import { str } from "@/lib/util";
import { act } from "./util";

/** A call made outside the app (your own phone), logged by hand. Recording optional. */
export async function logCallAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const ws = c.workspace.id;
    const contactId = str(fd.get("contactId"));
    if (!contactId) throw new Error("Choose who the call was with.");
    await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: ws } });
    const opportunityId = str(fd.get("opportunityId"));
    if (opportunityId) await db.opportunity.findFirstOrThrow({ where: { id: opportunityId, workspaceId: ws } });
    const notes = str(fd.get("notes"));
    const minutes = Number(fd.get("minutes")) || 0;
    const when = str(fd.get("when"));
    const at = when ? new Date(when) : new Date();
    const f = fd.get("audio");
    const audio = f && typeof f === "object" && "arrayBuffer" in f && f.size ? f : null;
    if (audio && !/^audio\/|^video\/(mp4|webm|quicktime)/.test(audio.type)) throw new Error("The recording must be an audio file (mp3, m4a, wav…).");
    const it = await db.interaction.create({
      data: {
        workspaceId: ws,
        contactId,
        opportunityId,
        channel: "call",
        direction: fd.get("direction") === "inbound" ? "inbound" : "outbound",
        provider: "manual",
        status: "done",
        outcome: str(fd.get("outcome")),
        durationSec: minutes ? Math.round(minutes * 60) : null,
        body: notes ? `Caller notes: ${notes}` : null,
        summary: notes?.slice(0, 200) || null,
        createdAt: isNaN(at.getTime()) ? new Date() : at,
        intel: { human: c.user.id, loggedBy: c.user.name },
      },
    });
    if (audio) {
      const file = await saveFile(ws, { entityType: "interaction", entityId: it.id, kind: "recording", name: audio.name || "call-recording", mime: audio.type, data: Buffer.from(await audio.arrayBuffer()), uploadedBy: c.user.id });
      await db.interaction.update({ where: { id: it.id }, data: { recordingUrl: `/api/files/${file.id}` } });
    }
    await db.contact.update({ where: { id: contactId }, data: { lastContactAt: new Date() } });
    await audit(ws, c.user.id, "call_logged", { type: "contact", id: contactId }, { meta: { interaction: it.id, recording: Boolean(audio) } });
    let msg = "Call logged";
    if (audio && fd.get("transcribe") === "on") {
      const { transcriptionOn } = await import("@/lib/transcribe");
      if (await transcriptionOn(ws)) {
        await createTask(ws, { kind: "transcribe_call", title: "Transcribe the logged call", entityType: "interaction", entityId: it.id, dueAt: new Date(), dedupeKey: `transcribe:${it.id}` });
        msg += " · transcribing";
      } else msg += " · transcription is off, so the recording is kept without a transcript";
    } else if (notes && fd.get("analyse") === "on") {
      await emit(ws, "interaction.created", { type: "interaction", id: it.id });
      msg += " · AI is reading your notes";
    }
    return { ok: true, message: msg };
  });
}

/** Transcribe one recorded team call on request. */
export async function transcribeCallAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const it = await db.interaction.findFirstOrThrow({ where: { id: String(fd.get("interactionId")), workspaceId: c.workspace.id } });
    const { transcriptionOn } = await import("@/lib/transcribe");
    if (!(await transcriptionOn(c.workspace.id))) throw new Error("Transcription is off. Turn it on in Settings → Integrations (Transcribe team calls).");
    await createTask(c.workspace.id, { kind: "transcribe_call", title: "Transcribe the team call", entityType: "interaction", entityId: it.id, dueAt: new Date(), dedupeKey: `transcribe:${it.id}` });
    return { ok: true, message: "Transcribing…" };
  });
}
