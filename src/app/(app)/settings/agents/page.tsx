import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { AGENT_ROLES } from "@/lib/agents";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";

export default async function Agents() {
  const c = await pageCtx();
  const agents = await db.agent.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="AI agents" sub="Each agent's prompt is built in 6 layers: persona, hard rules, state rules, playbook, live context and tools." />
      <Card title="How the layers work">
        <ol className="ml-4 list-decimal space-y-1 text-sm text-muted">
          <li>
            <b className="text-ink">Persona</b> — who the agent is and how it sounds (you edit).
          </li>
          <li>
            <b className="text-ink">Hard rules</b> — honesty, disclosure, opt-out, never above the max buy or below the floor (locked).
          </li>
          <li>
            <b className="text-ink">State rules</b> — from the active State Pack for that contact&apos;s property (automatic).
          </li>
          <li>
            <b className="text-ink">Playbook</b> — your scripts, questions and objection handling (you edit).
          </li>
          <li>
            <b className="text-ink">Live context</b> — what we know about this person and deal, open questions, offer authority (automatic, per call).
          </li>
          <li>
            <b className="text-ink">Tools</b> — what the agent may do: record facts, book callbacks, get offer authority, request approval… (you choose).
          </li>
        </ol>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {agents.map((a) => (
          <Link key={a.id} href={`/settings/agents/${a.id}`} className="card block p-4 hover:border-brand">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{a.name}</span>
              {a.active ? a.retellAgentId ? <span className="badge badge-good">Synced</span> : <span className="badge badge-warn">Not synced</span> : <span className="badge">Off</span>}
            </div>
            <div className="text-sm text-muted">
              {AGENT_ROLES.find((r) => r.key === a.role)?.label} · v{a.version} · {a.tools.length} tools · edited {ago(a.updatedAt)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
