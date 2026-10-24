import { audit, json } from "./audit";
import type { Lead } from "./lists";
import { normalizeType } from "./catalog";
import { setting } from "./config";
import { db } from "./db";
import { e164 } from "./util";

// Lead supply: pull seller lists and cash-buyer lists from a property data provider, skip-trace owners
// for phones and emails, and load them straight into deals, buyers and campaigns.
// Provider: BatchData (property search + skip trace), or any endpoint that returns the normalised shape below.

export const SELLER_LISTS = [
  { key: "absentee-owner", label: "Absentee owners" },
  { key: "high-equity", label: "High equity" },
  { key: "free-and-clear", label: "Free and clear" },
  { key: "vacant", label: "Vacant" },
  { key: "preforeclosure", label: "Pre-foreclosure" },
  { key: "tax-default", label: "Tax default" },
  { key: "inherited", label: "Inherited / probate" },
  { key: "senior-owner", label: "Senior owners" },
  { key: "tired-landlord", label: "Tired landlords" },
] as const;

/** Lead list → seller situation tag (lib/catalog.ts SITUATIONS). */
const LIST_SITUATION: Record<string, string> = { "absentee-owner": "absentee", "high-equity": "high_equity", "free-and-clear": "free_clear", vacant: "vacant", preforeclosure: "pre_foreclosure", "tax-default": "tax_delinquent", inherited: "probate", "senior-owner": "senior", "tired-landlord": "tired_landlord" };

export type FoundProperty = {
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  owners: { first: string; last: string; company?: string }[];
  lastSalePrice?: number;
  lastSaleDate?: string;
  cashSale?: boolean;
  estValue?: number;
  loanBalance?: number;
  absentee?: boolean;
  ownerType?: string;
  situations?: string[];
  phones?: { number: string; type?: string; dnc?: boolean }[];
  emails?: string[];
  mailing?: { address?: string; city?: string; state?: string; zip?: string };
};

type Person = { first: string; last: string; phones: { number: string; type?: string; dnc?: boolean }[]; emails: string[] };

async function cfg(ws: string) {
  const [provider, key, url] = await Promise.all([setting(ws, "PROPERTY_DATA_PROVIDER"), setting(ws, "PROPERTY_DATA_KEY"), setting(ws, "PROPERTY_DATA_URL")]);
  return { provider: (provider || "").toLowerCase(), key: key || "", url: url || "" };
}

async function post(url: string, key: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Data provider ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v) || undefined);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function normBatch(p: Record<string, unknown>): FoundProperty {
  const a = (p.address || {}) as Record<string, unknown>;
  const b = (p.building || {}) as Record<string, unknown>;
  const o = (p.owner || {}) as Record<string, unknown>;
  const names = ((o.names || []) as Record<string, unknown>[]).map((n) => ({ first: str(n.first), last: str(n.last), company: n.first || n.last ? undefined : str(n.full) || undefined }));
  const sale = ((p.sale || {}) as Record<string, unknown>).lastSale as Record<string, unknown> | undefined;
  const mail = (o.mailingAddress || {}) as Record<string, unknown>;
  return {
    address: str(a.street),
    city: str(a.city),
    state: str(a.state),
    zip: str(a.zip).slice(0, 5),
    county: str(a.county) || undefined,
    beds: num(b.bedroomCount),
    baths: num(b.bathroomCount),
    sqft: num(b.livingAreaSquareFeet ?? b.totalBuildingAreaSquareFeet),
    yearBuilt: num(b.yearBuilt),
    owners: names.length ? names : [{ first: "", last: "", company: str(o.fullName) || undefined }],
    lastSalePrice: num(sale?.price),
    lastSaleDate: str(sale?.saleDate) || undefined,
    cashSale: sale ? !sale.mortgageAmount && !sale.loanAmount : undefined,
    estValue: num(((p.valuation || {}) as Record<string, unknown>).estimatedValue),
    loanBalance: num(((p.openLien || {}) as Record<string, unknown>).totalOpenLienBalance),
    absentee: typeof ((p.quickLists || {}) as Record<string, unknown>).absenteeOwner === "boolean" ? Boolean(((p.quickLists || {}) as Record<string, unknown>).absenteeOwner) : undefined,
    mailing: mail.street || mail.state ? { address: str(mail.street) || undefined, city: str(mail.city) || undefined, state: str(mail.state).toUpperCase().slice(0, 2) || undefined, zip: str(mail.zip).slice(0, 5) || undefined } : undefined,
  };
}

export async function searchProperties(ws: string, q: { query: string; lists: string[]; take: number; skip?: number }): Promise<FoundProperty[]> {
  const c = await cfg(ws);
  if (!c.provider) throw new Error("Add a property data provider in Settings → Integrations → Data (e.g. BatchData).");
  if (c.provider === "batchdata") {
    const j = await post("https://api.batchdata.com/api/v1/property/search", c.key, { searchCriteria: { query: q.query, ...(q.lists.length ? { quickLists: q.lists } : {}) }, options: { skip: q.skip || 0, take: Math.min(500, q.take) } });
    const props = (((j.results || {}) as Record<string, unknown>).properties || []) as Record<string, unknown>[];
    return props.map(normBatch).filter((p) => p.address && p.zip);
  }
  // Custom endpoint: POST {type:"search", query, lists, take, skip} → {properties: FoundProperty[]}
  const j = await post(c.url, c.key, { type: "search", ...q });
  return ((j.properties || []) as FoundProperty[]).filter((p) => p.address && p.zip);
}

/** How many properties match, before anything is bought. Free on BatchData (one record is asked for). */
export async function countProperties(ws: string, q: { query: string; lists: string[] }): Promise<number | null> {
  const c = await cfg(ws);
  if (!c.provider) throw new Error("Add a property data provider in Settings → Connections → Data (e.g. BatchData).");
  const j =
    c.provider === "batchdata"
      ? await post("https://api.batchdata.com/api/v1/property/search", c.key, { searchCriteria: { query: q.query, ...(q.lists.length ? { quickLists: q.lists } : {}) }, options: { skip: 0, take: 1 } })
      : await post(c.url, c.key, { type: "count", ...q });
  return findTotal(j);
}

/** Finds the result count in a provider response, wherever it sits (resultsFound, totalResults, total, count). */
function findTotal(o: unknown, depth = 0): number | null {
  if (!o || typeof o !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (/^(resultsFound|totalResults|resultCount|total|count)$/i.test(k) && typeof v === "number") return v;
  for (const v of Object.values(o as Record<string, unknown>)) {
    const n = findTotal(v, depth + 1);
    if (n !== null) return n;
  }
  return null;
}

export async function skipTrace(ws: string, rows: { address: string; city: string; state: string; zip: string }[]): Promise<Person[][]> {
  const c = await cfg(ws);
  if (!c.provider) throw new Error("Add a property data provider in Settings → Integrations → Data.");
  if (c.provider === "batchdata") {
    const out: Person[][] = [];
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const j = await post("https://api.batchdata.com/api/v1/property/skip-trace", c.key, { requests: chunk.map((r) => ({ propertyAddress: { street: r.address, city: r.city, state: r.state, zip: r.zip } })) });
      const persons = (((j.results || {}) as Record<string, unknown>).persons || []) as Record<string, unknown>[];
      // Results come back in request order; each may hold several people.
      for (let k = 0; k < chunk.length; k++) {
        const pr = persons[k];
        const list = (pr ? (Array.isArray(pr) ? pr : [pr]) : []) as Record<string, unknown>[];
        out.push(
          list.map((x) => {
            const n = (x.name || {}) as Record<string, unknown>;
            return {
              first: str(n.first),
              last: str(n.last),
              phones: ((x.phoneNumbers || []) as Record<string, unknown>[]).filter((p) => p.reachable !== false).map((p) => ({ number: str(p.number), type: str(p.type) || undefined, dnc: p.dnc === true })),
              emails: ((x.emails || []) as Record<string, unknown>[]).map((e) => str(e.email)).filter(Boolean),
            };
          })
        );
      }
    }
    return out;
  }
  const j = await post(c.url, c.key, { type: "skiptrace", rows });
  return (j.results || []) as Person[][];
}

/** Search a market, skip-trace the owners, and load everything as deals (optionally into a new or existing campaign). */
export async function importSellerList(ws: string, o: { query: string; lists: string[]; take: number; trace: boolean; campaignId?: string | null; newCampaign?: boolean; campaignName?: string | null; state?: string | null; label?: string; actor: string }) {
  const found = await searchProperties(ws, o);
  const traced = o.trace ? await skipTrace(ws, found) : [];
  const { loadSellerLeads } = await import("./lists");
  const leads: Lead[] = found.map((f, i) => {
    const people = traced[i]?.length ? traced[i] : null;
    return {
      ...f,
      state: f.state.toUpperCase().slice(0, 2),
      situations: [...new Set([...(f.situations || []), ...o.lists.map((l) => LIST_SITUATION[l]).filter(Boolean)])],
      owners: people ? people.map((x) => ({ first: x.first, last: x.last })) : f.owners,
      phones: (people ? people[0]?.phones || [] : f.phones || []).map((x) => ({ number: e164(x.number) || "", type: x.type, dnc: x.dnc })).filter((x) => x.number),
      emails: (people ? people[0]?.emails || [] : f.emails || []).map((e) => e.toLowerCase()),
    };
  });
  const label = o.label || `${o.query}${o.lists.length ? ` · ${o.lists.map((l) => SELLER_LISTS.find((x) => x.key === l)?.label || l).join(" + ")}` : ""}`;
  const r = await loadSellerLeads(ws, leads, { source: "list:batchdata", listLabel: label, lists: o.lists, campaign: { mode: o.newCampaign ? "new" : o.campaignId ? "existing" : "none", id: o.campaignId, name: o.campaignName, state: o.state }, actor: o.actor });
  return { ...r, message: `${r.found} properties found: ${r.newDeals} new deals, ${r.newContacts} new owners (${r.duplicates} already on file), ${r.phones} phone numbers${o.trace ? " (skip-traced)" : ""}. Do Not Call checks are running.` };
}

/** Recent cash buyers in a market become buyer contacts with a starting buy box built from what they bought. */
export async function importCashBuyers(ws: string, o: { query: string; take: number; trace: boolean; newCampaign?: boolean; state?: string | null; actor: string }) {
  const found = (await searchProperties(ws, { query: o.query, lists: ["cash-buyer"], take: o.take })).filter((f) => f.cashSale !== false);
  const byOwner = new Map<string, FoundProperty[]>();
  for (const f of found) {
    const ow = f.owners[0];
    const k = (ow?.company || `${ow?.first} ${ow?.last}`).trim().toLowerCase();
    if (!k) continue;
    byOwner.set(k, [...(byOwner.get(k) || []), f]);
  }
  const owners = [...byOwner.values()];
  const traced = o.trace ? await skipTrace(ws, owners.map((ps) => ps[0])) : [];
  let made = 0;
  const ids: string[] = [];
  for (const [i, ps] of owners.entries()) {
    const ow = ps[0].owners[0];
    const person = traced[i]?.[0];
    const phone = e164(person?.phones.find((x) => !x.dnc)?.number || person?.phones[0]?.number);
    const email = person?.emails[0]?.toLowerCase() || null;
    const existing = phone ? await db.contact.findFirst({ where: { workspaceId: ws, phone } }) : email ? await db.contact.findFirst({ where: { workspaceId: ws, email } }) : await db.contact.findFirst({ where: { workspaceId: ws, kind: "buyer", OR: [{ company: ow.company || "__none" }, { firstName: ow.first, lastName: ow.last }] } });
    if (existing) continue;
    const prices = ps.map((p) => p.lastSalePrice || 0).filter(Boolean);
    const b = await db.contact.create({ data: { workspaceId: ws, kind: "buyer", firstName: person?.first || ow.first, lastName: person?.last || ow.last, company: ow.company || null, phone, email, state: ps[0].state.toUpperCase().slice(0, 2), city: ps[0].city, buyerStatus: "NEW", source: "list:batchdata", tags: ["cash-buyer-list"], notes: `Found from ${ps.length} recent cash purchase(s): ${ps.map((p) => `${p.address}, ${p.city}${p.lastSalePrice ? ` ($${p.lastSalePrice.toLocaleString()})` : ""}`).join("; ")}` } });
    await db.buyBox.create({ data: { contactId: b.id, name: "From recent purchases", states: [...new Set(ps.map((p) => p.state.toUpperCase().slice(0, 2)))], markets: [...new Set(ps.map((p) => p.city))], zips: [...new Set(ps.map((p) => p.zip))], propertyTypes: [...new Set(ps.map((p) => normalizeType(p.propertyType)))], maxPrice: prices.length ? Math.round((Math.max(...prices) * 1.15) / 1000) * 1000 : null, notes: "Starting point inferred from their purchases: confirm on the first call." } });
    made++;
    ids.push(b.id);
  }
  let campaign: { id: string; name: string } | null = null;
  if (o.newCampaign && ids.length) {
    const { campaignFor } = await import("./lists");
    campaign = await campaignFor(ws, "buyer", { mode: "new", state: o.state }, `Cash buyers · ${o.query}`, o.state);
    if (campaign) for (const id of ids) await db.campaignMember.create({ data: { campaignId: campaign.id, contactId: id } }).catch(() => null);
  }
  if (ids.length) await (await import("./dnc")).queueScrub(ws, ids);
  await audit(ws, o.actor, "cash_buyers_imported", undefined, { meta: { query: o.query, found: found.length, made } });
  return { message: `${found.length} cash purchases, ${owners.length} buyers, ${made} new buyer contacts with a starting buy box.`, campaignId: campaign?.id || null };
}

export const leadsJson = json;
