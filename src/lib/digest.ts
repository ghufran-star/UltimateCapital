import { notify } from "./audit";
import { decrypt, encrypt, setting } from "./config";
import { db } from "./db";
import { localParts, usd } from "./util";

// Failure alerts and the owner's daily digest.

/** Alerts the workspace when automation fails for good (after retries). One alert per thing per day. */
export async function alertFailure(ws: string, what: string, detail: string, href = "/ops?tab=system") {
  const since = new Date(Date.now() - 864e5);
  const dup = await db.notification.findFirst({ where: { workspaceId: ws, title: `⚠️ ${what}`, createdAt: { gte: since } } });
  if (dup) return;
  await notify(ws, `⚠️ ${what}`, detail.slice(0, 300), href);
}

const KEY = "DIGEST_LAST";

/** Sends each owner a morning summary (8am workspace time), once a day. */
export async function digestTick() {
  const wss = await db.workspace.findMany({ where: { isDemo: false } });
  let sent = 0;
  for (const w of wss) {
    const { hm } = localParts(w.timezone);
    if (hm < "08:00") continue;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: w.timezone });
    const row = await db.setting.findUnique({ where: { workspaceId_key: { workspaceId: w.id, key: KEY } } });
    if (row && decrypt(row.value) === today) continue;
    await db.setting.upsert({ where: { workspaceId_key: { workspaceId: w.id, key: KEY } }, create: { workspaceId: w.id, key: KEY, value: encrypt(today) }, update: { value: encrypt(today) } });
    await sendDigest(w.id);
    if ((await setting(w.id, "BANK_PROVIDER"))) {
      const { createTask } = await import("./engine");
      await createTask(w.id, { kind: "bank_sync", title: "Match bank deposits to fees", dedupeKey: `bank:${today}` });
    }
    sent++;
  }
  return sent;
}

export async function buildDigest(ws: string) {
  const since = new Date(Date.now() - 864e5);
  const week = new Date(Date.now() + 7 * 864e5);
  const [approvals, moved, closed, due, failedTasks, failedEvents, calls, texts, hot, blocked] = await Promise.all([
    db.approval.findMany({ where: { workspaceId: ws, status: "pending" }, orderBy: { createdAt: "asc" }, take: 10 }),
    db.auditEvent.count({ where: { workspaceId: ws, action: "stage_changed", createdAt: { gte: since } } }),
    db.opportunity.count({ where: { workspaceId: ws, stage: "CLOSED", updatedAt: { gte: since } } }),
    db.payment.findMany({ where: { workspaceId: ws, status: { in: ["due", "awaiting_approval", "approved"] }, dueAt: { lte: week } }, orderBy: { dueAt: "asc" }, take: 10 }),
    db.task.count({ where: { workspaceId: ws, status: "failed", updatedAt: { gte: since } } }),
    db.event.count({ where: { workspaceId: ws, error: { not: null }, createdAt: { gte: since } } }),
    db.interaction.count({ where: { workspaceId: ws, channel: "call", createdAt: { gte: since } } }),
    db.interaction.count({ where: { workspaceId: ws, channel: "sms", createdAt: { gte: since } } }),
    db.opportunity.findMany({ where: { workspaceId: ws, hotScore: { gte: 70 }, stage: { not: "CLOSED" } }, include: { property: true }, take: 5 }),
    db.campaignMember.count({ where: { campaign: { workspaceId: ws }, status: "blocked", createdAt: { gte: since } } }),
  ]);
  const lines = [
    `Waiting for you: ${approvals.length} approval${approvals.length === 1 ? "" : "s"}`,
    ...approvals.map((a) => `  - ${a.title}`),
    `Last 24 hours: ${moved} deal moves, ${closed} closed, ${calls} calls, ${texts} texts`,
    hot.length ? `Hot deals: ${hot.map((h) => `${h.property.address} (${h.hotScore})`).join(", ")}` : "",
    due.length ? `Money due in 7 days:` : "",
    ...due.map((p) => `  - ${p.kind.replace(/_/g, " ")} ${usd(p.amount)} ${p.direction === "in" ? "to receive" : `to ${p.payee || "pay"}`} (${p.status.replace(/_/g, " ")})`),
    failedTasks || failedEvents ? `Problems: ${failedTasks} failed tasks, ${failedEvents} errors (see AI operations → System)` : "",
    blocked ? `${blocked} contacts blocked by compliance checks in campaigns` : "",
  ].filter(Boolean);
  return { lines, approvals: approvals.length };
}

export async function sendDigest(ws: string) {
  const { lines } = await buildDigest(ws);
  await notify(ws, "Daily digest", lines.slice(0, 4).join(" · "), "/");
  if (!(await setting(ws, "RESEND_API_KEY"))) return;
  const owners = await db.membership.findMany({ where: { workspaceId: ws, role: { in: ["owner", "admin"] } }, include: { user: true } });
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "") || "";
  const { sendEmail } = await import("./comms");
  for (const o of owners) {
    await sendEmail(ws, { to: o.user.email, subject: "Your daily deal digest", text: `${lines.join("\n")}\n\nOpen the app: ${base}/`, skipChecks: true }).catch((e) => console.error("[digest]", e));
  }
}
