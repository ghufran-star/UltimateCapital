import Link from "next/link";
import { RowLink } from "@/components/client";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago } from "@/lib/util";

export default async function Campaigns() {
  const c = await pageCtx();
  const camps = await db.campaign.findMany({ where: { workspaceId: c.workspace.id, ...(c.states.length ? { OR: [{ state: { in: c.states } }, { state: null }] } : {}) }, orderBy: { updatedAt: "desc" } });
  const stats = await db.campaignMember.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: camps.map((x) => x.id) } }, _count: true });
  const s = (id: string, st?: string) => stats.filter((x) => x.campaignId === id && (!st || x.status === st)).reduce((a, x) => a + x._count, 0);
  return (
    <div>
      <PageHeader title="Campaigns" sub="AI calling, texting and email to sellers and buyers, inside each state's hours and limits." actions={<Link href="/campaigns/new" className="btn btn-primary">+ New campaign</Link>} />
      <Card pad={false}>
        {camps.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="text-right">Contacts</th>
                  <th className="text-right">Done</th>
                  <th className="text-right">Blocked</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {camps.map((x) => (
                  <RowLink key={x.id} href={`/campaigns/${x.id}`}>
                    <td>
                      <div className="font-medium">{x.name}</div>
                      <div className="text-xs text-muted">
                        {label(x.kind)} · {x.state || "any state"}
                        {x.market ? ` · ${x.market}` : ""} · {x.channels.join(", ")}
                      </div>
                    </td>
                    <td>
                      <StatusBadge s={x.status} />
                    </td>
                    <td className="text-right tnum">{s(x.id)}</td>
                    <td className="text-right tnum">{s(x.id, "done")}</td>
                    <td className="text-right tnum">{s(x.id, "blocked")}</td>
                    <td className="text-xs text-muted">{ago(x.updatedAt)}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No campaigns yet" action={<Link href="/campaigns/new" className="btn btn-primary">Create one</Link>}>
            Import sellers, then start a campaign. Buyer demand campaigns for deals start from the deal itself.
          </Empty>
        )}
      </Card>
    </div>
  );
}
