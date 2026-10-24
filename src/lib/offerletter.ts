import { randomBytes } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { audit, json, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { fullName, usd } from "./util";

// Written offer letter to a seller: a one-page PDF, emailed as an attachment and texted as a link.
// The link shows when it was opened and lets the seller say "Ready to proceed" or counter.
// It's a letter of intent, not the contract: the purchase agreement follows for signature.

export type LetterFields = {
  sellerName: string;
  propertyAddress: string;
  price: number;
  closingDays: number;
  emd: number;
  inspectionDays: number;
  closingCosts: "buyer" | "customary" | "split";
  asIs: boolean;
  expiresDays: number;
  extraTerms: string;
  note: string;
  companyName: string;
  fromName: string;
  fromPhone: string;
  fromEmail: string;
};

const COSTS: Record<LetterFields["closingCosts"], string> = { buyer: "We pay all closing costs", customary: "Closing costs split as is customary in your county", split: "Closing costs split 50/50" };

export async function letterDefaults(ws: string, opportunityId: string, price?: number, actor?: { name: string; email?: string | null; phone?: string | null }): Promise<LetterFields> {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
  const { calcFor } = await import("./deals");
  const { calc } = await calcFor(opportunityId);
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  const p = opp.property;
  return {
    sellerName: seller ? fullName(seller) : "Property owner",
    propertyAddress: `${p.address}, ${p.city}, ${p.state} ${p.zip}`,
    price: price || (opp.sellerLowest && calc && opp.sellerLowest <= calc.maxBuy ? opp.sellerLowest : calc?.maxBuy || 0),
    closingDays: 21,
    emd: 1000,
    inspectionDays: 7,
    closingCosts: "buyer",
    asIs: true,
    expiresDays: 5,
    extraTerms: "",
    note: seller?.firstName ? `${seller.firstName}, thank you for talking with us about the property. Here is our offer in writing, as discussed.` : "Thank you for talking with us about the property. Here is our offer in writing, as discussed.",
    companyName: company,
    fromName: actor?.name || company,
    fromPhone: actor?.phone || "",
    fromEmail: actor?.email || (await setting(ws, "EMAIL_FROM")) || "",
  };
}

/** Standard PDF fonts only cover Latin-1, so typographic characters are simplified. */
const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderOfferPdf(f: LetterFields, date = new Date()) {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`Offer - ${f.propertyAddress}`));
  doc.setAuthor(safe(f.companyName));
  const page = doc.addPage([612, 792]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const brand = rgb(0.05, 0.45, 0.35);
  const L = 60;
  const W = 492;
  let y = 740;
  const text = (s: string, o: { size?: number; font?: PDFFont; color?: typeof ink; x?: number } = {}) => {
    page.drawText(safe(s), { x: o.x ?? L, y, size: o.size ?? 11, font: o.font ?? reg, color: o.color ?? ink });
  };
  const para = (s: string, size = 11, gap = 15) => {
    for (const line of wrap(s, reg, size, W)) {
      text(line, { size });
      y -= gap;
    }
  };
  text(f.companyName, { size: 16, font: bold, color: brand });
  y -= 16;
  text([f.fromName !== f.companyName ? f.fromName : "", f.fromPhone, f.fromEmail].filter(Boolean).join("  |  "), { size: 9, color: muted });
  y -= 30;
  text(date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), { size: 10, color: muted });
  y -= 24;
  text(`To: ${f.sellerName}`);
  y -= 15;
  text(`Re: ${f.propertyAddress}`);
  y -= 30;
  text("Cash offer to purchase", { size: 13, font: bold });
  y -= 30;
  text(usd(f.price), { size: 30, font: bold, color: brand });
  y -= 30;
  if (f.note.trim()) {
    para(f.note.trim());
    y -= 8;
  }
  const expires = new Date(date.getTime() + f.expiresDays * 86_400_000);
  const rows: [string, string][] = [
    ["Purchase price", `${usd(f.price)} cash`],
    ["Closing", `In about ${f.closingDays} days, or on a date that suits you`],
    ["Earnest money", `${usd(f.emd)}, held by the title company`],
    ["Inspection period", f.inspectionDays ? `${f.inspectionDays} days` : "None"],
    ["Condition", f.asIs ? "As-is: no repairs or cleaning needed" : "Subject to inspection"],
    ["Closing costs", COSTS[f.closingCosts]],
    ["Agent commissions", "None"],
    ["Offer good until", expires.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
  ];
  page.drawLine({ start: { x: L, y: y + 6 }, end: { x: L + W, y: y + 6 }, thickness: 0.5, color: muted });
  y -= 12;
  for (const [k, v] of rows) {
    text(k, { size: 10, color: muted });
    const lines = wrap(v, reg, 11, W - 160);
    for (const [i, line] of lines.entries()) {
      text(line, { x: L + 160 });
      if (i < lines.length - 1) y -= 14;
    }
    y -= 20;
  }
  if (f.extraTerms.trim()) {
    y -= 4;
    text("Other terms", { size: 10, color: muted });
    y -= 16;
    para(f.extraTerms.trim(), 10, 14);
  }
  y -= 10;
  page.drawLine({ start: { x: L, y: y + 6 }, end: { x: L + W, y: y + 6 }, thickness: 0.5, color: muted });
  y -= 14;
  para("Next step: if this works for you, reply to this message or use the link we sent to say you're ready to proceed. We'll then send a purchase agreement for you to review and sign.", 10, 14);
  y -= 6;
  page.drawText(safe("This letter is a non-binding offer and is not a contract. Only a purchase agreement signed by both parties is binding. You're free to seek independent advice."), { x: L, y: 60, size: 8, font: reg, color: muted, maxWidth: W, lineHeight: 10 });
  return Buffer.from(await doc.save());
}

/** Is this price within the deal's limits? */
export async function offerLimit(opportunityId: string, price: number) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const { calcFor } = await import("./deals");
  const { calc } = await calcFor(opportunityId);
  const approvedUpTo = opp.approvedAt && opp.contractPrice ? opp.contractPrice : null;
  const over = calc ? price > Math.max(calc.maxBuy, approvedUpTo || 0) : false;
  return { maxBuy: calc?.maxBuy ?? null, over, noValuation: !calc };
}

export async function sendOfferLetter(
  ws: string,
  o: { opportunityId: string; fields: LetterFields; actor: string; channels: ("email" | "sms")[]; auto?: boolean; interactionId?: string; authority: string }
) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: o.opportunityId }, include: { property: true } });
  if (!opp.sellerId) throw new Error("This deal has no seller to send the letter to.");
  const seller = await db.contact.findUniqueOrThrow({ where: { id: opp.sellerId } });
  const f = o.fields;
  if (!f.price || f.price < 1000) throw new Error("Enter the offer price.");
  const pdf = await renderOfferPdf(f);
  const token = randomBytes(18).toString("base64url");
  const round = (await db.offer.count({ where: { opportunityId: opp.id, side: "seller" } })) + 1;
  const offer = await db.offer.create({
    data: { opportunityId: opp.id, side: "seller", contactId: seller.id, round, price: f.price, by: "us", authority: o.authority, token, letter: json(f), pdf: new Uint8Array(pdf), expiresAt: new Date(Date.now() + f.expiresDays * 86_400_000), auto: Boolean(o.auto), interactionId: o.interactionId || null, terms: json({ closingDays: f.closingDays, emd: f.emd, inspectionDays: f.inspectionDays, closingCosts: f.closingCosts, asIs: f.asIs }) },
  });
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  const link = base ? `${base}/offer/${token}` : null;
  const comms = await import("./comms");
  const sent: string[] = [];
  const via: string[] = [];
  const first = seller.firstName || fullName(seller) || "there";
  if (o.channels.includes("email")) {
    if (!seller.email) sent.push("email: no address on file");
    else {
      const r = await comms
        .sendEmail(ws, {
          to: seller.email,
          subject: `Our written offer for ${opp.property.address}`,
          text: `Hi ${first},\n\nAs promised, our written cash offer of ${usd(f.price)} for ${opp.property.address} is attached as a PDF.${link ? `\n\nYou can also view it, and tell us you're ready to proceed or ask a question, here:\n${link}` : ""}\n\nThe offer is good for ${f.expiresDays} days. Any questions, just reply to this email${f.fromPhone ? ` or call ${f.fromPhone}` : ""}.\n\n${f.fromName}\n${f.companyName}`,
          contactId: seller.id,
          opportunityId: opp.id,
          attachments: [{ filename: `Offer-${opp.property.address.replace(/\W+/g, "-")}.pdf`, content: pdf }],
        })
        .catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
      sent.push(`email: ${r}`);
      if (!/^Blocked|failed/.test(r)) via.push("email");
    }
  }
  if (o.channels.includes("sms")) {
    if (!link) sent.push("text: set the Public app URL in Settings to text a link");
    else {
      const r = await comms.sendSms(ws, { contactId: seller.id, body: `Hi ${first}, here's our written offer for ${opp.property.address}: ${usd(f.price)} cash. View or download it, and let us know if you're ready to proceed: ${link}`, opportunityId: opp.id }).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
      sent.push(`text: ${r || "sent"}`);
      if (!/^Blocked|^Rescheduled|failed/.test(String(r))) via.push("sms");
    }
  }
  await db.offer.update({ where: { id: offer.id }, data: { sentVia: via, sentAt: via.length ? new Date() : null } });
  if (["NEW", "ELIGIBLE", "OUTREACH", "ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY"].includes(opp.stage)) await db.opportunity.update({ where: { id: opp.id }, data: { stage: "NEGOTIATION" } });
  await audit(ws, o.actor, "offer_letter_sent", { type: "opportunity", id: opp.id }, { after: { price: f.price, via, auto: Boolean(o.auto) }, meta: { offerId: offer.id } });
  return { offerId: offer.id, message: `Offer letter for ${usd(f.price)} ${via.length ? `sent by ${via.join(" and ")}` : "saved (not delivered)"}${sent.length ? ` · ${sent.join(" · ")}` : ""}` };
}

/** After a call where the seller verbally agreed a number: send the letter, or ask first, per the owner's settings. */
export async function letterAfterVerbal(ws: string, opportunityId: string, price: number, interactionId: string) {
  const { getAutonomy } = await import("./controls");
  const mode = (await getAutonomy(ws)).offerLetter;
  if (mode === "off") return "Offer letters after calls are off";
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const recent = await db.offer.findFirst({ where: { opportunityId, side: "seller", token: { not: null }, price, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
  if (recent) return "Letter at this price already sent";
  const lim = await offerLimit(opportunityId, price);
  const { requestApproval } = await import("./deals");
  if (lim.over || lim.noValuation) {
    await requestApproval(ws, opportunityId, "offer_letter", `Seller agreed ${usd(price)} on a call for ${opp.property.address}${lim.maxBuy ? ` (max buy ${usd(lim.maxBuy)})` : " (no valuation yet)"}. Send the written offer?`, "agent:negotiation", { price, interactionId, maxBuy: lim.maxBuy });
    return "Above the limit: sent to Approvals";
  }
  if (mode === "ask" || opp.autopilotOff) {
    await requestApproval(ws, opportunityId, "offer_letter", `Seller agreed ${usd(price)} on a call for ${opp.property.address}. Send the written offer letter?`, "agent:negotiation", { price, interactionId, maxBuy: lim.maxBuy });
    return "Waiting for approval";
  }
  const fields = await letterDefaults(ws, opportunityId, price);
  const r = await sendOfferLetter(ws, { opportunityId, fields, actor: "agent:negotiation", channels: ["email", "sms"], auto: true, interactionId, authority: "rule" });
  await notify(ws, "Offer letter sent", `${opp.property.address}: ${r.message}`, `/deals/${opportunityId}#offers`);
  return r.message;
}

// ---------- seller side (public link) ----------

export async function offerByToken(token: string) {
  return db.offer.findUnique({ where: { token }, include: { opportunity: { include: { property: true } } } });
}

export async function markViewed(token: string) {
  const o = await db.offer.findUnique({ where: { token }, include: { opportunity: { include: { property: true } } } });
  if (!o) return;
  await db.offer.update({ where: { id: o.id }, data: { viewCount: { increment: 1 }, viewedAt: o.viewedAt || new Date() } });
  if (!o.viewedAt) {
    await audit(o.opportunity.workspaceId, "seller", "offer_letter_viewed", { type: "opportunity", id: o.opportunityId }, { meta: { offerId: o.id } });
    await notify(o.opportunity.workspaceId, "Seller opened your offer", `${o.opportunity.property.address}: ${usd(o.price)} offer letter was just opened.`, `/deals/${o.opportunityId}#offers`);
  }
}

/** The seller pressed "Ready to proceed". */
export async function sellerReady(token: string, message?: string) {
  const o = await offerByToken(token);
  if (!o || o.side !== "seller") throw new Error("This offer link isn't valid.");
  if (o.expiresAt && o.expiresAt < new Date()) throw new Error("This offer has expired. Please contact us for an updated offer.");
  if (o.status === "accepted") return "already";
  const ws = o.opportunity.workspaceId;
  await db.offer.update({ where: { id: o.id }, data: { status: "accepted", respondedAt: new Date(), response: message || "Ready to proceed" } });
  await db.offer.updateMany({ where: { opportunityId: o.opportunityId, side: "seller", id: { not: o.id }, status: "proposed" }, data: { status: "withdrawn" } });
  const opp = o.opportunity;
  await db.opportunity.update({ where: { id: opp.id }, data: { contractPrice: o.price, approvedAt: opp.approvedAt || new Date(), sellerLowest: Math.min(opp.sellerLowest || o.price, o.price), stage: "CONTRACT_PREPARATION", exception: null } });
  if (opp.sellerId) await db.interaction.create({ data: { workspaceId: ws, contactId: opp.sellerId, opportunityId: opp.id, channel: "system", direction: "inbound", provider: "offer_link", summary: `Pressed "Ready to proceed" on the ${usd(o.price)} offer letter${message ? `: "${message.slice(0, 300)}"` : ""}`, status: "done", processedAt: new Date() } });
  await audit(ws, "seller", "offer_letter_accepted", { type: "opportunity", id: opp.id }, { after: { price: o.price }, meta: { offerId: o.id, message } });
  await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opp.id });
  // Contract next: automatically when the owner allows it, otherwise a priority task.
  const { getAutonomy } = await import("./controls");
  let sent = false;
  if ((await getAutonomy(ws)).sendSellerContract === "auto") {
    const { defaultTemplate, prepareContract, sendForSignature } = await import("./contracts");
    const t = await defaultTemplate(ws, opp.id, "seller_purchase");
    if (t && !t.body.startsWith("SAMPLE ONLY")) {
      try {
        const k = await prepareContract(ws, { opportunityId: opp.id, templateId: t.id, userId: opp.assigneeId || "system" });
        await sendForSignature(ws, k.id, "system");
        sent = true;
      } catch (e) {
        await notify(ws, "Contract not sent automatically", e instanceof Error ? e.message : String(e), `/deals/${opp.id}?tab=contracts`);
      }
    }
  }
  if (!sent) await createTask(ws, { kind: "review", title: `Seller is ready at ${usd(o.price)}: send the purchase agreement`, entityType: "opportunity", entityId: opp.id, priority: 1, assignee: opp.assigneeId || undefined, dedupeKey: `contract:${opp.id}` });
  await notify(ws, "🎉 Seller is ready to proceed", `${opp.property.address} at ${usd(o.price)}.${sent ? " The purchase agreement was sent for signature." : " Send the purchase agreement."}`, `/deals/${opp.id}?tab=contracts`);
  return sent ? "contract_sent" : "ok";
}

/** The seller asked a question or named their own number. */
export async function sellerCounter(token: string, price: number | null, message: string) {
  const o = await offerByToken(token);
  if (!o || o.side !== "seller") throw new Error("This offer link isn't valid.");
  const ws = o.opportunity.workspaceId;
  const opp = o.opportunity;
  if (price) {
    await db.offer.update({ where: { id: o.id }, data: { status: "countered", respondedAt: new Date(), response: message || null } });
    await db.offer.create({ data: { opportunityId: opp.id, side: "seller", contactId: opp.sellerId, round: o.round + 1, price, by: "them", status: "proposed", response: message || null } });
    if (!opp.sellerLowest || price < opp.sellerLowest) await db.opportunity.update({ where: { id: opp.id }, data: { sellerLowest: price } });
    await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opp.id });
  }
  if (opp.sellerId) await db.interaction.create({ data: { workspaceId: ws, contactId: opp.sellerId, opportunityId: opp.id, channel: "system", direction: "inbound", provider: "offer_link", summary: price ? `Countered at ${usd(price)} on the offer link` : "Asked a question on the offer link", body: message || null, status: "done", processedAt: new Date() } });
  await createTask(ws, { kind: "follow_up", title: price ? `Seller countered at ${usd(price)} (our offer ${usd(o.price)})` : "Seller has a question about the offer", reason: message || undefined, contactId: opp.sellerId || undefined, entityType: "opportunity", entityId: opp.id, priority: 1, assignee: opp.assigneeId || undefined, dedupeKey: `counter:${o.id}` });
  await audit(ws, "seller", price ? "offer_letter_countered" : "offer_letter_question", { type: "opportunity", id: opp.id }, { after: { price }, meta: { offerId: o.id, message } });
  await notify(ws, price ? "Seller countered" : "Seller question", `${opp.property.address}: ${price ? `${usd(price)} (we offered ${usd(o.price)})` : ""}${message ? ` "${message.slice(0, 140)}"` : ""}`, `/deals/${opp.id}#offers`);
}

/** The letter form (and the preview link's query string) → fields. */
export function parseLetter(get: (k: string) => string | null, base: LetterFields): LetterFields {
  const n = (k: string, d: number) => {
    const v = get(k);
    const x = v === null || v === "" ? NaN : Math.round(Number(String(v).replace(/[$,\s]/g, "")));
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  const s = (k: string, d: string) => (get(k) ?? d).toString().slice(0, 2000);
  const cc = get("closingCosts");
  return {
    ...base,
    sellerName: s("sellerName", base.sellerName),
    propertyAddress: s("propertyAddress", base.propertyAddress),
    price: n("price", base.price),
    closingDays: Math.min(365, n("closingDays", base.closingDays)),
    emd: n("emd", base.emd),
    inspectionDays: Math.min(90, n("inspectionDays", base.inspectionDays)),
    closingCosts: cc === "customary" || cc === "split" || cc === "buyer" ? cc : base.closingCosts,
    asIs: get("asIs") === null ? (get("letterForm") ? false : base.asIs) : get("asIs") === "on" || get("asIs") === "1",
    expiresDays: Math.max(1, Math.min(60, n("expiresDays", base.expiresDays))),
    extraTerms: s("extraTerms", base.extraTerms),
    note: s("note", base.note),
    fromPhone: s("fromPhone", base.fromPhone),
  };
}
