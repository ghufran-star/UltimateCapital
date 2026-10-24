"use server";

import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/comms";
import { db } from "@/lib/db";
import { DESIGNS, footerFor, mergeVars, renderEmail } from "@/lib/emails";
import { requireCtx } from "@/lib/session";
import { str } from "@/lib/util";
import { act } from "./util";

export async function saveEmailTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const ws = c.workspace.id;
    const id = str(fd.get("templateId"));
    const name = str(fd.get("name"));
    const subject = str(fd.get("subject"));
    const body = String(fd.get("body") || "").trim();
    if (!name || !subject || !body) throw new Error("Give it a name, a subject line and a message.");
    const design = String(fd.get("design") || "letter");
    const accent = String(fd.get("accent") || "#0f766e");
    const buttonUrl = str(fd.get("buttonUrl"));
    if (buttonUrl && !/^(https?:\/\/|\{\{)/.test(buttonUrl)) throw new Error("The button link must start with https:// (or be a merge field like {{offer_form_url}}).");
    const data = {
      name,
      subject,
      body,
      audience: ["seller", "buyer", "any"].includes(String(fd.get("audience"))) ? String(fd.get("audience")) : "seller",
      design: DESIGNS.some((d) => d.key === design) ? design : "letter",
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#0f766e",
      buttonText: str(fd.get("buttonText")),
      buttonUrl,
    };
    const t = id ? await db.emailTemplate.update({ where: { id, workspaceId: ws }, data }) : await db.emailTemplate.create({ data: { ...data, workspaceId: ws } });
    await audit(ws, c.user.id, id ? "email_template_updated" : "email_template_created", { type: "email_template", id: t.id });
    return id ? { ok: true, message: "Saved. The preview below shows the saved version." } : { ok: true, redirect: `/settings/emails/${t.id}` };
  });
}

export async function archiveEmailTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const id = String(fd.get("templateId"));
    const t = await db.emailTemplate.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    await db.emailTemplate.update({ where: { id }, data: { active: !t.active } });
    return { ok: true, message: t.active ? "Archived" : "Restored" };
  });
}

/** Sends the saved template to your own email, filled with a sample seller and property. */
export async function testEmailTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const ws = c.workspace.id;
    const t = await db.emailTemplate.findFirstOrThrow({ where: { id: String(fd.get("templateId")), workspaceId: ws } });
    const to = str(fd.get("to")) || c.user.email;
    const sample = await db.contact.findFirst({ where: { workspaceId: ws, kind: t.audience === "buyer" ? "buyer" : "seller" }, orderBy: { updatedAt: "desc" } });
    const footer = await footerFor(ws, null);
    if (!footer.address) throw new Error("Add your business postal address first (Settings → Connections → General). Every marketing email must show it.");
    const r = renderEmail(t, await mergeVars(ws, { contactId: sample?.id }), footer);
    const msg = await sendEmail(ws, { to, subject: `[Test] ${r.subject}`, text: r.text, html: r.html, skipChecks: true });
    if (msg.startsWith("Blocked")) throw new Error(msg);
    return { ok: true, message: `Test sent to ${to}` };
  });
}

/** A designed email to one person, by hand (checked like every other email: opt-outs, unsubscribes). */
export async function sendTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("calls", { write: true });
    const contactId = String(fd.get("contactId"));
    await db.contact.findFirstOrThrow({ where: { id: contactId, workspaceId: c.workspace.id } });
    const { sendTemplateEmail } = await import("@/lib/emails");
    const r = await sendTemplateEmail(c.workspace.id, { templateId: String(fd.get("templateId")), contactId });
    if (r.startsWith("Blocked")) throw new Error(r.slice(9));
    await audit(c.workspace.id, c.user.id, "email_sent", { type: "contact", id: contactId });
    return { ok: true, message: r };
  });
}
