import { json } from "./audit";
import { ensureWorkspaceDefaults } from "./bootstrap";
import { db } from "./db";
import { calculate, DEFAULT_PARAMS, DEFAULT_PLAYBOOK, estimateRepairs, tiersFromOverall, Tier } from "./rules";
import { DEFAULT_TITLE_CHECKLIST } from "./stages";
import { draftPack } from "./states";

// The demo workspace: realistic sample data at every stage. View-only, never contacts anyone.

const DEMO_NAME = "Demo · Sample Wholesaling Co";

const BUYERS = [
  { first: "Marcus", last: "Reed", company: "Reed Home Flips LLC", phone: "+17135550101", email: "marcus@example.com", per: 3, funds: true, rel: 80, closed: 6, box: { name: "Houston flips", markets: ["Houston"], types: ["sfr"], strategy: "flip", max: 220000, cond: "heavy", pct: 0.15 } },
  { first: "Priya", last: "Shah", company: "Shah Rentals", phone: "+17135550102", email: "priya@example.com", per: 1, funds: true, rel: 70, closed: 3, box: { name: "Houston rentals", markets: ["Houston"], types: ["sfr", "2_4"], strategy: "rental", max: 180000, cond: "moderate", pct: 0.12 } },
  { first: "Diego", last: "Morales", company: "Alamo Capital Partners", phone: "+12105550103", email: "diego@example.com", per: 2, funds: true, rel: 65, closed: 2, box: { name: "San Antonio flips", markets: ["San Antonio"], types: ["sfr"], strategy: "flip", max: 200000, cond: "gut", pct: 0.15 } },
  { first: "Hannah", last: "Brooks", company: null, phone: "+17135550104", email: "hannah@example.com", per: 0.5, funds: false, rel: 45, closed: 0, box: { name: "First flip", markets: ["Houston"], types: ["sfr"], strategy: "flip", max: 150000, cond: "cosmetic", pct: 0.2 } },
  { first: "Tom", last: "Nguyen", company: "Bayou Holdings", phone: "+17135550105", email: "tom@example.com", per: 4, funds: true, rel: 85, closed: 11, box: { name: "Any Houston / SA", markets: ["Houston", "San Antonio"], types: ["sfr", "2_4", "condo_th"], strategy: "any", max: 300000, cond: "gut", pct: 0.13 } },
  { first: "Grace", last: "Kim", company: "GK Investments", phone: "+12105550106", email: "grace@example.com", per: 1, funds: true, rel: 60, closed: 1, box: { name: "SA duplexes", markets: ["San Antonio"], types: ["2_4"], strategy: "rental", max: 260000, cond: "moderate", pct: 0.1 } },
];

const DEALS: {
  seller: [string, string, string];
  addr: [string, string, string, string];
  home: { beds: number; baths: number; sqft: number; year: number; type: string; occ: string; tier: Tier };
  arv: number;
  stage: string;
  exception?: string;
  asking: number;
  lowest?: number;
  motivation: string;
  timeline: string;
  hot?: number;
  summary: string;
}[] = [
  { seller: ["Linda", "Carter", "+17135550201"], addr: ["4812 Oak Hollow Dr", "Houston", "TX", "77088"], home: { beds: 3, baths: 2, sqft: 1420, year: 1978, type: "sfr", occ: "vacant", tier: "moderate" }, arv: 245000, stage: "NEGOTIATION", exception: "APPROVAL_REQUIRED", asking: 140000, lowest: 126000, motivation: "Inherited from her mother; lives out of state", timeline: "Within 30 days", hot: 78, summary: "Inherited, vacant, wants it sold fast. Came down to $126K; close to our numbers." },
  { seller: ["Robert", "Hayes", "+12105550202"], addr: ["227 Mission Ridge", "San Antonio", "TX", "78221"], home: { beds: 3, baths: 1, sqft: 1180, year: 1962, type: "sfr", occ: "tenant", tier: "heavy" }, arv: 205000, stage: "DISPOSITION", asking: 95000, lowest: 92000, motivation: "Tired landlord, tenant behind on rent", timeline: "60 days", hot: 64, summary: "Under contract at $92K. Marketing to buyers with disclosure." },
  { seller: ["Angela", "Price", "+17135550203"], addr: ["9106 Pinecrest Ln", "Houston", "TX", "77016"], home: { beds: 4, baths: 2, sqft: 1690, year: 1985, type: "sfr", occ: "owner", tier: "cosmetic" }, arv: 268000, stage: "PROPERTY_DISCOVERY", asking: 190000, motivation: "Relocating for work", timeline: "Flexible, 2–3 months", summary: "Open to an offer; walking through condition room by room." },
  { seller: ["James", "Walker", "+17135550204"], addr: ["1550 Bellfort Ave", "Houston", "TX", "77087"], home: { beds: 2, baths: 1, sqft: 980, year: 1955, type: "sfr", occ: "vacant", tier: "gut" }, arv: 168000, stage: "OFFER_READY", asking: 70000, lowest: 65000, motivation: "Fire damage, can't afford repairs", timeline: "ASAP", summary: "Fire-damaged, motivated. Offer ready to present." },
  { seller: ["Maria", "Lopez", "+12105550205"], addr: ["338 Rosewood Ct", "San Antonio", "TX", "78207"], home: { beds: 2, baths: 2, sqft: 1600, year: 1972, type: "2_4", occ: "tenant", tier: "moderate" }, arv: 290000, stage: "CLOSING", asking: 175000, lowest: 168000, motivation: "Retiring, selling rental portfolio", timeline: "Closing booked", hot: 85, summary: "Assigned to Tom Nguyen. Closing next week." },
  { seller: ["Kevin", "Brown", "+17135550206"], addr: ["7210 Wild Pine St", "Houston", "TX", "77044"], home: { beds: 3, baths: 2, sqft: 1510, year: 2004, type: "sfr", occ: "owner", tier: "cosmetic" }, arv: 255000, stage: "ENGAGED", asking: 230000, motivation: "Divorce, needs to split proceeds", timeline: "Unsure", summary: "Interested but price expectations high. Callback booked." },
];

export async function ensureDemoWorkspace(userId: string) {
  let ws = await db.workspace.findFirst({ where: { isDemo: true } });
  if (ws) {
    await db.membership.upsert({ where: { workspaceId_userId: { workspaceId: ws.id, userId } }, create: { workspaceId: ws.id, userId, role: "owner" }, update: {} });
    return ws;
  }
  ws = await db.workspace.create({ data: { name: DEMO_NAME, isDemo: true } });
  await db.membership.create({ data: { workspaceId: ws.id, userId, role: "owner" } });
  await seed(ws.id, userId);
  return ws;
}

export async function resetDemo(userId: string) {
  const ws = await db.workspace.findFirst({ where: { isDemo: true } });
  if (ws) await db.workspace.delete({ where: { id: ws.id } });
  return ensureDemoWorkspace(userId);
}

async function seed(ws: string, userId: string) {
  await ensureWorkspaceDefaults(ws);
  const { encrypt } = await import("./config");
  await db.setting.create({ data: { workspaceId: ws, key: "COMPANY_NAME", value: encrypt("Sample Wholesaling Co") } });
  await db.statePack.update({
    where: { workspaceId_state: { workspaceId: ws, state: "TX" } },
    data: { status: "active", approvedBy: userId, approvedAt: new Date(), data: json({ ...draftPack("TX"), contracts: { ...draftPack("TX").contracts, optionPeriodDays: 10, typicalEmd: 1000 } }) },
  });
  await db.phoneNumber.createMany({ data: [{ workspaceId: ws, number: "+17135550100", market: "Houston", state: "TX" }, { workspaceId: ws, number: "+12105550100", market: "San Antonio", state: "TX" }] });
  const tc = await db.titleCompany.create({ data: { workspaceId: ws, name: "Lone Star Title (sample)", state: "TX", email: "closer@example.com", phone: "+17135550300", fees: "Escrow $450, title policy per promulgated rates", turnaround: "Commitment in 5 business days", wireVerifiedPhone: "+17135550300", contacts: json([{ name: "Rachel Green", role: "Escrow officer", email: "closer@example.com", phone: "+17135550300" }]) } });

  // Buyers
  const buyerIds: string[] = [];
  for (const b of BUYERS) {
    const c = await db.contact.create({
      data: {
        workspaceId: ws,
        kind: "buyer",
        firstName: b.first,
        lastName: b.last,
        company: b.company,
        phone: b.phone,
        email: b.email,
        state: "TX",
        buyerStatus: b.funds ? "ACTIVE" : "QUALIFYING",
        fundsVerified: b.funds,
        fundingMethod: b.funds ? "cash" : "hard_money",
        closingSpeedDays: b.funds ? 14 : 30,
        buyingPerMonth: b.per,
        reliability: b.rel,
        dealsClosed: b.closed,
        preferredChannel: "sms",
        summary: `${b.box.strategy === "rental" ? "Buy-and-hold" : "Flipper"} buying ${b.box.markets.join(" & ")} up to $${b.box.max.toLocaleString()}.`,
        lastContactAt: new Date(Date.now() - (2 + buyerIds.length) * 864e5),
        buyBoxes: { create: { name: b.box.name, states: ["TX"], markets: b.box.markets, propertyTypes: b.box.types, strategy: b.box.strategy, maxPrice: b.box.max, maxCondition: b.box.cond, minProfitPct: b.box.pct, profitBasis: "net" } },
      },
    });
    buyerIds.push(c.id);
    await db.consent.create({ data: { contactId: c.id, channel: "sms", evidence: "Sample: opted in on website form" } });
  }

  // Sellers, properties, deals
  for (const [i, d] of DEALS.entries()) {
    const seller = await db.contact.create({
      data: { workspaceId: ws, kind: "seller", firstName: d.seller[0], lastName: d.seller[1], phone: d.seller[2], state: "TX", city: d.addr[1], sellerStatus: d.stage, summary: d.summary, lastContactAt: new Date(Date.now() - i * 864e5), openQuestions: d.stage === "PROPERTY_DISCOVERY" ? ["Roof age", "Any foundation issues?", "HVAC age"] : [] },
    });
    await db.consent.create({ data: { contactId: seller.id, channel: "ai_voice", evidence: "Sample: requested a callback via web form" } });
    const prop = await db.property.create({
      data: {
        workspaceId: ws,
        address: d.addr[0],
        city: d.addr[1],
        state: d.addr[2],
        zip: d.addr[3],
        county: d.addr[1] === "Houston" ? "Harris" : "Bexar",
        propertyType: d.home.type,
        beds: d.home.beds,
        baths: d.home.baths,
        sqft: d.home.sqft,
        yearBuilt: d.home.year,
        occupancy: d.home.occ,
        conditionTier: d.home.tier,
        ownerships: { create: { contactId: seller.id, role: "owner", verified: d.stage !== "ENGAGED" } },
      },
    });
    const contractPrice = ["DISPOSITION", "CLOSING"].includes(d.stage) ? d.lowest : null;
    const opp = await db.opportunity.create({
      data: {
        workspaceId: ws,
        propertyId: prop.id,
        sellerId: seller.id,
        stage: d.stage,
        exception: d.exception,
        askingPrice: d.asking,
        sellerLowest: d.lowest,
        motivation: d.motivation,
        timeline: d.timeline,
        decisionMakers: "Owner only",
        exitStrategy: d.home.type === "2_4" ? "rental" : "flip",
        hotScore: d.hot || 0,
        contractPrice,
        approvedAt: contractPrice ? new Date(Date.now() - 10 * 864e5) : null,
        verificationSentAt: d.exception === "APPROVAL_REQUIRED" ? new Date() : null,
      },
    });
    if (!["ENGAGED"].includes(d.stage)) {
      const rep = estimateRepairs(DEFAULT_PLAYBOOK, tiersFromOverall(DEFAULT_PLAYBOOK, d.home.tier), DEFAULT_PARAMS, { sqft: d.home.sqft, baths: d.home.baths });
      const calc = calculate({ arv: d.arv, repairs: rep.likely, params: DEFAULT_PARAMS, contractPrice });
      await db.valuation.create({
        data: {
          opportunityId: opp.id,
          ruleVersion: 1,
          arv: d.arv,
          asIs: Math.round(d.arv * 0.62),
          rent: Math.round(d.arv * 0.0085),
          repairsLow: rep.low,
          repairsLikely: rep.likely,
          repairsHigh: rep.high,
          repairItems: json(rep.lines),
          comps: json([
            { address: `${100 + i * 7} Sample St, ${d.addr[1]}`, price: Math.round(d.arv * 1.02), sqft: d.home.sqft + 60, date: "2026-08-14", source: "Sample data" },
            { address: `${220 + i * 5} Example Ave, ${d.addr[1]}`, price: Math.round(d.arv * 0.97), sqft: d.home.sqft - 40, date: "2026-07-02", source: "Sample data" },
            { address: `${310 + i * 3} Demo Rd, ${d.addr[1]}`, price: Math.round(d.arv), sqft: d.home.sqft, date: "2026-09-21", source: "Sample data" },
          ]),
          result: json(calc),
          confidence: 0.72,
        },
      });
      await db.offer.create({ data: { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 1, price: d.asking, by: "them" } });
      if (d.lowest) {
        await db.offer.create({ data: { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 2, price: calc.sellerOffers[0], by: "us", authority: "rule" } });
        await db.offer.create({ data: { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 3, price: d.lowest, by: "them" } });
      }
    }
    // A conversation per seller
    await db.interaction.create({
      data: {
        workspaceId: ws,
        contactId: seller.id,
        opportunityId: opp.id,
        channel: "call",
        direction: "outbound",
        provider: "retell",
        status: "done",
        outcome: "info_gathered",
        durationSec: 240 + i * 30,
        summary: d.summary,
        body: `Agent: Hi, is this ${d.seller[0]}? This is Alex with Sample Wholesaling Co. Just so you know, I'm an AI assistant calling on behalf of the company. We buy houses as-is in ${d.addr[1]}. Would you ever consider an offer on ${d.addr[0]}?\n${d.seller[0]}: Maybe. ${d.motivation}.\nAgent: I understand. What kind of timeline would work for you?\n${d.seller[0]}: ${d.timeline}.\nAgent: And roughly what price did you have in mind?\n${d.seller[0]}: I was hoping for around $${d.asking.toLocaleString()}.`,
        processedAt: new Date(),
        createdAt: new Date(Date.now() - (i + 1) * 864e5),
      },
    });
    for (const [k, v] of Object.entries({ motivation: d.motivation, timeline: d.timeline, asking_price: `$${d.asking.toLocaleString()}` })) {
      await db.fact.create({ data: { workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: k, value: json(v), kind: "reported", confidence: 0.8 } });
    }
    // Buyer interest on later-stage deals
    if (["NEGOTIATION", "DISPOSITION", "CLOSING"].includes(d.stage)) {
      const matches = buyerIds.filter((_, bi) => BUYERS[bi].box.markets.includes(d.addr[1]));
      for (const [k, bid] of matches.entries()) {
        const stage = d.stage === "CLOSING" && k === matches.length - 1 ? "AGREEMENT_EXECUTED" : k === 0 ? "INTERESTED" : k === 1 ? "OFFER_SUBMITTED" : "PRESENTED";
        await db.buyerInterest.create({
          data: {
            opportunityId: opp.id,
            contactId: bid,
            fitScore: 90 - k * 8,
            stage,
            serious: ["INTERESTED", "OFFER_SUBMITTED", "AGREEMENT_EXECUTED"].includes(stage),
            priceMentioned: stage === "OFFER_SUBMITTED" ? Math.round((d.lowest || d.asking) * 1.2) : null,
            presentedAt: new Date(Date.now() - 2 * 864e5),
            respondedAt: stage !== "PRESENTED" ? new Date(Date.now() - 1.8 * 864e5) : null,
            reasons: json(["✓ fits buy box", "✓ investor net above minimum", BUYERS[buyerIds.indexOf(bid)].funds ? "✓ funds verified" : "• funds not verified"]),
          },
        });
      }
    }
    if (d.exception === "APPROVAL_REQUIRED") {
      await db.approval.create({
        data: { workspaceId: ws, kind: "final_offer", entityType: "opportunity", entityId: opp.id, title: `Approve final offer: ${d.addr[0]}`, detail: json({ why: "Seller is close to our numbers", sellerLowest: d.lowest, proposedPrice: d.lowest, pack: `VERIFICATION PACK — ${d.addr[0]}\nSample verification pack: property details, conversation summaries, repairs, comps and every calculation would appear here.` }), requestedBy: "system" },
      });
      await db.approval.create({
        data: { workspaceId: ws, kind: "emd", entityType: "opportunity", entityId: opp.id, title: `🔥 Hot deal: place earnest money on ${d.addr[0]}?`, detail: json({ score: d.hot, serious: ["Marcus Reed", "Tom Nguyen"], emd: 1000 }), requestedBy: "system" },
      });
      await db.payment.create({ data: { workspaceId: ws, opportunityId: opp.id, kind: "emd", direction: "out", amount: 1000, status: "awaiting_approval", payee: "Title / escrow company", note: "Hot deal: recommended earnest money" } });
    }
    if (["DISPOSITION", "CLOSING"].includes(d.stage)) {
      const items = DEFAULT_TITLE_CHECKLIST.map((x, xi) => ({ ...x, done: d.stage === "CLOSING" ? xi < 9 : xi < 4 }));
      const tBuyer = d.stage === "CLOSING" ? buyerIds[4] : null;
      await db.transaction.create({
        data: { workspaceId: ws, opportunityId: opp.id, titleCompanyId: tc.id, buyerId: tBuyer, stage: d.stage === "CLOSING" ? "CLOSING_SCHEDULED" : "TITLE_OPENED", checklist: json(items), inboxAlias: `deal-${opp.id.slice(-8)}`, assignmentFee: d.stage === "CLOSING" ? 24000 : null, emdAmount: 1000, closingAt: new Date(Date.now() + (d.stage === "CLOSING" ? 6 : 24) * 864e5) },
      });
      await db.payment.create({ data: { workspaceId: ws, opportunityId: opp.id, kind: "emd", direction: "out", amount: 1000, status: "paid", payee: "Lone Star Title (sample)", wireVerifiedAt: new Date(), note: "Verified by phone with escrow officer" } });
      if (d.stage === "CLOSING") await db.payment.create({ data: { workspaceId: ws, opportunityId: opp.id, kind: "assignment_fee", direction: "in", amount: 24000, status: "due", payee: "Us", dueAt: new Date(Date.now() + 6 * 864e5) } });
      const tpl = await db.contractTemplate.findFirstOrThrow({ where: { workspaceId: ws, kind: "seller_purchase" } });
      await db.contract.create({
        data: {
          workspaceId: ws,
          opportunityId: opp.id,
          templateId: tpl.id,
          kind: "seller_purchase",
          status: "effective",
          fields: json({ property_address: d.addr[0], purchase_price: `$${(d.lowest || 0).toLocaleString()}` }),
          body: tpl.body.replace("{{property_address}}", d.addr[0]),
          effectiveAt: new Date(Date.now() - 8 * 864e5),
          optionEndsAt: new Date(Date.now() + 2 * 864e5),
          emdDueAt: new Date(Date.now() - 5 * 864e5),
          signers: { create: [{ role: "seller", name: `${d.seller[0]} ${d.seller[1]}`, phone: d.seller[2], order: 1, tokenHash: `demo-${opp.id}-s`, expiresAt: new Date(), status: "signed", signedAt: new Date(Date.now() - 8 * 864e5), consentAt: new Date(Date.now() - 8 * 864e5), signature: `${d.seller[0]} ${d.seller[1]}`, ip: "203.0.113.10" }, { role: "company", name: "Sample owner", order: 99, tokenHash: `demo-${opp.id}-c`, expiresAt: new Date(), status: "signed", signedAt: new Date(Date.now() - 8 * 864e5), signature: "Sample owner" }] },
        },
      });
    }
  }
  // Tasks and alerts so the queues aren't empty.
  const someContact = await db.contact.findFirst({ where: { workspaceId: ws, kind: "seller", sellerStatus: "ENGAGED" } });
  await db.task.createMany({
    data: [
      { workspaceId: ws, kind: "call", title: "Callback: Kevin asked to talk after 5pm Thursday", contactId: someContact?.id, dueAt: new Date(Date.now() + 2 * 864e5), assignee: "agent:seller_acquisition" },
      { workspaceId: ws, kind: "review", title: "Countersign assignment for 338 Rosewood Ct", priority: 1, dueAt: new Date() },
      { workspaceId: ws, kind: "follow_up", title: "Title needs: seller's photo ID for 227 Mission Ridge", priority: 1, dueAt: new Date() },
      { workspaceId: ws, kind: "follow_up", title: "Check in with Hannah Brooks: ignored 4 deals", dueAt: new Date(Date.now() + 864e5) },
    ],
  });
  await db.notification.createMany({
    data: [
      { workspaceId: ws, title: "🔥 Hot deal (78)", body: "2 serious investors on 4812 Oak Hollow Dr. Recommend earnest money $1,000.", href: "/approvals" },
      { workspaceId: ws, title: "Approval needed", body: "Approve final offer: 4812 Oak Hollow Dr", href: "/approvals" },
      { workspaceId: ws, title: "Title update: 338 Rosewood Ct", body: "Closing scheduled; settlement statement draft attached.", href: "/closing" },
    ],
  });
}
