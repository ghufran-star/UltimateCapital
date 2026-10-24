import { createHmac, timingSafeEqual } from "node:crypto";
import { audit, json, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { checkEligibility } from "./eligibility";
import { createTask, emit } from "./engine";
import { e164, fullName } from "./util";

// Calls (Retell AI + Twilio human bridge), texts (Twilio) and email (Resend).
// Every send goes through checkEligibility first and is logged as an Interaction.

// ---------------------------------------------------------------- Retell

export async function retell(ws: string, method: string, path: string, body?: unknown) {
  const key = await setting(ws, "RETELL_API_KEY");
  if (!key) throw new Error("No Retell API key set. Add it in Settings → Integrations.");
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data as { error_message?: string; message?: string };
    throw new Error(`Retell ${res.status}: ${d?.error_message || d?.message || text.slice(0, 200)}`);
  }
  return data as Record<string, unknown>;
}

/** x-retell-signature = "v=<ms>,d=<hex HMAC-SHA256(apiKey, rawBody + ms)>" */
export async function verifyRetell(ws: string, raw: string, header: string | null) {
  const key = await setting(ws, "RETELL_API_KEY");
  const m = /v=(\d+),d=([0-9a-f]+)/i.exec(header || "");
  if (!key || !m) return false;
  if (Math.abs(Date.now() - Number(m[1])) > 5 * 60_000) return false;
  const expected = createHmac("sha256", key).update(raw + m[1]).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(m[2].toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function fromNumber(ws: string, state?: string | null) {
  const nums = await db.phoneNumber.findMany({ where: { workspaceId: ws } });
  return (state && nums.find((n) => n.state === state)) || nums[0] || null;
}

/** The demo workspace never contacts anyone, whatever keys are configured. */
/** The demo only contacts people through the stand-ins (demo work). Anything else touching a demo record is stopped. */
async function demoGuard(ws: string) {
  const { inDemo } = await import("./democtx");
  if (inDemo()) return false;
  const w = await db.workspace.findUnique({ where: { id: ws }, select: { isDemo: true } });
  return !!w?.isDemo;
}

export async function placeCall(
  ws: string,
  o: { contactId: string; agentRole: string; opportunityId?: string; campaignId?: string; memberId?: string }
) {
  if (await demoGuard(ws)) return "Blocked: demo workspace never places calls";
  const elig = await checkEligibility(ws, o.contactId, "ai_call");
  if (!elig.ok) {
    if (elig.retryAt && o.memberId) {
      // Campaign calls are re-queued on the member itself, so the dialer stays the only place a call is scheduled.
      await db.campaignMember.update({ where: { id: o.memberId }, data: { status: "retry", nextAttemptAt: elig.retryAt, lastOutcome: "rescheduled" } }).catch(() => null);
      return `Rescheduled: ${elig.reason}`;
    }
    if (elig.retryAt) {
      await createTask(ws, {
        kind: "call",
        title: "Call (rescheduled to permitted hours)",
        contactId: o.contactId,
        dueAt: elig.retryAt,
        payload: o,
        dedupeKey: `call:${o.contactId}:${o.agentRole}`,
      });
      return `Rescheduled: ${elig.reason}`;
    }
    if (o.memberId) await db.campaignMember.update({ where: { id: o.memberId }, data: { status: "blocked", blockedReason: elig.reason } }).catch(() => null);
    await audit(ws, "system", "call_blocked", { type: "contact", id: o.contactId }, { meta: { reason: elig.reason } });
    return `Blocked: ${elig.reason}`;
  }
  const rolePause = await (await import("./controls")).pauseReason(ws, { role: o.agentRole });
  if (rolePause) {
    if (o.memberId) await db.campaignMember.update({ where: { id: o.memberId }, data: { status: "retry", nextAttemptAt: new Date(Date.now() + 30 * 60_000), lastOutcome: "paused" } }).catch(() => null);
    return `Rescheduled: ${rolePause}`;
  }
  const contact = await db.contact.findUniqueOrThrow({ where: { id: o.contactId } });
  const { agentForRole, buildDynamicVariables, syncAgent } = await import("./agents");
  const agent = await agentForRole(ws, o.agentRole);
  if (!agent) throw new Error(`No active agent for role ${o.agentRole}. Set one up in Settings → Agents.`);
  const retellAgentId = agent.retellAgentId || (await syncAgent(ws, agent.id));
  const state = (await import("./eligibility")).governingState;
  const from = await fromNumber(ws, await state(ws, o.contactId));
  if (!from) throw new Error("No phone number set up. Add one in Settings → Phone numbers.");
  const vars = await buildDynamicVariables(ws, { contactId: o.contactId, opportunityId: o.opportunityId, agentId: agent.id, pack: elig.pack });

  const it = await db.interaction.create({
    data: {
      workspaceId: ws,
      contactId: o.contactId,
      opportunityId: o.opportunityId,
      campaignId: o.campaignId,
      channel: "call",
      direction: "outbound",
      provider: "retell",
      status: "queued",
      fromAddr: from.number,
      toAddr: e164(contact.phone),
      intel: json({ agentRole: o.agentRole, memberId: o.memberId }),
      agentRole: o.agentRole,
    },
  });
  const r = await retell(ws, "POST", "/v2/create-phone-call", {
    from_number: from.number,
    to_number: e164(contact.phone),
    override_agent_id: retellAgentId,
    retell_llm_dynamic_variables: vars,
    metadata: { ws, interactionId: it.id, contactId: o.contactId, opportunityId: o.opportunityId || "", campaignId: o.campaignId || "", memberId: o.memberId || "", agentRole: o.agentRole },
  });
  await db.interaction.update({ where: { id: it.id }, data: { providerRef: String(r.call_id), status: "in_progress" } });
  await db.contact.update({ where: { id: o.contactId }, data: { lastContactAt: new Date() } });
  if (o.memberId) await db.campaignMember.update({ where: { id: o.memberId }, data: { status: "in_progress", attempts: { increment: 1 } } }).catch(() => null);
  return `Calling ${fullName(contact)}`;
}

/** Retell webhook: call_started / call_ended / call_analyzed (outbound and inbound). */
export async function onRetellEvent(ws: string, event: string, call: Record<string, unknown>) {
  const meta = (call.metadata || {}) as Record<string, string>;
  const callId = String(call.call_id || "");
  let it = await db.interaction.findUnique({ where: { providerRef: callId } });
  if (!it && (call.direction === "inbound" || event === "sync")) {
    // Inbound calls, and calls found by the Retell sync that never reached our webhook.
    const inbound = call.direction !== "outbound";
    const other = e164(String((inbound ? call.from_number : call.to_number) || ""));
    const contact = meta.contactId ? await db.contact.findUnique({ where: { id: meta.contactId } }) : other ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: other }, { phone2: other }] } }) : null;
    it = await db.interaction.create({
      data: {
        workspaceId: ws,
        contactId: contact?.id,
        opportunityId: meta.opportunityId || null,
        campaignId: meta.campaignId || null,
        channel: "call",
        direction: inbound ? "inbound" : "outbound",
        provider: "retell",
        providerRef: callId,
        status: "in_progress",
        fromAddr: e164(String(call.from_number || "")),
        toAddr: e164(String(call.to_number || "")),
        agentRole: meta.agentRole || (inbound ? "receptionist" : null),
        createdAt: call.start_timestamp ? new Date(Number(call.start_timestamp)) : undefined,
      },
    });
  }
  if (!it) return;
  if (event === "call_started") {
    await db.interaction.update({ where: { id: it.id }, data: { status: "in_progress" } });
    return;
  }
  const analysis = (call.call_analysis || {}) as Record<string, unknown>;
  const transcript = String(call.transcript || "");
  const reason = String(call.disconnection_reason || "");
  const outcome =
    reason === "dial_no_answer" ? "no_answer" : reason === "voicemail_reached" ? "voicemail" : reason === "user_requested_dnc" ? "dnc" : reason === "dial_busy" ? "busy" : reason.startsWith("error") || reason === "dial_failed" ? "failed" : "conversation";
  const start = Number(call.start_timestamp || 0);
  const end = Number(call.end_timestamp || 0);
  const steps = (call.transcript_with_tool_calls || []) as { role?: string; name?: string }[];
  const tools = [...new Set(steps.filter((x) => x.role === "tool_call_invocation" && x.name).map((x) => String(x.name)))];
  const agentRole = meta.agentRole || it.agentRole || (call.agent_id ? (await db.agent.findFirst({ where: { workspaceId: ws, retellAgentId: String(call.agent_id) }, select: { role: true } }))?.role : null) || (it.direction === "inbound" ? "receptionist" : null);
  await db.interaction.update({
    where: { id: it.id },
    data: {
      agentRole,
      tools: tools.length ? tools : it.tools,
      transferred: it.transferred || /transfer/i.test(reason) || tools.includes("transfer_to_human"),
      endReason: reason || it.endReason,
      status: "done",
      body: transcript || it.body,
      recordingUrl: (call.recording_url as string) || it.recordingUrl,
      durationSec: start && end ? Math.round((end - start) / 1000) : it.durationSec,
      outcome,
      summary: (analysis.call_summary as string) || it.summary,
    },
  });
  if (it.contactId && ["invalid_destination", "dial_failed"].includes(reason)) await db.contact.update({ where: { id: it.contactId }, data: { phoneStatus: reason === "invalid_destination" ? "invalid" : "disconnected", phoneCheckedAt: new Date() } }).catch(() => null);
  if (meta.memberId) {
    const done = outcome === "conversation";
    await db.campaignMember
      .update({ where: { id: meta.memberId }, data: { status: done ? "done" : "retry", lastOutcome: outcome } })
      .catch(() => null);
  }
  if (outcome === "dnc" && it.contactId) await emit(ws, "contact.opt_out", { type: "contact", id: it.contactId }, { reason: "Asked not to be called (on call)", source: "opt_out" });
  // Only analyse once per call: when analysis arrives, or on call_ended if there's a transcript.
  if ((event === "call_analyzed" || (event === "call_ended" && transcript)) && transcript && !it.processedAt) {
    await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  }
}

/** Pulls recent calls from Retell and fills in any the webhook missed (or that are still incomplete). */
export async function syncRetellCalls(ws: string, hours = 48) {
  if (!(await setting(ws, "RETELL_API_KEY"))) return "Retell not connected";
  let added = 0;
  let updated = 0;
  let key: string | undefined;
  for (let page = 0; page < 10; page++) {
    const body: Record<string, unknown> = { filter_criteria: { start_timestamp: { lower_threshold: Date.now() - hours * 3600_000 } }, sort_order: "descending", limit: 200 };
    if (key) body.pagination_key = key;
    const list = (await retell(ws, "POST", "/v2/list-calls", body)) as unknown as Record<string, unknown>[];
    if (!Array.isArray(list) || !list.length) break;
    for (const call of list) {
      const id = String(call.call_id || "");
      if (!id || ["registered", "ongoing"].includes(String(call.call_status))) continue;
      const it = await db.interaction.findUnique({ where: { providerRef: id } });
      if (it && it.status === "done" && it.body) continue;
      await onRetellEvent(ws, it ? "call_analyzed" : "sync", call);
      if (it) updated++;
      else added++;
    }
    if (list.length < 200) break;
    key = String(list[list.length - 1].call_id);
  }
  if (added || updated) await audit(ws, "system", "retell_sync", undefined, { meta: { added, updated } });
  return `Retell sync: ${added} missing calls added, ${updated} completed`;
}

// ---------------------------------------------------------------- Twilio

async function twilio(ws: string, path: string, form?: Record<string, string>) {
  const sid = await setting(ws, "TWILIO_ACCOUNT_SID");
  const token = await setting(ws, "TWILIO_AUTH_TOKEN");
  if (!sid || !token) throw new Error("Twilio isn't connected. Add the Account SID and Auth Token in Settings → Integrations.");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: form ? "POST" : "GET",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${String(data.message || "error")}`);
  return data;
}

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted params)). */
export async function verifyTwilio(ws: string, url: string, params: Record<string, string>, signature: string | null) {
  const token = await setting(ws, "TWILIO_AUTH_TOKEN");
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendSms(ws: string, o: { contactId: string; body: string; opportunityId?: string; skipChecks?: boolean; memberId?: string; campaignId?: string }) {
  if (await demoGuard(ws)) return "Blocked: demo workspace never sends texts";
  if (!o.body.trim()) return "Empty message";
  const elig = o.skipChecks ? { ok: true as const } : await checkEligibility(ws, o.contactId, "sms");
  if (!elig.ok) {
    if ("retryAt" in elig && elig.retryAt && o.memberId) {
      await db.campaignMember.update({ where: { id: o.memberId }, data: { status: "retry", nextAttemptAt: elig.retryAt, lastOutcome: "rescheduled", attempts: { decrement: 1 } } }).catch(() => null);
      return `Rescheduled: ${elig.reason}`;
    }
    if ("retryAt" in elig && elig.retryAt) {
      await createTask(ws, { kind: "sms", title: "Text (rescheduled to permitted hours)", contactId: o.contactId, dueAt: elig.retryAt, payload: o });
      return `Rescheduled: ${elig.reason}`;
    }
    return `Blocked: ${"reason" in elig ? elig.reason : ""}`;
  }
  const contact = await db.contact.findUniqueOrThrow({ where: { id: o.contactId } });
  const { governingState } = await import("./eligibility");
  const from = await fromNumber(ws, await governingState(ws, o.contactId));
  if (!from) throw new Error("No phone number set up. Add one in Settings → Phone numbers.");
  const to = e164(contact.phone)!;
  const base = await setting(ws, "PUBLIC_URL");
  // First text to a person carries the opt-out instruction (carrier and TCPA expectation).
  const textedBefore = await db.interaction.count({ where: { workspaceId: ws, contactId: o.contactId, channel: "sms", direction: "outbound" } });
  const body = !textedBefore && !/\bstop\b/i.test(o.body) ? `${o.body.trim()} Reply STOP to opt out.` : o.body;
  const r = await twilio(ws, "/Messages.json", {
    To: to,
    From: from.number,
    Body: body,
    ...(base ? { StatusCallback: `${base.replace(/\/$/, "")}/api/webhooks/twilio/status?ws=${ws}` } : {}),
  });
  await db.interaction.create({
    data: { workspaceId: ws, contactId: o.contactId, opportunityId: o.opportunityId, campaignId: o.campaignId, channel: "sms", direction: "outbound", provider: "twilio", providerRef: String(r.sid), fromAddr: from.number, toAddr: to, body },
  });
  await db.contact.update({ where: { id: o.contactId }, data: { lastContactAt: new Date() } });
  return `Texted ${fullName(contact)}`;
}

/** Internal text to a team member's own phone (approval links, alerts). Not outreach: no contact record, no campaign. */
export async function sendOwnerSms(ws: string, phone: string, body: string) {
  const to = e164(phone);
  if (!to) return "No valid phone";
  const from = await fromNumber(ws, null);
  if (!from) return "No phone number set up";
  await twilio(ws, "/Messages.json", { To: to, From: from.number, Body: body });
  return "Sent";
}

const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|remove me|do not (call|text)|don'?t (call|text))\b/i;

export async function onInboundSms(ws: string, p: { From: string; To: string; Body: string; MessageSid: string; media?: { url: string; type: string }[] }) {
  const from = e164(p.From);
  const contact = from ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: from }, { phone2: from }] } }) : null;
  const it = await db.interaction.create({
    data: { workspaceId: ws, contactId: contact?.id, channel: "sms", direction: "inbound", provider: "twilio", providerRef: p.MessageSid, fromAddr: from, toAddr: p.To, body: p.Body || (p.media?.length ? `[${p.media.length} photo${p.media.length > 1 ? "s" : ""}]` : "") },
  });
  if (contact && p.media?.length) await saveInboundMedia(ws, contact.id, p.media).catch((e) => console.error("[mms]", e));
  if (contact && STOP_WORDS.test(p.Body)) {
    await emit(ws, "contact.opt_out", { type: "contact", id: contact.id }, { reason: `Texted "${p.Body.slice(0, 40)}"`, source: "opt_out" });
    return;
  }
  if (contact) {
    await db.contact.update({ where: { id: contact.id }, data: { lastContactAt: new Date() } });
    await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  }
}

/** Photos and files texted in (MMS): saved on the person's latest deal (or their record), and repairs re-estimated. */
async function saveInboundMedia(ws: string, contactId: string, media: { url: string; type: string }[]) {
  const sid = await setting(ws, "TWILIO_ACCOUNT_SID");
  const token = await setting(ws, "TWILIO_AUTH_TOKEN");
  const deal = await db.opportunity.findFirst({ where: { workspaceId: ws, sellerId: contactId }, orderBy: { updatedAt: "desc" } });
  const { saveFile } = await import("./files");
  let photos = 0;
  for (const [i, m] of media.slice(0, 10).entries()) {
    const res = await fetch(m.url, { headers: sid && token ? { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") } : {}, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) continue;
    const data = Buffer.from(await res.arrayBuffer());
    const ext = (m.type.split("/")[1] || "bin").replace("jpeg", "jpg");
    const isImage = m.type.startsWith("image/");
    if (isImage) photos++;
    await saveFile(ws, { entityType: deal ? "opportunity" : "contact", entityId: deal?.id || contactId, kind: isImage ? "photo" : "other", name: `texted-${new Date().toISOString().slice(0, 10)}-${i + 1}.${ext}`, mime: m.type, data, uploadedBy: `contact:${contactId}`, note: "Texted in by the seller" });
  }
  if (deal && photos) await createTask(ws, { kind: "photo_repairs", title: "Estimate repairs from the photos the seller texted", entityType: "opportunity", entityId: deal.id, dueAt: new Date(Date.now() + 60_000), dedupeKey: `photos:${deal.id}` });
  if (photos) await notify(ws, "Photos received", `${photos} photo${photos > 1 ? "s" : ""} texted in${deal ? " and added to the deal" : ""}.`, deal ? `/deals/${deal.id}?tab=files` : `/contacts/${contactId}`);
}

/** Human call: Twilio rings the team member's phone first, then connects the contact. Recorded. */
export async function bridgeCall(ws: string, userPhone: string, contactId: string, actor: string, opts: { campaignId?: string; opportunityId?: string } = {}) {
  if (await demoGuard(ws)) throw new Error("The demo workspace never places calls.");
  const elig = await checkEligibility(ws, contactId, "human_call");
  if (!elig.ok) throw new Error(elig.reason);
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const { governingState } = await import("./eligibility");
  const from = await fromNumber(ws, await governingState(ws, contactId));
  if (!from) throw new Error("No phone number set up.");
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  const it = await db.interaction.create({
    data: { workspaceId: ws, contactId, campaignId: opts.campaignId, opportunityId: opts.opportunityId, channel: "call", direction: "outbound", provider: "twilio", status: "in_progress", fromAddr: from.number, toAddr: e164(contact.phone), intel: json({ human: actor }) },
  });
  const twiml = `<Response><Say>Connecting you to ${escapeXml(fullName(contact))}.</Say><Dial callerId="${from.number}" record="record-from-answer-dual"${
    base ? ` recordingStatusCallback="${base}/api/webhooks/twilio/recording?ws=${ws}&amp;it=${it.id}"` : ""
  }><Number>${e164(contact.phone)}</Number></Dial></Response>`;
  const r = await twilio(ws, "/Calls.json", { To: e164(userPhone)!, From: from.number, Twiml: twiml });
  await db.interaction.update({ where: { id: it.id }, data: { providerRef: String(r.sid) } });
  await audit(ws, actor, "call_started", { type: "contact", id: contactId });
  return it.id;
}

export function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Inbound call to a Twilio number (numbers not answered by Retell): forward or voicemail. */
export async function inboundVoiceTwiml(ws: string, to: string, from: string) {
  const num = await db.phoneNumber.findFirst({ where: { workspaceId: ws, number: e164(to) || to } });
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "") || "";
  const company = (await setting(ws, "COMPANY_NAME")) || "our team";
  if (num?.inboundMode === "forward" && num.forwardUserId) {
    const u = await db.user.findUnique({ where: { id: num.forwardUserId } });
    if (u?.phone) {
      return `<Response><Dial timeout="20" record="record-from-answer-dual" action="${base}/api/webhooks/twilio/voicemail?ws=${ws}&amp;from=${encodeURIComponent(from)}&amp;fallback=1"><Number>${e164(u.phone)}</Number></Dial></Response>`;
    }
  }
  return `<Response><Say>Thanks for calling ${escapeXml(company)}. Please leave your name, the property address and the best time to reach you.</Say><Record maxLength="120" transcribe="true" transcribeCallback="${base}/api/webhooks/twilio/voicemail?ws=${ws}&amp;from=${encodeURIComponent(from)}"/></Response>`;
}

// ---------------------------------------------------------------- Email (Resend)

export async function sendEmail(
  ws: string,
  o: { to: string; subject: string; text: string; contactId?: string; opportunityId?: string; replyTo?: string; attachments?: { filename: string; content: Buffer }[]; skipChecks?: boolean }
) {
  if (await demoGuard(ws)) return "Blocked: demo workspace never sends email";
  if (o.contactId && !o.skipChecks) {
    const elig = await checkEligibility(ws, o.contactId, "email");
    if (!elig.ok) return `Blocked: ${elig.reason}`;
  }
  const key = await setting(ws, "RESEND_API_KEY");
  const from = await setting(ws, "EMAIL_FROM");
  if (!key || !from) throw new Error("Email isn't set up. Add the Resend API key and From address in Settings → Integrations.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [o.to],
      subject: o.subject,
      text: o.text,
      reply_to: o.replyTo,
      attachments: o.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${String(data.message || "")}`);
  await db.interaction.create({
    data: { workspaceId: ws, contactId: o.contactId, opportunityId: o.opportunityId, channel: "email", direction: "outbound", provider: "email", providerRef: data.id ? String(data.id) : undefined, fromAddr: from, toAddr: o.to, subject: o.subject, body: o.text },
  });
  return `Emailed ${o.to}`;
}
