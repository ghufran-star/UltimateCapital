import { createHash } from "node:crypto";
import { audit, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { createOpportunity } from "./deals";
import { createTask, emit } from "./engine";
import { e164, fullName } from "./util";

// "Get a cash offer" form: a public page for your website, ads and email buttons. Leads arrive with
// proof of consent saved (the exact wording they agreed to, when, from which page, IP and browser).

export const CONSENT_VERSION = "2026-10";
export function consentText(company: string) {
  return `By ticking this box, I agree that ${company} may contact me about selling my property at the phone number and email I entered, including calls and texts made with automated technology, an AI voice or prerecorded messages. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out at any time.`;
}

export type FormLead = { firstName: string; lastName: string; phone: string; email: string; address: string; city: string; state: string; zip: string; askingPrice: number | null; timeline: string; condition: string; consent: boolean; page: string; ip: string; userAgent: string };

export async function submitLeadForm(ws: string, f: FormLead) {
  const w = await db.workspace.findUnique({ where: { id: ws } });
  if (!w) throw new Error("This form isn't available.");
  const phone = e164(f.phone);
  const email = f.email.trim().toLowerCase() || null;
  if (!phone && !email) throw new Error("Please enter a phone number or an email so we can send your offer.");
  if (!f.address || !f.city || !f.state || !f.zip) throw new Error("Please enter the property's full address.");
  const company = (await setting(ws, "COMPANY_NAME")) || w.name;
  let contact = phone ? await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone }, { phone2: phone }] } }) : null;
  if (!contact && email) contact = await db.contact.findFirst({ where: { workspaceId: ws, email } });
  if (!contact) contact = await db.contact.create({ data: { workspaceId: ws, kind: "seller", firstName: f.firstName, lastName: f.lastName, phone, email, state: f.state, city: f.city, sellerStatus: "ENGAGED", source: "form", tags: ["website-form"] } });
  else await db.contact.update({ where: { id: contact.id }, data: { phone: contact.phone || phone, email: contact.email || email, doNotContact: false } });
  let p = await db.property.findFirst({ where: { workspaceId: ws, address: { equals: f.address, mode: "insensitive" }, zip: f.zip } });
  if (!p) p = await db.property.create({ data: { workspaceId: ws, address: f.address, city: f.city, state: f.state, zip: f.zip, conditionTier: ["cosmetic", "moderate", "heavy", "gut"].includes(f.condition) ? f.condition : null } });
  await db.ownership.upsert({ where: { contactId_propertyId: { contactId: contact.id, propertyId: p.id } }, create: { contactId: contact.id, propertyId: p.id }, update: {} });
  let opp = await db.opportunity.findFirst({ where: { workspaceId: ws, propertyId: p.id } });
  if (!opp) opp = await createOpportunity(ws, { propertyId: p.id, sellerId: contact.id, actor: `contact:${contact.id}` });
  await db.opportunity.update({ where: { id: opp.id }, data: { leadSource: "website", stage: opp.stage === "NEW" ? "ENGAGED" : opp.stage, ...(f.askingPrice ? { askingPrice: f.askingPrice } : {}), ...(f.timeline ? { timeline: f.timeline } : {}) } });

  // Consent proof: the exact wording, its version and fingerprint, when, where and from what device.
  if (f.consent) {
    const text = consentText(company);
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const evidence = `Web form "Get a cash offer" · ${new Date().toISOString()} · page ${f.page} · IP ${f.ip || "?"} · ${f.userAgent.slice(0, 160)} · wording v${CONSENT_VERSION} #${hash}: "${text}"`;
    for (const channel of ["call", "sms", "ai_voice", "email"]) await db.consent.create({ data: { contactId: contact.id, channel, granted: true, evidence } });
  }
  await db.interaction.create({
    data: { workspaceId: ws, contactId: contact.id, opportunityId: opp.id, channel: "note", direction: "inbound", provider: "form", subject: "Asked for a cash offer", body: [`Property: ${f.address}, ${f.city} ${f.state} ${f.zip}`, f.askingPrice ? `Price in mind: $${f.askingPrice.toLocaleString()}` : "", f.timeline ? `Timeline: ${f.timeline}` : "", f.condition ? `Condition: ${f.condition}` : "", f.consent ? "Agreed to calls and texts (consent saved)" : "Did not tick the consent box: email or call manually"].filter(Boolean).join("\n"), summary: "Filled in the Get a cash offer form" },
  });
  await createTask(ws, { kind: "follow_up", title: `Call ${fullName(contact)}: asked for a cash offer`, reason: "New lead from your website form: call within minutes", contactId: contact.id, entityType: "opportunity", entityId: opp.id, priority: 1, dueAt: new Date(), dedupeKey: `form:${contact.id}` });
  await notify(ws, "New lead: asked for a cash offer", `${fullName(contact)} · ${f.address}, ${f.city}${f.askingPrice ? ` · wants $${f.askingPrice.toLocaleString()}` : ""}`, `/deals/${opp.id}`);
  await audit(ws, `contact:${contact.id}`, "lead_form", { type: "opportunity", id: opp.id }, { meta: { consent: f.consent, version: CONSENT_VERSION, ip: f.ip } });
  if (f.askingPrice) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opp.id });
  return { company };
}
