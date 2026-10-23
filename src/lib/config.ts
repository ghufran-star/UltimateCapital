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
  { key: "RESEND_API_KEY", label: "Resend API key", secret: true, group: "Email", help: "Sends email (contracts, deal packages, title)." },
  { key: "EMAIL_FROM", label: "Send email from", secret: false, group: "Email", help: "e.g. deals@yourdomain.com (domain verified in Resend)" },
  { key: "INBOUND_EMAIL_DOMAIN", label: "Inbound email domain", secret: false, group: "Email", help: "Deal inboxes become deal-xxxx@this-domain. Point its inbound webhook to /api/webhooks/email" },
  { key: "WEBHOOK_SECRET", label: "Inbound webhook secret", secret: true, group: "Email", help: "Shared secret added as ?key= on inbound email and DNC provider webhooks." },
  { key: "RENTCAST_API_KEY", label: "RentCast API key", secret: true, group: "Data", help: "Comparable sales, value and rent estimates." },
  { key: "DNC_SCRUB_URL", label: "DNC scrub provider URL", secret: false, group: "Compliance", help: "Optional. A scrubbing provider endpoint that returns {blocked, reason} for ?phone=" },
  { key: "DNC_SCRUB_KEY", label: "DNC scrub provider key", secret: true, group: "Compliance", help: "" },
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
