import { createHash, randomBytes } from "node:crypto";
import { audit, json, notify } from "./audit";
import { decrypt, encrypt, setting } from "./config";
import { db } from "./db";
import { usd } from "./util";

// Owner controls: pause switches, autonomy levels (what runs by itself vs waits for approval),
// a daily spend cap, and approvals decided from a text or email link.

export type Autonomy = {
  emdAutoUnder: number; // earnest money at or below this is approved automatically (0 = always ask)
  paymentAutoUnder: number; // other outgoing payments at or below this are approved automatically
  demandCheck: "auto" | "ask"; // anonymous buyer check when the seller is near agreement
  fullMarketing: "auto" | "ask"; // marketing to buyers once under contract
  sendSellerContract: "auto" | "manual"; // after you approve the final offer, draft and send the contract
  offerLetter: "auto" | "ask" | "off"; // written offer letter after the seller verbally agrees a number on a call
  dailySpendCap: number | null; // calls + texts per day, all campaigns
  approvalTexts: boolean; // text approval links to owners/admins with a phone
};

export const DEFAULT_AUTONOMY: Autonomy = { emdAutoUnder: 0, paymentAutoUnder: 0, demandCheck: "auto", fullMarketing: "auto", sendSellerContract: "manual", offerLetter: "auto", dailySpendCap: null, approvalTexts: true };

const KEY = "AUTONOMY";

export async function getAutonomy(ws: string): Promise<Autonomy> {
  const row = await db.setting.findUnique({ where: { workspaceId_key: { workspaceId: ws, key: KEY } } });
  if (!row) return DEFAULT_AUTONOMY;
  try {
    return { ...DEFAULT_AUTONOMY, ...(JSON.parse(decrypt(row.value) || "{}") as Partial<Autonomy>) };
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

export async function saveAutonomy(ws: string, a: Autonomy) {
  const value = encrypt(JSON.stringify(a));
  await db.setting.upsert({ where: { workspaceId_key: { workspaceId: ws, key: KEY } }, create: { workspaceId: ws, key: KEY, value }, update: { value } });
}

// ---------- pauses ----------

export async function pauseReason(ws: string, o: { state?: string | null; channel?: string; role?: string }) {
  const ps = await db.pause.findMany({ where: { workspaceId: ws } });
  for (const p of ps) {
    const hit = p.scope === "all" || (p.scope === "state" && o.state && p.value === o.state) || (p.scope === "channel" && o.channel && p.value === o.channel) || (p.scope === "agent" && o.role && p.value === o.role);
    if (hit) return `Paused by owner (${p.scope === "all" ? "all outreach" : `${p.scope} ${p.value}`})${p.reason ? `: ${p.reason}` : ""}`;
  }
  return null;
}

// ---------- spend ----------

export async function spendSince(ws: string, since: Date) {
  const perMin = Number((await setting(ws, "COST_PER_CALL_MINUTE")) || 0.12) || 0.12;
  const perSms = Number((await setting(ws, "COST_PER_SMS")) || 0.015) || 0.015;
  const [calls, texts] = await Promise.all([
    db.interaction.aggregate({ where: { workspaceId: ws, channel: "call", direction: "outbound", provider: { in: ["retell", "twilio"] }, createdAt: { gte: since } }, _sum: { durationSec: true }, _count: true }),
    db.interaction.count({ where: { workspaceId: ws, channel: "sms", direction: "outbound", createdAt: { gte: since } } }),
  ]);
  const minutes = Math.max(calls._count, Math.ceil((calls._sum.durationSec || 0) / 60));
  return Math.round((minutes * perMin + texts * perSms) * 100) / 100;
}

/** null when within the cap, otherwise the reason outreach is held. */
export async function spendCapReason(ws: string) {
  const a = await getAutonomy(ws);
  if (!a.dailySpendCap) return null;
  const spent = await spendSince(ws, new Date(Date.now() - 864e5));
  if (spent < a.dailySpendCap) return null;
  const today = new Date().toISOString().slice(0, 10);
  const already = await db.notification.findFirst({ where: { workspaceId: ws, title: "Daily spend cap reached", createdAt: { gte: new Date(`${today}T00:00:00Z`) } } });
  if (!already) await notify(ws, "Daily spend cap reached", `About ${usd(spent)} spent in 24 hours (cap ${usd(a.dailySpendCap)}). Campaigns resume as spend rolls off.`, "/settings/controls");
  return `Daily spend cap ${usd(a.dailySpendCap)} reached`;
}

// ---------- approval links ----------

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Sends owners/admins a one-time link (text + email) for every new approval. Run by the worker. */
export async function announceApprovals() {
  const fresh = await db.approval.findMany({ where: { status: "pending", announcedAt: null, workspace: { isDemo: false } }, take: 20 });
  for (const ap of fresh) {
    await db.approval.update({ where: { id: ap.id }, data: { announcedAt: new Date() } });
    const ws = ap.workspaceId;
    const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
    if (!base) continue;
    const a = await getAutonomy(ws);
    const deciders = await db.membership.findMany({ where: { workspaceId: ws, role: { in: ["owner", "admin"] } }, include: { user: true } });
    const comms = await import("./comms");
    for (const m of deciders) {
      const token = randomBytes(24).toString("base64url");
      await db.approvalLink.create({ data: { approvalId: ap.id, userId: m.userId, tokenHash: sha(token), expiresAt: new Date(Date.now() + 3 * 864e5) } });
      const link = `${base}/a/${token}`;
      if (a.approvalTexts && m.user.phone) await comms.sendOwnerSms(ws, m.user.phone, `Approval needed: ${ap.title}\nDecide: ${link}`).catch((e) => console.error("[approval sms]", e));
      if (await setting(ws, "RESEND_API_KEY")) await comms.sendEmail(ws, { to: m.user.email, subject: `Approval needed: ${ap.title}`, text: `${ap.title}\n\nReview and decide (link works once, for 3 days): ${link}`, skipChecks: true }).catch((e) => console.error("[approval email]", e));
    }
  }
  return fresh.length;
}

export async function approvalByToken(token: string) {
  const l = await db.approvalLink.findUnique({ where: { tokenHash: sha(token) } });
  if (!l || l.usedAt || l.expiresAt < new Date()) return null;
  const ap = await db.approval.findUnique({ where: { id: l.approvalId } });
  if (!ap) return null;
  const m = await db.membership.findFirst({ where: { workspaceId: ap.workspaceId, userId: l.userId, role: { in: ["owner", "admin"] } } });
  if (!m) return null;
  return { link: l, approval: ap };
}

export async function useApprovalLink(linkId: string) {
  await db.approvalLink.update({ where: { id: linkId }, data: { usedAt: new Date() } });
}

export async function addPause(ws: string, scope: string, value: string | null, reason: string | null, actor: string) {
  const p = await db.pause.create({ data: { workspaceId: ws, scope, value, reason, createdBy: actor } });
  await audit(ws, actor, "pause_on", { type: "pause", id: p.id }, { after: { scope, value, reason } });
  return p;
}

export async function removePause(ws: string, id: string, actor: string) {
  const p = await db.pause.findFirstOrThrow({ where: { id, workspaceId: ws } });
  await db.pause.delete({ where: { id } });
  await audit(ws, actor, "pause_off", { type: "pause", id }, { before: json({ scope: p.scope, value: p.value }) });
}
