import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "./db";

// Per-workspace settings (API keys etc.) managed from Settings → Integrations, stored encrypted.
// Environment variables with the same name are used as a fallback.

export const SETTING_DEFS = [
  { key: "ANTHROPIC_API_KEY", label: "Claude API key", secret: true, group: "AI", help: "Powers conversation intelligence, agents' analysis, repair mapping, title email reading." },
  { key: "ANALYSIS_MODEL", label: "Analysis model", secret: false, group: "AI", help: "Default claude-sonnet-5-5" },
  { key: "FAST_MODEL", label: "Fast model", secret: false, group: "AI", help: "Default claude-haiku-5-5" },
  { key: "RETELL_API_KEY", label: "Retell API key", secret: true, group: "Calling", help: "AI voice calls (outbound campaigns and inbound)." },
  { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID", secret: false, group: "Calling", help: "Texts and human calls." },
  { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", secret: true, group: "Calling", help: "" },
  { key: "TRANSCRIBE_PROVIDER", label: "Transcribe team calls", secret: false, group: "Calling", help: "off (default), deepgram or openai. AI calls are always transcribed by Retell; this is only for calls your team makes or logs (paid per minute by the provider)." },
  { key: "TRANSCRIBE_KEY", label: "Transcription API key", secret: true, group: "Calling", help: "Deepgram or OpenAI API key, matching the provider above." },
  { key: "RESEND_API_KEY", label: "Resend API key", secret: true, group: "Email", help: "Sends email (contracts, deal packages, title)." },
  { key: "EMAIL_FROM", label: "Send email from", secret: false, group: "Email", help: "e.g. deals@yourdomain.com (domain verified in Resend)" },
  { key: "INBOUND_EMAIL_DOMAIN", label: "Inbound email domain", secret: false, group: "Email", help: "Deal inboxes become deal-xxxx@this-domain. Point its inbound webhook to /api/webhooks/email" },
  { key: "WEBHOOK_SECRET", label: "Inbound webhook secret", secret: true, group: "Email", help: "Shared secret added as ?key= on inbound email and DNC provider webhooks." },
  { key: "RENTCAST_API_KEY", label: "RentCast API key", secret: true, group: "Data", help: "Comparable sales, value and rent estimates." },
  { key: "PROPERTY_DATA_PROVIDER", label: "Property data provider", secret: false, group: "Data", help: "batchdata (property search + skip trace) or custom. Powers Find sellers and Find cash buyers." },
  { key: "PROPERTY_DATA_KEY", label: "Property data API key", secret: true, group: "Data", help: "Your BatchData API token." },
  { key: "PROPERTY_DATA_URL", label: "Custom property data endpoint", secret: false, group: "Data", help: "Only for provider 'custom'." },
  { key: "DNC_PROVIDER", label: "Live DNC check provider", secret: false, group: "Compliance", help: "dncscrub (DNC.com / Contact Center Compliance: federal + all state DNC lists, wireless flags), tcpalitigator (TCPA Litigator List: federal + state DNC + litigators), custom, or blank for none." },
  { key: "DNC_SCRUB_KEY", label: "DNC provider key", secret: true, group: "Compliance", help: "dncscrub: your API loginId. tcpalitigator: username:password. custom: sent as a Bearer token." },
  { key: "DNC_SCRUB_URL", label: "Custom DNC endpoint", secret: false, group: "Compliance", help: "Only for provider 'custom': called with ?phone=+1… and must return {blocked, reason}." },
  { key: "LITIGATOR_PROVIDER", label: "Litigator check provider", secret: false, group: "Compliance", help: "blacklist_alliance or tcpalitigator (blank = none). Blocks known TCPA plaintiffs and serial complainers." },
  { key: "LITIGATOR_KEY", label: "Litigator provider key", secret: true, group: "Compliance", help: "blacklist_alliance: API key. tcpalitigator: username:password." },
  { key: "DNC_RECHECK_HOURS", label: "Re-check numbers after (hours)", secret: false, group: "Compliance", help: "Default 24. A number checked clean within this time isn't re-checked (saves cost). 0 = check before every single call and text." },
  { key: "DNC_STRICT", label: "Strict DNC mode", secret: false, group: "Compliance", help: "on (default): never call or text a number on any Do Not Call list, even when consent is recorded. off: recorded consent lets you contact a DNC-listed number (the legal exception)." },
  { key: "NUMBER_LOOKUP", label: "Mobile / landline lookup before texting", secret: false, group: "Compliance", help: "off (default) or twilio. Uses your Twilio account's Lookup (paid per number, cached 90 days) to skip texts to landlines and dead numbers." },
  { key: "DNC_REQUIRE_CHECK", label: "Block cold outreach without a live check", secret: false, group: "Compliance", help: "on (default) or off. When on and no provider is set or the provider is down, calls/texts to people without recorded consent are blocked." },
  { key: "BANK_PROVIDER", label: "Bank feed", secret: false, group: "Money", help: "mercury: deposits are matched to fees daily. Blank = upload CSVs on the Closing page." },
  { key: "BANK_API_KEY", label: "Bank API token", secret: true, group: "Money", help: "Mercury read-only API token." },
  { key: "COST_PER_CALL_MINUTE", label: "Cost per AI call minute ($)", secret: false, group: "Costs", help: "Used for campaign budgets and spend reports. Default 0.12 (Retell + telephony)." },
  { key: "COST_PER_SMS", label: "Cost per text ($)", secret: false, group: "Costs", help: "Default 0.015 (Twilio + carrier fees)." },
  { key: "PUBLIC_URL", label: "Public app URL", secret: false, group: "General", help: "e.g. https://ultimatecapital.up.railway.app — used for signing links and webhooks." },
  { key: "COMPANY_NAME", label: "Company name", secret: false, group: "General", help: "Used by agents and on documents." },
] as const;
export type SettingKey = (typeof SETTING_DEFS)[number]["key"];

function secretKey() {
  const base = process.env.SETTINGS_SECRET || process.env.DATABASE_URL || "ultimatecapital";
  return createHash("sha256").update(`uc-settings:${base}`).digest();
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(v: string): string | null {
  try {
    const [iv, tag, enc] = v.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", secretKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __ucSettings?: Map<string, { at: number; v: Record<string, string> }> };
g.__ucSettings ??= new Map();

export async function loadSettings(workspaceId: string, force = false): Promise<Record<string, string>> {
  const hit = g.__ucSettings!.get(workspaceId);
  if (!force && hit && Date.now() - hit.at < 15_000) return hit.v;
  const rows = await db.setting.findMany({ where: { workspaceId } }).catch(() => []);
  const v: Record<string, string> = {};
  for (const r of rows) {
    const x = decrypt(r.value);
    if (x) v[r.key] = x;
  }
  g.__ucSettings!.set(workspaceId, { at: Date.now(), v });
  return v;
}

/** Setting for a workspace: Settings page first, then environment variable. */
export async function setting(workspaceId: string, key: SettingKey): Promise<string | undefined> {
  const v = await loadSettings(workspaceId);
  return v[key] || process.env[key] || undefined;
}

export async function saveSetting(workspaceId: string, key: SettingKey, value: string) {
  if (!value.trim()) await db.setting.delete({ where: { workspaceId_key: { workspaceId, key } } }).catch(() => null);
  else {
    const enc = encrypt(value.trim());
    await db.setting.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, value: enc },
      update: { value: enc },
    });
  }
  await loadSettings(workspaceId, true);
}

export function mask(v?: string) {
  if (!v) return "";
  return v.length <= 8 ? "••••" : `••••${v.slice(-4)}`;
}
