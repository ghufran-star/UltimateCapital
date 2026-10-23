import { notify } from "./audit";
import { decrypt, encrypt } from "./config";
import { db } from "./db";
import { createTask } from "./engine";
import { fullName } from "./util";

// Autopilot: every deal has a next step that happens by itself, and nothing sits still unnoticed.
// Rules run every 10 minutes. Each rule fires once per deal per stage visit (dedupe keys).

export type StepRule = { id: string; on: boolean; stage: string; label: string; role: string; afterHours: number; repeat: boolean };
export type SlaRule = { stage: string; maxDays: number };
export type AutopilotConfig = { on: boolean; steps: StepRule[]; slas: SlaRule[]; nurtureDays: number; nurtureMax: number; replies: "off" | "draft" | "auto" };

export const DEFAULT_AUTOPILOT: AutopilotConfig = {
  on: true,
  steps: [
    { id: "engaged-qualify", on: true, stage: "ENGAGED", label: "Qualify an engaged seller (motivation, timeline, decision makers)", role: "seller_acquisition", afterHours: 24, repeat: true },
    { id: "qualified-discovery", on: true, stage: "QUALIFIED", label: "Property discovery call after qualifying", role: "property_discovery", afterHours: 4, repeat: false },
    { id: "discovery-followup", on: true, stage: "PROPERTY_DISCOVERY", label: "Finish open questions about the property", role: "property_discovery", afterHours: 48, repeat: true },
    { id: "offer-ready-present", on: true, stage: "OFFER_READY", label: "Present the offer", role: "negotiation", afterHours: 2, repeat: false },
    { id: "negotiation-followup", on: true, stage: "NEGOTIATION", label: "Negotiation follow-up", role: "negotiation", afterHours: 48, repeat: true },
  ],
  slas: [
    { stage: "UNDERWRITING", maxDays: 3 },
    { stage: "OFFER_READY", maxDays: 2 },
    { stage: "NEGOTIATION", maxDays: 14 },
    { stage: "CONTRACT_PREPARATION", maxDays: 2 },
    { stage: "UNDER_CONTRACT", maxDays: 5 },
    { stage: "DISPOSITION", maxDays: 10 },
    { stage: "CLOSING", maxDays: 21 },
  ],
  nurtureDays: 75,
  nurtureMax: 4,
  replies: "draft",
};

const KEY = "AUTOPILOT";

export async function getAutopilot(ws: string): Promise<AutopilotConfig> {
  const row = await db.setting.findUnique({ where: { workspaceId_key: { workspaceId: ws, key: KEY } } });
  if (!row) return DEFAULT_AUTOPILOT;
  try {
    const saved = JSON.parse(decrypt(row.value) || "{}") as Partial<AutopilotConfig>;
    const steps = DEFAULT_AUTOPILOT.steps.map((d) => ({ ...d, ...(saved.steps?.find((s) => s.id === d.id) || {}) }));
    const slas = DEFAULT_AUTOPILOT.slas.map((d) => ({ ...d, ...(saved.slas?.find((s) => s.stage === d.stage) || {}) }));
    return { ...DEFAULT_AUTOPILOT, ...saved, steps, slas };
  } catch {
    return DEFAULT_AUTOPILOT;
  }
}

export async function saveAutopilot(ws: string, c: AutopilotConfig) {
  const value = encrypt(JSON.stringify(c));
  await db.setting.upsert({ where: { workspaceId_key: { workspaceId: ws, key: KEY } }, create: { workspaceId: ws, key: KEY, value }, update: { value } });
}

const STOP = ["DECLINED", "WITHDRAWN", "DO_NOT_CONTACT", "OWNERSHIP_DISPUTE", "APPROVAL_REQUIRED", "CONTRACT_FAILED"];

/** When the deal entered its current stage (last stage change in the audit log, else when it was created). */
async function stageSince(ws: string, oppId: string, created: Date) {
  const e = await db.auditEvent.findFirst({ where: { workspaceId: ws, entityId: oppId, action: "stage_changed" }, orderBy: { createdAt: "desc" } });
  return e?.createdAt || created;
}

export async function autopilotTick() {
  const wss = await db.workspace.findMany({ where: { isDemo: false } });
  let n = 0;
  for (const w of wss) {
    const cfg = await getAutopilot(w.id);
    if (!cfg.on) continue;
    n += await runDealSteps(w.id, cfg);
    n += await runSlas(w.id, cfg);
    n += await runNurture(w.id, cfg);
  }
  return n;
}

async function runDealSteps(ws: string, cfg: AutopilotConfig) {
  const rules = cfg.steps.filter((r) => r.on);
  if (!rules.length) return 0;
  const opps = await db.opportunity.findMany({ where: { workspaceId: ws, stage: { in: rules.map((r) => r.stage) }, sellerId: { not: null }, OR: [{ exception: null }, { exception: { notIn: STOP } }] }, take: 500 });
  let n = 0;
  for (const o of opps) {
    const rule = rules.find((r) => r.stage === o.stage)!;
    const seller = await db.contact.findUnique({ where: { id: o.sellerId! } });
    if (!seller || seller.doNotContact) continue;
    const since = await stageSince(ws, o.id, o.createdAt);
    const last = seller.lastContactAt && seller.lastContactAt > since ? seller.lastContactAt : since;
    const due = new Date(+last + rule.afterHours * 3600_000);
    if (due > new Date()) continue;
    // Don't stack: skip while any call/text for this person is already queued.
    const queued = await db.task.count({ where: { workspaceId: ws, contactId: seller.id, status: { in: ["open", "running"] }, kind: { in: ["call", "sms"] } } });
    if (queued) continue;
    const key = rule.repeat ? `auto:${rule.id}:${o.id}:${last.toISOString().slice(0, 13)}` : `auto:${rule.id}:${o.id}:${since.toISOString()}`;
    const done = await db.task.findFirst({ where: { workspaceId: ws, dedupeKey: key } });
    if (done) continue;
    await createTask(ws, { kind: "call", title: `Autopilot: ${rule.label}`, reason: `Deal in ${o.stage.toLowerCase().replace(/_/g, " ")} since ${since.toDateString()}`, contactId: seller.id, entityType: "opportunity", entityId: o.id, assignee: `agent:${rule.role}`, payload: { agentRole: rule.role, opportunityId: o.id, fallbackToTeam: true }, dedupeKey: key });
    n++;
  }
  return n;
}

async function runSlas(ws: string, cfg: AutopilotConfig) {
  let n = 0;
  for (const s of cfg.slas.filter((x) => x.maxDays > 0)) {
    const opps = await db.opportunity.findMany({ where: { workspaceId: ws, stage: s.stage }, include: { property: true }, take: 500 });
    for (const o of opps) {
      const since = await stageSince(ws, o.id, o.createdAt);
      const days = (Date.now() - +since) / 864e5;
      if (days < s.maxDays) continue;
      const key = `sla:${o.id}:${s.stage}:${since.toISOString()}`;
      if (await db.task.findFirst({ where: { workspaceId: ws, dedupeKey: key } })) continue;
      await createTask(ws, { kind: "review", title: `Stuck: ${o.property.address} has been in ${s.stage.toLowerCase().replace(/_/g, " ")} ${Math.floor(days)} days`, entityType: "opportunity", entityId: o.id, assignee: o.assigneeId || undefined, priority: 1, dedupeKey: key });
      await notify(ws, "Deal stuck", `${o.property.address}: ${Math.floor(days)} days in ${s.stage.toLowerCase().replace(/_/g, " ")} (limit ${s.maxDays}).`, `/deals/${o.id}`, o.assigneeId || undefined);
      n++;
    }
  }
  return n;
}

/** Long-term nurture: sellers who said "not now" hear from us every N days, a few times, unless they opted out. */
async function runNurture(ws: string, cfg: AutopilotConfig) {
  if (!cfg.nurtureDays) return 0;
  const cutoff = new Date(Date.now() - cfg.nurtureDays * 864e5);
  const opps = await db.opportunity.findMany({
    where: { workspaceId: ws, sellerId: { not: null }, OR: [{ exception: "DECLINED" }, { exception: "CALLBACK" }, { stage: { in: ["ENGAGED", "QUALIFIED"] } }] },
    take: 500,
  });
  let n = 0;
  for (const o of opps) {
    const s = await db.contact.findUnique({ where: { id: o.sellerId! } });
    if (!s || s.doNotContact || !s.lastContactAt || s.lastContactAt > cutoff) continue;
    const count = await db.task.count({ where: { workspaceId: ws, dedupeKey: { startsWith: `nurture:${o.id}:` } } });
    if (count >= cfg.nurtureMax) continue;
    await createTask(ws, { kind: "call", title: `Nurture check-in with ${fullName(s)}`, reason: `No contact for ${cfg.nurtureDays}+ days`, contactId: s.id, entityType: "opportunity", entityId: o.id, assignee: "agent:seller_acquisition", payload: { agentRole: "seller_acquisition", opportunityId: o.id, fallbackToTeam: true }, dedupeKey: `nurture:${o.id}:${count + 1}` });
    n++;
  }
  return n;
}
