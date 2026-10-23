import { audit, notify } from "./audit";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { activePack } from "./eligibility";
import { investorView, type Calculation } from "./rules";
import { fullName, usd } from "./util";
import { dealParams, latestValuation } from "./valuation";

// The private deal page each investor gets (link in every deal text/email): numbers, photos once under
// contract, and one-tap answers that flow straight into the deal.

export async function portalByToken(token: string) {
  if (!token || token.length < 16) return null;
  const it = await db.buyerInterest.findUnique({ where: { portalToken: token }, include: { contact: true, opportunity: { include: { property: true, workspace: true } } } });
  if (!it || it.contact.doNotContact) return null;
  return it;
}

export async function portalView(token: string) {
  const it = await portalByToken(token);
  if (!it) return null;
  const opp = it.opportunity;
  const ws = opp.workspaceId;
  const anonymous = !["UNDER_CONTRACT", "DISPOSITION", "CLOSING"].includes(opp.stage);
  const closed = ["CLOSED"].includes(opp.stage) || !!opp.exception?.match(/WITHDRAWN|CONTRACT_FAILED|DECLINED/);
  const v = await latestValuation(opp.id);
  const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
  const ours = await db.offer.findFirst({ where: { opportunityId: opp.id, side: "buyer", contactId: it.contactId, by: "us" }, orderBy: { createdAt: "desc" } });
  const price = ours?.price ?? null;
  const params = calc ? await dealParams(ws, opp.id) : null;
  const iv = calc && price && params ? investorView(price, calc.arv, calc.repairs, params, v?.rent) : null;
  const photos = anonymous ? [] : await db.fileObject.findMany({ where: { workspaceId: ws, entityType: "opportunity", entityId: opp.id, shared: true, mime: { startsWith: "image/" } }, select: { id: true, name: true } });
  const pack = await activePack(ws, opp.property.state);
  const company = (await (await import("./config")).setting(ws, "COMPANY_NAME")) || "";
  return { it, opp, anonymous, closed, v, calc, price, iv, photos, disclosure: anonymous ? null : pack?.wholesaling.disclosureText || null, company };
}

export async function portalRespond(token: string, o: { kind: "offer" | "walkthrough" | "pass"; price?: number | null; closeDays?: number | null; when?: string | null; note?: string | null }) {
  const it = await portalByToken(token);
  if (!it) throw new Error("This link is no longer active.");
  if (it.opportunity.workspace.isDemo) throw new Error("This is a demo deal page: replies aren't saved.");
  const opp = it.opportunity;
  const ws = opp.workspaceId;
  const who = fullName(it.contact);
  let body = "";
  if (o.kind === "offer") {
    if (!o.price || o.price < 1000) throw new Error("Enter your price.");
    await db.offer.create({ data: { opportunityId: opp.id, side: "buyer", contactId: it.contactId, round: 1, price: Math.round(o.price), by: "them", terms: o.closeDays || o.note ? { text: `${o.closeDays ? `Close in ${o.closeDays} days. ` : ""}${o.note || ""}` } : undefined, response: "via deal page" } });
    await db.buyerInterest.update({ where: { id: it.id }, data: { stage: "OFFER_SUBMITTED", serious: true, priceMentioned: Math.round(o.price), respondedAt: new Date(), notes: o.note || it.notes } });
    body = `Offer ${usd(o.price)}${o.closeDays ? `, close in ${o.closeDays} days` : ""}${o.note ? `. ${o.note}` : ""}`;
  } else if (o.kind === "walkthrough") {
    await db.buyerInterest.update({ where: { id: it.id }, data: { stage: ["MATCHED", "CONTACT_ELIGIBLE", "PRESENTED"].includes(it.stage) ? "INTERESTED" : it.stage, serious: true, respondedAt: new Date() } });
    body = `Asked for a walkthrough${o.when ? ` (${o.when})` : ""}${o.note ? `. ${o.note}` : ""}`;
  } else {
    await db.buyerInterest.update({ where: { id: it.id }, data: { stage: "REJECTED", respondedAt: new Date(), notes: o.note || it.notes } });
    body = `Passed${o.note ? `: ${o.note}` : ""}`;
  }
  await db.contact.update({ where: { id: it.contactId }, data: { ignoredInRow: 0, lastContactAt: new Date() } });
  await db.interaction.create({ data: { workspaceId: ws, contactId: it.contactId, opportunityId: opp.id, channel: "web", direction: "inbound", provider: "portal", body, summary: body, outcome: o.kind === "pass" ? "not_interested" : "interested", processedAt: new Date() } });
  if (o.kind !== "pass") {
    await createTask(ws, { kind: "follow_up", title: o.kind === "offer" ? `${who} offered ${usd(o.price)} on ${opp.property.address}` : `Book a walkthrough for ${who}: ${opp.property.address}`, contactId: it.contactId, entityType: "opportunity", entityId: opp.id, priority: 1, assignee: opp.assigneeId || undefined, dedupeKey: `portal:${it.id}:${o.kind}` });
    await notify(ws, o.kind === "offer" ? "💰 Buyer offer" : "Walkthrough request", `${who} · ${opp.property.address}: ${body}`, `/deals/${opp.id}?tab=buyers`);
  }
  await audit(ws, `buyer:${it.contactId}`, `portal_${o.kind}`, { type: "opportunity", id: opp.id }, { meta: { price: o.price ?? null } });
  await emit(ws, "interest.updated", { type: "opportunity", id: opp.id });
}

export async function portalUploadPof(token: string, file: { name: string; mime: string; data: Buffer }) {
  const it = await portalByToken(token);
  if (!it) throw new Error("This link is no longer active.");
  if (it.opportunity.workspace.isDemo) throw new Error("This is a demo deal page: uploads aren't saved.");
  const { saveFile } = await import("./files");
  await saveFile(it.opportunity.workspaceId, { entityType: "contact", entityId: it.contactId, kind: "pof", name: file.name, mime: file.mime, data: file.data, uploadedBy: `buyer:${it.contactId}` });
  await createTask(it.opportunity.workspaceId, { kind: "review", title: `Check proof of funds from ${fullName(it.contact)}`, contactId: it.contactId, entityType: "contact", entityId: it.contactId, priority: 1, dedupeKey: `pof:${it.contactId}` });
}
