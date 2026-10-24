import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { CampaignForm } from "../form";

export default async function NewCampaign() {
  const c = await pageCtx();
  const [agents, emails] = await Promise.all([db.agent.findMany({ where: { workspaceId: c.workspace.id, active: true } }), db.emailTemplate.findMany({ where: { workspaceId: c.workspace.id, active: true }, select: { id: true, name: true } })]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New campaign" back={{ href: "/campaigns", label: "Campaigns" }} />
      <Card>
        <CampaignForm agents={agents} emails={emails} />
      </Card>
    </div>
  );
}
