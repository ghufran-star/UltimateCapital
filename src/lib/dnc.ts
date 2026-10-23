import { json } from "./audit";
import { loadSettings } from "./config";
import { db } from "./db";

// Live do-not-call and litigator checks, run immediately before every call and text
// (and in bulk when lists are imported or a campaign starts).
//
// The federal and state DNC registries can't be bundled in the app: access is licensed to
// your own registry account (SAN), the lists change daily and hold hundreds of millions of
// numbers. A scrubbing provider holds the current lists for you and answers per number.

export type ProviderResult = {
  provider: string;
  listed: boolean; // on a federal/state/project DNC list
  litigator: boolean; // known TCPA plaintiff / serial complainer
  invalid: boolean;
  code?: string;
  reason?: string;
  lineType?: string;
  raw?: unknown;
};

const digits10 = (e164: string) => e164.replace(/\D/g, "").slice(-10);
const TIMEOUT = 8000;

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** DNC.com (Contact Center Compliance) scrub API, version 8. Covers federal + every state list + your project DNC. */
async function dncscrub(phone: string, key: string): Promise<ProviderResult> {
  const j = (await getJson(`https://www.dncscrub.com/app/main/rpc/scrub?phoneList=${digits10(phone)}&version=8&output=json`, { loginId: key })) as Record<string, unknown> | unknown[];
  const list = (Array.isArray(j) ? j : ((j as Record<string, unknown>).results as unknown[]) || []) as Record<string, unknown>[];
  const r = list[0] || {};
  const code = String(r.ResultCode ?? "").toUpperCase();
  if (!code) throw new Error("No result from DNC.com");
  // C clean · X exemption · O/E/R business relationship · W/G/H/Y wireless/VoIP callable manually · F wireless + EBR
  // D on a DNC list · P your project DNC · B blocked area code · I invalid · M malformed · S disconnected · L/V wireless in a no-telemarketing state
  const listed = ["D", "P", "B", "L", "V"].includes(code);
  const invalid = ["I", "M", "S"].includes(code);
  const wireless = ["W", "G", "H", "L", "F", "V"].includes(code) || String(r.IsWirelessOrVoIP ?? "").toLowerCase() === "true";
  const reason = String(r.Reason ?? "") || ({ D: "On a Do Not Call list", P: "On your DNC.com project list", B: "Area code not covered by your registry subscription", L: "Wireless number in a state that bars telemarketing to mobiles", V: "Wireless number in a state that bars telemarketing to mobiles", I: "Invalid number", M: "Malformed number", S: "Disconnected number" } as Record<string, string>)[code];
  return { provider: "dncscrub", listed, litigator: false, invalid, code, reason, lineType: code === "Y" ? "voip" : wireless ? "wireless" : undefined, raw: r };
}

/** TCPA Litigator List: federal + state DNC, litigators, trolls, serial complainers. Key = "username:password". */
async function tcpalitigator(phone: string, key: string): Promise<ProviderResult> {
  const j = (await getJson(`https://api.tcpalitigatorlist.com/scrub/phone/all/${digits10(phone)}`, { authorization: `Basic ${Buffer.from(key).toString("base64")}` })) as { results?: Record<string, unknown> };
  const r = j.results || {};
  const statuses = ((r.status_array as string[]) || []).map((s) => String(s).toLowerCase());
  const clean = Number(r.clean ?? 1) === 1 && !r.is_bad_number;
  const litigator = statuses.some((s) => ["tcpa", "troll", "litigator", "dnc_complainers", "nra"].includes(s));
  const listed = statuses.some((s) => ["federal_dnc", "state_dnc", "dnc_fed", "dnc_state"].includes(s));
  const type = String(r.phone_type ?? "").toLowerCase();
  return { provider: "tcpalitigator", listed: !clean && listed, litigator: !clean && (litigator || !listed), invalid: false, code: statuses.join(",") || (clean ? "clean" : "match"), reason: clean ? undefined : String(r.status || "Listed"), lineType: type.includes("mobile") ? "wireless" : type || undefined, raw: r };
}

/** Blacklist Alliance litigator firewall. */
async function blacklistAlliance(phone: string, key: string): Promise<ProviderResult> {
  const j = (await getJson(`https://api.blacklistalliance.net/lookup?key=${encodeURIComponent(key)}&phone=${digits10(phone)}&ver=v5&resp=json`)) as Record<string, unknown>;
  const pick = (k: string) => j[k] ?? j[k.charAt(0).toUpperCase() + k.slice(1)];
  const message = String(pick("message") ?? "").toLowerCase();
  const code = String(pick("code") ?? "");
  const blocked = message.includes("blacklist") || (!!code && message !== "good");
  const wireless = String(pick("wireless") ?? "") === "1";
  return { provider: "blacklist_alliance", listed: false, litigator: blocked, invalid: false, code: code || message, reason: blocked ? `Litigator / blacklist (${code || "listed"})` : undefined, lineType: wireless ? "wireless" : undefined, raw: j };
}

/** Any endpoint that answers GET ?phone=+1… with {blocked, reason, litigator?}. */
async function custom(phone: string, url: string, key?: string): Promise<ProviderResult> {
  const u = new URL(url);
  u.searchParams.set("phone", phone);
  const j = (await getJson(u.toString(), key ? { authorization: `Bearer ${key}` } : {})) as { blocked?: boolean; reason?: string; litigator?: boolean };
  return { provider: "custom", listed: !!j.blocked && !j.litigator, litigator: !!j.litigator, invalid: false, reason: j.reason, raw: j };
}

type Cfg = { dnc: string; dncKey: string; dncUrl: string; lit: string; litKey: string; recheckHours: number; require: boolean; strict: boolean };

async function config(ws: string): Promise<Cfg> {
  const s = await loadSettings(ws);
  const dnc = (s.DNC_PROVIDER || (s.DNC_SCRUB_URL ? "custom" : "")).trim().toLowerCase();
  return {
    dnc,
    dncKey: s.DNC_SCRUB_KEY || "",
    dncUrl: s.DNC_SCRUB_URL || "",
    lit: (s.LITIGATOR_PROVIDER || "").trim().toLowerCase(),
    litKey: s.LITIGATOR_KEY || "",
    recheckHours: s.DNC_RECHECK_HOURS === undefined || s.DNC_RECHECK_HOURS === "" ? 24 : Math.max(0, Number(s.DNC_RECHECK_HOURS) || 0),
    require: (s.DNC_REQUIRE_CHECK || "on").toLowerCase() !== "off",
    strict: (s.DNC_STRICT || "on").toLowerCase() !== "off",
  };
}

async function run(provider: string, phone: string, c: Cfg, which: "dnc" | "lit"): Promise<ProviderResult> {
  const key = which === "dnc" ? c.dncKey : c.litKey;
  if (provider === "dncscrub") return dncscrub(phone, key);
  if (provider === "tcpalitigator") return tcpalitigator(phone, key);
  if (provider === "blacklist_alliance") return blacklistAlliance(phone, key);
  if (provider === "custom") return custom(phone, c.dncUrl, c.dncKey);
  throw new Error(`Unknown provider "${provider}"`);
}

/** One provider, using a recent stored result when allowed. Every live answer is stored as evidence. */
async function checkWith(ws: string, phone: string, provider: string, c: Cfg, which: "dnc" | "lit", force: boolean) {
  if (!force) {
    const blockedTtl = 30 * 24; // registry data must be no older than 31 days
    const recent = await db.phoneCheck.findFirst({ where: { workspaceId: ws, phone, provider, checkedAt: { gte: new Date(Date.now() - Math.max(c.recheckHours, 0) * 3600_000) } }, orderBy: { checkedAt: "desc" } });
    if (recent && c.recheckHours > 0) return { cached: true, r: fromRow(recent) };
    const blocked = await db.phoneCheck.findFirst({ where: { workspaceId: ws, phone, provider, blocked: true, checkedAt: { gte: new Date(Date.now() - blockedTtl * 3600_000) } }, orderBy: { checkedAt: "desc" } });
    if (blocked && c.recheckHours > 0) return { cached: true, r: fromRow(blocked) };
  }
  const r = await run(provider, phone, c, which);
  await db.phoneCheck.create({ data: { workspaceId: ws, phone, provider, blocked: r.listed || r.litigator || r.invalid, code: r.code?.slice(0, 60), reason: r.reason?.slice(0, 300), lineType: r.lineType, raw: r.raw === undefined ? undefined : json(r.raw) } });
  if (r.litigator) await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: phone, source: "litigator", reason: r.reason || provider } }).catch(() => null);
  return { cached: false, r };
}

function fromRow(row: { provider: string; blocked: boolean; code: string | null; reason: string | null; lineType: string | null }): ProviderResult {
  const reason = row.reason || "";
  const litigator = row.blocked && /litigat|tcpa|troll|complain|blacklist/i.test(reason + (row.code || ""));
  const invalid = row.blocked && ["I", "M", "S"].includes(row.code || "");
  return { provider: row.provider, listed: row.blocked && !litigator && !invalid, litigator, invalid, code: row.code || undefined, reason: row.reason || undefined, lineType: row.lineType || undefined };
}

export type LiveCheck = { ok: boolean; reason?: string; results: (ProviderResult & { cached: boolean })[] };

/**
 * The pre-dial check. `hasConsent`: the person gave prior express (written) consent for this channel,
 * which is an exception to DNC lists (never to litigator lists, internal opt-outs or invalid numbers).
 */
export async function liveCheck(ws: string, phone: string, o: { hasConsent: boolean; force?: boolean } = { hasConsent: false }): Promise<LiveCheck> {
  const c = await config(ws);
  const results: LiveCheck["results"] = [];
  const failures: string[] = [];
  const jobs: [string, "dnc" | "lit"][] = [];
  if (c.dnc) jobs.push([c.dnc, "dnc"]);
  if (c.lit && c.lit !== c.dnc) jobs.push([c.lit, "lit"]);
  for (const [prov, which] of jobs) {
    try {
      const { cached, r } = await checkWith(ws, phone, prov, c, which, !!o.force);
      results.push({ ...r, cached });
    } catch (e) {
      failures.push(`${prov}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const lit = results.find((r) => r.litigator);
  if (lit) return { ok: false, reason: `Known TCPA litigator / complainer (${lit.provider})`, results };
  const inv = results.find((r) => r.invalid);
  if (inv) return { ok: false, reason: `${inv.reason || "Invalid number"} (${inv.provider})`, results };
  const listed = results.find((r) => r.listed);
  if (listed && (!o.hasConsent || c.strict)) return { ok: false, reason: `${listed.reason || "On a Do Not Call list"} (${listed.provider}${listed.code ? ` ${listed.code}` : ""})`, results };
  if (c.require && !o.hasConsent) {
    if (!c.dnc) return { ok: false, reason: "No live DNC check is set up (Settings → Integrations → Compliance). Cold outreach is blocked until one is.", results };
    if (failures.length && !results.some((r) => r.provider === c.dnc)) return { ok: false, reason: `DNC check unavailable, blocked to be safe (${failures[0]})`, results };
  }
  return { ok: true, results };
}

/** Bulk pre-check (imports, campaign start): marks campaign members blocked before any dialing. */
export async function scrubContacts(ws: string, contactIds: string[]) {
  let blocked = 0;
  for (const id of contactIds) {
    const ct = await db.contact.findUnique({ where: { id }, include: { consents: true } });
    if (!ct?.phone || ct.doNotContact) continue;
    const consent = ct.consents.some((x) => x.granted && ["ai_voice", "call", "sms"].includes(x.channel));
    const r = await liveCheck(ws, ct.phone, { hasConsent: consent });
    if (!r.ok) {
      blocked++;
      await db.campaignMember.updateMany({ where: { contactId: id, status: { in: ["pending", "retry"] } }, data: { status: "blocked", blockedReason: r.reason?.slice(0, 200) } });
    }
  }
  return `${contactIds.length} numbers checked, ${blocked} blocked`;
}

export async function dncStatus(ws: string) {
  const c = await config(ws);
  return { provider: c.dnc || null, litigator: c.lit || null, recheckHours: c.recheckHours, require: c.require, strict: c.strict };
}

/** Pre-checks numbers against DNC/litigator lists in the background (100 per task). */
export async function queueScrub(ws: string, contactIds: string[]) {
  const { createTask } = await import("./engine");
  const ids = [...new Set(contactIds)];
  for (let i = 0; i < ids.length; i += 100) {
    await createTask(ws, { kind: "dnc_scrub", title: `DNC pre-check (${Math.min(100, ids.length - i)} numbers)`, payload: { contactIds: ids.slice(i, i + 100) }, priority: 1 });
  }
}
