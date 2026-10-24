import Link from "next/link";
import { STATUS_LABEL } from "@/lib/numbers";
import { checkNumbersAction } from "../../actions/agents";
import { ActionButton } from "@/components/client";
import { RowLink } from "@/components/client";
import { MobileCard, MoreMenu, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
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
            <Link href="/buyers/new" className="btn btn-primary">
              + Add buyer
            </Link>
            <MoreMenu>
              <Link href="/buyers/find" className="btn btn-ghost">
                Find cash buyers (data provider)
              </Link>
              <Link href="/buyers/import" className="btn btn-ghost">
                Import a list
              </Link>
              <ActionButton action={checkNumbersAction} hidden={{ scope: "buyers" }} className="btn btn-ghost" confirm="Check every buyer phone number?">
                Check phone numbers
              </ActionButton>
              <a href="/api/export/buyers" className="btn btn-ghost">
                Download as spreadsheet
              </a>
            </MoreMenu>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, company, phone" className="field min-w-0 flex-1 sm:max-w-sm" />
        <input name="market" defaultValue={sp.market} placeholder="City" className="field w-32" />
        <button className="btn btn-ghost">Search</button>
      </form>
      {buyers.length > 0 && (
        <div className="space-y-2 md:hidden">
          {buyers.slice(0, 200).map((b) => {
            const bb = b.buyBoxes[0];
            return (
              <MobileCard key={b.id} href={`/contacts/${b.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{fullName(b)}</div>
                    <div className="truncate text-xs text-muted">{bb ? `${[...bb.markets, ...bb.states].slice(0, 2).join(", ") || "Anywhere"} · up to ${usd(bb.maxPrice)}` : "No buy box yet"}</div>
                  </div>
                  {b.doNotContact ? <span className="badge badge-bad">DNC</span> : <StatusBadge s={b.buyerStatus} />}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {b.dealsClosed} closed · {b.fundsVerified ? "funds checked" : "funds not checked"} · {b.interests.filter((i) => i.serious).length} serious
                </div>
              </MobileCard>
            );
          })}
        </div>
      )}
      <Card pad={false} className={buyers.length ? "hidden md:block" : ""}>
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
                        <div className="text-xs text-muted">
                          {b.company && b.firstName ? b.company : b.phone || b.email}
                          {b.phoneStatus && ["invalid", "disconnected", "landline"].includes(b.phoneStatus) && <span className="ml-1 text-warn">· {STATUS_LABEL[b.phoneStatus]}</span>}
                        </div>
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
