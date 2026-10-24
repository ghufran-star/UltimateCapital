import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Card, Notice, PageHeader } from "@/components/ui";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { consentText } from "@/lib/leadform";
import { pageCtx } from "@/lib/session";
import { stateName } from "@/lib/states";
import { getCompliance } from "@/lib/switches";
import { ago } from "@/lib/util";
import { coldOutreachAction, saveCallingRulesAction } from "../../../actions/switches";

function Switch({ name, on, title, children, disabled }: { name: string; on: boolean; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 py-3">
      <input type="checkbox" name={name} defaultChecked={on} disabled={disabled} className="mt-1 h-5 w-5 shrink-0" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{children}</span>
      </span>
    </label>
  );
}

export default async function CallingRules() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [sw, packs, log, company, base, users] = await Promise.all([
    getCompliance(ws),
    db.statePack.findMany({ where: { workspaceId: ws, status: "active" }, select: { state: true }, orderBy: { state: "asc" } }),
    db.auditEvent.findMany({ where: { workspaceId: ws, action: "compliance_switches" }, orderBy: { createdAt: "desc" }, take: 10 }),
    setting(ws, "COMPANY_NAME"),
    setting(ws, "PUBLIC_URL"),
    db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const owner = c.role === "owner";
  const who = (id: string) => users.find((m) => m.user.id === id)?.user.name || id;
  const formUrl = `${(base || "").replace(/\/$/, "")}/f/${ws}`;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Calling rules" sub="What callers say at the start, when people may be called, and cold outreach. Only the owner can change these, and every change is logged." />
      <Notice tone="info">These are your decisions. We recommend checking them with your attorney, especially before switching a notice off or turning cold outreach on.</Notice>

      <Card title="At the start of every call">
        <ActionForm action={saveCallingRulesAction} className="divide-y divide-line">
          <Switch name="aiDisclosure" on={sw.aiDisclosure} title="AI callers say they're an AI" disabled={!owner}>
            &quot;Just so you know, I&apos;m an AI assistant calling on behalf of {company || "your company"}.&quot; Some states require this.
          </Switch>
          <Switch name="recordingNotice" on={sw.recordingNotice} title="Say the call is recorded" disabled={!owner}>
            AI callers mention it, and people you call from the app hear &quot;This call is recorded&quot; before they&apos;re connected. Some states require everyone&apos;s permission to record.
          </Switch>
          <Switch name="ownerHours" on={sw.ownerHours} title="Calling hours where the owner actually lives" disabled={!owner}>
            Besides the property&apos;s state, calls and texts also wait for allowed hours where the owner lives (their mailing address, otherwise their phone&apos;s area code). The strictest wins. No AI, no cost.
          </Switch>
          {packs.length > 0 && (
            <details className="py-3">
              <summary className="cursor-pointer text-sm font-medium">Different in some states</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Say it&apos;s an AI</th>
                      <th>Recorded notice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.map(({ state }) => {
                      const st = sw.states[state] || {};
                      const opt = (v?: boolean) => (v === undefined ? "same" : v ? "on" : "off");
                      return (
                        <tr key={state}>
                          <td className="text-sm">{stateName(state)}</td>
                          {(["ai", "rec"] as const).map((k) => (
                            <td key={k}>
                              <select name={`st_${k}_${state}`} defaultValue={opt(k === "ai" ? st.aiDisclosure : st.recordingNotice)} className="field w-auto text-sm" disabled={!owner}>
                                <option value="same">Same as above</option>
                                <option value="on">Always on here</option>
                                <option value="off">Off here</option>
                              </select>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {owner && (
            <div className="pt-3">
              <Submit>Save</Submit>
            </div>
          )}
        </ActionForm>
      </Card>

      <Card title={`Cold outreach mode · ${sw.coldOutreach ? "ON" : "off"}`}>
        <p className="text-sm">
          When on, people on lists you upload or buy can be <b>called by the AI, texted and emailed at the same time</b>, without a consent record. Off, they&apos;re called by your team, and the AI only calls where the state allows it without consent.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Still always applied: Do Not Call lists, the litigator check, opt-outs (STOP, &quot;don&apos;t call me&quot;, unsubscribe), calling hours, daily limits.</li>
          <li>Emails carry your business address and an unsubscribe link. Texts carry &quot;Reply STOP to opt out&quot;.</li>
          <li>This is a legal decision with real risk (TCPA). Turn it on only after your attorney agrees.</li>
        </ul>
        {sw.coldOutreach && sw.coldConfirmedAt && (
          <p className="mt-2 text-xs text-muted">
            Turned on by {who(sw.coldConfirmedBy || "")} on {new Date(sw.coldConfirmedAt).toLocaleString("en-US")}.
          </p>
        )}
        {owner ? (
          sw.coldOutreach ? (
            <ActionForm action={coldOutreachAction} className="mt-3">
              <input type="hidden" name="mode" value="off" />
              <Submit className="btn btn-ghost">Turn cold outreach off</Submit>
            </ActionForm>
          ) : (
            <ActionForm action={coldOutreachAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="mode" value="on" />
              <input name="confirm" className="field max-w-[12rem]" placeholder="Type TURN ON" autoComplete="off" />
              <Submit className="btn btn-danger">Turn cold outreach on</Submit>
            </ActionForm>
          )
        ) : (
          <p className="mt-3 text-sm text-muted">Only the owner can change this.</p>
        )}
      </Card>

      <Card title="“Get a cash offer” form">
        <p className="text-sm">A form for your website, ads, emails and texts. Leads arrive as deals with proof of consent saved (the exact wording they agreed to, when, from which page, their IP and device), and your team gets a call task straight away.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/f/${ws}`} target="_blank" className="btn btn-primary btn-sm">
            Open the form
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">Link to share:</p>
        <code className="block break-all rounded bg-soft px-2 py-1 text-xs">{formUrl}</code>
        <p className="mt-2 text-xs text-muted">To put it on your website, paste this:</p>
        <code className="block break-all rounded bg-soft px-2 py-1 text-xs">{`<iframe src="${formUrl}?embed=1" style="width:100%;height:900px;border:0"></iframe>`}</code>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted">The consent wording people tick</summary>
          <p className="mt-1 text-xs text-muted">{consentText(company || c.workspace.name)}</p>
        </details>
      </Card>

      <Card title="Change log" pad={false}>
        {log.length ? (
          <ul className="divide-y divide-line">
            {log.map((l) => (
              <li key={l.id} className="px-4 py-2 text-sm">
                <span className="text-muted">{ago(l.createdAt)} · {who(l.actor)}:</span>{" "}
                {Object.entries((l.after || {}) as Record<string, unknown>)
                  .map(([k, v]) => (k === "states" ? "state exceptions changed" : `${{ aiDisclosure: "say it's an AI", recordingNotice: "recorded notice", coldOutreach: "cold outreach", ownerHours: "owner's hours" }[k] || k} ${v ? "on" : "off"}`))
                  .join(", ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted">No changes yet. Defaults: say it&apos;s an AI on, recorded notice on, owner&apos;s hours on, cold outreach off.</p>
        )}
      </Card>
      <p className="text-sm text-muted">
        Do Not Call lists and consent records: <Link href="/settings/compliance" className="underline">Do Not Call &amp; consent</Link>.
      </p>
    </div>
  );
}
