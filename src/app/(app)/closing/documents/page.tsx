import { SectionTabs } from "@/components/sections";
import Link from "next/link";
import { RowLink } from "@/components/client";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";

export default async function Documents() {
  const c = await pageCtx();
  const docs = await db.contract.findMany({ where: { workspaceId: c.workspace.id, kind: "document" }, omit: { finalPdf: true, sourcePdf: true }, include: { signers: true, opportunity: { include: { property: true } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader back={{ href: "/closing", label: "Contracts & closing" }} title="Documents for signature" sub="Any PDF you send by hand: addenda, disclosures, extensions, JV agreements, W-9s." actions={<Link href="/closing/documents/new" className="btn btn-primary">+ Send a PDF for signature</Link>} />
      <SectionTabs set="closing" active="/closing/documents" />
      <Card pad={false}>
        {docs.length ? (
          <div className="overflow-x-auto"><table className="data">
            <thead>
              <tr>
                <th>Document</th>
                <th>Signers</th>
                <th>Deal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <RowLink key={d.id} href={`/closing/documents/${d.id}`}>
                  <td>
                    <div className="font-medium">{d.title || "Document"}</div>
                    <div className="text-xs text-muted">{ago(d.updatedAt)}</div>
                  </td>
                  <td className="text-xs">{d.signers.map((s) => `${s.name}: ${s.status}`).join(" · ")}</td>
                  <td className="text-sm">{d.opportunity?.property.address || "—"}</td>
                  <td>
                    <StatusBadge s={d.status} />
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table></div>
        ) : (
          <Empty title="No documents yet" action={<Link href="/closing/documents/new" className="btn btn-primary">Send a PDF for signature</Link>} />
        )}
      </Card>
    </div>
  );
}
