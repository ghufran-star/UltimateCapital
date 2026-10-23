import Link from "next/link";
import { label as catLabel, OWNERSHIP_ROLES } from "@/lib/catalog";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Empty, KV, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { checkEligibility } from "@/lib/eligibility";
import { Combo } from "@/components/combo";
import { BUYER_STRATEGIES, CONDITION_TIERS, FUNDING_METHODS, PROPERTY_TYPES, US_STATES } from "@/lib/catalog";
import { can, pageCtx } from "@/lib/session";
import { BUYER_OTHER, BUYER_STATUSES, label } from "@/lib/stages";
import { ago, fmtDate, fullName, usd } from "@/lib/util";
import { addNoteAction, callContactAction, consentAction, dncContactAction, emailContactAction, saveBuyBoxAction, textContactAction, updateContactAction } from "../../../actions/records";
import { InteractionList } from "../../deals/[id]/sections";
import { correctFactAction, editSummaryAction } from "../../../actions/deals";
import { FilesPanel } from "@/components/files";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx();
  const { id } = await params;
  const ws = c.workspace.id;
  const ct = await db.contact.findFirst({
    where: { id, workspaceId: ws },
    include: { buyBoxes: { orderBy: { createdAt: "asc" } }, ownerships: { include: { property: { include: { opportunities: true } } } }, consents: { orderBy: { createdAt: "desc" } }, interests: { include: { opportunity: { include: { property: true } } }, orderBy: { updatedAt: "desc" } } },
  });
  if (!ct) notFound();
  if (c.states.length && ct.kind === "seller" && !ct.ownerships.some((o) => c.states.includes(o.property.state)) && !(ct.state && c.states.includes(ct.state))) notFound();
  const [interactions, facts, tasks, members, checks] = await Promise.all([
    db.interaction.findMany({ where: { workspaceId: ws, contactId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.fact.findMany({ where: { workspaceId: ws, entityType: "contact", entityId: id }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.task.findMany({ where: { workspaceId: ws, contactId: id, status: "open" }, orderBy: { dueAt: "asc" } }),
    db.membership.findMany({ where: { workspaceId: ws }, include: { user: true } }),
    ct.phone ? db.phoneCheck.findMany({ where: { workspaceId: ws, phone: ct.phone }, orderBy: { checkedAt: "desc" }, take: 3 }) : Promise.resolve([]),
  ]);
  const [eCall, eSms] = await Promise.all([checkEligibility(ws, id, "ai_call").catch(() => ({ ok: false, reason: "unknown" })), checkEligibility(ws, id, "sms").catch(() => ({ ok: false, reason: "unknown" }))]);
  const writable = !c.workspace.isDemo && can(c.role, ct.kind === "buyer" ? "buyers" : "sellers");
  const canCall = !c.workspace.isDemo && can(c.role, "calls") && !ct.doNotContact;
  const isBuyer = ct.kind === "buyer";
  const current = facts.filter((f) => !f.supersededAt);

  return (
    <div>
      <PageHeader
        back={{ href: isBuyer ? "/buyers" : "/properties", label: isBuyer ? "Buyers" : "Sellers" }}
        title={fullName(ct) || "Unnamed"}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span className="badge">{label(ct.kind)}</span>
            {ct.doNotContact ? <span className="badge badge-bad">Do not contact</span> : <StatusBadge s={isBuyer ? ct.buyerStatus : ct.sellerStatus} />}
            {ct.phone} {ct.email && `· ${ct.email}`}
          </span>
        }
        actions={
          canCall ? (
            <>
              <ActionButton action={callContactAction} hidden={{ contactId: id, mode: "me" }} className="btn btn-primary">
                📞 Call
              </ActionButton>
              <ActionButton action={callContactAction} hidden={{ contactId: id, mode: "ai" }} className="btn btn-ghost">
                🤖 AI call
              </ActionButton>
            </>
          ) : null
        }
      />
      {!ct.doNotContact && (!eCall.ok || !eSms.ok) && (
        <div className="mb-4">
          <Notice tone="info">
            {!eCall.ok && <>AI calls: {eCall.reason}. </>}
            {!eSms.ok && <>Texts: {eSms.reason}.</>}
          </Notice>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {(ct.summary || writable) && (
            <Card title="Where things stand">
              {ct.summary ? <p className="text-sm">{ct.summary}</p> : <p className="text-sm text-muted">No summary yet: it&apos;s written after the first conversation.</p>}
              {ct.openQuestions.length > 0 && (
                <ul className="mt-2 ml-4 list-disc text-sm text-muted">
                  {ct.openQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              )}
              {writable && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-brand">Edit what the AI wrote</summary>
                  <ActionForm action={editSummaryAction} className="mt-2 space-y-2">
                    <input type="hidden" name="contactId" value={id} />
                    <textarea name="summary" defaultValue={ct.summary ?? ""} rows={2} className="field" />
                    <textarea name="openQuestions" defaultValue={ct.openQuestions.join("\n")} rows={3} className="field" placeholder="Open questions, one per line" />
                    <Submit className="btn btn-ghost btn-sm">Save</Submit>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}

          {isBuyer && (
            <Card title="Buy boxes">
              <div className="space-y-3">
                {[...ct.buyBoxes, null].map((bb, i) => (
                  <details key={bb?.id || "new"} className="rounded-xl border border-line" open={i === 0 && !!bb}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                      {bb ? `${bb.name}${bb.active ? "" : " (paused)"} · ${[...bb.markets, ...bb.states].join(", ") || "anywhere"} · up to ${usd(bb.maxPrice)}` : "+ Add a buy box"}
                    </summary>
                    <div className="border-t border-line p-4">
                      <ActionForm action={saveBuyBoxAction}>
                        <input type="hidden" name="contactId" value={id} />
                        {bb && <input type="hidden" name="buyBoxId" value={bb.id} />}
                        <div className="grid gap-3 md:grid-cols-3">
                          <F l="Name">
                            <input name="name" defaultValue={bb?.name || "Buy box"} className="field" />
                          </F>
                          <F l="States">
                            <Combo name="states" options={US_STATES} defaultValue={bb?.states} multiple joined placeholder="All states" />
                          </F>
                          <F l="Markets (cities)">
                            <input name="markets" defaultValue={bb?.markets.join(", ")} className="field" placeholder="Houston, Katy" />
                          </F>
                          <F l="ZIPs">
                            <input name="zips" defaultValue={bb?.zips.join(", ")} className="field" />
                          </F>
                          <F l="Excluded ZIPs">
                            <input name="excludedZips" defaultValue={bb?.excludedZips.join(", ")} className="field" />
                          </F>
                          <F l="Strategy">
                            <Combo name="strategy" options={BUYER_STRATEGIES} defaultValue={bb?.strategy || "any"} />
                          </F>
                          <F l="Min price">
                            <input name="minPrice" defaultValue={bb?.minPrice ?? ""} className="field" inputMode="numeric" />
                          </F>
                          <F l="Max price">
                            <input name="maxPrice" defaultValue={bb?.maxPrice ?? ""} className="field" inputMode="numeric" />
                          </F>
                          <F l="Worst condition accepted">
                            <Combo name="maxCondition" options={CONDITION_TIERS} defaultValue={bb?.maxCondition} emptyLabel="Any condition" placeholder="Any condition" />
                          </F>
                          <F l="Min beds">
                            <input name="minBeds" defaultValue={bb?.minBeds ?? ""} className="field" inputMode="numeric" />
                          </F>
                          <F l="Min baths">
                            <input name="minBaths" defaultValue={bb?.minBaths ?? ""} className="field" inputMode="decimal" />
                          </F>
                          <F l="Min sq ft">
                            <input name="minSqft" defaultValue={bb?.minSqft ?? ""} className="field" inputMode="numeric" />
                          </F>
                          <F l="Min profit %">
                            <input name="minProfitPct" defaultValue={bb?.minProfitPct != null ? Math.round(bb.minProfitPct * 1000) / 10 : ""} className="field" inputMode="decimal" />
                          </F>
                          <F l="Min net profit $">
                            <input name="minNetProfit" defaultValue={bb?.minNetProfit ?? ""} className="field" inputMode="numeric" />
                          </F>
                          <F l="Profit measured on">
                            <select name="profitBasis" defaultValue={bb?.profitBasis || "net"} className="field">
                              <option value="net">Net</option>
                              <option value="gross">Gross</option>
                              <option value="both">Both</option>
                            </select>
                          </F>
                          <F l="Min cap rate % (rentals)">
                            <input name="minCapRate" defaultValue={bb?.minCapRate != null ? Math.round(bb.minCapRate * 1000) / 10 : ""} className="field" inputMode="decimal" />
                          </F>
                        </div>
                        <F l="Property types they buy (blank = any)">
                          <Combo name="propertyTypes" options={PROPERTY_TYPES} defaultValue={bb?.propertyTypes} multiple placeholder="Any type" />
                        </F>
                        <div className="flex flex-wrap gap-x-4 text-sm">
                          {["vacant", "tenant", "owner"].map((o) => (
                            <label key={o} className="flex items-center gap-1">
                              <input type="checkbox" name="occupancyOk" value={o} defaultChecked={!bb || bb.occupancyOk.length === 0 || bb.occupancyOk.includes(o)} /> {label(o)} OK
                            </label>
                          ))}
                          <label className="flex items-center gap-1">
                            <select name="active" defaultValue={bb?.active === false ? "off" : "on"} className="rounded-md border border-line bg-card px-1 text-xs">
                              <option value="on">Active</option>
                              <option value="off">Paused</option>
                            </select>
                          </label>
                        </div>
                        <F l="Notes">
                          <input name="notes" defaultValue={bb?.notes ?? ""} className="field" />
                        </F>
                        {writable && (
                          <div className="flex gap-2">
                            <Submit>Save buy box</Submit>
                          </div>
                        )}
                      </ActionForm>
                      {writable && bb && (
                        <div className="mt-2">
                          <ActionButton action={saveBuyBoxAction} hidden={{ contactId: id, buyBoxId: bb.id, delete: "1" }} confirm="Delete this buy box?" className="text-xs text-bad underline">
                            Delete
                          </ActionButton>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}

          {isBuyer ? (
            <Card title="Deals presented" pad={false}>
              {ct.interests.length ? (
                <table className="data">
                  <tbody>
                    {ct.interests.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link href={`/deals/${i.opportunityId}?tab=buyers`} className="font-medium hover:text-brand">
                            {i.opportunity.property.address}
                          </Link>
                          <div className="text-xs text-muted">fit {i.fitScore}</div>
                        </td>
                        <td>
                          <StatusBadge s={i.stage} />
                          {i.serious && <span className="badge badge-hot ml-1">Serious</span>}
                        </td>
                        <td className="text-right tnum">{usd(i.priceMentioned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="No deals presented yet" />
              )}
            </Card>
          ) : (
            <Card title="Properties" pad={false}>
              {ct.ownerships.length ? (
                <ul className="divide-y divide-line">
                  {ct.ownerships.map((o) => (
                    <li key={o.id}>
                      <Link href={o.property.opportunities[0] ? `/deals/${o.property.opportunities[0].id}` : "#"} className="flex items-center justify-between px-4 py-3 hover:bg-soft">
                        <span>
                          <span className="font-medium">{o.property.address}</span>
                          <span className="block text-xs text-muted">
                            {o.property.city}, {o.property.state} · {catLabel(OWNERSHIP_ROLES, o.role)}
                          </span>
                        </span>
                        {o.property.opportunities[0] && <StatusBadge s={o.property.opportunities[0].stage} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No properties linked" />
              )}
            </Card>
          )}

          <Card title={isBuyer ? "Documents (proof of funds, entity docs)" : "Documents and photos"}>
            <FilesPanel ws={ws} entityType="contact" entityId={id} writable={writable} />
          </Card>

          <Card title="Conversations" pad={false}>
            {canCall && (
              <div className="grid gap-3 border-b border-line p-4 md:grid-cols-2">
                <ActionForm action={textContactAction} resetOnOk className="space-y-2">
                  <input type="hidden" name="contactId" value={id} />
                  <textarea name="body" rows={2} className="field" placeholder="Text message…" />
                  <Submit className="btn btn-ghost btn-sm">Send text</Submit>
                </ActionForm>
                <ActionForm action={emailContactAction} resetOnOk className="space-y-2">
                  <input type="hidden" name="contactId" value={id} />
                  <input name="subject" className="field" placeholder="Email subject" />
                  <textarea name="body" rows={2} className="field" placeholder="Email…" />
                  <Submit className="btn btn-ghost btn-sm">Send email</Submit>
                </ActionForm>
              </div>
            )}
            {interactions.length ? <InteractionList items={interactions} writable={writable} /> : <Empty title="No conversations yet" />}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Profile">
            <ActionForm action={updateContactAction}>
              <input type="hidden" name="contactId" value={id} />
              <div className="grid grid-cols-2 gap-2">
                <F l="First name">
                  <input name="firstName" defaultValue={ct.firstName} className="field" />
                </F>
                <F l="Last name">
                  <input name="lastName" defaultValue={ct.lastName} className="field" />
                </F>
              </div>
              <F l="Company">
                <input name="company" defaultValue={ct.company ?? ""} className="field" />
              </F>
              <div className="grid grid-cols-2 gap-2">
                <F l="Phone">
                  <input name="phone" defaultValue={ct.phone ?? ""} className="field" />
                </F>
                <F l="Phone 2">
                  <input name="phone2" defaultValue={ct.phone2 ?? ""} className="field" />
                </F>
              </div>
              <F l="Email">
                <input name="email" defaultValue={ct.email ?? ""} className="field" />
              </F>
              <div className="grid grid-cols-2 gap-2">
                <F l="City">
                  <input name="city" defaultValue={ct.city ?? ""} className="field" />
                </F>
                <F l="State">
                  <Combo name="state" options={US_STATES} defaultValue={ct.state} emptyLabel="None" placeholder="State" />
                </F>
              </div>
              <F l="Assigned to">
                <select name="assigneeId" defaultValue={ct.assigneeId ?? ""} className="field">
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              </F>
              {isBuyer ? (
                <>
                  <F l="Status">
                    <select name="buyerStatus" defaultValue={ct.buyerStatus ?? "NEW"} className="field">
                      {[...BUYER_STATUSES, ...BUYER_OTHER].map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </F>
                  <div className="grid grid-cols-2 gap-2">
                    <F l="Buys per month">
                      <input name="buyingPerMonth" defaultValue={ct.buyingPerMonth ?? ""} className="field" inputMode="decimal" />
                    </F>
                    <F l="Not buying until">
                      <input type="date" name="nextBuyingAt" defaultValue={ct.nextBuyingAt ? ct.nextBuyingAt.toISOString().slice(0, 10) : ""} className="field" />
                    </F>
                    <F l="Max deals / week">
                      <input name="maxDealsPerWeek" defaultValue={ct.maxDealsPerWeek ?? ""} className="field" inputMode="numeric" />
                    </F>
                    <F l="Max deals / month">
                      <input name="maxDealsPerMonth" defaultValue={ct.maxDealsPerMonth ?? ""} className="field" inputMode="numeric" />
                    </F>
                    <F l="Closes in (days)">
                      <input name="closingSpeedDays" defaultValue={ct.closingSpeedDays ?? ""} className="field" inputMode="numeric" />
                    </F>
                    <F l="Prefers">
                      <select name="preferredChannel" defaultValue={ct.preferredChannel ?? ""} className="field">
                        <option value="">Any</option>
                        <option value="call">Call</option>
                        <option value="sms">Text</option>
                        <option value="email">Email</option>
                      </select>
                    </F>
                  </div>
                  <F l="Funding">
                    <Combo name="fundingMethod" options={FUNDING_METHODS} defaultValue={ct.fundingMethod} emptyLabel="Unknown" placeholder="Unknown" />
                  </F>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="fundsVerified" defaultChecked={ct.fundsVerified} /> Proof of funds verified
                  </label>
                </>
              ) : (
                <F l="Seller status">
                  <input name="sellerStatus" defaultValue={ct.sellerStatus ?? ""} className="field" />
                </F>
              )}
              <F l="Tags">
                <input name="tags" defaultValue={ct.tags.join(", ")} className="field" />
              </F>
              <F l="Notes">
                <textarea name="notes" defaultValue={ct.notes ?? ""} rows={3} className="field" />
              </F>
              {writable && <Submit>Save</Submit>}
            </ActionForm>
          </Card>

          {isBuyer && (
            <Card title="Contact limits">
              <KV items={[["Ignored in a row", ct.ignoredInRow], ["Deals closed", ct.dealsClosed], ["Reliability", `${ct.reliability}/100`], ["Last contact", ct.lastContactAt ? ago(ct.lastContactAt) : "never"]]} />
            </Card>
          )}

          <Card title="What we know">
            {current.length ? (
              <ul className="space-y-1.5 text-sm">
                {current.slice(0, 25).map((f) => (
                  <li key={f.id}>
                    <span className="text-muted">{label(f.field)}:</span> {typeof f.value === "string" ? f.value : JSON.stringify(f.value)}
                    <span className={`ml-1 text-xs ${f.kind === "verified" ? "text-brand" : "text-muted"}`}>({f.kind})</span>
                    {f.conflictsWith && <span className="ml-1 text-xs text-warn">conflicts</span>}
                    {writable && (
                      <details className="inline-block">
                        <summary className="ml-1 inline cursor-pointer text-xs text-brand">correct</summary>
                        <ActionForm action={correctFactAction} className="mt-1 flex gap-1">
                          <input type="hidden" name="factId" value={f.id} />
                          <input name="value" defaultValue={typeof f.value === "string" ? f.value : JSON.stringify(f.value)} className="field py-1 text-xs" />
                          <Submit className="btn btn-ghost btn-sm">Save</Submit>
                        </ActionForm>
                        <ActionButton action={correctFactAction} hidden={{ factId: f.id, remove: "1" }} className="text-xs text-bad underline" confirm="Remove this fact? It stays in the history.">
                          remove
                        </ActionButton>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Facts from calls and notes appear here, with where they came from.</p>
            )}
            {writable && (
              <ActionForm action={correctFactAction} className="mt-3 flex flex-wrap gap-1" resetOnOk>
                <input type="hidden" name="entityType" value="contact" />
                <input type="hidden" name="entityId" value={id} />
                <input name="field" className="field w-32 py-1 text-xs" placeholder="What (e.g. roof age)" />
                <input name="value" className="field flex-1 py-1 text-xs" placeholder="Value" />
                <Submit className="btn btn-ghost btn-sm">Add fact</Submit>
              </ActionForm>
            )}
          </Card>

          <Card title="Consent & DNC">
            <div className="mb-3 space-y-1 text-sm">
              {checks.length ? (
                checks.map((k) => (
                  <div key={k.id}>
                    {k.blocked ? "⛔" : "✓"} {k.provider}: {k.blocked ? k.reason || "blocked" : "clean"}
                    {k.lineType ? ` · ${k.lineType}` : ""} <span className="text-xs text-muted">· {ago(k.checkedAt)}</span>
                  </div>
                ))
              ) : (
                <div className="text-muted">Not checked against DNC lists yet (happens automatically before the first call or text).</div>
              )}
            </div>
            <ul className="mb-3 space-y-1 text-sm">
              {ct.consents.length ? (
                ct.consents.map((x) => (
                  <li key={x.id}>
                    {x.granted ? "✓" : "✗"} {label(x.channel)} <span className="text-xs text-muted">· {x.evidence} · {fmtDate(x.createdAt)}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted">No consent on record.</li>
              )}
            </ul>
            {writable && (
              <ActionForm action={consentAction} resetOnOk>
                <input type="hidden" name="contactId" value={id} />
                <select name="channel" className="field">
                  <option value="ai_voice">AI voice calls</option>
                  <option value="sms">Text messages</option>
                  <option value="call">Calls</option>
                  <option value="email">Email</option>
                </select>
                <input name="evidence" className="field" placeholder="How given: e.g. web form 10/20, recorded call" />
                <Submit className="btn btn-ghost btn-sm">Record consent</Submit>
              </ActionForm>
            )}
            {writable && !ct.doNotContact && (
              <div className="mt-3">
                <ActionButton action={dncContactAction} hidden={{ contactId: id }} className="btn btn-danger btn-sm" confirm="Stop all contact with this person? This adds them to your internal DNC list.">
                  Mark do-not-contact
                </ActionButton>
              </div>
            )}
          </Card>

          <Card title={`Open tasks (${tasks.length})`}>
            <ul className="space-y-1 text-sm">
              {tasks.map((t) => (
                <li key={t.id}>
                  {t.title} <span className="text-xs text-muted">· {fmtDate(t.dueAt, true)}</span>
                </li>
              ))}
            </ul>
            {writable && (
              <ActionForm action={addNoteAction} resetOnOk className="mt-3 space-y-2">
                <input type="hidden" name="contactId" value={id} />
                <textarea name="body" rows={2} className="field" placeholder="Add a note" />
                <input type="hidden" name="analyse" value="on" />
                <Submit className="btn btn-ghost btn-sm">Add note</Submit>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
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
