import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { SignaturePad } from "@/components/signature";
import { Card, KV, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { ago, fmtDate } from "@/lib/util";
import { countersignAction, sendContractAction, terminateContractAction } from "../../../../actions/ops";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const k = await db.contract.findFirst({ where: { id, workspaceId: c.workspace.id }, include: { signers: { orderBy: { order: "asc" } }, opportunity: { include: { property: true } } } });
  if (!k) notFound();
  const writable = can(c.role, "contracts");
  const external = k.signers.filter((s) => s.role !== "company");
  const company = k.signers.find((s) => s.role === "company");
  const readyToCountersign = !!company && company.status !== "signed" && external.every((s) => s.status === "signed");
  const events = await db.auditEvent.findMany({ where: { workspaceId: c.workspace.id, entityType: "contract", entityId: k.id }, orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        back={{ href: "/closing/documents", label: "Documents" }}
        title={k.title || "Document"}
        sub={
          <span className="flex items-center gap-2">
            <StatusBadge s={k.status} />
            {k.opportunity && (
              <Link href={`/deals/${k.opportunityId}?tab=contracts`} className="text-brand underline">
                {k.opportunity.property.address}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {k.sourcePdf && (
              <a href={`/api/contracts/${k.id}/pdf?source=1`} className="btn btn-ghost" target="_blank">
                Original PDF
              </a>
            )}
            {k.finalPdf && (
              <a href={`/api/contracts/${k.id}/pdf`} className="btn btn-primary" target="_blank">
                Signed PDF
              </a>
            )}
          </>
        }
      />
      <Card title="Signers">
        <div className="space-y-2">
          {k.signers.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-soft px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {s.name} <span className="text-xs text-muted">({s.role === "company" ? "company" : s.role.replace("signer", "signer ")})</span>
                </div>
                <div className="text-xs text-muted">
                  {[s.email, s.phone].filter(Boolean).join(" · ")}
                  {s.signedAt ? ` · signed ${fmtDate(s.signedAt, true)}` : s.viewedAt ? ` · opened ${ago(s.viewedAt)}` : ""}
                  {s.declineReason ? ` · declined: ${s.declineReason}` : ""}
                </div>
              </div>
              <StatusBadge s={s.status} />
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {writable && ["draft", "sent", "viewed", "partially_signed"].includes(k.status) && !readyToCountersign && (
            <ActionButton action={sendContractAction} hidden={{ contractId: k.id }} className="btn btn-primary">
              {k.status === "draft" ? "Send for signature" : "Resend links"}
            </ActionButton>
          )}
          {writable && readyToCountersign && (
            <ActionForm action={countersignAction}>
              <input type="hidden" name="contractId" value={k.id} />
              <SignaturePad label="Countersign for the company" defaultTyped={c.user.name} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" className="mt-1" /> I agree to sign this document electronically on behalf of the company.
              </label>
              <Submit>Countersign</Submit>
            </ActionForm>
          )}
          {writable && ["sent", "viewed", "partially_signed", "draft"].includes(k.status) && (
            <ActionForm action={terminateContractAction} className="flex gap-2">
              <input type="hidden" name="contractId" value={k.id} />
              <input name="reason" className="field" placeholder="Reason for cancelling" />
              <Submit className="btn btn-danger">Cancel document</Submit>
            </ActionForm>
          )}
        </div>
      </Card>
      <Card title="Details">
        <KV items={[["Created", fmtDate(k.createdAt, true)], ["Completed", fmtDate(k.effectiveAt, true)], ["Fingerprint", k.finalHash ? <span key="h" className="break-all text-xs">{k.finalHash}</span> : "—"]]} />
      </Card>
      <Card title="History" pad={false}>
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between px-4 py-2 text-sm">
              <span>{e.action.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted">{fmtDate(e.createdAt, true)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
