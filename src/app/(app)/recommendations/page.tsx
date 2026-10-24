import Link from "next/link";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Empty, PageHeader, Stat, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { bestInvestors, liftLabel, recommendations, syncOutcomes, track, type Rec } from "@/lib/recommend";
import { can, dealScope, pageCtx } from "@/lib/session";
import { usd } from "@/lib/util";
import { aiOpinionAction, recAction } from "../../actions/recommend";

type SP = { tab?: string; mine?: string };

const TONE: Record<string, string> = { sign: "badge-good", negotiate: "badge-warn", first_offer: "", pass: "badge-bad", value: "", push_buyers: "badge-hot" };
const VERB: Record<string, string> = { sign: "Sign", negotiate: "Negotiate", first_offer: "First offer", pass: "Pass", value: "Value", push_buyers: "Find a buyer" };

export default async function Recommendations({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const tab = ["decide", "hot", "investors", "learned"].includes(sp.tab || "") ? sp.tab! : "decide";
  await syncOutcomes(ws);
  const scope = { ...dealScope(c), ...(sp.mine ? { assigneeId: c.user.id } : {}) };
  const [{ recs, hot, learned }, tr] = await Promise.all([recommendations(ws, scope), track(ws)]);
  const writable = can(c.role, "deals");
  const ai = await db.recommendation.findMany({ where: { workspaceId: ws, source: "ai", opportunityId: { in: recs.map((r) => r.opportunityId) } }, orderBy: { createdAt: "desc" } });
  const pushIds = recs.filter((r) => r.action === "push_buyers" || r.action === "sign" || r.action === "negotiate").map((r) => r.opportunityId);
  const topHot = hot.slice(0, 25);
  const investorDeals = tab === "investors" ? [...new Set([...pushIds, ...topHot.slice(0, 10).map((h) => h.opportunityId)])].slice(0, 20) : pushIds.slice(0, 30);
  const investors = await bestInvestors(ws, investorDeals);
  const counts = { sign: recs.filter((r) => r.action === "sign").length, negotiate: recs.filter((r) => r.action === "negotiate").length, pass: recs.filter((r) => r.action === "pass").length };
  const q = (t: string) => `/recommendations?tab=${t}${sp.mine ? "&mine=1" : ""}`;
  const rate = (x: { finished: number; won: number }) => (x.finished ? `${Math.round((x.won / x.finished) * 100)}% closed` : "no finished deals yet");
  return (
    <div>
      <PageHeader
        title="AI recommendations"
        sub="What to do next on every deal, worked out from your numbers, your rules and what has closed for you before. The AI second opinion only runs when you press it."
        actions={
          <Link href={sp.mine ? `/recommendations?tab=${tab}` : `/recommendations?tab=${tab}&mine=1`} className="btn btn-ghost">
            {sp.mine ? "Show everyone's deals" : "Only my deals"}
          </Link>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ready to sign" value={counts.sign} tone={counts.sign ? "good" : undefined} href={q("decide")} />
        <Stat label="Worth negotiating" value={counts.negotiate} tone={counts.negotiate ? "warn" : undefined} href={q("decide")} />
        <Stat label="Pass for now" value={counts.pass} href={q("decide")} />
        <Stat label="Learned from" value={`${learned.finished} deals`} sub={learned.finished ? `${learned.won} closed (${Math.round(learned.base * 100)}%)` : "closes and losses teach it"} href={q("learned")} />
        <Stat label="Recommendations followed" value={tr.followed.n} sub={rate(tr.followed)} href={q("learned")} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "decide", label: "Decide now", href: q("decide"), count: recs.length },
          { key: "hot", label: "Most likely to close", href: q("hot") },
          { key: "investors", label: "Best-fit investors", href: q("investors") },
          { key: "learned", label: "What it learned", href: q("learned") },
        ]}
      />

      {tab === "decide" &&
        (recs.length ? (
          <div className="space-y-3">
            {recs.slice(0, 60).map((r) => (
              <RecCard key={r.key} r={r} writable={writable} ai={ai.find((a) => a.opportunityId === r.opportunityId)} investors={investors.get(r.opportunityId) || []} />
            ))}
            {recs.length > 60 && <p className="text-center text-sm text-muted">Showing the 60 most urgent of {recs.length}.</p>}
          </div>
        ) : (
          <Empty title="Nothing to decide right now">New recommendations appear as sellers give numbers, valuations finish and investors respond.</Empty>
        ))}

      {tab === "hot" && (
        <Card pad={false}>
          {topHot.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th className="text-right">Likelihood</th>
                    <th>Why</th>
                    <th className="text-right">Max buy</th>
                    <th className="text-right">Seller</th>
                    <th className="text-right">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {topHot.map((h) => (
                    <tr key={h.opportunityId}>
                      <td>
                        <Link href={`/deals/${h.opportunityId}`} className="font-medium hover:text-brand">
                          {h.row.address}
                        </Link>
                        <div className="text-xs text-muted">
                          {h.row.place} · {h.row.stage}
                        </div>
                      </td>
                      <td className="text-right">
                        <span className={`badge ${h.score >= 70 ? "badge-hot" : h.score >= 45 ? "badge-good" : ""}`}>{h.score}</span>
                      </td>
                      <td className="max-w-md text-xs">{h.reasons.join(" · ") || "—"}</td>
                      <td className="text-right tnum">{usd(h.row.maxBuy)}</td>
                      <td className="text-right tnum">{usd(h.row.lowest ?? h.row.asking)}</td>
                      <td className="text-right tnum">{usd(h.row.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No open deals" />
          )}
        </Card>
      )}

      {tab === "investors" && (
        <div className="space-y-3">
          {investorDeals.length ? (
            investorDeals.map((id) => {
              const list = investors.get(id) || [];
              const row = recs.find((r) => r.opportunityId === id)?.row || hot.find((h) => h.opportunityId === id)?.row;
              if (!row) return null;
              return (
                <Card key={id} title={<Link href={`/deals/${id}?tab=buyers`}>{row.address}</Link>} actions={<span className="text-xs text-muted">{row.stage}</span>}>
                  <InvestorPicker opportunityId={id} list={list} writable={writable} />
                </Card>
              );
            })
          ) : (
            <Empty title="No deals need investors right now" />
          )}
        </div>
      )}

      {tab === "learned" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="What closes for you">
            {learned.finished < 5 ? (
              <p className="text-sm text-muted">After a few deals close or fall through, this shows which lead sources, situations, property types, states and price gaps close more often for you, and the likelihood scores use it. So far: {learned.finished} finished deal(s).</p>
            ) : (
              <div className="overflow-x-auto"><table className="data">
                <thead>
                  <tr>
                    <th>Kind of deal</th>
                    <th className="text-right">Finished</th>
                    <th className="text-right">Closed</th>
                    <th className="text-right">vs your average</th>
                  </tr>
                </thead>
                <tbody>
                  {learned.lifts
                    .filter((l) => l.n >= 3)
                    .sort((a, b) => b.lift - a.lift)
                    .slice(0, 30)
                    .map((l) => (
                      <tr key={`${l.feature}:${l.value}`}>
                        <td className="text-sm">
                          {liftLabel(l)} <span className="text-xs text-muted">({l.feature})</span>
                        </td>
                        <td className="text-right tnum">{l.n}</td>
                        <td className="text-right tnum">{l.won}</td>
                        <td className={`text-right tnum ${l.lift >= 1.2 ? "text-brand" : l.lift <= 0.8 ? "text-bad" : ""}`}>{l.lift.toFixed(1)}×</td>
                      </tr>
                    ))}
                </tbody>
              </table></div>
            )}
          </Card>
          <Card title="How the recommendations have done">
            <ul className="space-y-2 text-sm">
              <li>
                <span className="font-medium">Followed</span> (signed, negotiated, offered): {tr.followed.n} · {rate(tr.followed)}
              </li>
              <li>
                <span className="font-medium">Passed on</span>: {tr.passed.n} · {tr.passed.finished ? `${tr.passed.won} closed later anyway` : "none finished yet"}
              </li>
              <li>
                <span className="font-medium">Dismissed</span>: {tr.dismissed.n} · {rate(tr.dismissed)}
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted">Each time a deal closes or falls through, the recommendations made on it are marked won or lost, and the likelihood scores re-weight toward what actually closes for you.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

function RecCard({ r, writable, ai, investors }: { r: Rec; writable: boolean; ai?: { action: string; price: number | null; reasons: string[]; createdAt: Date }; investors: { contactId: string; name: string; score: number; why: string[] }[] }) {
  const hidden = { opportunityId: r.opportunityId, key: r.key, action: r.action, price: String(r.price ?? "") };
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${TONE[r.action] || ""}`}>{VERB[r.action]}</span>
            <span className="font-semibold">{r.headline}</span>
          </div>
          <Link href={`/deals/${r.opportunityId}`} className="mt-1 block text-sm hover:text-brand">
            {r.row.address} <span className="text-muted">· {r.row.place} · {r.row.stage}</span>
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Chip l="Max buy" v={usd(r.row.maxBuy)} />
          <Chip l="Seller" v={usd(r.row.lowest ?? r.row.asking)} />
          <Chip l="Gap" v={r.row.gapSeller === null ? "—" : `${r.row.gapSeller > 0 ? "+" : ""}${usd(r.row.gapSeller)}`} />
          <Chip l="Fee" v={usd(r.row.fee)} />
          <Chip l="Serious" v={String(r.row.serious)} />
        </div>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
        {r.reasons.slice(0, 5).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      {ai && (
        <div className="mt-2 rounded-lg bg-soft px-3 py-2 text-xs">
          <span className="font-semibold">AI second opinion:</span> {ai.action}
          {ai.price ? ` at ${usd(ai.price)}` : ""} · {ai.reasons.slice(0, 4).join(" · ")}
        </div>
      )}
      {r.action === "push_buyers" && <InvestorPicker opportunityId={r.opportunityId} list={investors} writable={writable} rkey={r.key} />}
      {writable && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(r.action === "sign" || r.action === "negotiate" || r.action === "first_offer") && r.price && (
            <ActionButton action={recAction} hidden={{ ...hidden, do: "letter" }} className="btn btn-primary btn-sm" confirm={`Email and text the seller a written offer of ${usd(r.price)}?`}>
              Send offer letter at {usd(r.price)}
            </ActionButton>
          )}
          {(r.action === "negotiate" || r.action === "first_offer" || r.action === "sign") && (
            <ActionButton action={recAction} hidden={{ ...hidden, do: "call" }}>
              {r.action === "sign" ? "Book a call to confirm" : "Book negotiation call"}
            </ActionButton>
          )}
          {r.action === "sign" && (
            <Link href={`/deals/${r.opportunityId}?tab=contracts`} className="btn btn-ghost btn-sm">
              Prepare contract
            </Link>
          )}
          {r.action === "pass" && (
            <ActionButton action={recAction} hidden={{ ...hidden, do: "pass" }} confirm="Park this deal: automation off and a reminder in 30 days?">
              Park it for 30 days
            </ActionButton>
          )}
          {r.action === "value" && (
            <ActionButton action={recAction} hidden={{ ...hidden, do: "value" }}>
              Value it now
            </ActionButton>
          )}
          {r.action !== "value" && r.action !== "push_buyers" && (
            <ActionButton action={aiOpinionAction} hidden={{ opportunityId: r.opportunityId }} className="btn btn-ghost btn-sm" confirm="Ask Claude for a second opinion on this deal? (uses your Claude key)">
              Ask AI
            </ActionButton>
          )}
          <ActionButton action={recAction} hidden={{ ...hidden, do: "dismiss" }} className="btn btn-ghost btn-sm text-muted">
            Dismiss
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function InvestorPicker({ opportunityId, list, writable, rkey }: { opportunityId: string; list: { contactId: string; name: string; score: number; why: string[] }[]; writable: boolean; rkey?: string }) {
  if (!list.length) return <p className="mt-2 text-sm text-muted">No matched investors yet. Run matching from the deal&apos;s Buyers tab or add investors.</p>;
  return (
    <ActionForm action={recAction} className="mt-2 space-y-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="key" value={rkey || `${opportunityId}:pitch:`} />
      <input type="hidden" name="action" value="push_buyers" />
      <input type="hidden" name="do" value="pitch" />
      <ul className="divide-y divide-line rounded-xl border border-line">
        {list.map((i, n) => (
          <li key={i.contactId} className="flex items-center gap-3 px-3 py-2 text-sm">
            {writable && <input type="checkbox" name="ids" value={i.contactId} defaultChecked={n < 3} />}
            <Link href={`/contacts/${i.contactId}`} className="font-medium hover:text-brand">
              {i.name}
            </Link>
            <span className="text-xs text-muted">{i.why.join(" · ")}</span>
            <span className="ml-auto text-xs tnum text-muted">{i.score}</span>
          </li>
        ))}
      </ul>
      {writable && <Submit className="btn btn-ghost btn-sm">Pitch the ticked investors</Submit>}
    </ActionForm>
  );
}

function Chip({ l, v }: { l: string; v: string }) {
  return (
    <span className="rounded-lg bg-soft px-2 py-1">
      <span className="text-muted">{l}</span> <span className="font-medium tnum">{v}</span>
    </span>
  );
}
