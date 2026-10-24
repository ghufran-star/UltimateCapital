import type { Prisma } from "@prisma/client";
import { audit, json, notify } from "./audit";
import { claudeJson } from "./claude";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { BUYER_STRATEGIES, PROPERTY_TYPES } from "./catalog";
import { SELLER_STAGES } from "./stages";
import { fullName } from "./util";

// Conversation intelligence: every call, text and email becomes
// transcript → summary → structured facts → profile updates → commitments → next actions.

type Intel = {
  summary: string;
  outcome: string;
  facts: { entity: "contact" | "property" | "opportunity"; field: string; value: string; kind: "reported" | "estimate" | "inferred"; confidence: number }[];
  contact: {
    firstName?: string;
    lastName?: string;
    email?: string;
    state?: string;
    city?: string;
    fundsVerified?: boolean;
    fundingMethod?: string;
    closingSpeedDays?: number;
    buyingPerMonth?: number;
    nextBuyingDate?: string;
    preferredChannel?: string;
    maxDealsPerMonth?: number;
  };
  seller: { askingPrice?: number; lowestPrice?: number; agreedPrice?: number; motivation?: string; timeline?: string; decisionMakers?: string; interested?: "yes" | "no" | "maybe" };
  property: {
    beds?: number;
    baths?: number;
    sqft?: number;
    yearBuilt?: number;
    occupancy?: "vacant" | "tenant" | "owner";
    conditionTier?: "cosmetic" | "moderate" | "heavy" | "gut";
    itemTiers?: { item: string; tier: "none" | "cosmetic" | "moderate" | "heavy" | "gut"; reason: string }[];
    titleFlags?: string[];
  };
  buyBox: {
    mentioned: boolean;
    markets?: string[];
    zips?: string[];
    states?: string[];
    propertyTypes?: string[];
    strategy?: string;
    minPrice?: number;
    maxPrice?: number;
    maxCondition?: string;
    minProfitPct?: number;
  };
  commitments: { what: string; by: "us" | "them"; when: string }[];
  nextActions: { kind: "call" | "sms" | "email" | "follow_up" | "review"; title: string; when: string }[];
  contradictions: { field: string; before: string; now: string }[];
  openQuestions: string[];
  optOut: boolean;
  consent: { aiVoice: boolean; sms: boolean };
  situation: string;
  dealResponse?: { interested: "yes" | "no" | "maybe" | "none"; price?: number; serious?: boolean; reason?: string };
};

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-4 sentences: what happened" },
    outcome: { type: "string", description: "one of: interested, not_interested, callback, voicemail, no_answer, wrong_number, dnc, info_gathered, offer_discussed, agreed_in_principle, other" },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity: { type: "string", enum: ["contact", "property", "opportunity"] },
          field: { type: "string" },
          value: { type: "string" },
          kind: { type: "string", enum: ["reported", "estimate", "inferred"] },
          confidence: { type: "number" },
        },
        required: ["entity", "field", "value", "kind", "confidence"],
      },
    },
    contact: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        state: { type: "string", description: "2-letter" },
        city: { type: "string" },
        fundsVerified: { type: "boolean" },
        fundingMethod: { type: "string", enum: ["cash", "hard_money", "private", "conventional"] },
        closingSpeedDays: { type: "number" },
        buyingPerMonth: { type: "number" },
        nextBuyingDate: { type: "string", description: "ISO date if they said when they buy next" },
        preferredChannel: { type: "string", enum: ["call", "sms", "email"] },
        maxDealsPerMonth: { type: "number" },
      },
    },
    seller: {
      type: "object",
      properties: {
        askingPrice: { type: "number" },
        lowestPrice: { type: "number", description: "Lowest price they indicated they'd accept" },
        agreedPrice: { type: "number", description: "Only if the seller clearly said yes to a specific price WE offered in this conversation (a verbal agreement). Leave out if they only named their own number or were unsure." },
        motivation: { type: "string" },
        timeline: { type: "string" },
        decisionMakers: { type: "string" },
        interested: { type: "string", enum: ["yes", "no", "maybe"] },
      },
    },
    property: {
      type: "object",
      properties: {
        beds: { type: "number" },
        baths: { type: "number" },
        sqft: { type: "number" },
        yearBuilt: { type: "number" },
        occupancy: { type: "string", enum: ["vacant", "tenant", "owner"] },
        conditionTier: { type: "string", enum: ["cosmetic", "moderate", "heavy", "gut"] },
        itemTiers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "roof foundation hvac plumbing electrical kitchen baths flooring paint windows exterior other" },
              tier: { type: "string", enum: ["none", "cosmetic", "moderate", "heavy", "gut"] },
              reason: { type: "string" },
            },
            required: ["item", "tier", "reason"],
          },
        },
        titleFlags: { type: "array", items: { type: "string", enum: ["probate", "liens", "back_taxes", "mortgage_behind", "divorce", "code_violations"] } },
      },
    },
    buyBox: {
      type: "object",
      properties: {
        mentioned: { type: "boolean" },
        markets: { type: "array", items: { type: "string" } },
        zips: { type: "array", items: { type: "string" } },
        states: { type: "array", items: { type: "string" } },
        propertyTypes: { type: "array", items: { type: "string", enum: PROPERTY_TYPES.map((t) => t.key) } },
        strategy: { type: "string", enum: BUYER_STRATEGIES.map((t) => t.key) },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
        maxCondition: { type: "string", enum: ["cosmetic", "moderate", "heavy", "gut"] },
        minProfitPct: { type: "number", description: "e.g. 0.15" },
      },
      required: ["mentioned"],
    },
    commitments: {
      type: "array",
      items: { type: "object", properties: { what: { type: "string" }, by: { type: "string", enum: ["us", "them"] }, when: { type: "string" } }, required: ["what", "by", "when"] },
    },
    nextActions: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["call", "sms", "email", "follow_up", "review"] }, title: { type: "string" }, when: { type: "string", description: "ISO date-time" } },
        required: ["kind", "title", "when"],
      },
    },
    contradictions: { type: "array", items: { type: "object", properties: { field: { type: "string" }, before: { type: "string" }, now: { type: "string" } }, required: ["field", "before", "now"] } },
    openQuestions: { type: "array", items: { type: "string" } },
    optOut: { type: "boolean" },
    consent: { type: "object", properties: { aiVoice: { type: "boolean" }, sms: { type: "boolean" } }, required: ["aiVoice", "sms"] },
    situation: { type: "string", description: "One line: the person's current situation, for the top of their record" },
    dealResponse: {
      type: "object",
      description: "Only for investors/buyers responding to a deal we presented. interested=none if no deal was discussed.",
      properties: {
        interested: { type: "string", enum: ["yes", "no", "maybe", "none"] },
        price: { type: "number", description: "Price they said they'd pay, if stated" },
        serious: { type: "boolean", description: "True if they asked for the address, a walkthrough, or terms, or made an offer with proof of funds" },
        reason: { type: "string" },
      },
      required: ["interested"],
    },
  },
  required: ["summary", "outcome", "facts", "contact", "seller", "property", "buyBox", "commitments", "nextActions", "contradictions", "openQuestions", "optOut", "consent", "situation"],
};

const STAGE_INDEX = (s: string) => SELLER_STAGES.indexOf(s as (typeof SELLER_STAGES)[number]);

export async function processInteraction(ws: string, interactionId: string) {
  const it = await db.interaction.findUnique({ where: { id: interactionId }, include: { contact: true } });
  if (!it || it.processedAt) return "already processed";
  if (!it.body?.trim()) {
    await db.interaction.update({ where: { id: it.id }, data: { processedAt: new Date() } });
    return "nothing to read";
  }
  const contact = it.contact;
  const opp = it.opportunityId
    ? await db.opportunity.findUnique({ where: { id: it.opportunityId }, include: { property: true } })
    : contact
      ? await db.opportunity.findFirst({ where: { workspaceId: ws, sellerId: contact.id }, orderBy: { updatedAt: "desc" }, include: { property: true } })
      : null;
  const prior = contact
    ? await db.fact.findMany({ where: { workspaceId: ws, supersededAt: null, OR: [{ entityId: contact.id }, ...(opp ? [{ entityId: opp.id }, { entityId: opp.propertyId }] : [])] }, take: 80, orderBy: { createdAt: "desc" } })
    : [];

  const today = new Date().toISOString();
  const intel = await claudeJson<Intel>(ws, {
    kind: "fast",
    maxTokens: 5000,
    prompt: `You turn a real estate wholesaling conversation into business records. Today is ${today}.
Person: ${contact ? `${fullName(contact)} (${contact.kind})` : "unknown caller"}
${opp ? `Property: ${opp.property.address}, ${opp.property.city} ${opp.property.state} · deal stage ${opp.stage}` : ""}
Known facts before this conversation:
${prior.map((f) => `- [${f.entityType}] ${f.field}: ${JSON.stringify(f.value)} (${f.kind})`).join("\n") || "none"}

${it.channel.toUpperCase()} (${it.direction})${it.subject ? ` · subject: ${it.subject}` : ""}:
"""
${it.body.slice(0, 30000)}
"""

Rules:
- Only record what was actually said. Mark guesses as "estimate" or "inferred". Never invent numbers.
- Put a value in contact/seller/property/buyBox only if it was stated in THIS conversation.
- contradictions: things that conflict with the known facts above.
- nextActions: concrete follow-ups with an ISO time (e.g. a callback they asked for). Don't add actions for people who opted out.
- optOut: true only if they asked not to be contacted.
- consent.aiVoice / consent.sms: true only if they explicitly agreed to be called by an AI assistant / texted.
- openQuestions: important things still unknown for the next conversation (max 6).`,
    schema: SCHEMA,
  });

  const actor = "agent:intel";
  // ----- facts (versioned, never overwritten) -----
  for (const f of intel.facts || []) {
    const entityId = f.entity === "contact" ? contact?.id : f.entity === "property" ? opp?.propertyId : opp?.id;
    if (!entityId) continue;
    const old = await db.fact.findFirst({ where: { workspaceId: ws, entityType: f.entity, entityId, field: f.field, supersededAt: null } });
    const differs = old && JSON.stringify(old.value) !== JSON.stringify(f.value);
    const created = await db.fact.create({
      data: { workspaceId: ws, entityType: f.entity, entityId, field: f.field, value: json(f.value), kind: f.kind, confidence: f.confidence ?? 0.7, interactionId: it.id, conflictsWith: differs ? old!.id : null },
    });
    if (old) await db.fact.update({ where: { id: old.id }, data: { supersededAt: created.createdAt } });
  }

  // ----- profile updates -----
  if (contact) {
    const c = intel.contact || {};
    const before = { ...contact };
    const data: Record<string, unknown> = {
      summary: intel.situation || contact.summary,
      openQuestions: intel.openQuestions?.slice(0, 6) ?? contact.openQuestions,
      lastContactAt: new Date(),
    };
    if (c.firstName && !contact.firstName) data.firstName = c.firstName;
    if (c.lastName && !contact.lastName) data.lastName = c.lastName;
    if (c.email && !contact.email) data.email = c.email.toLowerCase();
    if (c.state && !contact.state) data.state = c.state.toUpperCase().slice(0, 2);
    if (c.city && !contact.city) data.city = c.city;
    if (contact.kind === "buyer") {
      if (c.fundingMethod) data.fundingMethod = c.fundingMethod;
      if (c.closingSpeedDays) data.closingSpeedDays = Math.round(c.closingSpeedDays);
      if (c.buyingPerMonth) data.buyingPerMonth = c.buyingPerMonth;
      if (c.nextBuyingDate && !isNaN(Date.parse(c.nextBuyingDate))) data.nextBuyingAt = new Date(c.nextBuyingDate);
      if (c.preferredChannel) data.preferredChannel = c.preferredChannel;
      if (c.maxDealsPerMonth) data.maxDealsPerMonth = Math.round(c.maxDealsPerMonth);
      if (!contact.buyerStatus || ["NEW", "ELIGIBLE", "CONTACTED"].includes(contact.buyerStatus)) data.buyerStatus = intel.buyBox?.mentioned ? "QUALIFYING" : "ENGAGED";
    }
    await db.contact.update({ where: { id: contact.id }, data: data as Prisma.ContactUpdateInput });
    await audit(ws, actor, "profile_updated", { type: "contact", id: contact.id }, { before: { summary: before.summary }, after: data, meta: { interactionId: it.id } });

    if (contact.kind === "buyer" && intel.buyBox?.mentioned) {
      const b = intel.buyBox;
      const existing = await db.buyBox.findFirst({ where: { contactId: contact.id }, orderBy: { createdAt: "asc" } });
      const patch = {
        ...(b.markets?.length ? { markets: b.markets } : {}),
        ...(b.zips?.length ? { zips: b.zips } : {}),
        ...(b.states?.length ? { states: b.states.map((s) => s.toUpperCase().slice(0, 2)) } : {}),
        ...(b.propertyTypes?.length ? { propertyTypes: b.propertyTypes } : {}),
        ...(b.strategy ? { strategy: b.strategy } : {}),
        ...(b.minPrice ? { minPrice: Math.round(b.minPrice) } : {}),
        ...(b.maxPrice ? { maxPrice: Math.round(b.maxPrice) } : {}),
        ...(b.maxCondition ? { maxCondition: b.maxCondition } : {}),
        ...(b.minProfitPct ? { minProfitPct: b.minProfitPct } : {}),
      };
      if (existing) await db.buyBox.update({ where: { id: existing.id }, data: patch });
      else await db.buyBox.create({ data: { contactId: contact.id, name: "From conversation", ...patch } });
      await emit(ws, "buybox.changed", { type: "contact", id: contact.id });
    }
  }

  if (opp && contact?.kind !== "buyer") {
    const s = intel.seller || {};
    const p = intel.property || {};
    const oppData: Record<string, unknown> = {};
    if (s.askingPrice) oppData.askingPrice = Math.round(s.askingPrice);
    if (s.motivation) oppData.motivation = s.motivation;
    if (s.timeline) oppData.timeline = s.timeline;
    if (s.decisionMakers) oppData.decisionMakers = s.decisionMakers;
    const lowest = s.lowestPrice || s.askingPrice;
    if (lowest && (!opp.sellerLowest || lowest < opp.sellerLowest)) oppData.sellerLowest = Math.round(lowest);
    // Move forward through early stages only; later stages need explicit actions.
    let target: string | null = null;
    if (s.interested === "no") oppData.exception = "DECLINED";
    else if (s.interested === "yes" || s.interested === "maybe") target = "ENGAGED";
    if (s.motivation && s.timeline) target = "QUALIFIED";
    if (p.itemTiers?.length || p.conditionTier) target = "PROPERTY_DISCOVERY";
    if (target && STAGE_INDEX(target) > STAGE_INDEX(opp.stage) && STAGE_INDEX(opp.stage) < STAGE_INDEX("UNDERWRITING")) oppData.stage = target;
    // A verbal yes to our number: follow up with the written offer letter (or ask the owner first).
    if (s.agreedPrice && s.agreedPrice > 1000 && it.channel === "call" && s.interested !== "no") {
      oppData.sellerLowest = Math.min(Math.round(s.agreedPrice), (oppData.sellerLowest as number) || Infinity, opp.sellerLowest || Infinity);
      await createTask(ws, { kind: "offer_letter", title: `Send the written offer at ${Math.round(s.agreedPrice).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`, entityType: "opportunity", entityId: opp.id, payload: { price: Math.round(s.agreedPrice), interactionId: it.id }, dueAt: new Date(Date.now() + 60_000), dedupeKey: `letter:${opp.id}:${Math.round(s.agreedPrice)}` });
    }
    if (Object.keys(oppData).length) {
      await db.opportunity.update({ where: { id: opp.id }, data: oppData as Prisma.OpportunityUpdateInput });
      await audit(ws, actor, "opportunity_updated", { type: "opportunity", id: opp.id }, { after: oppData, meta: { interactionId: it.id } });
    }
    const propData: Record<string, unknown> = {};
    for (const k of ["beds", "baths", "sqft", "yearBuilt", "occupancy", "conditionTier"] as const) if (p[k] !== undefined && p[k] !== null) propData[k] = k === "sqft" || k === "yearBuilt" ? Math.round(Number(p[k])) : p[k];
    if (p.titleFlags?.length) propData.titleFlags = [...new Set([...opp.property.titleFlags, ...p.titleFlags])];
    if (p.itemTiers?.length) {
      const cond = ((opp.property.condition as Record<string, unknown>) || {}) as Record<string, unknown>;
      const items = { ...((cond.items as Record<string, unknown>) || {}) };
      for (const t of p.itemTiers) items[t.item] = { tier: t.tier, reason: t.reason, interactionId: it.id };
      propData.condition = json({ ...cond, items });
    }
    if (Object.keys(propData).length) {
      await db.property.update({ where: { id: opp.propertyId }, data: propData as Prisma.PropertyUpdateInput });
      await emit(ws, "property.changed", { type: "property", id: opp.propertyId });
    }
    if (oppData.sellerLowest) await emit(ws, "opportunity.seller_moved", { type: "opportunity", id: opp.id });
    // The seller just gave a price for the first time: now it's worth checking sold comparables.
    if (oppData.askingPrice && !opp.askingPrice && !opp.sellerLowest) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opp.id });
  }

  // ----- buyer response to a presented deal -----
  if (contact?.kind === "buyer" && intel.dealResponse && intel.dealResponse.interested !== "none") {
    let interest = it.opportunityId ? await db.buyerInterest.findUnique({ where: { opportunityId_contactId: { opportunityId: it.opportunityId, contactId: contact.id } } }) : null;
    if (!interest) {
      // Replies carry the deal code from the teaser ("YES 7F3A"); without one, the latest deal sent wins.
      const recent = await db.buyerInterest.findMany({ where: { contactId: contact.id, presentedAt: { gte: new Date(Date.now() - 30 * 864e5) } }, orderBy: { presentedAt: "desc" } });
      const words = new Set((it.body || "").toUpperCase().match(/[A-Z0-9]{4}/g) || []);
      interest = recent.find((r) => words.has(r.opportunityId.slice(-4).toUpperCase())) || recent[0] || null;
      if (interest && !it.opportunityId) await db.interaction.update({ where: { id: it.id }, data: { opportunityId: interest.opportunityId } });
    }
    if (interest) {
      const r = intel.dealResponse;
      const stage = r.interested === "no" ? "REJECTED" : r.price ? "OFFER_SUBMITTED" : "INTERESTED";
      await db.buyerInterest.update({
        where: { id: interest.id },
        data: { stage, serious: r.interested === "yes" && !!r.serious ? true : interest.serious, priceMentioned: r.price ? Math.round(r.price) : interest.priceMentioned, respondedAt: new Date(), notes: r.reason || interest.notes },
      });
      await db.contact.update({ where: { id: contact.id }, data: { ignoredInRow: 0 } });
      if (r.price) await db.offer.create({ data: { opportunityId: interest.opportunityId, side: "buyer", contactId: contact.id, price: Math.round(r.price), by: "them", round: 1 } });
      await audit(ws, actor, "buyer_responded", { type: "opportunity", id: interest.opportunityId }, { after: { contactId: contact.id, stage, price: r.price, serious: r.serious } });
      await emit(ws, "interest.updated", { type: "opportunity", id: interest.opportunityId });
    }
  }

  // ----- compliance -----
  if (contact && intel.optOut) await emit(ws, "contact.opt_out", { type: "contact", id: contact.id }, { reason: "Asked not to be contacted", source: "opt_out" });
  if (contact && intel.consent?.aiVoice) await db.consent.create({ data: { contactId: contact.id, channel: "ai_voice", evidence: `Agreed during ${it.channel} ${it.id} on ${today}` } });
  if (contact && intel.consent?.sms) await db.consent.create({ data: { contactId: contact.id, channel: "sms", evidence: `Agreed during ${it.channel} ${it.id} on ${today}` } });

  // ----- commitments & next actions → tasks -----
  if (contact && !intel.optOut) {
    for (const a of intel.nextActions || []) {
      const due = isNaN(Date.parse(a.when)) ? new Date(Date.now() + 24 * 3600_000) : new Date(a.when);
      const auto = a.kind === "call" || a.kind === "sms";
      await createTask(ws, {
        kind: auto ? a.kind : a.kind === "email" ? "follow_up" : a.kind,
        title: a.title.slice(0, 200),
        reason: `From ${it.channel} on ${it.createdAt.toDateString()}`,
        contactId: contact.id,
        entityType: opp ? "opportunity" : "contact",
        entityId: opp?.id || contact.id,
        channel: a.kind,
        dueAt: due,
        assignee: auto ? `agent:${contact.kind === "buyer" ? "buyer_acquisition" : "seller_acquisition"}` : contact.assigneeId || undefined,
        payload: auto ? { agentRole: contact.kind === "buyer" ? "buyer_acquisition" : opp && STAGE_INDEX(opp.stage) >= STAGE_INDEX("OFFER_READY") ? "negotiation" : "seller_acquisition", opportunityId: opp?.id, body: a.kind === "sms" ? a.title : undefined } : undefined,
        dedupeKey: `next:${contact.id}:${a.kind}`,
      });
    }
    for (const c of (intel.commitments || []).filter((x) => x.by === "us")) {
      const due = isNaN(Date.parse(c.when)) ? new Date(Date.now() + 24 * 3600_000) : new Date(c.when);
      await createTask(ws, { kind: "follow_up", title: `We promised: ${c.what}`.slice(0, 200), contactId: contact.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || contact.id, dueAt: due, priority: 1, dedupeKey: `promise:${contact.id}:${c.what.slice(0, 40)}` });
    }
  }
  if (intel.contradictions?.length && contact) {
    await notify(ws, `Conflicting info: ${fullName(contact)}`, intel.contradictions.map((c) => `${c.field}: was "${c.before}", now "${c.now}"`).join("; "), opp ? `/deals/${opp.id}` : `/contacts/${contact.id}`);
  }

  const prevIntel = (it.intel || {}) as Record<string, unknown>;
  await db.interaction.update({ where: { id: it.id }, data: { summary: intel.summary, outcome: it.outcome && it.outcome !== "conversation" ? it.outcome : intel.outcome, intel: json({ ...prevIntel, ...intel }), processedAt: new Date() } });
  if (it.channel === "call" && it.provider === "retell") await createTask(ws, { kind: "call_qa", title: "Check the call against the rules", entityType: "interaction", entityId: it.id, dedupeKey: `qa:${it.id}` });
  return intel.summary;
}
