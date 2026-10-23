"use server";

import type { ActionState } from "@/components/client";
import { audit, json } from "@/lib/audit";
import { bridgeCall, placeCall, sendEmail, sendSms } from "@/lib/comms";
import { db } from "@/lib/db";
import { createOpportunity, setStage } from "@/lib/deals";
import { queueScrub } from "@/lib/dnc";
import { optOut } from "@/lib/eligibility";
import { createTask, emit } from "@/lib/engine";
import { runMatching, startDemandCampaign } from "@/lib/matching";
import { assertDeal, requireCtx } from "@/lib/session";
import { e164, int, list, num, str } from "@/lib/util";
import { runValuation } from "@/lib/valuation";
import { act } from "./util";

// ---------- CSV ----------

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k];
  return "";
};

async function readUpload(fd: FormData) {
  const f = fd.get("file");
  if (f && typeof f === "object" && "text" in f && f.size > 0) return await f.text();
  return String(fd.get("csv") || "");
}

// ---------- Sellers & properties ----------

async function upsertContact(ws: string, d: { kind: string; firstName: string; lastName: string; phone?: string | null; email?: string | null; state?: string | null; city?: string | null; company?: string | null; tags?: string[] }) {
  const phone = e164(d.phone);
  const email = d.email?.toLowerCase() || null;
  const existing = phone ? await db.contact.findFirst({ where: { workspaceId: ws, phone } }) : email ? await db.contact.findFirst({ where: { workspaceId: ws, email } }) : null;
  if (existing) return existing;
  return db.contact.create({
    data: { workspaceId: ws, kind: d.kind, firstName: d.firstName, lastName: d.lastName, phone, email, state: d.state?.toUpperCase() || null, city: d.city || null, company: d.company || null, tags: d.tags || [], buyerStatus: d.kind === "buyer" ? "NEW" : null, sellerStatus: d.kind === "seller" ? "NEW" : null },
  });
}

export async function createPropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const ws = c.workspace.id;
    const address = str(fd.get("address"));
    const city = str(fd.get("city"));
    const state = str(fd.get("state"))?.toUpperCase();
    const zip = str(fd.get("zip"));
    if (!address || !city || !state || !zip) throw new Error("Address, city, state and ZIP are required.");
    const p = await db.property.create({
      data: {
        workspaceId: ws,
        address,
        city,
        state,
        zip,
        county: str(fd.get("county")),
        propertyType: str(fd.get("propertyType")) || "sfr",
        beds: num(fd.get("beds")),
        baths: num(fd.get("baths")),
        sqft: int(fd.get("sqft")),
        yearBuilt: int(fd.get("yearBuilt")),
        occupancy: str(fd.get("occupancy")),
        conditionTier: str(fd.get("conditionTier")),
      },
    });
    let sellerId: string | null = null;
    const first = str(fd.get("firstName"));
    if (first || str(fd.get("phone"))) {
      const s = await upsertContact(ws, { kind: "seller", firstName: first || "", lastName: str(fd.get("lastName")) || "", phone: str(fd.get("phone")), email: str(fd.get("email")), state, city });
      sellerId = s.id;
      await db.ownership.upsert({ where: { contactId_propertyId: { contactId: s.id, propertyId: p.id } }, create: { contactId: s.id, propertyId: p.id }, update: {} });
    }
    const opp = await createOpportunity(ws, { propertyId: p.id, sellerId, actor: c.user.id, dealType: str(fd.get("dealType")) || "assignment", exitStrategy: str(fd.get("exitStrategy")) || "flip" });
    const asking = int(fd.get("askingPrice"));
    if (asking) await db.opportunity.update({ where: { id: opp.id }, data: { askingPrice: asking } });
    await audit(ws, c.user.id, "property_created", { type: "property", id: p.id });
    return { ok: true, redirect: `/deals/${opp.id}` };
  });
}

export async function importSellersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const ws = c.workspace.id;
    const rows = parseCsv(await readUpload(fd));
    if (!rows.length) throw new Error("No rows found. The first line must be column headers.");
    const campaignId = str(fd.get("campaignId"));
    let made = 0;
    let skipped = 0;
    const touched: string[] = [];
    for (const r of rows.slice(0, 5000)) {
      const address = pick(r, "address", "property_address", "street");
      const city = pick(r, "city", "property_city");
      const state = pick(r, "state", "property_state").toUpperCase().slice(0, 2);
      const zip = pick(r, "zip", "zipcode", "zip_code", "property_zip");
      if (!address || !city || !state || !zip) {
        skipped++;
        continue;
      }
      let p = await db.property.findFirst({ where: { workspaceId: ws, address: { equals: address, mode: "insensitive" }, zip } });
      if (!p)
        p = await db.property.create({
          data: { workspaceId: ws, address, city, state, zip, county: pick(r, "county") || null, propertyType: pick(r, "property_type", "type") || "sfr", beds: Number(pick(r, "beds", "bedrooms")) || null, baths: Number(pick(r, "baths", "bathrooms")) || null, sqft: Number(pick(r, "sqft", "square_feet", "living_area")) || null, yearBuilt: Number(pick(r, "year_built")) || null, occupancy: pick(r, "occupancy") || null, conditionTier: pick(r, "condition") || null },
        });
      const first = pick(r, "first_name", "owner_first_name", "firstname");
      const last = pick(r, "last_name", "owner_last_name", "lastname");
      const owner = pick(r, "owner", "owner_name", "name");
      const phone = pick(r, "phone", "phone1", "owner_phone", "mobile");
      let sellerId: string | null = null;
      if (first || last || owner || phone) {
        const [f, ...l] = (owner || "").split(" ");
        const s = await upsertContact(ws, { kind: "seller", firstName: first || f || "", lastName: last || l.join(" "), phone, email: pick(r, "email", "owner_email"), state, city, tags: pick(r, "tags") ? pick(r, "tags").split(/[;|]/) : [] });
        const p2 = pick(r, "phone2", "phone_2");
        if (p2 && !s.phone2) await db.contact.update({ where: { id: s.id }, data: { phone2: e164(p2) } });
        sellerId = s.id;
        touched.push(s.id);
        await db.ownership.upsert({ where: { contactId_propertyId: { contactId: s.id, propertyId: p.id } }, create: { contactId: s.id, propertyId: p.id }, update: {} });
      }
      const has = await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: p.id } });
      if (!has) await createOpportunity(ws, { propertyId: p.id, sellerId, campaignId, actor: c.user.id });
      if (campaignId && sellerId) await db.campaignMember.upsert({ where: { campaignId_contactId_propertyId: { campaignId, contactId: sellerId, propertyId: p.id } }, create: { campaignId, contactId: sellerId, propertyId: p.id }, update: {} });
      made++;
    }
    await queueScrub(ws, touched);
    await audit(ws, c.user.id, "sellers_imported", undefined, { meta: { rows: rows.length, made, skipped } });
    return { ok: true, message: `Imported ${made} properties${skipped ? `, skipped ${skipped} rows missing address/city/state/ZIP` : ""}.` };
  });
}

export async function updatePropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const id = String(fd.get("propertyId"));
    const p = await db.property.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const prevCondition = (p.condition || {}) as { items?: Record<string, { tier: string; reason?: string }> };
    const items: Record<string, { tier: string; reason?: string }> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("tier_") && v && v !== "unknown") items[k.slice(5)] = { tier: String(v), reason: prevCondition.items?.[k.slice(5)]?.reason };
    await db.property.update({
      where: { id },
      data: {
        beds: num(fd.get("beds")),
        baths: num(fd.get("baths")),
        sqft: int(fd.get("sqft")),
        yearBuilt: int(fd.get("yearBuilt")),
        occupancy: str(fd.get("occupancy")),
        conditionTier: str(fd.get("conditionTier")),
        propertyType: str(fd.get("propertyType")) || p.propertyType,
        county: str(fd.get("county")),
        parcel: str(fd.get("parcel")),
        legalDesc: str(fd.get("legalDesc")),
        titleFlags: list(fd.get("titleFlags")),
        condition: json({ ...prevCondition, items }),
      },
    });
    await audit(c.workspace.id, c.user.id, "property_updated", { type: "property", id });
    await emit(c.workspace.id, "property.changed", { type: "property", id });
    return { ok: true, message: "Saved. The valuation will refresh." };
  });
}

// ---------- Contacts ----------

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const id = String(fd.get("contactId"));
    const ct = await db.contact.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const nb = str(fd.get("nextBuyingAt"));
    await db.contact.update({
      where: { id },
      data: {
        firstName: str(fd.get("firstName")) ?? ct.firstName,
        lastName: str(fd.get("lastName")) ?? ct.lastName,
        company: str(fd.get("company")),
        phone: e164(str(fd.get("phone"))),
        phone2: e164(str(fd.get("phone2"))),
        email: str(fd.get("email"))?.toLowerCase() || null,
        state: str(fd.get("state"))?.toUpperCase() || null,
        city: str(fd.get("city")),
        notes: str(fd.get("notes")),
        tags: list(fd.get("tags")),
        assigneeId: str(fd.get("assigneeId")),
        ...(ct.kind === "buyer"
          ? {
              fundsVerified: fd.get("fundsVerified") === "on",
              fundingMethod: str(fd.get("fundingMethod")),
              closingSpeedDays: int(fd.get("closingSpeedDays")),
              buyingPerMonth: num(fd.get("buyingPerMonth")),
              nextBuyingAt: nb ? new Date(nb) : null,
              maxDealsPerWeek: int(fd.get("maxDealsPerWeek")),
              maxDealsPerMonth: int(fd.get("maxDealsPerMonth")),
              preferredChannel: str(fd.get("preferredChannel")),
              buyerStatus: str(fd.get("buyerStatus")) || ct.buyerStatus,
            }
          : { sellerStatus: str(fd.get("sellerStatus")) || ct.sellerStatus }),
      },
    });
    await audit(c.workspace.id, c.user.id, "contact_updated", { type: "contact", id });
    if (ct.kind === "buyer") await emit(c.workspace.id, "buybox.changed", { type: "contact", id });
    return { ok: true, message: "Saved" };
  });
}

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const body = str(fd.get("body"));
    if (!body) throw new Error("Write a note.");
    const contactId = str(fd.get("contactId"));
    const opportunityId = str(fd.get("opportunityId"));
    const i = await db.interaction.create({ data: { workspaceId: c.workspace.id, contactId, opportunityId, channel: "note", direction: "internal", provider: "manual", body, summary: body.slice(0, 200), status: "done" } });
    if (fd.get("analyse") === "on") await emit(c.workspace.id, "interaction.created", { type: "interaction", id: i.id });
    return { ok: true, message: "Note added" };
  });
}

export async function consentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const contactId = String(fd.get("contactId"));
    await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: c.workspace.id } });
    const channel = String(fd.get("channel"));
    const evidence = str(fd.get("evidence"));
    if (!evidence) throw new Error("Describe how consent was given (where, when, wording).");
    await db.consent.create({ data: { contactId, channel, granted: fd.get("granted") !== "no", evidence: `${evidence} (recorded by ${c.user.name})` } });
    await audit(c.workspace.id, c.user.id, "consent_recorded", { type: "contact", id: contactId }, { meta: { channel } });
    return { ok: true, message: "Consent recorded" };
  });
}

export async function dncContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const contactId = String(fd.get("contactId"));
    await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: c.workspace.id } });
    await optOut(c.workspace.id, contactId, str(fd.get("reason")) || "Marked do-not-contact by user", "internal", c.user.id);
    return { ok: true, message: "Marked do-not-contact. All outreach stopped." };
  });
}

export async function callContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const contactId = String(fd.get("contactId"));
    const mode = String(fd.get("mode") || "me");
    if (mode === "ai") {
      const ct = await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: c.workspace.id } });
      const role = str(fd.get("agentRole")) || (ct.kind === "buyer" ? "buyer_acquisition" : "seller_acquisition");
      const msg = await placeCall(c.workspace.id, { contactId, agentRole: role, opportunityId: str(fd.get("opportunityId")) || undefined });
      return { ok: true, message: msg };
    }
    if (!c.user.phone) throw new Error("Add your phone number in Settings → Profile. We ring you first, then connect the contact.");
    const msg = await bridgeCall(c.workspace.id, c.user.phone, contactId, c.user.id);
    return { ok: true, message: msg };
  });
}

export async function textContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const body = str(fd.get("body"));
    if (!body) throw new Error("Write a message.");
    const msg = await sendSms(c.workspace.id, { contactId: String(fd.get("contactId")), body, opportunityId: str(fd.get("opportunityId")) || undefined });
    return { ok: true, message: msg || "Sent" };
  });
}

export async function emailContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const ct = await db.contact.findFirstOrThrow({ where: { id: String(fd.get("contactId")), workspaceId: c.workspace.id } });
    if (!ct.email) throw new Error("This contact has no email address.");
    const msg = await sendEmail(c.workspace.id, { to: ct.email, subject: str(fd.get("subject")) || "Following up", text: String(fd.get("body") || ""), contactId: ct.id, opportunityId: str(fd.get("opportunityId")) || undefined });
    return { ok: true, message: msg || "Sent" };
  });
}

// ---------- Buyers ----------

export async function createBuyerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const first = str(fd.get("firstName"));
    if (!first && !str(fd.get("company"))) throw new Error("Enter a name or company.");
    const b = await upsertContact(c.workspace.id, { kind: "buyer", firstName: first || "", lastName: str(fd.get("lastName")) || "", company: str(fd.get("company")), phone: str(fd.get("phone")), email: str(fd.get("email")), state: str(fd.get("state")), city: str(fd.get("city")) });
    if (b.kind !== "buyer") await db.contact.update({ where: { id: b.id }, data: { kind: "buyer", buyerStatus: "NEW" } });
    await audit(c.workspace.id, c.user.id, "buyer_created", { type: "contact", id: b.id });
    return { ok: true, redirect: `/contacts/${b.id}` };
  });
}

export async function importBuyersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const ws = c.workspace.id;
    const rows = parseCsv(await readUpload(fd));
    if (!rows.length) throw new Error("No rows found. The first line must be column headers.");
    let made = 0;
    const touched: string[] = [];
    for (const r of rows.slice(0, 5000)) {
      const name = pick(r, "name", "full_name");
      const [f, ...l] = name.split(" ");
      const first = pick(r, "first_name", "firstname") || f || "";
      const phone = pick(r, "phone", "mobile");
      const email = pick(r, "email");
      if (!first && !phone && !email && !pick(r, "company")) continue;
      const b = await upsertContact(ws, { kind: "buyer", firstName: first, lastName: pick(r, "last_name", "lastname") || l.join(" "), company: pick(r, "company", "entity"), phone, email, state: pick(r, "state").slice(0, 2), city: pick(r, "city") });
      touched.push(b.id);
      const states = pick(r, "buy_states", "states") || pick(r, "state");
      const markets = pick(r, "markets", "buy_cities", "cities");
      const zips = pick(r, "zips", "buy_zips");
      if (states || markets || zips || pick(r, "max_price")) {
        const has = await db.buyBox.findFirst({ where: { contactId: b.id } });
        if (!has)
          await db.buyBox.create({
            data: {
              contactId: b.id,
              states: states.split(/[;|,\s]+/).filter(Boolean).map((s) => s.toUpperCase().slice(0, 2)),
              markets: markets.split(/[;|]/).map((s) => s.trim()).filter(Boolean),
              zips: zips.split(/[;|,\s]+/).filter(Boolean),
              propertyTypes: pick(r, "property_types").split(/[;|]/).map((s) => s.trim()).filter(Boolean),
              strategy: pick(r, "strategy") || null,
              minPrice: Number(pick(r, "min_price").replace(/\D/g, "")) || null,
              maxPrice: Number(pick(r, "max_price").replace(/\D/g, "")) || null,
              maxCondition: pick(r, "max_condition") || null,
            },
          });
      }
      made++;
    }
    await queueScrub(ws, touched);
    await audit(ws, c.user.id, "buyers_imported", undefined, { meta: { rows: rows.length, made } });
    return { ok: true, message: `Imported ${made} buyers.` };
  });
}

export async function saveBuyBoxAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const contactId = String(fd.get("contactId"));
    await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: c.workspace.id } });
    const id = str(fd.get("buyBoxId"));
    if (fd.get("delete") && id) {
      await db.buyBox.delete({ where: { id } });
      return { ok: true, message: "Removed" };
    }
    const pctv = num(fd.get("minProfitPct"));
    const data = {
      name: str(fd.get("name")) || "Buy box",
      active: fd.get("active") !== "off",
      states: list(fd.get("states")).map((s) => s.toUpperCase()),
      markets: list(fd.get("markets")),
      zips: list(fd.get("zips")),
      excludedZips: list(fd.get("excludedZips")),
      propertyTypes: fd.getAll("propertyTypes").map(String),
      strategy: str(fd.get("strategy")),
      minPrice: int(fd.get("minPrice")),
      maxPrice: int(fd.get("maxPrice")),
      minBeds: int(fd.get("minBeds")),
      minBaths: num(fd.get("minBaths")),
      minSqft: int(fd.get("minSqft")),
      maxCondition: str(fd.get("maxCondition")),
      occupancyOk: fd.getAll("occupancyOk").map(String),
      minNetProfit: int(fd.get("minNetProfit")),
      minProfitPct: pctv !== null ? pctv / 100 : null,
      profitBasis: str(fd.get("profitBasis")) || "net",
      minCapRate: num(fd.get("minCapRate")) !== null ? (num(fd.get("minCapRate")) as number) / 100 : null,
      notes: str(fd.get("notes")),
    };
    if (id) await db.buyBox.update({ where: { id }, data });
    else await db.buyBox.create({ data: { ...data, contactId } });
    await audit(c.workspace.id, c.user.id, "buybox_saved", { type: "contact", id: contactId }, { after: data });
    await emit(c.workspace.id, "buybox.changed", { type: "contact", id: contactId });
    return { ok: true, message: "Buy box saved. Matching will refresh." };
  });
}

// ---------- Deals ----------

export async function revalueAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    for (const field of ["arv", "repairs"] as const) {
      const v = int(fd.get(field === "arv" ? "arvOverride" : "repairsOverride"));
      if (!v) continue;
      await db.fact.updateMany({ where: { workspaceId: c.workspace.id, entityType: "opportunity", entityId: id, field, supersededAt: null }, data: { supersededAt: new Date() } });
      await db.fact.create({ data: { workspaceId: c.workspace.id, entityType: "opportunity", entityId: id, field, value: v, kind: "verified", confidence: 0.95 } });
    }
    const msg = await runValuation(c.workspace.id, id, { actor: c.user.id, arvOverride: int(fd.get("arvOverride")) || undefined, repairsOverride: int(fd.get("repairsOverride")) || undefined });
    return { ok: true, message: msg };
  });
}

export async function updateDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const sellerLowest = int(fd.get("sellerLowest"));
    await db.opportunity.update({
      where: { id },
      data: {
        askingPrice: int(fd.get("askingPrice")),
        sellerLowest,
        dealType: str(fd.get("dealType")) || opp.dealType,
        exitStrategy: str(fd.get("exitStrategy")) || opp.exitStrategy,
        motivation: str(fd.get("motivation")),
        timeline: str(fd.get("timeline")),
        decisionMakers: str(fd.get("decisionMakers")),
        assigneeId: str(fd.get("assigneeId")),
      },
    });
    await audit(ws, c.user.id, "deal_updated", { type: "opportunity", id });
    await emit(ws, "opportunity.facts_changed", { type: "opportunity", id });
    if (sellerLowest && sellerLowest !== opp.sellerLowest) await emit(ws, "opportunity.seller_moved", { type: "opportunity", id });
    const stage = str(fd.get("stage"));
    if (stage && stage !== opp.stage) await setStage(ws, id, stage, c.user.id);
    const ex = fd.get("exception");
    if (ex !== null && (str(ex) || null) !== opp.exception) await db.opportunity.update({ where: { id }, data: { exception: str(ex) } });
    return { ok: true, message: "Saved" };
  });
}

export async function recordOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const opportunityId = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, opportunityId);
    const price = int(fd.get("price"));
    if (!price) throw new Error("Enter a price.");
    const side = String(fd.get("side") || "seller");
    const by = String(fd.get("by") || "them");
    const count = await db.offer.count({ where: { opportunityId, side } });
    await db.offer.create({ data: { opportunityId, side, by, price, round: count + 1, contactId: str(fd.get("contactId")) || (side === "seller" ? opp.sellerId : null), authority: by === "us" ? "manual" : null, response: str(fd.get("note")) } });
    if (side === "seller" && by === "them" && (!opp.sellerLowest || price < opp.sellerLowest)) {
      await db.opportunity.update({ where: { id: opportunityId }, data: { sellerLowest: price, stage: ["OFFER_READY", "UNDERWRITING"].includes(opp.stage) ? "NEGOTIATION" : opp.stage } });
      await emit(ws, "opportunity.seller_moved", { type: "opportunity", id: opportunityId });
    }
    if (side === "buyer" && by === "them" && fd.get("contactId")) {
      await db.buyerInterest.updateMany({ where: { opportunityId, contactId: String(fd.get("contactId")) }, data: { stage: "OFFER_SUBMITTED", priceMentioned: price, serious: true, respondedAt: new Date() } });
      await emit(ws, "interest.updated", { type: "opportunity", id: opportunityId });
    }
    await audit(ws, c.user.id, "offer_recorded", { type: "opportunity", id: opportunityId }, { meta: { side, by, price } });
    return { ok: true, message: "Recorded" };
  });
}

export async function dealCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    const what = String(fd.get("what"));
    if (what === "match") {
      await runMatching(c.workspace.id, id);
      return { ok: true, message: "Matching refreshed" };
    }
    const msg = await startDemandCampaign(c.workspace.id, id, what === "full" ? "full" : "anonymous");
    return { ok: true, message: msg };
  });
}

export async function interestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const id = String(fd.get("interestId"));
    const it = await db.buyerInterest.findUniqueOrThrow({ where: { id }, include: { opportunity: true } });
    if (it.opportunity.workspaceId !== c.workspace.id) throw new Error("Not found");
    const stage = str(fd.get("stage")) || it.stage;
    await db.buyerInterest.update({ where: { id }, data: { stage, serious: fd.has("serious") ? fd.getAll("serious").includes("on") : it.serious, priceMentioned: int(fd.get("priceMentioned")) ?? it.priceMentioned, notes: str(fd.get("notes")) ?? it.notes, respondedAt: new Date() } });
    await audit(c.workspace.id, c.user.id, "interest_updated", { type: "opportunity", id: it.opportunityId }, { after: { contactId: it.contactId, stage } });
    await emit(c.workspace.id, "interest.updated", { type: "opportunity", id: it.opportunityId });
    return { ok: true, message: "Updated" };
  });
}

export async function chooseBuyerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const opportunityId = String(fd.get("opportunityId"));
    const buyerId = String(fd.get("contactId"));
    const opp = await assertDeal(c, opportunityId);
    const price = int(fd.get("price"));
    if (!price) throw new Error("Enter the buyer's price.");
    const fee = price - (opp.contractPrice || 0);
    const { ensureTransaction } = await import("@/lib/title");
    const tx = await ensureTransaction(ws, opportunityId);
    await db.transaction.update({ where: { id: tx.id }, data: { buyerId, assignmentFee: fee } });
    await db.buyerInterest.updateMany({ where: { opportunityId, contactId: buyerId }, data: { stage: "TERMS_AGREED", priceMentioned: price } });
    const pay = await db.payment.findFirst({ where: { workspaceId: ws, opportunityId, kind: "assignment_fee" } });
    if (pay) await db.payment.update({ where: { id: pay.id }, data: { amount: fee } });
    else await db.payment.create({ data: { workspaceId: ws, opportunityId, kind: "assignment_fee", direction: "in", amount: fee, status: "due", payee: "Us" } });
    await createTask(ws, { kind: "review", title: "Prepare and send the assignment to the buyer", entityType: "opportunity", entityId: opportunityId, priority: 1, assignee: c.user.id, dedupeKey: `assign:${opportunityId}` });
    await audit(ws, c.user.id, "buyer_chosen", { type: "opportunity", id: opportunityId }, { meta: { buyerId, price, fee } });
    return { ok: true, message: `Buyer chosen. Fee ${fee.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.` };
  });
}
