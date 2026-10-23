import { NextRequest } from "next/server";
import { notify } from "@/lib/audit";
import { escapeXml } from "@/lib/comms";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { emit } from "@/lib/engine";
import { e164 } from "@/lib/util";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const from = e164(sp.get("from") || params.From) || params.From || "";
  // Forwarded call ended: if nobody answered, take a voicemail.
  if (sp.get("fallback")) {
    if (params.DialCallStatus === "completed") return twiml("<Response/>");
    const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "") || "";
    const company = (await setting(ws, "COMPANY_NAME")) || "our team";
    return twiml(`<Response><Say>Sorry we missed you at ${escapeXml(company)}. Please leave a message.</Say><Record maxLength="120" transcribe="true" transcribeCallback="${base}/api/webhooks/twilio/voicemail?ws=${ws}&amp;from=${encodeURIComponent(from)}"/></Response>`);
  }
  const contact = from ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: from }, { phone2: from }] } }) : null;
  const ref = params.RecordingSid || params.TranscriptionSid || null;
  if (ref && (await db.interaction.findUnique({ where: { providerRef: ref } }))) return new Response(null, { status: 204 });
  const it = await db.interaction.create({
    data: { workspaceId: ws, contactId: contact?.id, channel: "call", direction: "inbound", provider: "twilio", providerRef: ref, fromAddr: from, body: params.TranscriptionText || null, summary: params.TranscriptionText ? `Voicemail: ${params.TranscriptionText.slice(0, 200)}` : "Voicemail", recordingUrl: params.RecordingUrl ? `${params.RecordingUrl}.mp3` : null, outcome: "voicemail" },
  });
  await notify(ws, "New voicemail", `${contact ? `${contact.firstName} ${contact.lastName}` : from}: ${params.TranscriptionText?.slice(0, 120) || "(no transcript)"}`, contact ? `/contacts/${contact.id}` : "/ops");
  if (params.TranscriptionText) await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  return new Response(null, { status: 204 });
}
