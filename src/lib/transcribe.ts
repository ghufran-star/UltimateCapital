import { audit } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { emit } from "./engine";

// Transcription of calls your team makes or logs (AI calls are already transcribed by Retell).
// Off by default because it's paid per minute; switched on in Settings → Integrations.

export async function transcriptionOn(ws: string) {
  const p = (await setting(ws, "TRANSCRIBE_PROVIDER"))?.toLowerCase();
  return (p === "deepgram" || p === "openai") && Boolean(await setting(ws, "TRANSCRIBE_KEY"));
}

async function audioFor(ws: string, url: string): Promise<{ data: Buffer; mime: string }> {
  const m = url.match(/^\/api\/files\/([\w-]+)/);
  if (m) {
    const f = await db.fileObject.findFirstOrThrow({ where: { id: m[1], workspaceId: ws } });
    return { data: Buffer.from(f.data), mime: f.mime };
  }
  const headers: Record<string, string> = {};
  if (/twilio\.com/.test(url)) {
    const sid = await setting(ws, "TWILIO_ACCOUNT_SID");
    const token = await setting(ws, "TWILIO_AUTH_TOKEN");
    if (sid && token) headers.authorization = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  }
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Couldn't download the recording (${r.status}).`);
  return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "audio/mpeg" };
}

/** Speech to text with speaker turns where the provider gives them. */
export async function transcribeAudio(ws: string, data: Buffer, mime: string): Promise<string> {
  const provider = (await setting(ws, "TRANSCRIBE_PROVIDER"))?.toLowerCase();
  const key = await setting(ws, "TRANSCRIBE_KEY");
  if (!key || (provider !== "deepgram" && provider !== "openai")) throw new Error("Transcription is off. Choose a provider and add its key in Settings → Integrations.");
  if (provider === "deepgram") {
    const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&utterances=true&punctuate=true", {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": mime || "audio/mpeg" },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(180_000),
    });
    const j = (await r.json().catch(() => ({}))) as { results?: { utterances?: { speaker: number; transcript: string }[]; channels?: { alternatives?: { transcript?: string }[] }[] }; err_msg?: string };
    if (!r.ok) throw new Error(`Deepgram: ${j.err_msg || r.status}`);
    const u = j.results?.utterances;
    if (u?.length) return u.map((x) => `Speaker ${x.speaker + 1}: ${x.transcript}`).join("\n");
    return j.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  }
  if (data.length > 25 * 1024 * 1024) throw new Error("OpenAI transcribes files up to 25 MB.");
  const fd = new FormData();
  fd.set("model", "gpt-4o-transcribe");
  fd.set("file", new Blob([new Uint8Array(data)], { type: mime || "audio/mpeg" }), `call.${(mime.split("/")[1] || "mp3").replace("mpeg", "mp3")}`);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(180_000) });
  const j = (await r.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(`OpenAI: ${j.error?.message || r.status}`);
  return j.text || "";
}

/** Transcribes a recorded team call, then runs the usual conversation analysis on it. */
export async function transcribeInteraction(ws: string, interactionId: string, actor = "system") {
  const it = await db.interaction.findFirstOrThrow({ where: { id: interactionId, workspaceId: ws } });
  if (!it.recordingUrl) throw new Error("This call has no recording.");
  const { data, mime } = await audioFor(ws, it.recordingUrl);
  const text = (await transcribeAudio(ws, data, mime)).trim();
  if (!text) return "No speech found in the recording.";
  const notes = it.body && !it.body.startsWith("Speaker ") ? `${it.body}\n\n` : "";
  await db.interaction.update({ where: { id: it.id }, data: { body: `${notes}${text}`, processedAt: null } });
  await audit(ws, actor, "call_transcribed", { type: "interaction", id: it.id }, { meta: { chars: text.length } });
  await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  return "Transcribed. The summary and facts will update in a moment.";
}
