import Link from "next/link";
import { conditionShort, label as catLabel, OCCUPANCY, shortType } from "@/lib/catalog";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { Card, HotBadge, KV, Notice, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { DEAL_TYPES, EXIT_STRATEGIES, LEAD_SOURCES } from "@/lib/catalog";
import { db } from "@/lib/db";
import { activePack } from "@/lib/eligibility";
import { nearAgreement, resolveParams, type Calculation } from "@/lib/rules";
import { can, dealScope, pageCtx } from "@/lib/session";
import { SELLER_EXCEPTIONS, SELLER_STAGES, label } from "@/lib/stages";
import { letterDefaults } from "@/lib/offerletter";
import { OfferLetterForm } from "./offerletter";
import { ago, fmtDate, fullName, usd } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";
import { verificationPackAction } from "../../../actions/ops";
import { makeOfferAction } from "../../../actions/deals";
import { callContactAction, recordOfferAction, textContactAction, updateDealAction } from "../../../actions/records";
import { dealInclude, type Deal } from "./include";
import { FilesPanel } from "@/components/files";
import { photoRepairsAction } from "../../../actions/files";
import { buyerLadder, contractBasis } from "@/lib/deals";
import { ActivityTab, BuyersTab, ClosingTab, ContractsTab, NumbersTab } from "./sections";
import { CallButton } from "@/components/phone";
import { FeeReceived } from "@/components/fee";

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; ch?: string; lim?: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab || "overview";
  const ws = c.workspace.id;
  const opp = await db.opportunity.findFirst({
    where: { id, workspaceId: ws, ...dealScope(c) },
    include: dealInclude,
  });
  if (!opp) notFound();
  const v = opp.valuations[0];
  const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
  const seller = opp.sellerId ? await db.contact.findUnique({ where: { id: opp.sellerId } }) : null;
  const members = await db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { name: true } } } });
  const photos = await db.fileObject.findMany({ where: { workspaceId: ws, entityType: "opportunity", entityId: opp.id, mime: { startsWith: "image/" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } });
  const rs = await activeRuleSet(ws);
  const { params: rp } = resolveParams(rs.data, { state: opp.property.state, market: opp.property.city, zip: opp.property.zip, propertyType: opp.property.propertyType, dealType: opp.dealType, exit: opp.exitStrategy, conditionTier: opp.property.conditionTier, occupancy: opp.property.occupancy, titleFlags: opp.property.titleFlags, arv: calc?.arv });
  const near = calc ? nearAgreement(opp.sellerLowest, calc.maxBuy, rp) : false;
  const ladder = calc ? buyerLadder(contractBasis(opp, calc), calc, rp) : null;
  const pack = await activePack(ws, opp.property.state);
  const pendingApprovals = await db.approval.findMany({ where: { workspaceId: ws, entityId: opp.id, status: "pending" } });
  const writable = can(c.role, "deals");
  const sellerOffers = opp.offers.filter((o) => o.side === "seller");
  const me = writable && seller && tab === "overview" ? await db.user.findUnique({ where: { id: c.user.id }, select: { phone: true } }) : null;
  const letter = writable && seller && tab === "overview" ? await letterDefaults(ws, opp.id, undefined, { name: c.user.name, email: c.user.email, phone: me?.phone }) : null;
  const counts = { buyers: opp.interests.length, contracts: opp.contracts.length };

  const tabs = [
    { key: "overview", label: "Summary" },
    { key: "numbers", label: "Numbers" },
    { key: "buyers", label: "Investors", count: counts.buyers },
    { key: "contracts", label: "Paperwork", count: counts.contracts },
    { key: "closing", label: "Closing" },
    { key: "files", label: "Photos", count: photos.length },
    { key: "activity", label: "History" },
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
            {opp.autopilotOff && <span className="badge badge-warn">Autopilot off</span>}
            {opp.exception && <StatusBadge s={opp.exception} />}
            <HotBadge score={opp.hotScore} />
            {!pack && <span className="badge badge-bad">{opp.property.state} pack not active</span>}
          </span>
        }
      />
      <Progress stage={opp.stage} paid={Boolean(opp.transaction?.paidAt)} />
      <NextStep
        opp={opp}
        seller={seller}
        hasNumbers={Boolean(calc)}
        blocked={v?.blocked || null}
        approvals={pendingApprovals.map((a) => ({ id: a.id, title: a.title }))}
        canAct={writable}
      />
      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Offers">
              {calc ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Mini label="First offer" value={usd(calc.sellerOffers[0])} />
                    <Mini label="Second offer" value={usd(calc.sellerOffers[1] ?? calc.maxBuy)} />
                    <Mini label="Most we'll pay" value={usd(calc.maxBuy)} strong />
                    <Mini label="Seller's lowest" value={usd(opp.sellerLowest)} tone={near ? "good" : undefined} />
                  </div>
                  <div className="text-sm">
                    {opp.approvedAt ? (
                      <Notice tone="good">Final offer approved {ago(opp.approvedAt)} at {usd(opp.contractPrice)}. Send the contract from the Paperwork tab.</Notice>
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
                    <div id="offers" className="scroll-mt-20 overflow-x-auto">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Who</th>
                            <th className="text-right">Price</th>
                            <th>Authority</th>
                            <th>Offer letter</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sellerOffers.map((o) => (
                            <tr key={o.id}>
                              <td className="text-xs text-muted">{fmtDate(o.createdAt, true)}</td>
                              <td>{o.by === "us" ? "Our offer" : "Seller"}</td>
                              <td className="text-right tnum">{usd(o.price)}</td>
                              <td className="text-xs">
                                {o.authority ? label(o.authority) : ""}
                                {o.response ? <div className="text-muted">“{o.response.slice(0, 120)}”</div> : null}
                              </td>
                              <td className="text-xs">
                                {o.token ? (
                                  <div className="space-y-0.5">
                                    <div>
                                      {o.status === "accepted" ? <span className="badge badge-good">Ready to proceed</span> : o.status === "countered" ? <span className="badge badge-warn">Countered</span> : o.viewedAt ? <span className="badge">Opened {o.viewCount}×</span> : o.sentAt ? <span className="badge">Sent, not opened</span> : <span className="badge badge-bad">Not delivered</span>}
                                      {o.auto && <span className="ml-1 text-muted">auto</span>}
                                    </div>
                                    <div className="text-muted">
                                      {o.sentVia.join(" + ") || "—"}
                                      {o.viewedAt ? ` · first opened ${fmtDate(o.viewedAt, true)}` : ""}
                                    </div>
                                    <div className="flex gap-2">
                                      <a href={`/api/offers/${o.id}/pdf`} target="_blank" className="underline">
                                        PDF
                                      </a>
                                      <a href={`/offer/${o.token}?preview=1`} target="_blank" className="underline">
                                        Seller&apos;s page
                                      </a>
                                    </div>
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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

            {writable && seller && (
              <section id="make-offer" className="scroll-mt-20">
                <Card title="Make an offer">
                  <div className="mb-3 text-xs text-muted">{calc ? `Your rules: 1st ${usd(calc.sellerOffers[0])}, 2nd ${usd(calc.sellerOffers[1] ?? calc.maxBuy)}, max buy ${usd(calc.maxBuy)} (locked: going over needs the owner).` : "No valuation yet: the price isn't checked against your rules."}</div>
                  <OfferLetterForm opportunityId={opp.id} d={letter!} canOverride={["owner", "admin"].includes(c.role)} hasEmail={!!seller.email} hasPhone={!!seller.phone} />
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-medium">Or record a price / send a quick message instead of a letter</summary>
                  <ActionForm action={makeOfferAction} resetOnOk className="mt-3 space-y-3">
                    <input type="hidden" name="opportunityId" value={opp.id} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <L label="Offer price">
                        <input name="price" className="field tnum" inputMode="numeric" placeholder={calc ? String(calc.sellerOffers[0]) : ""} />
                      </L>
                      <div className="text-xs text-muted md:pt-7">
                        {calc ? `Your rules: 1st ${usd(calc.sellerOffers[0])}, 2nd ${usd(calc.sellerOffers[1] ?? calc.maxBuy)}, max buy ${usd(calc.maxBuy)} (locked).` : "No valuation yet: the price isn't checked against your rules."}
                      </div>
                    </div>
                    <L label="Message (optional: a default is written for you)">
                      <textarea name="message" rows={3} className="field" placeholder={`Hi ${seller.firstName || "there"}, following up on ${opp.property.address}: we can offer {{price}} cash, as-is…`} />
                    </L>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="send" value="sms" defaultChecked={!!seller.phone} /> Send by text
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="send" value="email" defaultChecked={!!seller.email} /> Send by email
                      </label>
                      {["owner", "admin"].includes(c.role) && (
                        <label className="flex items-center gap-1 text-warn">
                          <input type="checkbox" name="confirmOver" /> I'm overriding the max buy
                        </label>
                      )}
                    </div>
                    <Submit className="btn btn-ghost">Record and send offer</Submit>
                  </ActionForm>
                  </details>
                </Card>
              </section>
            )}

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
                    <Combo name="dealType" options={DEAL_TYPES} defaultValue={opp.dealType} disabled={!writable} />
                  </L>
                  <L label="Investor exit">
                    <Combo name="exitStrategy" options={EXIT_STRATEGIES} defaultValue={opp.exitStrategy} disabled={!writable} />
                  </L>
                  <L label="Lead source">
                    <Combo name="leadSource" options={LEAD_SOURCES} defaultValue={opp.leadSource} emptyLabel="Unknown" placeholder="Unknown" disabled={!writable} />
                  </L>
                  <L label="Assigned to">
                    <select name="assigneeId" defaultValue={opp.assigneeId ?? ""} className="field" disabled={!writable}>
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.name}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L label="Next step">
                    <input name="nextStep" defaultValue={opp.nextStep ?? ""} className="field" placeholder="e.g. walkthrough Tuesday 2pm" />
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
                <label className="flex items-start gap-2 rounded-xl bg-soft px-3 py-2 text-sm">
                  <input type="checkbox" name="autopilotOff" defaultChecked={opp.autopilotOff} disabled={!writable} className="mt-1" />
                  <span>
                    <span className="font-medium">Autopilot off for this deal</span>
                    <span className="block text-xs text-muted">No automatic calls, texts, emails or buyer outreach. Valuations and matching still update; queued contact waits for you to run it.</span>
                  </span>
                </label>
                {writable && <Submit>Save</Submit>}
              </ActionForm>
            </Card>
          </div>

          <div className="space-y-5">
            <Card title={`Photos (${photos.length})`} actions={<Link href={`/deals/${opp.id}?tab=files`} className="text-sm text-brand">{photos.length ? "All" : "Add"}</Link>}>
              {photos.length ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {photos.slice(0, 6).map((ph) => (
                    <a key={ph.id} href={`/api/files/${ph.id}`} target="_blank">
                      <img src={`/api/files/${ph.id}`} alt={ph.name} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No photos yet. Take or upload them on the Photos tab, or ask the seller to text them to your number: they're saved here automatically.</p>
              )}
            </Card>
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
                      <CallButton contactId={seller.id} name={fullName(seller)} phone={seller.phone} opportunityId={opp.id} label="Call" />
                    </div>
                  )}
                  {writable && !seller.doNotContact && (
                    <ActionForm action={callContactAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="contactId" value={seller.id} />
                      <input type="hidden" name="mode" value="ai" />
                      <input type="hidden" name="opportunityId" value={opp.id} />
                      <select name="agentRole" defaultValue={["NEGOTIATION", "OFFER_READY"].includes(opp.stage) ? "negotiation" : ["QUALIFIED", "PROPERTY_DISCOVERY"].includes(opp.stage) ? "property_discovery" : "seller_acquisition"} className="field w-auto text-sm">
                        <option value="seller_acquisition">Seller Acquisition agent</option>
                        <option value="property_discovery">Property Discovery agent</option>
                        <option value="negotiation">Negotiation agent</option>
                        <option value="transaction">Transaction Coordinator agent</option>
                      </select>
                      <Submit className="btn btn-ghost btn-sm">Have the AI call</Submit>
                    </ActionForm>
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
                  ["Type", shortType(opp.property.propertyType)],
                  ["Beds / baths", `${opp.property.beds ?? "?"} / ${opp.property.baths ?? "?"}`],
                  ["Sq ft", opp.property.sqft?.toLocaleString()],
                  ["Year built", opp.property.yearBuilt],
                  ["Occupancy", catLabel(OCCUPANCY, opp.property.occupancy)],
                  ["Rehab needed", conditionShort(opp.property.conditionTier)],
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
      {tab === "buyers" && <BuyersTab opp={opp} calc={calc} ladder={ladder} writable={can(c.role, "buyers")} />}
      {tab === "contracts" && <ContractsTab opp={opp} ws={ws} writable={can(c.role, "contracts")} userName={c.user.name} />}
      {tab === "closing" && <ClosingTab opp={opp} ws={ws} writable={can(c.role, "closing")} />}
      {tab === "files" && (
        <Card title="Photos and documents">
          <FilesPanel ws={ws} entityType="opportunity" entityId={opp.id} writable investorShare />
          {(
            <div className="mt-4 border-t border-line pt-3">
              <ActionButton action={photoRepairsAction} hidden={{ opportunityId: opp.id }} className="btn btn-ghost btn-sm">
                Estimate repairs from photos
              </ActionButton>
              <span className="ml-2 text-xs text-muted">Runs by itself when new photos are uploaded.</span>
            </div>
          )}
        </Card>
      )}
      {tab === "activity" && <ActivityTab opp={opp} ws={ws} writable ch={sp.ch} lim={Number(sp.lim) || undefined} />}
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

const STEPS = [
  { label: "Lead", stages: ["NEW", "ELIGIBLE", "OUTREACH"] },
  { label: "Talk", stages: ["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY"] },
  { label: "Value", stages: ["UNDERWRITING", "OFFER_READY"] },
  { label: "Offer", stages: ["NEGOTIATION"] },
  { label: "Signed", stages: ["CONTRACT_PREPARATION", "UNDER_CONTRACT"] },
  { label: "Buyer", stages: ["DISPOSITION"] },
  { label: "Close", stages: ["CLOSING"] },
  { label: "Paid", stages: ["CLOSED"] },
];

/** Where the deal is, as a simple row of steps. */
function Progress({ stage, paid }: { stage: string; paid: boolean }) {
  const at = Math.max(0, STEPS.findIndex((s) => s.stages.includes(stage)));
  return (
    <ol className="mb-4 flex gap-1" aria-label="Deal progress">
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && stage === "CLOSED" && paid);
        const now = i === at && !done;
        return (
          <li key={s.label} className="min-w-0 flex-1">
            <div className={`h-1.5 rounded-full ${done ? "bg-brand" : now ? "bg-brand/60" : "bg-soft"}`} />
            <div className={`mt-1 truncate text-[10px] sm:text-xs ${now ? "font-semibold text-ink" : done ? "text-brand" : "text-muted"}`}>{s.label}</div>
          </li>
        );
      })}
    </ol>
  );
}

type NS = { title: string; why: string; action?: React.ReactNode };

/** The one thing to do next on this deal, with the button that does it. */
function NextStep({ opp, seller, hasNumbers, blocked, approvals, canAct }: { opp: Deal; seller: { id: string; firstName: string; lastName: string; company: string | null; phone: string | null; doNotContact: boolean } | null; hasNumbers: boolean; blocked: string | null; approvals: { id: string; title: string }[]; canAct: boolean }) {
  const call = (label: string) => (seller && !seller.doNotContact ? <CallButton contactId={seller.id} name={fullName(seller)} phone={seller.phone} opportunityId={opp.id} label={label} size="lg" /> : null);
  const go = (href: string, label: string) => (
    <Link href={href} className="btn btn-primary w-full py-3 text-base">
      {label}
    </Link>
  );
  const s = opp.stage;
  let n: NS;
  if (approvals.length) n = { title: "A decision is waiting for you", why: approvals.map((a) => a.title).join(" · "), action: go(`/approvals#${approvals[0].id}`, "Decide now") };
  else if (["DECLINED", "WITHDRAWN"].includes(opp.exception || "")) n = { title: "The seller said no for now", why: opp.nextStep || "Check in again in a few months; situations change.", action: call("Check in with the seller") };
  else if (["NEW", "ELIGIBLE", "OUTREACH"].includes(s)) n = { title: "Talk to the seller", why: "Find out if they'd sell, when, and the price they have in mind. Don't make an offer on this first call.", action: call("Call the seller") };
  else if (["ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY"].includes(s)) n = hasNumbers ? { title: "Make your offer", why: "You have the numbers. Send a written offer or call with it.", action: go(`/deals/${opp.id}?tab=overview#make-offer`, "Send the offer") } : { title: "Learn the condition, then work out the numbers", why: "Ask about the roof, kitchen, bathrooms, heating and anything broken. Then value it.", action: go(`/deals/${opp.id}?tab=numbers`, "Work out the numbers") };
  else if (s === "UNDERWRITING") n = blocked ? { title: "Some numbers are missing", why: blocked, action: go(`/deals/${opp.id}?tab=numbers`, "Fill in the numbers") } : { title: "Check the numbers", why: "Look over the value and repairs, then make your offer.", action: go(`/deals/${opp.id}?tab=numbers`, "See the numbers") };
  else if (s === "OFFER_READY") n = { title: "Send your offer", why: "The numbers are ready. Send it in writing or call the seller with it.", action: go(`/deals/${opp.id}?tab=overview#make-offer`, "Send the offer") };
  else if (s === "NEGOTIATION") n = { title: "Follow up on your offer", why: opp.nextStep || "Call the seller, or send an updated written offer.", action: call("Call the seller") };
  else if (s === "CONTRACT_PREPARATION") n = { title: "Send the purchase contract", why: `Agreed at ${usd(opp.contractPrice)}. Send the contract for the seller to sign.`, action: go(`/deals/${opp.id}?tab=contracts`, "Send the contract") };
  else if (s === "UNDER_CONTRACT" || s === "DISPOSITION") n = { title: "Find your buyer", why: "Pitch the deal to the investors that fit it best.", action: go(`/deals/${opp.id}?tab=buyers`, "Pitch to investors") };
  else if (s === "CLOSING") n = opp.transaction?.paidAt ? { title: "Paid", why: "This deal is done." } : { title: "Closing: did your fee arrive?", why: "When the money is in your account, mark it here and everything updates.", action: canAct ? <FeeReceived opportunityId={opp.id} expected={opp.transaction?.assignmentFee} /> : null };
  else n = { title: opp.transaction?.paidAt ? `Paid ${usd(opp.transaction.netProceeds)}` : "Closed", why: opp.transaction?.paidAt ? `Fee received ${fmtDate(opp.transaction.paidAt)}.` : "Mark your fee received when it arrives.", action: !opp.transaction?.paidAt && canAct ? <FeeReceived opportunityId={opp.id} expected={opp.transaction?.assignmentFee} /> : undefined };
  return (
    <div className="card mb-4 border-brand/40 p-4">
      <div className="label">Next step</div>
      <div className="mt-1 text-lg font-semibold">{n.title}</div>
      <p className="mt-0.5 text-sm text-muted">{n.why}</p>
      {canAct && n.action && <div className="mt-3 sm:max-w-sm">{n.action}</div>}
    </div>
  );
}
