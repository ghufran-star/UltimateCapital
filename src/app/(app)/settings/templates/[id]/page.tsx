import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { STANDARD_FIELDS } from "@/lib/contracts";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { deleteTemplateAction, saveTemplateAction } from "../../../../actions/settings";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const t = id === "new" ? null : await db.contractTemplate.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (id !== "new" && !t) notFound();
  const ro = c.workspace.isDemo || !can(c.role, "contracts");
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader back={{ href: "/settings/templates", label: "Contract templates" }} title={t ? t.name : "New template"} />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Card>
          <ActionForm action={saveTemplateAction}>
            {t && <input type="hidden" name="templateId" value={t.id} />}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <input name="name" defaultValue={t?.name} className="field" required />
              </Field>
              <Field label="Kind">
                <select name="kind" defaultValue={t?.kind || "seller_purchase"} className="field">
                  <option value="seller_purchase">Seller purchase agreement</option>
                  <option value="assignment">Assignment to buyer</option>
                  <option value="buyer_purchase">Buyer purchase (double close)</option>
                  <option value="addendum">Addendum</option>
                </select>
              </Field>
              <Field label="State (blank = all)">
                <input name="state" defaultValue={t?.state ?? ""} maxLength={2} className="field uppercase" />
              </Field>
              <Field label="Deal type (blank = all)">
                <input name="dealType" defaultValue={t?.dealType ?? ""} className="field" />
              </Field>
            </div>
            <Field label="Contract text">
              <textarea name="body" defaultValue={t?.body} rows={28} className="field font-mono text-xs" required />
            </Field>
            {!ro && <Submit>Save{t ? ` (v${t.version + 1})` : ""}</Submit>}
          </ActionForm>
          {t && !ro && t.active && (
            <div className="mt-3">
              <ActionButton action={deleteTemplateAction} hidden={{ templateId: t.id }} confirm="Archive this template?" className="text-sm text-bad underline">
                Archive
              </ActionButton>
            </div>
          )}
        </Card>
        <Card title="Fields">
          <p className="mb-2 text-xs text-muted">Type these in the text; they fill from the deal and can be edited before sending.</p>
          <ul className="space-y-0.5 font-mono text-xs">
            {STANDARD_FIELDS.map((f) => (
              <li key={f}>{`{{${f}}}`}</li>
            ))}
          </ul>
          <p className="mt-3 mb-1 text-xs text-muted">Signatures and initials:</p>
          <ul className="space-y-0.5 font-mono text-xs">
            <li>[[sign:seller]]</li>
            <li>[[sign:seller2]]</li>
            <li>[[sign:buyer]]</li>
            <li>[[sign:company]]</li>
            <li>[[initial:seller]]</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
