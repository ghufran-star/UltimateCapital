import { ActionButton, ActionForm, Submit } from "@/components/client";
import { PushSetup } from "@/components/pwa";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { vapid } from "@/lib/push";
import { pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";
import { forgetDeviceAction, setPushTopicsAction, testPushAction } from "../../../actions/push";

const TOPICS = [
  { key: "approvals", label: "Approvals waiting for me", hint: "offers over the limit, final offers, earnest money, payments" },
  { key: "hot", label: "Hot deals", hint: "serious investors, seller ready to proceed or countering, buyer offers" },
  { key: "money", label: "Money", hint: "fees paid, wire instructions, settlement statements" },
  { key: "all", label: "Everything", hint: "every alert in the bell" },
];

export default async function AppSettings() {
  const c = await pageCtx();
  const [v, devices] = await Promise.all([vapid(), db.pushSubscription.findMany({ where: { userId: c.user.id }, orderBy: { createdAt: "desc" } })]);
  const topics = devices[0]?.topics || ["approvals", "hot"];
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Phone app & alerts" sub="Install UltimateCapital on your phone or computer and get alerts for approvals and hot deals, even when it's closed." />
      <Card title="This device">
        <PushSetup publicKey={v.publicKey} topics={topics} />
      </Card>
      <Card title="What to alert me about">
        <ActionForm action={setPushTopicsAction}>
          {TOPICS.map((t) => (
            <label key={t.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="topics" value={t.key} defaultChecked={topics.includes(t.key)} className="mt-1" />
              <span>
                {t.label}
                <span className="block text-xs text-muted">{t.hint}</span>
              </span>
            </label>
          ))}
          <Submit className="btn btn-ghost">Save</Submit>
        </ActionForm>
        {c.workspace.isDemo && <p className="mt-2 text-xs text-muted">The demo workspace never sends alerts.</p>}
      </Card>
      <Card title="My devices">
        {devices.length ? (
          <ul className="divide-y divide-line text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {d.device || "Device"} <span className="text-xs text-muted">· added {ago(d.createdAt)}{d.lastOkAt ? ` · last alert ${ago(d.lastOkAt)}` : ""}</span>
                </span>
                <ActionButton action={forgetDeviceAction} hidden={{ id: d.id }} className="text-xs text-bad underline">
                  Remove
                </ActionButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No devices yet.</p>
        )}
        {devices.length > 0 && (
          <div className="mt-3">
            <ActionButton action={testPushAction} className="btn btn-ghost btn-sm">
              Send me a test alert
            </ActionButton>
          </div>
        )}
      </Card>
    </div>
  );
}
