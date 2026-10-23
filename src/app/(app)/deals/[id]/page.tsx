import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, HotBadge, KV, Notice, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { activePack } from "@/lib/eligibility";
import { nearAgreement, resolveParams, type Calculation } from "@/lib/rules";
import { can, dealScope, pageCtx } from "@/lib/session";
import { SELLER_EXCEPTIONS, SELLER_STAGES, label } from "@/lib/stages";
import { ago, fmtDate, fullName, usd } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";
import { verificationPackAction } from "../../../actions/ops";
import { callContactAction, recordOfferAction, textContactAction, updateDealAction } from "../../../actions/records";
import { dealInclude } from "./include";
import { FilesPanel } from "@/components/files";
import { photoRepairsAction } from "../../../actions/files";
import { buyerLadder, contractBasis } from "@/lib/deals";
import { ActivityTab, BuyersTab, ClosingTab, ContractsTab, NumbersTab } from "./sections";

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const tab = (await searchParams).tab || "overview";
  const ws = c.workspace.id;
  const opp = await db.opportunity.findFirst({
    where: { id, workspaceId: ws, ...dealScope(c) },
    include: dealInclude,
  });
  if (!opp) notFound();
  const v = opp.valuations[0];
  const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
  const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
  const rs = await activeRuleSet(ws);
  const { params: rp } = resolveParams(rs.data, { state: opp.property.state, market: opp.property.city, zip: opp.property.zip, propertyType: opp.property.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: opp.property.conditionTier, occupancy: opp.property.occupancy, titleFlags: opp.property.titleFlags, arv: calc?.arv });
  const near = calc ? nearAgreement(opp.sellerLowest, calc.maxBuy, rp) : false;
  const ladder = calc ? buyerLadder(contractBasis(opp, calc), calc, rp) : null;
  const pack = await activePack(ws, opp.property.state);
  const pendingApprovals = await db.approval.findMany({ where: { workspaceId: ws, entityId: opp.id, status: "pending" } });
  const writable = !c.workspace.isDemo && can(c.role, "deals");
  const sellerOffers = opp.offers.filter((o) => o.side === "seller");
  const counts = { buyers: opp.interests.length, contracts: opp.contracts.length };

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "numbers", label: "Numbers" },
    { key: "buyers", label: "Buyers", count: counts.buyers },
    { key: "contracts", label: "Contracts", count: counts.contracts },
    { key: "closing", label: "Closing" },
    { key: "files", label: "Files" },
    { key: "activity", label: "Activity" },
  ].map((t) => ({ ...t, href: `/deals/${opp.id}?tab=${t.key}` }));

  return (
    <div>
      <PageHeader
        back={{ href: "/deals", label: "Deals" }}
        title={opp.property.address}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {opp.property.city}, {opp.property.state} {opp.property.zip}
            <StatusBadge s={opp.stage} />
            {opp.exception && <StatusBadge s={opp.exception} />}
            <HotBadge score={opp.hotScore} />
            {!pack && <span className="badge badge-bad">{opp.property.state} pack not active</span>}
          </span>
        }
      />
      {pendingApprovals.length > 0 && (
        <div className="mb-4">
          <Notice>
            {pendingApprovals.length} decision{pendingApprovals.length > 1 ? "s" : ""} waiting: {pendingApprovals.map((a) => a.title).join(" · ")}.{" "}
            <Link href="/approvals" className="font-semibold underline">
              Decide
            </Link>
          </Notice>
        </div>
      )}
      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Negotiation">
              {calc ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Mini label="1st offer" value={usd(calc.sellerOffers[0])} />
                    <Mini label="2nd offer" value={usd(calc.sellerOffers[1] ?? calc.maxBuy)} />
                    <Mini label="Max buy (locked)" value={usd(calc.maxBuy)} strong />
                    <Mini label="Seller's lowest" value={usd(opp.sellerLowest)} tone={near ? "good" : undefined} />
                  </div>
                  <div className="text-sm">
                    {opp.approvedAt ? (
                      <Notice tone="good">Final offer approved {ago(opp.approvedAt)} at {usd(opp.contractPrice)}. Prepare the contract on the Contracts tab.</Notice>
                    ) : near ? (
                      <Notice tone="good">
                        Near agreement: the gap to the seller is within your rule ({usd(rp.approvals.nearAgreementGapAmt)} or {Math.round(rp.approvals.nearAgreementGapPct * 100)}%).{" "}
                        {opp.verificationSentAt ? `Verification pack sent ${ago(opp.verificationSentAt)}; anonymous buyer check running.` : "A verification pack goes to you and the anonymous buyer check starts automatically."}
                      </Notice>
                    ) : opp.sellerLowest && opp.sellerLowest > calc.maxBuy ? (
                      <Notice>Seller is {usd(opp.sellerLowest - calc.maxBuy)} above the max buy. The AI cannot go higher without your approval.</Notice>
                    ) : null}
                  </div>
                  {sellerOffers.length > 0 && (
                    <table className="data">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Who</th>
                          <th className="text-right">Price</th>
                          <th>Authority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellerOffers.map((o) => (
                          <tr key={o.id}>
                            <td className="text-xs text-muted">{fmtDate(o.createdAt, true)}</td>
                            <td>{o.by === "us" ? "Our offer" : "Seller"}</td>
                            <td className="text-right tnum">{usd(o.price)}</td>
                            <td className="text-xs">{o.authority || o.response || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {writable && (
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={recordOfferAction} className="flex flex-wrap items-end gap-2" resetOnOk>
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="side" value="seller" />
                        <select name="by" className="field w-auto">
                          <option value="them">Seller asked</option>
                          <option value="us">We offered</option>
                        </select>
                        <input name="price" className="field w-36 tnum" placeholder="Price" inputMode="numeric" />
                        <Submit className="btn btn-ghost">Record</Submit>
                      </ActionForm>
                      {!opp.approvedAt && <ActionButton action={verificationPackAction} hidden={{ opportunityId: opp.id }} className="btn btn-ghost">Send verification pack</ActionButton>}
                    </div>
                  )}
                </div>
              ) : (
                <Notice tone={v?.blocked ? "warn" : "info"}>
                  {v?.blocked ? `Valuation blocked: ${v.blocked}` : "No valuation yet."} Fill in the property on the <Link href={`/deals/${opp.id}?tab=numbers`} className="underline">Numbers</Link> tab.
                </Notice>
              )}
            </Card>

            <Card title="Deal details">
              <ActionForm action={updateDealAction}>
                <input type="hidden" name="opportunityId" value={opp.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <L label="Stage">
                    <select name="stage" defaultValue={opp.stage} className="field" disabled={!writable}>
                      {SELLER_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L label="Exception">
                    <select name="exception" defaultValue={opp.exception || ""} className="field" disabled={!writable}>
                      <option value="">None</option>
                      {SELLER_EXCEPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L label="Asking price">
                    <input name="askingPrice" defaultValue={opp.askingPrice ?? ""} className="field tnum" inputMode="numeric" />
                  </L>
                  <L label="Seller's lowest">
                    <input name="sellerLowest" defaultValue={opp.sellerLowest ?? ""} className="field tnum" inputMode="numeric" />
                  </L>
                  <L label="Deal type">
                    <select name="dealType" defaultValue={opp.dealType} className="field">
                      {["assignment", "double_close", "novation", "subject_to", "seller_finance", "wholetail"].map((d) => (
                        <option key={d} value={d}>
                          {label(d)}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L label="Investor exit">
                    <select name="exitStrategy" defaultValue={opp.exitStrategy} className="field">
                      <option value="flip">Flip</option>
                      <option value="rental">Rental</option>
                    </select>
                  </L>
                  <L label="Motivation">
                    <input name="motivation" defaultValue={opp.motivation ?? ""} className="field" />
                  </L>
                  <L label="Timeline">
                    <input name="timeline" defaultValue={opp.timeline ?? ""} className="field" />
                  </L>
                  <div className="md:col-span-2">
                    <L label="Decision makers">
                      <input name="decisionMakers" defaultValue={opp.decisionMakers ?? ""} className="field" />
                    </L>
                  </div>
                </div>
                {writable && <Submit>Save</Submit>}
              </ActionForm>
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Seller">
              {seller ? (
                <div className="space-y-3">
                  <Link href={`/contacts/${seller.id}`} className="font-semibold text-brand underline">
                    {fullName(seller)}
                  </Link>
                  <KV items={[["Phone", seller.phone], ["Email", seller.email], ["Status", seller.doNotContact ? <span className="text-bad">Do not contact</span> : label(seller.sellerStatus)]]} />
                  {seller.summary && <p className="text-sm text-muted">{seller.summary}</p>}
                  {seller.openQuestions.length > 0 && (
                    <div className="text-sm">
                      <div className="label">Still to find out</div>
                      <ul className="ml-4 list-disc text-muted">
                        {seller.openQuestions.slice(0, 6).map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {writable && !seller.doNotContact && (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={callContactAction} hidden={{ contactId: seller.id, mode: "me", opportunityId: opp.id }} className="btn btn-primary btn-sm">
                        📞 Call (me)
                      </ActionButton>
                      <ActionButton action={callContactAction} hidden={{ contactId: seller.id, mode: "ai", opportunityId: opp.id, agentRole: ["NEGOTIATION", "OFFER_READY"].includes(opp.stage) ? "negotiation" : ["QUALIFIED", "PROPERTY_DISCOVERY"].includes(opp.stage) ? "property_discovery" : "seller_acquisition" }} className="btn btn-ghost btn-sm">
                        🤖 AI call
                      </ActionButton>
                    </div>
                  )}
                  {writable && !seller.doNotContact && (
                    <ActionForm action={textContactAction} resetOnOk className="space-y-2">
                      <input type="hidden" name="contactId" value={seller.id} />
                      <input type="hidden" name="opportunityId" value={opp.id} />
                      <textarea name="body" rows={2} className="field" placeholder="Text the seller…" />
                      <Submit className="btn btn-ghost btn-sm">Send text</Submit>
                    </ActionForm>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">No seller linked.</p>
              )}
            </Card>
            <Card title="Property">
              <KV
                items={[
                  ["Type", label(opp.property.propertyType)],
                  ["Beds / baths", `${opp.property.beds ?? "?"} / ${opp.property.baths ?? "?"}`],
                  ["Sq ft", opp.property.sqft?.toLocaleString()],
                  ["Year built", opp.property.yearBuilt],
                  ["Occupancy", label(opp.property.occupancy)],
                  ["Condition", label(opp.property.conditionTier)],
                  ["Title flags", opp.property.titleFlags.join(", ") || "none"],
                ]}
              />
            </Card>
            {pack && (
              <Card title={`${opp.property.state} rules in force`}>
                <ul className="space-y-1 text-sm text-muted">
                  <li>Before contract: {label(pack.wholesaling.marketingBeforeContract)}</li>
                  <li>After contract: {label(pack.wholesaling.marketingAfterContract)}</li>
                  <li>Assignment allowed: {pack.contracts.assignmentAllowed ? "yes" : "no"}</li>
                  <li>
                    Calls {pack.outreach.callStart}–{pack.outreach.callEnd} local
                  </li>
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "numbers" && <NumbersTab opp={opp} v={v} calc={calc} params={rp} writable={writable} playbook={rs.data.playbook} />}
      {tab === "buyers" && <BuyersTab opp={opp} calc={calc} ladder={ladder} writable={!c.workspace.isDemo && can(c.role, "buyers")} />}
      {tab === "contracts" && <ContractsTab opp={opp} ws={ws} writable={!c.workspace.isDemo && can(c.role, "contracts")} userName={c.user.name} />}
      {tab === "closing" && <ClosingTab opp={opp} ws={ws} writable={!c.workspace.isDemo && can(c.role, "closing")} />}
      {tab === "files" && (
        <Card title="Photos and documents">
          <FilesPanel ws={ws} entityType="opportunity" entityId={opp.id} writable={!c.workspace.isDemo} investorShare />
          {!c.workspace.isDemo && (
            <div className="mt-4 border-t border-line pt-3">
              <ActionButton action={photoRepairsAction} hidden={{ opportunityId: opp.id }} className="btn btn-ghost btn-sm">
                Estimate repairs from photos
              </ActionButton>
              <span className="ml-2 text-xs text-muted">Runs by itself when new photos are uploaded.</span>
            </div>
          )}
        </Card>
      )}
      {tab === "activity" && <ActivityTab opp={opp} ws={ws} writable={!c.workspace.isDemo} />}
    </div>
  );
}

function Mini({ label: l, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "good" }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2">
      <div className="text-xs text-muted">{l}</div>
      <div className={`tnum ${strong ? "text-lg font-semibold" : "font-medium"} ${tone === "good" ? "text-brand" : ""}`}>{value}</div>
    </div>
  );
}

function L({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{l}</span>
      {children}
    </label>
  );
}
