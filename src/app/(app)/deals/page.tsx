import Link from "next/link";
import { cookies } from "next/headers";
import { ActionButton, ActionForm, RowLink, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { Card, Empty, HotBadge, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { US_STATES } from "@/lib/catalog";
import { db } from "@/lib/db";
import { DEAL_COLUMNS, DEFAULT_DEAL_COLUMNS, dealRow, type DealRow } from "@/lib/dealrows";
import { can, dealScope, pageCtx } from "@/lib/session";
import { ago, usd } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";
import { bulkDealsAction, dealColumnsAction, pitchDealAction } from "../../actions/deals";
import { BulkIdsClient, SelectAll } from "./bulk";

const VIEWS: Record<string, { label: string; stages?: string[] }> = {
  active: { label: "Active", stages: ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY", "NEGOTIATION", "CONTRACT_PREPARATION"] },
  qualified: { label: "Qualified & priced", stages: ["QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY", "NEGOTIATION", "CONTRACT_PREPARATION"] },
  hot: { label: "Hot" },
  contract: { label: "Under contract", stages: ["UNDER_CONTRACT", "DISPOSITION", "CLOSING"] },
  leads: { label: "Leads", stages: ["NEW", "ELIGIBLE", "OUTREACH"] },
  closed: { label: "Closed", stages: ["CLOSED"] },
  all: { label: "All" },
};

type SP = { view?: string; stage?: string; q?: string; state?: string; sort?: string; dir?: string; cols?: string | string[] };

const money = (n: number | null, signed = false) => (n === null ? "—" : signed && n > 0 ? `+${usd(n)}` : usd(n));

function cell(r: DealRow, key: string) {
  switch (key) {
    case "property":
      return (
        <>
          <div className="font-medium">{r.address}</div>
          <div className="text-xs text-muted">
            {r.place}
            {r.autopilotOff && <span className="ml-1 text-warn">· autopilot off</span>}
          </div>
        </>
      );
    case "stage":
      return (
        <div className="flex flex-wrap gap-1">
          <StatusBadge s={r.stage.toUpperCase().replace(/ /g, "_")} />
          {r.exception && <StatusBadge s={r.exception} />}
        </div>
      );
    case "hot":
      return <HotBadge score={r.hot} />;
    case "updatedAt":
      return <span className="text-xs text-muted">{ago(r.updatedAt)}</span>;
    case "gapSeller":
      return r.gapSeller === null ? "—" : <span className={r.gapSeller > 0 ? "text-warn" : "text-brand"}>{money(r.gapSeller, true)}</span>;
    case "investorRoom":
      return r.investorRoom === null ? "—" : <span className={r.investorRoom < 0 ? "text-bad" : "text-brand"}>{money(r.investorRoom, true)}</span>;
    case "maxBuy":
      return r.blocked ? <span className="text-xs text-warn">blocked</span> : money(r.maxBuy);
    default: {
      const col = DEAL_COLUMNS.find((c) => c.key === key);
      const v = r[key as keyof DealRow];
      if (col?.money) return money(v as number | null);
      return v === null || v === undefined || v === "" ? "—" : String(v);
    }
  }
}

export default async function Deals({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const view = sp.stage ? "custom" : sp.view && VIEWS[sp.view] ? sp.view : "active";
  const stages = sp.stage ? sp.stage.split(",") : VIEWS[view]?.stages;
  const q = sp.q?.trim();
  const saved = (await cookies()).get("uc_deal_cols")?.value;
  const cols = (sp.cols ? (Array.isArray(sp.cols) ? sp.cols : sp.cols.split(",")) : saved ? saved.split(",") : DEFAULT_DEAL_COLUMNS).filter((k) => DEAL_COLUMNS.some((c2) => c2.key === k));
  const [deals, rs, members] = await Promise.all([
    db.opportunity.findMany({
      where: {
        workspaceId: ws,
        ...dealScope(c),
        ...(stages ? { stage: { in: stages } } : {}),
        ...(view === "hot" ? { hotScore: { gte: 50 } } : {}),
        AND: [...(sp.state ? [{ property: { state: sp.state } }] : []), ...(q ? [{ OR: [{ property: { address: { contains: q, mode: "insensitive" as const } } }, { property: { city: { contains: q, mode: "insensitive" as const } } }, { property: { zip: q } }] }] : [])],
      },
      include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, interests: { select: { serious: true } } },
      orderBy: view === "hot" ? { hotScore: "desc" } : { updatedAt: "desc" },
      take: 400,
    }),
    activeRuleSet(ws),
    db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const sellers = await db.contact.findMany({ where: { id: { in: deals.map((d) => d.sellerId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true, company: true } });
  let rows = deals.map((d) => dealRow(d, rs.data, sellers.find((s) => s.id === d.sellerId) || null, members.find((m) => m.userId === d.assigneeId)?.user.name));
  const sort = sp.sort && DEAL_COLUMNS.some((x) => x.key === sp.sort) ? sp.sort : null;
  if (sort) {
    const dir = sp.dir === "asc" ? 1 : -1;
    const key = (sort === "property" ? "address" : sort) as keyof DealRow;
    rows = [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }
  const writable = !c.workspace.isDemo && can(c.role, "deals");
  const base = new URLSearchParams();
  if (view !== "active" && view !== "custom") base.set("view", view);
  if (sp.stage) base.set("stage", sp.stage);
  if (q) base.set("q", q);
  if (sp.state) base.set("state", sp.state);
  const sortHref = (k: string) => {
    const u = new URLSearchParams(base);
    u.set("sort", k);
    u.set("dir", sort === k && sp.dir !== "asc" ? "asc" : "desc");
    return `/deals?${u}`;
  };
  const totals = {
    fee: rows.reduce((a, r) => a + (r.fee || 0), 0),
    withFee: rows.filter((r) => r.fee !== null).length,
  };

  return (
    <div>
      <PageHeader
        title="Deals"
        sub={`${rows.length} deals${totals.withFee ? ` · projected fees ${usd(totals.fee)} across ${totals.withFee} priced deals` : ""}`}
        actions={
          <>
            <a href={`/api/export/deals?${base}`} className="btn btn-ghost">
              Export CSV
            </a>
            <Link href="/properties/import" className="btn btn-ghost">
              Import list
            </Link>
            <Link href="/deals/new" className="btn btn-primary">
              + Add deal
            </Link>
          </>
        }
      />
      <Tabs active={view} tabs={Object.entries(VIEWS).map(([k, v]) => ({ key: k, label: v.label, href: `/deals?view=${k}` }))} />
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <form className="flex flex-1 flex-wrap gap-2">
          <input type="hidden" name="view" value={view === "custom" ? "all" : view} />
          <input name="q" defaultValue={q} placeholder="Search address, city or ZIP" className="field max-w-xs" />
          <Combo name="state" options={US_STATES} defaultValue={sp.state} emptyLabel="All states" placeholder="All states" className="w-56" />
          <button className="btn btn-ghost">Filter</button>
        </form>
        <details className="relative">
          <summary className="btn btn-ghost cursor-pointer list-none">Columns ▾</summary>
          <form action={dealColumnsAction} className="absolute right-0 z-40 mt-1 w-72 space-y-1 rounded-xl border border-line bg-card p-3 shadow-lg">
            <input type="hidden" name="back" value={`/deals?${base}`} />
            {DEAL_COLUMNS.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm" title={col.hint}>
                <input type="checkbox" name="cols" value={col.key} defaultChecked={cols.includes(col.key)} disabled={col.key === "property"} />
                {col.label}
              </label>
            ))}
            <input type="hidden" name="cols" value="property" />
            <button className="btn btn-primary btn-sm mt-2 w-full">Show these columns</button>
          </form>
        </details>
      </div>

      {writable && rows.length > 0 && (
        <ActionForm action={bulkDealsAction} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-soft px-3 py-2 text-sm">
          <span className="font-medium">With ticked deals:</span>
          <select name="bulk" className="field w-auto" defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option value="pitch">Pitch to matching investors</option>
            <option value="assign">Assign to…</option>
            <option value="autopilot_off">Turn autopilot off</option>
            <option value="autopilot_on">Turn autopilot on</option>
            <option value="revalue">Re-value</option>
          </select>
          <select name="assignee" className="field w-auto" defaultValue="">
            <option value="">(assign to) nobody</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
          <BulkIdsClient />
          <Submit className="btn btn-primary btn-sm">Apply</Submit>
        </ActionForm>
      )}

      <Card pad={false}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  {writable && (
                    <th className="w-8">
                      <SelectAll />
                    </th>
                  )}
                  {cols.map((k) => {
                    const col = DEAL_COLUMNS.find((x) => x.key === k)!;
                    return (
                      <th key={k} className={col.money ? "text-right" : ""} title={col.hint}>
                        <Link href={sortHref(k)} className="hover:text-ink">
                          {col.label}
                          {sort === k ? (sp.dir === "asc" ? " ↑" : " ↓") : ""}
                        </Link>
                      </th>
                    );
                  })}
                  {writable && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowLink key={r.id} href={`/deals/${r.id}`}>
                    {writable && (
                      <td>
                        <input type="checkbox" className="deal-tick h-4 w-4" value={r.id} aria-label={`Select ${r.address}`} />
                      </td>
                    )}
                    {cols.map((k) => (
                      <td key={k} className={`${DEAL_COLUMNS.find((x) => x.key === k)?.money ? "text-right tnum" : "text-sm"} whitespace-nowrap`}>
                        {cell(r, k)}
                      </td>
                    ))}
                    {writable && (
                      <td className="whitespace-nowrap text-right">
                        <ActionButton action={pitchDealAction} hidden={{ opportunityId: r.id }} confirm="Pitch this deal to matching investors now?">
                          Pitch
                        </ActionButton>{" "}
                        <Link href={`/deals/${r.id}#make-offer`} className="btn btn-ghost btn-sm">
                          Offer
                        </Link>
                      </td>
                    )}
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No deals here" action={<Link href="/deals/new" className="btn btn-primary">Add a deal</Link>}>
            Add a property by hand, find sellers, or import a list.
          </Empty>
        )}
      </Card>
    </div>
  );
}
