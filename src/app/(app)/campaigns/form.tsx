import { ActionForm, Submit } from "@/components/client";
import { Field } from "@/components/ui";
import type { Agent, Campaign } from "@prisma/client";
import { DEFAULT_CAMPAIGN, type CampaignSettings } from "@/lib/campaigns";
import { STATES } from "@/lib/states";
import { saveCampaignAction } from "../../actions/ops";

export function CampaignForm({ camp, agents, kind }: { camp?: Campaign; agents: Agent[]; kind?: string }) {
  const s = (camp?.settings as unknown as CampaignSettings) || DEFAULT_CAMPAIGN;
  const k = camp?.kind || kind || "seller";
  return (
    <ActionForm action={saveCampaignAction}>
      {camp && <input type="hidden" name="campaignId" value={camp.id} />}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input name="name" defaultValue={camp?.name} className="field" required />
        </Field>
        <Field label="Who">
          <select name="kind" defaultValue={k} className="field" disabled={!!camp}>
            <option value="seller">Sellers (acquisition)</option>
            <option value="buyer">Buyers (build the buyer list)</option>
          </select>
          {camp && <input type="hidden" name="kind" value={k} />}
        </Field>
        <Field label="State" hint="Outreach only runs when this state's pack is active.">
          <select name="state" defaultValue={camp?.state || "TX"} className="field">
            <option value="">Any (each contact's own state)</option>
            {STATES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Market (city)">
          <input name="market" defaultValue={camp?.market ?? ""} className="field" />
        </Field>
        <Field label="AI agent">
          <select name="agentId" defaultValue={camp?.agentId ?? ""} className="field">
            <option value="">Default for this campaign type</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <span className="text-sm font-medium">Channels</span>
          <div className="mt-2 flex gap-4 text-sm">
            {[
              ["call", "AI calls"],
              ["sms", "Texts"],
              ["email", "Email"],
            ].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1">
                <input type="checkbox" name="channels" value={v} defaultChecked={(camp?.channels || ["call"]).includes(v)} /> {l}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <Field label="Objective (given to the agent)">
            <textarea name="objective" defaultValue={s.objective} rows={2} className="field" placeholder="e.g. Find owners open to a cash offer in the next 90 days and book a property walkthrough." />
          </Field>
        </div>
        <Field label="Attempts per contact">
          <input name="maxAttempts" defaultValue={s.maxAttempts} className="field" inputMode="numeric" />
        </Field>
        <Field label="Hours between attempts">
          <input name="retryGapHours" defaultValue={s.retryGapHours} className="field" inputMode="numeric" />
        </Field>
        <Field label="Max contacts per day">
          <input name="dailyCap" defaultValue={s.dailyCap} className="field" inputMode="numeric" />
        </Field>
        <Field label="Calls at the same time">
          <input name="concurrency" defaultValue={s.concurrency} className="field" inputMode="numeric" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Text message" hint="{{first_name}} {{agent_name}} {{company}} {{property_address}}. STOP opt-out is added automatically.">
            <textarea name="smsTemplate" defaultValue={s.smsTemplate} rows={2} className="field" />
          </Field>
        </div>
        <Field label="Only ZIPs (optional)">
          <input name="fZips" defaultValue={s.filters?.zips?.join(", ")} className="field" />
        </Field>
        <Field label="Only tags (optional)">
          <input name="fTags" defaultValue={s.filters?.tags?.join(", ")} className="field" />
        </Field>
      </div>
      <Submit>{camp ? "Save campaign" : "Create campaign"}</Submit>
    </ActionForm>
  );
}
