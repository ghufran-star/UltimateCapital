"use server";

import type { ActionState } from "@/components/client";
import { audit, json } from "@/lib/audit";
import { createContract, sendForSignature } from "@/lib/contracts";
import { db } from "@/lib/db";
import { assertDeal, requireCtx } from "@/lib/session";
import { e164, str } from "@/lib/util";
import { act } from "./util";

// Any PDF sent for signature by hand: upload, place boxes, type the signers, send.


/** Step 1: upload the PDF. It's kept as a private one-off template that only this document uses. */
export async function createDocumentDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const ws = c.workspace.id;
    const title = str(fd.get("title"));
    if (!title) throw new Error("Give the document a name, e.g. \"Addendum: closing date extension\".");
    const f = fd.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f) || !f.size) throw new Error("Choose the PDF to send.");
    if (f.type !== "application/pdf") throw new Error("Upload a PDF (save Word documents as PDF first).");
    if (f.size > 15 * 1024 * 1024) throw new Error("PDFs can be up to 15 MB.");
    const deal = str(fd.get("opportunityId"));
    if (deal) await assertDeal(c, deal);
    const buf = new Uint8Array(await f.arrayBuffer());
    const { pageCount } = await import("@/lib/pdfdoc");
    const pages = await pageCount(buf);
    const t = await db.contractTemplate.create({ data: { workspaceId: ws, name: title, kind: "document", body: "", pdf: buf, placements: json([]), active: false, dealType: deal ? `deal:${deal}` : null } });
    await audit(ws, c.user.id, "document_uploaded", { type: "template", id: t.id }, { meta: { title, pages, deal } });
    return { ok: true, redirect: `/closing/documents/new?t=${t.id}` };
  });
}

/** Step 2 saves the boxes (done by the placement editor). */
export async function documentPlacementsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const id = String(fd.get("templateId"));
    await db.contractTemplate.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id, kind: "document" } });
    const items = JSON.parse(String(fd.get("placements") || "[]")) as { kind: string; role?: string }[];
    if (!items.some((p) => p.kind === "sign")) throw new Error("Place at least one signature box.");
    await db.contractTemplate.update({ where: { id }, data: { placements: json(items) } });
    return { ok: true, message: `Saved ${items.length} boxes` };
  });
}

/** Step 3: the signers (typed in by hand) and send. */
export async function sendDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const ws = c.workspace.id;
    const t = await db.contractTemplate.findFirstOrThrow({ where: { id: String(fd.get("templateId")), workspaceId: ws, kind: "document" } });
    const placements = (t.placements || []) as { kind: string; role?: string }[];
    const names = fd.getAll("name").map(String);
    const emails = fd.getAll("email").map(String);
    const phones = fd.getAll("phone").map(String);
    const roles = fd.getAll("role").map(String);
    const ordered = fd.get("ordered") === "on";
    const signers: { role: string; name: string; email?: string; phone?: string; order: number }[] = [];
    names.forEach((n, i) => {
      const name = n.trim();
      if (!name) return;
      const email = emails[i]?.trim().toLowerCase() || undefined;
      const phone = e164(phones[i]) || undefined;
      if (!email && !phone) throw new Error(`Add an email or mobile number for ${name}.`);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`${email} doesn't look like an email address.`);
      signers.push({ role: roles[i] || `signer${i + 1}`, name, email, phone, order: ordered ? i + 1 : 1 });
    });
    if (!signers.length) throw new Error("Add at least one signer.");
    if (new Set(signers.map((s) => s.role)).size !== signers.length) throw new Error("Each signer needs a different role (Signer 1, Signer 2…).");
    if (fd.get("companySigns") === "on") signers.push({ role: "company", name: c.user.name, email: c.user.email, order: 99 });
    for (const s of signers) {
      if (!placements.some((p) => p.kind === "sign" && p.role === s.role)) throw new Error(`Place a signature box for ${s.role === "company" ? "the company" : s.name} (${s.role}) before sending.`);
    }
    const deal = t.dealType?.startsWith("deal:") ? t.dealType.slice(5) : null;
    const k = await createContract(ws, { opportunityId: deal, templateId: t.id, fields: {}, signers, actor: c.user.id, title: t.name });
    const msg = fd.get("sendNow") === "off" ? "Saved as a draft" : await sendForSignature(ws, k.id, c.user.id);
    return { ok: true, message: msg, redirect: `/closing/documents/${k.id}` };
  });
}
