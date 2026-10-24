import { audit, json } from "./audit";
import { db } from "./db";
import { cancelTasks } from "./engine";
import { areaState, areaTz } from "./areacodes";
import { draftPack, StatePackData, stateTz } from "./states";
import { complianceFor } from "./switches";
import { e164, localParts, nextWindow } from "./util";

// Contact eligibility: checked immediately before EVERY call, text and email.

export type Channel = "ai_call" | "human_call" | "sms" | "email";
export type Eligibility = { ok: boolean; reason?: string; retryAt?: Date; pack?: StatePackData };

export async function activePack(ws: string, state?: string | null) {
  if (!state) return null;
  const p = await db.statePack.findUnique({ where: { workspaceId_state: { workspaceId: ws, state } } });
  return p && p.status === "active" ? (p.data as unknown as StatePackData) : null;
}

async function suppressed(ws: string, kind: "phone" | "email", value: string) {
  const s = await db.suppression.findFirst({ where: { workspaceId: ws, kind, value } });
  return s ? `${kind === "phone" ? "Number" : "Email"} is on the ${s.source.replace("_", " ")} list${s.reason ? ` (${s.reason})` : ""}` : null;
}

/** The state that governs outreach to this contact: their property's state for sellers, else their own. */
export async function governingState(ws: string, contactId: string) {
  const c = await db.contact.findUnique({ where: { id: contactId }, include: { ownerships: { include: { property: true }, take: 1 } } });
  return c?.ownerships[0]?.property.state || c?.state || null;
}

/**
 * Calling hours, strictest wins: the property's state rules in the property's time zone, and (when the owner
 * switch is on) the same hours where the owner actually lives: their mailing address, then their phone's area code.
 * If the owner's own state has stricter hours, those apply too. Pure code: no lookups, no AI.
 */
export async function callingWindow(ws: string, c: { timezone: string | null; state: string | null; phone: string | null }, state: string | null, pack: StatePackData, isCall: boolean, ownerHours: boolean, now = new Date()) {
  let [start, end] = isCall ? [pack.outreach.callStart, pack.outreach.callEnd] : [pack.outreach.textStart, pack.outreach.textEnd];
  let days = pack.outreach.callDays;
  const zones: { tz: string; where: string }[] = [{ tz: c.timezone || pack.timezone || stateTz(state), where: state ? `the property (${state})` : "the property" }];
  if (ownerHours) {
    const homeState = c.state || areaState(c.phone);
    if (c.state && c.state !== state) zones.push({ tz: stateTz(c.state), where: `the owner's mailing address (${c.state})` });
    const atz = areaTz(c.phone);
    if (atz) zones.push({ tz: atz, where: `the owner's phone area code (${areaState(c.phone)})` });
    if (homeState && homeState !== state) {
      const home = await activePack(ws, homeState);
      if (home) {
        const [hs, he] = isCall ? [home.outreach.callStart, home.outreach.callEnd] : [home.outreach.textStart, home.outreach.textEnd];
        if (hs > start) start = hs;
        if (he < end) end = he;
        days = days.filter((d) => home.outreach.callDays.includes(d));
      }
    }
  }
  if (start >= end || !days.length) return { ok: false as const, reason: "The property's and the owner's state calling hours don't overlap", retryAt: new Date(now.getTime() + 24 * 3600_000) };
  const seen = new Set<string>();
  const list = zones.filter((z) => (seen.has(z.tz) ? false : (seen.add(z.tz), true)));
  const failing = (t: Date) => list.find((z) => {
    const { day, hm } = localParts(z.tz, t);
    return !days.includes(day) || hm < start || hm >= end;
  });
  const bad = failing(now);
  if (!bad) return { ok: true as const };
  let t = now;
  for (let i = 0; i < 8; i++) {
    const f = failing(t);
    if (!f) break;
    t = nextWindow(f.tz, start, end, days, new Date(t.getTime() + (i ? 60_000 : 0)));
  }
  return { ok: false as const, reason: `Outside calling hours for ${bad.where}: ${start}–${end} ${bad.tz}`, retryAt: t };
}

export async function checkEligibility(ws: string, contactId: string, channel: Channel, now = new Date()): Promise<Eligibility> {
  const c = await db.contact.findUnique({ where: { id: contactId }, include: { consents: true } });
  if (!c) return { ok: false, reason: "Contact not found" };
  if (c.doNotContact) return { ok: false, reason: "Marked do not contact" };

  const state = await governingState(ws, contactId);
  const pack = await activePack(ws, state);
  if (!pack) return { ok: false, reason: state ? `No active State Pack for ${state}. Activate it in Settings → States.` : "Contact has no state: add one so the right rules apply." };

  const { pauseReason } = await import("./controls");
  const paused = await pauseReason(ws, { state, channel });
  if (paused) return { ok: false, reason: paused, retryAt: new Date(now.getTime() + 30 * 60_000), pack };

  const isCall = channel === "ai_call" || channel === "human_call";
  if (isCall || channel === "sms") {
    const phone = e164(c.phone);
    if (!phone) return { ok: false, reason: "No valid phone number" };
    if (c.phoneStatus === "invalid" || c.phoneStatus === "disconnected") return { ok: false, reason: `Number check: ${c.phoneStatus}` };
    if (channel === "sms" && (c.phoneStatus === "landline" || c.phoneStatus === "toll_free")) return { ok: false, reason: `Number check: ${c.phoneStatus.replace("_", "-")}, can't receive texts` };
    const s = await suppressed(ws, "phone", phone);
    if (s) return { ok: false, reason: s };
    const consent = (ch: string) => c.consents.filter((x) => x.channel === ch).sort((a, b) => +b.createdAt - +a.createdAt)[0];
    const sw = await complianceFor(ws, state);
    // A "no" on record always wins. Cold outreach mode (owner switch) lifts the consent requirement for lists.
    if (channel === "ai_call" && consent("ai_voice")?.granted === false) return { ok: false, reason: "They withdrew consent for AI-voice calls." };
    if (channel === "sms" && consent("sms")?.granted === false) return { ok: false, reason: "They withdrew consent for texts." };
    if (channel === "ai_call" && pack.outreach.requireConsentAiVoice && !sw.coldOutreach) {
      const k = consent("ai_voice");
      if (!k?.granted) return { ok: false, reason: `${state} requires recorded consent for AI-voice calls. Record consent, call manually, or turn on cold outreach mode (Settings → Calling rules).` };
    }
    if (channel === "sms" && pack.outreach.requireConsentSms && !sw.coldOutreach) {
      const k = consent("sms");
      if (!k?.granted) return { ok: false, reason: `${state} requires recorded consent for texts. Or turn on cold outreach mode (Settings → Calling rules).` };
    }
    const hours = await callingWindow(ws, c, state, pack, isCall, sw.ownerHours, now);
    if (!hours.ok) return { ok: false, reason: hours.reason, retryAt: hours.retryAt, pack };
    if (isCall) {
      const since = new Date(now.getTime() - 20 * 3600_000);
      const today = await db.interaction.count({ where: { workspaceId: ws, contactId, channel: "call", direction: "outbound", createdAt: { gte: since } } });
      if (today >= pack.outreach.maxCallsPerDayPerContact) {
        return { ok: false, reason: "Daily call limit for this contact reached", retryAt: new Date(now.getTime() + 20 * 3600_000), pack };
      }
    }
    // Live federal/state DNC + litigator check, immediately before contact. Recorded consent for
    // this channel is the DNC exception (never for litigators, opt-outs or invalid numbers).
    const consentChannels = channel === "sms" ? ["sms"] : ["ai_voice", "call"];
    const hasConsent = consentChannels.some((ch) => consent(ch)?.granted);
    const { liveCheck } = await import("./dnc");
    const live = await liveCheck(ws, phone, { hasConsent });
    if (!live.ok) return { ok: false, reason: live.reason };
  }
  if (channel === "email") {
    if (!c.email) return { ok: false, reason: "No email address" };
    const s = await suppressed(ws, "email", c.email.toLowerCase());
    if (s) return { ok: false, reason: s };
  }
  return { ok: true, pack };
}

/** Opt-out: blocks the person everywhere, instantly, and cancels everything pending. */
export async function optOut(ws: string, contactId: string, reason: string, source = "opt_out", actor = "system") {
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return;
  await db.contact.update({
    where: { id: contactId },
    data: { doNotContact: true, buyerStatus: c.kind === "buyer" ? "DO_NOT_CONTACT" : c.buyerStatus, sellerStatus: c.kind === "seller" ? "DO_NOT_CONTACT" : c.sellerStatus },
  });
  for (const p of [c.phone, c.phone2].map(e164).filter(Boolean) as string[]) {
    await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: p, source: "internal", reason } }).catch(() => null);
  }
  if (c.email) await db.suppression.create({ data: { workspaceId: ws, kind: "email", value: c.email.toLowerCase(), source: "internal", reason } }).catch(() => null);
  await cancelTasks(ws, { contactId }, `Opt-out: ${reason}`);
  await db.campaignMember.updateMany({ where: { contactId, status: { in: ["pending", "retry", "in_progress"] } }, data: { status: "stopped", blockedReason: "Opted out" } });
  await db.opportunity.updateMany({ where: { workspaceId: ws, sellerId: contactId, stage: { notIn: ["UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"] } }, data: { exception: "DO_NOT_CONTACT" } });
  await audit(ws, actor, "opt_out", { type: "contact", id: contactId }, { meta: { reason, source } });
}

/** Imports a do-not-call file (national or state registry download, or any list). One number per line. */
export async function importDncList(ws: string, text: string, source: string) {
  const numbers = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const digits = line.replace(/\D/g, "");
    const p = e164(digits.length === 10 || digits.length === 11 ? digits : null);
    if (p) numbers.add(p);
  }
  const all = [...numbers];
  let added = 0;
  for (let i = 0; i < all.length; i += 1000) {
    const r = await db.suppression.createMany({
      data: all.slice(i, i + 1000).map((value) => ({ workspaceId: ws, kind: "phone", value, source })),
      skipDuplicates: true,
    });
    added += r.count;
  }
  return { found: all.length, added };
}

export async function ensurePacks(ws: string, states: string[]) {
  for (const s of states) {
    await db.statePack
      .create({ data: { workspaceId: ws, state: s, status: "draft", data: json(draftPack(s)) } })
      .catch(() => null);
  }
}
