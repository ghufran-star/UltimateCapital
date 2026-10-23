import Link from "next/link";
import { RowLink } from "@/components/client";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { ago, fmtDate, fullName, usd } from "@/lib/util";

export default async function Buyers({ searchParams }: { searchParams: Promise<{ q?: string; market?: string }> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const buyers = await db.contact.findMany({
    where: {
      workspaceId: c.workspace.id,
      kind: "buyer",
      ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
      ...(sp.market ? { buyBoxes: { some: { markets: { has: sp.market } } } } : {}),
    },
    include: { buyBoxes: { where: { active: true } }, interests: { select: { stage: true, serious: true } } },
    orderBy: [{ reliability: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return (
    <div>
      <PageHeader
        title="Buyers"
        sub="Investors, their buy boxes, buying timeline and contact limits."
        actions={
          <>
            <Link href="/buyers/find" className="btn btn-ghost">
              Find cash buyers
            </Link>
            <a href="/api/export/buyers" className="btn btn-ghost">
              Export CSV
            </a>
            <Link href="/buyers/import" className="btn btn-ghost">
              Import CSV
            </Link>
            <Link href="/buyers/new" className="btn btn-primary">
              + Add buyer
            </Link>
          </>
        }
      />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, company, phone" className="field max-w-sm" />
        <input name="market" defaultValue={sp.market} placeholder="Market (city)" className="field max-w-40" />
        <button className="btn btn-ghost">Search</button>
      </form>
      <Card pad={false}>
        {buyers.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Buy box</th>
                  <th>Buying</th>
                  <th>Track record</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => {
                  const bb = b.buyBoxes[0];
                  return (
                    <RowLink key={b.id} href={`/contacts/${b.id}`}>
                      <td>
                        <div className="font-medium">{fullName(b)}</div>
                        <div className="text-xs text-muted">{b.company && b.firstName ? b.company : b.phone || b.email}</div>
                      </td>
                      <td className="text-xs">
                        {bb ? (
                          <>
                            <div>{[...bb.markets, ...bb.states].slice(0, 3).join(", ") || "Anywhere"}</div>
                            <div className="text-muted">
                              {bb.strategy || "any"} · up to {usd(bb.maxPrice)} · {bb.maxCondition || "any condition"}
                            </div>
                          </>
                        ) : (
                          <span className="text-warn">No buy box</span>
                        )}
                        {b.buyBoxes.length > 1 && <div className="text-muted">+{b.buyBoxes.length - 1} more</div>}
                      </td>
                      <td className="text-xs">
                        <div>{b.buyingPerMonth ? `${b.buyingPerMonth}/month` : "—"}</div>
                        <div className="text-muted">{b.nextBuyingAt && b.nextBuyingAt > new Date() ? `paused until ${fmtDate(b.nextBuyingAt)}` : b.maxDealsPerWeek ? `max ${b.maxDealsPerWeek} deals/week` : ""}</div>
                      </td>
                      <td className="text-xs">
                        <div>
                          {b.dealsClosed} closed · {b.fundsVerified ? "funds ✓" : "funds ?"}
                        </div>
                        <div className="text-muted">
                          reliability {b.reliability} · {b.interests.filter((i) => i.serious).length} serious
                        </div>
                      </td>
                      <td>
                        {b.doNotContact ? <span className="badge badge-bad">DNC</span> : <StatusBadge s={b.buyerStatus} />}
                        <div className="text-xs text-muted">{b.lastContactAt ? ago(b.lastContactAt) : ""}</div>
                      </td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No buyers yet" action={<Link href="/buyers/import" className="btn btn-primary">Import buyers</Link>} />
        )}
      </Card>
    </div>
  );
}
