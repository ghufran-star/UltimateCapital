import Link from "next/link";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Empty, KV, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { agentForRole } from "@/lib/agents";
import { db } from "@/lib/db";
import { currentLead, OUTCOMES } from "@/lib/dialer";
import { can, pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { fmtDate, fullName, usd } from "@/lib/util";
import { dialerCallAction, dialerNextAction, dialerOutcomeAction, dialerSkipAction } from "../../actions/dialer";

export default async function Dialer({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const camps = await db.campaign.findMany({ where: { workspaceId: ws, status: "running", channels: { has: "human" }, ...(c.states.length ? { OR: [{ state: { in: c.states } }, { state: null }] } : {}) }, orderBy: { updatedAt: "desc" } });
  const campId = sp.campaign || camps[0]?.id;
  const camp = camps.find((x) => x.id === campId);
  const writable = !c.workspace.isDemo && can(c.role, "calls");
  const lead = camp ? await currentLead(ws, c.user.id, camp.id) : null;
  const due = camp ? await db.campaignMember.count({ where: { campaignId: camp.id, status: { in: ["pending", "retry"] }, lockedBy: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] } }) : 0;
  const myToday = await db.interaction.count({ where: { workspaceId: ws, channel: "call", direction: "outbound", provider: { in: ["twilio", "manual"] }, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });

  let details: React.ReactNode = null;
  if (lead && camp) {
    const ct = await db.contact.findUniqueOrThrow({ where: { id: lead.contactId }, include: { ownerships: { include: { property: { include: { opportunities: true } } } } } });
    const prop = lead.propertyId ? ct.ownerships.find((o) => o.propertyId === lead.propertyId)?.property : ct.ownerships[0]?.property;
    const opp = prop?.opportunities[0];
    const [facts, history, script] = await Promise.all([
      db.fact.findMany({ where: { workspaceId: ws, supersededAt: null, OR: [{ entityId: ct.id }, ...(prop ? [{ entityId: prop.id }] : []), ...(opp ? [{ entityId: opp.id }] : [])] }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.interaction.findMany({ where: { workspaceId: ws, contactId: ct.id }, orderBy: { createdAt: "desc" }, take: 5 }),
      agentForRole(ws, camp.kind === "buyer" ? "buyer_acquisition" : "seller_acquisition"),
    ]);
    const fill = (t: string) => t.replace(/\{\{agent_name\}\}/g, c.user.name.split(" ")[0]).replace(/\{\{company\}\}/g, c.workspace.name).replace(/\{\{contact_name\}\}/g, fullName(ct)).replace(/\{\{property_address\}\}/g, prop ? prop.address : "the property");
    details = (
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={<span className="text-lg">{fullName(ct) || "Unnamed"}</span>} actions={<Link href={`/contacts/${ct.id}`} className="text-sm text-brand">Full record</Link>}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-semibold tnum">{ct.phone}</span>
                {writable && (
                  <ActionButton action={dialerCallAction} hidden={{ memberId: lead.id }} className="btn btn-primary">
                    📞 Call now
                  </ActionButton>
                )}
                <span className="text-sm text-muted">Attempt {lead.attempts + 1}</span>
              </div>
              {prop && (
                <KV
                  items={[
                    ["Property", `${prop.address}, ${prop.city} ${prop.state} ${prop.zip}`],
                    ["Details", `${prop.beds ?? "?"} bd / ${prop.baths ?? "?"} ba · ${prop.sqft?.toLocaleString() ?? "?"} sq ft · ${label(prop.propertyType)}`],
                    ["Deal", opp ? <StatusBadge key="s" s={opp.stage} /> : "—"],
                    ["Asking", usd(opp?.askingPrice)],
                  ]}
                />
              )}
              {ct.summary && <Notice tone="info">{ct.summary}</Notice>}
              {facts.length > 0 && (
                <div className="text-sm">
                  <div className="label mb-1">Known</div>
                  <ul className="space-y-0.5">
                    {facts.map((f) => (
                      <li key={f.id}>
                        <span className="text-muted">{label(f.field)}:</span> {typeof f.value === "string" ? f.value : JSON.stringify(f.value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ct.openQuestions.length > 0 && (
                <div className="text-sm">
                  <div className="label mb-1">Find out</div>
                  <ul className="ml-4 list-disc text-muted">
                    {ct.openQuestions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
          {script && (
            <Card title="Script">
              <p className="mb-2 text-sm">{fill(script.persona).replace(/^You are [^,]+, /, "")}</p>
              <pre className="text-sm whitespace-pre-wrap text-muted">{fill(script.playbook)}</pre>
            </Card>
          )}
          {history.length > 0 && (
            <Card title="Earlier contact" pad={false}>
              <ul className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.id} className="px-4 py-2 text-sm">
                    <span className="text-xs text-muted">{fmtDate(h.createdAt, true)} · {h.channel}</span> {h.summary || h.outcome || h.body?.slice(0, 120)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card title="Outcome">
          {writable ? (
            <ActionForm action={dialerOutcomeAction}>
              <input type="hidden" name="memberId" value={lead.id} />
              <input type="hidden" name="campaignId" value={camp.id} />
              <input type="hidden" name="next" value="1" />
              <div className="grid grid-cols-1 gap-1.5">
                {OUTCOMES.map((o) => (
                  <label key={o.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="outcome" value={o.key} required /> {o.label}
                  </label>
                ))}
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-xs text-muted">Call back at (for “Call back later”)</span>
                <input type="datetime-local" name="callbackAt" className="field" />
              </label>
              <textarea name="note" rows={5} className="field" placeholder="What did they say? Price, condition, timeline, who decides… AI files it into the record." />
              <Submit className="btn btn-primary w-full">Save &amp; next</Submit>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">View only.</p>
          )}
          {writable && (
            <div className="mt-3 text-center">
              <ActionButton action={dialerSkipAction} hidden={{ memberId: lead.id, campaignId: camp.id }} className="text-sm text-muted underline">
                Skip for an hour
              </ActionButton>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Power dialer" sub="One contact at a time, checked against DNC, hours and opt-outs before you see it. We ring your phone, then connect them." />
      {camps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {camps.map((x) => (
            <Link key={x.id} href={`/dialer?campaign=${x.id}`} className={`rounded-full px-3 py-1.5 text-sm ${x.id === campId ? "bg-ink text-bg" : "bg-soft"}`}>
              {x.name}
            </Link>
          ))}
          <span className="text-sm text-muted">
            · {due} due now · {myToday} team calls today
          </span>
        </div>
      ) : (
        <Card>
          <Empty title="No team-calling campaign is running" action={<Link href="/campaigns/new" className="btn btn-primary">Create one</Link>}>
            Create a campaign with the channel “Team calls (power dialer)”, add contacts and press Start.
          </Empty>
        </Card>
      )}
      {!c.user.phone && camps.length > 0 && <Notice>Add your mobile in Settings → My profile so the dialer can ring you.</Notice>}
      {camp && !lead && (
        <Card>
          <Empty title={due ? `${due} contacts ready` : "Nobody due right now"} action={writable && due ? <ActionButton action={dialerNextAction} hidden={{ campaignId: camp.id }} className="btn btn-primary">Start dialing</ActionButton> : undefined}>
            {due ? "Each contact is checked again the moment it loads." : "Retries come back when their wait is over."}
          </Empty>
        </Card>
      )}
      {details}
    </div>
  );
}
