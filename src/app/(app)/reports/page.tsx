import Link from "next/link";
import { Card, PageHeader, Stat } from "@/components/ui";
import { spendSince } from "@/lib/controls";
import { db } from "@/lib/db";
import { dealScope, pageCtx } from "@/lib/session";
import { label, SELLER_STAGES } from "@/lib/stages";
import { usd } from "@/lib/util";

const idx = (s: string) => SELLER_STAGES.indexOf(s as (typeof SELLER_STAGES)[number]);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function Reports({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const days = [30, 90, 365].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 90;
  const since = new Date(Date.now() - days * 864e5);
  const [deals, campaigns, paid, expected, calls, interests, spend] = await Promise.all([
    db.opportunity.findMany({ where: { workspaceId: ws, createdAt: { gte: since }, ...dealScope(c) }, select: { id: true, stage: true, campaignId: true, createdAt: true, contractPrice: true } }),
    db.campaign.findMany({ where: { workspaceId: ws } }),
    db.payment.findMany({ where: { workspaceId: ws, direction: "in", status: "received", updatedAt: { gte: new Date(Date.now() - 365 * 864e5) } }, select: { amount: true, updatedAt: true, opportunityId: true } }),
    db.payment.aggregate({ where: { workspaceId: ws, direction: "in", status: { in: ["due", "approved"] } }, _sum: { amount: true } }),
    db.interaction.findMany({ where: { workspaceId: ws, channel: "call", direction: "outbound", createdAt: { gte: since } }, select: { outcome: true, provider: true, intel: true, campaignId: true, durationSec: true } }),
    db.buyerInterest.findMany({ where: { opportunity: { workspaceId: ws }, presentedAt: { gte: since } }, include: { contact: { select: { id: true, firstName: true, lastName: true, company: true } } } }),
    spendSince(ws, since),
  ]);
  const reached = (s: string) => deals.filter((d) => idx(d.stage) >= idx(s)).length;
  const funnel = [
    ["Leads", deals.length],
    ["Engaged", reached("ENGAGED")],
    ["Offer ready", reached("OFFER_READY")],
    ["Negotiating", reached("NEGOTIATION")],
    ["Under contract", reached("UNDER_CONTRACT")],
    ["Closed", reached("CLOSED")],
  ] as const;
  const feesPeriod = paid.filter((p) => p.updatedAt >= since).reduce((a, p) => a + p.amount, 0);
  const closed = reached("CLOSED");
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (11 - i));
    const key = d.toISOString().slice(0, 7);
    return { key, label: d.toLocaleDateString("en-US", { month: "short" }), total: paid.filter((p) => p.updatedAt.toISOString().slice(0, 7) === key).reduce((a, p) => a + p.amount, 0) };
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const roles = new Map<string, { calls: number; convos: number; qa: number[]; flags: number }>();
  for (const k of calls.filter((x) => x.provider === "retell")) {
    const m = (k.intel || {}) as { agentRole?: string; qa?: { score: number; flags: unknown[] } };
    const r = m.agentRole || "unknown";
    const row = roles.get(r) || { calls: 0, convos: 0, qa: [], flags: 0 };
    row.calls++;
    if (k.outcome && !["no_answer", "voicemail", "busy", "failed"].includes(k.outcome)) row.convos++;
    if (m.qa) {
      row.qa.push(m.qa.score);
      row.flags += m.qa.flags.length;
    }
    roles.set(r, row);
  }
  const team = calls.filter((x) => x.provider !== "retell");
  const byBuyer = new Map<string, { name: string; sent: number; replied: number; offers: number }>();
  for (const i of interests) {
    const r = byBuyer.get(i.contactId) || { name: `${i.contact.firstName} ${i.contact.lastName}`.trim() || i.contact.company || "Buyer", sent: 0, replied: 0, offers: 0 };
    r.sent++;
    if (i.respondedAt) r.replied++;
    if (i.priceMentioned) r.offers++;
    byBuyer.set(i.contactId, r);
  }
  const buyersTop = [...byBuyer.entries()].sort((a, b) => b[1].replied - a[1].replied || b[1].sent - a[1].sent).slice(0, 10);
  const replied = interests.filter((i) => i.respondedAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        sub={`Last ${days} days${c.states.length ? ` · ${c.states.join(", ")}` : ""}`}
        actions={
          <div className="flex gap-1 text-sm">
            {[30, 90, 365].map((d) => (
              <Link key={d} href={`/reports?days=${d}`} className={`rounded-full px-3 py-1.5 ${d === days ? "bg-ink text-bg" : "bg-soft"}`}>
                {d === 365 ? "12 months" : `${d} days`}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fees received" value={usd(feesPeriod)} sub={`${usd(expected._sum.amount || 0)} expected in pipeline`} tone="good" />
        <Stat label="Deals closed" value={closed} sub={closed ? `${usd(feesPeriod / Math.max(1, closed))} per deal` : "—"} />
        <Stat label="Outreach spend (est.)" value={usd(spend)} sub="AI call minutes + texts" />
        <Stat label="Cost per contract" value={reached("UNDER_CONTRACT") ? usd(spend / reached("UNDER_CONTRACT")) : "—"} sub={`Cost per engaged lead ${reached("ENGAGED") ? usd(spend / reached("ENGAGED")) : "—"}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Funnel (deals created in the period)">
          <div className="space-y-2">
            {funnel.map(([l, n], i) => (
              <div key={l}>
                <div className="flex justify-between text-sm">
                  <span>{l}</span>
                  <span className="tnum text-muted">
                    {n} {i > 0 && <span className="text-xs">({pct(n, funnel[i - 1][1])} of previous)</span>}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-soft">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(n / Math.max(1, funnel[0][1])) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Fees received by month">
          <div className="flex h-40 items-end gap-1.5">
            {months.map((m) => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1" title={`${m.label}: ${usd(m.total)}`}>
                <div className="w-full rounded-t bg-brand" style={{ height: `${(m.total / maxMonth) * 100}%`, minHeight: m.total ? 4 : 0 }} />
                <span className="text-[10px] text-muted">{m.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Campaigns" pad={false}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Engaged</th>
                <th className="text-right">Contracts</th>
                <th className="text-right">Closed</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((k) => {
                const ds = deals.filter((d) => d.campaignId === k.id);
                const cs = calls.filter((x) => x.campaignId === k.id);
                if (!ds.length && !cs.length) return null;
                return (
                  <tr key={k.id}>
                    <td>
                      <Link href={`/campaigns/${k.id}`} className="hover:text-brand">
                        {k.name}
                      </Link>
                    </td>
                    <td className="text-right tnum">{ds.length}</td>
                    <td className="text-right tnum">{cs.length}</td>
                    <td className="text-right tnum">{ds.filter((d) => idx(d.stage) >= idx("ENGAGED")).length}</td>
                    <td className="text-right tnum">{ds.filter((d) => idx(d.stage) >= idx("UNDER_CONTRACT")).length}</td>
                    <td className="text-right tnum">{ds.filter((d) => d.stage === "CLOSED").length}</td>
                  </tr>
                );
              })}
              <tr>
                <td className="text-muted">Other sources (imports, manual, inbound)</td>
                <td className="text-right tnum">{deals.filter((d) => !d.campaignId).length}</td>
                <td className="text-right tnum">{calls.filter((x) => !x.campaignId).length}</td>
                <td className="text-right tnum">{deals.filter((d) => !d.campaignId && idx(d.stage) >= idx("ENGAGED")).length}</td>
                <td className="text-right tnum">{deals.filter((d) => !d.campaignId && idx(d.stage) >= idx("UNDER_CONTRACT")).length}</td>
                <td className="text-right tnum">{deals.filter((d) => !d.campaignId && d.stage === "CLOSED").length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="AI agents" pad={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Conversations</th>
                <th className="text-right">Quality</th>
                <th className="text-right">Rule flags</th>
              </tr>
            </thead>
            <tbody>
              {[...roles.entries()].map(([r, v]) => (
                <tr key={r}>
                  <td>{label(r)}</td>
                  <td className="text-right tnum">{v.calls}</td>
                  <td className="text-right tnum">
                    {v.convos} <span className="text-xs text-muted">{pct(v.convos, v.calls)}</span>
                  </td>
                  <td className="text-right tnum">{v.qa.length ? Math.round(v.qa.reduce((a, b) => a + b, 0) / v.qa.length) : "—"}</td>
                  <td className={`text-right tnum ${v.flags ? "text-bad" : ""}`}>{v.flags}</td>
                </tr>
              ))}
              <tr>
                <td className="text-muted">Team calls</td>
                <td className="text-right tnum">{team.length}</td>
                <td className="text-right tnum">{team.filter((x) => x.outcome && !["no_answer", "voicemail"].includes(x.outcome)).length}</td>
                <td className="text-right">—</td>
                <td className="text-right">—</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title={`Buyers · ${interests.length} deals sent · ${pct(replied, interests.length)} replied`} pad={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Buyer</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Replied</th>
                <th className="text-right">Offers</th>
              </tr>
            </thead>
            <tbody>
              {buyersTop.map(([id, b]) => (
                <tr key={id}>
                  <td>
                    <Link href={`/contacts/${id}`} className="hover:text-brand">
                      {b.name}
                    </Link>
                  </td>
                  <td className="text-right tnum">{b.sent}</td>
                  <td className="text-right tnum">{b.replied}</td>
                  <td className="text-right tnum">{b.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
