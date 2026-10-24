// CI smoke test: builds the demo against a real Postgres, exercises compliance logic,
// and writes session cookies + every page URL for the HTTP crawl that follows.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ensureWorkspaceDefaults } from "../src/lib/bootstrap";
import { db } from "../src/lib/db";
import { ensureDemoWorkspace } from "../src/lib/demo";
import { checkEligibility } from "../src/lib/eligibility";
import { liveCheck } from "../src/lib/dnc";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fail = (m: string) => {
  console.error(`SMOKE FAIL: ${m}`);
  console.log(`::error title=smoke::${m.replace(/\n/g, " ")}`);
  process.exit(1);
};

async function main() {
  const user = await db.user.create({ data: { email: "owner@smoke.test", name: "Smoke Owner", passwordHash: "x", isPlatformOwner: true, phone: "+17135550999" } });
  const real = await db.workspace.create({ data: { name: "Smoke Co" } });
  await db.membership.create({ data: { workspaceId: real.id, userId: user.id, role: "owner" } });
  await ensureWorkspaceDefaults(real.id);

  let t = Date.now();
  const demo = await ensureDemoWorkspace(user.id);
  console.log(`demo built in ${Date.now() - t} ms`);
  t = Date.now();
  const again = await ensureDemoWorkspace(user.id);
  if (again.id !== demo.id) fail("demo rebuilt on second open");
  console.log(`demo reopened in ${Date.now() - t} ms`);

  const ws = demo.id;
  const counts = {
    deals: await db.opportunity.count({ where: { workspaceId: ws } }),
    sellers: await db.contact.count({ where: { workspaceId: ws, kind: "seller" } }),
    buyers: await db.contact.count({ where: { workspaceId: ws, kind: "buyer" } }),
    interests: await db.buyerInterest.count({ where: { opportunity: { workspaceId: ws } } }),
    interactions: await db.interaction.count({ where: { workspaceId: ws } }),
    contracts: await db.contract.count({ where: { workspaceId: ws } }),
    signedPdfs: await db.contract.count({ where: { workspaceId: ws, finalPdf: { not: null } } }),
    transactions: await db.transaction.count({ where: { workspaceId: ws } }),
    approvalsPending: await db.approval.count({ where: { workspaceId: ws, status: "pending" } }),
    campaigns: await db.campaign.count({ where: { workspaceId: ws } }),
    tasks: await db.task.count({ where: { workspaceId: ws } }),
    payments: await db.payment.count({ where: { workspaceId: ws } }),
    audit: await db.auditEvent.count({ where: { workspaceId: ws } }),
  };
  console.log(counts);
  for (const [k, v] of Object.entries(counts)) if (!v) fail(`demo has no ${k}`);
  const stages = await db.opportunity.groupBy({ by: ["stage"], where: { workspaceId: ws }, _count: true });
  if (stages.length < 14) fail(`demo covers only ${stages.length} stages`);

  // Compliance: no provider configured → cold outreach blocked; consent → allowed.
  await db.statePack.update({ where: { workspaceId_state: { workspaceId: real.id, state: "TX" } }, data: { status: "active" } });
  const c = await db.contact.create({ data: { workspaceId: real.id, kind: "seller", firstName: "Test", phone: "+17135550998", state: "TX" } });
  const daytime = new Date("2026-10-21T19:00:00Z"); // 2pm Houston, a Wednesday
  const cold = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (cold.ok || !/No live DNC check/.test(cold.reason || "")) fail(`cold call without provider should be blocked, got ${JSON.stringify(cold)}`);
  await db.consent.create({ data: { contactId: c.id, channel: "call", evidence: "smoke" } });
  const warm = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (!warm.ok) fail(`consented call should pass, got ${warm.reason}`);
  const night = await checkEligibility(real.id, c.id, "human_call", new Date("2026-10-22T04:00:00Z"));
  if (night.ok || !night.retryAt) fail("night call should be rescheduled");
  const sup = await db.suppression.create({ data: { workspaceId: real.id, kind: "phone", value: "+17135550998", source: "national_dnc" } });
  const listed = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (listed.ok) fail("suppressed number should be blocked");
  await db.suppression.delete({ where: { id: sup.id } });
  const lc = await liveCheck(real.id, "+17135550998", { hasConsent: false });
  if (lc.ok) fail("liveCheck without provider should block cold outreach");
  console.log("compliance checks ok");

  // Round 2: owner's calling hours, cold outreach mode, first-call rule, lists, emails, form, comps only after a price.
  {
    const { callingWindow } = await import("../src/lib/eligibility");
    const { draftPack } = await import("../src/lib/states");
    const pack = draftPack("TX");
    const nineHouston = new Date("2026-10-21T14:00:00Z"); // 9am Houston = 7am Los Angeles
    const w1 = await callingWindow(real.id, { timezone: null, state: "CA", phone: "+17135550998" }, "TX", pack, true, true, nineHouston);
    if (w1.ok) fail("owner living in CA must not be called at 7am their time");
    if (!w1.retryAt || w1.retryAt.toISOString() !== "2026-10-21T16:00:00.000Z") fail(`owner-hours retry should be 9am LA, got ${w1.retryAt?.toISOString()}`);
    const w2 = await callingWindow(real.id, { timezone: null, state: "TX", phone: "+12135550100" }, "TX", pack, true, true, nineHouston);
    if (w2.ok) fail("an LA area code at 7am LA time should wait");
    const w3 = await callingWindow(real.id, { timezone: null, state: "CA", phone: "+17135550998" }, "TX", pack, true, false, nineHouston);
    if (!w3.ok) fail("with the owner-hours switch off, only the property's hours apply");

    const agents = await db.agent.findMany({ where: { workspaceId: real.id, active: true } });
    if (agents.length !== 3) fail(`expected 3 AI callers, got ${agents.map((a) => a.role).join(",")}`);
    const { callStageFor, handleTool } = await import("../src/lib/agents");
    if ((await callStageFor(real.id, { contactId: c.id, requestedRole: "negotiation" })) !== "first") fail("a seller we've never spoken to must get the first-call stage, even when an offer call is asked for");
    const refused = await handleTool(real.id, "get_offer_authority", {}, { metadata: { callStage: "first", opportunityId: "x", contactId: c.id } });
    if (!/first conversation/i.test(String(refused.result))) fail("offer authority must be refused on a first call");

    // Cold outreach mode lifts the consent requirement, nothing else.
    const fresh = await db.contact.create({ data: { workspaceId: real.id, kind: "seller", firstName: "Cold", phone: "+17135550997", state: "TX" } });
    const noConsent = await checkEligibility(real.id, fresh.id, "ai_call", daytime);
    if (noConsent.ok || !/consent/i.test(noConsent.reason || "")) fail(`AI call without consent should need consent, got ${noConsent.reason}`);
    const { getCompliance, saveCompliance } = await import("../src/lib/switches");
    await saveCompliance(real.id, { ...(await getCompliance(real.id)), coldOutreach: true }, user.id);
    const coldOn = await checkEligibility(real.id, fresh.id, "ai_call", daytime);
    if (coldOn.ok || /consent for AI/i.test(coldOn.reason || "") || !/No live DNC check/.test(coldOn.reason || "")) fail(`cold mode should skip consent but keep the DNC check, got ${coldOn.reason}`);
    await saveCompliance(real.id, { ...(await getCompliance(real.id)), coldOutreach: false }, user.id);
    if (!(await db.auditEvent.count({ where: { workspaceId: real.id, action: "compliance_switches" } }))) fail("switch changes must be logged");

    // A PropStream export, recognised and loaded into a new campaign; loading it again finds duplicates.
    const { parseCsv } = await import("../src/lib/csv");
    const { readList, loadSellerLeads } = await import("../src/lib/lists");
    const csv = "Address,City,State,Zip,County,Owner 1 First Name,Owner 1 Last Name,Mailing Address,Mailing City,Mailing State,Mailing Zip,Est. Value,Est. Remaining balance of Open Loans,Phone 1,Phone 1 Type,Phone 2,Email 1\n12 Oak St,Houston,TX,77002,Harris,Ann,Lee,9 Pine Rd,San Diego,CA,92101,\"$210,000\",\"$40,000\",(713) 555-0181,Mobile,7135550182,ann@example.com\n14 Oak St,Houston,TX,77002,Harris,Bo,Diaz,14 Oak St,Houston,TX,77002,$180000,0,7135550183,Landline,,\n,,,,,No,Address,,,,,,,,,,\n";
    const list = readList(parseCsv(csv));
    if (list.format !== "propstream" || list.leads.length !== 2 || list.skipped !== 1) fail(`PropStream export not recognised: ${list.format} ${list.leads.length} ${list.skipped}`);
    const r1 = await loadSellerLeads(real.id, list.leads, { source: "list:propstream", listLabel: "Smoke list", campaign: { mode: "new" }, actor: user.id });
    if (r1.newDeals !== 2 || r1.newContacts !== 2 || !r1.campaignId) fail(`list load wrong: ${JSON.stringify(r1)}`);
    const ann = await db.contact.findFirst({ where: { workspaceId: real.id, phone: "+17135550181" } });
    if (ann?.state !== "CA" || ann.mailingCity !== "San Diego" || ann.source !== "list:propstream" || ann.phone2 !== "+17135550182") fail(`owner's mailing address not used: ${JSON.stringify(ann)}`);
    const annProp = await db.property.findFirst({ where: { workspaceId: real.id, address: "12 Oak St" } });
    if (annProp?.estValue !== 210000 || annProp.loanBalance !== 40000 || !annProp.absentee || !annProp.situations.includes("out_of_state")) fail(`list values not read: ${JSON.stringify(annProp)}`);
    if ((await db.campaignMember.count({ where: { campaignId: r1.campaignId! } })) !== 2) fail("list members not in the campaign");
    const r2 = await loadSellerLeads(real.id, list.leads, { source: "list:propstream", listLabel: "Smoke list again", campaign: { mode: "none" }, actor: user.id });
    if (r2.newContacts !== 0 || r2.duplicates !== 2 || r2.newDeals !== 0) fail(`duplicates not merged: ${JSON.stringify(r2)}`);

    // Sold comparables wait for the seller's price.
    const { runValuation } = await import("../src/lib/valuation");
    const listDeal = await db.opportunity.findFirstOrThrow({ where: { workspaceId: real.id, propertyId: annProp!.id } });
    if (!/Waiting for the seller's price/.test(await runValuation(real.id, listDeal.id, { actor: "system" }))) fail("automatic valuation must wait for the seller's price");

    // Email templates: footer and unsubscribe always present; the unsubscribe link round-trips.
    const em = await import("../src/lib/emails");
    await em.ensureStarterTemplates(real.id);
    const tpl = await db.emailTemplate.findFirstOrThrow({ where: { workspaceId: real.id, audience: "seller", buttonUrl: { not: null } } });
    const r = em.renderEmail(tpl, await em.mergeVars(real.id, { contactId: ann!.id }), { company: "Smoke Co", address: "1 Main St, Houston TX", unsubscribeUrl: `https://x.test/u/${em.unsubToken(ann!.id)}` });
    if (!r.html.includes("Unsubscribe") || !r.html.includes("1 Main St") || !r.text.includes("Unsubscribe:") || !r.subject.includes("12 Oak St")) fail("email footer or merge fields missing");
    if (em.readUnsubToken(em.unsubToken(ann!.id)) !== ann!.id || em.readUnsubToken(`${em.unsubToken(ann!.id)}x`)) fail("unsubscribe token check wrong");
    const blockedEmail = await em.sendTemplateEmail(real.id, { templateId: tpl.id, contactId: ann!.id });
    if (!/postal address/.test(blockedEmail)) fail(`email without a postal address must be blocked, got ${blockedEmail}`);
    await em.unsubscribe(ann!.id, "smoke");
    if ((await checkEligibility(real.id, ann!.id, "email")).ok) fail("unsubscribed email should be blocked");

    // The cash offer form saves consent proof and gives the team a call task.
    const { submitLeadForm } = await import("../src/lib/leadform");
    await submitLeadForm(real.id, { firstName: "Form", lastName: "Lead", phone: "713-555-0190", email: "form@example.com", address: "77 Elm St", city: "Houston", state: "TX", zip: "77003", askingPrice: 150000, timeline: "Within 30 days", condition: "moderate", consent: true, page: "/f/x", ip: "1.2.3.4", userAgent: "smoke" });
    const formLead = await db.contact.findFirstOrThrow({ where: { workspaceId: real.id, phone: "+17135550190" }, include: { consents: true } });
    if (formLead.consents.length !== 4 || !formLead.consents[0].evidence.includes("1.2.3.4") || formLead.source !== "form") fail("form consent proof not saved");
    if (!(await db.task.findFirst({ where: { workspaceId: real.id, contactId: formLead.id, kind: "follow_up" } }))) fail("form lead got no call task");
    console.log("round 2 checks ok");
  }

  // Demo standard: everything works through stand-ins, nothing real is touched.
  {
    const { runDemo } = await import("../src/lib/democtx");
    const { setting } = await import("../src/lib/config");
    const comms = await import("../src/lib/comms");
    if (!(await setting(ws, "RETELL_API_KEY"))?.startsWith("uc-demo-")) fail("demo should have a stand-in Retell key");
    if (await setting(real.id, "RETELL_API_KEY")) fail("real workspace must not get a stand-in key");
    // A seller in the demo that can be texted and called right now (consent, active state, daytime there).
    const target = await db.contact.findFirst({ where: { workspaceId: ws, kind: "seller", doNotContact: false, phone: { not: null }, consents: { some: { channel: "ai_voice" } }, state: { in: ["TX", "FL", "GA", "OH"] } } });
    if (!target) fail("no callable demo seller");
    await db.consent.create({ data: { contactId: target!.id, channel: "sms", evidence: "smoke" } });
    const before = await db.interaction.count({ where: { workspaceId: ws, contactId: target!.id } });
    const now = new Date();
    const sms = await runDemo(ws, () => comms.sendSms(ws, { contactId: target!.id, body: "Smoke: pretend text", skipChecks: true }));
    if (!/^Texted/.test(sms)) fail(`demo text should send through the stand-in, got ${sms}`);
    const call = await runDemo(ws, () => comms.placeCall(ws, { contactId: target!.id, agentRole: "seller_acquisition" })).catch((e) => `error: ${e.message}`);
    console.log("demo call:", call);
    const { claudeJson } = await import("../src/lib/claude");
    const ai = await runDemo(ws, () => claudeJson<{ action: string; reasons: string[] }>(ws, { prompt: "test", schema: { type: "object", properties: { action: { type: "string", enum: ["sign", "pass"] }, reasons: { type: "array", items: { type: "string" } } }, required: ["action", "reasons"] } }));
    if (ai.action !== "sign") fail(`demo AI stand-in answer wrong: ${JSON.stringify(ai)}`);
    await new Promise((r) => setTimeout(r, 14_000));
    const after = await db.interaction.findMany({ where: { workspaceId: ws, contactId: target!.id, createdAt: { gte: now } } });
    if (!after.some((x) => x.channel === "sms" && x.direction === "inbound")) fail("demo text got no pretend reply");
    if (/^Calling/.test(String(call)) && !after.some((x) => x.channel === "call" && x.status === "done")) fail("demo call never finished");
    if (after.length + before < 2) fail("demo flows recorded nothing");
    // Outside demo work, a demo record can't be contacted (public routes never carry the demo flag).
    const blocked = await comms.sendSms(ws, { contactId: target!.id, body: "should not send", skipChecks: true });
    if (!/^Blocked/.test(blocked)) fail("demo record contacted outside demo work");
    console.log("demo stand-ins ok");
    // One-tap outcomes book the right follow-up for a person (never an AI call).
    const { applyCallOutcome } = await import("../src/lib/outcomes");
    await applyCallOutcome(ws, user.id, { contactId: target!.id, outcome: "callback", note: "Smoke: call back tomorrow" });
    const fu = await db.task.findFirst({ where: { workspaceId: ws, contactId: target!.id, kind: "follow_up", status: "open" } });
    if (!fu) fail("callback outcome didn't book a follow-up");
    await applyCallOutcome(ws, user.id, { contactId: target!.id, outcome: "price_high" });
    // Fee received closes a closing deal.
    const closing = await db.opportunity.findFirst({ where: { workspaceId: ws, stage: "CLOSING" } });
    if (closing) {
      const { markFeeReceived } = await import("../src/lib/fees");
      await markFeeReceived(ws, closing.id, 12345, new Date(), user.id);
      const after = await db.opportunity.findUniqueOrThrow({ where: { id: closing.id }, include: { transaction: true } });
      if (after.stage !== "CLOSED" || after.transaction?.netProceeds !== 12345) fail("fee received didn't close the deal");
    }
    console.log("outcomes and fee received ok");
  }

  // Pricing locks: every buyer price respects the deal's own resolved minimum fee.
  const { buyerAuthorityFor, priceImpact } = await import("../src/lib/deals");
  const { dealParams } = await import("../src/lib/valuation");
  const priced = await db.opportunity.findMany({ where: { workspaceId: ws, valuations: { some: { blocked: null } } }, take: 8 });
  for (const o of priced) {
    const prm = await dealParams(ws, o.id);
    const buyer = await db.contact.findFirst({ where: { workspaceId: ws, kind: "buyer" } });
    const a = await buyerAuthorityFor(ws, o.id, buyer!.id, 1);
    const v = await db.valuation.findFirst({ where: { opportunityId: o.id }, orderBy: { createdAt: "desc" } });
    const calc = v!.result as { maxBuy: number; contractPrice: number };
    if (a.offerNow !== null && a.offerNow < Math.min(o.sellerLowest && o.sellerLowest <= calc.maxBuy ? o.sellerLowest : calc.contractPrice, calc.maxBuy) + prm.minFee - 1 && !(o.contractPrice && o.approvedAt)) fail(`buyer price ${a.offerNow} below floor on ${o.id}`);
    const imp = await priceImpact(ws, o.id, calc.maxBuy + 5000);
    if (imp && imp.over !== 5000) fail("price impact over-lock maths");
  }
  console.log(`pricing locks ok on ${priced.length} deals`);

  // Sessions and URLs for the crawl.
  const demoToken = randomBytes(24).toString("base64url");
  const realToken = randomBytes(24).toString("base64url");
  await db.session.create({ data: { id: sha(demoToken), userId: user.id, workspaceId: ws, expiresAt: new Date(Date.now() + 864e5) } });
  await db.session.create({ data: { id: sha(realToken), userId: user.id, workspaceId: real.id, expiresAt: new Date(Date.now() + 864e5) } });

  const urls: string[] = ["/", "/approvals", "/approvals?tab=done", "/alerts", "/deals/new", "/properties", "/properties?tab=properties", "/properties/import", "/buyers", "/buyers/new", "/buyers/import", "/campaigns", "/campaigns/new", "/closing", "/closing?tab=signatures", "/closing?tab=payments", "/ops", "/ops?tab=tasks", "/ops?tab=tasks&who=ai", "/ops?tab=audit", "/ops?tab=system", "/settings", "/settings/integrations", "/settings/rules", "/settings/states", "/settings/agents", "/settings/templates", "/settings/templates/new", "/settings/phones", "/settings/team", "/settings/compliance", "/settings/profile", "/settings/controls", "/dialer", "/settings/autopilot", "/properties/find", "/properties/find?check=1&state=TX&county=Harris&lists=absentee-owner&lists=vacant&take=50&trace=on", "/buyers/find", "/buyers/find?check=1&state=TX&county=Bexar&take=40", "/settings/calling", "/settings/emails", "/settings/emails/new", "/reports", "/reports?days=365"];
  for (const v of ["active", "qualified", "hot", "contract", "leads", "closed", "all"]) urls.push(`/deals?view=${v}`);
  urls.push("/deals?sort=fee&dir=desc", "/deals?cols=property,arv,maxBuy,gapSeller,investorRoom,fee", "/properties?tab=properties&type=sfr", "/properties?situation=probate");
  urls.push("/agents", "/agents?days=7", "/agents/team", "/closing/documents", "/closing/documents/new");
  for (const r of ["seller_acquisition", "buyer_acquisition", "receptionist"]) urls.push(`/agents/${r}`, `/agents/${r}?outcome=positive&flagged=1`);
  for (const t of ["deals", "sellers", "properties", "buyers", "calls", "messages", "payments", "tasks", "title-companies", "audit"]) urls.push(`/api/export/${t}`);
  urls.push("/settings/app");
  {
    // Push alert encryption + signing key round trip (no network).
    const { vapid, encryptPayload } = await import("../src/lib/push");
    const v = await vapid();
    if (Buffer.from(v.publicKey, "base64url").length !== 65) fail("push key wrong length");
    const { createECDH, randomBytes: rb } = await import("node:crypto");
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const body = encryptPayload(ua.getPublicKey().toString("base64url"), rb(16).toString("base64url"), Buffer.from("{}"));
    if (body.length !== 16 + 4 + 1 + 65 + 3 + 16) fail(`push payload size ${body.length}`);
    console.log("push alerts ok");
  }
  urls.push("/recommendations", "/recommendations?tab=hot", "/recommendations?tab=investors", "/recommendations?tab=learned", "/recommendations?mine=1");
  urls.push("/closing/title", "/closing/title/new", "/closing/title?cap=assignments&state=TX", "/closing/title/directory", "/closing/title/directory?state=GA", "/closing/title/directory?state=TX&q=title&county=Harris");
  for (const t of await db.titleCompany.findMany({ where: { workspaceId: ws } })) urls.push(`/closing/title/${t.id}`);
  for (const p of await db.statePack.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/states/${p.state}`);
  for (const a of await db.agent.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/agents/${a.id}`);
  for (const tp of await db.contractTemplate.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/templates/${tp.id}`);
  for (const et of await db.emailTemplate.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/emails/${et.id}`);
  for (const d of await db.opportunity.findMany({ where: { workspaceId: ws }, orderBy: { stage: "asc" }, take: 40 })) for (const tab of ["overview", "numbers", "buyers", "contracts", "closing", "files", "activity"]) urls.push(`/deals/${d.id}?tab=${tab}`);
  for (const ct of await db.contact.findMany({ where: { workspaceId: ws }, take: 60 })) urls.push(`/contacts/${ct.id}`);
  for (const ct of await db.contact.findMany({ where: { workspaceId: ws }, take: 5 })) for (const ch of ["ai_calls", "team_calls", "sms", "email", "note"]) urls.push(`/contacts/${ct.id}?ch=${ch}&lim=200`);
  for (const d of await db.opportunity.findMany({ where: { workspaceId: ws }, take: 5 })) urls.push(`/deals/${d.id}?tab=activity&ch=ai_calls`, `/deals/${d.id}?tab=activity&ch=sms&lim=300`);
  for (const cp of await db.campaign.findMany({ where: { workspaceId: ws } })) urls.push(`/campaigns/${cp.id}`);
  for (const k of await db.contract.findMany({ where: { workspaceId: ws, finalPdf: { not: null } }, take: 3 })) urls.push(`/api/contracts/${k.id}/pdf`);

  // A real signing link for the public signing page.
  const signToken = randomBytes(24).toString("base64url");
  const k = await db.contract.findFirstOrThrow({ where: { workspaceId: ws, status: "sent" }, include: { signers: true } });
  await db.contractSigner.update({ where: { id: k.signers.find((s) => s.role !== "company")!.id }, data: { tokenHash: sha(signToken) } });

  // Offer letters: render, "send" (the demo blocks delivery), and the seller's ready / counter buttons.
  const { letterDefaults, sendOfferLetter, sellerReady, sellerCounter, offerByToken } = await import("../src/lib/offerletter");
  const letterDeals = await db.opportunity.findMany({ where: { workspaceId: ws, sellerId: { not: null }, valuations: { some: { blocked: null } } }, take: 2 });
  const offerTokens: string[] = [];
  for (const d of letterDeals) {
    const f = await letterDefaults(ws, d.id, undefined, { name: "Smoke Test", email: "smoke@example.com", phone: "+12105550100" });
    f.note = "Smoke test – “quotes”, dashes — and a long line ".repeat(8);
    const r = await sendOfferLetter(ws, { opportunityId: d.id, fields: f, actor: user.id, channels: ["email", "sms"], authority: "manual" });
    const o = await db.offer.findUniqueOrThrow({ where: { id: r.offerId } });
    if (!o.pdf || o.pdf.length < 1000) fail("offer letter PDF not rendered");
    offerTokens.push(o.token!);
    urls.push(`/api/offers/${o.id}/pdf`, `/api/offers/preview/${d.id}?price=123456&note=Hello&closingDays=14&asIs=on&letterForm=1`);
  }
  if (offerTokens[0]) {
    await sellerReady(offerTokens[0], "Smoke: ready");
    const o = await offerByToken(offerTokens[0]);
    if (o?.status !== "accepted") fail("seller ready didn't mark the offer accepted");
    const d = await db.opportunity.findUniqueOrThrow({ where: { id: o!.opportunityId } });
    if (d.stage !== "CONTRACT_PREPARATION" || d.contractPrice !== o!.price) fail("seller ready didn't move the deal to contract preparation");
  }
  if (offerTokens[1]) await sellerCounter(offerTokens[1], 199000, "Smoke: can you do 199k?");
  console.log(`offer letters ok (${offerTokens.length})`);

  writeFileSync("smoke-demo-cookie.txt", demoToken);
  writeFileSync("smoke-real-cookie.txt", realToken);
  writeFileSync("smoke-urls.txt", urls.join("\n") + "\n");
  const portal = await db.buyerInterest.findMany({ where: { portalToken: { not: null }, opportunity: { workspaceId: ws } }, take: 4, select: { portalToken: true } });
  writeFileSync("smoke-public-urls.txt", [...portal.map((x) => `/d/${x.portalToken}`), "/d/not-a-real-token-xxxxxxx", "/a/expired-token-xxxxxxxx", `/sign/${signToken}`, "/sign/expired-token", ...offerTokens.flatMap((t) => [`/offer/${t}`, `/offer/${t}?preview=1`, `/api/offer/${t}/pdf`]), "/offer/not-a-real-offer-token", `/f/${ws}`, `/f/${ws}?embed=1`, "/f/not-a-workspace", "/u/preview", "/u/not-a-token", `/u/${(await import("../src/lib/emails")).unsubToken((await db.contact.findFirstOrThrow({ where: { workspaceId: ws, email: { not: null } } })).id)}`, "/login", "/api/health", "/manifest.webmanifest", "/sw.js", "/offline.html", "/icon-192.png", "/apple-touch-icon.png"].join("\n") + "\n");
  console.log(`${urls.length} pages to crawl`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  console.log(`::error title=smoke crash::${String(e instanceof Error ? e.stack || e.message : e).replace(/\n/g, " | ").slice(0, 3000)}`);
  process.exit(1);
});
