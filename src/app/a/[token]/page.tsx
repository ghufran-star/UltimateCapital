import { ActionForm, Submit } from "@/components/client";
import { approvalByToken } from "@/lib/controls";
import { db } from "@/lib/db";
import { priceImpact } from "@/lib/deals";
import { ago, usd } from "@/lib/util";
import { linkDecisionAction } from "../../actions/controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Decide", robots: { index: false } };

export default async function DecideByLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await approvalByToken(token);
  if (!r) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-muted">It was already used, or it's more than 3 days old. Open the app to decide.</p>
      </main>
    );
  }
  const ap = r.approval;
  const d = (ap.detail || {}) as Record<string, unknown>;
  const opp = ap.entityType === "opportunity" ? await db.opportunity.findUnique({ where: { id: ap.entityId }, include: { property: true } }) : null;
  const proposed = Number(d.proposedPrice || d.price || 0) || null;
  const impact = opp && proposed && ap.requestedBy !== "agent:disposition" && ["final_offer", "offer_over_limit", "agent_request"].includes(ap.kind) ? await priceImpact(ap.workspaceId, opp.id, proposed).catch(() => null) : null;
  const priced = ["final_offer", "offer_over_limit", "agent_request", "price_below_floor"].includes(ap.kind);
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-8">
      <div>
        <div className="text-sm text-muted">Approval · {ago(ap.createdAt)}</div>
        <h1 className="text-xl font-semibold">{ap.title}</h1>
        {opp && (
          <p className="text-sm text-muted">
            {opp.property.address}, {opp.property.city} {opp.property.state} · seller&apos;s lowest {usd(opp.sellerLowest)}
          </p>
        )}
      </div>
      {typeof d.pack === "string" && <pre className="card max-h-80 overflow-auto p-3 text-xs whitespace-pre-wrap">{d.pack}</pre>}
      {impact && <p className={`text-sm ${impact.over > 0 ? "text-bad" : "text-muted"}`}>{impact.text}</p>}
      {ap.status !== "pending" ? (
        <p className="card p-4">Already {ap.status}.</p>
      ) : (
        <div className="card space-y-3 p-4">
          <ActionForm action={linkDecisionAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decision" value="approved" />
            {priced && (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Approved price</span>
                <input name="price" className="field tnum" inputMode="numeric" defaultValue={proposed ?? ""} />
              </label>
            )}
            {impact && impact.over > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="overLock" className="mt-1" /> Approve above the max buy
              </label>
            )}
            <Submit className="btn btn-primary w-full">Approve</Submit>
          </ActionForm>
          <ActionForm action={linkDecisionAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decision" value="rejected" />
            <input name="note" className="field" placeholder="Why not? (optional)" />
            <Submit className="btn btn-ghost w-full">Reject</Submit>
          </ActionForm>
        </div>
      )}
    </main>
  );
}
