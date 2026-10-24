import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { DESIGNS, footerFor, MERGE_FIELDS, mergeVars, renderEmail, STARTER_TEMPLATES } from "@/lib/emails";
import { can, pageCtx } from "@/lib/session";
import { archiveEmailTemplateAction, saveEmailTemplateAction, testEmailTemplateAction } from "../../../../actions/emails";

export default async function EmailTemplate({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const { id } = await params;
  const t = id === "new" ? null : await db.emailTemplate.findFirst({ where: { id, workspaceId: ws } });
  if (id !== "new" && !t) notFound();
  const base = t || { ...STARTER_TEMPLATES[0], name: "", accent: "#0f766e", active: true };
  const writable = can(c.role, "campaigns") && c.role !== "viewer";
  const sample = await db.contact.findFirst({ where: { workspaceId: ws, kind: base.audience === "buyer" ? "buyer" : "seller" }, orderBy: { updatedAt: "desc" } });
  const preview = t ? renderEmail(t, await mergeVars(ws, { contactId: sample?.id }), await footerFor(ws, sample?.id)) : null;
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader back={{ href: "/settings/emails", label: "Email templates" }} title={t ? t.name : "New email"} sub="Write it like a normal email. Use the merge fields to make it personal." />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <ActionForm action={saveEmailTemplateAction}>
              {t && <input type="hidden" name="templateId" value={t.id} />}
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Name (only you see it)">
                  <input name="name" defaultValue={base.name} className="field" required />
                </Field>
                <Field label="Who it's for">
                  <select name="audience" defaultValue={base.audience} className="field">
                    <option value="seller">Sellers</option>
                    <option value="buyer">Buyers</option>
                    <option value="any">Anyone</option>
                  </select>
                </Field>
              </div>
              <Field label="Subject line">
                <input name="subject" defaultValue={base.subject} className="field" required />
              </Field>
              <Field label="Message" hint="A blank line starts a new paragraph.">
                <textarea name="body" defaultValue={base.body} rows={10} className="field" required />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Button text (optional)">
                  <input name="buttonText" defaultValue={base.buttonText || ""} className="field" placeholder="Get my cash offer" />
                </Field>
                <Field label="Button link" hint="https://… or {{offer_form_url}}">
                  <input name="buttonUrl" defaultValue={base.buttonUrl || ""} className="field" placeholder="{{offer_form_url}}" />
                </Field>
              </div>
              <fieldset>
                <legend className="text-sm font-medium">Design</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {DESIGNS.map((d) => (
                    <label key={d.key} className="card flex cursor-pointer items-start gap-2 p-3 text-sm has-[:checked]:border-brand">
                      <input type="radio" name="design" value={d.key} defaultChecked={base.design === d.key} className="mt-1" />
                      <span>
                        <span className="block font-medium">{d.label}</span>
                        <span className="block text-xs text-muted">{d.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-3 text-sm">
                <input type="color" name="accent" defaultValue={base.accent} className="h-9 w-12 rounded border border-line" /> Colour for the button and design
              </label>
              {writable && <Submit>{t ? "Save" : "Create"}</Submit>}
            </ActionForm>
          </Card>
          {t && writable && (
            <Card title="Try it">
              <ActionForm action={testEmailTemplateAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="templateId" value={t.id} />
                <input name="to" type="email" defaultValue={c.user.email} className="field max-w-xs" />
                <Submit className="btn btn-ghost">Send me a test</Submit>
              </ActionForm>
              <div className="mt-3">
                <ActionButton action={archiveEmailTemplateAction} hidden={{ templateId: t.id }} className="btn btn-ghost btn-sm">
                  {t.active ? "Archive this email" : "Restore this email"}
                </ActionButton>
              </div>
            </Card>
          )}
        </div>
        <div className="space-y-5 lg:col-span-2">
          <Card title="Merge fields">
            <ul className="space-y-1 text-sm">
              {MERGE_FIELDS.map(([k, l]) => (
                <li key={k} className="flex flex-wrap justify-between gap-2">
                  <code className="rounded bg-soft px-1 text-xs">{`{{${k}}}`}</code>
                  <span className="text-muted">{l}</span>
                </li>
              ))}
            </ul>
          </Card>
          {preview && (
            <Card title="Preview" pad={false}>
              <div className="border-b border-line px-4 py-2 text-sm">
                <span className="text-muted">Subject:</span> {preview.subject}
              </div>
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[480px] w-full rounded-b-xl bg-white" />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
