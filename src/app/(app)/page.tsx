import Link from "next/link";
import { ActionButton } from "@/components/client";
import { FeeReceived } from "@/components/fee";
import { CallButton } from "@/components/phone";
import { Card, Stat } from "@/components/ui";
import { db } from "@/lib/db";
import { AUTO_TASKS } from "@/lib/engine";
import { recommendations } from "@/lib/recommend";
import { can, dealScope, pageCtx } from "@/lib/session";
import { setupSteps } from "@/lib/setup";
import { ago, fmtDate, fullName, usd } from "@/lib/util";
import { taskAction } from "../actions/ops";
import { recAction } from "../actions/recommend";

// Today: everything that needs you, in one list, each with the one button that does it.

const KIND: Record<string, string> = {
  final_offer: "Approve the final offer",
  offer_over_limit: "Seller wants more than your maximum",
  agent_request: "The AI needs your decision",
  price_below_floor: "Investor offered below your minimum",
  emd: "Place earnest money?",
  payment: "Approve a payment",
  demand_check: "Start looking for buyers?",
  full_marketing: "Market the deal to investors?",
  offer_letter: "Send the written offer?",
  contract: "Approve a contract",
};

type Item = { key: string; tone: "warn" | "good" | "hot" | ""; tag: string; title: string; why?: string; when?: string; actions: React.ReactNode };

export default async function Today() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const canDeals = can(c.role, "deals");
  const canClose = can(c.role, "closing");
  const [approvals, closings, tasks, paidMonth, pipeline, recent, deadlines, steps, recs] = await Promise.all([
    can(c.role, "approve") ? db.approval.findMany({ where: { workspaceId: ws, status: "pending" }, orderBy: { createdAt: "asc" }, take: 12 }) : Promise.resolve([]),
    canClose
      ? db.transaction.findMany({ where: { workspaceId: ws, paidAt: null, opportunity: { ...dealScope(c), stage: { in: ["CLOSING", "CLOSED"] } }, OR: [{ closingAt: { lte: new Date(Date.now() + 3 * 864e5) } }, { closingAt: null }] }, include: { opportunity: { include: { property: true } } }, take: 8 })
      : Promise.resolve([]),
    db.task.findMany({ where: { workspaceId: ws, status: "open", dueAt: { lte: endOfDay }, OR: [{ kind: { notIn: [...AUTO_TASKS] }, OR: [{ assignee: null }, { assignee: c.user.id }, { assignee: { not: { startsWith: "agent:" } } }] }, { kind: { in: [...AUTO_TASKS] }, assignee: { not: null }, NOT: { assignee: { startsWith: "agent:" } } }] }, orderBy: [{ priority: "asc" }, { dueAt: "asc" }], take: 20 }),
    db.payment.aggregate({ where: { workspaceId: ws, direction: "in", status: "received", updatedAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.opportunity.groupBy({ by: ["stage"], where: { workspaceId: ws, ...dealScope(c), OR: [{ exception: null }, { exception: { notIn: ["DECLINED", "WITHDRAWN", "CONTRACT_FAILED", "DO_NOT_CONTACT"] } }] }, _count: true }),
    db.interaction.findMany({ where: { workspaceId: ws, channel: { in: ["call", "sms", "email"] } }, include: { contact: { select: { id: true, firstName: true, lastName: true, company: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.contract.findMany({ omit: { finalPdf: true, sourcePdf: true }, where: { workspaceId: ws, status: "effective", OR: [{ emdDueAt: { gte: now, lte: new Date(Date.now() + 3 * 864e5) } }, { optionEndsAt: { gte: now, lte: new Date(Date.now() + 3 * 864e5) } }] }, take: 5 }),
    c.workspace.isDemo ? Promise.resolve([]) : setupSteps(ws, c.user.phone),
    canDeals ? recommendations(ws, { ...dealScope(c), AND: [{ stage: { in: ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY", "NEGOTIATION"] } }] }).then((r) => r.recs.filter((x) => ["sign", "negotiate", "first_offer"].includes(x.action)).slice(0, 6)) : Promise.resolve([]),
  ]);
  const contactIds = [...new Set([...tasks.map((t) => t.contactId), ...recs.map((r) => r.sellerId)].filter(Boolean) as string[])];
  const contacts = contactIds.length ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, company: true, phone: true, doNotContact: true } }) : [];
  const person = (id?: string | null) => contacts.find((x) => x.id === id);

  const items: Item[] = [];
  for (const a of approvals) {
    const d = (a.detail || {}) as { proposedPrice?: number; price?: number };
    items.push({
      key: a.id,
      tone: "warn",
      tag: "Decision",
      title: KIND[a.kind] || "Needs your decision",
      why: a.title,
      when: ago(a.createdAt),
      actions: (
        <Link href={`/approvals#${a.id}`} className="btn btn-primary w-full sm:w-auto">
          Decide{d.proposedPrice || d.price ? ` (${usd(d.proposedPrice || d.price)})` : ""}
        </Link>
      ),
    });
  }
  for (const t of closings) {
    items.push({
      key: t.id,
      tone: "good",
      tag: "Money",
      title: `Did the fee arrive for ${t.opportunity.property.address}?`,
      why: t.closingAt ? `Closing ${t.closingAt < now ? "was" : "is"} ${fmtDate(t.closingAt)}` : "Deal is closing",
      actions: <FeeReceived opportunityId={t.opportunityId} expected={t.assignmentFee} compact />,
    });
  }
  for (const r of recs) {
    const p = person(r.sellerId);
    items.push({
      key: r.key,
      tone: r.action === "sign" ? "hot" : "",
      tag: r.action === "sign" ? "Ready to sign" : r.action === "negotiate" ? "Negotiate" : "Make an offer",
      title: `${r.headline}: ${r.row.address}`,
      why: r.reasons[0],
      actions: (
        <div className="flex flex-wrap gap-2">
          {r.price && (
            <ActionButton action={recAction} hidden={{ opportunityId: r.opportunityId, key: r.key, action: r.action, price: String(r.price), do: "letter" }} className="btn btn-primary" confirm={`Email and text ${p ? fullName(p) : "the seller"} a written offer of ${usd(r.price)}?`}>
              Send offer {usd(r.price)}
            </ActionButton>
          )}
          {p && !p.doNotContact && <CallButton contactId={p.id} name={fullName(p)} phone={p.phone} opportunityId={r.opportunityId} label="Call seller" className="btn btn-ghost" />}
          <Link href={`/deals/${r.opportunityId}`} className="btn btn-ghost">
            Open
          </Link>
        </div>
      ),
    });
  }
  for (const k of deadlines) {
    const f = k.fields as Record<string, string>;
    const what = k.emdDueAt && k.emdDueAt <= new Date(Date.now() + 3 * 864e5) ? `Earnest money due ${fmtDate(k.emdDueAt)}` : `Inspection period ends ${fmtDate(k.optionEndsAt)}`;
    items.push({ key: k.id, tone: "warn", tag: "Deadline", title: `${what}: ${f.property_address || "deal"}`, actions: <Link href={k.opportunityId ? `/deals/${k.opportunityId}?tab=closing` : `/closing/documents/${k.id}`} className="btn btn-ghost">Open</Link> });
  }
  for (const t of tasks) {
    const p = person(t.contactId);
    const href = t.entityType === "opportunity" && t.entityId ? `/deals/${t.entityId}` : t.contactId ? `/contacts/${t.contactId}` : "/ops?tab=tasks";
    const isCall = ["call", "follow_up"].includes(t.kind) && p && !p.doNotContact;
    items.push({
      key: t.id,
      tone: t.priority === 1 ? "warn" : "",
      tag: t.kind === "reply_review" ? "Reply" : isCall ? "Call" : "To do",
      title: t.title,
      why: t.reason || undefined,
      when: t.dueAt < now ? `due ${ago(t.dueAt)}` : `today ${fmtDate(t.dueAt, true).split(", ").pop()}`,
      actions: (
        <div className="flex flex-wrap gap-2">
          {isCall && <CallButton contactId={p!.id} name={fullName(p!)} phone={p!.phone} opportunityId={t.entityType === "opportunity" ? t.entityId || undefined : undefined} />}
          {t.kind === "reply_review" ? (
            <Link href={href} className="btn btn-primary">
              Review reply
            </Link>
          ) : (
            !isCall && (
              <Link href={href} className="btn btn-ghost">
                Open
              </Link>
            )
          )}
          <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "done" }} className="btn btn-ghost">
            Done
          </ActionButton>
        </div>
      ),
    });
  }

  const stageCount = Object.fromEntries(pipeline.map((p) => [p.stage, p._count]));
  const funnel = [
    ["New leads", ["NEW", "ELIGIBLE", "OUTREACH"]],
    ["Talking", ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY"]],
    ["Working out the offer", ["UNDERWRITING", "OFFER_READY"]],
    ["Offer made", ["NEGOTIATION", "CONTRACT_PREPARATION"]],
    ["Under contract", ["UNDER_CONTRACT", "DISPOSITION"]],
    ["Closing", ["CLOSING"]],
    ["Closed", ["CLOSED"]],
  ] as const;
  const max = Math.max(1, ...funnel.map(([, ss]) => ss.reduce((a, s) => a + (stageCount[s] || 0), 0)));
  const callsToDo = items.filter((i) => i.tag === "Call").length;
  const next = steps.find((s) => !s.done);
  const doneSteps = steps.filter((s) => s.done).length;
  const first = c.user.name.split(" ")[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}
          {first && first !== "Demo" ? `, ${first}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted">{items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} you today.` : "Nothing needs you right now."}</p>
      </div>

      {next && (
        <Card title={`Get set up · ${doneSteps} of ${steps.length} done`}>
          <div className="mb-3 h-2 rounded-full bg-soft">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${(doneSteps / steps.length) * 100}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">Next: {next.title}</div>
              <div className="text-sm text-muted">{next.why}</div>
            </div>
            <Link href={next.href} className="btn btn-primary">
              Do it now
            </Link>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">See all steps</summary>
            <ul className="mt-2 space-y-1.5">
              {steps.map((s) => (
                <li key={s.title}>
                  <Link href={s.href} className="flex items-center gap-2 text-sm">
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-brand text-white" : "border border-line"}`}>{s.done ? "✓" : ""}</span>
                    <span className={s.done ? "text-muted line-through" : ""}>{s.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Needs you" value={items.length} tone={items.length ? "warn" : undefined} />
        <Stat label="Calls to make" value={callsToDo} href="/dialer" />
        <Stat label="Under contract" value={(stageCount.UNDER_CONTRACT || 0) + (stageCount.DISPOSITION || 0) + (stageCount.CLOSING || 0)} href="/closing" />
        <Stat label="Paid this month" value={usd(paidMonth._sum.amount || 0)} tone="good" href="/reports" />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Your to-do list</h2>
        {items.length ? (
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} className="card p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`badge ${i.tone === "warn" ? "badge-warn" : i.tone === "good" ? "badge-good" : i.tone === "hot" ? "badge-hot" : ""}`}>{i.tag}</span>
                  {i.when && <span className="text-muted">{i.when}</span>}
                </div>
                <div className="mt-1.5 font-semibold">{i.title}</div>
                {i.why && <div className="mt-0.5 text-sm text-muted">{i.why}</div>}
                <div className="mt-3">{i.actions}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-sm text-muted">All clear. New decisions, calls and offers show up here as they come in.</div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/approvals" className="text-brand">
            All decisions
          </Link>
          <Link href="/recommendations" className="text-brand">
            All AI recommendations
          </Link>
          <Link href="/ops?tab=tasks" className="text-brand">
            All tasks
          </Link>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Your deals right now">
          <div className="space-y-2.5">
            {funnel.map(([label, ss]) => {
              const n = ss.reduce((a, s) => a + (stageCount[s] || 0), 0);
              return (
                <Link key={label} href={`/deals?stage=${ss.join(",")}`} className="block">
                  <div className="flex justify-between text-sm">
                    <span>{label}</span>
                    <span className="tnum text-muted">{n}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-soft">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
        <Card title="Latest conversations" pad={false}>
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((i) => (
                <li key={i.id}>
                  <Link href={i.contactId ? `/contacts/${i.contactId}` : "/ops"} className="block px-4 py-3 text-sm hover:bg-soft">
                    <div className="flex justify-between gap-2">
                      <span className="truncate font-medium">
                        {i.channel === "call" ? "📞" : i.channel === "sms" ? "💬" : "✉️"} {i.contact ? fullName(i.contact) : i.fromAddr || "Unknown"}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{ago(i.createdAt)}</span>
                    </div>
                    <div className="line-clamp-2 text-xs text-muted">{i.summary || i.body?.slice(0, 160) || i.outcome || i.status}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">No conversations yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
