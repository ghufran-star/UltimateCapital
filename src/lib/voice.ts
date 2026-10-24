import { createHmac } from "node:crypto";
import { audit, json } from "./audit";
import { saveSetting, setting } from "./config";
import { db } from "./db";
import { escapeXml, fromNumber } from "./comms";
import { checkEligibility } from "./eligibility";
import { e164, fullName } from "./util";

// In-app calling: you talk through the browser (computer or phone) using Twilio Voice.
// The API key and voice app are created automatically from your Twilio account the first time.

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

async function twilioApi(ws: string, path: string, form: Record<string, string>) {
  const sid = await setting(ws, "TWILIO_ACCOUNT_SID");
  const token = await setting(ws, "TWILIO_AUTH_TOKEN");
  if (!sid || !token) throw new Error("Connect Twilio first (Settings → Connections).");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${String(j.message || "error")}`);
  return j;
}

/** Makes sure the API key and the voice app exist (created once, then reused). */
export async function ensureVoiceApp(ws: string) {
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  if (!base) throw new Error("Set the Public app URL in Settings → Connections first.");
  let key = await setting(ws, "TWILIO_API_KEY");
  let secret = await setting(ws, "TWILIO_API_SECRET");
  if (!key || !secret) {
    const k = await twilioApi(ws, "/Keys.json", { FriendlyName: "UltimateCapital in-app calling" });
    key = String(k.sid);
    secret = String(k.secret);
    await saveSetting(ws, "TWILIO_API_KEY", key);
    await saveSetting(ws, "TWILIO_API_SECRET", secret);
  }
  let app = await setting(ws, "TWILIO_TWIML_APP_SID");
  if (!app) {
    const a = await twilioApi(ws, "/Applications.json", { FriendlyName: "UltimateCapital in-app calling", VoiceUrl: `${base}/api/webhooks/twilio/client?ws=${ws}`, VoiceMethod: "POST" });
    app = String(a.sid);
    await saveSetting(ws, "TWILIO_TWIML_APP_SID", app);
  }
  return { key, secret, app, account: (await setting(ws, "TWILIO_ACCOUNT_SID"))! };
}

/** Short-lived access token for the browser phone (Twilio Voice access token, HS256). */
export async function voiceToken(ws: string, identity: string) {
  const v = await ensureVoiceApp(ws);
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" }));
  const payload = b64u(JSON.stringify({ jti: `${v.key}-${now}`, iss: v.key, sub: v.account, iat: now, nbf: now, exp: now + 3600, grants: { identity, voice: { incoming: { allow: false }, outgoing: { application_sid: v.app } } } }));
  const sig = b64u(createHmac("sha256", v.secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** Twilio asks what to do when the browser places a call: check the rules, then dial the contact (recorded). */
export async function clientCallTwiml(ws: string, p: Record<string, string>) {
  const say = (t: string) => `<Response><Say>${escapeXml(t)}</Say><Hangup/></Response>`;
  const contact = p.contactId ? await db.contact.findFirst({ where: { id: p.contactId, workspaceId: ws } }) : null;
  if (!contact?.phone) return say("This contact has no phone number.");
  const elig = await checkEligibility(ws, contact.id, "human_call");
  if (!elig.ok) return say(`Call not placed. ${elig.reason || "Not allowed right now."}`);
  const { governingState } = await import("./eligibility");
  const from = await fromNumber(ws, await governingState(ws, contact.id));
  if (!from) return say("Add a phone number in Settings first.");
  const userId = String(p.From || "").replace(/^client:/, "");
  const it = await db.interaction.create({
    data: { workspaceId: ws, contactId: contact.id, opportunityId: p.opportunityId || null, channel: "call", direction: "outbound", provider: "twilio", providerRef: p.CallSid || null, status: "in_progress", fromAddr: from.number, toAddr: e164(contact.phone), intel: json({ human: userId, callKey: p.callKey || null, via: "browser" }) },
  });
  await db.contact.update({ where: { id: contact.id }, data: { lastContactAt: new Date() } });
  await audit(ws, userId || "team", "call_started", { type: "contact", id: contact.id }, { meta: { via: "browser" } });
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "") || "";
  return `<Response><Dial callerId="${from.number}" record="record-from-answer-dual" timeout="30" action="${base}/api/webhooks/twilio/client-done?ws=${ws}&amp;it=${it.id}" recordingStatusCallback="${base}/api/webhooks/twilio/recording?ws=${ws}&amp;it=${it.id}"><Number>${e164(contact.phone)}</Number></Dial></Response>`;
}

/** When the dialled call ends: note no-answer / busy / failed (answered calls are finished by the recording). */
export async function clientCallDone(ws: string, interactionId: string, p: Record<string, string>) {
  const st = String(p.DialCallStatus || "");
  const outcome = st === "no-answer" ? "no_answer" : st === "busy" ? "busy" : st === "failed" ? "failed" : st === "canceled" ? "no_answer" : null;
  await db.interaction.updateMany({ where: { id: interactionId, workspaceId: ws }, data: { ...(outcome ? { outcome, status: "done" } : {}), durationSec: Number(p.DialCallDuration || 0) || undefined } });
  return "<Response/>";
}

export const contactLabel = (c: { firstName: string; lastName: string; company: string | null }) => fullName(c) || "this contact";
