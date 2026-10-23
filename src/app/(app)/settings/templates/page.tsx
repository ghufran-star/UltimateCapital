import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago } from "@/lib/util";

export default async function Templates() {
  const c = await pageCtx();
  const ts = await db.contractTemplate.findMany({ where: { workspaceId: c.workspace.id }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Contract templates" sub="Paste your attorney's contracts. Fields fill from the deal; signers sign in the app from a link sent by email and text." actions={<Link href="/settings/templates/new" className="btn btn-primary">+ New template</Link>} />
      {ts.some((t) => t.active && t.body.startsWith("SAMPLE ONLY")) && <Notice tone="bad">You are using SAMPLE templates. Replace them with your attorney&apos;s contracts before sending anything to a real seller or buyer.</Notice>}
      <Card pad={false}>
        <ul className="divide-y divide-line">
          {ts.map((t) => (
            <li key={t.id}>
              <Link href={`/settings/templates/${t.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-soft">
                <span>
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-xs text-muted">
                    {label(t.kind)} · {t.state || "all states"} · v{t.version} · {ago(t.updatedAt)}
                  </span>
                </span>
                {!t.active && <span className="badge">Archived</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
