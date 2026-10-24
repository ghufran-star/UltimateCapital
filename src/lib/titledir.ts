import { parseCsv, pick } from "./csv";
import { db } from "./db";
import { e164 } from "./util";

// Title companies: a free directory of licensed title agencies (from state lists that are
// published for free), and a track record built from the user's own deals. No AI, no paid maps.

/** States that publish their title-agency licence list as free, machine-readable open data. */
export const AUTO_STATES: Record<string, { name: string; source: string; url: string }> = {
  TX: { name: "Texas Department of Insurance", source: "tx_tdi", url: "https://data.texas.gov/dataset/3yqc-fcdt" },
};

/** Where to check a licence by hand in every other state. */
export const LOOKUP_HELP = {
  naic: "https://content.naic.org/state-insurance-departments",
  nipr: "https://nipr.com/help/look-up-a-license",
};

/** States where closings are commonly run by (or require) a real estate attorney. A guide, not legal advice. */
export const ATTORNEY_STATES = ["CT", "DE", "DC", "GA", "MA", "NY", "NC", "SC", "WV", "KY", "ME", "NH", "NJ", "RI", "VT", "MS"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (s?: string | null) => (s ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Lp|Llp|Pllc|Inc)\b/g, (m) => m.toUpperCase()) : null);

async function socrata<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 200_000; offset += 50_000) {
    const u = new URL(`https://data.texas.gov/resource/${dataset}.json`);
    for (const [k, v] of Object.entries({ ...params, $limit: "50000", $offset: String(offset) })) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`Texas open data returned ${r.status}. Try again later.`);
    const rows = (await r.json()) as T[];
    out.push(...rows);
    if (rows.length < 50_000) break;
  }
  return out;
}

/** Refresh the free Texas list: licensed title agencies + the counties and underwriters each is appointed for. */
export async function refreshTexas() {
  type Agency = { agency_license_number?: string; org_name?: string; license_type?: string; city?: string; state?: string; pstl_cd?: string; county?: string; expiration_date?: string };
  type Appt = { agy_lic_nbr?: string; county?: string; underwriter_name?: string };
  const agencies = await socrata<Agency>("3yqc-fcdt", { $where: "license_type in('Title Agency','Title Direct Operations')" });
  const appts = await socrata<Appt>("y9ze-ft94", { $select: "agy_lic_nbr,county,underwriter_name" });
  const counties = new Map<string, Set<string>>();
  const unders = new Map<string, Set<string>>();
  for (const a of appts) {
    if (!a.agy_lic_nbr) continue;
    if (a.county) (counties.get(a.agy_lic_nbr) || counties.set(a.agy_lic_nbr, new Set()).get(a.agy_lic_nbr)!).add(title(a.county)!);
    if (a.underwriter_name) (unders.get(a.agy_lic_nbr) || unders.set(a.agy_lic_nbr, new Set()).get(a.agy_lic_nbr)!).add(title(a.underwriter_name)!);
  }
  const now = new Date();
  let n = 0;
  for (const a of agencies) {
    if (!a.org_name || !a.agency_license_number) continue;
    const lic = a.agency_license_number;
    const data = {
      state: "TX",
      name: title(a.org_name)!,
      licenseNo: lic,
      licenseType: a.license_type || null,
      city: title(a.city),
      county: title(a.county),
      zip: a.pstl_cd?.slice(0, 5) || null,
      counties: [...(counties.get(lic) || [])].sort(),
      underwriters: [...(unders.get(lic) || [])].sort(),
      status: a.expiration_date && new Date(a.expiration_date) < now ? "expired" : "active",
      source: "tx_tdi",
      fetchedAt: now,
    };
    await db.titleLicensee.upsert({ where: { key: `public:TX:${lic}` }, create: { key: `public:TX:${lic}`, workspaceId: null, ...data }, update: data });
    n++;
  }
  // Anyone no longer on the list has lost or dropped the licence.
  await db.titleLicensee.updateMany({ where: { workspaceId: null, state: "TX", source: "tx_tdi", fetchedAt: { lt: now } }, data: { status: "not on latest list" } });
  return n;
}

/** Any state's list (downloaded from the state's site, or your own) uploaded as CSV. */
export async function importLicenseeCsv(ws: string, state: string, text: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("No rows found. The first line must be column headers.");
  let n = 0;
  for (const r of rows.slice(0, 20_000)) {
    const name = pick(r, "name", "agency_name", "company", "company_name", "org_name", "licensee_name", "business_name", "entity_name");
    if (!name) continue;
    const st = (pick(r, "state", "license_state") || state).toUpperCase().slice(0, 2);
    const lic = pick(r, "license", "license_number", "license_no", "licence_number", "lic_no", "npn");
    const key = `${ws}:${st}:${lic || slug(name)}`;
    const data = {
      workspaceId: ws,
      state: st,
      name,
      licenseNo: lic || null,
      licenseType: pick(r, "license_type", "type", "class") || null,
      city: pick(r, "city", "business_city") || null,
      county: pick(r, "county") || null,
      zip: pick(r, "zip", "zip_code", "postal_code").slice(0, 5) || null,
      phone: e164(pick(r, "phone", "phone_number", "business_phone")) || null,
      email: pick(r, "email", "email_address").toLowerCase() || null,
      website: pick(r, "website", "web", "url") || null,
      status: pick(r, "status", "license_status") || null,
      source: "csv",
      fetchedAt: new Date(),
    };
    await db.titleLicensee.upsert({ where: { key }, create: { key, ...data }, update: data });
    n++;
  }
  return n;
}

export type TrackRecord = { deals: number; open: number; closed: number; fell: number; avgDays: number | null; onTime: number | null; issues: number; fees: number; last: Date | null };

/** How a title company has actually done on this workspace's deals. */
export async function trackRecords(ws: string, ids?: string[]): Promise<Map<string, TrackRecord>> {
  const txs = await db.transaction.findMany({
    where: { workspaceId: ws, titleCompanyId: ids ? { in: ids } : { not: null } },
    select: { titleCompanyId: true, stage: true, createdAt: true, closingAt: true, paidAt: true, checklist: true, settlement: true, netProceeds: true, assignmentFee: true, opportunity: { select: { stage: true } } },
  });
  const out = new Map<string, TrackRecord>();
  const days = new Map<string, number[]>();
  const timely = new Map<string, boolean[]>();
  for (const t of txs) {
    const id = t.titleCompanyId!;
    const r = out.get(id) || { deals: 0, open: 0, closed: 0, fell: 0, avgDays: null, onTime: null, issues: 0, fees: 0, last: null };
    r.deals++;
    if (!r.last || t.createdAt > r.last) r.last = t.createdAt;
    const items = (t.checklist || []) as { key: string; done?: boolean; doneAt?: string }[];
    const funded = items.find((i) => i.key === "funded" && i.done);
    const closed = ["CLOSED", "RECONCILED"].includes(t.stage) || Boolean(t.paidAt) || Boolean(funded);
    if (closed) {
      r.closed++;
      r.fees += t.netProceeds ?? t.assignmentFee ?? 0;
      const end = funded?.doneAt ? new Date(funded.doneAt) : t.paidAt || t.closingAt;
      if (end) (days.get(id) || days.set(id, []).get(id)!).push(Math.max(0, Math.round((end.getTime() - t.createdAt.getTime()) / 86_400_000)));
      if (end && t.closingAt) (timely.get(id) || timely.set(id, []).get(id)!).push(end.getTime() <= t.closingAt.getTime() + 86_400_000);
    } else if (["DECLINED", "WITHDRAWN", "CONTRACT_FAILED", "OWNERSHIP_DISPUTE"].includes(t.opportunity.stage)) r.fell++;
    else r.open++;
    const s = t.settlement as { issues?: unknown[] } | null;
    r.issues += Array.isArray(s?.issues) ? s!.issues.length : 0;
    out.set(id, r);
  }
  for (const [id, r] of out) {
    const d = days.get(id);
    if (d?.length) r.avgDays = Math.round(d.reduce((a, b) => a + b, 0) / d.length);
    const ot = timely.get(id);
    if (ot?.length) r.onTime = Math.round((ot.filter(Boolean).length / ot.length) * 100);
  }
  return out;
}

/** Does the directory show this company as licensed? */
export async function licenceMatch(ws: string, t: { name: string; licenseNo?: string | null; licenseState?: string | null; state?: string | null }) {
  const st = t.licenseState || t.state;
  if (!st) return null;
  const scope = { OR: [{ workspaceId: null }, { workspaceId: ws }] };
  if (t.licenseNo) {
    const hit = await db.titleLicensee.findFirst({ where: { ...scope, state: st, licenseNo: t.licenseNo } });
    if (hit) return hit;
  }
  return db.titleLicensee.findFirst({ where: { ...scope, state: st, name: { equals: t.name, mode: "insensitive" } } });
}

/** The yes/no capabilities a wholesaler needs to know about a title company. */
export const TITLE_CAPS = [
  { key: "assignments", label: "Closes assignments", short: "Assign" },
  { key: "doubleClose", label: "Double closes", short: "Double" },
  { key: "transactionalFunding", label: "Accepts transactional funding", short: "TF" },
  { key: "remoteClosing", label: "Remote online closings", short: "RON" },
  { key: "mobileNotary", label: "Sends a mobile notary", short: "Notary" },
] as const;
export type TitleCapKey = (typeof TITLE_CAPS)[number]["key"];
