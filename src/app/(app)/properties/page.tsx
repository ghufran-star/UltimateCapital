import Link from "next/link";
import { STATUS_LABEL } from "@/lib/numbers";
import { checkNumbersAction } from "../../actions/agents";
import { ActionButton } from "@/components/client";
import type { Prisma } from "@prisma/client";
import { RowLink } from "@/components/client";
import { CallButton } from "@/components/phone";
import { Combo } from "@/components/combo";
import { Card, Empty, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { conditionShort, label as catLabel, LEAD_SOURCES, OCCUPANCY, OWNER_TYPES, PROPERTY_TYPES, SITUATIONS, shortType, US_STATES } from "@/lib/catalog";
import { db } from "@/lib/db";
import { pageCtx, propertyScope } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago, fmtDate, fullName, usd } from "@/lib/util";

type SP = { q?: string; tab?: string; state?: string; type?: string; situation?: string };

const sit = (keys: string[]) => keys.map((k) => catLabel(SITUATIONS, k).replace(/ \(.*\)$/, ""));

export default async function Sellers({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const tab = sp.tab === "properties" ? "properties" : "sellers";
  const ws = c.workspace.id;

  const propWhere: Prisma.PropertyWhereInput = {
    ...propertyScope(c),
    ...(sp.state ? { state: sp.state } : {}),
    ...(sp.type ? { propertyType: sp.type } : {}),
    ...(sp.situation ? { situations: { has: sp.situation } } : {}),
  };
  const hasPropFilter = Object.keys(propWhere).length > 0;

  // A seller is anyone recorded as a seller, owning a property, or the seller on a deal (and not a buyer).
  const sellerWhere: Prisma.ContactWhereInput = {
    workspaceId: ws,
    AND: [
      { OR: [{ kind: "seller" }, { ownerships: { some: {} } }, { id: { in: (await db.opportunity.findMany({ where: { workspaceId: ws, sellerId: { not: null } }, select: { sellerId: true } })).map((o) => o.sellerId!) } }] },
      { kind: { not: "buyer" } },
      ...(hasPropFilter || c.states.length ? [{ ownerships: { some: { property: propWhere } } }] : []),
      ...(q ? [{ OR: [{ firstName: { contains: q, mode: "insensitive" as const } }, { lastName: { contains: q, mode: "insensitive" as const } }, { company: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" as const } }] }] : []),
    ],
  };
  const [sellers, props, counts] = await Promise.all([
    tab === "sellers"
      ? db.contact.findMany({
          where: sellerWhere,
          include: { ownerships: { include: { property: { include: { opportunities: { orderBy: { updatedAt: "desc" }, take: 1 } } } } }, _count: { select: { interactions: true } } },
          orderBy: { updatedAt: "desc" },
          take: 300,
        })
      : [],
    tab === "properties"
      ? db.property.findMany({
          where: { workspaceId: ws, ...propWhere, ...(q ? { OR: [{ address: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { zip: q }, { county: { contains: q, mode: "insensitive" } }] } : {}) },
          include: { opportunities: { orderBy: { updatedAt: "desc" }, take: 1, include: { valuations: { orderBy: { createdAt: "desc" }, take: 1 } } }, ownerships: { include: { contact: true } } },
          orderBy: { updatedAt: "desc" },
          take: 300,
        })
      : [],
    Promise.all([db.contact.count({ where: sellerWhere }), db.property.count({ where: { workspaceId: ws, ...propertyScope(c) } })]),
  ]);
  const members = await db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, name: true } } } });
  const who = (id?: string | null) => members.find((m) => m.userId === id)?.user.name || "—";
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q, state: sp.state, type: sp.type, situation: sp.situation, ...extra })) if (v) u.set(k, v);
    return `/properties?${u}`;
  };

  return (
    <div>
      <PageHeader
        title="Sellers"
        actions={
          <>
            {(
              <ActionButton action={checkNumbersAction} hidden={{ scope: "sellers" }} className="btn btn-ghost" confirm="Check every seller phone number (format and DNC-provider flags; plus a paid mobile/landline lookup if switched on in Settings)?">
                Check numbers
              </ActionButton>
            )}
            <a href={`/api/export/${tab}`} className="btn btn-ghost">
              Export CSV
            </a>
            <Link href="/properties/find" className="btn btn-ghost">
              Find sellers
            </Link>
            <Link href="/properties/import" className="btn btn-ghost">
              Import CSV
            </Link>
            <Link href="/deals/new" className="btn btn-primary">
              + Add
            </Link>
          </>
        }
      />
      <Tabs active={tab} tabs={[{ key: "sellers", label: "Sellers", href: keep({ tab: "sellers" }), count: counts[0] }, { key: "properties", label: "Properties", href: keep({ tab: "properties" }), count: counts[1] }]} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder={tab === "sellers" ? "Search name, phone, email" : "Search address, city, ZIP, county"} className="field max-w-xs" />
        <Combo name="state" options={US_STATES} defaultValue={sp.state} emptyLabel="All states" placeholder="All states" className="w-48" />
        <Combo name="type" options={PROPERTY_TYPES} defaultValue={sp.type} emptyLabel="All types" placeholder="All types" className="w-56" />
        <Combo name="situation" options={SITUATIONS} defaultValue={sp.situation} emptyLabel="Any situation" placeholder="Any situation" className="w-56" />
        <button className="btn btn-ghost">Filter</button>
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
                    <th>Type</th>
                    <th>Situation</th>
                    <th>Deal stage</th>
                    <th>Lead source</th>
                    <th>Last contact</th>
                    <th>Next step</th>
                    <th>Assigned</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => {
                    const own = s.ownerships[0];
                    const p = own?.property;
                    const deal = p?.opportunities[0];
                    return (
                      <RowLink key={s.id} href={`/contacts/${s.id}`}>
                        <td>
                          <div className="font-medium">{fullName(s) || "Unnamed"}</div>
                          <div className="text-xs text-muted">
                            {s.phone || s.email || "no contact details"}
                            {s.phoneStatus && <span className={`ml-1 ${["invalid", "disconnected"].includes(s.phoneStatus) ? "text-bad" : s.phoneStatus === "landline" ? "text-warn" : "text-brand"}`}>· {STATUS_LABEL[s.phoneStatus] || s.phoneStatus}</span>}
                          </div>
                          {s.doNotContact && <span className="badge badge-bad">DNC</span>}
                        </td>
                        <td className="text-sm">
                          {p ? (
                            <>
                              {p.address}
                              <div className="text-xs text-muted">
                                {p.city}, {p.state}
                                {s.ownerships.length > 1 ? ` · +${s.ownerships.length - 1} more` : ""}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-sm">{p ? shortType(p.propertyType) : "—"}</td>
                        <td className="max-w-56 text-xs">{p?.situations.length ? sit(p.situations).join(", ") : "—"}</td>
                        <td>{deal ? <StatusBadge s={deal.stage} /> : <StatusBadge s={s.sellerStatus} />}</td>
                        <td className="text-xs">{deal?.leadSource ? catLabel(LEAD_SOURCES, deal.leadSource) : "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted">
                          {s.lastContactAt ? ago(s.lastContactAt) : "never"} · {s._count.interactions} touches
                        </td>
                        <td className="max-w-48 text-xs">{deal?.nextStep || s.openQuestions[0] || "—"}</td>
                        <td className="text-xs">{who(deal?.assigneeId || s.assigneeId)}</td>
                        <td>{!s.doNotContact && <CallButton contactId={s.id} name={fullName(s) || "Seller"} phone={s.phone} opportunityId={deal?.id} size="sm" />}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No sellers match" action={<Link href="/properties/find" className="btn btn-primary">Find sellers</Link>}>
              Sellers appear here when you add a deal, import a list or pull one from your data provider.
            </Empty>
          )
        ) : props.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Owner</th>
                  <th>Type</th>
                  <th className="text-right">Beds / baths</th>
                  <th className="text-right">Sq ft</th>
                  <th className="text-right">Built</th>
                  <th>Rehab</th>
                  <th>Occupancy</th>
                  <th>Situation</th>
                  <th className="text-right">Est. value</th>
                  <th className="text-right">Equity</th>
                  <th className="text-right">ARV</th>
                  <th>Last sale</th>
                  <th>Deal</th>
                </tr>
              </thead>
              <tbody>
                {props.map((p) => {
                  const deal = p.opportunities[0];
                  const v = deal?.valuations[0];
                  const equity = p.estValue != null ? p.estValue - (p.loanBalance || 0) : null;
                  return (
                    <RowLink key={p.id} href={deal ? `/deals/${deal.id}` : `/contacts/${p.ownerships[0]?.contactId || ""}`}>
                      <td>
                        <div className="font-medium">{p.address}</div>
                        <div className="text-xs text-muted">
                          {p.city}, {p.state} {p.zip}
                          {p.county ? ` · ${p.county} Co.` : ""}
                        </div>
                      </td>
                      <td className="text-sm">
                        {p.ownerships.map((o) => fullName(o.contact)).join(", ") || "—"}
                        <div className="text-xs text-muted">
                          {[p.ownerType ? catLabel(OWNER_TYPES, p.ownerType) : "", p.absentee ? "absentee" : ""].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="text-sm">{shortType(p.propertyType)}</td>
                      <td className="text-right tnum text-sm">
                        {p.beds ?? "?"} / {p.baths ?? "?"}
                      </td>
                      <td className="text-right tnum text-sm">{p.sqft?.toLocaleString() ?? "—"}</td>
                      <td className="text-right tnum text-sm">{p.yearBuilt ?? "—"}</td>
                      <td className="text-sm">{conditionShort(p.conditionTier)}</td>
                      <td className="text-xs">{p.occupancy ? catLabel(OCCUPANCY, p.occupancy) : "—"}</td>
                      <td className="max-w-48 text-xs">{p.situations.length ? sit(p.situations).join(", ") : "—"}</td>
                      <td className="text-right tnum text-sm">{usd(p.estValue)}</td>
                      <td className="text-right tnum text-sm">
                        {equity === null ? "—" : usd(equity)}
                        {equity !== null && p.estValue ? <div className="text-xs text-muted">{Math.round((equity / p.estValue) * 100)}%</div> : null}
                      </td>
                      <td className="text-right tnum text-sm">{usd(v?.arv)}</td>
                      <td className="text-xs">{p.lastSaleDate ? `${usd(p.lastSalePrice)} · ${fmtDate(p.lastSaleDate)}` : "—"}</td>
                      <td>{deal ? <StatusBadge s={deal.stage} /> : <span className="text-xs text-muted">{label("no deal")}</span>}</td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No properties match" />
        )}
      </Card>
    </div>
  );
}
