import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createTask } from "@/lib/engine";
import { transcriptionOn } from "@/lib/transcribe";
import { twilioRequest } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Recording of a click-to-call (human) conversation. */
export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  const it = req.nextUrl.searchParams.get("it");
  if (it && params.RecordingUrl) {
    await db.interaction.updateMany({ where: { id: it, workspaceId: ws }, data: { status: "done", recordingUrl: `${params.RecordingUrl}.mp3`, durationSec: Number(params.RecordingDuration || 0) || null, outcome: "conversation" } });
    // Team calls are only transcribed when transcription is switched on (it's paid per minute).
    if (await transcriptionOn(ws)) await createTask(ws, { kind: "transcribe_call", title: "Transcribe the team call", entityType: "interaction", entityId: it, dueAt: new Date(Date.now() + 30_000), dedupeKey: `transcribe:${it}` });
  }
  return new Response(null, { status: 204 });
}
