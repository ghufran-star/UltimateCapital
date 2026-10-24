import { audit } from "./audit";
import { normalizeType, SITUATIONS } from "./catalog";
import { setting } from "./config";
import { db } from "./db";
import { createOpportunity } from "./deals";
import { e164 } from "./util";

// Lists in, the same way whatever the source: a BatchData pull, or a PropStream / BatchLeads / any CSV export.
// Columns are recognised automatically. Duplicates are merged, numbers are DNC pre-checked, and the list
// can go straight into a new campaign.

export type LeadPhone = { number: string; type?: string; dnc?: boolean; litigator?: boolean };
export type Lead = {
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  parcel?: string;
  propertyType?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  lotAcres?: number;
  estValue?: number;
  loanBalance?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  vacant?: boolean;
  absentee?: boolean;
  ownerType?: string;
  situations?: string[];
  owners: { first: string; last: string; company?: string }[];
  mailing?: { address?: string; city?: string; state?: string; zip?: string };
  phones: LeadPhone[];
  emails: string[];
  tags?: string[];
};

export type ListFormat = "propstream" | "batchleads" | "batchdata" | "generic";
export const FORMAT_LABEL: Record<ListFormat, string> = { propstream: "PropStream export", batchleads: "BatchLeads export", batchdata: "BatchData export", generic: "CSV" };

const money = (v?: string) => {
  const n = Math.round(Number(String(v || "").replace(/[$,\s]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const numv = (v?: string) => {
  const n = Number(String(v || "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const yes = (v?: string) => /^(y|yes|true|1|x)$/i.test(String(v || "").trim());
const first = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k];
  return "";
};

/** Which export this is, from its column names (already snake_cased by parseCsv). */
export function detectFormat(cols: string[]): ListFormat {
  const has = (re: RegExp) => cols.some((c) => re.test(c));
  if (has(/^owner_1_first_name$/) || has(/^est_remaining_balance/) || has(/^mls_status$/) || has(/^est_equity/)) return "propstream";
  if (has(/^batchrank/) || has(/^list_count$/) || (has(/^property_address$/) && has(/^owner_first_name$/))) return "batchleads";
  if (has(/^owner_full_name$/) || has(/^property_address_street$/)) return "batchdata";
  return "generic";
}

/** Situations from list names, tags and yes/no columns ("Vacant", "Pre-Foreclosure; Tax Delinquent", …). */
function situationsFrom(r: Record<string, string>, extra: string[] = []) {
  const words = [first(r, "situations", "lists", "list", "list_name", "distress", "tags", "property_tags", "lead_type"), ...extra]
    .join(";")
    .toLowerCase()
    .split(/[;|,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const keys = new Set<string>();
  for (const w of words) {
    const hit = SITUATIONS.find((o) => o.key === w.replace(/[ -]/g, "_") || o.label.toLowerCase().startsWith(w) || w.startsWith(o.label.toLowerCase()));
    if (hit) keys.add(hit.key);
  }
  if (yes(first(r, "vacant", "vacant_flag", "is_vacant"))) keys.add("vacant");
  if (yes(first(r, "pre_foreclosure", "preforeclosure", "foreclosure"))) keys.add("pre_foreclosure");
  if (yes(first(r, "tax_delinquent", "tax_default"))) keys.add("tax_delinquent");
  if (yes(first(r, "probate", "inherited"))) keys.add("probate");
  if (yes(first(r, "free_and_clear"))) keys.add("free_clear");
  if (yes(first(r, "absentee", "absentee_owner"))) keys.add("absentee");
  return [...keys].filter((k) => SITUATIONS.some((s) => s.key === k));
}

/** Every phone column in the row: phone, phone2, phone_1…phone_10, mobile_1, wireless_1, landline_1 + their type / DNC flags. */
function phonesFrom(r: Record<string, string>): LeadPhone[] {
  const out: LeadPhone[] = [];
  const seen = new Set<string>();
  const keys = Object.keys(r).filter((k) => /^(phone|mobile|cell|wireless|landline|owner_phone|primary_phone)(_?\d+)?(_number)?$/.test(k));
  for (const k of keys) {
    const n = e164(r[k]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const base = k.replace(/_number$/, "");
    const type = r[`${base}_type`] || (/^(mobile|cell|wireless)/.test(k) ? "mobile" : /^landline/.test(k) ? "landline" : undefined);
    const dncFlag = r[`${base}_dnc`] || r[`${base}_do_not_call`] || r[`dnc_${base}`];
    const lit = r[`${base}_litigator`] || r[`${base}_tcpa`];
    out.push({ number: n, type, dnc: dncFlag ? yes(dncFlag) || /dnc/i.test(dncFlag) : undefined, litigator: lit ? yes(lit) : undefined });
  }
  return out;
}

function emailsFrom(r: Record<string, string>) {
  return [...new Set(Object.keys(r).filter((k) => /^(email|owner_email|email_address)(_?\d+)?$/.test(k)).map((k) => r[k].trim().toLowerCase()).filter((e) => /@.+\./.test(e)))];
}

/** One CSV row → a lead, whatever the export. Returns null when the property address is incomplete. */
export function leadFromRow(r: Record<string, string>): Lead | null {
  const address = first(r, "address", "property_address", "property_address_street", "street", "site_address", "property_street");
  const city = first(r, "city", "property_city", "property_address_city", "site_city");
  const state = first(r, "state", "property_state", "property_address_state", "site_state").toUpperCase().slice(0, 2);
  const zip = first(r, "zip", "zipcode", "zip_code", "property_zip", "property_zip_code", "property_address_zip", "site_zip").slice(0, 5);
  if (!address || !city || !state || !zip) return null;
  const owners: Lead["owners"] = [];
  for (const n of ["", "1", "_1", "2", "_2"]) {
    const f = first(r, `owner${n}_first_name`, n ? "" : "first_name", n ? "" : "owner_first_name", n ? "" : "firstname");
    const l = first(r, `owner${n}_last_name`, n ? "" : "last_name", n ? "" : "owner_last_name", n ? "" : "lastname");
    const full = first(r, `owner${n}_name`, `owner${n}_full_name`, n ? "" : "owner", n ? "" : "owner_name", n ? "" : "owner_full_name", n ? "" : "name");
    if (!f && !l && !full) continue;
    if (f || l) owners.push({ first: f, last: l });
    else if (/\b(llc|inc|trust|corp|company|co\.?|lp|ltd|estate|bank|holdings|properties)\b/i.test(full)) owners.push({ first: "", last: "", company: full });
    else {
      // "DOE JANE" (county records) or "Jane Doe"
      const parts = full.split(/\s+/);
      owners.push(full === full.toUpperCase() && parts.length > 1 ? { first: parts.slice(1).join(" "), last: parts[0] } : { first: parts[0], last: parts.slice(1).join(" ") });
    }
  }
  const unique = owners.filter((o, i) => owners.findIndex((x) => `${x.first}|${x.last}|${x.company}` === `${o.first}|${o.last}|${o.company}`) === i);
  const mailing = {
    address: first(r, "mailing_address", "owner_mailing_address", "mail_address", "mailing_street", "owner_mailing_street"),
    city: first(r, "mailing_city", "owner_mailing_city", "mail_city"),
    state: first(r, "mailing_state", "owner_mailing_state", "mail_state").toUpperCase().slice(0, 2),
    zip: first(r, "mailing_zip", "mailing_zip_code", "owner_mailing_zip", "mail_zip").slice(0, 5),
  };
  const hasMailing = Boolean(mailing.address || mailing.state);
  const ownerOcc = first(r, "owner_occupied", "owner_occupied_flag");
  const absentee = first(r, "absentee", "absentee_owner") ? yes(first(r, "absentee", "absentee_owner")) : ownerOcc ? !yes(ownerOcc) : hasMailing && mailing.address ? mailing.address.toLowerCase().replace(/\W/g, "") !== address.toLowerCase().replace(/\W/g, "") : undefined;
  const vac = first(r, "vacant", "vacant_flag", "is_vacant");
  const sit = situationsFrom(r);
  if (absentee && !sit.includes("absentee")) sit.push("absentee");
  if (mailing.state && mailing.state !== state && !sit.includes("out_of_state")) sit.push("out_of_state");
  return {
    address,
    city,
    state,
    zip,
    county: first(r, "county", "property_county") || undefined,
    parcel: first(r, "apn", "parcel", "parcel_number", "apn_parcel_id") || undefined,
    propertyType: first(r, "property_type", "type", "property_use", "land_use", "property_class") || undefined,
    beds: numv(first(r, "beds", "bedrooms", "bedroom_count")),
    baths: numv(first(r, "baths", "bathrooms", "total_bathrooms", "bathroom_count")),
    sqft: numv(first(r, "sqft", "square_feet", "living_area", "building_sqft", "living_sqft", "living_area_square_feet")),
    yearBuilt: numv(first(r, "year_built", "effective_year_built")),
    lotAcres: numv(first(r, "lot_acres", "lot_size_acres")),
    estValue: money(first(r, "est_value", "estimated_value", "value", "avm", "estimated_market_value", "market_value")),
    loanBalance: money(first(r, "mortgage_balance", "loan_balance", "open_mortgage_balance", "est_mortgage_balance", "est_remaining_balance_of_open_loans", "total_open_loans", "estimated_loan_balance")),
    lastSalePrice: money(first(r, "last_sale_price", "last_sale_amount", "sale_price")),
    lastSaleDate: first(r, "last_sale_date", "last_sale_recording_date", "sale_date") || undefined,
    vacant: vac ? yes(vac) : undefined,
    absentee,
    ownerType: unique[0]?.company ? (/trust/i.test(unique[0].company) ? "trust" : /estate/i.test(unique[0].company) ? "estate" : "llc") : unique.length > 1 ? "joint" : unique.length ? "individual" : undefined,
    situations: sit,
    owners: unique,
    mailing: hasMailing ? mailing : undefined,
    phones: phonesFrom(r),
    emails: emailsFrom(r),
    tags: first(r, "tags") ? first(r, "tags").split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
  };
}

export function readList(rows: Record<string, string>[]) {
  const cols = Object.keys(rows[0] || {});
  const format = detectFormat(cols);
  const leads: Lead[] = [];
  let skipped = 0;
  for (const r of rows) {
    const l = leadFromRow(r);
    if (l) leads.push(l);
    else skipped++;
  }
  return { format, leads, skipped, columns: cols.length };
}

export type LoadResult = { found: number; newProperties: number; newDeals: number; newContacts: number; duplicates: number; phones: number; skippedDnc: number; campaignId: string | null; campaignName: string | null };

/** Saves leads: properties, owners, deals; duplicates merged; numbers DNC pre-checked; optionally into a campaign. */
export async function loadSellerLeads(
  ws: string,
  leads: Lead[],
  o: { source: string; listLabel: string; lists?: string[]; campaign: { mode: "new" | "existing" | "none"; id?: string | null; name?: string | null; state?: string | null }; actor: string }
): Promise<LoadResult> {
  const campaign = await campaignFor(ws, "seller", o.campaign, o.listLabel, leads[0]?.state);
  const r: LoadResult = { found: leads.length, newProperties: 0, newDeals: 0, newContacts: 0, duplicates: 0, phones: 0, skippedDnc: 0, campaignId: campaign?.id || null, campaignName: campaign?.name || null };
  const touched: string[] = [];
  const members: { contactId: string; propertyId: string }[] = [];
  for (const f of leads.slice(0, 10000)) {
    let p = await db.property.findFirst({ where: { workspaceId: ws, address: { equals: f.address, mode: "insensitive" }, zip: f.zip } });
    if (!p) {
      p = await db.property.create({
        data: {
          workspaceId: ws,
          address: f.address,
          city: f.city,
          state: f.state,
          zip: f.zip,
          county: f.county || null,
          parcel: f.parcel || null,
          propertyType: normalizeType(f.propertyType),
          beds: f.beds ?? null,
          baths: f.baths ?? null,
          sqft: f.sqft ? Math.round(f.sqft) : null,
          yearBuilt: f.yearBuilt ? Math.round(f.yearBuilt) : null,
          lotAcres: f.lotAcres ?? null,
          occupancy: f.vacant ? "vacant" : null,
          estValue: f.estValue ?? null,
          loanBalance: f.loanBalance ?? null,
          absentee: f.absentee ?? null,
          ownerType: f.ownerType ?? null,
          lastSalePrice: f.lastSalePrice ?? null,
          lastSaleDate: f.lastSaleDate && !isNaN(Date.parse(f.lastSaleDate)) ? new Date(f.lastSaleDate) : null,
          situations: [...new Set(f.situations || [])],
        },
      });
      r.newProperties++;
    } else if (f.situations?.length) {
      const merged = [...new Set([...p.situations, ...f.situations])];
      if (merged.length !== p.situations.length) await db.property.update({ where: { id: p.id }, data: { situations: merged } });
    }
    // Litigators flagged by the list provider are suppressed for good.
    for (const ph of f.phones.filter((x) => x.litigator)) await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: ph.number, source: "litigator", reason: `Flagged in ${o.listLabel}` } }).catch(() => null);
    const usable = f.phones.filter((x) => !x.litigator);
    const owners = f.owners.length ? f.owners.slice(0, 2) : [{ first: "", last: "", company: undefined }];
    let sellerId: string | null = null;
    for (const [i, ow] of owners.entries()) {
      // Phones and emails belong to the first owner unless the export splits them.
      const ph = i === 0 ? usable : [];
      const best = ph.find((x) => !x.dnc && /mobile|wireless|cell/i.test(x.type || "")) || ph.find((x) => !x.dnc) || ph[0];
      const second = ph.find((x) => x !== best && !x.dnc) || ph.find((x) => x !== best);
      const email = i === 0 ? f.emails[0] || null : null;
      if (!best && !email && !ow.first && !ow.last && !ow.company) continue;
      const existing = best
        ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: best.number }, { phone2: best.number }] } })
        : email
          ? await db.contact.findFirst({ where: { workspaceId: ws, email } })
          : await db.contact.findFirst({ where: { workspaceId: ws, kind: "seller", firstName: ow.first, lastName: ow.last || ow.company || "", ownerships: { some: { propertyId: p.id } } } });
      let ct = existing;
      if (ct) r.duplicates++;
      else {
        ct = await db.contact.create({
          data: {
            workspaceId: ws,
            kind: "seller",
            firstName: ow.first,
            lastName: ow.last || ow.company || "",
            company: ow.company || null,
            phone: best?.number || null,
            phone2: second?.number || null,
            email,
            state: f.mailing?.state || f.state,
            city: f.mailing?.city || f.city,
            mailingAddress: f.mailing?.address || null,
            mailingCity: f.mailing?.city || null,
            mailingZip: f.mailing?.zip || null,
            sellerStatus: "NEW",
            source: o.source,
            tags: [...new Set([...(o.lists || []), ...(f.tags || [])])],
          },
        });
        r.newContacts++;
        if (best) r.phones++;
        if (best?.dnc) r.skippedDnc++;
      }
      await db.ownership.upsert({ where: { contactId_propertyId: { contactId: ct.id, propertyId: p.id } }, create: { contactId: ct.id, propertyId: p.id }, update: {} });
      sellerId = sellerId || ct.id;
      touched.push(ct.id);
      if (campaign && !ct.doNotContact) members.push({ contactId: ct.id, propertyId: p.id });
    }
    if (!(await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: p.id } }))) {
      const opp = await createOpportunity(ws, { propertyId: p.id, sellerId, campaignId: campaign?.id, actor: o.actor });
      await db.opportunity.update({ where: { id: opp.id }, data: { leadSource: o.source.startsWith("list") ? "list_provider" : o.source === "form" ? "website" : "imported" } }).catch(() => null);
      r.newDeals++;
    }
  }
  if (campaign) {
    for (const m of members) await db.campaignMember.upsert({ where: { campaignId_contactId_propertyId: { campaignId: campaign.id, contactId: m.contactId, propertyId: m.propertyId } }, create: { campaignId: campaign.id, ...m }, update: {} });
  }
  if (touched.length) await (await import("./dnc")).queueScrub(ws, touched);
  await audit(ws, o.actor, "list_imported", campaign ? { type: "campaign", id: campaign.id } : undefined, { meta: { source: o.source, list: o.listLabel, ...r } });
  return r;
}

/** Buyers from a file (BatchLeads cash buyers, PropStream cash buyer export, or any CSV), with a starting buy box when columns allow. */
export async function loadBuyerRows(ws: string, rows: Record<string, string>[], o: { source: string; listLabel: string; campaign: { mode: "new" | "existing" | "none"; id?: string | null; name?: string | null }; actor: string }) {
  const campaign = await campaignFor(ws, "buyer", o.campaign, o.listLabel, null);
  let made = 0;
  let dupes = 0;
  const touched: string[] = [];
  for (const r of rows.slice(0, 10000)) {
    const full = first(r, "name", "full_name", "buyer_name", "owner_name", "owner_1_full_name");
    const company = first(r, "company", "entity", "company_name", "owner_company", "llc");
    const [f, ...l] = full.split(" ");
    const firstName = first(r, "first_name", "firstname", "owner_first_name", "owner_1_first_name") || (company && !first(r, "first_name") ? "" : f || "");
    const lastName = first(r, "last_name", "lastname", "owner_last_name", "owner_1_last_name") || (company && !first(r, "last_name") ? "" : l.join(" "));
    const phones = phonesFrom(r).filter((x) => !x.litigator);
    const phone = (phones.find((x) => !x.dnc && /mobile|wireless|cell/i.test(x.type || "")) || phones.find((x) => !x.dnc) || phones[0])?.number || null;
    const email = emailsFrom(r)[0] || null;
    if (!firstName && !lastName && !company && !phone && !email) continue;
    const existing = phone ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone }, { phone2: phone }] } }) : email ? await db.contact.findFirst({ where: { workspaceId: ws, email } }) : company ? await db.contact.findFirst({ where: { workspaceId: ws, kind: "buyer", company } }) : null;
    if (existing) {
      dupes++;
      touched.push(existing.id);
      if (campaign && !existing.doNotContact && !(await db.campaignMember.findFirst({ where: { campaignId: campaign.id, contactId: existing.id } }))) await db.campaignMember.create({ data: { campaignId: campaign.id, contactId: existing.id } });
      continue;
    }
    const state = first(r, "state", "mailing_state", "buy_state", "property_state").toUpperCase().slice(0, 2) || null;
    const b = await db.contact.create({
      data: {
        workspaceId: ws,
        kind: "buyer",
        firstName,
        lastName,
        company: company || null,
        phone,
        phone2: phones.find((x) => x.number !== phone)?.number || null,
        email,
        state,
        city: first(r, "city", "mailing_city") || null,
        mailingAddress: first(r, "mailing_address") || null,
        mailingZip: first(r, "mailing_zip").slice(0, 5) || null,
        buyerStatus: "NEW",
        source: o.source,
        tags: ["cash-buyer-list"],
      },
    });
    made++;
    touched.push(b.id);
    const states = first(r, "buy_states", "states") || first(r, "property_state", "state");
    const markets = first(r, "markets", "buy_cities", "cities") || first(r, "property_city");
    const zips = first(r, "zips", "buy_zips") || first(r, "property_zip");
    const lastPrice = money(first(r, "last_sale_price", "purchase_price", "last_purchase_price", "max_price"));
    if (states || markets || zips || lastPrice) {
      await db.buyBox.create({
        data: {
          contactId: b.id,
          name: "From the list",
          states: states.split(/[;|,\s]+/).filter(Boolean).map((s) => s.toUpperCase().slice(0, 2)),
          markets: markets.split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          zips: zips.split(/[;|,\s]+/).filter(Boolean).map((z) => z.slice(0, 5)),
          propertyTypes: first(r, "property_types").split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          strategy: first(r, "strategy") || null,
          minPrice: money(first(r, "min_price")) || null,
          maxPrice: money(first(r, "max_price")) || (lastPrice ? Math.round((lastPrice * 1.15) / 1000) * 1000 : null),
          maxCondition: first(r, "max_condition") || null,
          notes: "Starting point from the list: confirm on the first call.",
        },
      });
    }
    if (campaign) await db.campaignMember.create({ data: { campaignId: campaign.id, contactId: b.id } }).catch(() => null);
  }
  if (touched.length) await (await import("./dnc")).queueScrub(ws, touched);
  await audit(ws, o.actor, "buyer_list_imported", campaign ? { type: "campaign", id: campaign.id } : undefined, { meta: { source: o.source, list: o.listLabel, rows: rows.length, made, dupes } });
  return { made, dupes, campaignId: campaign?.id || null, campaignName: campaign?.name || null };
}

/** A new campaign for this list (ready, not started), an existing one, or none. Cold outreach mode adds texts and email. */
export async function campaignFor(ws: string, kind: "seller" | "buyer", c: { mode: "new" | "existing" | "none"; id?: string | null; name?: string | null; state?: string | null }, listLabel: string, state?: string | null) {
  if (c.mode === "existing" && c.id) return db.campaign.findFirst({ where: { id: c.id, workspaceId: ws } });
  if (c.mode !== "new") return null;
  const { DEFAULT_CAMPAIGN, roleFor } = await import("./campaigns");
  const { getCompliance } = await import("./switches");
  const cold = (await getCompliance(ws)).coldOutreach;
  const agent = await db.agent.findFirst({ where: { workspaceId: ws, role: roleFor(kind), active: true } });
  const tpl = cold ? await db.emailTemplate.findFirst({ where: { workspaceId: ws, active: true, audience: { in: [kind, "any"] } }, orderBy: { updatedAt: "desc" } }) : null;
  return db.campaign.create({
    data: {
      workspaceId: ws,
      kind,
      name: (c.name || `${listLabel} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`).slice(0, 120),
      status: "draft",
      state: c.state || state || null,
      agentId: agent?.id || null,
      channels: cold ? ["call", "sms", ...(tpl ? ["email"] : [])] : ["call", "human"],
      settings: JSON.parse(JSON.stringify({ ...DEFAULT_CAMPAIGN, objective: kind === "seller" ? "First conversation: learn the owner's situation, timeline and price. No offers on the first call." : "Learn what each investor buys and how fast they close.", emailTemplateId: tpl?.id || null, fromList: listLabel })),
    },
  });
}

// ---------- BatchData pull: state → county → list type, with a count and cost before buying ----------

export async function listCosts(ws: string) {
  const perRecord = Number((await setting(ws, "COST_PER_LIST_RECORD")) || 0.02) || 0.02;
  const perTrace = Number((await setting(ws, "COST_PER_SKIP_TRACE")) || 0.1) || 0.1;
  return { perRecord, perTrace };
}

export function marketQuery(q: { state: string; county?: string | null; city?: string | null; zip?: string | null }) {
  if (q.zip) return q.zip.trim();
  if (q.city) return `${q.city.trim()}, ${q.state}`;
  if (q.county) return `${q.county.replace(/\s+county$/i, "").trim()} County, ${q.state}`;
  return q.state;
}
