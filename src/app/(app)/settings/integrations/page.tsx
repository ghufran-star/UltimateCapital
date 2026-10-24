import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { loadSettings, mask, setting, SETTING_DEFS, type SettingKey } from "@/lib/config";
import { Notice } from "@/components/ui";
import { can, pageCtx } from "@/lib/session";
import { saveSettingsAction, testIntegrationAction } from "../../../actions/settings";

export default async function Integrations() {
  const c = await pageCtx();
  const s = await loadSettings(c.workspace.id, true);
  // The demo shows its pretend (always connected) connections.
  if (c.workspace.isDemo) for (const d of SETTING_DEFS) s[d.key] = (await setting(c.workspace.id, d.key as SettingKey)) || "";
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  const ro = c.workspace.isDemo || !can(c.role, "settings");
  const base = (s.PUBLIC_URL || "https://YOUR-APP.up.railway.app").replace(/\/$/, "");
  const ws = c.workspace.id;
  const hooks: [string, string][] = [
    ["Retell webhook (set automatically on agent sync)", `${base}/api/webhooks/retell?ws=${ws}`],
    ["Twilio: incoming text (Messaging webhook)", `${base}/api/webhooks/twilio/sms?ws=${ws}`],
    ["Twilio: incoming call (Voice webhook)", `${base}/api/webhooks/twilio/voice?ws=${ws}`],
    ["Inbound email (Resend / Postmark / Mailgun)", `${base}/api/webhooks/email?ws=${ws}&key=WEBHOOK_SECRET`],
    ["DNC provider push (optional)", `${base}/api/webhooks/dnc?ws=${ws}&key=WEBHOOK_SECRET`],
  ];
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Integrations" sub="Keys are encrypted in your database. Leave a secret blank to keep it." />
      {c.workspace.isDemo && <Notice tone="info">Demo: every connection here is pretend and always connected. Calls, texts, email, AI, data lookups and DNC checks all work through built-in stand-ins, and nothing reaches a real person or a paid service. Switch to your real account to add real keys.</Notice>}
      <ActionForm action={saveSettingsAction} className="space-y-5">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <div className="space-y-3">
              {SETTING_DEFS.filter((d) => d.group === g).map((d) => (
                <Field key={d.key} label={d.label} hint={`${d.help}${s[d.key] ? ` · current: ${d.secret ? mask(s[d.key]) : s[d.key]}` : ""}`}>
                  <input name={d.key} type={d.secret ? "password" : "text"} autoComplete="off" defaultValue={d.secret ? "" : s[d.key] || ""} placeholder={d.secret && s[d.key] ? "•••••• saved" : ""} className="field" disabled={ro} />
                </Field>
              ))}
            </div>
          </Card>
        ))}
        {!ro && <Submit>Save</Submit>}
      </ActionForm>
      <Card title="Test connections">
        <div className="flex flex-wrap gap-2">
          {[
            ["claude", "Claude"],
            ["retell", "Retell"],
            ["twilio", "Twilio"],
            ["resend", "Resend"],
            ["rentcast", "RentCast"],
          ].map(([k, l]) => (
            <ActionButton key={k} action={testIntegrationAction} hidden={{ what: k }}>
              Test {l}
            </ActionButton>
          ))}
        </div>
      </Card>
      <Card title="Webhook addresses">
        <ul className="space-y-3 text-sm">
          {hooks.map(([l, u]) => (
            <li key={l}>
              <div className="font-medium">{l}</div>
              <code className="block break-all rounded-lg bg-soft px-2 py-1 text-xs">{u}</code>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
