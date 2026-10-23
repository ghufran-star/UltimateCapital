import Link from "next/link";
import { RowLink } from "@/components/client";
import { Card, Empty, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx, propertyScope } from "@/lib/session";
import { ago, fullName } from "@/lib/util";

export default async function Sellers({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const tab = sp.tab || "sellers";
  const ws = c.workspace.id;
  const sellers =
    tab === "sellers"
      ? await db.contact.findMany({
          where: { workspaceId: ws, kind: "seller", ...(c.states.length ? { OR: [{ ownerships: { some: { property: propertyScope(c) } } }, { state: { in: c.states } }] } : {}), ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
          include: { ownerships: { include: { property: true } }, _count: { select: { interactions: true } } },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : [];
  const props =
    tab === "properties"
      ? await db.property.findMany({
          where: { workspaceId: ws, ...propertyScope(c), ...(q ? { OR: [{ address: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { zip: q }] } : {}) },
          include: { opportunities: { select: { id: true, stage: true } }, ownerships: { include: { contact: true } } },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : [];
  const counts = await Promise.all([db.contact.count({ where: { workspaceId: ws, kind: "seller" } }), db.property.count({ where: { workspaceId: ws } })]);
  return (
    <div>
      <PageHeader
        title="Sellers & properties"
        actions={
          <>
            <Link href="/properties/import" className="btn btn-ghost">
              Import CSV
            </Link>
            <Link href="/deals/new" className="btn btn-primary">
              + Add
            </Link>
          </>
        }
      />
      <Tabs active={tab} tabs={[{ key: "sellers", label: "Sellers", href: "/properties", count: counts[0] }, { key: "properties", label: "Properties", href: "/properties?tab=properties", count: counts[1] }]} />
      <form className="mb-4 flex gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder={tab === "sellers" ? "Search name, phone, email" : "Search address, city, ZIP"} className="field max-w-sm" />
        <button className="btn btn-ghost">Search</button>
      </form>
      <Card pad={false}>
        {tab === "sellers" ? (
          sellers.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Seller</th>
                    <th>Property</th>
                    <th>Status</th>
                    <th>Last contact</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => (
                    <RowLink key={s.id} href={`/contacts/${s.id}`}>
                      <td>
                        <div className="font-medium">{fullName(s)}</div>
                        <div className="text-xs text-muted">{s.phone || s.email}</div>
                      </td>
                      <td className="text-sm">
                        {s.ownerships[0]?.property.address || "—"}
                        {s.ownerships.length > 1 && <span className="text-xs text-muted"> +{s.ownerships.length - 1}</span>}
                      </td>
                      <td>{s.doNotContact ? <span className="badge badge-bad">DNC</span> : <StatusBadge s={s.sellerStatus} />}</td>
                      <td className="text-xs text-muted">
                        {s.lastContactAt ? ago(s.lastContactAt) : "never"} · {s._count.interactions} touches
                      </td>
                    </RowLink>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No sellers yet" action={<Link href="/properties/import" className="btn btn-primary">Import a list</Link>} />
          )
        ) : props.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Owner</th>
                  <th>Details</th>
                  <th>Deal</th>
                </tr>
              </thead>
              <tbody>
                {props.map((p) => (
                  <RowLink key={p.id} href={p.opportunities[0] ? `/deals/${p.opportunities[0].id}` : `/contacts/${p.ownerships[0]?.contactId || ""}`}>
                    <td>
                      <div className="font-medium">{p.address}</div>
                      <div className="text-xs text-muted">
                        {p.city}, {p.state} {p.zip}
                      </div>
                    </td>
                    <td className="text-sm">{p.ownerships.map((o) => fullName(o.contact)).join(", ") || "—"}</td>
                    <td className="text-xs text-muted">
                      {p.beds ?? "?"}bd/{p.baths ?? "?"}ba · {p.sqft?.toLocaleString() ?? "?"} sqft · {p.conditionTier || "condition ?"}
                    </td>
                    <td>{p.opportunities[0] && <StatusBadge s={p.opportunities[0].stage} />}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No properties yet" />
        )}
      </Card>
    </div>
  );
}
