import { createHmac } from "node:crypto";
import { audit } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { fill, fullName } from "./util";

// Designed emails from templates: merge fields, three designs, and a footer that is always added
// (business name and postal address, and a one-click unsubscribe). Plain-text version included.

export const DESIGNS = [
  { key: "letter", label: "Personal letter", hint: "Looks like a normal email from a person. Best for first contact." },
  { key: "card", label: "Clean card", hint: "White card with a coloured line on top." },
  { key: "banner", label: "Bold header", hint: "Your company name on a coloured band. Good for buyer deal alerts." },
] as const;

export const MERGE_FIELDS = [
  ["first_name", "Their first name"],
  ["last_name", "Their last name"],
  ["property_address", "The property's street address"],
  ["property_city", "The property's city"],
  ["company", "Your company name"],
  ["sender_name", "Your name"],
  ["sender_phone", "Your company phone number"],
  ["offer_form_url", "Link to your 'Get a cash offer' form"],
] as const;

export const STARTER_TEMPLATES = [
  {
    name: "First contact: would you sell?",
    audience: "seller",
    design: "letter",
    subject: "Your property at {{property_address}}",
    body: "Hi {{first_name}},\n\nMy name is {{sender_name}} with {{company}}. We buy houses in {{property_city}} for cash, as-is: no repairs, no agent fees, and you pick the closing date.\n\nWould you consider an offer on {{property_address}}? If you'd like one, reply to this email or call me at {{sender_phone}}.\n\nThanks,\n{{sender_name}}",
    buttonText: "",
    buttonUrl: "",
  },
  {
    name: "Follow-up: still thinking about it?",
    audience: "seller",
    design: "card",
    subject: "Checking in about {{property_address}}",
    body: "Hi {{first_name}},\n\nJust checking in. If selling {{property_address}} is still on your mind, we can give you a written cash offer, with no obligation.\n\nTell us a little about the property and the price you have in mind:",
    buttonText: "Get my cash offer",
    buttonUrl: "{{offer_form_url}}",
  },
  {
    name: "Buyers: new deal alert",
    audience: "buyer",
    design: "banner",
    subject: "New off-market deal in {{property_city}}",
    body: "Hi {{first_name}},\n\nWe have a new off-market property in {{property_city}} that fits what you buy. Reply to this email or call {{sender_phone}} for the numbers and a walkthrough.",
    buttonText: "",
    buttonUrl: "",
  },
] as const;

// ---------- unsubscribe links ----------

function unsubSecret() {
  return createHmac("sha256", process.env.SETTINGS_SECRET || process.env.DATABASE_URL || "ultimatecapital").update("uc-unsub").digest();
}
export function unsubToken(contactId: string) {
  const sig = createHmac("sha256", unsubSecret()).update(contactId).digest("base64url").slice(0, 22);
  return `${Buffer.from(contactId).toString("base64url")}.${sig}`;
}
export function readUnsubToken(token: string) {
  const [id64, sig] = token.split(".");
  if (!id64 || !sig) return null;
  const contactId = Buffer.from(id64, "base64url").toString("utf8");
  return createHmac("sha256", unsubSecret()).update(contactId).digest("base64url").slice(0, 22) === sig ? contactId : null;
}

/** Stops marketing email to this person (texts and calls are separate). */
export async function unsubscribe(contactId: string, how: string) {
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return null;
  if (c.email) await db.suppression.create({ data: { workspaceId: c.workspaceId, kind: "email", value: c.email.toLowerCase(), source: "opt_out", reason: `Unsubscribed (${how})` } }).catch(() => null);
  await db.consent.create({ data: { contactId: c.id, channel: "email", granted: false, evidence: `Unsubscribed via ${how} at ${new Date().toISOString()}` } });
  await audit(c.workspaceId, `contact:${c.id}`, "email_unsubscribed", { type: "contact", id: c.id }, { meta: { how } });
  return c;
}

// ---------- rendering ----------

export async function mergeVars(ws: string, o: { contactId?: string | null; opportunityId?: string | null }) {
  const [company, base, owner] = await Promise.all([
    setting(ws, "COMPANY_NAME"),
    setting(ws, "PUBLIC_URL"),
    db.membership.findFirst({ where: { workspaceId: ws, role: "owner" }, include: { user: true } }),
  ]);
  const c = o.contactId ? await db.contact.findUnique({ where: { id: o.contactId }, include: { ownerships: { include: { property: true }, take: 1 } } }) : null;
  const opp = o.opportunityId ? await db.opportunity.findUnique({ where: { id: o.opportunityId }, include: { property: true } }) : null;
  const p = opp?.property || c?.ownerships[0]?.property || null;
  const num = await db.phoneNumber.findFirst({ where: { workspaceId: ws, ...(p?.state ? { OR: [{ state: p.state }, { state: null }] } : {}) }, orderBy: { state: "asc" } });
  const pretty = (n?: string | null) => (n && /^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n || "");
  return {
    first_name: c?.firstName || (c ? fullName(c) : "there"),
    last_name: c?.lastName || "",
    full_name: c ? fullName(c) : "",
    property_address: p?.address || "your property",
    property_city: p?.city || "your area",
    company: company || "our company",
    sender_name: owner?.user.name || company || "",
    sender_phone: pretty(num?.number),
    offer_form_url: base ? `${base.replace(/\/$/, "")}/f/${ws}` : "",
  } as Record<string, string>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : "#0f766e");
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "");

export type Renderable = { subject: string; body: string; design: string; accent: string; buttonText?: string | null; buttonUrl?: string | null };

/** Subject, HTML and plain text, with merge fields filled and the required footer added. */
export function renderEmail(t: Renderable, vars: Record<string, string>, footer: { company: string; address: string; unsubscribeUrl: string }) {
  const subject = fill(t.subject, vars).replace(/\s+/g, " ").trim();
  const text = fill(t.body, vars).trim();
  const accent = safeColor(t.accent);
  const button = t.buttonText && t.buttonUrl ? { text: fill(t.buttonText, vars), url: safeUrl(fill(t.buttonUrl, vars)) } : null;
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const btn = button?.url ? `<p style="margin:8px 0 20px"><a href="${esc(button.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(button.text)}</a></p>` : "";
  const foot = `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280">${esc(footer.company)}${footer.address ? ` · ${esc(footer.address)}` : ""}<br>Don't want these emails? <a href="${esc(footer.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.</p>`;
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111827";
  let html: string;
  if (t.design === "banner") {
    html = `<div style="background:#f3f4f6;padding:24px 12px;${font}"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden"><div style="background:${accent};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700">${esc(footer.company)}</div><div style="padding:24px">${paras}${btn}${foot}</div></div></div>`;
  } else if (t.design === "card") {
    html = `<div style="background:#f3f4f6;padding:24px 12px;${font}"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border-top:4px solid ${accent};padding:24px">${paras}${btn}${foot}</div></div>`;
  } else {
    html = `<div style="${font};max-width:560px;padding:8px">${paras}${btn}${foot}</div>`;
  }
  const plain = `${text}${button?.url ? `\n\n${button.text}: ${button.url}` : ""}\n\n--\n${footer.company}${footer.address ? `, ${footer.address}` : ""}\nUnsubscribe: ${footer.unsubscribeUrl}`;
  return { subject, html: `<!doctype html><html><body style="margin:0">${html}</body></html>`, text: plain };
}

export async function footerFor(ws: string, contactId?: string | null) {
  const [company, address, base] = await Promise.all([setting(ws, "COMPANY_NAME"), setting(ws, "BUSINESS_ADDRESS"), setting(ws, "PUBLIC_URL")]);
  const root = (base || "").replace(/\/$/, "");
  return { company: company || "Our company", address: address || "", unsubscribeUrl: contactId ? `${root}/u/${unsubToken(contactId)}` : `${root}/u/preview` };
}

/** Sends a template to one contact. Blocked (with a clear reason) when the postal address isn't set. */
export async function sendTemplateEmail(ws: string, o: { templateId: string; contactId: string; opportunityId?: string | null; campaignId?: string | null }) {
  const t = await db.emailTemplate.findFirst({ where: { id: o.templateId, workspaceId: ws } });
  if (!t) return "Blocked: email template not found";
  const c = await db.contact.findUnique({ where: { id: o.contactId } });
  if (!c?.email) return "Blocked: no email address";
  const footer = await footerFor(ws, c.id);
  if (!footer.address) return "Blocked: add your business postal address (Settings → Connections → General). It's required on marketing email.";
  const r = renderEmail(t, await mergeVars(ws, o), footer);
  const { sendEmail } = await import("./comms");
  return sendEmail(ws, { to: c.email, subject: r.subject, text: r.text, html: r.html, contactId: c.id, opportunityId: o.opportunityId || undefined, campaignId: o.campaignId || undefined, unsubscribeUrl: footer.unsubscribeUrl });
}

export async function ensureStarterTemplates(ws: string) {
  if (await db.emailTemplate.count({ where: { workspaceId: ws } })) return;
  await db.emailTemplate.createMany({ data: STARTER_TEMPLATES.map((t) => ({ workspaceId: ws, ...t, buttonText: t.buttonText || null, buttonUrl: t.buttonUrl || null })) });
}
