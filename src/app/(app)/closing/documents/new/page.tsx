import { ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { PlacementEditor } from "@/components/placements";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { dealScope, pageCtx } from "@/lib/session";
import { createDocumentDraftAction, documentPlacementsAction, sendDocumentAction } from "../../../../actions/documents";
import { SignerRows } from "../signers";

export default async function NewDocument({ searchParams }: { searchParams: Promise<{ t?: string; deal?: string }> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  const t = sp.t ? await db.contractTemplate.findFirst({ where: { id: sp.t, workspaceId: c.workspace.id, kind: "document" }, select: { id: true, name: true, placements: true, dealType: true } }) : null;

  if (!t) {
    const deals = await db.opportunity.findMany({ where: { workspaceId: c.workspace.id, ...dealScope(c), stage: { notIn: ["CLOSED"] } }, include: { property: true }, orderBy: { updatedAt: "desc" }, take: 300 });
    return (
      <div className="max-w-2xl">
        <PageHeader back={{ href: "/closing/documents", label: "Documents" }} title="Send a PDF for signature" sub="Step 1 of 2: upload the document." />
        <Card>
          <ActionForm action={createDocumentDraftAction}>
            <Field label="Document name">
              <input name="title" className="field" placeholder="e.g. Addendum: closing date extension" required />
            </Field>
            <Field label="PDF">
              <input type="file" name="file" accept="application/pdf" className="field" required />
            </Field>
            <Field label="Link to a deal (optional)" hint="Linked documents show on the deal's Paperwork tab.">
              <Combo name="opportunityId" options={deals.map((d) => ({ key: d.id, label: `${d.property.address}, ${d.property.city} ${d.property.state}` }))} defaultValue={sp.deal} emptyLabel="No deal" placeholder="Search deals" />
            </Field>
            <Submit pendingText="Uploading…">Next: place the boxes</Submit>
          </ActionForm>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader back={{ href: "/closing/documents/new", label: "Start again" }} title={t.name} sub="Step 2 of 2: place the signature boxes, add the signers, send." />
      <Card title="1 · Place the boxes">
        <Notice tone="info">Pick a role and box type, then click on the page where it goes. Signer 1 is the first person in the list below. Save the boxes before sending.</Notice>
        <div className="mt-3">
          <PlacementEditor templateId={t.id} initial={(t.placements || []) as never[]} fields={["document_title", "today"]} roles={["signer1", "signer2", "signer3", "signer4", "company"]} action={documentPlacementsAction} />
        </div>
      </Card>
      <Card title="2 · Signers">
        <ActionForm action={sendDocumentAction}>
          <input type="hidden" name="templateId" value={t.id} />
          <SignerRows />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ordered" /> Sign in this order (each signer gets the link after the one before signs)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="companySigns" /> I also sign for the company (countersign in the app)
            </label>
          </div>
          <p className="text-xs text-muted">Each signer gets a private link by email and text, a one-time code to confirm it&apos;s them, and the signed PDF by email when everyone has signed.</p>
          <Submit pendingText="Sending…">Send for signature</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
