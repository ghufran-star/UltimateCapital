import Link from "next/link";
import { checkNumbersAction } from "../../../actions/agents";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, AutoRefresh, Submit } from "@/components/client";
import { Card, Empty, Notice, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago, fmtDate, fullName } from "@/lib/util";
import { campaignSpend, type CampaignSettings } from "@/lib/campaigns";
import { campaignMembersAction, campaignStatusAction } from "../../../actions/ops";
import { CampaignForm } from "../form";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const camp = await db.campaign.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!camp) notFound();
  const [members, counts, agents, outcomes, emails, pack] = await Promise.all([
    db.campaignMember.findMany({ where: { campaignId: id }, include: { contact: true }, orderBy: [{ status: "asc" }, { nextAttemptAt: "asc" }], take: 200 }),
    db.campaignMember.groupBy({ by: ["status"], where: { campaignId: id }, _count: true }),
    db.agent.findMany({ where: { workspaceId: c.workspace.id, active: true } }),
    db.interaction.groupBy({ by: ["outcome"], where: { workspaceId: c.workspace.id, campaignId: id }, _count: true }),
    db.emailTemplate.findMany({ where: { workspaceId: c.workspace.id, active: true }, select: { id: true, name: true } }),
    camp.state ? db.statePack.findUnique({ where: { workspaceId_state: { workspaceId: c.workspace.id, state: camp.state } } }) : null,
  ]);
  const spend = await campaignSpend(c.workspace.id, id);
  const budget = (camp.settings as unknown as CampaignSettings)?.budget || null;
  const n = (s: string) => counts.find((x) => x.status === s)?._count || 0;
  const total = counts.reduce((a, x) => a + x._count, 0);
  const writable = can(c.role, "campaigns");
  return (
    <div className="space-y-5">
      {camp.status === "running" && <AutoRefresh seconds={20} />}
      <PageHeader
        back={{ href: "/campaigns", label: "Campaigns" }}
        title={camp.name}
        sub={
          <span className="flex items-center gap-2">
            <StatusBadge s={camp.status} /> {label(camp.kind)} · {camp.state || "any state"} · {camp.channels.join(", ")}
          </span>
        }
        actions={
          writable ? (
            camp.status === "running" ? (
              <ActionButton action={campaignStatusAction} hidden={{ campaignId: id, status: "paused" }} className="btn btn-ghost">
                Pause
              </ActionButton>
            ) : (
              <ActionButton action={campaignStatusAction} hidden={{ campaignId: id, status: "running" }} className="btn btn-primary" confirm="Start contacting people in this campaign now (within permitted hours)?">
                Start
              </ActionButton>
            )
          ) : null
        }
      />
      {camp.state && pack?.status !== "active" && <Notice tone="bad">The {camp.state} State Pack is {pack?.status || "missing"}. The campaign can't start until the owner activates it in Settings → States.</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Contacts" value={total} />
        <Stat label="Waiting" value={n("pending") + n("retry")} />
        <Stat label="In progress" value={n("in_progress")} />
        <Stat label="Done" value={n("done")} tone="good" />
        <Stat label="Blocked" value={n("blocked") + n("stopped")} sub="DNC, hours, consent" tone={n("blocked") ? "warn" : undefined} />
      </div>
      <p className="text-sm text-muted">
        Estimated spend ${spend.total.toLocaleString()} ({spend.minutes} call minutes, {spend.texts} texts){budget ? ` of a $${budget.toLocaleString()} budget` : ""}.
      </p>
      {outcomes.length > 0 && (
        <Card title="Outcomes">
          <div className="flex flex-wrap gap-2">
            {outcomes.map((o) => (
              <span key={o.outcome || "none"} className="badge">
                {label(o.outcome || "pending")}: {o._count}
              </span>
            ))}
          </div>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Contacts" className="lg:col-span-2" pad={false}>
          {writable && (
            <div className="flex flex-wrap items-start gap-3 border-b border-line p-4">
              <ActionButton action={checkNumbersAction} hidden={{ scope: `campaign:${id}` }} className="btn btn-ghost btn-sm">
                Check numbers
              </ActionButton>
              <ActionButton action={campaignMembersAction} hidden={{ campaignId: id, how: "filter" }} className="btn btn-ghost btn-sm">
                Add all matching {camp.kind === "seller" ? "sellers" : "buyers"}
              </ActionButton>
              <ActionForm action={campaignMembersAction} className="flex flex-1 gap-2" resetOnOk>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="how" value="phones" />
                <input name="phones" className="field" placeholder="Or paste phone numbers of existing contacts" />
                <Submit className="btn btn-ghost btn-sm">Add</Submit>
              </ActionForm>
              {camp.kind === "seller" && (
                <Link href="/properties/import" className="text-sm text-brand underline">
                  Import a new list
                </Link>
              )}
            </div>
          )}
          {members.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="text-right">Attempts</th>
                    <th>Next / last</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/contacts/${m.contactId}`} className="font-medium hover:text-brand">
                          {fullName(m.contact)}
                        </Link>
                        <div className="text-xs text-muted">{m.contact.phone}</div>
                      </td>
                      <td>
                        <StatusBadge s={m.status} />
                        {m.blockedReason && <div className="text-xs text-muted">{m.blockedReason}</div>}
                      </td>
                      <td className="text-right tnum">{m.attempts}</td>
                      <td className="text-xs text-muted">{m.nextAttemptAt && ["pending", "retry"].includes(m.status) ? fmtDate(m.nextAttemptAt, true) : m.lastOutcome ? label(m.lastOutcome) : ago(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No contacts yet" />
          )}
        </Card>
        <Card title="Settings">{writable ? <CampaignForm camp={camp} agents={agents} emails={emails} /> : <p className="text-sm text-muted">View only.</p>}</Card>
      </div>
    </div>
  );
}
