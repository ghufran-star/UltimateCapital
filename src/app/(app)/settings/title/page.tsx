import { ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { US_STATES } from "@/lib/catalog";
import { Card, Field, PageHeader } from "@/components/ui";
import type { TitleCompany } from "@prisma/client";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { saveTitleCompanyAction } from "../../../actions/settings";

function TitleForm({ t, ro }: { t?: TitleCompany; ro: boolean }) {
  return (
    <ActionForm action={saveTitleCompanyAction} resetOnOk={!t}>
      {t && <input type="hidden" name="titleCompanyId" value={t.id} />}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <input name="name" defaultValue={t?.name} className="field" />
        </Field>
        <Field label="State">
          <Combo name="state" options={US_STATES} defaultValue={t?.state} emptyLabel="Any state" placeholder="Search states" />
        </Field>
        <Field label="Email (packages go here)">
          <input name="email" defaultValue={t?.email ?? ""} className="field" />
        </Field>
        <Field label="Phone">
          <input name="phone" defaultValue={t?.phone ?? ""} className="field" />
        </Field>
        <Field label="Known number for wire verification" hint="Never use a number from an email.">
          <input name="wireVerifiedPhone" defaultValue={t?.wireVerifiedPhone ?? ""} className="field" />
        </Field>
        <Field label="Turnaround">
          <input name="turnaround" defaultValue={t?.turnaround ?? ""} className="field" />
        </Field>
        <Field label="Fees">
          <input name="fees" defaultValue={t?.fees ?? ""} className="field" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes (virtual closing, assignment-friendly, contacts)">
            <input name="notes" defaultValue={t?.notes ?? ""} className="field" />
          </Field>
        </div>
      </div>
      {!ro && <Submit className="btn btn-ghost">{t ? "Save" : "Add title company"}</Submit>}
    </ActionForm>
  );
}

export default async function TitleCos() {
  const c = await pageCtx();
  const ts = await db.titleCompany.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { name: "asc" } });
  const ro = c.workspace.isDemo || !can(c.role, "closing");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Title companies" sub="Where contract packages are sent; replies come back to each deal's inbox." />
      {ts.map((t) => (
        <Card key={t.id} title={t.name}>
          <TitleForm t={t} ro={ro} />
        </Card>
      ))}
      {!ro && (
        <Card title="Add a title company">
          <TitleForm ro={ro} />
        </Card>
      )}
    </div>
  );
}
