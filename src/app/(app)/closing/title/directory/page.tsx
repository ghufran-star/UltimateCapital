import type { Prisma } from "@prisma/client";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";
import { US_STATES } from "@/lib/catalog";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { ATTORNEY_STATES, AUTO_STATES, LOOKUP_HELP } from "@/lib/titledir";
import { fmtDate } from "@/lib/util";
import { addFromDirectoryAction, refreshDirectoryAction, uploadDirectoryAction } from "../../../../actions/title";

type SP = { state?: string; q?: string; county?: string; under?: string; page?: string };

export default async function TitleDirectory({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const state = sp.state?.toUpperCase() || c.states[0] || "TX";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.TitleLicenseeWhereInput = {
    state,
    AND: [
      { OR: [{ workspaceId: null }, { workspaceId: ws }] },
      ...(sp.q ? [{ OR: [{ name: { contains: sp.q, mode: "insensitive" as const } }, { city: { contains: sp.q, mode: "insensitive" as const } }, { licenseNo: sp.q }] }] : []),
      ...(sp.county ? [{ OR: [{ county: { equals: sp.county, mode: "insensitive" as const } }, { counties: { has: sp.county.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) } }] }] : []),
      ...(sp.under ? [{ underwriters: { has: sp.under } }] : []),
    ],
  };
  const [rows, total, stateCounts, latest, mine] = await Promise.all([
    db.titleLicensee.findMany({ where, orderBy: [{ status: "asc" }, { name: "asc" }], take: 50, skip: (page - 1) * 50 }),
    db.titleLicensee.count({ where }),
    db.titleLicensee.groupBy({ by: ["state"], where: { OR: [{ workspaceId: null }, { workspaceId: ws }] }, _count: { _all: true } }),
    db.titleLicensee.findFirst({ where: { state, OR: [{ workspaceId: null }, { workspaceId: ws }] }, orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true, source: true } }),
    db.titleCompany.findMany({ where: { workspaceId: ws }, select: { id: true, name: true, licenseNo: true, licenseState: true, state: true } }),
  ]);
  const unders = rows.length ? [...new Set((await db.titleLicensee.findMany({ where: { state, OR: [{ workspaceId: null }, { workspaceId: ws }] }, select: { underwriters: true }, take: 3000 })).flatMap((r) => r.underwriters))].sort() : [];
  const added = (l: { licenseNo: string | null; name: string; state: string }) => mine.find((m) => (l.licenseNo && m.licenseNo === l.licenseNo && (m.licenseState || m.state) === l.state) || (m.name.toLowerCase() === l.name.toLowerCase() && m.state === l.state));
  const writable = !c.workspace.isDemo && can(c.role, "closing");
  const auto = AUTO_STATES[state];
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ state, q: sp.q, county: sp.county, under: sp.under, ...extra })) if (v) u.set(k, v);
    return `/closing/title/directory?${u}`;
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/closing/title", label: "Title companies" }}
        title="Title agency directory"
        sub="Licensed title agencies from free state lists. Free to use: no AI, no paid lookups, no maps."
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {stateCounts
          .sort((a, b) => a.state.localeCompare(b.state))
          .map((s) => (
            <a key={s.state} href={`/closing/title/directory?state=${s.state}`} className={`badge ${s.state === state ? "badge-good" : ""}`}>
              {s.state} · {s._count._all.toLocaleString()}
            </a>
          ))}
      </div>

      <form className="flex flex-wrap gap-2">
        <Combo name="state" options={US_STATES} defaultValue={state} placeholder="State" className="w-48" />
        <input name="q" defaultValue={sp.q} placeholder="Name, city or licence #" className="field max-w-xs" />
        <input name="county" defaultValue={sp.county} placeholder="County" className="field w-40" />
        {unders.length > 0 && (
          <select name="under" defaultValue={sp.under || ""} className="field w-64">
            <option value="">Any underwriter</option>
            {unders.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-ghost">Search</button>
      </form>

      {auto ? (
        <Notice tone="info">
          {state} publishes its title agency licences as free open data ({auto.name}).{" "}
          {latest ? `This list was refreshed ${fmtDate(latest.fetchedAt)}.` : "It hasn't been loaded yet."}
          {writable && (
            <span className="ml-2 inline-block align-middle">
              <ActionButton action={refreshDirectoryAction} hidden={{ state }} className="btn btn-ghost btn-sm">
                {latest ? "Refresh list" : "Load list now"}
              </ActionButton>
            </span>
          )}
        </Notice>
      ) : (
        <Notice tone="info">
          {state} doesn&apos;t publish a free downloadable list of title agencies, so there&apos;s no live feed for it. You can check any company by hand on the state insurance department&apos;s licence lookup (
          <a href={LOOKUP_HELP.naic} target="_blank" rel="noreferrer" className="underline">
            find your state&apos;s site
          </a>
          , or the free{" "}
          <a href={LOOKUP_HELP.nipr} target="_blank" rel="noreferrer" className="underline">
            NIPR lookup
          </a>
          ), and upload any list you have below.
          {ATTORNEY_STATES.includes(state) && <> Closings in {state} are commonly handled by a real estate attorney, so you may want attorneys as well as title agencies.</>}
        </Notice>
      )}

      <Card pad={false} title={`${total.toLocaleString()} in ${state}`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Agency</th>
                  <th>Licence</th>
                  <th>Location</th>
                  <th>Counties</th>
                  <th>Underwriters</th>
                  <th>Contact</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const a = added(l);
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-muted">{l.source === "csv" ? "from your upload" : l.source === "demo" ? "sample" : "state list"}</div>
                      </td>
                      <td className="text-xs">
                        {l.licenseType || "Title agency"} {l.licenseNo ? `#${l.licenseNo}` : ""}
                        <div>
                          <span className={`badge ${l.status === "active" || !l.status ? "badge-good" : "badge-bad"}`}>{l.status || "listed"}</span>
                        </div>
                      </td>
                      <td className="text-xs">{[l.city, l.county ? `${l.county} Co.` : "", l.zip].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="max-w-48 text-xs">{l.counties.length ? `${l.counties.slice(0, 6).join(", ")}${l.counties.length > 6 ? ` +${l.counties.length - 6}` : ""}` : "—"}</td>
                      <td className="max-w-48 text-xs">{l.underwriters.join(", ") || "—"}</td>
                      <td className="text-xs">{[l.phone, l.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td>
                        {a ? (
                          <a href={`/closing/title/${a.id}`} className="text-xs underline">
                            In your list
                          </a>
                        ) : writable ? (
                          <ActionButton action={addFromDirectoryAction} hidden={{ licenseeId: l.id }}>
                            + Add
                          </ActionButton>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={`Nothing listed for ${state}${sp.q || sp.county ? " that matches" : ""}`}>{auto ? "Load the free list above, or upload one." : "Upload a list below, or add title companies by hand."}</Empty>
        )}
      </Card>
      {total > 50 && (
        <div className="flex justify-between text-sm">
          {page > 1 ? <a href={keep({ page: String(page - 1) })}>← Previous</a> : <span />}
          <span className="text-muted">
            Page {page} of {Math.ceil(total / 50)}
          </span>
          {page * 50 < total ? <a href={keep({ page: String(page + 1) })}>Next →</a> : <span />}
        </div>
      )}

      {writable && (
        <Card title="Upload a list (any state)">
          <ActionForm action={uploadDirectoryAction} className="flex flex-wrap items-end gap-2" resetOnOk>
            <Combo name="state" options={US_STATES} defaultValue={state} placeholder="State" className="w-48" />
            <input type="file" name="file" accept=".csv,text/csv" className="field max-w-xs" />
            <Submit className="btn btn-ghost">Upload CSV</Submit>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Columns recognised: name, license_number, license_type, city, county, zip, phone, email, website, status. Uploaded lists are only visible to your workspace.</p>
        </Card>
      )}
    </div>
  );
}
