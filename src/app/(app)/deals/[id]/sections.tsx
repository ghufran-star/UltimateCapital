import Link from "next/link";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { CONDITION_TIERS, OCCUPANCY, OWNER_TYPES, PROPERTY_TYPES, SITUATIONS, TITLE_FLAGS } from "@/lib/catalog";
import { SignaturePad } from "@/components/signature";
import { Card, Empty, KV, Notice, StatusBadge } from "@/components/ui";
import type { Valuation } from "@prisma/client";
import { contractFields } from "@/lib/contracts";
import { db } from "@/lib/db";
import { activePack } from "@/lib/eligibility";
import { fmtPct, type Calculation, type PricingParams, type RepairItem, type RepairLine } from "@/lib/rules";
import { INTEREST_STAGES, INTEREST_OTHER, label } from "@/lib/stages";
import { dealInboxAddress } from "@/lib/title";
import { ago, fmtDate, fullName, usd } from "@/lib/util";
import { checklistAction, countersignAction, createContractAction, openTitleAction, paymentAction, reprocessAction, sendContractAction, settlementAction, taskAction, terminateContractAction, transactionAction } from "../../../actions/ops";
import { addNoteAction, chooseBuyerAction, compAction, dealCampaignAction, interestAction, recordOfferAction, revalueAction, updatePropertyAction } from "../../../actions/records";
import type { Deal } from "./include";
import { BulkIdsClient, SelectAll } from "../bulk";
import { addBuyerToDealAction, emailTitleAction, pitchSelectedAction } from "../../../actions/deals";

// ---------- Numbers ----------

export function NumbersTab({ opp, v, calc, params, writable, playbook }: { opp: Deal; v?: Valuation; calc: Calculation | null; params: PricingParams; writable: boolean; playbook: RepairItem[] }) {
  const p = opp.property;
  const items = ((p.condition as { items?: Record<string, { tier: string; reason?: string }> } | null)?.items || {}) as Record<string, { tier: string; reason?: string }>;
  const lines = (v?.repairItems || []) as unknown as RepairLine[];
  const comps = (v?.comps || []) as unknown as { address?: string; price?: number; sqft?: number; date?: string; source?: string; distance?: number }[];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {v?.blocked && <Notice>Valuation blocked: {v.blocked}</Notice>}
        {calc && (
          <Card title={`Calculation · rules v${v?.ruleVersion ?? "?"}`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Box l="ARV" v={usd(calc.arv)} />
              <Box l="Repairs (likely)" v={usd(calc.repairs)} s={`${usd(v?.repairsLow)} – ${usd(v?.repairsHigh)}`} />
              <Box l="Max buy" v={usd(calc.maxBuy)} strong />
              <Box l="Floor (min sell)" v={usd(calc.floor)} />
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {calc.formula.map((f) => (
                <li key={f} className="text-muted">
                  {f}
                </li>
              ))}
            </ul>
            {calc.warnings.map((w) => (
              <p key={w} className="mt-2 text-sm text-warn">
                ⚠ {w}
              </p>
            ))}
            <h3 className="mt-5 mb-2 text-sm font-semibold">What the investor makes ({params.investor.profitBasis} basis, min {fmtPct(params.investor.minProfitPct)} and {usd(params.investor.minNetProfit)})</h3>
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th className="text-right">Asking</th>
                    <th className="text-right">Our fee</th>
                    <th className="text-right">Investor gross</th>
                    <th className="text-right">Investor net</th>
                    <th>Meets their minimum</th>
                  </tr>
                </thead>
                <tbody>
                  {[...calc.investorAtRounds.map((iv, i) => ({ k: `Round ${i + 1}`, iv, fee: calc.ourFeeAtRounds[i] })), { k: "Floor", iv: calc.investorAtFloor, fee: calc.floor - calc.contractPrice }].map(({ k, iv, fee }) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="text-right tnum">{usd(iv.price)}</td>
                      <td className="text-right tnum">{usd(fee)}</td>
                      <td className="text-right tnum">
                        {usd(iv.gross)} <span className="text-xs text-muted">{fmtPct(iv.grossPct)}</span>
                      </td>
                      <td className="text-right tnum">
                        {usd(iv.net)} <span className="text-xs text-muted">{fmtPct(iv.netPct)}</span>
                      </td>
                      <td>{iv.meets ? <span className="badge badge-good">Yes</span> : <span className="badge badge-bad">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Investor maximum price that still meets their minimum: {usd(calc.investorMaxPrice)}. Contract price used: {usd(calc.contractPrice)}.</p>
          </Card>
        )}

        <Card title="Repairs from the seller's answers + your playbook">
          {lines.length > 0 && (
            <table className="data mb-4">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Level</th>
                  <th className="text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.label}
                      {l.reason && <div className="text-xs text-muted">“{l.reason}”</div>}
                    </td>
                    <td>{label(l.tier)}</td>
                    <td className="text-right tnum">{usd(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ActionForm action={updatePropertyAction}>
            <input type="hidden" name="propertyId" value={p.id} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <F l="Beds">
                <input name="beds" defaultValue={p.beds ?? ""} className="field" inputMode="decimal" />
              </F>
              <F l="Baths">
                <input name="baths" defaultValue={p.baths ?? ""} className="field" inputMode="decimal" />
              </F>
              <F l="Sq ft">
                <input name="sqft" defaultValue={p.sqft ?? ""} className="field" inputMode="numeric" />
              </F>
              <F l="Year built">
                <input name="yearBuilt" defaultValue={p.yearBuilt ?? ""} className="field" inputMode="numeric" />
              </F>
              <div className="col-span-2">
                <F l="Type">
                  <Combo name="propertyType" options={PROPERTY_TYPES} defaultValue={p.propertyType} />
                </F>
              </div>
              <F l="Occupancy">
                <Combo name="occupancy" options={OCCUPANCY} defaultValue={p.occupancy} emptyLabel="Unknown" placeholder="Unknown" />
              </F>
              <F l="Rehab needed (overall)">
                <Combo name="conditionTier" options={CONDITION_TIERS} defaultValue={p.conditionTier} emptyLabel="Unknown" placeholder="Unknown" />
              </F>
              <div className="col-span-2">
                <F l="Title issues">
                  <Combo name="titleFlags" options={TITLE_FLAGS} defaultValue={p.titleFlags} multiple allowCustom placeholder="None known" />
                </F>
              </div>
              <div className="col-span-2 md:col-span-4">
                <input type="hidden" name="situationsForm" value="1" />
                <F l="Seller situation">
                  <Combo name="situations" options={SITUATIONS} defaultValue={p.situations} multiple placeholder="Pre-foreclosure, probate, tired landlord…" />
                </F>
              </div>
              <F l="Owner type">
                <Combo name="ownerType" options={OWNER_TYPES} defaultValue={p.ownerType} emptyLabel="Unknown" placeholder="Unknown" />
              </F>
              <F l="Absentee owner">
                <select name="absentee" defaultValue={p.absentee === true ? "yes" : p.absentee === false ? "no" : ""} className="field">
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </F>
              <F l="Est. value (as-is)">
                <input name="estValue" defaultValue={p.estValue ?? ""} className="field tnum" inputMode="numeric" />
              </F>
              <F l="Mortgage balance">
                <input name="loanBalance" defaultValue={p.loanBalance ?? ""} className="field tnum" inputMode="numeric" />
              </F>
              <F l="Last sale price">
                <input name="lastSalePrice" defaultValue={p.lastSalePrice ?? ""} className="field tnum" inputMode="numeric" />
              </F>
              <F l="Last sale date">
                <input type="date" name="lastSaleDate" defaultValue={p.lastSaleDate ? p.lastSaleDate.toISOString().slice(0, 10) : ""} className="field" />
              </F>
              <F l="Lot (acres)">
                <input name="lotAcres" defaultValue={p.lotAcres ?? ""} className="field" inputMode="decimal" />
              </F>
              <F l="County">
                <input name="county" defaultValue={p.county ?? ""} className="field" />
              </F>
              <F l="Parcel">
                <input name="parcel" defaultValue={p.parcel ?? ""} className="field" />
              </F>
              <div className="col-span-2">
                <F l="Legal description">
                  <input name="legalDesc" defaultValue={p.legalDesc ?? ""} className="field" />
                </F>
              </div>
            </div>
            <div className="mt-2 text-sm font-medium">Item by item (overrides the overall condition)</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {playbook.map((it) => (
                <label key={it.key} className="flex items-center justify-between gap-2 rounded-lg bg-soft px-3 py-1.5 text-sm">
                  <span>{it.label}</span>
                  <select name={`tier_${it.key}`} defaultValue={items[it.key]?.tier || "unknown"} className="rounded-md bg-card px-1 py-0.5 text-xs">
                    <option value="unknown">—</option>
                    <option value="none">Fine</option>
                    <option value="cosmetic">Light</option>
                    <option value="moderate">Medium</option>
                    <option value="heavy">Heavy</option>
                    <option value="gut">Replace</option>
                  </select>
                </label>
              ))}
            </div>
            {writable && <Submit>Save property &amp; re-value</Submit>}
          </ActionForm>
        </Card>

        <Card title={`Comparable sales (${comps.length})`} pad={false}>
          {comps.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Sq ft</th>
                    <th>Date</th>
                    <th>Source</th>
                    {writable && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {comps.map((x, i) => (
                    <tr key={i}>
                      <td>{x.address}</td>
                      <td className="text-right tnum">{usd(x.price)}</td>
                      <td className="text-right tnum">{x.sqft?.toLocaleString() ?? "—"}</td>
                      <td className="text-xs">{x.date ? fmtDate(x.date) : "—"}</td>
                      <td className="max-w-48 truncate text-xs text-muted">{x.source}</td>
                      {writable && (
                        <td className="text-right">
                          <ActionButton action={compAction} hidden={{ propertyId: p.id, what: x.source === "Added by you" ? "remove" : "exclude", address: x.address || "" }} className="text-xs text-muted underline">
                            {x.source === "Added by you" ? "Remove" : "Rule out"}
                          </ActionButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No comps yet">Add a RentCast key in Settings → Integrations, add your own comps below, or enter a verified ARV.</Empty>
          )}
          {p.excludedComps.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-xs text-muted">
              Ruled out:{" "}
              {p.excludedComps.map((a) => (
                <span key={a} className="mr-2">
                  {a}{" "}
                  {writable && (
                    <ActionButton action={compAction} hidden={{ propertyId: p.id, what: "restore", address: a }} className="underline">
                      restore
                    </ActionButton>
                  )}
                </span>
              ))}
            </div>
          )}
          {writable && (
            <ActionForm action={compAction} className="flex flex-wrap items-end gap-2 border-t border-line p-4" resetOnOk>
              <input type="hidden" name="propertyId" value={p.id} />
              <input type="hidden" name="what" value="add" />
              <input name="address" className="field min-w-48 flex-1" placeholder="Comp address" />
              <input name="price" className="field w-28" placeholder="Sold $" inputMode="numeric" />
              <input name="sqft" className="field w-24" placeholder="Sq ft" inputMode="numeric" />
              <input name="date" type="date" className="field w-auto" />
              <Submit className="btn btn-ghost">Add comp</Submit>
            </ActionForm>
          )}
        </Card>
      </div>
      <div className="space-y-5">
        <Card title="Valuation">
          <KV items={[["As-is", usd(v?.asIs)], ["Rent", v?.rent ? `${usd(v.rent)}/mo` : "—"], ["Confidence", v ? `${Math.round(v.confidence * 100)}%` : "—"], ["Updated", v ? ago(v.createdAt) : "never"]]} />
          {writable && (
            <ActionForm action={revalueAction} className="mt-4 space-y-2">
              <input type="hidden" name="opportunityId" value={opp.id} />
              <F l="Verified ARV (optional)">
                <input name="arvOverride" className="field tnum" inputMode="numeric" placeholder="From your own comps" />
              </F>
              <F l="Verified repairs (optional)">
                <input name="repairsOverride" className="field tnum" inputMode="numeric" placeholder="From a walkthrough or bid" />
              </F>
              <Submit className="btn btn-primary w-full">Run valuation</Submit>
            </ActionForm>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- Buyers ----------

export async function BuyersTab({ opp, calc, ladder, writable }: { opp: Deal; calc: Calculation | null; ladder: { rounds: number[]; floor: number } | null; writable: boolean }) {
  const allBuyers = writable ? await db.contact.findMany({ where: { workspaceId: opp.workspaceId, kind: "buyer", doNotContact: false, id: { notIn: opp.interests.map((i) => i.contactId) } }, select: { id: true, firstName: true, lastName: true, company: true }, orderBy: { updatedAt: "desc" }, take: 2000 }) : [];
  const underContract = opp.contracts.some((k) => k.kind === "seller_purchase" && k.status === "effective");
  const serious = opp.interests.filter((i) => i.serious);
  const chosen = opp.transaction?.buyerId;
  return (
    <div className="space-y-5">
      <Card title="Buyer demand">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold">{opp.interests.length}</span> matched · <span className="font-semibold">{serious.length}</span> serious · hot score <span className="font-semibold">{opp.hotScore}</span>
            <div className="text-xs text-muted">
              {underContract ? "Under contract: full marketing with the State Pack disclosure." : "Not under contract: only the anonymous demand check is allowed (no address, no price commitment)."}
            </div>
          </div>
          {writable && (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={dealCampaignAction} hidden={{ opportunityId: opp.id, what: "match" }}>
                Re-match buy boxes
              </ActionButton>
              {!underContract && (
                <ActionButton action={dealCampaignAction} hidden={{ opportunityId: opp.id, what: "anonymous" }} className="btn btn-ghost btn-sm" confirm="Start the anonymous demand check with matching buyers (email/text/call within their contact limits)?">
                  Anonymous demand check
                </ActionButton>
              )}
              {underContract && (
                <ActionButton action={dealCampaignAction} hidden={{ opportunityId: opp.id, what: "full" }} className="btn btn-primary btn-sm" confirm="Market this deal to all matching buyers?">
                  Market to buyers
                </ActionButton>
              )}
            </div>
          )}
        </div>
        {calc && ladder && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {!opp.approvedAt && opp.sellerLowest && opp.sellerLowest <= calc.maxBuy && <span className="badge badge-warn">Presumptive: based on the seller&apos;s {usd(opp.sellerLowest)}</span>}
            {ladder.rounds.map((r, i) => (
              <span key={r} className="badge">
                Round {i + 1}: {usd(r)}
              </span>
            ))}
            <span className="badge badge-bad">Floor {usd(ladder.floor)}</span>
          </div>
        )}
      </Card>

      <Card title="Matched buyers" pad={false}>
        {writable && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            {opp.interests.length > 0 && (
              <ActionForm action={pitchSelectedAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="opportunityId" value={opp.id} />
                <BulkIdsClient tickClass="buyer-tick" />
                <Submit className="btn btn-primary btn-sm">Send to ticked investors</Submit>
              </ActionForm>
            )}
            <ActionForm action={addBuyerToDealAction} className="flex flex-1 flex-wrap items-center gap-2" resetOnOk>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <Combo name="contactId" options={allBuyers.map((b) => ({ key: b.id, label: fullName(b) }))} placeholder="Add any investor by name" className="min-w-64 flex-1" />
              <Submit className="btn btn-ghost btn-sm">Add to deal</Submit>
            </ActionForm>
          </div>
        )}
        {opp.interests.length ? (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  {writable && (
                    <th className="w-8">
                      <SelectAll tickClass="buyer-tick" />
                    </th>
                  )}
                  <th>Buyer</th>
                  <th>Fit</th>
                  <th>Stage</th>
                  <th className="text-right">Their price</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {opp.interests.map((i) => {
                  const reasons = (i.reasons || []) as string[];
                  return (
                    <tr key={i.id} className={i.contactId === chosen ? "bg-brand-soft" : ""}>
                      {writable && (
                        <td>
                          <input type="checkbox" className="buyer-tick h-4 w-4" value={i.contactId} aria-label={`Select ${fullName(i.contact)}`} />
                        </td>
                      )}
                      <td>
                        <Link href={`/contacts/${i.contactId}`} className="font-medium hover:text-brand">
                          {fullName(i.contact)}
                        </Link>
                        {i.serious && <span className="badge badge-hot ml-2">Serious</span>}
                        {i.contactId === chosen && <span className="badge badge-good ml-2">Chosen</span>}
                        <div className="text-xs text-muted">
                          {i.contact.fundsVerified ? "Funds verified" : "Funds unverified"} · {i.contact.dealsClosed} closed · reliability {i.contact.reliability}
                        </div>
                        {reasons.length > 0 && <div className="text-xs text-muted">{reasons.slice(0, 3).join(" · ")}</div>}
                        {i.portalToken && (
                          <a href={`/d/${i.portalToken}`} target="_blank" className="text-xs text-brand underline">
                            Their deal page{i.seqStep ? ` · sequence step ${i.seqStep}/3` : ""}
                          </a>
                        )}
                      </td>
                      <td className="tnum">{i.fitScore}</td>
                      <td>
                        <StatusBadge s={i.stage} />
                        {i.presentedAt && <div className="text-xs text-muted">sent {ago(i.presentedAt)}</div>}
                      </td>
                      <td className="text-right tnum">{usd(i.priceMentioned)}</td>
                      <td>
                        {writable && (
                          <ActionForm action={interestAction} className="flex flex-wrap items-center gap-1">
                            <input type="hidden" name="interestId" value={i.id} />
                            <select name="stage" defaultValue={i.stage} className="rounded-md border border-line bg-card px-1 py-1 text-xs">
                              {[...INTEREST_STAGES, ...INTEREST_OTHER].map((s) => (
                                <option key={s} value={s}>
                                  {label(s)}
                                </option>
                              ))}
                            </select>
                            <input name="priceMentioned" defaultValue={i.priceMentioned ?? ""} placeholder="$" className="w-24 rounded-md border border-line bg-card px-1 py-1 text-xs" />
                            <input type="hidden" name="serious" value="off" />
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" name="serious" defaultChecked={i.serious} /> serious
                            </label>
                            <Submit className="btn btn-ghost btn-sm">Save</Submit>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching buyers yet">Buyers are matched against their buy boxes once the deal is valued.</Empty>
        )}
      </Card>

      {writable && opp.interests.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Record a buyer offer">
            <ActionForm action={recordOfferAction} resetOnOk>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <input type="hidden" name="side" value="buyer" />
              <input type="hidden" name="by" value="them" />
              <select name="contactId" className="field">
                {opp.interests.map((i) => (
                  <option key={i.contactId} value={i.contactId}>
                    {fullName(i.contact)}
                  </option>
                ))}
              </select>
              <input name="price" className="field tnum" placeholder="Offer" inputMode="numeric" />
              <Submit className="btn btn-ghost">Record offer</Submit>
              {ladder && <p className="text-xs text-muted">Anything below the floor of {usd(ladder.floor)} needs your approval.</p>}
            </ActionForm>
          </Card>
          <Card title="Choose the buyer">
            <ActionForm action={chooseBuyerAction}>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <select name="contactId" className="field" defaultValue={chosen || serious[0]?.contactId}>
                {opp.interests.map((i) => (
                  <option key={i.contactId} value={i.contactId}>
                    {fullName(i.contact)} {i.priceMentioned ? `· ${usd(i.priceMentioned)}` : ""}
                  </option>
                ))}
              </select>
              <input name="price" className="field tnum" placeholder="Agreed price" inputMode="numeric" defaultValue={serious[0]?.priceMentioned ?? ladder?.rounds[0] ?? ""} />
              <Submit>Choose buyer</Submit>
              <p className="text-xs text-muted">Sets the assignment fee and creates the task to send the assignment.</p>
            </ActionForm>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- Contracts ----------

export async function ContractsTab({ opp, ws, writable, userName }: { opp: Deal; ws: string; writable: boolean; userName: string }) {
  const pack = await activePack(ws, opp.property.state);
  const templates = await db.contractTemplate.findMany({ where: { workspaceId: ws, active: true, OR: [{ state: null }, { state: opp.property.state }] }, orderBy: { name: "asc" } });
  const sellerEffective = opp.contracts.some((k) => k.kind === "seller_purchase" && k.status === "effective");
  const kinds = [...new Set(templates.map((t) => t.kind))];
  const fieldsByKind: Record<string, Record<string, string>> = {};
  for (const k of kinds) fieldsByKind[k] = await contractFields(ws, opp.id, k);
  return (
    <div className="space-y-5">
      {!pack && <Notice tone="bad">The {opp.property.state} State Pack isn't active. Contracts can be drafted but check your state rules before sending.</Notice>}
      {!opp.approvedAt && <Notice>The seller contract unlocks after you approve the final offer (Approvals).</Notice>}

      {opp.contracts.map((k) => {
        const f = k.fields as Record<string, string>;
        const external = k.signers.filter((s) => s.role !== "company");
        const company = k.signers.find((s) => s.role === "company");
        const readyToCountersign = external.every((s) => s.status === "signed") && company?.status !== "signed";
        return (
          <Card
            key={k.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {label(k.kind)} · {f.purchase_price || f.assignment_fee}
                <StatusBadge s={k.status} />
              </span>
            }
            actions={
              k.finalPdf ? (
                <a href={`/api/contracts/${k.id}/pdf`} className="btn btn-ghost btn-sm" target="_blank">
                  Signed PDF
                </a>
              ) : null
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                {k.signers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-soft px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">
                        {s.name} <span className="text-xs text-muted">({s.role})</span>
                      </div>
                      <div className="text-xs text-muted">{s.signedAt ? `Signed ${fmtDate(s.signedAt, true)}` : s.viewedAt ? `Viewed ${ago(s.viewedAt)}` : s.email || s.phone || ""}</div>
                    </div>
                    <StatusBadge s={s.status} />
                  </div>
                ))}
                <KV items={[["Effective", fmtDate(k.effectiveAt)], ["Option ends", fmtDate(k.optionEndsAt)], ["EMD due", fmtDate(k.emdDueAt)], ["Closing", fmtDate(k.closingAt)]]} />
                {k.finalHash && <p className="break-all text-xs text-muted">SHA-256 {k.finalHash}</p>}
              </div>
              <div className="space-y-3">
                {writable && ["draft", "sent", "viewed", "partially_signed"].includes(k.status) && !readyToCountersign && (
                  <ActionButton action={sendContractAction} hidden={{ contractId: k.id }} className="btn btn-primary">
                    {k.status === "draft" ? "Send for signature (email + text)" : "Resend signing link"}
                  </ActionButton>
                )}
                {writable && readyToCountersign && (
                  <ActionForm action={countersignAction}>
                    <input type="hidden" name="contractId" value={k.id} />
                    <SignaturePad label="Countersign for the company" defaultTyped={userName} />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="consent" className="mt-1" /> I agree to sign this agreement electronically on behalf of the company.
                    </label>
                    <Submit>Countersign &amp; make effective</Submit>
                  </ActionForm>
                )}
                {writable && ["effective", "sent", "viewed", "partially_signed"].includes(k.status) && (
                  <ActionForm action={terminateContractAction} className="flex gap-2">
                    <input type="hidden" name="contractId" value={k.id} />
                    <input name="reason" className="field" placeholder="Reason for terminating" />
                    <Submit className="btn btn-danger">Terminate</Submit>
                  </ActionForm>
                )}
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Read the agreement</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-soft p-3 text-xs whitespace-pre-wrap">{k.body}</pre>
                </details>
              </div>
            </div>
          </Card>
        );
      })}

      {writable && (
        <Card title="Create a contract" actions={<Link href={`/closing/documents/new?deal=${opp.id}`} className="text-sm text-brand">Send your own PDF</Link>}>
          {templates.length ? (
            <div className="space-y-3">
              {templates.map((t) => {
                const locked = (t.kind === "seller_purchase" && !opp.approvedAt) || ((t.kind === "assignment" || t.kind === "buyer_purchase") && (!sellerEffective || !opp.transaction?.buyerId));
                const fields = fieldsByKind[t.kind] || {};
                const used = [...new Set([...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
                return (
                  <details key={t.id} className="rounded-xl border border-line">
                    <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
                      {t.name}
                      {locked && <span className="badge">locked</span>}
                    </summary>
                    <div className="border-t border-line p-4">
                      {locked ? (
                        <p className="text-sm text-muted">{t.kind === "seller_purchase" ? "Approve the final offer first." : "Needs an effective seller contract and a chosen buyer."}</p>
                      ) : (
                        <ActionForm action={createContractAction}>
                          <input type="hidden" name="opportunityId" value={opp.id} />
                          <input type="hidden" name="templateId" value={t.id} />
                          <div className="grid gap-2 md:grid-cols-2">
                            {used.map((k) => (
                              <label key={k} className="block space-y-1 text-sm">
                                <span className="text-xs text-muted">{label(k)}</span>
                                <input name={`f_${k}`} defaultValue={fields[k] || ""} className={`field ${!fields[k] ? "border-warn" : ""}`} />
                              </label>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="send" defaultChecked /> Send signing links now by email and text
                          </label>
                          <Submit>Create contract</Submit>
                        </ActionForm>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <Empty title="No templates" action={<Link href="/settings/templates" className="btn btn-primary">Add your contracts</Link>}>
              Paste your attorney&apos;s contracts in Settings → Contract templates.
            </Empty>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------- Closing ----------

type Item = { key: string; label: string; done: boolean; doneAt?: string; note?: string };

export async function ClosingTab({ opp, ws, writable }: { opp: Deal; ws: string; writable: boolean }) {
  const tx = opp.transaction;
  const [titleCos, payments] = await Promise.all([db.titleCompany.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } }), db.payment.findMany({ where: { workspaceId: ws, opportunityId: opp.id }, orderBy: { createdAt: "asc" } })]);
  const inbox = tx ? await dealInboxAddress(ws, tx.inboxAlias) : null;
  const items = (tx?.checklist || []) as unknown as Item[];
  const settlement = tx?.settlement as { ok?: boolean; issues?: string[]; ourNetProceeds?: number; checkedAt?: string } | null;
  const done = items.filter((i) => i.done).length;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title={tx ? `Title checklist · ${done}/${items.length}` : "Title"} actions={tx ? <StatusBadge s={tx.stage} /> : null}>
          {tx ? (
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li key={i.key} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-soft">
                  <div className="text-sm">
                    <span className={i.done ? "text-muted line-through" : ""}>{i.label}</span>
                    {i.note && <div className="text-xs text-muted">{i.note}</div>}
                  </div>
                  {writable ? (
                    <ActionButton action={checklistAction} hidden={{ transactionId: tx.id, key: i.key, done: i.done ? "0" : "1" }} className={`btn btn-sm ${i.done ? "btn-ghost" : "btn-primary"}`}>
                      {i.done ? "Undo" : "Done"}
                    </ActionButton>
                  ) : i.done ? (
                    "✓"
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Closing starts when the seller contract is effective" />
          )}
        </Card>

        <Card title="Payments" pad={false}>
          {payments.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>What</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {label(p.kind)} <span className="text-xs text-muted">{p.direction === "in" ? "to us" : `to ${p.payee || "payee"}`}</span>
                        {p.dueAt && <div className="text-xs text-muted">due {fmtDate(p.dueAt)}</div>}
                        {p.direction === "out" && <div className="text-xs">{p.wireVerifiedAt ? "✓ wire verified by phone" : <span className="text-warn">wire not verified</span>}</div>}
                      </td>
                      <td className="text-right tnum">{usd(p.amount)}</td>
                      <td>
                        <StatusBadge s={p.status} />
                      </td>
                      <td className="space-x-1 whitespace-nowrap text-right">
                        {writable && p.direction === "out" && p.status === "due" && (
                          <ActionButton action={paymentAction} hidden={{ paymentId: p.id, status: "awaiting_approval" }}>
                            Ask approval
                          </ActionButton>
                        )}
                        {writable && p.direction === "out" && !p.wireVerifiedAt && (
                          <ActionButton action={paymentAction} hidden={{ paymentId: p.id, wireVerified: "1" }} confirm="Confirm you called the title company on a number you already had (not one from an email) and verified the wire instructions.">
                            Wire verified
                          </ActionButton>
                        )}
                        {writable && p.direction === "out" && p.status === "approved" && (
                          <ActionButton action={paymentAction} hidden={{ paymentId: p.id, status: "paid" }} className="btn btn-primary btn-sm">
                            Mark paid
                          </ActionButton>
                        )}
                        {writable && p.direction === "in" && !["received", "cancelled"].includes(p.status) && (
                          <ActionButton action={paymentAction} hidden={{ paymentId: p.id, status: "received" }} className="btn btn-primary btn-sm">
                            Received
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No payments yet" />
          )}
          {writable && (
            <ActionForm action={paymentAction} className="flex flex-wrap items-end gap-2 border-t border-line p-4" resetOnOk>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <select name="kind" className="field w-auto">
                {["emd", "option_fee", "title_fee", "assignment_fee", "expense", "other"].map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </select>
              <select name="direction" className="field w-auto">
                <option value="out">We pay</option>
                <option value="in">We receive</option>
              </select>
              <input name="amount" className="field w-28" placeholder="Amount" inputMode="numeric" />
              <input name="payee" className="field w-40" placeholder="Payee" />
              <input name="dueAt" type="date" className="field w-auto" />
              <Submit className="btn btn-ghost">Add</Submit>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Transaction">
          {writable ? (
            <ActionForm action={transactionAction}>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <F l="Title company">
                <select name="titleCompanyId" defaultValue={tx?.titleCompanyId || ""} className="field">
                  <option value="">Choose…</option>
                  {titleCos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.state ? ` (${t.state})` : ""}
                    </option>
                  ))}
                </select>
              </F>
              <F l="Closing date">
                <input type="date" name="closingAt" defaultValue={tx?.closingAt ? tx.closingAt.toISOString().slice(0, 10) : ""} className="field" />
              </F>
              <F l="Assignment fee">
                <input name="assignmentFee" defaultValue={tx?.assignmentFee ?? ""} className="field tnum" inputMode="numeric" />
              </F>
              <F l="Earnest money">
                <input name="emdAmount" defaultValue={tx?.emdAmount ?? ""} className="field tnum" inputMode="numeric" />
              </F>
              <Submit className="btn btn-ghost">Save</Submit>
            </ActionForm>
          ) : (
            <KV items={[["Title", tx?.titleCompany?.name], ["Closing", fmtDate(tx?.closingAt)], ["Fee", usd(tx?.assignmentFee)]]} />
          )}
          {tx && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="label">Deal inbox</div>
              <p className="break-all">{inbox || <span className="text-muted">Set the inbound email domain in Settings → Integrations.</span>}</p>
              <p className="text-xs text-muted">Title replies here are read by AI: checklist updates, requests, settlement statements and wire-fraud warnings.</p>
            </div>
          )}
          {writable && tx?.titleCompanyId && (
            <div className="mt-4">
              <ActionButton action={openTitleAction} hidden={{ opportunityId: opp.id, titleCompanyId: tx.titleCompanyId }} className="btn btn-primary w-full" confirm="Email the signed contract package to the title company?">
                Send package to title
              </ActionButton>
            </div>
          )}
        </Card>
        {writable && (
          <Card title="Email title yourself">
            <ActionForm action={emailTitleAction} resetOnOk>
              <input type="hidden" name="opportunityId" value={opp.id} />
              <input name="to" className="field" placeholder={tx?.titleCompany?.email || "title@company.com"} />
              <input name="subject" className="field" placeholder="Subject" defaultValue={`${opp.property.address}: `} />
              <textarea name="body" rows={4} className="field" placeholder="Message" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="attachContracts" /> Attach the signed contracts
              </label>
              <p className="text-xs text-muted">Replies go to this deal&apos;s inbox, so the checklist updates itself.</p>
              <Submit className="btn btn-ghost">Send</Submit>
            </ActionForm>
          </Card>
        )}
        {tx && (
          <Card title="Settlement statement">
            {settlement?.checkedAt && (
              <div className="mb-3">
                {settlement.ok ? <Notice tone="good">Checked {ago(settlement.checkedAt)}: no issues. Net to us {usd(settlement.ourNetProceeds)}.</Notice> : <Notice tone="bad">Issues: {settlement.issues?.join("; ")}</Notice>}
              </div>
            )}
            {writable && (
              <ActionForm action={settlementAction}>
                <input type="hidden" name="transactionId" value={tx.id} />
                <input type="file" name="file" accept=".pdf,image/*" className="field" />
                <textarea name="text" rows={3} className="field" placeholder="…or paste the settlement statement text" />
                <Submit className="btn btn-ghost">Check</Submit>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------- Activity ----------

export async function ActivityTab({ opp, ws, writable }: { opp: Deal; ws: string; writable: boolean }) {
  const contactIds = [opp.sellerId, ...opp.interests.map((i) => i.contactId)].filter(Boolean) as string[];
  const [interactions, tasks, audits] = await Promise.all([
    db.interaction.findMany({ where: { workspaceId: ws, OR: [{ opportunityId: opp.id }, ...(opp.sellerId ? [{ contactId: opp.sellerId }] : [])] }, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.task.findMany({ where: { workspaceId: ws, OR: [{ entityId: opp.id }, { contactId: { in: contactIds.slice(0, 1) } }] }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 40 }),
    db.auditEvent.findMany({ where: { workspaceId: ws, entityId: opp.id }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {writable && (
          <Card title="Add a note">
            <ActionForm action={addNoteAction} resetOnOk>
              <input type="hidden" name="opportunityId" value={opp.id} />
              {opp.sellerId && <input type="hidden" name="contactId" value={opp.sellerId} />}
              <textarea name="body" rows={3} className="field" placeholder="What happened? e.g. walked the property: roof needs replacing, seller will take 140k if we close in 3 weeks" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="analyse" defaultChecked /> Let AI extract facts and next steps
              </label>
              <Submit className="btn btn-ghost">Add note</Submit>
            </ActionForm>
          </Card>
        )}
        <Card title="Conversations" pad={false}>
          {interactions.length ? <InteractionList items={interactions} /> : <Empty title="No conversations yet" />}
        </Card>
      </div>
      <div className="space-y-5">
        <Card title="Tasks" pad={false}>
          {tasks.length ? (
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="px-4 py-2.5 text-sm">
                  <div className={t.status !== "open" ? "text-muted line-through" : t.priority === 1 ? "font-semibold" : ""}>{t.title}</div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>
                      {t.assignee?.startsWith("agent:") ? "AI" : "Team"} · {t.status === "open" ? fmtDate(t.dueAt, true) : t.result || t.status}
                    </span>
                    {writable && t.status === "open" && (
                      <span className="flex gap-1">
                        <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "done" }} className="text-brand underline">
                          done
                        </ActionButton>
                        <ActionButton action={taskAction} hidden={{ taskId: t.id, what: "cancel" }} className="underline">
                          cancel
                        </ActionButton>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No tasks" />
          )}
        </Card>
        <Card title="Audit trail" pad={false}>
          <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
            {audits.map((a) => (
              <li key={a.id} className="px-4 py-2 text-xs">
                <div className="font-medium">{label(a.action)}</div>
                <div className="text-muted">
                  {a.actor.startsWith("agent:") ? `AI ${a.actor.slice(6)}` : a.actor === "system" ? "System" : "Team"} · {fmtDate(a.createdAt, true)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function InteractionList({ items, writable = false }: { items: { id: string; channel: string; direction: string; createdAt: Date; summary: string | null; body: string | null; outcome: string | null; recordingUrl: string | null; durationSec: number | null; subject: string | null; processedAt: Date | null; intel?: unknown; contact?: { firstName: string; lastName: string; company: string | null } | null }[]; writable?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id} className="px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {i.channel === "call" ? "📞 Call" : i.channel === "sms" ? "💬 Text" : i.channel === "email" ? "✉️ Email" : i.channel === "note" ? "📝 Note" : "⚙️"} {i.direction === "inbound" ? "in" : i.direction === "outbound" ? "out" : ""}
              {i.contact ? ` · ${fullName(i.contact)}` : ""}
            </span>
            <span className="text-xs text-muted">
              {i.outcome && <span className="badge mr-2">{label(i.outcome)}</span>}
              {i.durationSec ? `${Math.round(i.durationSec / 60)} min · ` : ""}
              {fmtDate(i.createdAt, true)}
            </span>
          </div>
          {i.subject && <div className="text-xs font-medium">{i.subject}</div>}
          {i.summary && <p className="mt-1 text-muted">{i.summary}</p>}
          {i.body && i.body !== i.summary && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">{i.channel === "call" ? "Transcript" : "Full text"}</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-soft p-2 text-xs whitespace-pre-wrap">{i.body}</pre>
            </details>
          )}
          {i.recordingUrl && <audio controls preload="none" src={i.recordingUrl} className="mt-2 h-8 w-full" />}
          {(() => {
            const qa = ((i.intel || {}) as { qa?: { score: number; flags: { rule: string; severity: string; quote: string }[] } }).qa;
            if (!qa) return null;
            return (
              <div className={`mt-2 rounded-lg px-2 py-1 text-xs ${qa.flags.some((f) => f.severity === "high") ? "bg-bad-soft text-bad" : "bg-soft text-muted"}`}>
                Call quality {Math.round(qa.score)}/100{qa.flags.length ? ` · ${qa.flags.map((f) => `${f.rule}: “${f.quote.slice(0, 60)}”`).join(" · ")}` : " · no rule issues"}
              </div>
            );
          })()}
          {writable && ["call", "sms", "email"].includes(i.channel) && !i.processedAt && (
            <ActionButton action={reprocessAction} hidden={{ interactionId: i.id }}>
              Analyse
            </ActionButton>
          )}
        </li>
      ))}
    </ul>
  );
}

function Box({ l, v, s, strong }: { l: string; v: string; s?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2">
      <div className="text-xs text-muted">{l}</div>
      <div className={`tnum ${strong ? "text-lg font-semibold text-brand" : "font-medium"}`}>{v}</div>
      {s && <div className="text-xs text-muted">{s}</div>}
    </div>
  );
}

function F({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{l}</span>
      {children}
    </label>
  );
}
