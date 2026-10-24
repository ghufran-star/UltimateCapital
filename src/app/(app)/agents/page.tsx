import Link from "next/link";
import { ActionButton, AutoRefresh } from "@/components/client";
import { Card, PageHeader, Stat } from "@/components/ui";
import { AGENT_ROLES } from "@/lib/agents";
import { callStats, roleWhere } from "@/lib/callstats";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { usd } from "@/lib/util";
import { syncCallsAction } from "../../actions/agents";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mins = (s: number) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : "—");

export default async function Agents({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const days = Math.min(365, Math.max(1, Number((await searchParams).days) || 30));
  const since = new Date(Date.now() - days * 864e5);
  const agents = await db.agent.findMany({ where: { workspaceId: ws } });
  const rows = await Promise.all(
    [...AGENT_ROLES.map((r) => ({ key: r.key as string, label: r.label as string })), { key: "team", label: "Team (your own calls)" }].map(async (r) => ({ ...r, agent: agents.find((a) => a.role === r.key), s: await callStats(ws, roleWhere(r.key), since) }))
  );
  const all = rows.reduce(
    (a, r) => ({ calls: a.calls + r.s.calls, connected: a.connected + r.s.connected, cost: a.cost + r.s.cost, live: a.live + r.s.live, flagged: a.flagged + r.s.flagged }),
    { calls: 0, connected: 0, cost: 0, live: 0, flagged: 0 }
  );
  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Agents & calls"
        sub={`Every call by every AI agent and your team, last ${days} days.`}
        actions={
          <>
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/agents?days=${d}`} className={`btn btn-sm ${d === days ? "btn-primary" : "btn-ghost"}`}>
                {d} days
              </Link>
            ))}
            {can(c.role, "calls") && (
              <ActionButton action={syncCallsAction} className="btn btn-ghost btn-sm">
                Sync from Retell
              </ActionButton>
            )}
            <a href="/api/export/calls" className="btn btn-ghost btn-sm">
              Calls CSV
            </a>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Calls" value={all.calls} />
        <Stat label="Connected" value={all.connected} sub={all.calls ? pct(all.connected / all.calls) : "—"} />
        <Stat label="On a call now" value={all.live} tone={all.live ? "good" : undefined} />
        <Stat label="Call cost" value={usd(all.cost)} />
        <Stat label="Rule breaches" value={all.flagged} tone={all.flagged ? "bad" : undefined} sub="high-severity QA flags" />
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Connect rate</th>
                <th className="text-right">Avg talk time</th>
                <th className="text-right">Positive outcomes</th>
                <th className="text-right">Transfers</th>
                <th className="text-right">Quality</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Deals under contract</th>
                <th className="text-right">Cost per deal</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="link">
                  <td>
                    <Link href={`/agents/${r.key}?days=${days}`} className="font-medium hover:text-brand">
                      {r.agent?.name ? `${r.agent.name} · ` : ""}
                      {r.label}
                    </Link>
                    {r.key !== "team" && (
                      <div className="text-xs text-muted">
                        {r.agent ? (r.agent.active ? (r.agent.retellAgentId ? "Synced to Retell" : "Not synced") : "Off") : "Not set up"} ·{" "}
                        {r.agent && (
                          <Link href={`/settings/agents/${r.agent.id}`} className="underline">
                            settings
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="text-right tnum">{r.s.calls}</td>
                  <td className="text-right tnum">{r.s.calls ? pct(r.s.connectRate) : "—"}</td>
                  <td className="text-right tnum">{mins(r.s.avgSec)}</td>
                  <td className="text-right tnum">{r.s.positive}</td>
                  <td className="text-right tnum">{r.s.transfers}</td>
                  <td className={`text-right tnum ${r.s.flagged ? "text-bad" : ""}`}>{r.s.qaAvg ?? "—"}{r.s.flagged ? ` (${r.s.flagged}⚠)` : ""}</td>
                  <td className="text-right tnum">{usd(r.s.cost)}</td>
                  <td className="text-right tnum">{r.s.deals}</td>
                  <td className="text-right tnum">{r.s.costPerDeal !== null ? usd(r.s.costPerDeal) : "—"}</td>
                  <td>{r.s.live ? <span className="badge badge-good">{r.s.live} live</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted">Connected = answered and talked for more than 20 seconds. Positive outcomes = interested, callback booked, offer discussed or agreed in principle. Cost uses your cost per call minute in Settings → Integrations.</p>
    </div>
  );
}
