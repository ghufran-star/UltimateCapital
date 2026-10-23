import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { audit, json, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { activePack } from "./eligibility";
import { createTask, emit } from "./engine";
import { DEFAULT_TITLE_CHECKLIST } from "./stages";
import { fill, fullName, usd } from "./util";

// Contracts: attorney templates → auto-filled → sent by email & text → signed in the app →
// tamper-evident PDF with an audit certificate (ESIGN / UETA style record).

export const STANDARD_FIELDS = [
  "today",
  "company_name",
  "seller_names",
  "buyer_name",
  "property_address",
  "property_city",
  "property_state",
  "property_zip",
  "property_county",
  "legal_description",
  "parcel_id",
  "purchase_price",
  "earnest_money",
  "option_fee",
  "option_days",
  "closing_date",
  "title_company",
  "assignee_name",
  "assignment_fee",
  "disclosure_text",
];

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export async function contractFields(ws: string, opportunityId: string, kind: string, extra: Record<string, string> = {}) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: { include: { ownerships: { include: { contact: true } } } }, transaction: { include: { titleCompany: true } } } });
  const p = opp.property;
  const pack = await activePack(ws, p.state);
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  const sellers = p.ownerships.map((o) => fullName(o.contact));
  const buyer = opp.transaction?.buyerId ? await db.contact.findUnique({ where: { id: opp.transaction.buyerId } }) : null;
  const price = opp.contractPrice || opp.sellerLowest || 0;
  const closing = new Date(Date.now() + 30 * 864e5);
  return {
    today: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    company_name: company,
    seller_names: sellers.join(" and ") || "",
    buyer_name: kind === "assignment" || kind === "buyer_purchase" ? (buyer ? fullName(buyer) : "") : company,
    property_address: p.address,
    property_city: p.city,
    property_state: p.state,
    property_zip: p.zip,
    property_county: p.county || "",
    legal_description: p.legalDesc || "",
    parcel_id: p.parcel || "",
    purchase_price: usd(price),
    earnest_money: usd(pack?.contracts.typicalEmd || 1000),
    option_fee: usd(100),
    option_days: String(pack?.contracts.optionPeriodDays ?? 10),
    closing_date: closing.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    title_company: opp.transaction?.titleCompany?.name || "",
    assignee_name: buyer ? fullName(buyer) : "",
    assignment_fee: opp.transaction?.assignmentFee ? usd(opp.transaction.assignmentFee) : "",
    disclosure_text: pack?.wholesaling.disclosureText || "",
    ...extra,
  };
}

export async function createContract(
  ws: string,
  o: { opportunityId: string; templateId: string; fields: Record<string, string>; signers: { role: string; name: string; email?: string; phone?: string; order: number }[]; actor: string }
) {
  const t = await db.contractTemplate.findUniqueOrThrow({ where: { id: o.templateId } });
  const body = fill(t.body, o.fields);
  const c = await db.contract.create({
    data: {
      workspaceId: ws,
      opportunityId: o.opportunityId,
      templateId: t.id,
      kind: t.kind,
      fields: json(o.fields),
      body,
      signers: {
        create: o.signers.map((s) => ({ ...s, tokenHash: sha(randomBytes(24).toString("hex")), expiresAt: new Date(Date.now() + 14 * 864e5) })),
      },
    },
  });
  await audit(ws, o.actor, "contract_created", { type: "contract", id: c.id }, { meta: { template: t.name, version: t.version } });
  return c;
}

/** Fills a template from the deal and sets up its signers (sellers on title, or the chosen buyer, then the company). */
export async function prepareContract(ws: string, o: { opportunityId: string; templateId: string; overrides?: Record<string, string>; userId: string }) {
  const opp = await db.opportunity.findFirstOrThrow({ where: { id: o.opportunityId, workspaceId: ws }, include: { property: { include: { ownerships: { include: { contact: true } } } } } });
  const t = await db.contractTemplate.findFirstOrThrow({ where: { id: o.templateId, workspaceId: ws } });
  if (t.kind === "seller_purchase" && !opp.approvedAt) throw new Error("The owner must approve the final offer before a seller contract can go out (Approvals).");
  const fields: Record<string, string> = { ...(await contractFields(ws, o.opportunityId, t.kind)), ...(o.overrides || {}) };
  const signers: { role: string; name: string; email?: string; phone?: string; order: number }[] = [];
  if (t.kind === "seller_purchase" || t.kind === "addendum") {
    const owners = opp.property.ownerships.map((x) => x.contact);
    if (!owners.length) throw new Error("Link the seller to the property first.");
    owners.forEach((x, i) => signers.push({ role: i ? `seller${i + 1}` : "seller", name: `${x.firstName} ${x.lastName}`.trim(), email: x.email || undefined, phone: x.phone || undefined, order: 1 }));
  } else {
    const tx = await db.transaction.findUnique({ where: { opportunityId: o.opportunityId } });
    const b = tx?.buyerId ? await db.contact.findUnique({ where: { id: tx.buyerId } }) : null;
    if (!b) throw new Error("Choose the buyer first (Buyers tab on the deal).");
    signers.push({ role: "buyer", name: `${b.firstName} ${b.lastName}`.trim() || b.company || "Buyer", email: b.email || undefined, phone: b.phone || undefined, order: 1 });
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: o.userId } });
  signers.push({ role: "company", name: u.name, email: u.email, order: 99 });
  const k = await createContract(ws, { opportunityId: o.opportunityId, templateId: t.id, fields, signers, actor: o.userId });
  const closing = fields.closing_date ? new Date(fields.closing_date) : null;
  if (closing && !isNaN(+closing)) await db.contract.update({ where: { id: k.id }, data: { closingAt: closing } });
  return k;
}

/** The best active template for a deal: its state's version first, then the all-states one. */
export async function defaultTemplate(ws: string, opportunityId: string, kind: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const ts = await db.contractTemplate.findMany({ where: { workspaceId: ws, kind, active: true, OR: [{ state: opp.property.state }, { state: null }] }, orderBy: { updatedAt: "desc" } });
  return ts.find((t) => t.state === opp.property.state && (!t.dealType || t.dealType === opp.dealType)) || ts.find((t) => !t.dealType || t.dealType === opp.dealType) || null;
}

/** Sends signing links to the next external signers (company countersigns in the app). */
export async function sendForSignature(ws: string, contractId: string, actor: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { signers: { orderBy: { order: "asc" } } } });
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  if (!base) throw new Error("Set the Public app URL in Settings → Integrations first.");
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  const pending = c.signers.filter((s) => s.role !== "company" && !["signed", "declined"].includes(s.status));
  const nextOrder = Math.min(...pending.map((s) => s.order));
  const comms = await import("./comms");
  const sent: string[] = [];
  for (const s of pending.filter((x) => x.order === nextOrder)) {
    const token = randomBytes(24).toString("base64url");
    await db.contractSigner.update({ where: { id: s.id }, data: { tokenHash: sha(token), status: "sent", expiresAt: new Date(Date.now() + 14 * 864e5) } });
    const link = `${base}/sign/${token}`;
    const msg = `Hi ${s.name.split(" ")[0]}, here is the agreement from ${company} for ${(c.fields as Record<string, string>).property_address || "the property"} to review and sign: ${link}`;
    if (s.email) await comms.sendEmail(ws, { to: s.email, subject: `Please review and sign: ${(c.fields as Record<string, string>).property_address || "agreement"}`, text: `${msg}\n\nThe link is private to you and expires in 14 days. You can review the full document before signing.`, opportunityId: c.opportunityId, skipChecks: true });
    if (s.phone) {
      const contact = await db.contact.findFirst({ where: { workspaceId: ws, phone: s.phone } });
      if (contact && !contact.doNotContact) await comms.sendSms(ws, { contactId: contact.id, body: msg, opportunityId: c.opportunityId, skipChecks: true });
    }
    sent.push(s.name);
  }
  if (sent.length) await db.contract.update({ where: { id: c.id }, data: { status: "sent" } });
  await audit(ws, actor, "contract_sent", { type: "contract", id: c.id }, { meta: { to: sent } });
  return sent.length ? `Sent to ${sent.join(", ")}` : "Nothing to send";
}

export async function signerByToken(token: string) {
  const s = await db.contractSigner.findUnique({ where: { tokenHash: sha(token) }, include: { contract: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s;
}

export async function recordView(signerId: string, ip: string, ua: string) {
  const s = await db.contractSigner.findUniqueOrThrow({ where: { id: signerId }, include: { contract: true } });
  if (!s.viewedAt) {
    await db.contractSigner.update({ where: { id: s.id }, data: { viewedAt: new Date(), status: s.status === "signed" ? s.status : "viewed" } });
    if (s.contract.status === "sent") await db.contract.update({ where: { id: s.contractId }, data: { status: "viewed" } });
  }
  await audit(s.contract.workspaceId, `signer:${s.id}`, "contract_viewed", { type: "contract", id: s.contractId }, { meta: { ip, ua } });
}

export async function sign(signerId: string, o: { signature: string; initials: string; ip: string; ua: string; consent: boolean }) {
  if (!o.consent) throw new Error("Please agree to sign electronically.");
  if (!o.signature) throw new Error("Please add your signature.");
  const s = await db.contractSigner.findUniqueOrThrow({ where: { id: signerId }, include: { contract: true } });
  if (s.status === "signed") return;
  await db.contractSigner.update({
    where: { id: s.id },
    data: { status: "signed", signedAt: new Date(), consentAt: new Date(), signature: o.signature.slice(0, 400_000), initials: o.initials.slice(0, 50), ip: o.ip, userAgent: o.ua.slice(0, 300) },
  });
  const ws = s.contract.workspaceId;
  await audit(ws, `signer:${s.id}`, "contract_signed", { type: "contract", id: s.contractId }, { meta: { name: s.name, role: s.role, ip: o.ip, ua: o.ua } });
  await notify(ws, "Signed", `${s.name} signed ${(s.contract.fields as Record<string, string>).property_address || "the agreement"}`, `/deals/${s.contract.opportunityId}`);
  await afterSignature(ws, s.contractId);
}

/** Company countersignature from inside the app. */
export async function countersign(ws: string, contractId: string, userId: string, signature: string, ip: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { signers: true } });
  const external = c.signers.filter((s) => s.role !== "company");
  if (external.some((s) => s.status !== "signed")) throw new Error("Wait until the other parties have signed.");
  let me = c.signers.find((s) => s.role === "company");
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!me) me = await db.contractSigner.create({ data: { contractId, role: "company", name: u.name, email: u.email, order: 99, tokenHash: sha(randomBytes(24).toString("hex")), expiresAt: new Date(Date.now() + 864e5) } });
  await db.contractSigner.update({ where: { id: me.id }, data: { status: "signed", signedAt: new Date(), consentAt: new Date(), signature, ip, name: u.name } });
  await audit(ws, userId, "contract_countersigned", { type: "contract", id: contractId });
  await afterSignature(ws, contractId);
}

async function afterSignature(ws: string, contractId: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { signers: { orderBy: { order: "asc" } } } });
  const external = c.signers.filter((s) => s.role !== "company");
  const allExternal = external.every((s) => s.status === "signed");
  const companySigned = c.signers.some((s) => s.role === "company" && s.status === "signed");
  if (!allExternal) {
    await db.contract.update({ where: { id: c.id }, data: { status: "partially_signed" } });
    await sendForSignature(ws, c.id, "system"); // next signer in order
    return;
  }
  if (!companySigned) {
    await db.contract.update({ where: { id: c.id }, data: { status: "partially_signed" } });
    await createTask(ws, { kind: "review", title: "Countersign the agreement", entityType: "opportunity", entityId: c.opportunityId, priority: 1, dedupeKey: `countersign:${c.id}` });
    await notify(ws, "Ready to countersign", `All parties signed. Countersign to make it effective.`, `/deals/${c.opportunityId}`);
    return;
  }
  const pdf = await buildPdf(ws, c.id);
  const effective = new Date();
  const fields = c.fields as Record<string, string>;
  const optionDays = Number(fields.option_days || 0);
  const pack = await activePack(ws, fields.property_state);
  const emdDays = pack?.contracts.emdDueDays ?? 3;
  await db.contract.update({
    where: { id: c.id },
    data: {
      status: "effective",
      effectiveAt: effective,
      finalPdf: pdf,
      finalHash: sha(pdf),
      optionEndsAt: optionDays ? new Date(+effective + optionDays * 864e5) : null,
      emdDueAt: new Date(+effective + emdDays * 864e5),
      closingAt: Date.parse(fields.closing_date) ? new Date(fields.closing_date) : null,
    },
  });
  await audit(ws, "system", "contract_effective", { type: "contract", id: c.id }, { meta: { hash: sha(pdf) } });
  await sendSignedCopies(ws, c.id, pdf).catch((e) => console.error("[contracts] signed copies", e));
  await emit(ws, "contract.effective", { type: "contract", id: c.id });
}

/** Every signer gets the fully signed PDF (with its certificate) by email as soon as it is effective. */
async function sendSignedCopies(ws: string, contractId: string, pdf: Uint8Array) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { signers: true } });
  const f = c.fields as Record<string, string>;
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  if (!(await setting(ws, "RESEND_API_KEY"))) return;
  const { sendEmail } = await import("./comms");
  const filename = `${c.kind}-${String(f.property_address || c.id).replace(/\W+/g, "-")}-signed.pdf`;
  const sent: string[] = [];
  for (const s of c.signers) {
    if (!s.email) continue;
    await sendEmail(ws, {
      to: s.email,
      subject: `Signed copy: ${f.property_address || "your agreement"}`,
      text: `Hi ${s.name.split(" ")[0]},\n\nAll parties have signed. Attached is your copy of the agreement for ${f.property_address || "the property"}, with its certificate of completion.\n\n${company}`,
      opportunityId: c.opportunityId,
      attachments: [{ filename, content: Buffer.from(pdf) }],
      skipChecks: true,
    });
    sent.push(s.name);
  }
  await audit(ws, "system", "signed_copies_sent", { type: "contract", id: contractId }, { meta: { to: sent } });
}

function ascii(s: string) {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/✓/g, "v")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export async function buildPdf(ws: string, contractId: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { signers: { orderBy: { order: "asc" } } } });
  const events = await db.auditEvent.findMany({ where: { workspaceId: ws, entityType: "contract", entityId: c.id }, orderBy: { createdAt: "asc" } });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 56;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const write = (t: string, size = 10.5, f = font) => {
    for (const line of wrap(ascii(t), f, size, W - 2 * M)) {
      if (y < M + 20) newPage();
      page.drawText(line, { x: M, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= size * 1.45;
    }
  };
  const sigImage = async (s: (typeof c.signers)[number], h = 36) => {
    if (s.signature?.startsWith("data:image/png;base64,")) {
      const img = await doc.embedPng(Buffer.from(s.signature.split(",")[1], "base64"));
      const scale = h / img.height;
      if (y < M + h + 10) newPage();
      page.drawImage(img, { x: M, y: y - h, width: img.width * scale, height: h });
      y -= h + 6;
    } else if (s.signature) write(`/s/ ${s.signature.replace(/^typed:/, "")}`, 14, bold);
  };
  // Body, with signature markers replaced by the actual signatures.
  const parts = c.body.split(/(\[\[(?:sign|initial):[a-z0-9_]+\]\])/g);
  for (const part of parts) {
    const m = /\[\[(sign|initial):([a-z0-9_]+)\]\]/.exec(part);
    if (!m) {
      write(part);
      continue;
    }
    const s = c.signers.find((x) => x.role === m[2]);
    if (!s) continue;
    if (m[1] === "initial") write(`Initials: ${s.initials || ""}`, 10.5, bold);
    else {
      await sigImage(s);
      write(`${s.name} · signed ${s.signedAt?.toISOString() || ""}`, 8.5);
    }
  }
  // Company signature if the template didn't place it.
  const companySigner = c.signers.find((s) => s.role === "company");
  if (companySigner && !c.body.includes("[[sign:company]]")) {
    y -= 10;
    write("Accepted by the company:", 10.5, bold);
    await sigImage(companySigner);
    write(`${companySigner.name} · signed ${companySigner.signedAt?.toISOString() || ""}`, 8.5);
  }
  // Audit certificate.
  newPage();
  write("Certificate of completion", 16, bold);
  y -= 6;
  write(`Document ID: ${c.id}`);
  write(`Content hash (SHA-256 of signed text): ${sha(c.body)}`);
  write(`Template: ${c.templateId || "custom"} · kind: ${c.kind}`);
  y -= 6;
  write("Signers", 12, bold);
  for (const s of c.signers) {
    write(`${s.name} (${s.role})${s.email ? ` <${s.email}>` : ""}${s.phone ? ` ${s.phone}` : ""}`, 10.5, bold);
    write(`Viewed: ${s.viewedAt?.toISOString() || "-"} · Consented to e-sign: ${s.consentAt?.toISOString() || "-"} · Signed: ${s.signedAt?.toISOString() || "-"}`);
    write(`IP: ${s.ip || "-"} · Device: ${s.userAgent || "-"}`);
    y -= 4;
  }
  write("Event history", 12, bold);
  for (const e of events) write(`${e.createdAt.toISOString()} · ${e.action} · ${e.actor}`, 9);
  write(
    "Each signer agreed to use electronic records and signatures before signing, in line with the US ESIGN Act and the Uniform Electronic Transactions Act. This certificate is part of the document.",
    8.5
  );
  return Buffer.from(await doc.save());
}

/** Contract became effective: start closing, deadlines, and (for seller contracts) full disposition. */
export async function onContractEffective(ws: string, contractId: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: c.opportunityId } });
  if (c.kind === "seller_purchase") {
    await db.opportunity.update({ where: { id: opp.id }, data: { stage: "DISPOSITION", exception: null } });
    const alias = `deal-${opp.id.slice(-8)}`;
    await db.transaction.upsert({
      where: { opportunityId: opp.id },
      create: { workspaceId: ws, opportunityId: opp.id, stage: "CONTRACT_EFFECTIVE", inboxAlias: alias, checklist: json(DEFAULT_TITLE_CHECKLIST.map((x) => ({ ...x, done: false }))), closingAt: c.closingAt, emdAmount: Number(((c.fields as Record<string, string>).earnest_money || "").replace(/\D/g, "")) || null },
      update: { stage: "CONTRACT_EFFECTIVE", closingAt: c.closingAt },
    });
    if (c.emdDueAt) {
      await createTask(ws, { kind: "contract_deadline", title: "Earnest money due", entityType: "contract", entityId: c.id, dueAt: new Date(+c.emdDueAt - 864e5), priority: 1, payload: { which: "emd" }, dedupeKey: `deadline:${c.id}:emd` });
      const pay = await db.payment.findFirst({ where: { workspaceId: ws, opportunityId: opp.id, kind: "emd", status: { in: ["due", "awaiting_approval", "approved"] } } });
      if (!pay) await db.payment.create({ data: { workspaceId: ws, opportunityId: opp.id, kind: "emd", direction: "out", amount: Number(((c.fields as Record<string, string>).earnest_money || "").replace(/\D/g, "")) || 1000, dueAt: c.emdDueAt, status: "due", payee: (c.fields as Record<string, string>).title_company || "Title company" } });
    }
    if (c.optionEndsAt) await createTask(ws, { kind: "contract_deadline", title: "Option period ends: decide to proceed or terminate", entityType: "contract", entityId: c.id, dueAt: new Date(+c.optionEndsAt - 2 * 864e5), priority: 1, payload: { which: "option" }, dedupeKey: `deadline:${c.id}:option` });
    if (c.closingAt) await createTask(ws, { kind: "contract_deadline", title: "Closing date approaching", entityType: "contract", entityId: c.id, dueAt: new Date(+c.closingAt - 5 * 864e5), payload: { which: "closing" }, dedupeKey: `deadline:${c.id}:closing` });
    const { getAutonomy } = await import("./controls");
    if ((await getAutonomy(ws)).fullMarketing === "auto") await createTask(ws, { kind: "demand_campaign", title: "Market the deal to matching buyers (with disclosure)", entityType: "opportunity", entityId: opp.id, payload: { mode: "full" }, priority: 1, dedupeKey: `demand:${opp.id}:full` });
    else await (await import("./deals")).requestApproval(ws, opp.id, "full_marketing", `Under contract: market ${(c.fields as Record<string, string>).property_address || "the deal"} to buyers?`, "system", { mode: "full" });
    await createTask(ws, { kind: "review", title: "Open title: send the contract package to the title company", entityType: "opportunity", entityId: opp.id, priority: 1, dedupeKey: `opentitle:${opp.id}` });
  } else if (c.kind === "assignment" || c.kind === "buyer_purchase") {
    const tx = await db.transaction.findUnique({ where: { opportunityId: opp.id } });
    await db.opportunity.update({ where: { id: opp.id }, data: { stage: "CLOSING" } });
    if (tx) await db.transaction.update({ where: { id: tx.id }, data: { stage: "BUYER_AGREEMENT" } });
    if (tx?.buyerId) await db.buyerInterest.updateMany({ where: { opportunityId: opp.id, contactId: tx.buyerId }, data: { stage: "AGREEMENT_EXECUTED" } });
  }
  await notify(ws, "Contract effective", `${(c.fields as Record<string, string>).property_address || "Agreement"} is now effective.`, `/deals/${opp.id}`);
  return "Contract effective";
}

export async function deadlineReminder(ws: string, contractId: string, which: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  if (["expired", "terminated"].includes(c.status)) return "Contract no longer active";
  const label = which === "emd" ? `Earnest money due ${c.emdDueAt?.toDateString()}` : which === "option" ? `Option period ends ${c.optionEndsAt?.toDateString()}` : `Closing ${c.closingAt?.toDateString()}`;
  await notify(ws, "Deadline", `${(c.fields as Record<string, string>).property_address}: ${label}`, `/deals/${c.opportunityId}`);
  return label;
}

export async function terminateContract(ws: string, contractId: string, actor: string, reason: string) {
  const c = await db.contract.update({ where: { id: contractId }, data: { status: "terminated" } });
  await db.opportunity.update({ where: { id: c.opportunityId }, data: { exception: "CONTRACT_FAILED" } });
  await audit(ws, actor, "contract_terminated", { type: "contract", id: contractId }, { meta: { reason } });
  await emit(ws, "contract.ended", { type: "opportunity", id: c.opportunityId });
}
