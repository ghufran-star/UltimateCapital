import Link from "next/link";
import { RowLink } from "@/components/client";
import { Card, Empty, HotBadge, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import type { Calculation } from "@/lib/rules";
import { pageCtx } from "@/lib/session";
import { ago, usd } from "@/lib/util";

const VIEWS: Record<string, { label: string; stages?: string[] }> = {
  active: { label: "Active", stages: ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY", "NEGOTIATION", "CONTRACT_PREPARATION"] },
  hot: { label: "Hot" },
  contract: { label: "Under contract", stages: ["UNDER_CONTRACT", "DISPOSITION", "CLOSING"] },
  leads: { label: "Leads", stages: ["NEW", "ELIGIBLE", "OUTREACH"] },
  closed: { label: "Closed", stages: ["CLOSED"] },
  all: { label: "All" },
};

export default async function Deals({ searchParams }: { searchParams: Promise<{ view?: string; stage?: string; q?: string; state?: string }> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  const view = sp.stage ? "custom" : sp.view && VIEWS[sp.view] ? sp.view : "active";
  const stages = sp.stage ? sp.stage.split(",") : VIEWS[view]?.stages;
  const q = sp.q?.trim();
  const deals = await db.opportunity.findMany({
    where: {
      workspaceId: c.workspace.id,
      ...(stages ? { stage: { in: stages } } : {}),
      ...(view === "hot" ? { hotScore: { gte: 50 } } : {}),
      ...(sp.state ? { property: { state: sp.state } } : {}),
      ...(q ? { OR: [{ property: { address: { contains: q, mode: "insensitive" } } }, { property: { city: { contains: q, mode: "insensitive" } } }, { property: { zip: q } }] } : {}),
    },
    include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, interests: { where: { serious: true }, select: { id: true } } },
    orderBy: view === "hot" ? { hotScore: "desc" } : { updatedAt: "desc" },
    take: 200,
  });
  const sellers = await db.contact.findMany({ where: { id: { in: deals.map((d) => d.sellerId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true } });
  const states = await db.property.findMany({ where: { workspaceId: c.workspace.id }, distinct: ["state"], select: { state: true } });

  return (
    <div>
      <PageHeader
        title="Deals"
        sub="Every property from first call to paid."
        actions={
          <>
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
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="view" value={view === "custom" ? "all" : view} />
        <input name="q" defaultValue={q} placeholder="Search address, city or ZIP" className="field max-w-xs" />
        <select name="state" defaultValue={sp.state || ""} className="field w-auto">
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s.state}>{s.state}</option>
          ))}
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>
      <Card pad={false}>
        {deals.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Seller</th>
                  <th>Stage</th>
                  <th className="text-right">Asking / lowest</th>
                  <th className="text-right">Max buy</th>
                  <th>Buyers</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const calc = d.valuations[0]?.result as unknown as Calculation | undefined;
                  const s = sellers.find((x) => x.id === d.sellerId);
                  return (
                    <RowLink key={d.id} href={`/deals/${d.id}`}>
                      <td>
                        <div className="font-medium">{d.property.address}</div>
                        <div className="text-xs text-muted">
                          {d.property.city}, {d.property.state} {d.property.zip}
                        </div>
                      </td>
                      <td className="text-sm">{s ? `${s.firstName} ${s.lastName}` : "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge s={d.stage} />
                          {d.exception && <StatusBadge s={d.exception} />}
                        </div>
                      </td>
                      <td className="text-right tnum text-sm">
                        {usd(d.askingPrice)}
                        <div className="text-xs text-muted">{usd(d.sellerLowest)}</div>
                      </td>
                      <td className="text-right tnum text-sm">{d.valuations[0]?.blocked ? <span className="text-warn">blocked</span> : usd(calc?.maxBuy)}</td>
                      <td>
                        <HotBadge score={d.hotScore} />
                        {d.interests.length > 0 && <div className="text-xs text-muted">{d.interests.length} serious</div>}
                      </td>
                      <td className="text-xs text-muted">{ago(d.updatedAt)}</td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No deals here" action={<Link href="/deals/new" className="btn btn-primary">Add a deal</Link>}>
            Add a property by hand or import a seller list.
          </Empty>
        )}
      </Card>
    </div>
  );
}
