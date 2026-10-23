import Link from "next/link";
import { contractHref } from "@/lib/contracts";
import { ActionForm, RowLink, Submit } from "@/components/client";
import { Card, Empty, PageHeader, Stat, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { can, dealScope, pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago, fmtDate, usd } from "@/lib/util";
import { reconcileAction } from "../../actions/ops";

export default async function Closing({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const tab = (await searchParams).tab || "transactions";
  const [txs, contracts, payments, titleCos] = await Promise.all([
    db.transaction.findMany({ where: { workspaceId: ws, opportunity: dealScope(c) }, include: { opportunity: { include: { property: true } }, titleCompany: true }, orderBy: [{ closingAt: "asc" }] }),
    db.contract.findMany({ where: { workspaceId: ws, status: { in: ["draft", "sent", "viewed", "partially_signed"] } }, include: { signers: true }, orderBy: { updatedAt: "desc" } }),
    db.payment.findMany({ where: { workspaceId: ws, status: { notIn: ["cancelled"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.titleCompany.findMany({ where: { workspaceId: ws } }),
  ]);
  const open = txs.filter((t) => !["CLOSED", "RECONCILED"].includes(t.stage));
  const expected = payments.filter((p) => p.direction === "in" && ["due", "approved"].includes(p.status)).reduce((a, p) => a + p.amount, 0);
  const received = payments.filter((p) => p.direction === "in" && p.status === "received").reduce((a, p) => a + p.amount, 0);
  const outDue = payments.filter((p) => p.direction === "out" && ["due", "awaiting_approval", "approved"].includes(p.status));
  const writable = !c.workspace.isDemo && can(c.role, "closing");
  return (
    <div>
      <PageHeader title="Contracts & closing" sub="E-signature, title, earnest money, closing and getting paid." actions={<><Link href="/closing/documents" className="btn btn-primary">Send a PDF for signature</Link><a href="/api/export/payments" className="btn btn-ghost">Payments CSV</a><Link href="/settings/title" className="btn btn-ghost">Title companies ({titleCos.length})</Link></>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open closings" value={open.length} />
        <Stat label="Awaiting signature" value={contracts.length} tone={contracts.length ? "warn" : undefined} />
        <Stat label="Fees expected" value={usd(expected)} />
        <Stat label="Fees received" value={usd(received)} tone="good" />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "transactions", label: "Closings", href: "/closing", count: open.length },
          { key: "signatures", label: "Signatures", href: "/closing?tab=signatures", count: contracts.length },
          { key: "payments", label: "Payments", href: "/closing?tab=payments", count: outDue.length },
        ]}
      />
      {tab === "transactions" && (
        <Card pad={false}>
          {txs.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Stage</th>
                    <th>Title</th>
                    <th>Checklist</th>
                    <th>Closing</th>
                    <th className="text-right">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => {
                    const items = (t.checklist || []) as unknown as { done: boolean }[];
                    const d = items.filter((i) => i.done).length;
                    return (
                      <RowLink key={t.id} href={`/deals/${t.opportunityId}?tab=closing`}>
                        <td>
                          <div className="font-medium">{t.opportunity.property.address}</div>
                          <div className="text-xs text-muted">
                            {t.opportunity.property.city}, {t.opportunity.property.state}
                          </div>
                        </td>
                        <td>
                          <StatusBadge s={t.stage} />
                        </td>
                        <td className="text-sm">{t.titleCompany?.name || <span className="text-warn">not chosen</span>}</td>
                        <td>
                          <div className="h-2 w-24 rounded-full bg-soft">
                            <div className="h-2 rounded-full bg-brand" style={{ width: `${items.length ? (d / items.length) * 100 : 0}%` }} />
                          </div>
                          <div className="text-xs text-muted">
                            {d}/{items.length}
                          </div>
                        </td>
                        <td className="text-sm">{fmtDate(t.closingAt)}</td>
                        <td className="text-right tnum">{usd(t.assignmentFee)}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No closings yet">A closing file opens automatically when a seller contract becomes effective.</Empty>
          )}
        </Card>
      )}
      {tab === "signatures" && (
        <Card pad={false}>
          {contracts.length ? (
            <ul className="divide-y divide-line">
              {contracts.map((k) => {
                const f = k.fields as Record<string, string>;
                return (
                  <li key={k.id}>
                    <Link href={contractHref(k)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-soft">
                      <div>
                        <div className="font-medium">
                          {label(k.kind)} · {f.property_address}
                        </div>
                        <div className="text-xs text-muted">{k.signers.map((s) => `${s.name}: ${s.status}`).join(" · ")}</div>
                      </div>
                      <div className="text-right">
                        <StatusBadge s={k.status} />
                        <div className="text-xs text-muted">{ago(k.updatedAt)}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="Nothing waiting for signature" />
          )}
        </Card>
      )}
      {tab === "payments" && (
        <div className="space-y-5">
          <Card pad={false}>
            {payments.length ? (
              <div className="overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                      <th>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <RowLink key={p.id} href={p.opportunityId ? `/deals/${p.opportunityId}?tab=closing` : "/closing?tab=payments"}>
                        <td>
                          {label(p.kind)} <span className="text-xs text-muted">{p.direction === "in" ? "incoming" : `to ${p.payee || "payee"}`}</span>
                          {p.reference && <div className="text-xs text-muted">{p.reference}</div>}
                        </td>
                        <td className="text-right tnum">{usd(p.amount)}</td>
                        <td>
                          <StatusBadge s={p.status} />
                        </td>
                        <td className="text-xs">{fmtDate(p.dueAt)}</td>
                      </RowLink>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No payments" />
            )}
          </Card>
          {writable && (
            <Card title="Reconcile a bank statement">
              <ActionForm action={reconcileAction}>
                <input type="file" name="file" accept=".csv" className="field" />
                <textarea name="csv" rows={3} className="field font-mono text-xs" placeholder="date,description,amount" />
                <Submit className="btn btn-ghost">Match incoming fees</Submit>
                <p className="text-xs text-muted">Deposits that match an expected fee mark the deal paid and closed.</p>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
