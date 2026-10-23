import { audit, json } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { e164 } from "./util";

// Number checks: is the number real, and is it a mobile (can text) or a landline?
// 1. Free, in the app: format and numbering-plan rules (catches typos, fake and impossible numbers).
// 2. Free with your DNC provider: invalid / disconnected flags it already returns (DNC.com codes I, M, S).
// 3. Optional, paid per number: Twilio Lookup line type (mobile, landline, VoIP, carrier). Cached 90 days.

export type NumberStatus = "valid" | "mobile" | "landline" | "voip" | "toll_free" | "invalid" | "disconnected";

const TOLL_FREE = ["800", "833", "844", "855", "866", "877", "888"];

/** Free check against the North American Numbering Plan. */
export function formatCheck(raw?: string | null): { status: NumberStatus; reason?: string; phone: string | null } {
  const phone = e164(raw);
  if (!phone) return { status: "invalid", reason: "Not a 10-digit US number", phone: null };
  const d = phone.slice(2);
  const area = d.slice(0, 3);
  const exch = d.slice(3, 6);
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exch)) return { status: "invalid", reason: "Area code or exchange can't start with 0 or 1", phone };
  if (/^[2-9]11$/.test(area) || /^[2-9]11$/.test(exch)) return { status: "invalid", reason: "N11 service code", phone };
  if (area === "555" || (exch === "555" && /^01\d\d$/.test(d.slice(6)))) return { status: "invalid", reason: "Fictional 555 number", phone };
  if (/^(\d)\1{9}$/.test(d) || d === "1234567890") return { status: "invalid", reason: "Placeholder number", phone };
  if (TOLL_FREE.includes(area)) return { status: "toll_free", reason: "Toll-free: can't receive texts", phone };
  return { status: "valid", phone };
}

/** Paid lookup through your Twilio account (line type and carrier), cached for 90 days. */
async function twilioLookup(ws: string, phone: string) {
  const cached = await db.phoneCheck.findFirst({ where: { workspaceId: ws, phone, provider: "twilio_lookup", checkedAt: { gte: new Date(Date.now() - 90 * 864e5) } }, orderBy: { checkedAt: "desc" } });
  if (cached) return { lineType: cached.lineType, valid: !cached.blocked, carrier: cached.code };
  const sid = await setting(ws, "TWILIO_ACCOUNT_SID");
  const token = await setting(ws, "TWILIO_AUTH_TOKEN");
  if (!sid || !token) throw new Error("Twilio isn't connected");
  const res = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`, { headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as { valid?: boolean; line_type_intelligence?: { type?: string; carrier_name?: string } | null };
  if (!res.ok && res.status !== 404) throw new Error(`Twilio Lookup ${res.status}`);
  const type = (j.line_type_intelligence?.type || "").toLowerCase();
  const lineType = type.includes("mobile") ? "mobile" : type === "landline" ? "landline" : type.includes("voip") ? "voip" : type.includes("tollfree") ? "toll_free" : type || null;
  const valid = res.status !== 404 && j.valid !== false;
  await db.phoneCheck.create({ data: { workspaceId: ws, phone, provider: "twilio_lookup", blocked: !valid, code: j.line_type_intelligence?.carrier_name?.slice(0, 60) || null, reason: valid ? null : "Invalid number", lineType, raw: json(j) } });
  return { lineType, valid, carrier: j.line_type_intelligence?.carrier_name || null };
}

/** Checks one contact's main number and stores the result on the contact. */
export async function checkContactNumber(ws: string, contactId: string, opts: { paid?: boolean } = {}): Promise<NumberStatus | null> {
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c?.phone) return null;
  const f = formatCheck(c.phone);
  let status: NumberStatus = f.status;
  let carrier: string | null = c.phoneCarrier;
  if (f.phone && status !== "invalid") {
    // What the DNC provider already said about this number (no extra cost).
    const prior = await db.phoneCheck.findFirst({ where: { workspaceId: ws, phone: f.phone, provider: { notIn: ["twilio_lookup"] } }, orderBy: { checkedAt: "desc" } });
    if (prior && ["I", "M"].includes(prior.code || "")) status = "invalid";
    else if (prior && prior.code === "S") status = "disconnected";
    else if (prior?.lineType === "wireless") status = "mobile";
    else if (prior?.lineType === "voip") status = "voip";
    const useLookup = opts.paid ?? ((await setting(ws, "NUMBER_LOOKUP")) || "off").toLowerCase() === "twilio";
    if (useLookup && !["invalid", "disconnected", "toll_free"].includes(status)) {
      try {
        const l = await twilioLookup(ws, f.phone);
        if (!l.valid) status = "invalid";
        else if (l.lineType === "mobile" || l.lineType === "landline" || l.lineType === "voip" || l.lineType === "toll_free") status = l.lineType;
        carrier = l.carrier || carrier;
      } catch (e) {
        console.error("[numbers]", e instanceof Error ? e.message : e);
      }
    }
  }
  await db.contact.update({ where: { id: contactId }, data: { phoneStatus: status, phoneCarrier: carrier, phoneCheckedAt: new Date() } });
  return status;
}

/** Bulk check (runs in the background, 100 numbers per task). */
export async function checkNumbers(ws: string, contactIds: string[], opts: { paid?: boolean } = {}) {
  const counts: Record<string, number> = {};
  for (const id of contactIds) {
    const s = await checkContactNumber(ws, id, opts);
    if (s) counts[s] = (counts[s] || 0) + 1;
  }
  await audit(ws, "system", "numbers_checked", undefined, { meta: { counts, total: contactIds.length } });
  return Object.entries(counts).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "No numbers to check";
}

export async function queueNumberChecks(ws: string, contactIds: string[], paid?: boolean) {
  const { createTask } = await import("./engine");
  const ids = [...new Set(contactIds)];
  for (let i = 0; i < ids.length; i += 100) {
    await createTask(ws, { kind: "number_check", title: `Check ${Math.min(100, ids.length - i)} phone numbers`, payload: { contactIds: ids.slice(i, i + 100), paid }, priority: 2 });
  }
  return ids.length;
}

export const STATUS_LABEL: Record<string, string> = { valid: "Valid", mobile: "Mobile", landline: "Landline", voip: "VoIP", toll_free: "Toll-free", invalid: "Invalid", disconnected: "Disconnected" };
