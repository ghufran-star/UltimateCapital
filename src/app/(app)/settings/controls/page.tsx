import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { AGENT_ROLES } from "@/lib/agents";
import { getAutonomy, spendSince } from "@/lib/controls";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { STATES } from "@/lib/states";
import { ago, usd } from "@/lib/util";
import { autonomyAction, pauseAction } from "../../../actions/controls";

export default async function Controls() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [pauses, a, spent] = await Promise.all([db.pause.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" } }), getAutonomy(ws), spendSince(ws, new Date(Date.now() - 864e5))]);
  const ro = c.workspace.isDemo || !can(c.role, "approve");
  const owner = c.role === "owner" && !c.workspace.isDemo;
  const label = (scope: string, value: string | null) => (scope === "all" ? "All outreach" : scope === "state" ? `State ${value}` : scope === "channel" ? `Channel: ${value?.replace("_", " ")}` : `Agent: ${AGENT_ROLES.find((r) => r.key === value)?.label || value}`);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Controls" sub="Stop anything instantly, decide what runs by itself, and cap spending." />
      <Card title="Pause switches">
        {pauses.length ? (
          <ul className="mb-4 space-y-2">
            {pauses.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
                <span>
                  <b>{label(p.scope, p.value)}</b> paused {ago(p.createdAt)}
                  {p.reason ? ` · ${p.reason}` : ""}
                </span>
                {!ro && (
                  <ActionButton action={pauseAction} hidden={{ pauseId: p.id, remove: "1" }} className="btn btn-ghost btn-sm">
                    Resume
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted">Nothing is paused. Calls, texts and emails run within your State Packs and campaign settings.</p>
        )}
        {!ro && (
          <div className="space-y-3">
            {!pauses.some((p) => p.scope === "all") && (
              <ActionButton action={pauseAction} hidden={{ scope: "all", reason: "Paused from Controls" }} className="btn btn-danger" confirm="Stop all calls, texts and emails now? Queued work waits until you resume.">
                Pause all outreach now
              </ActionButton>
            )}
            <ActionForm action={pauseAction} className="flex flex-wrap items-end gap-2" resetOnOk>
              <select name="scope" className="field w-auto">
                <option value="state">A state</option>
                <option value="channel">A channel</option>
                <option value="agent">An agent</option>
              </select>
              <select name="value" className="field w-auto">
                <optgroup label="States">
                  {STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Channels">
                  <option value="ai_call">AI calls</option>
                  <option value="human_call">Team calls</option>
                  <option value="sms">Texts</option>
                  <option value="email">Email</option>
                </optgroup>
                <optgroup label="Agents">
                  {AGENT_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <input name="reason" className="field w-48" placeholder="Reason (optional)" />
              <Submit className="btn btn-ghost">Pause</Submit>
            </ActionForm>
            <p className="text-xs text-muted">Pick the matching type: a state code with "A state", a channel with "A channel", an agent with "An agent".</p>
          </div>
        )}
      </Card>

      <Card title="What runs by itself">
        {!owner && <Notice tone="info">Only the owner can change these.</Notice>}
        <ActionForm action={autonomyAction}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Anonymous buyer check when a seller is near agreement">
              <select name="demandCheck" defaultValue={a.demandCheck} className="field" disabled={!owner}>
                <option value="auto">Start automatically</option>
                <option value="ask">Ask me first</option>
              </select>
            </Field>
            <Field label="Marketing to buyers once under contract">
              <select name="fullMarketing" defaultValue={a.fullMarketing} className="field" disabled={!owner}>
                <option value="auto">Start automatically</option>
                <option value="ask">Ask me first</option>
              </select>
            </Field>
            <Field label="After I approve a final offer" hint="Uses the state's seller template; never a SAMPLE template.">
              <select name="sendSellerContract" defaultValue={a.sendSellerContract} className="field" disabled={!owner}>
                <option value="manual">I prepare and send the contract</option>
                <option value="auto">Draft and send the contract automatically</option>
              </select>
            </Field>
            <Field label="When a seller verbally agrees a price on a call" hint="Within your max buy only; above it always goes to Approvals.">
              <select name="offerLetter" defaultValue={a.offerLetter} className="field" disabled={!owner}>
                <option value="auto">Send the written offer letter automatically</option>
                <option value="ask">Ask me before sending the letter</option>
                <option value="off">Don&apos;t send a letter</option>
              </select>
            </Field>
            <Field label="Approve earnest money automatically up to ($)" hint="0 = always ask. Wire verification is still required.">
              <input name="emdAutoUnder" defaultValue={a.emdAutoUnder} className="field tnum" inputMode="numeric" disabled={!owner} />
            </Field>
            <Field label="Approve other payments automatically up to ($)" hint="0 = always ask.">
              <input name="paymentAutoUnder" defaultValue={a.paymentAutoUnder} className="field tnum" inputMode="numeric" disabled={!owner} />
            </Field>
            <Field label="Daily spend cap, all campaigns ($)" hint={`Last 24 hours: about ${usd(spent)}. Blank = no cap.`}>
              <input name="dailySpendCap" defaultValue={a.dailySpendCap ?? ""} className="field tnum" inputMode="numeric" disabled={!owner} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="approvalTexts" defaultChecked={a.approvalTexts} disabled={!owner} /> Text me approval links (owners and admins with a phone)
            </label>
          </div>
          <p className="text-xs text-muted">Always need you, whatever is set here: the final offer to a seller, any price above the max buy or below the floor, and State Pack activation.</p>
          {owner && <Submit>Save</Submit>}
        </ActionForm>
      </Card>
    </div>
  );
}
