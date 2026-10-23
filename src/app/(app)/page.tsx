import Link from "next/link";
import { contractHref } from "@/lib/contracts";
import { AutoRefresh } from "@/components/client";
import { Card, Empty, HotBadge, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { dealScope, pageCtx } from "@/lib/session";
import { ago, fmtDate, usd } from "@/lib/util";

export default async function CommandCentre() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const now = new Date();
  const dayAgo = new Date(Date.now() - 864e5);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [approvals, hot, nearAgreement, tasks, callsToday, textsToday, underContract, closing, paidMonth, pipeline, deadlines, packs, recent, running] = await Promise.all([
    db.approval.findMany({ where: { workspaceId: ws, status: "pending" }, orderBy: { createdAt: "asc" }, take: 6 }),
    db.opportunity.findMany({ where: { workspaceId: ws, hotScore: { gte: 50 }, stage: { notIn: ["CLOSED"] }, ...dealScope(c) }, include: { property: true, interests: { where: { serious: true } } }, orderBy: { hotScore: "desc" }, take: 5 }),
    db.opportunity.count({ where: { workspaceId: ws, verificationSentAt: { not: null }, approvedAt: null, ...dealScope(c) } }),
    db.task.findMany({ where: { workspaceId: ws, status: "open", dueAt: { lte: new Date(Date.now() + 864e5) }, OR: [{ assignee: null }, { assignee: c.user.id }, { assignee: { not: { startsWith: "agent:" } } }] }, orderBy: [{ priority: "asc" }, { dueAt: "asc" }], take: 8 }),
    db.interaction.count({ where: { workspaceId: ws, channel: "call", createdAt: { gte: dayAgo } } }),
    db.interaction.count({ where: { workspaceId: ws, channel: "sms", createdAt: { gte: dayAgo } } }),
    db.opportunity.count({ where: { workspaceId: ws, stage: { in: ["UNDER_CONTRACT", "DISPOSITION"] }, ...dealScope(c) } }),
    db.opportunity.count({ where: { workspaceId: ws, stage: "CLOSING", ...dealScope(c) } }),
    db.payment.aggregate({ where: { workspaceId: ws, direction: "in", status: "received", updatedAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.opportunity.groupBy({ by: ["stage"], where: { workspaceId: ws, ...dealScope(c) }, _count: true }),
    db.contract.findMany({ where: { workspaceId: ws, status: "effective", OR: [{ emdDueAt: { gte: now, lte: new Date(Date.now() + 5 * 864e5) } }, { optionEndsAt: { gte: now, lte: new Date(Date.now() + 5 * 864e5) } }, { closingAt: { gte: now, lte: new Date(Date.now() + 7 * 864e5) } }] }, take: 6 }),
    db.statePack.findMany({ where: { workspaceId: ws }, select: { state: true, status: true } }),
    db.interaction.findMany({ where: { workspaceId: ws, channel: { in: ["call", "sms", "email"] } }, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.campaign.count({ where: { workspaceId: ws, status: "running" } }),
  ]);
  const stageCount = Object.fromEntries(pipeline.map((p) => [p.stage, p._count]));
  const funnel = [
    ["Outreach", ["NEW", "ELIGIBLE", "OUTREACH"]],
    ["Engaged", ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY"]],
    ["Underwriting", ["UNDERWRITING", "OFFER_READY"]],
    ["Negotiating", ["NEGOTIATION", "CONTRACT_PREPARATION"]],
    ["Under contract", ["UNDER_CONTRACT", "DISPOSITION"]],
    ["Closing", ["CLOSING"]],
    ["Closed", ["CLOSED"]],
  ] as const;
  const max = Math.max(1, ...funnel.map(([, ss]) => ss.reduce((a, s) => a + (stageCount[s] || 0), 0)));
  const activePacks = packs.filter((p) => p.status === "active");

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <PageHeader title={`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, ${c.user.name.split(" ")[0]}`} sub={`${c.workspace.name} · ${activePacks.length ? `active in ${activePacks.map((p) => p.state).join(", ")}` : "no State Pack active yet"} · ${running} campaign${running === 1 ? "" : "s"} running`} />

      {!activePacks.length && !c.workspace.isDemo && (
        <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Outreach is off until a State Pack is reviewed and activated. <Link href="/settings/states" className="font-semibold underline">Review State Packs</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Needs you" value={approvals.length} sub="approvals waiting" href="/approvals" tone={approvals.length ? "warn" : undefined} />
        <Stat label="Hot deals" value={hot.filter((h) => h.hotScore >= 70).length} sub={`${nearAgreement} near agreement`} href="/deals?view=hot" tone="hot" />
        <Stat label="Under contract" value={underContract + closing} sub={`${closing} closing`} href="/closing" />
        <Stat label="Paid this month" value={usd(paidMonth._sum.amount || 0)} sub={`${callsToday} calls · ${textsToday} texts in 24h`} tone="good" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Waiting for your decision" actions={<Link href="/approvals" className="text-sm text-brand">All</Link>} className="lg:col-span-2" pad={false}>
          {approvals.length ? (
            <ul className="divide-y divide-line">
              {approvals.map((a) => (
                <li key={a.id}>
                  <Link href={`/approvals#${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-soft">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted">
                        {a.kind.replace(/_/g, " ")} · {ago(a.createdAt)}
                      </div>
                    </div>
                    <span className="btn btn-primary btn-sm">Review</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing waiting">Final offers, earnest money, payments and over-limit requests appear here.</Empty>
          )}
        </Card>

        <Card title="Today's tasks" actions={<Link href="/ops?tab=tasks" className="text-sm text-brand">All</Link>} pad={false}>
          {tasks.length ? (
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="px-4 py-2.5 text-sm">
                  <Link href={t.entityType === "opportunity" && t.entityId ? `/deals/${t.entityId}` : t.contactId ? `/contacts/${t.contactId}` : "/ops?tab=tasks"} className="block hover:text-brand">
                    <span className={t.priority === 1 ? "font-semibold" : ""}>{t.title}</span>
                    <span className="block text-xs text-muted">{t.dueAt < now ? `due ${ago(t.dueAt)}` : fmtDate(t.dueAt, true)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="All clear" />
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Hot deals" className="lg:col-span-2" pad={false}>
          {hot.length ? (
            <ul className="divide-y divide-line">
              {hot.map((o) => (
                <li key={o.id}>
                  <Link href={`/deals/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-soft">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{o.property.address}</div>
                      <div className="text-xs text-muted">
                        {o.property.city}, {o.property.state} · {o.interests.length} serious buyer{o.interests.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <HotBadge score={o.hotScore} />
                      <StatusBadge s={o.stage} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No hot deals yet">A deal turns hot when two or more serious investors respond.</Empty>
          )}
        </Card>

        <Card title="Pipeline">
          <div className="space-y-2">
            {funnel.map(([label, ss]) => {
              const n = ss.reduce((a, s) => a + (stageCount[s] || 0), 0);
              return (
                <Link key={label} href={`/deals?stage=${ss.join(",")}`} className="block">
                  <div className="flex justify-between text-sm">
                    <span>{label}</span>
                    <span className="tnum text-muted">{n}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-soft">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Deadlines (next 7 days)" pad={false}>
          {deadlines.length ? (
            <ul className="divide-y divide-line">
              {deadlines.map((k) => {
                const f = k.fields as Record<string, string>;
                const items = [k.emdDueAt && ["Earnest money", k.emdDueAt], k.optionEndsAt && ["Option ends", k.optionEndsAt], k.closingAt && ["Closing", k.closingAt]].filter(Boolean) as [string, Date][];
                return (
                  <li key={k.id}>
                    <Link href={contractHref(k)} className="block px-4 py-3 text-sm hover:bg-soft">
                      <div className="font-medium">{f.property_address}</div>
                      <div className="text-xs text-muted">{items.map(([l, d]) => `${l} ${fmtDate(d)}`).join(" · ")}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="No deadlines this week" />
          )}
        </Card>
        <Card title="Latest conversations" actions={<Link href="/ops" className="text-sm text-brand">Activity</Link>} pad={false}>
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((i) => (
                <li key={i.id}>
                  <Link href={i.contactId ? `/contacts/${i.contactId}` : "/ops"} className="block px-4 py-3 text-sm hover:bg-soft">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        {i.channel === "call" ? "📞" : i.channel === "sms" ? "💬" : "✉️"} {i.contact ? `${i.contact.firstName} ${i.contact.lastName}`.trim() || i.contact.company : i.fromAddr || "Unknown"}
                      </span>
                      <span className="text-xs text-muted">{ago(i.createdAt)}</span>
                    </div>
                    <div className="line-clamp-2 text-xs text-muted">{i.summary || i.body?.slice(0, 160) || i.outcome || i.status}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No conversations yet" />
          )}
        </Card>
      </div>
    </div>
  );
}


