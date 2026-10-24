import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { ActionButton, AutoRefresh } from "@/components/client";
import { Card, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { AGENT_ROLES } from "@/lib/agents";
import { callStats, POSITIVE, roleWhere } from "@/lib/callstats";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { fmtDate, fullName, usd } from "@/lib/util";
import { syncCallsAction } from "../../../actions/agents";

type SP = { days?: string; outcome?: string; campaign?: string; dir?: string; q?: string; flagged?: string; page?: string };
const PAGE = 50;
const mins = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");

export default async function AgentCalls({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const { role } = await params;
  const meta = role === "team" ? { key: "team", label: "Team (your own calls)" } : AGENT_ROLES.find((r) => r.key === role);
  if (!meta) notFound();
  const sp = await searchParams;
  const days = Math.min(365, Math.max(1, Number(sp.days) || 30));
  const since = new Date(Date.now() - days * 864e5);
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.InteractionWhereInput = {
    workspaceId: ws,
    channel: "call",
    ...roleWhere(role),
    createdAt: { gte: since },
    ...(sp.outcome && sp.outcome !== "positive" ? { outcome: sp.outcome } : {}),
    ...(sp.campaign ? { campaignId: sp.campaign } : {}),
    ...(sp.dir ? { direction: sp.dir } : {}),
    AND: [
      ...(sp.outcome === "positive" ? [{ OR: POSITIVE.map((o) => ({ intel: { path: ["outcome"], equals: o } })) }] : []),
      ...(sp.q ? [{ OR: [{ contact: { firstName: { contains: sp.q, mode: "insensitive" as const } } }, { contact: { lastName: { contains: sp.q, mode: "insensitive" as const } } }, { toAddr: { contains: sp.q } }, { fromAddr: { contains: sp.q } }, { summary: { contains: sp.q, mode: "insensitive" as const } }] }] : []),
    ],
  };
  const [stats, calls, total, campaigns, agent, perMin] = await Promise.all([
    callStats(ws, roleWhere(role), since),
    db.interaction.findMany({ where, include: { contact: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.interaction.count({ where }),
    db.campaign.findMany({ where: { workspaceId: ws }, select: { id: true, name: true } }),
    role === "team" ? null : db.agent.findFirst({ where: { workspaceId: ws, role } }),
    setting(ws, "COST_PER_CALL_MINUTE").then((v) => Number(v || 0.12) || 0.12),
  ]);
  const shown = sp.flagged ? calls.filter((i) => ((i.intel as { qa?: { flags: { severity: string }[] } } | null)?.qa?.flags || []).some((f) => f.severity === "high")) : calls;
  const opps = await db.opportunity.findMany({ where: { id: { in: shown.map((i) => i.opportunityId).filter(Boolean) as string[] } }, include: { property: true } });
  const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  const pageHref = (n: number) => {
    const u = new URLSearchParams(q);
    u.set("page", String(n));
    return `/agents/${role}?${u}`;
  };
  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <PageHeader
        back={{ href: "/agents", label: "Agents & calls" }}
        title={`${agent?.name ? `${agent.name} · ` : ""}${meta.label}`}
        sub={`Last ${days} days${agent ? ` · prompt v${agent.version}` : ""}`}
        actions={
          <>
            {agent && (
              <Link href={`/settings/agents/${agent.id}`} className="btn btn-ghost btn-sm">
                Agent settings
              </Link>
            )}
            {role !== "team" && can(c.role, "calls") && (
              <ActionButton action={syncCallsAction} className="btn btn-ghost btn-sm">
                Sync from Retell
              </ActionButton>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Calls" value={stats.calls} />
        <Stat label="Connect rate" value={stats.calls ? `${Math.round(stats.connectRate * 100)}%` : "—"} sub={`${stats.connected} connected`} />
        <Stat label="Avg talk time" value={mins(stats.avgSec)} />
        <Stat label="Positive outcomes" value={stats.positive} tone="good" />
        <Stat label="Quality" value={stats.qaAvg ?? "—"} sub={stats.flagged ? `${stats.flagged} with rule breaches` : "no breaches"} tone={stats.flagged ? "bad" : undefined} />
        <Stat label="Cost" value={usd(stats.cost)} sub={stats.costPerDeal !== null ? `${usd(stats.costPerDeal)} per deal under contract` : `${stats.minutes} min`} />
      </div>
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="days" value={days} />
        <input name="q" defaultValue={sp.q} placeholder="Name, number or words in the summary" className="field max-w-xs" />
        <select name="outcome" defaultValue={sp.outcome || ""} className="field w-auto">
          <option value="">All outcomes</option>
          <option value="positive">Positive outcomes</option>
          {["conversation", "no_answer", "voicemail", "busy", "failed", "dnc"].map((o) => (
            <option key={o} value={o}>
              {label(o)}
            </option>
          ))}
        </select>
        <select name="dir" defaultValue={sp.dir || ""} className="field w-auto">
          <option value="">In and out</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <select name="campaign" defaultValue={sp.campaign || ""} className="field w-auto">
          <option value="">All campaigns</option>
          {campaigns.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="flagged" value="1" defaultChecked={!!sp.flagged} /> Rule breaches only
        </label>
        <button className="btn btn-ghost">Filter</button>
      </form>
      <Card pad={false}>
        {shown.length ? (
          <ul className="divide-y divide-line">
            {shown.map((i) => {
              const qa = (i.intel as { qa?: { score: number; flags: { rule: string; severity: string; quote: string }[] }; outcome?: string } | null)?.qa;
              const aiOutcome = (i.intel as { outcome?: string } | null)?.outcome;
              const opp = opps.find((o) => o.id === i.opportunityId);
              return (
                <li key={i.id} className="space-y-1.5 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {i.direction === "inbound" ? "⬅" : "➡"} {i.contact ? <Link href={`/contacts/${i.contactId}`} className="hover:text-brand">{fullName(i.contact)}</Link> : i.direction === "inbound" ? i.fromAddr : i.toAddr}
                      </span>
                      {opp && (
                        <Link href={`/deals/${opp.id}`} className="text-xs text-brand underline">
                          {opp.property.address}
                        </Link>
                      )}
                      {i.status === "in_progress" && <span className="badge badge-good">Live now</span>}
                      {i.outcome && <StatusBadge s={i.outcome} />}
                      {aiOutcome && aiOutcome !== i.outcome && <span className="badge">{label(aiOutcome)}</span>}
                      {i.transferred && <span className="badge badge-warn">Transferred</span>}
                      {qa && <span className={`badge ${qa.flags.some((f) => f.severity === "high") ? "badge-bad" : "badge-good"}`}>Quality {Math.round(qa.score)}</span>}
                    </div>
                    <span className="text-xs text-muted">
                      {fmtDate(i.createdAt, true)} · {mins(i.durationSec)}
                      {i.durationSec ? ` · ${usd(Math.round((i.durationSec / 60) * perMin * 100) / 100)}` : ""}
                    </span>
                  </div>
                  {i.summary && <p className="text-muted">{i.summary}</p>}
                  {i.tools.length > 0 && <p className="text-xs text-muted">Tools used: {i.tools.map((t) => t.replace(/_/g, " ")).join(", ")}</p>}
                  {qa?.flags.length ? <p className="text-xs text-bad">{qa.flags.map((f) => `${f.rule}: “${f.quote.slice(0, 80)}”`).join(" · ")}</p> : null}
                  {i.endReason && <p className="text-xs text-muted">Ended: {i.endReason.replace(/_/g, " ")}</p>}
                  {i.recordingUrl && <audio controls preload="none" src={i.recordingUrl} className="h-8 w-full max-w-xl" />}
                  {i.body && (
                    <details>
                      <summary className="cursor-pointer text-xs text-brand">Transcript</summary>
                      <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-soft p-2 text-xs whitespace-pre-wrap">{i.body}</pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No calls match">{role === "team" ? "Calls you place from the app or the power dialer appear here." : "Calls appear here as soon as the agent makes or answers them."}</Empty>
        )}
      </Card>
      {total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">
            {(page - 1) * PAGE + 1}–{Math.min(total, page * PAGE)} of {total}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="btn btn-ghost btn-sm">
                Newer
              </Link>
            )}
            {page * PAGE < total && (
              <Link href={pageHref(page + 1)} className="btn btn-ghost btn-sm">
                Older
              </Link>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
