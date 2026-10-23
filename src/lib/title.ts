import { audit, json, notify } from "./audit";
import { claudeJson, type Doc } from "./claude";
import { setting } from "./config";
import { db } from "./db";
import { createTask, emit } from "./engine";
import { CLOSING_STAGES, DEFAULT_TITLE_CHECKLIST } from "./stages";
import { fullName, usd } from "./util";

// Title & closing: package to title, per-deal inbox, checklist tracking, settlement checks,
// payments with approval and wire safeguards, and reconciliation when the fee arrives.

type Item = { key: string; label: string; done: boolean; doneAt?: string; dueAt?: string; note?: string };

export async function dealInboxAddress(ws: string, alias: string) {
  const domain = await setting(ws, "INBOUND_EMAIL_DOMAIN");
  return domain ? `${alias}@${domain}` : null;
}

export async function ensureTransaction(ws: string, opportunityId: string) {
  return db.transaction.upsert({
    where: { opportunityId },
    create: { workspaceId: ws, opportunityId, inboxAlias: `deal-${opportunityId.slice(-8)}`, checklist: json(DEFAULT_TITLE_CHECKLIST.map((x) => ({ ...x, done: false }))) },
    update: {},
  });
}

export async function setChecklist(ws: string, txId: string, key: string, done: boolean, actor: string, note?: string) {
  const tx = await db.transaction.findUniqueOrThrow({ where: { id: txId } });
  const items = (tx.checklist as unknown as Item[]).map((i) => (i.key === key ? { ...i, done, doneAt: done ? new Date().toISOString() : undefined, note: note ?? i.note } : i));
  // Stage follows the checklist.
  const isDone = (k: string) => items.find((i) => i.key === k)?.done;
  let stage = tx.stage;
  if (isDone("title_opened")) stage = "TITLE_OPENED";
  if (isDone("commitment")) stage = "DUE_DILIGENCE";
  if (isDone("buyer_assignment")) stage = "BUYER_AGREEMENT";
  if (isDone("curative") && isDone("buyer_funds")) stage = "CONDITIONS_SATISFIED";
  if (isDone("closing_scheduled")) stage = "CLOSING_SCHEDULED";
  if (isDone("funded")) stage = "CLOSED";
  if (isDone("paid")) stage = "RECONCILED";
  if (CLOSING_STAGES.indexOf(stage as (typeof CLOSING_STAGES)[number]) < CLOSING_STAGES.indexOf(tx.stage as (typeof CLOSING_STAGES)[number])) stage = tx.stage;
  await db.transaction.update({ where: { id: txId }, data: { checklist: json(items), stage } });
  await audit(ws, actor, "title_checklist", { type: "transaction", id: txId }, { after: { key, done, stage } });
  if (stage === "CLOSED") await db.opportunity.update({ where: { id: tx.opportunityId }, data: { stage: "CLOSED" } });
}

export async function openTitle(ws: string, opportunityId: string, titleCompanyId: string, actor: string) {
  const tx = await ensureTransaction(ws, opportunityId);
  const tc = await db.titleCompany.findUniqueOrThrow({ where: { id: titleCompanyId } });
  await db.transaction.update({ where: { id: tx.id }, data: { titleCompanyId } });
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true, contracts: { where: { status: "effective" } } } });
  const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  const inbox = await dealInboxAddress(ws, tx.inboxAlias);
  if (!tc.email) throw new Error("Add the title company's email first.");
  const attachments = opp.contracts.filter((c) => c.finalPdf).map((c) => ({ filename: `${c.kind}-${opp.property.address.replace(/\W+/g, "-")}.pdf`, content: Buffer.from(c.finalPdf!) }));
  const text = [
    `Hello ${tc.name},`,
    ``,
    `Please open title for the following transaction:`,
    `Property: ${opp.property.address}, ${opp.property.city}, ${opp.property.state} ${opp.property.zip}${opp.property.parcel ? ` (parcel ${opp.property.parcel})` : ""}`,
    `Seller: ${seller ? fullName(seller) : ""}${seller?.phone ? ` · ${seller.phone}` : ""}${seller?.email ? ` · ${seller.email}` : ""}`,
    `Buyer: ${company} and/or assigns`,
    `Purchase price: ${usd(opp.contractPrice)}`,
    tx.emdAmount ? `Earnest money: ${usd(tx.emdAmount)}` : "",
    tx.closingAt ? `Closing date: ${tx.closingAt.toDateString()}` : "",
    ``,
    `The executed contract is attached. Please send the file number, earnest money instructions and the title commitment.`,
    inbox ? `Please reply to ${inbox} so everything stays with this file.` : "",
    ``,
    `Thank you,`,
    company,
  ].filter((x) => x !== "").join("\n");
  const { sendEmail } = await import("./comms");
  await sendEmail(ws, { to: tc.email, subject: `Open title: ${opp.property.address}`, text, opportunityId, replyTo: inbox || undefined, attachments, skipChecks: true });
  await setChecklist(ws, tx.id, "package_sent", true, actor);
  await db.task.updateMany({ where: { workspaceId: ws, dedupeKey: `opentitle:${opportunityId}`, status: "open" }, data: { status: "done", result: "Package sent" } });
  await createTask(ws, { kind: "chase_title", title: "Chase title for file number and commitment", entityType: "transaction", entityId: tx.id, dueAt: new Date(Date.now() + 2 * 864e5), dedupeKey: `chase:${tx.id}` });
  return "Package sent to title";
}

export async function chaseTitle(ws: string, txId: string) {
  const tx = await db.transaction.findUniqueOrThrow({ where: { id: txId }, include: { titleCompany: true, opportunity: { include: { property: true } } } });
  if (["CLOSED", "RECONCILED"].includes(tx.stage)) return "Closed";
  const open = (tx.checklist as unknown as Item[]).filter((i) => !i.done && !["paid", "funded", "signed"].includes(i.key)).slice(0, 4);
  if (!open.length || !tx.titleCompany?.email) return "Nothing to chase";
  const inbox = await dealInboxAddress(ws, tx.inboxAlias);
  const { sendEmail } = await import("./comms");
  await sendEmail(ws, {
    to: tx.titleCompany.email,
    subject: `Update request: ${tx.opportunity.property.address}`,
    text: `Hello,\n\nCould you send an update on ${tx.opportunity.property.address}? We're waiting on:\n${open.map((i) => `- ${i.label}`).join("\n")}\n\nThank you.`,
    replyTo: inbox || undefined,
    opportunityId: tx.opportunityId,
    skipChecks: true,
  });
  await createTask(ws, { kind: "chase_title", title: "Chase title again", entityType: "transaction", entityId: tx.id, dueAt: new Date(Date.now() + 3 * 864e5), dedupeKey: `chase:${tx.id}` });
  return `Chased: ${open.map((i) => i.label).join(", ")}`;
}

/** Inbound email webhook: deal inbox (title) or a contact's reply. */
export type Attachment = { filename: string; mime: string; data: Buffer };
const READABLE = (a: Attachment) => a.mime === "application/pdf" || /^image\/(png|jpe?g|gif|webp)$/.test(a.mime);

export async function ingestEmail(ws: string, m: { from: string; to: string; subject: string; text: string; attachments?: Attachment[] }) {
  const alias = /(deal-[a-z0-9]{8})@/i.exec(m.to)?.[1]?.toLowerCase();
  if (alias) {
    const tx = await db.transaction.findUnique({ where: { inboxAlias: alias }, include: { opportunity: { include: { property: true } } } });
    if (!tx || tx.workspaceId !== ws) return "Unknown deal inbox";
    const atts = (m.attachments || []).filter((a) => a.data.length && a.data.length <= 15 * 1024 * 1024);
    await db.interaction.create({ data: { workspaceId: ws, opportunityId: tx.opportunityId, channel: "email", direction: "inbound", provider: "email", fromAddr: m.from, toAddr: m.to, subject: m.subject, body: `${m.text}${atts.length ? `\n\n[Attachments: ${atts.map((a) => a.filename).join(", ")}]` : ""}`, processedAt: new Date() } });
    const { saveFile } = await import("./files");
    for (const a of atts) await saveFile(ws, { entityType: "opportunity", entityId: tx.opportunityId, kind: /settle|closing.?disclosure|hud|alta/i.test(a.filename) ? "settlement" : "title", name: a.filename, mime: a.mime, data: a.data, uploadedBy: "agent:transaction", note: `From ${m.from}: ${m.subject}` });
    // Claude reads the attachments themselves (commitments, settlement statements, wire letters), not just the email body.
    let budget = 20 * 1024 * 1024;
    const docs = atts.filter(READABLE).filter((a) => (budget -= a.data.length) >= 0).slice(0, 5).map((a) => ({ mime: a.mime, data: a.data.toString("base64"), name: a.filename }));
    const items = tx.checklist as unknown as Item[];
    const out = await claudeJson<{ summary: string; completed: string[]; needsFromUs: string[]; settlementStatement: boolean; wireInstructions: boolean; closingDate: string }>(ws, {
      kind: docs.length ? "analysis" : "fast",
      documents: docs,
      prompt: `An email from the title company about ${tx.opportunity.property.address}${docs.length ? ` with ${docs.length} attached document(s) (read them)` : ""}.\nChecklist keys: ${items.map((i) => `${i.key} (${i.label})${i.done ? " [done]" : ""}`).join("; ")}\n\nFrom: ${m.from}\nSubject: ${m.subject}\n"""\n${m.text.slice(0, 15000)}\n"""\nReturn which checklist keys this email shows as completed, anything they need from us, whether it contains a settlement statement or wire instructions, and a closing date (ISO) if given.`,
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          completed: { type: "array", items: { type: "string" } },
          needsFromUs: { type: "array", items: { type: "string" } },
          settlementStatement: { type: "boolean" },
          wireInstructions: { type: "boolean" },
          closingDate: { type: "string" },
        },
        required: ["summary", "completed", "needsFromUs", "settlementStatement", "wireInstructions", "closingDate"],
      },
    });
    for (const k of out.completed) if (items.some((i) => i.key === k)) await setChecklist(ws, tx.id, k, true, "agent:transaction");
    if (out.closingDate && Date.parse(out.closingDate)) await db.transaction.update({ where: { id: tx.id }, data: { closingAt: new Date(out.closingDate) } });
    for (const need of out.needsFromUs) await createTask(ws, { kind: "follow_up", title: `Title needs: ${need}`.slice(0, 200), entityType: "opportunity", entityId: tx.opportunityId, priority: 1, dedupeKey: `titleneed:${tx.id}:${need.slice(0, 30)}` });
    if (out.settlementStatement) await checkSettlement(ws, tx.id, m.text, docs);
    if (out.wireInstructions) {
      await notify(ws, "⚠️ Wire instructions received", `For ${tx.opportunity.property.address}. Verify by PHONE with the title company on a number you already know before sending any money.`, `/deals/${tx.opportunityId}`);
    }
    await notify(ws, `Title update: ${tx.opportunity.property.address}`, out.summary, `/deals/${tx.opportunityId}`);
    return out.summary;
  }
  const email = (/<([^>]+)>/.exec(m.from)?.[1] || m.from).trim().toLowerCase();
  const contact = await db.contact.findFirst({ where: { workspaceId: ws, email } });
  if (!contact) return "No matching contact";
  const it = await db.interaction.create({ data: { workspaceId: ws, contactId: contact.id, channel: "email", direction: "inbound", provider: "email", fromAddr: m.from, toAddr: m.to, subject: m.subject, body: m.text } });
  await emit(ws, "interaction.created", { type: "interaction", id: it.id });
  return "Logged";
}

/** Reads a settlement statement and flags anything that doesn't match the deal. */
export async function checkSettlement(ws: string, txId: string, text: string, documents: Doc[] = []) {
  const tx = await db.transaction.findUniqueOrThrow({ where: { id: txId }, include: { opportunity: { include: { property: true } } } });
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  const buyer = tx.buyerId ? await db.contact.findUnique({ where: { id: tx.buyerId } }) : null;
  const seller = tx.opportunity.sellerId ? await db.contact.findUnique({ where: { id: tx.opportunity.sellerId } }) : null;
  const out = await claudeJson<{ purchasePrice: number; assignmentFee: number; ourNetProceeds: number; issues: string[]; ok: boolean }>(ws, {
    prompt: `Check this settlement statement for a wholesale deal.
Expected: property ${tx.opportunity.property.address}; seller ${seller ? fullName(seller) : "?"}; our company ${company}; end buyer ${buyer ? fullName(buyer) : "?"}; contract price ${usd(tx.opportunity.contractPrice)}; our assignment fee ${usd(tx.assignmentFee)}; earnest money ${usd(tx.emdAmount)}.
Flag: wrong names or address, wrong price, missing or wrong assignment fee, our earnest money not credited, unexpected charges to us, math errors.
${documents.length ? "The statement is attached; the text below may be just the covering email." : ""}
"""
${text.slice(0, 20000)}
"""`,
    documents,
    schema: {
      type: "object",
      properties: { purchasePrice: { type: "number" }, assignmentFee: { type: "number" }, ourNetProceeds: { type: "number" }, issues: { type: "array", items: { type: "string" } }, ok: { type: "boolean" } },
      required: ["purchasePrice", "assignmentFee", "ourNetProceeds", "issues", "ok"],
    },
  });
  await db.transaction.update({ where: { id: txId }, data: { settlement: json({ ...out, checkedAt: new Date().toISOString() }) } });
  if (out.ok) await setChecklist(ws, txId, "settlement_draft", true, "agent:transaction", "Checked: no issues");
  await notify(ws, out.ok ? "Settlement statement checked ✓" : "⚠️ Settlement statement issues", out.ok ? `Net to us ${usd(out.ourNetProceeds)}.` : out.issues.join("; "), `/deals/${tx.opportunityId}`);
  return out;
}

/** Bank statement CSV (date, description, amount): matches incoming fees to deals. */
export async function reconcileBankCsv(ws: string, csv: string, actor: string) {
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.split(",").map((x) => x.replace(/^"|"$/g, "").trim()))
    .filter((r) => r.length >= 2);
  const expected = await db.payment.findMany({ where: { workspaceId: ws, direction: "in", status: { in: ["due", "approved"] } } });
  const matched: string[] = [];
  for (const r of rows) {
    const amount = Math.round(Number(r[r.length - 1].replace(/[$,]/g, "")));
    if (!amount || amount <= 0) continue;
    const p = expected.find((e) => Math.abs(e.amount - amount) <= 1 && !matched.includes(e.id));
    if (!p) continue;
    matched.push(p.id);
    await db.payment.update({ where: { id: p.id }, data: { status: "received", reference: r.slice(0, -1).join(" ").slice(0, 200) } });
    if (p.opportunityId) {
      const tx = await db.transaction.findUnique({ where: { opportunityId: p.opportunityId } });
      if (tx) {
        await db.transaction.update({ where: { id: tx.id }, data: { paidAt: new Date(), netProceeds: amount } });
        await setChecklist(ws, tx.id, "paid", true, actor, "Matched in bank statement");
        if (tx.buyerId) await db.contact.update({ where: { id: tx.buyerId }, data: { dealsClosed: { increment: 1 }, reliability: { increment: 5 } } });
      }
      await db.opportunity.update({ where: { id: p.opportunityId }, data: { stage: "CLOSED" } });
      await db.buyerInterest.updateMany({ where: { opportunityId: p.opportunityId, stage: { in: ["AGREEMENT_EXECUTED", "CLOSING"] } }, data: { stage: "COMPLETED" } });
    }
    await notify(ws, "💰 Paid", `${usd(amount)} received and matched.`, p.opportunityId ? `/deals/${p.opportunityId}` : "/closing");
  }
  await audit(ws, actor, "bank_reconcile", undefined, { meta: { rows: rows.length, matched: matched.length } });
  return { rows: rows.length, matched: matched.length };
}
