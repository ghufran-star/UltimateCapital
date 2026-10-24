import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { DESIGNS, ensureStarterTemplates } from "@/lib/emails";
import { pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";

export default async function EmailTemplates() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  await ensureStarterTemplates(ws);
  const [ts, address] = await Promise.all([db.emailTemplate.findMany({ where: { workspaceId: ws }, orderBy: [{ active: "desc" }, { updatedAt: "desc" }] }), setting(ws, "BUSINESS_ADDRESS")]);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Email templates" sub="Designed emails with merge fields. Your business address and an unsubscribe link are added to the bottom of every one." actions={<Link href="/settings/emails/new" className="btn btn-primary">+ New email</Link>} />
      {!address && (
        <Notice tone="bad">
          Add your business postal address in <Link href="/settings/integrations" className="underline">Connections → General</Link>. The law (CAN-SPAM) requires it on marketing email, so emails aren&apos;t sent without it.
        </Notice>
      )}
      <Card pad={false}>
        <ul className="divide-y divide-line">
          {ts.map((t) => (
            <li key={t.id}>
              <Link href={`/settings/emails/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-soft">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t.audience === "buyer" ? "Buyers" : t.audience === "any" ? "Anyone" : "Sellers"} · {DESIGNS.find((d) => d.key === t.design)?.label} · {t.subject} · {ago(t.updatedAt)}
                  </span>
                </span>
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: t.accent }} />
                {!t.active && <span className="badge">Archived</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-sm text-muted">Campaigns use these for the email that goes out with the first call and text (cold outreach mode), and you can send one by hand from a seller&apos;s or buyer&apos;s page.</p>
    </div>
  );
}
