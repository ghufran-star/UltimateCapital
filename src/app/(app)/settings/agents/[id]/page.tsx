import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { canonicalRole, HARD_RULES, ROLE_TOOLS, roleLabel, TOOL_DEFS } from "@/lib/agents";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { restoreAgentAction, saveAgentAction, syncAgentAction, testAgentAction } from "../../../../actions/settings";
import { ago } from "@/lib/util";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const a = await db.agent.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!a) notFound();
  const ro = !can(c.role, "settings");
  const allowed = ROLE_TOOLS[canonicalRole(a.role)] || Object.keys(TOOL_DEFS);
  const [versions, sample] = await Promise.all([
    db.agentVersion.findMany({ where: { agentId: a.id }, orderBy: { version: "desc" }, take: 15 }),
    db.contact.findMany({ where: { workspaceId: c.workspace.id, kind: canonicalRole(a.role) === "buyer_acquisition" ? "buyer" : "seller" }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, firstName: true, lastName: true, company: true } }),
  ]);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        back={{ href: "/settings/agents", label: "AI agents" }}
        title={a.name}
        sub={`${roleLabel(a.role)} · v${a.version}${a.retellAgentId ? ` · Retell ${a.retellAgentId}` : " · not synced"}`}
        actions={!ro ? <ActionButton action={syncAgentAction} hidden={{ agentId: a.id }} className="btn btn-ghost">Sync to Retell</ActionButton> : null}
      />
      <ActionForm action={saveAgentAction} className="space-y-5">
        <input type="hidden" name="agentId" value={a.id} />
        <Card title="1 · Persona">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <input name="name" defaultValue={a.name} className="field" />
            </Field>
            <Field label="Retell voice ID" hint="e.g. 11labs-Adrian. Blank = Retell default.">
              <input name="voiceId" defaultValue={a.voiceId ?? ""} className="field" />
            </Field>
          </div>
          <textarea name="persona" defaultValue={a.persona} rows={6} className="field mt-3 font-mono text-xs" />
        </Card>
        <Card title="2 · Hard rules (locked)">
          <pre className="max-h-60 overflow-auto rounded-lg bg-soft p-3 text-xs whitespace-pre-wrap">{HARD_RULES}</pre>
        </Card>
        <Card title="3 · State rules (automatic)">
          <p className="text-sm text-muted">Filled per call from the active State Pack: calling hours, disclosure wording, what may be said before a contract, assignment rules.</p>
        </Card>
        <Card title="4 · Playbook">
          <textarea name="playbook" defaultValue={a.playbook} rows={16} className="field font-mono text-xs" />
        </Card>
        <Card title="5 · Live context (automatic)">
          <p className="text-sm text-muted">Each call receives: the person&apos;s summary and known facts (so the agent doesn&apos;t re-ask), open questions, deal details, and for buyers their buy box. Prices are never in the prompt: the agent asks for offer authority through a tool, one step at a time.</p>
        </Card>
        <Card title="6 · Tools">
          <div className="space-y-2">
            {allowed.map((t) => (
              <label key={t} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="tools" value={t} defaultChecked={a.tools.includes(t)} className="mt-1" />
                <span>
                  <code className="text-xs">{t}</code>
                  <span className="block text-xs text-muted">{TOOL_DEFS[t]?.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
        {!ro && (
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={a.active} /> Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sync" defaultChecked /> Sync to Retell after saving
              </label>
              <Submit>Save agent</Submit>
            </div>
          </Card>
        )}
            </ActionForm>
      {!ro && (
        <Card title="Hear it: test call to your phone">
          <ActionForm action={testAgentAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="agentId" value={a.id} />
            <select name="contactId" className="field w-auto">
              <option value="">Sample context</option>
              {sample.map((x) => (
                <option key={x.id} value={x.id}>
                  As if calling {`${x.firstName} ${x.lastName}`.trim() || x.company}
                </option>
              ))}
            </select>
            <Submit className="btn btn-ghost">Call me</Submit>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">The agent rings your mobile with that person&apos;s real context, so you hear exactly what they would. Nothing is sent to the contact.</p>
        </Card>
      )}
      <Card title="Version history" pad={false}>
        {versions.length ? (
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li key={v.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    v{v.version} <span className="text-xs text-muted">· saved {ago(v.createdAt)}</span>
                  </span>
                  {!ro && (
                    <ActionButton action={restoreAgentAction} hidden={{ versionId: v.id }} confirm={`Restore v${v.version}? The current version is kept in history.`}>
                      Restore
                    </ActionButton>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-muted">Show</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-soft p-2 text-xs whitespace-pre-wrap">{`${v.persona}\n\nPLAYBOOK\n${v.playbook}\n\nTOOLS: ${v.tools.join(", ")}`}</pre>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">Each save keeps the previous version here.</p>
        )}
      </Card>
    </div>
  );
}
