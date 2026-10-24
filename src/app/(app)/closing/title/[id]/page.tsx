import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, RowLink } from "@/components/client";
import { FilesPanel } from "@/components/files";
import { Card, Empty, Notice, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { AUTO_STATES, LOOKUP_HELP, licenceMatch, TITLE_CAPS, trackRecords } from "@/lib/titledir";
import { ago, fmtDate, usd } from "@/lib/util";
import { confirmWireAction, deleteTitleCompanyAction } from "../../../../actions/title";
import { OfficesForm, PeopleForm, TitleProfileForm } from "../form";

export default async function TitleCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const { id } = await params;
  const t = await db.titleCompany.findFirst({ where: { id, workspaceId: ws } });
  if (!t) notFound();
  const [rec, txs, lic] = await Promise.all([
    trackRecords(ws, [t.id]).then((m) => m.get(t.id)),
    db.transaction.findMany({ where: { workspaceId: ws, titleCompanyId: t.id }, include: { opportunity: { include: { property: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    licenceMatch(ws, t),
  ]);
  const ro = c.workspace.isDemo || !can(c.role, "closing");
  const licState = t.licenseState || t.state;
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/closing/title", label: "Title companies" }}
        title={t.name}
        sub={
          <>
            {[t.city, t.state].filter(Boolean).join(", ")}
            {t.website && (
              <>
                {" · "}
                <a href={t.website.startsWith("http") ? t.website : `https://${t.website}`} target="_blank" rel="noreferrer" className="underline">
                  website
                </a>
              </>
            )}
            {t.status !== "active" && <span className={`badge ml-2 ${t.status === "preferred" ? "badge-good" : "badge-bad"}`}>{t.status}</span>}
          </>
        }
        actions={
          t.email ? (
            <a href={`mailto:${t.email}`} className="btn btn-ghost">
              Email
            </a>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Your deals with them" value={rec?.deals || 0} sub={rec?.last ? `last ${ago(rec.last)}` : undefined} />
        <Stat label="Closed" value={rec?.closed || 0} tone={rec?.closed ? "good" : undefined} />
        <Stat label="In progress" value={rec?.open || 0} />
        <Stat label="Fell through" value={rec?.fell || 0} tone={rec?.fell ? "warn" : undefined} />
        <Stat label="Avg days to close" value={rec?.avgDays ?? "—"} sub={rec?.onTime != null ? `${rec.onTime}% on the scheduled date` : undefined} />
        <Stat label="Settlement issues caught" value={rec?.issues || 0} tone={rec?.issues ? "warn" : undefined} sub={rec?.fees ? `${usd(rec.fees)} fees closed` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Profile">
            <TitleProfileForm t={t} ro={ro} />
          </Card>
          <Card title="People">
            <PeopleForm t={t} ro={ro} />
          </Card>
          <Card title="Branch offices">
            <OfficesForm t={t} ro={ro} />
          </Card>
          <Card title="Documents" actions={<span className="text-xs text-muted">Wire letter, E&amp;O certificate, closing protection letter, W-9, fee sheet</span>}>
            <FilesPanel ws={ws} entityType="title_company" entityId={t.id} writable={!ro} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Wire safety">
            {t.wireVerifiedPhone ? (
              <div className="space-y-3 text-sm">
                <p>
                  Known number: <span className="font-semibold tnum">{t.wireVerifiedPhone}</span>
                </p>
                {t.wireConfirmedAt ? (
                  <Notice tone="good">
                    Confirmed by phone by {t.wireConfirmedBy || "a team member"} on {fmtDate(t.wireConfirmedAt)}.
                  </Notice>
                ) : (
                  <Notice tone="warn">Not confirmed yet. Call this number (not one from an email) and read back the account details before any money moves.</Notice>
                )}
                {!ro && (
                  <div className="flex gap-2">
                    <ActionButton action={confirmWireAction} hidden={{ titleCompanyId: t.id }} className="btn btn-primary btn-sm" confirm={`Did you call ${t.wireVerifiedPhone} and confirm the wire details with them?`}>
                      I called and confirmed
                    </ActionButton>
                    {t.wireConfirmedAt && (
                      <ActionButton action={confirmWireAction} hidden={{ titleCompanyId: t.id, clear: "1" }}>
                        Clear
                      </ActionButton>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted">Wire instructions should still be confirmed by phone for every closing; changes sent by email are the most common wire fraud.</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Add the known phone number for wire checks in the profile.</p>
            )}
          </Card>

          <Card title="Licence">
            {lic ? (
              <div className="space-y-1 text-sm">
                <p>
                  <span className={`badge ${lic.status === "active" ? "badge-good" : "badge-bad"}`}>{lic.status || "listed"}</span> on the {lic.source === "tx_tdi" ? AUTO_STATES.TX.name : lic.source === "demo" ? "sample" : "uploaded"} list
                </p>
                <p className="text-muted">
                  {lic.name} · {lic.licenseType || "Title agency"} #{lic.licenseNo || "—"}
                </p>
                {lic.counties.length > 0 && <p className="text-xs text-muted">Appointed in {lic.counties.length} counties.</p>}
                {lic.underwriters.length > 0 && <p className="text-xs text-muted">Underwriters: {lic.underwriters.join(", ")}</p>}
                <p className="text-xs text-muted">List refreshed {fmtDate(lic.fetchedAt)}.</p>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-muted">{licState ? `Not found on a ${licState} list in the directory.` : "Add the state they're licensed in."}</p>
                {licState && !AUTO_STATES[licState] && (
                  <p className="text-xs text-muted">
                    {licState} doesn&apos;t publish a free downloadable list. Check by hand on the state insurance department&apos;s site (
                    <a href={LOOKUP_HELP.naic} target="_blank" rel="noreferrer" className="underline">
                      find it here
                    </a>
                    ) and note the licence number in the profile.
                  </p>
                )}
                {licState && AUTO_STATES[licState] && (
                  <Link href={`/closing/title/directory?state=${licState}&q=${encodeURIComponent(t.name.split(" ")[0])}`} className="text-xs underline">
                    Search the {licState} list
                  </Link>
                )}
              </div>
            )}
          </Card>

          <Card title="At a glance">
            <ul className="space-y-1 text-sm">
              {TITLE_CAPS.map((x) => (
                <li key={x.key} className="flex justify-between gap-2">
                  <span>{x.label}</span>
                  <span className={t[x.key] === "yes" ? "text-brand" : t[x.key] === "no" ? "text-bad" : "text-muted"}>{t[x.key] === "yes" ? "Yes" : t[x.key] === "no" ? "No" : "?"}</span>
                </li>
              ))}
              {t.attorneyStates.length > 0 && <li className="text-xs text-muted">Attorney closings in {t.attorneyStates.join(", ")}</li>}
              {t.emdHandling && <li className="text-xs text-muted">EMD: {t.emdHandling}</li>}
            </ul>
          </Card>

          {!ro && (rec?.deals || 0) === 0 && (
            <ActionButton action={deleteTitleCompanyAction} hidden={{ titleCompanyId: t.id }} className="btn btn-ghost btn-sm text-bad" confirm={`Delete ${t.name}?`}>
              Delete title company
            </ActionButton>
          )}
        </div>
      </div>

      <Card title={`Deals with ${t.name}`} pad={false}>
        {txs.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Closing stage</th>
                  <th>Opened</th>
                  <th>Closing date</th>
                  <th className="text-right">Fee</th>
                  <th>Settlement check</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((x) => {
                  const s = x.settlement as { ok?: boolean; issues?: string[] } | null;
                  return (
                    <RowLink key={x.id} href={`/deals/${x.opportunityId}?tab=closing`}>
                      <td>
                        <div className="font-medium">{x.opportunity.property.address}</div>
                        <div className="text-xs text-muted">
                          {x.opportunity.property.city}, {x.opportunity.property.state}
                        </div>
                      </td>
                      <td>
                        <StatusBadge s={x.stage} />
                      </td>
                      <td className="text-xs">{fmtDate(x.createdAt)}</td>
                      <td className="text-xs">{fmtDate(x.closingAt)}</td>
                      <td className="text-right tnum">{usd(x.netProceeds ?? x.assignmentFee)}</td>
                      <td className="text-xs">{s ? (s.ok ? <span className="text-brand">✓ clean</span> : <span className="text-warn">{s.issues?.length || 0} issue(s)</span>) : "—"}</td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No deals with them yet">Their track record builds itself from your deals as they open title, close and pay.</Empty>
        )}
      </Card>
    </div>
  );
}
