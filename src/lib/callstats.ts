import { rolesFor } from "./agents";
import type { Prisma } from "@prisma/client";
import { setting } from "./config";
import { db } from "./db";

// Call numbers per AI agent (or for the team's own calls): volume, connects, length, outcomes, cost, quality.

export const POSITIVE = ["interested", "callback", "offer_discussed", "agreed_in_principle", "info_gathered"];

export type CallStats = { calls: number; connected: number; connectRate: number; avgSec: number; minutes: number; cost: number; positive: number; transfers: number; qaAvg: number | null; flagged: number; live: number; deals: number; costPerDeal: number | null };

export async function callStats(ws: string, where: Prisma.InteractionWhereInput, since: Date): Promise<CallStats> {
  const base: Prisma.InteractionWhereInput = { workspaceId: ws, channel: "call", ...where };
  const calls = await db.interaction.findMany({ where: { ...base, createdAt: { gte: since } }, select: { outcome: true, durationSec: true, transferred: true, intel: true, status: true, opportunityId: true, contactId: true } });
  const live = await db.interaction.count({ where: { ...base, status: "in_progress", createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } } });
  const perMin = Number((await setting(ws, "COST_PER_CALL_MINUTE")) || 0.12) || 0.12;
  const connected = calls.filter((c) => c.outcome && !["no_answer", "voicemail", "busy", "failed"].includes(c.outcome) && (c.durationSec || 0) > 20);
  const secs = calls.reduce((a, c) => a + (c.durationSec || 0), 0);
  const qa = calls.map((c) => (c.intel as { qa?: { score: number; flags: { severity: string }[] } } | null)?.qa).filter(Boolean) as { score: number; flags: { severity: string }[] }[];
  const positive = calls.filter((c) => {
    const o = (c.intel as { outcome?: string } | null)?.outcome || c.outcome || "";
    return POSITIVE.includes(o);
  }).length;
  const oppIds = [...new Set(calls.map((c) => c.opportunityId).filter(Boolean) as string[])];
  const deals = oppIds.length ? await db.opportunity.count({ where: { id: { in: oppIds }, stage: { in: ["UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"] } } }) : 0;
  const cost = Math.round((secs / 60) * perMin * 100) / 100;
  return {
    calls: calls.length,
    connected: connected.length,
    connectRate: calls.length ? connected.length / calls.length : 0,
    avgSec: connected.length ? Math.round(connected.reduce((a, c) => a + (c.durationSec || 0), 0) / connected.length) : 0,
    minutes: Math.round(secs / 60),
    cost,
    positive,
    transfers: calls.filter((c) => c.transferred).length,
    qaAvg: qa.length ? Math.round(qa.reduce((a, q) => a + q.score, 0) / qa.length) : null,
    flagged: qa.filter((q) => q.flags.some((f) => f.severity === "high")).length,
    live,
    deals,
    costPerDeal: deals ? Math.round(cost / deals) : null,
  };
}

/** Which interactions belong to a role key ("team" = people's own calls). */
export function roleWhere(role: string): Prisma.InteractionWhereInput {
  return role === "team" ? { provider: "twilio" } : { provider: "retell", agentRole: { in: rolesFor(role) } };
}
