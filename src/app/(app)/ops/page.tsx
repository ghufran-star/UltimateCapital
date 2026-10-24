import Link from "next/link";
import { ActionButton, ActionForm, AutoRefresh, Submit } from "@/components/client";
import { Card, Empty, PageHeader, Stat, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { label } from "@/lib/stages";
import { ago, fmtDate } from "@/lib/util";
import { createTaskAction, taskAction } from "../../actions/ops";
import { assignTaskAction } from "../../actions/deals";
import { sendReplyAction } from "../../actions/autopilot";
import { InteractionList } from "../deals/[id]/sections";

export default async function Ops({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const tab = sp.tab || "activity";
  const dayAgo = new Date(Date.now() - 864e5);
  const [calls, texts, emails, aiOpen, humanOpen, failedEvents] = await Promise.all([
    db.interaction.count({ where: { workspaceId: ws, channel: "call", createdAt: { gte: dayAgo } } }),
    db.interaction.count({ where: { workspaceId: ws, channel: "sms", createdAt: { gte: dayAgo } } }),
    db.interaction.count({ where: { workspaceId: ws, channel: "email", createdAt: { gte: dayAgo } } }),
    db.task.count({ where: { workspaceId: ws, status: "open", assignee: { startsWith: "agent:" } } }),
    db.task.count({ where: { workspaceId: ws, status: "open", NOT: { assignee: { startsWith: "agent:" } } } }),
    db.event.count({ where: { workspaceId: ws, error: { not: null } } }),
  ]);
  const writable = true;
  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title="AI operations" sub="What the agents did, what's queued, and the full audit trail." actions={<><a href="/api/export/calls" className="btn btn-ghost">Calls CSV</a><a href="/api/export/messages" className="btn btn-ghost">Texts &amp; emails CSV</a><a href="/api/export/tasks" className="btn btn-ghost">Tasks CSV</a><a href="/api/export/audit" className="btn btn-ghost">Audit CSV</a></>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls (24h)" value={calls} />
        <Stat label="Texts (24h)" value={texts} />
        <Stat label="Emails (24h)" value={emails} />
        <Stat label="Queued tasks" value={aiOpen + humanOpen} sub={`${aiOpen} AI · ${humanOpen} team`} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "activity", label: "Activity", href: "/ops" },
          { key: "tasks", label: "Tasks", href: "/ops?tab=tasks" },
          { key: "audit", label: "Audit log", href: "/ops?tab=audit" },
          { key: "system", label: "System", href: "/ops?tab=system", count: failedEvents || undefined },
        ]}
      />
      {tab === "activity" && <Activity ws={ws} writable={writable} />}
      {tab === "tasks" && <Tasks ws={ws} who={sp.who || "all"} writable={writable} userId={c.user.id} />}
      {tab === "audit" && <Audit ws={ws} />}
      {tab === "system" && <System ws={ws} />}
    </div>
  );
}

async function Activity({ ws, writable }: { ws: string; writable: boolean }) {
  const items = await db.interaction.findMany({ where: { workspaceId: ws }, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 80 });
  return <Card pad={false}>{items.length ? <InteractionList items={items} writable={writable} /> : <Empty title="No activity yet" />}</Card>;
}

async function Tasks({ ws, who, writable, userId }: { ws: string; who: string; writable: boolean; userId: string }) {
  const tasks = await db.task.findMany({
    where: { workspaceId: ws, status: { in: ["open", "running", "failed"] }, ...(who === "ai" ? { assignee: { startsWith: "agent:" } } : who === "me" ? { assignee: userId } : who === "team" ? { NOT: { assignee: { startsWith: "agent:" } } } : {}) },
    orderBy: [{ priority: "asc" }, { dueAt: "asc" }],
    take: 200,
  });
  const contacts = await db.contact.findMany({ where: { id: { in: tasks.map((t) => t.contactId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true, company: true } });
  const members = await db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, name: true } } } });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {["all", "me", "team", "ai"].map((w) => (
          <Link key={w} href={`/ops?tab=tasks&who=${w}`} className={`rounded-full px-3 py-1 ${w === who ? "bg-ink text-bg" : "bg-soft"}`}>
            {w === "ai" ? "AI" : label(w)}
          </Link>
        ))}
      </div>
      {writable && (
        <Card>
          <ActionForm action={createTaskAction} className="flex flex-wrap gap-2" resetOnOk>
            <input name="title" className="field flex-1" placeholder="New task" />
            <input name="dueAt" type="datetime-local" className="field w-auto" />
            <select name="priority" className="field w-auto">
              <option value="2">Normal</option>
              <option value="1">High</option>
              <option value="3">Low</option>
            </select>
            <Submit className="btn btn-ghost">Add</Submit>
          </ActionForm>
        </Card>
      )}
      <Card pad={false}>
        {tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.map((t) => {
              const ct = contacts.find((x) => x.id === t.contactId);
              const href = t.entityType === "opportunity" && t.entityId ? `/deals/${t.entityId}` : t.contactId ? `/contacts/${t.contactId}` : null;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <div className={t.priority === 1 ? "font-semibold" : "font-medium"}>
                      {href ? <Link href={href} className="hover:text-brand">{t.title}</Link> : t.title}
                    </div>
                    <div className="text-xs text-muted">
                      {t.assignee?.startsWith("agent:") ? `AI ${t.assignee.slice(6).replace(/_/g, " ")}` : "Team"} · {label(t.kind)}
                      {ct ? ` · ${`${ct.firstName} ${ct.lastName}`.trim() || ct.company}` : ""} · {t.dueAt < new Date() ? `due ${ago(t.dueAt)}` : fmtDate(t.dueAt, true)}
                      {t.attempts > 0 ? ` · ${t.attempts} attempts` : ""}
                    </div>
                    {t.reason && <div className="text-xs text-muted">{t.reason}</div>}
                    {t.kind === "reply_review" && t.status === "open" && writable && (
                      <ActionForm action={sendReplyAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="taskId" value={t.id} />
                        <textarea name="text" rows={2} defaultValue={String(((t.payload || {}) as { text?: string }).text || "")} className="field min-w-64 flex-1" />
                        <Submit className="btn btn-primary btn-sm">Send</Submit>
                      </ActionForm>
                    )}
                    {t.result && <div className="text-xs text-warn">{t.result}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge s={t.status} />
                    {writable && (
                      <>
                        <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "run" }}>
                          Run now
                        </ActionButton>
                        <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "done" }}>
                          Done
                        </ActionButton>
                        <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "cancel" }}>
                          ✕
                        </ActionButton>
                        <ActionForm action={assignTaskAction} className="flex items-center gap-1">
                          <input type="hidden" name="taskId" value={t.id} />
                          <select name="assignee" defaultValue={t.assignee ?? ""} className="rounded-md border border-line bg-card px-1 py-1 text-xs">
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {m.user.name}
                              </option>
                            ))}
                            {["seller_acquisition", "property_discovery", "negotiation", "buyer_acquisition", "disposition", "transaction"].map((r) => (
                              <option key={r} value={`agent:${r}`}>
                                AI: {r.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                          <Submit className="btn btn-ghost btn-sm">Assign</Submit>
                        </ActionForm>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No open tasks" />
        )}
      </Card>
    </div>
  );
}

async function Audit({ ws }: { ws: string }) {
  const rows = await db.auditEvent.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 150 });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actor))] } }, select: { id: true, name: true } });
  const who = (a: string) => users.find((u) => u.id === a)?.name || (a.startsWith("agent:") ? `AI ${a.slice(6)}` : a.startsWith("signer:") ? "Signer" : label(a));
  return (
    <Card pad={false}>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.createdAt, true)}</td>
                <td className="text-sm">{who(r.actor)}</td>
                <td className="text-sm">
                  {label(r.action)}
                  {r.entityType === "opportunity" && r.entityId && (
                    <Link href={`/deals/${r.entityId}`} className="ml-1 text-xs text-brand">
                      deal
                    </Link>
                  )}
                </td>
                <td className="max-w-md text-xs text-muted">
                  <span className="line-clamp-2 break-all">{JSON.stringify(r.after || r.meta || "") === '""' ? "" : JSON.stringify(r.after || r.meta)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function System({ ws }: { ws: string }) {
  const [errors, pending] = await Promise.all([db.event.findMany({ where: { workspaceId: ws, error: { not: null } }, orderBy: { createdAt: "desc" }, take: 50 }), db.event.count({ where: { workspaceId: ws, handledAt: null } })]);
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm">
          {pending} event{pending === 1 ? "" : "s"} waiting to be processed. The background worker runs every few seconds.
        </p>
      </Card>
      <Card title="Errors" pad={false}>
        {errors.length ? (
          <ul className="divide-y divide-line">
            {errors.map((e) => (
              <li key={e.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{e.type}</span> <span className="text-xs text-muted">{fmtDate(e.createdAt, true)}</span>
                <div className="text-xs text-bad">{e.error}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No errors" />
        )}
      </Card>
    </div>
  );
}
