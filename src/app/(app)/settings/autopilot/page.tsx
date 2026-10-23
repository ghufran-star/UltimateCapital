import { ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { AGENT_ROLES } from "@/lib/agents";
import { getAutopilot } from "@/lib/autopilot";
import { can, pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { autopilotAction } from "../../../actions/autopilot";

export default async function AutopilotPage() {
  const c = await pageCtx();
  const a = await getAutopilot(c.workspace.id);
  const ro = c.workspace.isDemo || !can(c.role, "settings");
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Autopilot" sub="Every deal gets its next step by itself, stuck deals are flagged, and cold leads are revisited. Pauses in Controls stop all of it." />
      <ActionForm action={autopilotAction} className="space-y-5">
        <Card title="Autopilot">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="on" defaultChecked={a.on} disabled={ro} /> Run autopilot
          </label>
        </Card>
        <Card title="Next steps by stage" pad={false}>
          <table className="data">
            <thead>
              <tr>
                <th>On</th>
                <th>When a deal is in…</th>
                <th>The step</th>
                <th>Agent</th>
                <th className="text-right">After (hours)</th>
              </tr>
            </thead>
            <tbody>
              {a.steps.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" name={`step_on_${s.id}`} defaultChecked={s.on} disabled={ro} />
                  </td>
                  <td>{label(s.stage)}</td>
                  <td className="text-sm">
                    {s.label}
                    {s.repeat && <span className="block text-xs text-muted">repeats after each contact</span>}
                  </td>
                  <td className="text-xs">{AGENT_ROLES.find((r) => r.key === s.role)?.label}</td>
                  <td className="text-right">
                    <input name={`step_h_${s.id}`} defaultValue={s.afterHours} className="field w-20 text-right tnum" inputMode="numeric" disabled={ro} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">If the AI isn&apos;t allowed to call someone (for example no AI-voice consent in that state), the step becomes a task for the assigned person instead.</p>
        </Card>
        <Card title="Flag stuck deals after (days)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {a.slas.map((s) => (
              <Field key={s.stage} label={label(s.stage)}>
                <input name={`sla_${s.stage}`} defaultValue={s.maxDays} className="field tnum" inputMode="numeric" disabled={ro} />
              </Field>
            ))}
          </div>
        </Card>
        <Card title="Long-term follow-up">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Check in with “not now” sellers every (days)" hint="0 = off">
              <input name="nurtureDays" defaultValue={a.nurtureDays} className="field tnum" inputMode="numeric" disabled={ro} />
            </Field>
            <Field label="At most (times)">
              <input name="nurtureMax" defaultValue={a.nurtureMax} className="field tnum" inputMode="numeric" disabled={ro} />
            </Field>
          </div>
        </Card>
        <Card title="Replies to texts and emails">
          <Field label="When a seller or investor messages us" hint="Prices, offers and anything binding always go to a person.">
            <select name="replies" defaultValue={a.replies} className="field" disabled={ro}>
              <option value="draft">AI drafts a reply; a person sends it with one click</option>
              <option value="auto">AI replies by itself</option>
              <option value="off">Off</option>
            </select>
          </Field>
        </Card>
        {!ro && <Submit>Save</Submit>}
      </ActionForm>
    </div>
  );
}
