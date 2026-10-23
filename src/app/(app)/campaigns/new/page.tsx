import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { CampaignForm } from "../form";

export default async function NewCampaign() {
  const c = await pageCtx();
  const agents = await db.agent.findMany({ where: { workspaceId: c.workspace.id, active: true } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="New campaign" back={{ href: "/campaigns", label: "Campaigns" }} />
      <Card>
        <CampaignForm agents={agents} />
      </Card>
    </div>
  );
}
