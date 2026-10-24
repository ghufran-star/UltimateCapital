import Link from "next/link";
import { ActionButton } from "@/components/client";
import { Card, Empty, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";
import { markAlertsReadAction } from "../../actions/ops";

export default async function Alerts() {
  const c = await pageCtx();
  const list = await db.notification.findMany({ where: { workspaceId: c.workspace.id, OR: [{ userId: null }, { userId: c.user.id }] }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div>
      <PageHeader title="Alerts" actions={<><a href="/settings/app" className="btn btn-ghost">Phone alerts</a><ActionButton action={markAlertsReadAction}>Mark all read</ActionButton></>} />
      <Card pad={false}>
        {list.length ? (
          <ul className="divide-y divide-line">
            {list.map((n) => (
              <li key={n.id}>
                <Link href={n.href || "#"} className={`block px-4 py-3 hover:bg-soft ${n.readAt ? "" : "border-l-4 border-brand"}`}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">{n.title}</span>
                    <span className="shrink-0 text-xs text-muted">{ago(n.createdAt)}</span>
                  </div>
                  <div className="text-sm text-muted">{n.body}</div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No alerts yet" />
        )}
      </Card>
    </div>
  );
}
