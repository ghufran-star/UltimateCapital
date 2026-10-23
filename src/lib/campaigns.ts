import { json } from "./audit";
import { db } from "./db";
import { createTask } from "./engine";

// Campaign dialer: turns due campaign members into call / text tasks, respecting attempts,
// retry gaps, daily caps and concurrency. Eligibility (DNC, consent, hours) is checked at send time.

export type CampaignSettings = {
  objective: string;
  maxAttempts: number;
  retryGapHours: number;
  dailyCap: number;
  concurrency: number;
  smsTemplate: string;
  filters: { states?: string[]; zips?: string[]; propertyTypes?: string[]; tags?: string[] };
  budget?: number | null;
};

export const DEFAULT_CAMPAIGN: CampaignSettings = {
  objective: "",
  maxAttempts: 3,
  retryGapHours: 24,
  dailyCap: 100,
  concurrency: 3,
  smsTemplate: "Hi {{first_name}}, this is {{agent_name}} with {{company}}. Would you consider an offer on {{property_address}}?",
  filters: {},
  budget: null,
};

export const roleFor = (kind: string) => (kind === "buyer" ? "buyer_acquisition" : kind === "disposition" ? "disposition" : "seller_acquisition");

/** Estimated spend so far: AI call minutes and texts sent for this campaign. */
export async function campaignSpend(ws: string, campaignId: string) {
  const { setting } = await import("./config");
  const perMin = Number((await setting(ws, "COST_PER_CALL_MINUTE")) || 0.12) || 0.12;
  const perSms = Number((await setting(ws, "COST_PER_SMS")) || 0.015) || 0.015;
  const [calls, texts] = await Promise.all([
    db.interaction.aggregate({ where: { workspaceId: ws, campaignId, channel: "call", direction: "outbound" }, _sum: { durationSec: true }, _count: true }),
    db.interaction.count({ where: { workspaceId: ws, campaignId, channel: "sms", direction: "outbound" } }),
  ]);
  // Every placed call bills at least a minute, even unanswered ones.
  const minutes = Math.max(calls._count, Math.ceil((calls._sum.durationSec || 0) / 60));
  return { minutes, texts, total: Math.round((minutes * perMin + texts * perSms) * 100) / 100 };
}

export async function dialerTick() {
  const running = await db.campaign.findMany({ where: { status: "running", workspace: { isDemo: false } } });
  let queued = 0;
  const held = new Map<string, string | null>();
  for (const c of running) {
    if (!held.has(c.workspaceId)) {
      const { pauseReason, spendCapReason } = await import("./controls");
      held.set(c.workspaceId, (await pauseReason(c.workspaceId, {})) || (await spendCapReason(c.workspaceId)));
    }
    if (held.get(c.workspaceId)) continue;
    // Team-only campaigns are worked from the power dialer; the AI dialer leaves them alone.
    if (!c.channels.some((ch) => ch === "call" || ch === "sms")) continue;
    const s = { ...DEFAULT_CAMPAIGN, ...((c.settings as Partial<CampaignSettings>) || {}) };
    if (s.budget) {
      const spend = await campaignSpend(c.workspaceId, c.id);
      if (spend.total >= s.budget) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "paused" } });
        const { notify } = await import("./audit");
        await notify(c.workspaceId, "Campaign paused: budget reached", `${c.name} spent about $${spend.total} of its $${s.budget} budget.`, `/campaigns/${c.id}`);
        continue;
      }
    }
    const since = new Date(Date.now() - 24 * 3600_000);
    // Contacts attempted in the last 24 hours (each attempt is one task with this campaign's key).
    const today = await db.task.count({ where: { workspaceId: c.workspaceId, dedupeKey: { startsWith: `campaign:${c.id}:` }, createdAt: { gte: since } } });
    const active = await db.campaignMember.count({ where: { campaignId: c.id, status: "in_progress" } });
    const room = Math.max(0, Math.min(s.concurrency - active, s.dailyCap - today));
    if (!room) continue;
    const due = await db.campaignMember.findMany({
      where: { campaignId: c.id, status: { in: ["pending", "retry"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      take: room,
      orderBy: { createdAt: "asc" },
    });
    if (!due.length) {
      const left = await db.campaignMember.count({ where: { campaignId: c.id, status: { in: ["pending", "retry", "in_progress"] } } });
      if (!left) await db.campaign.update({ where: { id: c.id }, data: { status: "done" } });
      continue;
    }
    for (const m of due) {
      if (m.attempts >= s.maxAttempts) {
        await db.campaignMember.update({ where: { id: m.id }, data: { status: "done", lastOutcome: m.lastOutcome || "max_attempts" } });
        continue;
      }
      const opp = m.propertyId ? await db.opportunity.findFirst({ where: { workspaceId: c.workspaceId, propertyId: m.propertyId, sellerId: m.contactId } }) : null;
      const oppId = c.opportunityId || opp?.id;
      const useCall = c.channels.includes("call");
      await createTask(c.workspaceId, {
        kind: useCall ? "call" : "sms",
        title: `${c.name}: ${useCall ? "call" : "text"}`,
        contactId: m.contactId,
        entityType: oppId ? "opportunity" : "contact",
        entityId: oppId || m.contactId,
        payload: { agentRole: roleFor(c.kind), opportunityId: oppId, campaignId: c.id, memberId: m.id, body: useCall ? undefined : await smsBody(c.workspaceId, s.smsTemplate, m.contactId, m.propertyId) },
        dedupeKey: `campaign:${c.id}:${m.id}`,
      });
      await db.campaignMember.update({
        where: { id: m.id },
        data: { status: "retry", nextAttemptAt: new Date(Date.now() + s.retryGapHours * 3600_000), ...(useCall ? {} : { attempts: { increment: 1 } }) },
      });
      queued++;
    }
  }
  return queued;
}

async function smsBody(ws: string, template: string, contactId: string, propertyId: string | null) {
  const { fill, fullName } = await import("./util");
  const { setting } = await import("./config");
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const p = propertyId ? await db.property.findUnique({ where: { id: propertyId } }) : null;
  const agent = await db.agent.findFirst({ where: { workspaceId: ws, role: c.kind === "buyer" ? "buyer_acquisition" : "seller_acquisition" } });
  return fill(template, {
    first_name: c.firstName || fullName(c),
    agent_name: agent?.name || "",
    company: (await setting(ws, "COMPANY_NAME")) || "",
    property_address: p ? p.address : "",
  });
}

/** Adds contacts (and their properties, for seller campaigns) as campaign members. */
export async function addMembers(campaignId: string, rows: { contactId: string; propertyId?: string | null }[]) {
  let added = 0;
  for (const r of rows) {
    await db.campaignMember
      .create({ data: { campaignId, contactId: r.contactId, propertyId: r.propertyId || null } })
      .then(() => added++)
      .catch(() => null);
  }
  return added;
}

export const settingsJson = (s: CampaignSettings) => json(s);
