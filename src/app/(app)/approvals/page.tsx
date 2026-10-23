import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Card, Empty, KV, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import type { Calculation } from "@/lib/rules";
import { can, pageCtx } from "@/lib/session";
import { ago, usd } from "@/lib/util";
import { priceImpact } from "@/lib/deals";
import { decideApprovalAction } from "../../actions/ops";

const KIND_HELP: Record<string, string> = {
  final_offer: "Approve the final offer to the seller. After approval the contract can be prepared and sent.",
  emd: "Two or more serious investors want this deal. Approve placing earnest money with title.",
  payment: "Approve an outgoing payment. Wire instructions must be verified by phone before paying.",
  offer_over_limit: "The agent was asked to go above its authority. Enter a price to authorise it.",
  agent_request: "An agent asked for a decision it isn't allowed to make.",
  price_below_floor: "A buyer offered below the floor price.",
};

export default async function Approvals({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const c = await pageCtx();
  const tab = (await searchParams).tab || "pending";
  const list = await db.approval.findMany({ where: { workspaceId: c.workspace.id, status: tab === "pending" ? "pending" : { not: "pending" } }, orderBy: { createdAt: tab === "pending" ? "asc" : "desc" }, take: 100 });
  const oppIds = list.filter((a) => a.entityType === "opportunity").map((a) => a.entityId);
  const opps = await db.opportunity.findMany({ where: { id: { in: oppIds } }, include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, interests: { where: { serious: true }, include: { contact: true } } } });
  const users = await db.user.findMany({ where: { memberships: { some: { workspaceId: c.workspace.id } } }, select: { id: true, name: true } });
  const uname = (id?: string | null) => users.find((u) => u.id === id)?.name || id || "";
  const canApprove = can(c.role, "approve") && !c.workspace.isDemo;
  const impacts: Record<string, Awaited<ReturnType<typeof priceImpact>>> = {};
  for (const a of list.filter((x) => x.status === "pending" && x.entityType === "opportunity")) {
    const d = (a.detail || {}) as Record<string, unknown>;
    const p = Number(d.proposedPrice || d.price || 0);
    if (p) impacts[a.id] = await priceImpact(c.workspace.id, a.entityId, p).catch(() => null);
  }
  const pendingCount = await db.approval.count({ where: { workspaceId: c.workspace.id, status: "pending" } });

  return (
    <div>
      <PageHeader title="Approvals" sub="Nothing binding happens without you: final offers, earnest money, payments and anything over the rules." />
      <Tabs active={tab} tabs={[{ key: "pending", label: "Waiting", href: "/approvals", count: pendingCount }, { key: "done", label: "Decided", href: "/approvals?tab=done" }]} />
      {!list.length && (
        <Card>
          <Empty title={tab === "pending" ? "Nothing waiting for you" : "No decisions yet"} />
        </Card>
      )}
      <div className="space-y-4">
        {list.map((a) => {
          const d = (a.detail || {}) as Record<string, unknown>;
          const opp = opps.find((o) => o.id === a.entityId);
          const calc = opp?.valuations[0]?.result as unknown as Calculation | undefined;
          return (
            <section key={a.id} id={a.id} className="card scroll-mt-20">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div>
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-xs text-muted">
                    {a.kind.replace(/_/g, " ")} · requested by {a.requestedBy.startsWith("agent:") ? `AI (${a.requestedBy.slice(6).replace(/_/g, " ")})` : uname(a.requestedBy)} · {ago(a.createdAt)}
                  </div>
                </div>
                <StatusBadge s={a.status} />
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="space-y-3 text-sm">
                  {KIND_HELP[a.kind] && <p className="text-muted">{KIND_HELP[a.kind]}</p>}
                  {opp && (
                    <KV
                      items={[
                        ["Property", <Link key="p" href={`/deals/${opp.id}`} className="text-brand underline">{`${opp.property.address}, ${opp.property.city} ${opp.property.state}`}</Link>],
                        ["Seller's lowest", usd(opp.sellerLowest)],
                        ["Max buy (rules)", calc ? usd(calc.maxBuy) : "—"],
                        ["ARV / repairs", calc ? `${usd(calc.arv)} / ${usd(calc.repairs)}` : "—"],
                        ["Buyer prices", calc ? calc.buyerRounds.map(usd).join(" → ") : "—"],
                        ["Investor max", calc ? usd(calc.investorMaxPrice) : "—"],
                        ["Serious buyers", opp.interests.length ? opp.interests.map((i) => `${i.contact.firstName} ${i.contact.lastName}`.trim() || i.contact.company).join(", ") : "none yet"],
                      ]}
                    />
                  )}
                  {Object.keys(d).length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">Details</summary>
                      <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-soft p-2 text-xs whitespace-pre-wrap">{JSON.stringify(d, null, 2)}</pre>
                    </details>
                  )}
                  {a.status !== "pending" && (
                    <p className="text-xs text-muted">
                      {a.status} by {uname(a.decidedBy)} {ago(a.decidedAt)}
                      {a.note ? ` · “${a.note}”` : ""}
                    </p>
                  )}
                </div>
                {a.status === "pending" &&
                  (canApprove ? (
                    <div className="space-y-3">
                      <ActionForm action={decideApprovalAction}>
                        <input type="hidden" name="approvalId" value={a.id} />
                        <input type="hidden" name="decision" value="approved" />
                        {["final_offer", "offer_over_limit", "agent_request", "price_below_floor"].includes(a.kind) && (
                          <label className="block space-y-1 text-sm">
                            <span className="font-medium">Approved price</span>
                            <input name="price" className="field tnum" inputMode="numeric" defaultValue={Number(d.proposedPrice || d.price || opp?.sellerLowest || calc?.maxBuy || 0) || ""} />
                          </label>
                        )}
                        {impacts[a.id] && <p className={`text-xs ${impacts[a.id]!.over > 0 ? "text-bad" : "text-muted"}`}>{impacts[a.id]!.text}</p>}
                        {["final_offer", "offer_over_limit", "agent_request", "price_below_floor"].includes(a.kind) && (
                          <label className="flex items-start gap-2 text-xs text-muted">
                            <input type="checkbox" name="overLock" className="mt-0.5" /> Approve above the max buy if the price is over it (only needed when it is)
                          </label>
                        )}
                        <input name="note" className="field" placeholder="Note (optional)" />
                        <Submit>Approve</Submit>
                      </ActionForm>
                      <ActionForm action={decideApprovalAction}>
                        <input type="hidden" name="approvalId" value={a.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <input name="note" className="field" placeholder="Why not? (optional)" />
                        <Submit className="btn btn-ghost">Reject</Submit>
                      </ActionForm>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{c.workspace.isDemo ? "Demo workspace: view only." : "Only owners and admins can decide."}</p>
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
