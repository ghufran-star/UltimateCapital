import { audit, json } from "./audit";
import { normalizeType } from "./catalog";
import { loadSettings } from "./config";
import { db } from "./db";
import { createOpportunity } from "./deals";
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
};

type Person = { first: string; last: string; phones: { number: string; type?: string; dnc?: boolean }[]; emails: string[] };

async function cfg(ws: string) {
  const s = await loadSettings(ws);
  return { provider: (s.PROPERTY_DATA_PROVIDER || "").toLowerCase(), key: s.PROPERTY_DATA_KEY || "", url: s.PROPERTY_DATA_URL || "" };
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

/** Search a market, skip-trace the owners, and load everything as deals (optionally into a campaign). */
export async function importSellerList(ws: string, o: { query: string; lists: string[]; take: number; trace: boolean; campaignId?: string | null; actor: string }) {
  const found = await searchProperties(ws, o);
  const traced = o.trace ? await skipTrace(ws, found) : [];
  let created = 0;
  let phones = 0;
  const contactIds: string[] = [];
  for (const [i, f] of found.entries()) {
    let p = await db.property.findFirst({ where: { workspaceId: ws, address: { equals: f.address, mode: "insensitive" }, zip: f.zip } });
    if (!p) p = await db.property.create({ data: { workspaceId: ws, address: f.address, city: f.city, state: f.state.toUpperCase().slice(0, 2), zip: f.zip, county: f.county || null, propertyType: normalizeType(f.propertyType), beds: f.beds ?? null, baths: f.baths ?? null, sqft: f.sqft ?? null, yearBuilt: f.yearBuilt ?? null, estValue: f.estValue ?? null, loanBalance: f.loanBalance ?? null, absentee: f.absentee ?? null, ownerType: f.ownerType ?? null, lastSalePrice: f.lastSalePrice ?? null, lastSaleDate: f.lastSaleDate && !isNaN(Date.parse(f.lastSaleDate)) ? new Date(f.lastSaleDate) : null, situations: [...new Set([...(f.situations || []), ...o.lists.map((l) => LIST_SITUATION[l]).filter(Boolean)])] } });
    const people = traced[i]?.length ? traced[i] : f.owners.map((x) => ({ first: x.first, last: x.last || x.company || "", phones: f.phones || [], emails: f.emails || [] }));
    let sellerId: string | null = null;
    for (const person of people.slice(0, 2)) {
      const best = person.phones.find((ph) => !ph.dnc && /mobile|wireless|cell/i.test(ph.type || "")) || person.phones.find((ph) => !ph.dnc) || person.phones[0];
      const phone = e164(best?.number);
      const existing = phone ? await db.contact.findFirst({ where: { workspaceId: ws, phone } }) : null;
      const ct = existing || (await db.contact.create({ data: { workspaceId: ws, kind: "seller", firstName: person.first, lastName: person.last, phone, phone2: e164(person.phones.find((x) => x !== best)?.number) || null, email: person.emails[0]?.toLowerCase() || null, state: f.state.toUpperCase().slice(0, 2), city: f.city, sellerStatus: "NEW", tags: o.lists } }));
      if (phone) phones++;
      await db.ownership.upsert({ where: { contactId_propertyId: { contactId: ct.id, propertyId: p.id } }, create: { contactId: ct.id, propertyId: p.id }, update: {} });
      sellerId = sellerId || ct.id;
      contactIds.push(ct.id);
      if (o.campaignId) await db.campaignMember.upsert({ where: { campaignId_contactId_propertyId: { campaignId: o.campaignId, contactId: ct.id, propertyId: p.id } }, create: { campaignId: o.campaignId, contactId: ct.id, propertyId: p.id }, update: {} });
    }
    if (!(await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: p.id } }))) {
      await createOpportunity(ws, { propertyId: p.id, sellerId, campaignId: o.campaignId, actor: o.actor });
      created++;
    }
  }
  if (contactIds.length) await (await import("./dnc")).queueScrub(ws, contactIds);
  await audit(ws, o.actor, "seller_list_imported", undefined, { meta: { query: o.query, lists: o.lists, found: found.length, created, phones } });
  return `${found.length} properties found, ${created} new deals, ${phones} phone numbers${o.trace ? " (skip-traced)" : ""}. DNC pre-checks are running.`;
}

/** Recent cash buyers in a market become buyer contacts with a starting buy box built from what they bought. */
export async function importCashBuyers(ws: string, o: { query: string; take: number; trace: boolean; actor: string }) {
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
  for (const [i, ps] of owners.entries()) {
    const ow = ps[0].owners[0];
    const person = traced[i]?.[0];
    const phone = e164(person?.phones.find((x) => !x.dnc)?.number || person?.phones[0]?.number);
    const email = person?.emails[0]?.toLowerCase() || null;
    const existing = phone ? await db.contact.findFirst({ where: { workspaceId: ws, phone } }) : email ? await db.contact.findFirst({ where: { workspaceId: ws, email } }) : await db.contact.findFirst({ where: { workspaceId: ws, kind: "buyer", OR: [{ company: ow.company || "__none" }, { firstName: ow.first, lastName: ow.last }] } });
    if (existing) continue;
    const prices = ps.map((p) => p.lastSalePrice || 0).filter(Boolean);
    const b = await db.contact.create({ data: { workspaceId: ws, kind: "buyer", firstName: person?.first || ow.first, lastName: person?.last || ow.last, company: ow.company || null, phone, email, state: ps[0].state.toUpperCase().slice(0, 2), city: ps[0].city, buyerStatus: "NEW", tags: ["cash-buyer-list"], notes: `Found from ${ps.length} recent cash purchase(s): ${ps.map((p) => `${p.address}, ${p.city}${p.lastSalePrice ? ` ($${p.lastSalePrice.toLocaleString()})` : ""}`).join("; ")}` } });
    await db.buyBox.create({ data: { contactId: b.id, name: "From recent purchases", states: [...new Set(ps.map((p) => p.state.toUpperCase().slice(0, 2)))], markets: [...new Set(ps.map((p) => p.city))], zips: [...new Set(ps.map((p) => p.zip))], propertyTypes: [...new Set(ps.map((p) => normalizeType(p.propertyType)))], maxPrice: prices.length ? Math.round((Math.max(...prices) * 1.15) / 1000) * 1000 : null, notes: "Starting point inferred from their purchases: confirm on the first call." } });
    made++;
  }
  await audit(ws, o.actor, "cash_buyers_imported", undefined, { meta: { query: o.query, found: found.length, made } });
  return `${found.length} cash purchases, ${owners.length} buyers, ${made} new buyer contacts with a starting buy box.`;
}

export const leadsJson = json;
