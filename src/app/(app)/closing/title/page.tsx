import { SectionTabs } from "@/components/sections";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { RowLink } from "@/components/client";
import { Combo } from "@/components/combo";
import { Card, Empty, PageHeader } from "@/components/ui";
import { US_STATES } from "@/lib/catalog";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { TITLE_CAPS, trackRecords } from "@/lib/titledir";
import { ago, usd } from "@/lib/util";

type SP = { state?: string; cap?: string; q?: string; status?: string };

const STATUS: Record<string, string> = { preferred: "badge-good", active: "", avoid: "badge-bad" };

export default async function TitleCompanies({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const where: Prisma.TitleCompanyWhereInput = {
    workspaceId: ws,
    ...(sp.state ? { OR: [{ state: sp.state }, { states: { has: sp.state } }] } : {}),
    ...(sp.cap && TITLE_CAPS.some((x) => x.key === sp.cap) ? ({ [sp.cap as string]: "yes" } as Prisma.TitleCompanyWhereInput) : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.q ? { name: { contains: sp.q, mode: "insensitive" } } : {}),
  };
  const ts = await db.titleCompany.findMany({ where, orderBy: [{ status: "desc" }, { name: "asc" }] });
  const tr = await trackRecords(ws, ts.map((t) => t.id));
  const order = { preferred: 0, active: 1, avoid: 2 } as Record<string, number>;
  ts.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || (tr.get(b.id)?.closed || 0) - (tr.get(a.id)?.closed || 0) || a.name.localeCompare(b.name));
  const writable = can(c.role, "closing");
  return (
    <div>
      <PageHeader
        back={{ href: "/closing", label: "Contracts & closing" }}
        title="Title companies"
        sub="Who closes your deals: what they'll do, how they've performed on your deals, and their licence. No AI and no paid lookups are used here."
        actions={
          <>
            <a href="/api/export/title-companies" className="btn btn-ghost">
              Export CSV
            </a>
            <Link href="/closing/title/directory" className="btn btn-ghost">
              State directory
            </Link>
            {writable && (
              <Link href="/closing/title/new" className="btn btn-primary">
                + Add title company
              </Link>
            )}
          </>
        }
      />
      <SectionTabs set="closing" active="/closing/title" />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name" className="field max-w-xs" />
        <Combo name="state" options={US_STATES} defaultValue={sp.state} emptyLabel="All states" placeholder="All states" className="w-48" />
        <select name="cap" defaultValue={sp.cap || ""} className="field w-56">
          <option value="">Any capability</option>
          {TITLE_CAPS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status || ""} className="field w-40">
          <option value="">Any status</option>
          <option value="preferred">Preferred</option>
          <option value="active">Active</option>
          <option value="avoid">Avoid</option>
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>
      <Card pad={false}>
        {ts.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Title company</th>
                  <th>States</th>
                  <th>Will do</th>
                  <th className="text-right">Your deals</th>
                  <th className="text-right">Closed</th>
                  <th className="text-right">Avg days</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">Fees closed</th>
                  <th>Wire number</th>
                  <th>Licence</th>
                </tr>
              </thead>
              <tbody>
                {ts.map((t) => {
                  const r = tr.get(t.id);
                  const st = [...new Set([t.state, ...t.states].filter(Boolean))];
                  return (
                    <RowLink key={t.id} href={`/closing/title/${t.id}`}>
                      <td>
                        <div className="font-medium">
                          {t.name} {t.status !== "active" && <span className={`badge ${STATUS[t.status] || ""}`}>{t.status}</span>}
                        </div>
                        <div className="text-xs text-muted">{[t.city, t.email || t.phone].filter(Boolean).join(" · ") || "no contact details"}</div>
                      </td>
                      <td className="text-xs">{st.join(", ") || "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {TITLE_CAPS.map((x) => {
                            const v = t[x.key];
                            if (!v) return null;
                            return (
                              <span key={x.key} title={x.label} className={`badge ${v === "yes" ? "badge-good" : "badge-bad"}`}>
                                {v === "no" ? "No " : ""}
                                {x.short}
                              </span>
                            );
                          })}
                          {TITLE_CAPS.every((x) => !t[x.key]) && <span className="text-xs text-muted">not filled in</span>}
                        </div>
                      </td>
                      <td className="text-right tnum">{r?.deals || 0}</td>
                      <td className="text-right tnum">{r?.closed || 0}</td>
                      <td className="text-right tnum">{r?.avgDays ?? "—"}</td>
                      <td className="text-right tnum">{r?.onTime != null ? `${r.onTime}%` : "—"}</td>
                      <td className="text-right tnum">{r?.fees ? usd(r.fees) : "—"}</td>
                      <td className="text-xs">{t.wireConfirmedAt ? <span className="text-brand">✓ confirmed {ago(t.wireConfirmedAt)}</span> : t.wireVerifiedPhone ? <span className="text-warn">not confirmed</span> : <span className="text-bad">none</span>}</td>
                      <td className="text-xs">{t.licenseNo ? `${t.licenseState || t.state || ""} #${t.licenseNo}` : "—"}</td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No title companies match"
            action={
              <Link href="/closing/title/directory" className="btn btn-primary">
                Find one in the state directory
              </Link>
            }
          >
            Add the title companies you close with, or pick a licensed agency from the free state directory.
          </Empty>
        )}
      </Card>
    </div>
  );
}
