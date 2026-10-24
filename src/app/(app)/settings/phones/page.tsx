import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { US_STATES } from "@/lib/catalog";
import { Card, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { savePhoneAction } from "../../../actions/settings";

export default async function Phones() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [nums, agents, members, s] = await Promise.all([db.phoneNumber.findMany({ where: { workspaceId: ws } }), db.agent.findMany({ where: { workspaceId: ws } }), db.membership.findMany({ where: { workspaceId: ws }, include: { user: true } }), loadSettings(ws)]);
  const ro = !can(c.role, "settings");
  const base = (s.PUBLIC_URL || "https://YOUR-APP").replace(/\/$/, "");
  const row = (n?: (typeof nums)[number]) => (
    <ActionForm action={savePhoneAction} className="grid items-end gap-2 md:grid-cols-6" resetOnOk={!n}>
      {n && <input type="hidden" name="phoneId" value={n.id} />}
      <input name="number" defaultValue={n?.number} placeholder="+12105550100" className="field md:col-span-2" />
      <input name="market" defaultValue={n?.market ?? ""} placeholder="Market" className="field" />
      <Combo name="state" options={US_STATES} defaultValue={n?.state} emptyLabel="Any" placeholder="State" />
      <select name="inboundMode" defaultValue={n?.inboundMode || "agent"} className="field">
        <option value="agent">AI receptionist answers</option>
        <option value="forward">Forward to a person</option>
        <option value="voicemail">Voicemail</option>
      </select>
      <div className="flex gap-2">
        <select name="forwardUserId" defaultValue={n?.forwardUserId ?? ""} className="field">
          <option value="">Forward to…</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.name}
            </option>
          ))}
        </select>
      </div>
      <select name="inboundAgentId" defaultValue={n?.inboundAgentId ?? ""} className="field md:col-span-2">
        <option value="">Inbound agent: receptionist</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {!ro && <Submit className="btn btn-ghost">{n ? "Save" : "Add number"}</Submit>}
    </ActionForm>
  );
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Phone numbers" sub="Numbers you own in Twilio (and imported to Retell for AI calls). Inbound calls ring the AI receptionist, a person, or voicemail." />
      {nums.map((n) => (
        <Card key={n.id} title={n.number} actions={!ro ? <ActionButton action={savePhoneAction} hidden={{ phoneId: n.id, delete: "1" }} confirm="Remove this number?">Remove</ActionButton> : null}>
          {row(n)}
        </Card>
      ))}
      <Card title="Add a number">{row()}</Card>
      <Card title="Set these in Twilio for each number">
        <ul className="space-y-2 text-sm">
          <li>
            A call comes in → <code className="break-all text-xs">{base}/api/webhooks/twilio/voice?ws={ws}</code>
          </li>
          <li>
            A message comes in → <code className="break-all text-xs">{base}/api/webhooks/twilio/sms?ws={ws}</code>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">For AI-answered numbers you can instead import the number into Retell and bind the receptionist agent; the app works either way.</p>
      </Card>
    </div>
  );
}
