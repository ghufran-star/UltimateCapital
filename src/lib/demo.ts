import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { json } from "./audit";
import { ensureWorkspaceDefaults } from "./bootstrap";
import { encrypt } from "./config";
import { db } from "./db";
import { calculate, DEFAULT_RULESET, estimateRepairs, investorView, resolveParams, TIER_ORDER, type Calculation, type RuleSetData, type Tier } from "./rules";
import { DEFAULT_TITLE_CHECKLIST } from "./stages";
import { draftPack, type StatePackData } from "./states";

// The demo workspace: a large, varied sample business at every stage, in several states.
// It is view-only and can never contact anyone (guards in comms, the worker and the dialer).
// Bump DEMO_VERSION whenever the data changes: an outdated or half-built demo rebuilds itself.

const DEMO_VERSION = "3";
const DEMO_NAME = "Demo · Sample Wholesaling Co";
const COMPANY = "Sample Wholesaling Co";

// ---------------------------------------------------------------- helpers

let seedN = 20261023;
const rnd = () => {
  seedN = (seedN * 1103515245 + 12345) % 2147483648;
  return seedN / 2147483648;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
const r100 = (n: number) => Math.round(n / 100) * 100;
const r1000 = (n: number) => Math.round(n / 1000) * 1000;
const DAY = 864e5;
const ago = (d: number, h = 0) => new Date(Date.now() - d * DAY - h * 3600_000);
const ahead = (d: number, h = 0) => new Date(Date.now() + d * DAY + h * 3600_000);
const usd = (n?: number | null) => (n == null ? "?" : `$${Math.round(n).toLocaleString("en-US")}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => sha(randomBytes(24).toString("hex"));

type Market = { city: string; state: string; county: string; zips: string[]; area: string; arv: [number, number]; streets: string[] };
const MARKETS: Market[] = [
  { city: "Houston", state: "TX", county: "Harris", zips: ["77088", "77016", "77087", "77044", "77028", "77033"], area: "713", arv: [175000, 320000], streets: ["Oak Hollow Dr", "Pinecrest Ln", "Bellfort Ave", "Wild Pine St", "Cullen Blvd", "Tidwell Rd", "Kirkwood Dr"] },
  { city: "San Antonio", state: "TX", county: "Bexar", zips: ["78221", "78207", "78228", "78211"], area: "210", arv: [155000, 285000], streets: ["Mission Ridge", "Rosewood Ct", "Culebra Rd", "Zarzamora St", "Pecan Valley Dr"] },
  { city: "Dallas", state: "TX", county: "Dallas", zips: ["75216", "75217", "75227", "75241"], area: "214", arv: [185000, 340000], streets: ["Bonnie View Rd", "Lake June Rd", "Ledbetter Dr", "Buckner Blvd"] },
  { city: "Jacksonville", state: "FL", county: "Duval", zips: ["32209", "32208", "32254", "32210"], area: "904", arv: [165000, 300000], streets: ["Moncrief Rd", "Lem Turner Rd", "Edgewood Ave", "Blanding Blvd"] },
  { city: "Tampa", state: "FL", county: "Hillsborough", zips: ["33610", "33604", "33612"], area: "813", arv: [230000, 420000], streets: ["Sligh Ave", "Hillsborough Ave", "Fowler Ave", "Nebraska Ave"] },
  { city: "Atlanta", state: "GA", county: "Fulton", zips: ["30310", "30315", "30318", "30311"], area: "404", arv: [200000, 380000], streets: ["Cascade Rd", "Pryor Rd", "Hollywood Rd", "Campbellton Rd"] },
  { city: "Columbus", state: "OH", county: "Franklin", zips: ["43205", "43207", "43211", "43204"], area: "614", arv: [135000, 250000], streets: ["Livingston Ave", "Parsons Ave", "Cleveland Ave", "Sullivant Ave"] },
  { city: "Cleveland", state: "OH", county: "Cuyahoga", zips: ["44105", "44108", "44102"], area: "216", arv: [90000, 175000], streets: ["E 131st St", "Superior Ave", "Lorain Ave"] },
  { city: "Phoenix", state: "AZ", county: "Maricopa", zips: ["85009", "85017", "85035"], area: "602", arv: [260000, 420000], streets: ["W McDowell Rd", "N 43rd Ave", "W Indian School Rd"] },
  { city: "Charlotte", state: "NC", county: "Mecklenburg", zips: ["28208", "28216", "28205"], area: "704", arv: [220000, 360000], streets: ["Tuckaseegee Rd", "Beatties Ford Rd", "Central Ave"] },
];
const phoneSeq: Record<string, number> = {};
const phoneFor = (area: string) => {
  phoneSeq[area] = (phoneSeq[area] ?? 99) + 1; // 555-0100..0199 are reserved fictional numbers
  return `+1${area}555${String(phoneSeq[area]).padStart(4, "0")}`;
};

const FIRST = ["Linda", "Robert", "Angela", "James", "Maria", "Kevin", "Dorothy", "Carlos", "Patricia", "Earl", "Gloria", "Terrence", "Sandra", "Luis", "Brenda", "Walter", "Yolanda", "Gregory", "Denise", "Frank", "Rosa", "Harold", "Tamika", "Raymond", "Shirley", "Victor", "Janice", "Curtis", "Evelyn", "Dwayne", "Margaret", "Hector", "Beverly", "Ronald", "Latoya", "Eugene", "Carmen", "Wayne", "Doris", "Marcus"];
const LAST = ["Carter", "Hayes", "Price", "Walker", "Lopez", "Brown", "Jenkins", "Ramirez", "Coleman", "Washington", "Perry", "Butler", "Simmons", "Foster", "Gonzales", "Bryant", "Alexander", "Russell", "Griffin", "Diaz", "Hamilton", "Graham", "Sullivan", "Wallace", "Woods", "Cole", "West", "Jordan", "Owens", "Reynolds", "Fisher", "Ellis", "Harrison", "Gibson", "McDonald", "Cruz", "Marshall", "Ortiz", "Gomez", "Murray"];
const MOTIVATIONS = [
  "Inherited from her mother; lives out of state",
  "Tired landlord, tenant behind on rent",
  "Relocating for work in two months",
  "Fire damage in the kitchen, can't afford repairs",
  "Retiring and selling rental portfolio",
  "Divorce, needs to split proceeds",
  "Behind on payments, pre-foreclosure notice received",
  "Back taxes owed to the county",
  "Code violations from the city, doesn't want to deal with it",
  "Moved into assisted living; family handling the sale",
  "Vacant for two years, paying taxes and insurance for nothing",
  "Bought a new home, doesn't want two mortgages",
  "Foundation problems, buyers' agents keep walking away",
  "Estate with three siblings who want to cash out",
];
const TIMELINES = ["ASAP", "Within 30 days", "60 days", "Flexible, 2–3 months", "After the school year", "Unsure", "Before the tax sale in December", "Within 2 weeks"];
const TYPES: [string, number][] = [["sfr", 70], ["2_4", 10], ["condo_th", 8], ["mobile", 5], ["land", 3], ["commercial", 2]];
const weighted = <T,>(items: [T, number][]) => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = rnd() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[0][0];
};

// ---------------------------------------------------------------- deal scenarios

type Scenario = { stage: string; exception?: string; tag?: string };
// Each line is one deal. Tags drive the story: near = within the near-agreement gap, hot = several serious buyers, etc.
const SCENARIOS: Scenario[] = [
  ...Array.from({ length: 5 }, () => ({ stage: "NEW" })),
  { stage: "ELIGIBLE" }, { stage: "ELIGIBLE" }, { stage: "ELIGIBLE", tag: "pack_off" },
  { stage: "OUTREACH" }, { stage: "OUTREACH" }, { stage: "OUTREACH", tag: "voicemail" }, { stage: "OUTREACH", tag: "texts" }, { stage: "OUTREACH", exception: "DO_NOT_CONTACT", tag: "stop" }, { stage: "OUTREACH", tag: "dnc_blocked" },
  { stage: "ENGAGED" }, { stage: "ENGAGED", exception: "CALLBACK" }, { stage: "ENGAGED", tag: "inbound" }, { stage: "ENGAGED", exception: "DECLINED" }, { stage: "ENGAGED", exception: "DECLINED" },
  { stage: "QUALIFIED" }, { stage: "QUALIFIED", tag: "inbound" }, { stage: "QUALIFIED", exception: "OWNERSHIP_DISPUTE", tag: "probate" }, { stage: "QUALIFIED", exception: "CALLBACK" },
  { stage: "PROPERTY_DISCOVERY" }, { stage: "PROPERTY_DISCOVERY", tag: "photos" }, { stage: "PROPERTY_DISCOVERY" }, { stage: "PROPERTY_DISCOVERY", tag: "conflict" },
  { stage: "UNDERWRITING", exception: "VALUATION_BLOCKED", tag: "no_sqft" }, { stage: "UNDERWRITING", exception: "VALUATION_BLOCKED", tag: "few_comps" }, { stage: "UNDERWRITING" },
  { stage: "OFFER_READY" }, { stage: "OFFER_READY" }, { stage: "OFFER_READY", tag: "rental" }, { stage: "OFFER_READY" },
  { stage: "NEGOTIATION", exception: "APPROVAL_REQUIRED", tag: "near_hot" }, { stage: "NEGOTIATION", exception: "APPROVAL_REQUIRED", tag: "near" }, { stage: "NEGOTIATION", tag: "far" }, { stage: "NEGOTIATION", tag: "over_limit" }, { stage: "NEGOTIATION", exception: "CALLBACK", tag: "far" }, { stage: "NEGOTIATION", exception: "WITHDRAWN", tag: "far" }, { stage: "NEGOTIATION", tag: "agent_request" },
  { stage: "CONTRACT_PREPARATION", tag: "draft" }, { stage: "CONTRACT_PREPARATION", tag: "sent" }, { stage: "CONTRACT_PREPARATION", exception: "AWAITING_DOCS", tag: "viewed" },
  { stage: "UNDER_CONTRACT", tag: "emd_due" }, { stage: "UNDER_CONTRACT", tag: "emd_paid" }, { stage: "UNDER_CONTRACT", exception: "CONTRACT_FAILED", tag: "terminated" },
  { stage: "DISPOSITION", tag: "hot" }, { stage: "DISPOSITION" }, { stage: "DISPOSITION", tag: "below_floor" }, { stage: "DISPOSITION", tag: "rental" },
  { stage: "CLOSING", tag: "countersign" }, { stage: "CLOSING", tag: "settlement_issue" }, { stage: "CLOSING", tag: "settlement_ok" },
  { stage: "CLOSED", tag: "paid_month" }, { stage: "CLOSED", tag: "paid_month" }, { stage: "CLOSED", tag: "paid_month" }, { stage: "CLOSED", tag: "paid_old" }, { stage: "CLOSED", tag: "paid_old" }, { stage: "CLOSED", tag: "paid_old" },
];
const ORDER = ["NEW", "ELIGIBLE", "OUTREACH", "ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY", "NEGOTIATION", "CONTRACT_PREPARATION", "UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"];
const atLeast = (stage: string, s: string) => ORDER.indexOf(stage) >= ORDER.indexOf(s);

// Markets with an active State Pack can be worked; others stay at NEW/ELIGIBLE.
const ACTIVE = ["TX", "FL", "GA", "OH"];

// ---------------------------------------------------------------- entry points

export async function ensureDemoWorkspace(userId: string) {
  const existing = await db.workspace.findFirst({ where: { isDemo: true } });
  if (existing) {
    const ver = await db.setting.findUnique({ where: { workspaceId_key: { workspaceId: existing.id, key: "DEMO_VERSION" } } });
    const deals = await db.opportunity.count({ where: { workspaceId: existing.id } });
    if (ver && deals > 20) {
      const { decrypt } = await import("./config");
      if (decrypt(ver.value) === DEMO_VERSION) {
        await db.membership.upsert({ where: { workspaceId_userId: { workspaceId: existing.id, userId } }, create: { workspaceId: existing.id, userId, role: "owner" }, update: {} });
        return existing;
      }
    }
    // Outdated or half-built: rebuild from scratch.
    await db.workspace.delete({ where: { id: existing.id } });
  }
  return buildDemo(userId);
}

export async function resetDemo(userId: string) {
  const ws = await db.workspace.findFirst({ where: { isDemo: true } });
  if (ws) await db.workspace.delete({ where: { id: ws.id } });
  return buildDemo(userId);
}

async function buildDemo(userId: string) {
  const ws = await db.workspace.create({ data: { name: DEMO_NAME, isDemo: true } });
  await db.membership.create({ data: { workspaceId: ws.id, userId, role: "owner" } });
  try {
    seedN = 20261023;
    for (const k of Object.keys(phoneSeq)) delete phoneSeq[k];
    await seed(ws.id, userId);
    await db.setting.create({ data: { workspaceId: ws.id, key: "DEMO_VERSION", value: encrypt(DEMO_VERSION) } });
  } catch (e) {
    console.error("[demo] seed failed", e);
    await db.workspace.delete({ where: { id: ws.id } }).catch(() => null);
    throw new Error(`Building the demo failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ws;
}

// ---------------------------------------------------------------- the seed

type AuditRow = Prisma.AuditEventCreateManyInput;

async function seed(ws: string, ownerId: string) {
  const audits: AuditRow[] = [];
  const log = (actor: string, action: string, entityType: string | null, entityId: string | null, when: Date, after?: unknown, meta?: unknown) =>
    audits.push({ workspaceId: ws, actor, action, entityType, entityId, createdAt: when, after: after === undefined ? undefined : json(after), meta: meta === undefined ? undefined : json(meta) });

  await ensureWorkspaceDefaults(ws);
  await db.setting.create({ data: { workspaceId: ws, key: "COMPANY_NAME", value: encrypt(COMPANY) } });
  await db.setting.create({ data: { workspaceId: ws, key: "DNC_PROVIDER", value: encrypt("dncscrub") } });
  await db.setting.create({ data: { workspaceId: ws, key: "LITIGATOR_PROVIDER", value: encrypt("blacklist_alliance") } });
  await db.setting.create({ data: { workspaceId: ws, key: "PUBLIC_URL", value: encrypt("https://demo.example.com") } });
  await db.setting.create({ data: { workspaceId: ws, key: "INBOUND_EMAIL_DOMAIN", value: encrypt("deals.example.com") } });

  // ---------- team ----------
  const team: Record<string, string> = { owner: ownerId };
  const TEAM = [
    ["admin", "Sarah Mitchell", "admin", []],
    ["acq", "Omar Haddad", "acquisitions", ["TX", "FL"]],
    ["acq2", "Aisha Bello", "acquisitions", ["GA", "OH"]],
    ["dispo", "Lisa Chen", "dispositions", []],
    ["tc", "Mike Torres", "tc", []],
    ["caller", "Jamal Wright", "caller", ["TX"]],
    ["viewer", "Ben Carter (investor partner)", "viewer", []],
  ] as const;
  for (const [key, name, role, states] of TEAM) {
    const email = `${name.split(" ")[0].toLowerCase()}.demo@example.com`;
    const u = await db.user.upsert({ where: { email }, create: { email, name, passwordHash: "disabled", phone: phoneFor("713") }, update: {} });
    await db.membership.create({ data: { workspaceId: ws, userId: u.id, role, states: [...states] } });
    team[key] = u.id;
  }
  await db.invite.create({ data: { workspaceId: ws, token: randomBytes(18).toString("base64url"), email: "new.caller@example.com", role: "caller", createdById: ownerId, expiresAt: ahead(12) } });
  const who = (k: string) => team[k];

  // ---------- state packs ----------
  const pack = (code: string, patch: (d: StatePackData) => void) => {
    const d = draftPack(code);
    patch(d);
    d.sources = ["SAMPLE: replace with your attorney's memo for this state"];
    return json(d);
  };
  const packs: [string, string, Prisma.InputJsonValue][] = [
    ["TX", "active", pack("TX", (d) => { d.contracts.optionPeriodDays = 10; d.contracts.typicalEmd = 1000; d.wholesaling.licenseNotes = "Sample: marketing an equitable interest requires disclosure; confirm with counsel."; d.outreach.stateDncList = true; })],
    ["FL", "active", pack("FL", (d) => { d.contracts.optionPeriodDays = 15; d.contracts.typicalEmd = 2000; d.outreach.callStart = "08:00"; d.outreach.callEnd = "20:00"; d.outreach.maxCallsPerDayPerContact = 3; d.outreach.stateDncList = true; d.outreach.notes = "Sample: Florida mini-TCPA, keep to 3 calls per 24h per person on the same subject."; })],
    ["GA", "active", pack("GA", (d) => { d.closing.attorneyState = true; d.contracts.typicalEmd = 1500; d.contracts.optionPeriodDays = 7; d.closing.notes = "Sample: closings run through a closing attorney."; })],
    ["OH", "active", pack("OH", (d) => { d.contracts.typicalEmd = 1000; d.contracts.optionPeriodDays = 10; d.closing.ronAllowed = true; })],
    ["AZ", "unverified", pack("AZ", (d) => { d.contracts.typicalEmd = 1000; d.wholesaling.licenseNotes = "Sample: under review by counsel."; })],
    ["NC", "draft", pack("NC", () => undefined)],
    ["IL", "disabled", pack("IL", (d) => { d.wholesaling.marketingBeforeContract = "prohibited"; d.wholesaling.licenseNotes = "Sample: paused pending licensing decision."; })],
  ];
  for (const [state, status, data] of packs) {
    await db.statePack.upsert({
      where: { workspaceId_state: { workspaceId: ws, state } },
      create: { workspaceId: ws, state, status, data, version: status === "active" ? 3 : 1, approvedBy: status === "active" ? ownerId : null, approvedAt: status === "active" ? ago(40) : null },
      update: { status, data, version: status === "active" ? 3 : 1, approvedBy: status === "active" ? ownerId : null, approvedAt: status === "active" ? ago(40) : null },
    });
    if (status === "active") log(ownerId, "state_pack_active", "state_pack", state, ago(40));
  }

  // ---------- rules: three versions, the last one live ----------
  const v2: RuleSetData = structuredClone(DEFAULT_RULESET);
  v2.overrides.push({ id: "fl", name: "Florida: higher closing costs", when: { states: ["FL"] }, set: { ourBuyCostsPct: 0.02, investor: { sellCostsPct: 0.09 } } });
  const v3: RuleSetData = structuredClone(v2);
  v3.defaults.minFee = 12000;
  v3.defaults.targetFee = 30000;
  v3.overrides.push(
    { id: "oh-rent", name: "Ohio rentals", when: { states: ["OH"], exits: ["rental"] }, set: { maxBuyPctArv: 0.65, investor: { minProfitPct: 0.12 } } },
    { id: "gut", name: "Full gut rehabs", when: { conditionTiers: ["gut"] }, set: { maxBuyPctArv: 0.62, minFee: 15000 } },
    { id: "high", name: "High value (ARV $350K+)", when: { minArv: 350000 }, set: { minFee: 20000, targetFee: 45000, buyerRoundFees: [45000, 30000, 20000] } },
    { id: "nov", name: "Novation & wholetail", when: { dealTypes: ["novation", "wholetail"] }, set: { maxBuyPctArv: 0.8, feeInMaxBuy: "target" } },
    { id: "tampa", name: "Tampa 33610: competitive ZIP", when: { zips: ["33610"] }, set: { offerSteps: [0.1, 0.05] } },
    { id: "probate", name: "Probate / title issues", when: { titleFlags: ["probate", "liens"] }, set: { maxBuyPctArv: 0.66 } }
  );
  await db.ruleSet.updateMany({ where: { workspaceId: ws }, data: { active: false, note: "Starting rules", createdBy: ownerId, createdAt: ago(80) } });
  await db.ruleSet.create({ data: { workspaceId: ws, version: 2, active: false, rules: json(v2), note: "Added Florida closing costs", createdBy: ownerId, createdAt: ago(55) } });
  await db.ruleSet.create({ data: { workspaceId: ws, version: 3, active: true, rules: json(v3), note: "Raised min fee to $12K; gut rehab, high-value, Ohio rental and probate variations", createdBy: ownerId, createdAt: ago(21) } });
  log(ownerId, "rules_published", "ruleset", "2", ago(55), { version: 2 });
  log(ownerId, "rules_published", "ruleset", "3", ago(21), { version: 3 });

  // ---------- agents: mark most as synced ----------
  const agents = await db.agent.findMany({ where: { workspaceId: ws } });
  for (const [i, a] of agents.entries()) {
    if (a.role === "transaction") continue;
    await db.agent.update({ where: { id: a.id }, data: { retellAgentId: `agent_demo_${a.role}`, retellLlmId: `llm_demo_${a.role}`, version: 2 + (i % 3), voiceId: a.role.startsWith("buyer") || a.role === "disposition" ? "11labs-Brian" : "11labs-Adrian" } });
  }

  // ---------- templates ----------
  await db.contractTemplate.createMany({
    data: [
      { workspaceId: ws, name: "Florida purchase agreement (SAMPLE)", kind: "seller_purchase", state: "FL", body: (await db.contractTemplate.findFirstOrThrow({ where: { workspaceId: ws, kind: "seller_purchase" } })).body.replace("RESIDENTIAL PURCHASE AGREEMENT", "FLORIDA RESIDENTIAL PURCHASE AGREEMENT (AS-IS)"), version: 2 },
      { workspaceId: ws, name: "Closing date extension addendum (SAMPLE)", kind: "addendum", body: "SAMPLE ONLY — NOT LEGAL ADVICE.\n\nADDENDUM\n\nThe closing date for {{property_address}} is extended to {{closing_date}}. All other terms remain.\n\nSELLER\n[[sign:seller]]\n\nBUYER\n[[sign:company]]" },
      { workspaceId: ws, name: "Old Texas contract v1 (archived)", kind: "seller_purchase", state: "TX", body: "SAMPLE ONLY\n\nArchived.\n\n[[sign:seller]]", active: false },
    ],
  });
  const tplSeller = await db.contractTemplate.findFirstOrThrow({ where: { workspaceId: ws, kind: "seller_purchase", state: null } });
  const tplAssign = await db.contractTemplate.findFirstOrThrow({ where: { workspaceId: ws, kind: "assignment" } });

  // ---------- phone numbers & title companies ----------
  for (const [i, m] of MARKETS.entries()) {
    await db.phoneNumber.create({ data: { workspaceId: ws, number: phoneFor(m.area), market: m.city, state: m.state, inboundMode: i % 4 === 3 ? "forward" : i % 5 === 4 ? "voicemail" : "agent", forwardUserId: i % 4 === 3 ? who("acq") : null } });
  }
  const TITLE = [
    ["TX", "Lone Star Title (sample)", "Rachel Green", "Commitment in 5 business days", "Assignment-friendly. Virtual closings via e-sign + mobile notary."],
    ["FL", "Sunshine Settlement Services (sample)", "Daniel Ortiz", "Title search 3–4 days", "Handles double closes with transactional funding."],
    ["GA", "Peach State Closing Attorneys (sample)", "Kendra Moss", "Attorney review 5 days", "Attorney state: closing attorney must supervise."],
    ["OH", "Buckeye Title Agency (sample)", "Paul Novak", "Commitment in 4 days", "RON closings available."],
    ["AZ", "Desert Escrow & Title (sample)", "Nina Patel", "Escrow opens same day", "Not used yet: AZ pack under review."],
  ] as const;
  const titleBy: Record<string, string> = {};
  for (const [state, name, person, turn, notes] of TITLE) {
    const phone = phoneFor(MARKETS.find((m) => m.state === state)!.area);
    const t = await db.titleCompany.create({ data: { workspaceId: ws, name, state, email: `closings.${state.toLowerCase()}@example.com`, phone, wireVerifiedPhone: phone, turnaround: turn, fees: "Escrow fee $450–$650 + title policy", notes, contacts: json([{ name: person, role: "Escrow officer", email: `closings.${state.toLowerCase()}@example.com`, phone }]) } });
    titleBy[state] = t.id;
  }

  // ---------- compliance: suppressions & consent ----------
  const supp: Prisma.SuppressionCreateManyInput[] = [];
  for (let i = 0; i < 18; i++) supp.push({ workspaceId: ws, kind: "phone", value: phoneFor(pick(MARKETS).area), source: pick(["national_dnc", "national_dnc", "state_dnc:TX", "state_dnc:FL", "reassigned"]), createdAt: ago(between(1, 60)) });
  for (let i = 0; i < 5; i++) supp.push({ workspaceId: ws, kind: "phone", value: phoneFor(pick(MARKETS).area), source: "litigator", reason: "Blacklist Alliance: plaintiff-primary", createdAt: ago(between(1, 30)) });
  await db.suppression.createMany({ data: supp, skipDuplicates: true });
  log("system", "dnc_auto_update", null, null, ago(1), undefined, { source: "national_dnc", found: 1240, added: 38 });
  log(ownerId, "dnc_imported", null, null, ago(33), undefined, { source: "state_dnc:TX", found: 5120, added: 5120 });

  // ---------- buyers ----------
  const COMPANIES = ["Reed Home Flips LLC", "Shah Rentals", "Alamo Capital Partners", null, "Bayou Holdings", "GK Investments", "Gulf Coast Homebuyers", "Red Oak Equity", "Northside Rehab Co", "Sunbelt SFR Fund II", "Keystone Property Group", "BlueDoor Homes", null, "Magnolia Rentals", "Tri-County Flips", "Lakeshore Capital", "Peachtree Renovations", "Iron Horse Investments", null, "First Coast Homes", "Brickline Partners", "Crescent Rentals", "Summit Turnkey", "Copperline Holdings", null, "Harbor Point Capital", "Evergreen Housing LLC", "Cardinal Flips", "Rio Grande Rentals", "Prairie Wind Investors", "Atlas BRRRR Group", null, "Heritage Home Buyers", "Coastal Cash Offers", "Riverbend Equity", "Oakmont Capital", "Westside Property Co", "Granite Peak Homes"];
  const buyerIds: string[] = [];
  const buyerRows: { id: string; name: string; markets: string[]; states: string[]; max: number; cond: Tier; types: string[]; strategy: string; pct: number; net: number; basis: string; funds: boolean; rel: number; per: number }[] = [];
  for (let i = 0; i < COMPANIES.length; i++) {
    const home = MARKETS[i % MARKETS.length];
    const second = rnd() < 0.35 ? pick(MARKETS.filter((m) => m.state === home.state && m.city !== home.city)) : undefined;
    const strategy = pick(["flip", "flip", "rental", "brrrr", "any"]);
    const funds = rnd() < 0.7;
    const status = i === 7 ? "DO_NOT_CONTACT" : i === 12 ? "UNAVAILABLE" : i === 18 ? "DORMANT" : i % 9 === 0 ? "NEW" : i % 7 === 0 ? "QUALIFYING" : i % 6 === 0 ? "ENGAGED" : funds ? "ACTIVE" : "QUALIFIED";
    const first = pick(FIRST);
    const last = pick(LAST);
    const markets = [home.city, ...(second ? [second.city] : [])];
    const cond = pick<Tier>(["cosmetic", "moderate", "heavy", "heavy", "gut"]);
    const types = rnd() < 0.2 ? ["sfr", "2_4"] : rnd() < 0.1 ? ["sfr", "condo_th"] : strategy === "rental" ? ["sfr", "2_4"] : ["sfr"];
    const max = r1000(home.arv[1] * (0.55 + rnd() * 0.3));
    const pct = pick([0.1, 0.12, 0.15, 0.15, 0.2]);
    const net = pick([15000, 20000, 25000, 30000]);
    const basis = pick(["net", "net", "gross", "both"]);
    const per = pick([0.5, 1, 1, 2, 3, 4, 6]);
    const rel = between(35, 92);
    const c = await db.contact.create({
      data: {
        workspaceId: ws,
        kind: "buyer",
        firstName: first,
        lastName: last,
        company: COMPANIES[i],
        phone: phoneFor(home.area),
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        state: home.state,
        city: home.city,
        buyerStatus: status,
        doNotContact: status === "DO_NOT_CONTACT",
        fundsVerified: funds,
        fundingMethod: funds ? pick(["cash", "cash", "private"]) : pick(["hard_money", "conventional"]),
        closingSpeedDays: funds ? pick([7, 10, 14]) : pick([21, 30, 45]),
        buyingPerMonth: per,
        nextBuyingAt: i % 11 === 5 ? ahead(between(10, 45)) : null,
        maxDealsPerWeek: i % 4 === 0 ? 2 : null,
        maxDealsPerMonth: i % 5 === 0 ? 6 : null,
        preferredChannel: pick(["sms", "sms", "email", "call"]),
        ignoredInRow: i % 8 === 3 ? 5 : between(0, 2),
        dealsClosed: funds ? between(0, 14) : 0,
        reliability: rel,
        tags: [strategy === "rental" ? "landlord" : "flipper", ...(funds ? ["cash buyer"] : []), ...(i % 10 === 1 ? ["hedge fund"] : []), ...(per >= 4 ? ["volume buyer"] : [])],
        assigneeId: who("dispo"),
        summary: status === "UNAVAILABLE" ? "Paused buying: capital tied up until next quarter." : `${strategy === "rental" ? "Buy-and-hold" : strategy === "brrrr" ? "BRRRR" : "Flipper"} in ${markets.join(" & ")} up to ${usd(max)}, takes ${cond} rehab, wants ${Math.round(pct * 100)}% / ${usd(net)} ${basis}. ${funds ? "Proof of funds on file." : "Funds not verified yet."}`,
        openQuestions: funds ? [] : ["Proof of funds", "Lender and max loan amount"],
        lastContactAt: ago(between(1, 40)),
        createdAt: ago(between(30, 200)),
        buyBoxes: {
          create: [
            { name: `${home.city} ${strategy === "rental" ? "rentals" : "flips"}`, states: [home.state], markets, propertyTypes: types, strategy, maxPrice: max, minPrice: rnd() < 0.3 ? r1000(max * 0.3) : null, maxCondition: cond, minBeds: rnd() < 0.4 ? 3 : null, minProfitPct: pct, minNetProfit: net, profitBasis: basis, minCapRate: strategy === "rental" ? pick([0.07, 0.08, 0.09]) : null, occupancyOk: rnd() < 0.3 ? ["vacant"] : [], excludedZips: rnd() < 0.15 ? [pick(home.zips)] : [] },
            ...(i % 6 === 2 ? [{ name: "Old criteria (paused)", active: false, states: [home.state], markets: [home.city], propertyTypes: ["land"], strategy: "redevelopment", maxPrice: 60000 }] : []),
          ],
        },
      },
    });
    buyerIds.push(c.id);
    buyerRows.push({ id: c.id, name: `${first} ${last}`, markets, states: [home.state], max, cond, types, strategy, pct, net, basis, funds, rel, per });
    if (rnd() < 0.8) await db.consent.create({ data: { contactId: c.id, channel: "sms", evidence: "Sample: opted in on the buyer sign-up form", createdAt: ago(between(30, 150)) } });
    if (rnd() < 0.4) await db.consent.create({ data: { contactId: c.id, channel: "ai_voice", evidence: "Sample: agreed on a recorded call to AI follow-ups" } });
    // A qualification call and some texts per buyer.
    if (!["NEW"].includes(status)) {
      await db.interaction.create({
        data: {
          workspaceId: ws,
          contactId: c.id,
          channel: "call",
          direction: "outbound",
          provider: "retell",
          status: "done",
          outcome: "info_gathered",
          durationSec: between(180, 600),
          createdAt: ago(between(20, 90)),
          processedAt: ago(20),
          summary: `Qualified ${first}: buys ${types.join("/")} in ${markets.join(" & ")}, ${strategy}, up to ${usd(max)}; ${funds ? "cash, can close in 10–14 days" : "uses hard money, needs 30 days"}; about ${per} deal(s) a month.`,
          body: `Agent: Hi ${first}, this is Jordan with ${COMPANY}. Just so you know, I'm an AI assistant. We find off-market properties for investors. Do you buy in ${home.city}?\n${first}: Yeah, mostly ${markets.join(" and ")}.\nAgent: What kind of properties, and what's your strategy?\n${first}: ${types.includes("2_4") ? "Single family and small multis" : "Single family"}, ${strategy === "rental" ? "I hold them as rentals" : strategy === "brrrr" ? "I BRRRR them" : "I flip them"}.\nAgent: What's your price range, and how much rehab will you take on?\n${first}: Up to about ${usd(max)}. ${cond === "gut" ? "I'll do full guts." : cond === "heavy" ? "Heavy is fine, no foundation nightmares." : "Cosmetic to moderate, I don't want big projects."}\nAgent: What returns do you need?\n${first}: At least ${Math.round(pct * 100)} percent, and ${usd(net)} in my pocket.\nAgent: How do you fund, and how fast can you close?\n${first}: ${funds ? "Cash. Ten to fourteen days." : "Hard money, so about thirty days."}\nAgent: How often do you buy, and how should I send deals?\n${first}: Maybe ${per} a month. Text is best.\nAgent: Perfect, I'll only send what fits.`,
        },
      });
      await db.fact.createMany({
        data: [
          { workspaceId: ws, entityType: "contact", entityId: c.id, field: "markets", value: json(markets.join(", ")), kind: "reported", confidence: 0.9, createdAt: ago(30) },
          { workspaceId: ws, entityType: "contact", entityId: c.id, field: "max_price", value: json(usd(max)), kind: "reported", confidence: 0.85, createdAt: ago(30) },
          { workspaceId: ws, entityType: "contact", entityId: c.id, field: "funding", value: json(funds ? "cash" : "hard money"), kind: funds ? "verified" : "reported", confidence: 0.9, createdAt: ago(30) },
          { workspaceId: ws, entityType: "contact", entityId: c.id, field: "deals_per_month", value: json(String(per)), kind: "reported", confidence: 0.7, createdAt: ago(30) },
        ],
      });
    }
    if (status === "DO_NOT_CONTACT") {
      await db.interaction.create({ data: { workspaceId: ws, contactId: c.id, channel: "sms", direction: "inbound", provider: "twilio", body: "STOP", summary: "Opted out by text", createdAt: ago(9), processedAt: ago(9) } });
      await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: c.phone!, source: "internal", reason: 'Texted "STOP"', createdAt: ago(9) } });
      log("system", "opt_out", "contact", c.id, ago(9), undefined, { reason: 'Texted "STOP"', source: "opt_out" });
    }
  }

  // ---------- sellers, properties and deals ----------
  type DealRec = { id: string; sellerId: string; propertyId: string; stage: string; tag?: string; market: Market; address: string; calc?: Calculation; contractPrice?: number; sellerName: string; sellerPhone: string; sellerEmail: string };
  const deals: DealRec[] = [];
  const workable = MARKETS.filter((m) => ACTIVE.includes(m.state));
  let mi = 0;
  const usedAddr = new Set<string>();
  const rsData = v3;

  for (const [si, sc] of SCENARIOS.entries()) {
    const early = !atLeast(sc.stage, "OUTREACH");
    const market = sc.tag === "pack_off" ? MARKETS.find((m) => m.state === "NC")! : early && si % 3 === 0 ? MARKETS.find((m) => m.state === (si % 2 ? "AZ" : "NC"))! : workable[mi++ % workable.length];
    const first = FIRST[si % FIRST.length];
    const last = LAST[(si * 7) % LAST.length];
    let address = "";
    do address = `${between(100, 9899)} ${pick(market.streets)}`;
    while (usedAddr.has(address));
    usedAddr.add(address);
    const zip = sc.tag === "near_hot" && market.city === "Tampa" ? "33610" : pick(market.zips);
    const type = sc.tag === "rental" ? "2_4" : weighted(TYPES);
    const tier: Tier = sc.tag === "probate" ? "heavy" : pick<Tier>(["cosmetic", "moderate", "moderate", "heavy", "gut"]);
    const beds = type === "land" ? null : type === "2_4" ? 4 : between(2, 4);
    const baths = type === "land" ? null : type === "2_4" ? 2 : pick([1, 1, 1.5, 2, 2]);
    const sqft = type === "land" ? null : sc.tag === "no_sqft" ? null : type === "2_4" ? between(1600, 2400) : between(900, 2100);
    const arv = r1000(between(market.arv[0], market.arv[1]) * (tier === "gut" ? 0.95 : 1));
    const asking = r1000(arv * (0.6 + rnd() * 0.25));
    const motivation = sc.tag === "probate" ? "Estate with three siblings who want to cash out" : pick(MOTIVATIONS);
    const timeline = pick(TIMELINES);
    const titleFlags = sc.tag === "probate" ? ["probate"] : rnd() < 0.15 ? [pick(["liens", "back_taxes", "code_violations"])] : [];
    const occupancy = sc.tag === "rental" ? "tenant" : pick(["vacant", "vacant", "owner", "tenant"]);
    const phone = phoneFor(market.area);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${si}@example.com`;
    const created = ago(between(ORDER.indexOf(sc.stage) * 4 + 3, ORDER.indexOf(sc.stage) * 6 + 12));
    const contacted = atLeast(sc.stage, "OUTREACH");
    const engaged = atLeast(sc.stage, "ENGAGED");

    // Item-by-item condition from the seller's answers (from property discovery onward).
    const items: Record<string, { tier: string; reason: string }> = {};
    if (atLeast(sc.stage, "PROPERTY_DISCOVERY")) {
      const quotes: Record<string, [Tier, string][]> = {
        roof: [["none", "Roof was replaced in 2019"], ["moderate", "Roof is about 15 years old, a few shingles missing"], ["heavy", "Roof leaks in the back bedroom when it rains"]],
        hvac: [["none", "AC is three years old"], ["moderate", "AC works but it's original"], ["gut", "No central air, window units only"]],
        kitchen: [["cosmetic", "Kitchen is dated but everything works"], ["moderate", "Cabinets are falling apart"], ["gut", "Kitchen was damaged in the fire"]],
        foundation: [["none", "No foundation problems that I know of"], ["moderate", "A few cracks in the brick out front"], ["heavy", "Doors stick and there's a crack across the living room floor"]],
        plumbing: [["none", "Plumbing is fine"], ["moderate", "Cast iron pipes, one leak fixed last year"]],
        electrical: [["none", "Panel was updated"], ["heavy", "Old fuse box, some outlets don't work"]],
        baths: [["cosmetic", "Bathrooms just need updating"], ["moderate", "Hall bath tub is cracked"]],
        flooring: [["moderate", "Carpet needs to go, there's wood underneath"], ["heavy", "Floors are soft in the kitchen"]],
      };
      const keys = Object.keys(quotes).slice(0, sc.stage === "PROPERTY_DISCOVERY" ? 4 : 8);
      for (const k of keys) {
        const [t, reason] = pick(quotes[k]);
        items[k] = { tier: TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(tier) && tier !== "gut" ? tier : t, reason };
      }
    }

    const seller = await db.contact.create({
      data: {
        workspaceId: ws,
        kind: "seller",
        firstName: first,
        lastName: last,
        phone,
        phone2: si % 5 === 0 ? phoneFor(market.area) : null,
        email: engaged ? email : null,
        state: market.state,
        city: market.city,
        sellerStatus: sc.exception === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : sc.stage,
        doNotContact: sc.exception === "DO_NOT_CONTACT",
        assigneeId: market.state === "TX" || market.state === "FL" ? who("acq") : who("acq2"),
        tags: [pick(["absentee owner", "high equity", "tax delinquent", "probate list", "vacant", "pre-foreclosure", "tired landlord"])],
        summary: !engaged ? null : sc.exception === "DECLINED" ? `Not interested in selling right now. ${motivation.split(";")[0]}.` : `${motivation}. Timeline: ${timeline.toLowerCase()}. ${atLeast(sc.stage, "NEGOTIATION") ? "Negotiating price." : "Gathering details."}`,
        openQuestions: sc.stage === "PROPERTY_DISCOVERY" ? ["Age of the water heater", "Any permits for the back addition?", "Is there a mortgage or lien balance?"] : sc.stage === "QUALIFIED" ? ["Condition of roof and HVAC", "Who else is on title?"] : [],
        lastContactAt: contacted ? ago(between(0, 6)) : null,
        createdAt: created,
      },
    });
    if (sc.tag === "inbound" || si % 4 === 1) await db.consent.create({ data: { contactId: seller.id, channel: "ai_voice", evidence: sc.tag === "inbound" ? "Sample: called our number and asked for a call back" : "Sample: web form 'Get my offer' with AI-call consent checkbox", createdAt: created } });
    if (si % 3 === 0 && engaged) await db.consent.create({ data: { contactId: seller.id, channel: "sms", evidence: "Sample: agreed to texts on a recorded call", createdAt: ago(5) } });

    const prop = await db.property.create({
      data: {
        workspaceId: ws,
        address,
        city: market.city,
        state: market.state,
        zip,
        county: market.county,
        parcel: atLeast(sc.stage, "CONTRACT_PREPARATION") ? `${between(100, 999)}-${between(1000, 9999)}-${between(10, 99)}` : null,
        legalDesc: atLeast(sc.stage, "CONTRACT_PREPARATION") ? `Lot ${between(1, 40)}, Block ${between(1, 20)}, ${pick(["Sunnyside", "Oak Park", "Riverside", "Highland"])} Addition` : null,
        propertyType: type,
        beds,
        baths,
        sqft,
        yearBuilt: type === "land" ? null : between(1940, 2008),
        occupancy: engaged ? occupancy : null,
        conditionTier: atLeast(sc.stage, "QUALIFIED") ? tier : null,
        condition: Object.keys(items).length ? json({ items }) : undefined,
        titleFlags,
        rentEstimate: r100(arv * 0.0085),
        createdAt: created,
        ownerships: { create: [{ contactId: seller.id, role: sc.tag === "probate" ? "heir" : "owner", verified: atLeast(sc.stage, "CONTRACT_PREPARATION") }] },
      },
    });
    if (sc.tag === "probate") {
      for (const [n, role] of [["Michael", "heir"], ["Teresa", "executor"]] as const) {
        const sib = await db.contact.create({ data: { workspaceId: ws, kind: "seller", firstName: n, lastName: last, phone: phoneFor(market.area), state: market.state, city: market.city, sellerStatus: "QUALIFIED", summary: role === "executor" ? "Executor; says the other heirs haven't agreed to sell." : "Heir; wants to sell quickly.", createdAt: created } });
        await db.ownership.create({ data: { contactId: sib.id, propertyId: prop.id, role } });
      }
    }

    // ---------- valuation ----------
    const dealType = sc.tag === "rental" ? "assignment" : pick(["assignment", "assignment", "assignment", "double_close", "novation", "subject_to", "wholetail"]);
    const exit = sc.tag === "rental" || type === "2_4" ? "rental" : "flip";
    const facts = { state: market.state, market: market.city, zip, propertyType: type, dealType, exit, conditionTier: tier, occupancy, titleFlags, arv };
    const { params } = resolveParams(rsData, facts);
    let calc: Calculation | undefined;
    let contractPrice: number | undefined;
    const valued = atLeast(sc.stage, "UNDERWRITING");
    if (valued) {
      const tiers = Object.keys(items).length ? Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.tier as Tier])) : Object.fromEntries(rsData.playbook.map((p) => [p.key, tier]));
      const reasons = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.reason]));
      const rep = estimateRepairs(rsData.playbook, tiers, params, { sqft: sqft || 1400, baths }, reasons);
      if (atLeast(sc.stage, "CONTRACT_PREPARATION")) {
        const pre = calculate({ arv, repairs: rep.likely, params, exit, rent: r100(arv * 0.0085) });
        contractPrice = r100(pre.sellerOffers[pre.sellerOffers.length - 2] + rnd() * (pre.maxBuy - pre.sellerOffers[pre.sellerOffers.length - 2]));
      }
      calc = calculate({ arv, repairs: rep.likely, params, exit, rent: r100(arv * 0.0085), contractPrice });
    }

    // seller price story
    let sellerLowest: number | undefined;
    if (calc && atLeast(sc.stage, "NEGOTIATION")) {
      sellerLowest =
        sc.tag === "near" || sc.tag === "near_hot" ? r100(calc.maxBuy * 1.03) : sc.tag === "far" ? r100(calc.maxBuy * 1.28) : sc.tag === "over_limit" ? r100(calc.maxBuy * 1.08) : contractPrice ?? r100(calc.maxBuy * 1.12);
    } else if (engaged && sc.exception !== "DECLINED") sellerLowest = rnd() < 0.4 ? asking - 5000 : undefined;

    const hot = sc.tag === "near_hot" ? 82 : sc.tag === "hot" ? 88 : atLeast(sc.stage, "DISPOSITION") ? between(40, 75) : sc.tag === "near" ? 35 : 0;
    const opp = await db.opportunity.create({
      data: {
        workspaceId: ws,
        propertyId: prop.id,
        sellerId: seller.id,
        stage: sc.stage,
        exception: sc.exception,
        dealType,
        exitStrategy: exit,
        askingPrice: engaged ? asking : null,
        sellerLowest,
        motivation: engaged ? motivation : null,
        timeline: atLeast(sc.stage, "QUALIFIED") ? timeline : null,
        decisionMakers: atLeast(sc.stage, "QUALIFIED") ? (sc.tag === "probate" ? "Three heirs; executor must sign" : pick(["Owner only", "Owner and spouse", "Owner; son helps with paperwork"])) : null,
        assigneeId: seller.assigneeId,
        hotScore: hot,
        verificationSentAt: sc.exception === "APPROVAL_REQUIRED" ? ago(0, 5) : null,
        approvedAt: contractPrice ? ago(between(6, 14)) : null,
        emdRecommendedAt: sc.tag === "near_hot" || sc.tag === "hot" ? ago(1) : null,
        contractPrice,
        createdAt: created,
      },
    });
    if (valued && calc) {
      const blocked = sc.exception === "VALUATION_BLOCKED" ? (sc.tag === "no_sqft" ? "Square footage unknown." : "Fewer than 3 comparable sales.") : null;
      const tiers = Object.keys(items).length ? Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.tier as Tier])) : Object.fromEntries(rsData.playbook.map((p) => [p.key, tier]));
      const reasons = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.reason]));
      const r = estimateRepairs(rsData.playbook, tiers, params, { sqft: sqft || 1400, baths }, reasons);
      const nComps = sc.tag === "few_comps" ? 2 : between(4, 8);
      const comps = Array.from({ length: nComps }, (_, k) => {
        const s = (sqft || 1400) + between(-250, 250);
        return { address: `${between(100, 9899)} ${pick(market.streets)}, ${market.city}`, price: r1000(arv * (0.9 + rnd() * 0.18) * (s / (sqft || 1400))), sqft: s, date: ago(between(15, 170)).toISOString().slice(0, 10), source: k % 3 === 2 ? "Web research (unverified)" : "RentCast (sample)" };
      });
      // An earlier valuation (older rule version) so history exists.
      if (atLeast(sc.stage, "NEGOTIATION")) {
        const old = calculate({ arv: r1000(arv * 0.97), repairs: r.likely, params: { ...params, minFee: 10000 }, exit, rent: r100(arv * 0.0085) });
        await db.valuation.create({ data: { opportunityId: opp.id, ruleVersion: 2, arv: r1000(arv * 0.97), asIs: r1000(arv * 0.58), rent: r100(arv * 0.0085), repairsLow: r.low, repairsLikely: r.likely, repairsHigh: r.high, repairItems: json(r.lines), comps: json(comps.slice(0, 3)), result: json(old), confidence: 0.55, createdAt: ago(25) } });
      }
      await db.valuation.create({
        data: { opportunityId: opp.id, ruleVersion: 3, arv: sc.tag === "few_comps" ? null : arv, asIs: r1000(arv * 0.6), rent: r100(arv * 0.0085), repairsLow: r.low, repairsLikely: r.likely, repairsHigh: r.high, repairItems: json(r.lines), comps: json(comps), result: json(calc), confidence: blocked ? 0.3 : Math.round((0.55 + rnd() * 0.35) * 100) / 100, blocked, createdAt: ago(between(1, 6)) },
      });
      log("system", "valuation", "opportunity", opp.id, ago(2), { arv, repairs: calc.repairs, maxBuy: calc.maxBuy, ruleVersion: 3, blocked });
    }
    deals.push({ id: opp.id, sellerId: seller.id, propertyId: prop.id, stage: sc.stage, tag: sc.tag, market, address, calc, contractPrice, sellerName: `${first} ${last}`, sellerPhone: phone, sellerEmail: email });
    log("system", "opportunity_created", "opportunity", opp.id, created);
    for (let k = 1; k <= ORDER.indexOf(sc.stage); k++) log(k < 4 ? "agent:intel" : k > 8 ? who("acq") : "system", "stage_changed", "opportunity", opp.id, new Date(+created + k * ((Date.now() - +created) / (ORDER.indexOf(sc.stage) + 1))), { stage: ORDER[k] });

    // ---------- conversations ----------
    const I: Prisma.InteractionCreateManyInput[] = [];
    const say = (when: Date, x: Partial<Prisma.InteractionCreateManyInput>) => I.push({ workspaceId: ws, contactId: seller.id, opportunityId: opp.id, channel: "call", direction: "outbound", provider: "retell", status: "done", processedAt: when, createdAt: when, ...x });
    const hasAiConsent = sc.tag === "inbound" || si % 4 === 1;
    if (contacted) {
      say(ago(between(12, 20)), { outcome: "no_answer", summary: "No answer", provider: hasAiConsent ? "retell" : "twilio", durationSec: 0 });
      if (sc.tag === "voicemail") say(ago(3), { outcome: "voicemail", summary: "Reached voicemail; no message left (policy).", durationSec: 22 });
      if (sc.tag === "texts" || sc.tag === "stop") {
        say(ago(4), { channel: "sms", provider: "twilio", body: `Hi ${first}, this is Alex with ${COMPANY}. Would you consider an offer on ${address}? Reply STOP to opt out.`, summary: null, outcome: null });
        say(ago(3, 20), { channel: "sms", direction: "inbound", provider: "twilio", body: sc.tag === "stop" ? "STOP" : "Who is this? How did you get my number?", summary: sc.tag === "stop" ? "Opted out by text" : "Asked who we are", outcome: sc.tag === "stop" ? "dnc" : "info_gathered" });
        if (sc.tag === "texts") say(ago(3, 19), { channel: "sms", provider: "twilio", body: `We buy houses in ${market.city} and saw you own ${address} through public records. No pressure at all; happy to share a cash offer if you'd ever consider it.`, outcome: null, summary: null });
      }
      if (sc.tag === "dnc_blocked") say(ago(2), { channel: "system", direction: "internal", provider: "manual", status: "failed", summary: "Call blocked before dialing: number is on the national DNC list (dncscrub D)", outcome: "blocked" });
    }
    if (engaged) {
      const declined = sc.exception === "DECLINED";
      const human = !hasAiConsent;
      say(ago(between(7, 11)), {
        provider: human ? "twilio" : "retell",
        direction: sc.tag === "inbound" ? "inbound" : "outbound",
        outcome: declined ? "not_interested" : "interested",
        durationSec: between(150, 520),
        recordingUrl: null,
        intel: human ? json({ human: who("caller") }) : undefined,
        summary: declined ? `${first} isn't interested in selling right now; ok to check back in 6 months.` : `${first} would consider selling ${address}. ${motivation}. Timeline: ${timeline.toLowerCase()}. Asking around ${usd(asking)}.`,
        body:
          sc.tag === "inbound"
            ? `Agent: Thanks for calling ${COMPANY}, this is Sam. How can I help?\n${first}: Hi, I got your letter about my house on ${address.split(" ").slice(1).join(" ")}.\nAgent: Thanks for calling back. Just so you know, I'm an AI assistant for the team. Are you thinking about selling?\n${first}: Maybe. ${motivation}.\nAgent: That makes sense. When would you ideally want to have it sold?\n${first}: ${timeline}.\nAgent: And do you have a price in mind?\n${first}: Around ${usd(asking)}.\nAgent: Thank you. Our acquisitions manager will call you back with next steps. What's the best time?\n${first}: Afternoons.`
            : `${human ? "Jamal" : "Agent"}: Hi, is this ${first}? This is ${human ? "Jamal" : "Alex"} with ${COMPANY}.${human ? "" : " Just so you know, I'm an AI assistant calling for the company."} We buy houses as-is in ${market.city}. Would you ever consider an offer on ${address}?\n${first}: ${declined ? "No, I'm not selling. My daughter might move in." : `Maybe. ${motivation}.`}\n${declined ? `${human ? "Jamal" : "Agent"}: Understood, thank you. Is it alright if we check back in a few months?\n${first}: Sure, that's fine.` : `${human ? "Jamal" : "Agent"}: I'm sorry to hear that. What timeline would work for you?\n${first}: ${timeline}.\n${human ? "Jamal" : "Agent"}: And roughly what price did you have in mind?\n${first}: I was hoping for around ${usd(asking)}.\n${human ? "Jamal" : "Agent"}: Is anyone else on the title or involved in the decision?\n${first}: ${sc.tag === "probate" ? "My brother and my sister, and my aunt is the executor." : "Just me."}`}`,
      });
    }
    if (atLeast(sc.stage, "PROPERTY_DISCOVERY")) {
      const lines = Object.entries(items).map(([k, v]) => `Agent: How about the ${k}?\n${first}: ${v.reason}.`);
      say(ago(between(4, 6)), { outcome: "info_gathered", durationSec: between(300, 700), summary: `Walked through the condition: ${Object.entries(items).map(([k, v]) => `${k} ${v.tier}`).join(", ")}. ${occupancy === "tenant" ? "Tenant-occupied, month to month." : occupancy === "vacant" ? "Vacant; lockbox on the back door." : "Owner lives there."}`, body: `Agent: Hi ${first}, it's Alex from ${COMPANY} again, following up so we can put together a fair offer. Do you have a few minutes to go over the condition?\n${first}: Sure.\n${lines.join("\n")}\nAgent: Is it occupied right now?\n${first}: ${occupancy === "tenant" ? "Yes, a tenant, month to month." : occupancy === "vacant" ? "No, it's empty." : "I live there."}\nAgent: Thank you, that's really helpful. I'll get our numbers together.` });
      if (sc.tag === "photos") {
        say(ago(3), { channel: "sms", direction: "inbound", provider: "twilio", body: "Here are the pictures of the kitchen and the back roof [4 photos]", summary: "Seller texted 4 photos (kitchen, roof)", outcome: "info_gathered" });
      }
    }
    if (atLeast(sc.stage, "NEGOTIATION") && calc) {
      say(ago(2), {
        outcome: "offer_discussed",
        durationSec: between(400, 900),
        summary: `Presented ${usd(calc.sellerOffers[0])}. ${first} countered at ${usd(sellerLowest)}.${sc.tag === "near" || sc.tag === "near_hot" ? " Within the near-agreement gap: verification pack sent to owner." : sc.tag === "over_limit" ? " Above our authority: asked the owner." : ""}`,
        body: `Agent: Hi ${first}, it's Alex from ${COMPANY}. I have our offer on ${address}. Based on the repairs we talked about${calc.repairs ? `, around ${usd(calc.repairs)}` : ""}, and buying as-is with no fees, we can offer ${usd(calc.sellerOffers[0])}.\n${first}: That's lower than I hoped. I really can't go below ${usd(sellerLowest)}.\nAgent: I understand. Let me see what I can do. If we could close on your timeline, would ${usd(calc.sellerOffers[1] ?? calc.maxBuy)} work?\n${first}: Still a bit low. ${usd(sellerLowest)} and we have a deal.\nAgent: I'll take that to my manager today and confirm with you. The paperwork would come to you to review before anything is final.`,
      });
      await db.offer.createMany({
        data: [
          { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 1, price: asking, by: "them", createdAt: ago(8) },
          { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 2, price: calc.sellerOffers[0], by: "us", authority: "rule", createdAt: ago(2, 2) },
          { opportunityId: opp.id, side: "seller", contactId: seller.id, round: 3, price: sellerLowest ?? asking, by: "them", createdAt: ago(2, 1) },
          ...(calc.sellerOffers.length > 2 ? [{ opportunityId: opp.id, side: "seller", contactId: seller.id, round: 4, price: calc.sellerOffers[1], by: "us", authority: "rule", createdAt: ago(2) }] : []),
          ...(contractPrice ? [{ opportunityId: opp.id, side: "seller", contactId: seller.id, round: 99, price: contractPrice, by: "us", authority: "approved", status: "accepted", createdAt: ago(9) }] : []),
        ],
      });
    }
    if (I.length) await db.interaction.createMany({ data: I });

    // ---------- facts (versioned, with one conflict) ----------
    if (engaged) {
      const F: Prisma.FactCreateManyInput[] = [
        { workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: "motivation", value: json(motivation), kind: "reported", confidence: 0.85, createdAt: ago(8) },
        { workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: "asking_price", value: json(usd(asking)), kind: "reported", confidence: 0.8, createdAt: ago(8), supersededAt: sc.tag === "conflict" ? ago(3) : null },
      ];
      if (atLeast(sc.stage, "QUALIFIED")) F.push({ workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: "timeline", value: json(timeline), kind: "reported", confidence: 0.8, createdAt: ago(7) });
      for (const [k, v] of Object.entries(items)) F.push({ workspaceId: ws, entityType: "property", entityId: prop.id, field: k, value: json(v.reason), kind: "reported", confidence: 0.75, createdAt: ago(5) });
      if (occupancy) F.push({ workspaceId: ws, entityType: "property", entityId: prop.id, field: "occupancy", value: json(occupancy), kind: atLeast(sc.stage, "CONTRACT_PREPARATION") ? "verified" : "reported", confidence: 0.8, createdAt: ago(5) });
      await db.fact.createMany({ data: F });
      if (sc.tag === "conflict") {
        const old = await db.fact.findFirst({ where: { entityId: opp.id, field: "asking_price" } });
        await db.fact.create({ data: { workspaceId: ws, entityType: "opportunity", entityId: opp.id, field: "asking_price", value: json(usd(asking + 25000)), kind: "reported", confidence: 0.7, conflictsWith: old?.id, createdAt: ago(3) } });
        await db.notification.create({ data: { workspaceId: ws, title: `Conflicting info: ${first} ${last}`, body: `asking_price: was "${usd(asking)}", now "${usd(asking + 25000)}" (spouse joined the call)`, href: `/deals/${opp.id}`, createdAt: ago(3) } });
      }
    }
    if (sc.exception === "DO_NOT_CONTACT") {
      await db.suppression.create({ data: { workspaceId: ws, kind: "phone", value: phone, source: "internal", reason: 'Texted "STOP"', createdAt: ago(3, 20) } });
      log("system", "opt_out", "contact", seller.id, ago(3, 20), undefined, { reason: 'Texted "STOP"' });
    }
  }

  // ---------- buyer matching (same hard filters as the live matcher) ----------
  const tierIdx = (t: string | null | undefined) => TIER_ORDER.indexOf((t || "none") as Tier);
  const matchesFor = async (d: DealRec) => {
    if (!d.calc) return [];
    const p = await db.property.findUniqueOrThrow({ where: { id: d.propertyId } });
    const out: { b: (typeof buyerRows)[number]; net: number; netPct: number; price: number }[] = [];
    for (const b of buyerRows) {
      const contact = await db.contact.findUnique({ where: { id: b.id }, select: { doNotContact: true } });
      if (contact?.doNotContact) continue;
      if (!b.states.includes(p.state) || !b.markets.includes(p.city)) continue;
      if (!b.types.includes(p.propertyType)) continue;
      if (d.calc.floor > b.max) continue;
      if (p.conditionTier && tierIdx(p.conditionTier) > tierIdx(b.cond)) continue;
      const { params } = resolveParams(v3, { state: p.state });
      const price = Math.max(d.calc.floor, Math.min(d.calc.buyerRounds[0], b.max));
      const iv = investorView(price, d.calc.arv, d.calc.repairs, { ...params, investor: { ...params.investor, minProfitPct: b.pct, minNetProfit: b.net, profitBasis: b.basis as "net" } }, null);
      if (!iv.meets) continue;
      out.push({ b, net: iv.net, netPct: iv.netPct, price });
    }
    return out.sort((x, y) => y.b.rel - x.b.rel);
  };

  for (const d of deals) {
    const anonymous = ["NEGOTIATION"].includes(d.stage) && (d.tag === "near" || d.tag === "near_hot");
    const full = atLeast(d.stage, "UNDER_CONTRACT") && d.tag !== "terminated";
    if (!anonymous && !full && !(d.stage === "OFFER_READY" || d.stage === "NEGOTIATION")) continue;
    const ms = await matchesFor(d);
    // If the sample buyers don't happen to fit, take the closest same-market buyers so every later-stage deal has demand to show.
    let list = ms;
    if (list.length < 3 && (anonymous || full)) {
      const extra = buyerRows.filter((b) => b.markets.includes(d.market.city) && !list.some((x) => x.b.id === b.id)).slice(0, 4 - list.length);
      list = [...list, ...extra.map((b) => ({ b, net: d.calc ? Math.round(d.calc.investorAtRounds[0]?.net ?? 0) : 0, netPct: d.calc?.investorAtRounds[0]?.netPct ?? 0, price: d.calc?.buyerRounds[0] ?? 0 }))];
    }
    const winner = list[0];
    for (const [k, m] of list.slice(0, 8).entries()) {
      let stage = "MATCHED";
      let serious = false;
      let priceMentioned: number | null = null;
      if (anonymous || full) {
        stage = k === 0 ? "INTERESTED" : k === 1 ? "INTERESTED" : k === 2 ? "PRESENTED" : k === 3 ? "REJECTED" : k === 4 ? "NO_RESPONSE" : "PRESENTED";
        serious = k < 2 && (d.tag === "near_hot" || d.tag === "hot" || full);
        if (full && k === 0) (stage = "OFFER_SUBMITTED"), (priceMentioned = d.calc!.buyerRounds[1] ?? d.calc!.buyerRounds[0]);
        if (d.tag === "below_floor" && k === 1) (stage = "OFFER_SUBMITTED"), (priceMentioned = d.calc!.floor - 4000), (serious = true);
        if (atLeast(d.stage, "CLOSING") && k === 0) stage = d.stage === "CLOSED" ? "COMPLETED" : "AGREEMENT_EXECUTED";
      }
      const presented = stage !== "MATCHED";
      await db.buyerInterest.create({
        data: {
          opportunityId: d.id,
          contactId: m.b.id,
          fitScore: Math.max(30, Math.min(98, 50 + Math.round((m.b.rel - 50) / 3) + (m.b.funds ? 10 : 0) + Math.min(10, m.b.per * 3) - k * 2)),
          stage,
          serious,
          priceMentioned,
          presentedAt: presented ? ago(2, k) : null,
          respondedAt: ["INTERESTED", "OFFER_SUBMITTED", "AGREEMENT_EXECUTED", "COMPLETED", "REJECTED"].includes(stage) ? ago(1, 20 - k) : null,
          notes: stage === "REJECTED" ? "Pass: too much rehab for the price" : k === 6 ? "Not sent: Weekly deal limit reached" : null,
          reasons: json([`✓ fits "${m.b.markets[0]} ${m.b.strategy === "rental" ? "rentals" : "flips"}"`, `✓ investor ${m.b.basis} ${usd(m.net)} (${Math.round(m.netPct * 100)}%) at ${usd(m.price)}`, m.b.funds ? "✓ funds verified" : "• funds not verified"]),
        },
      });
      if (presented) {
        const pp = await db.property.findUniqueOrThrow({ where: { id: d.propertyId } });
        const teaser = anonymous
          ? `Off-market lead: ${pp.beds ?? "?"} bd / ${pp.baths ?? "?"} ba in ${d.market.city} ${pp.zip}, ARV est. ${usd(d.calc!.arv)}, repairs est. ${usd(d.calc!.repairs)}, around ${usd(d.calc!.buyerRounds[0])}. Would you buy at that number? Reply YES for details when available.`
          : `New deal: ${d.address}, ${d.market.city}. ARV est. ${usd(d.calc!.arv)}, repairs est. ${usd(d.calc!.repairs)}, ${usd(d.calc!.buyerRounds[0])}. We hold an equitable interest under a purchase contract and are assigning it. Reply for photos and access.`;
        await db.interaction.create({ data: { workspaceId: ws, contactId: m.b.id, opportunityId: d.id, channel: "sms", direction: "outbound", provider: "twilio", body: teaser, createdAt: ago(2, k), processedAt: ago(2, k) } });
        if (stage === "INTERESTED" || stage === "OFFER_SUBMITTED")
          await db.interaction.create({ data: { workspaceId: ws, contactId: m.b.id, opportunityId: d.id, channel: "sms", direction: "inbound", provider: "twilio", body: priceMentioned ? `I'd do ${usd(priceMentioned)} cash, close in 10 days. Can I see it tomorrow?` : serious ? "YES. Send the address, I can walk it this week." : "Maybe, what's the rehab look like?", summary: priceMentioned ? `Offered ${usd(priceMentioned)}, wants a walkthrough` : serious ? "Serious: asked for the address and a walkthrough" : "Interested, asked about the rehab", outcome: "interested", createdAt: ago(1, 20 - k), processedAt: ago(1, 19 - k) } });
        if (stage === "REJECTED") await db.interaction.create({ data: { workspaceId: ws, contactId: m.b.id, opportunityId: d.id, channel: "sms", direction: "inbound", provider: "twilio", body: "Pass, too much work for that number.", summary: "Passed: rehab vs price", outcome: "not_interested", createdAt: ago(1, 10), processedAt: ago(1, 9) } });
        if (priceMentioned) await db.offer.create({ data: { opportunityId: d.id, side: "buyer", contactId: m.b.id, round: 1, price: priceMentioned, by: "them", createdAt: ago(1, 18) } });
        await db.offer.create({ data: { opportunityId: d.id, side: "buyer", contactId: m.b.id, round: 1, price: d.calc!.buyerRounds[0], by: "us", authority: "rule", createdAt: ago(2, k) } });
      }
    }
    if (atLeast(d.stage, "CLOSING") && winner) (d as DealRec & { buyerId?: string }).buyerId = winner.b.id;
    log("system", "matching", "opportunity", d.id, ago(2), { matched: list.length });
    if (anonymous) log("system", "demand_campaign", "opportunity", d.id, ago(2), undefined, { mode: "anonymous", buyers: list.length });
    if (full) log("system", "demand_campaign", "opportunity", d.id, ago(5), undefined, { mode: "full", buyers: list.length });
  }

  // ---------- approvals ----------
  const AP: Prisma.ApprovalCreateManyInput[] = [];
  const P: Prisma.PaymentCreateManyInput[] = [];
  for (const d of deals) {
    const c = d.calc;
    const opp = await db.opportunity.findUniqueOrThrow({ where: { id: d.id } });
    if ((d.tag === "near" || d.tag === "near_hot") && c) {
      const pack = [
        `VERIFICATION PACK — ${d.address}, ${d.market.city}, ${d.market.state}`,
        `Seller: ${d.sellerName} · lowest price indicated ${usd(opp.sellerLowest)} · asking ${usd(opp.askingPrice)}`,
        `Motivation: ${opp.motivation} · timeline: ${opp.timeline} · decision makers: ${opp.decisionMakers}`,
        ...c.formula,
        `Investor at round 1: net ${usd(c.investorAtRounds[0]?.net)} (${Math.round((c.investorAtRounds[0]?.netPct || 0) * 100)}%)`,
        `The anonymous buyer demand check has started. Approve to send the final offer and contract.`,
      ].join("\n");
      AP.push({ workspaceId: ws, kind: "final_offer", entityType: "opportunity", entityId: d.id, title: `Approve final offer: ${d.address}`, detail: json({ why: "Seller is close to our numbers", sellerLowest: opp.sellerLowest, maxBuy: c.maxBuy, proposedPrice: Math.min(opp.sellerLowest || c.maxBuy, c.maxBuy), pack }), requestedBy: "system", createdAt: ago(0, 5) });
    }
    if ((d.tag === "near_hot" || d.tag === "hot") && c) {
      AP.push({ workspaceId: ws, kind: "emd", entityType: "opportunity", entityId: d.id, title: `🔥 Hot deal: place earnest money on ${d.address}?`, detail: json({ score: opp.hotScore, serious: 2, emd: d.market.state === "FL" ? 2000 : 1000 }), requestedBy: "system", createdAt: ago(1) });
      P.push({ workspaceId: ws, opportunityId: d.id, kind: "emd", direction: "out", amount: d.market.state === "FL" ? 2000 : 1000, status: "awaiting_approval", payee: "Title / escrow company", note: "Hot deal: recommended earnest money", createdAt: ago(1) });
    }
    if (d.tag === "over_limit" && c) AP.push({ workspaceId: ws, kind: "offer_over_limit", entityType: "opportunity", entityId: d.id, title: `Seller wants ${usd(opp.sellerLowest)}: above max buy ${usd(c.maxBuy)} on ${d.address}`, detail: json({ price: opp.sellerLowest, maxBuy: c.maxBuy, note: "Agent asked during the call; seller has another cash offer (unverified)." }), requestedBy: "agent:negotiation", createdAt: ago(0, 9) });
    if (d.tag === "agent_request") AP.push({ workspaceId: ws, kind: "agent_request", entityType: "opportunity", entityId: d.id, title: `${d.sellerName} asks for $2,000 toward moving costs and a 7-day close`, detail: json({ request: "Moving costs $2,000 at closing; close in 7 days", agent: "negotiation" }), requestedBy: "agent:negotiation", createdAt: ago(0, 3) });
    if (d.tag === "below_floor" && c) AP.push({ workspaceId: ws, kind: "price_below_floor", entityType: "opportunity", entityId: d.id, title: `Buyer offer ${usd(c.floor - 4000)} is below the floor ${usd(c.floor)} on ${d.address}`, detail: json({ price: c.floor - 4000, floor: c.floor, fee: c.floor - 4000 - c.contractPrice }), requestedBy: "agent:disposition", createdAt: ago(0, 7) });
  }
  // Decision history.
  const someDeals = deals.filter((d) => atLeast(d.stage, "CONTRACT_PREPARATION"));
  for (const [i, d] of someDeals.entries()) {
    AP.push({ workspaceId: ws, kind: "final_offer", entityType: "opportunity", entityId: d.id, title: `Approve final offer: ${d.address}`, status: "approved", decidedBy: ownerId, decidedAt: ago(10 + i), note: i % 3 === 0 ? "Good margin, go" : null, detail: json({ proposedPrice: d.contractPrice }), requestedBy: "system", createdAt: ago(11 + i) });
    if (atLeast(d.stage, "UNDER_CONTRACT")) AP.push({ workspaceId: ws, kind: "emd", entityType: "opportunity", entityId: d.id, title: `Place earnest money on ${d.address}`, status: "approved", decidedBy: ownerId, decidedAt: ago(8 + i), detail: json({ emd: 1000 }), requestedBy: "system", createdAt: ago(8 + i) });
  }
  AP.push({ workspaceId: ws, kind: "offer_over_limit", entityType: "opportunity", entityId: deals.find((d) => d.tag === "far")!.id, title: "Seller wanted $28K over max buy", status: "rejected", decidedBy: ownerId, decidedAt: ago(4), note: "Numbers don't work. Hold at max buy.", requestedBy: "agent:negotiation", createdAt: ago(4, 3) });
  const titleFeePay = await db.payment.create({ data: { workspaceId: ws, kind: "title_fee", direction: "out", amount: 650, status: "awaiting_approval", payee: "Sunshine Settlement Services (sample)", note: "Wire instructions verified by phone", wireVerifiedAt: ago(0, 3), wireVerifiedBy: who("tc"), createdAt: ago(0, 2) } });
  AP.push({ workspaceId: ws, kind: "payment", entityType: "payment", entityId: titleFeePay.id, title: "Approve title fee $650 to Sunshine Settlement Services (sample)", detail: json({ amount: 650, kind: "title_fee" }), requestedBy: who("tc"), createdAt: ago(0, 2) });
  await db.approval.createMany({ data: AP });

  // ---------- contracts, closings, payments ----------
  const { buildPdf } = await import("./contracts");
  const signedContract = async (d: DealRec, kind: "seller_purchase" | "assignment", status: string, opts: { buyer?: { id: string; name: string; phone?: string | null; email?: string | null }; daysAgo: number }) => {
    const tpl = kind === "seller_purchase" ? tplSeller : tplAssign;
    const p = await db.property.findUniqueOrThrow({ where: { id: d.propertyId } });
    const pack = draftPack(d.market.state);
    const fee = d.calc ? (d.calc.buyerRounds[1] ?? d.calc.buyerRounds[0]) - (d.contractPrice || 0) : 20000;
    const fields: Record<string, string> = {
      today: ago(opts.daysAgo).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      company_name: COMPANY,
      seller_names: d.sellerName,
      buyer_name: kind === "assignment" ? opts.buyer?.name || "" : COMPANY,
      property_address: d.address,
      property_city: d.market.city,
      property_state: d.market.state,
      property_zip: p.zip,
      property_county: d.market.county,
      legal_description: p.legalDesc || "",
      parcel_id: p.parcel || "",
      purchase_price: usd(d.contractPrice),
      earnest_money: usd(d.market.state === "FL" ? 2000 : 1000),
      option_fee: "$100",
      option_days: "10",
      closing_date: ahead(25 - opts.daysAgo).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      title_company: TITLE.find((t) => t[0] === d.market.state)?.[1] || "",
      assignee_name: opts.buyer?.name || "",
      assignment_fee: usd(fee),
      disclosure_text: pack.wholesaling.disclosureText,
    };
    const body = tpl.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => fields[k] ?? "");
    const signedAt = ago(opts.daysAgo - 1);
    const ext = kind === "seller_purchase" ? { role: "seller", name: d.sellerName, email: d.sellerEmail, phone: d.sellerPhone } : { role: "buyer", name: opts.buyer!.name, email: opts.buyer!.email || undefined, phone: opts.buyer!.phone || undefined };
    const extStatus = ["effective", "partially_signed"].includes(status) ? "signed" : status === "viewed" ? "viewed" : status === "sent" ? "sent" : status === "terminated" ? "signed" : "pending";
    const companySigned = status === "effective" || status === "terminated";
    const k = await db.contract.create({
      data: {
        workspaceId: ws,
        opportunityId: d.id,
        templateId: tpl.id,
        kind,
        status,
        fields: json(fields),
        body,
        effectiveAt: companySigned ? signedAt : null,
        optionEndsAt: companySigned ? new Date(+signedAt + 10 * DAY) : null,
        emdDueAt: companySigned ? new Date(+signedAt + 3 * DAY) : null,
        closingAt: ahead(25 - opts.daysAgo),
        createdAt: ago(opts.daysAgo),
        signers: {
          create: [
            { ...ext, order: 1, tokenHash: token(), expiresAt: ahead(10), status: extStatus, viewedAt: ["viewed", "signed"].includes(extStatus) ? ago(opts.daysAgo - 0.5) : null, consentAt: extStatus === "signed" ? signedAt : null, signedAt: extStatus === "signed" ? signedAt : null, signature: extStatus === "signed" ? `typed:${ext.name}` : null, initials: extStatus === "signed" ? ext.name.split(" ").map((x) => x[0]).join("") : null, ip: extStatus === "signed" ? `198.51.100.${between(2, 250)}` : null, userAgent: extStatus === "signed" ? pick(["Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari", "Mozilla/5.0 (Linux; Android 15) Chrome/139", "Mozilla/5.0 (Windows NT 10.0) Chrome/140"]) : null },
            { role: "company", name: "Sample Owner", email: "owner@example.com", order: 99, tokenHash: token(), expiresAt: ahead(10), status: companySigned ? "signed" : "pending", consentAt: companySigned ? signedAt : null, signedAt: companySigned ? signedAt : null, signature: companySigned ? "typed:Sample Owner" : null, ip: companySigned ? "203.0.113.7" : null },
          ],
        },
      },
    });
    const evs: [string, string, number][] = [[who("acq"), "contract_created", opts.daysAgo], [who("acq"), "contract_sent", opts.daysAgo - 0.1]];
    if (["viewed", "signed"].includes(extStatus)) evs.push(["signer", "contract_viewed", opts.daysAgo - 0.5]);
    if (extStatus === "signed") evs.push(["signer", "contract_signed", opts.daysAgo - 1]);
    if (companySigned) evs.push([ownerId, "contract_countersigned", opts.daysAgo - 1], ["system", "contract_effective", opts.daysAgo - 1]);
    if (status === "terminated") evs.push([ownerId, "contract_terminated", 1]);
    await db.auditEvent.createMany({ data: evs.map(([actor, action, dAgo]) => ({ workspaceId: ws, actor: actor === "signer" ? `signer:${k.id}` : actor, action, entityType: "contract", entityId: k.id, createdAt: ago(Math.max(0, dAgo)), meta: json(action === "contract_signed" || action === "contract_viewed" ? { ip: "198.51.100.23" } : {}) })) });
    if (companySigned) {
      const pdf = await buildPdf(ws, k.id);
      await db.contract.update({ where: { id: k.id }, data: { finalPdf: pdf, finalHash: createHash("sha256").update(Buffer.from(pdf)).digest("hex") } });
    }
    return k;
  };

  for (const d of deals) {
    const buyerId = (d as DealRec & { buyerId?: string }).buyerId;
    const buyer = buyerId ? await db.contact.findUnique({ where: { id: buyerId } }) : null;
    const bInfo = buyer ? { id: buyer.id, name: `${buyer.firstName} ${buyer.lastName}`.trim(), phone: buyer.phone, email: buyer.email } : undefined;
    const ago0 = d.stage === "CLOSED" ? (d.tag === "paid_old" ? between(45, 90) : between(15, 25)) : d.stage === "CLOSING" ? 16 : d.stage === "DISPOSITION" ? 9 : 6;
    const fee = d.calc ? (d.calc.buyerRounds[1] ?? d.calc.buyerRounds[0]) - (d.contractPrice || 0) : 0;
    if (d.stage === "CONTRACT_PREPARATION") {
      await signedContract(d, "seller_purchase", d.tag === "draft" ? "draft" : d.tag === "sent" ? "sent" : "viewed", { daysAgo: 2 });
      if (d.tag === "draft") await db.task.create({ data: { workspaceId: ws, kind: "review", title: `Prepare and send the seller contract: ${d.address}`, entityType: "opportunity", entityId: d.id, priority: 1, assignee: who("acq"), dueAt: ago(0, 2) } });
      if (d.tag === "viewed") await db.task.create({ data: { workspaceId: ws, kind: "follow_up", title: `Seller viewed the contract but needs a copy of the probate letters first: ${d.address}`, entityType: "opportunity", entityId: d.id, priority: 1, assignee: who("acq"), dueAt: ahead(1) } });
      continue;
    }
    if (!atLeast(d.stage, "UNDER_CONTRACT")) continue;
    const sellerK = await signedContract(d, "seller_purchase", d.tag === "terminated" ? "terminated" : "effective", { daysAgo: ago0 });
    if (d.tag === "terminated") {
      await db.notification.create({ data: { workspaceId: ws, title: "Contract terminated", body: `${d.address}: terminated in the option period (foundation report came back worse than expected).`, href: `/deals/${d.id}`, createdAt: ago(1) } });
      P.push({ workspaceId: ws, opportunityId: d.id, kind: "emd", direction: "out", amount: 1000, status: "cancelled", payee: TITLE.find((t) => t[0] === d.market.state)?.[1], note: "Refunded: terminated within option period", createdAt: ago(5) });
      continue;
    }
    // Transaction + checklist by stage
    const doneUpTo = d.stage === "UNDER_CONTRACT" ? (d.tag === "emd_paid" ? 3 : 1) : d.stage === "DISPOSITION" ? 5 : d.stage === "CLOSING" ? (d.tag === "countersign" ? 7 : 10) : 13;
    const items = DEFAULT_TITLE_CHECKLIST.map((x, xi) => ({ ...x, done: xi < doneUpTo, doneAt: xi < doneUpTo ? ago(Math.max(0, ago0 - xi - 1)).toISOString() : undefined, note: x.key === "title_opened" && xi < doneUpTo ? `File #${between(24000, 26999)}-${d.market.state}` : x.key === "settlement_draft" && d.tag === "settlement_issue" ? "Issue: county tax proration charged to us" : undefined }));
    const txStage = d.stage === "UNDER_CONTRACT" ? (d.tag === "emd_paid" ? "TITLE_OPENED" : "CONTRACT_EFFECTIVE") : d.stage === "DISPOSITION" ? "DUE_DILIGENCE" : d.stage === "CLOSING" ? (d.tag === "countersign" ? "BUYER_AGREEMENT" : "CLOSING_SCHEDULED") : d.tag === "paid_old" ? "RECONCILED" : "RECONCILED";
    const tx = await db.transaction.create({
      data: {
        workspaceId: ws,
        opportunityId: d.id,
        titleCompanyId: titleBy[d.market.state],
        buyerId: atLeast(d.stage, "CLOSING") ? buyerId : null,
        stage: txStage,
        checklist: json(items),
        inboxAlias: `deal-${d.id.slice(-8)}`,
        assignmentFee: atLeast(d.stage, "CLOSING") ? fee : null,
        emdAmount: d.market.state === "FL" ? 2000 : 1000,
        closingAt: d.stage === "CLOSED" ? ago(ago0 - 20) : ahead(d.stage === "CLOSING" ? between(3, 8) : between(14, 28)),
        settlement:
          d.tag === "settlement_issue"
            ? json({ ok: false, issues: ["County tax proration ($1,184) charged to the buyer side instead of the seller", "Assignment fee shown as $2,000 less than the agreement"], purchasePrice: d.contractPrice, assignmentFee: fee - 2000, ourNetProceeds: fee - 2000 - 650, checkedAt: ago(0, 6).toISOString() })
            : d.tag === "settlement_ok" || d.stage === "CLOSED"
              ? json({ ok: true, issues: [], purchasePrice: d.contractPrice, assignmentFee: fee, ourNetProceeds: fee - 650, checkedAt: ago(d.stage === "CLOSED" ? ago0 - 18 : 1).toISOString() })
              : undefined,
        paidAt: d.stage === "CLOSED" ? ago(ago0 - 21) : null,
        netProceeds: d.stage === "CLOSED" ? fee - 650 : null,
        createdAt: ago(ago0 - 1),
      },
    });
    const titleName = TITLE.find((t) => t[0] === d.market.state)?.[1];
    const emd = d.market.state === "FL" ? 2000 : 1000;
    P.push({ workspaceId: ws, opportunityId: d.id, kind: "emd", direction: "out", amount: emd, status: d.tag === "emd_due" ? "approved" : "paid", payee: titleName, dueAt: new Date(+ago(ago0 - 1) + 3 * DAY), wireVerifiedAt: d.tag === "emd_due" ? null : ago(ago0 - 2), wireVerifiedBy: d.tag === "emd_due" ? null : who("tc"), reference: d.tag === "emd_due" ? null : `Wire ${between(100000, 999999)}`, note: d.tag === "emd_due" ? "Approved; wire instructions not yet verified by phone" : "Verified by phone with escrow officer (known number)", createdAt: ago(ago0 - 1) });
    if (d.stage !== "UNDER_CONTRACT") P.push({ workspaceId: ws, opportunityId: d.id, kind: "option_fee", direction: "out", amount: 100, status: "paid", payee: d.sellerName, createdAt: ago(ago0 - 1) });
    if (atLeast(d.stage, "CLOSING")) {
      const received = d.stage === "CLOSED";
      P.push({ workspaceId: ws, opportunityId: d.id, kind: "assignment_fee", direction: "in", amount: fee, status: received ? "received" : "due", payee: "Us", dueAt: ahead(5), reference: received ? `ACH ${titleName} ${between(1000, 9999)}` : null, createdAt: ago(ago0 - 5), updatedAt: received ? ago(d.tag === "paid_old" ? ago0 - 21 : between(1, 12)) : undefined });
      P.push({ workspaceId: ws, opportunityId: d.id, kind: "title_fee", direction: "out", amount: 650, status: received ? "paid" : "due", payee: titleName, createdAt: ago(ago0 - 5) });
      if (bInfo) {
        await signedContract(d, "assignment", d.tag === "countersign" ? "partially_signed" : "effective", { buyer: bInfo, daysAgo: d.stage === "CLOSED" ? ago0 - 8 : 4 });
        if (d.tag === "countersign") await db.task.create({ data: { workspaceId: ws, kind: "review", title: `Countersign the assignment: ${d.address}`, entityType: "opportunity", entityId: d.id, priority: 1, assignee: ownerId, dueAt: ago(0, 1) } });
        if (d.stage === "CLOSED") await db.contact.update({ where: { id: bInfo.id }, data: { dealsClosed: { increment: 1 } } });
      }
    }
    // Title emails into the deal inbox
    const inbox = `deal-${d.id.slice(-8)}@deals.example.com`;
    const tEmails: [number, string, string, string][] = [
      [ago0 - 1, "Title opened", `We've opened title for ${d.address}. File #${between(24000, 26999)}. Please send the EMD within 3 business days. Wire instructions will be provided by phone only.`, "Title opened; file number received; EMD due in 3 days."],
    ];
    if (doneUpTo >= 4) tEmails.push([ago0 - 4, "Title commitment", `Attached is the title commitment for ${d.address}. Requirements: payoff of the existing mortgage, seller's photo ID${d.market.state === "GA" ? ", and attorney review" : ""}.`, "Commitment received; needs payoff and seller ID."]);
    if (d.tag === "settlement_issue") tEmails.push([0.3, "Draft settlement statement", "Please review the attached draft ALTA for next week's closing.", "Settlement statement checked: 2 issues found (tax proration, fee $2,000 short)."]);
    if (d.stage === "CLOSING" && d.tag !== "countersign") tEmails.push([1, "Closing scheduled", `Closing for ${d.address} is scheduled. Buyer will sign at our office; seller via mobile notary.`, "Closing scheduled; mobile notary for seller."]);
    for (const [dAgo, subject, body, summary] of tEmails) {
      await db.interaction.create({ data: { workspaceId: ws, opportunityId: d.id, channel: "email", direction: "inbound", provider: "email", fromAddr: `closings.${d.market.state.toLowerCase()}@example.com`, toAddr: inbox, subject: `RE: ${d.address} – ${subject}`, body, summary, createdAt: ago(Math.max(0, dAgo)), processedAt: ago(Math.max(0, dAgo)) } });
    }
    await db.interaction.create({ data: { workspaceId: ws, opportunityId: d.id, channel: "email", direction: "outbound", provider: "email", fromAddr: "deals@example.com", toAddr: `closings.${d.market.state.toLowerCase()}@example.com`, subject: `Open title: ${d.address}`, body: `Hello,\n\nPlease open title for ${d.address}. Signed purchase agreement attached (${sellerK.id.slice(-6)}). Reply to ${inbox} so everything lands on the deal.\n\nThank you,\n${COMPANY}`, createdAt: ago(ago0), processedAt: ago(ago0) } });
    log(who("tc"), "title_checklist", "transaction", tx.id, ago(1), { stage: txStage });
  }
  await db.payment.createMany({ data: P });
  await db.payment.createMany({
    data: [
      { workspaceId: ws, kind: "expense", direction: "out", amount: 1850, status: "paid", payee: "Direct mail vendor (sample)", note: "October mailer, Houston + Jacksonville", createdAt: ago(18) },
      { workspaceId: ws, kind: "expense", direction: "out", amount: 640, status: "paid", payee: "Skip tracing (sample)", note: "3,200 records", createdAt: ago(26) },
    ],
  });

  // ---------- campaigns ----------
  const campaigns: { name: string; kind: string; state: string | null; market: string | null; status: string; channels: string[]; objective: string; members: string[]; opp?: string }[] = [];
  const byState = (st: string) => deals.filter((d) => d.market.state === st && !atLeast(d.stage, "QUALIFIED"));
  campaigns.push({ name: "Houston absentee owners · October", kind: "seller", state: "TX", market: "Houston", status: "running", channels: ["call", "sms"], objective: "Find owners open to a cash offer in the next 90 days and book a condition walkthrough.", members: deals.filter((d) => d.market.state === "TX").map((d) => d.sellerId) });
  campaigns.push({ name: "Jacksonville probate list", kind: "seller", state: "FL", market: "Jacksonville", status: "running", channels: ["call"], objective: "Speak with heirs and executors respectfully; learn who decides and their timeline.", members: byState("FL").map((d) => d.sellerId) });
  campaigns.push({ name: "Atlanta tax-delinquent", kind: "seller", state: "GA", market: "Atlanta", status: "paused", channels: ["call", "sms"], objective: "Owners behind on taxes: offer a quick sale before the tax sale.", members: byState("GA").map((d) => d.sellerId) });
  campaigns.push({ name: "Columbus vacant homes · September", kind: "seller", state: "OH", market: "Columbus", status: "done", channels: ["call"], objective: "Vacant properties: find out if the owner wants to sell.", members: byState("OH").map((d) => d.sellerId) });
  campaigns.push({ name: "Phoenix high-equity (waiting for AZ pack)", kind: "seller", state: "AZ", market: "Phoenix", status: "draft", channels: ["call"], objective: "High-equity owners 10+ years.", members: deals.filter((d) => d.market.state === "AZ").map((d) => d.sellerId) });
  campaigns.push({ name: "Texas cash buyers: list building", kind: "buyer", state: "TX", market: null, status: "running", channels: ["call", "sms"], objective: "Find active cash buyers and learn their exact buy boxes.", members: buyerRows.filter((b) => b.states.includes("TX")).map((b) => b.id) });
  for (const d of deals.filter((x) => x.stage === "DISPOSITION")) {
    campaigns.push({ name: `Disposition: ${d.address}`, kind: "disposition", state: d.market.state, market: d.market.city, status: d.tag === "hot" ? "running" : "done", channels: ["sms", "call"], objective: "Market to matching buyers with disclosure; find the best serious offer above the floor.", members: (await db.buyerInterest.findMany({ where: { opportunityId: d.id }, select: { contactId: true } })).map((x) => x.contactId), opp: d.id });
  }
  const agentByRole = Object.fromEntries((await db.agent.findMany({ where: { workspaceId: ws } })).map((a) => [a.role, a.id]));
  const blockedReasons = ["TX requires recorded consent for AI-voice calls. Record consent, or call manually.", "On a Do Not Call list (dncscrub D)", "Known TCPA litigator / complainer (blacklist_alliance)", "Opted out", "Daily call limit for this contact reached"];
  for (const [ci, c] of campaigns.entries()) {
    const camp = await db.campaign.create({
      data: { workspaceId: ws, kind: c.kind, name: c.name, status: c.status, state: c.state, market: c.market, channels: c.channels, opportunityId: c.opp, agentId: agentByRole[c.kind === "buyer" ? "buyer_acquisition" : c.kind === "disposition" ? "disposition" : "seller_acquisition"], version: 1 + (ci % 3), settings: json({ objective: c.objective, maxAttempts: 3, retryGapHours: 24, dailyCap: 150, concurrency: 3, smsTemplate: "Hi {{first_name}}, this is {{agent_name}} with {{company}}. Would you consider an offer on {{property_address}}?", filters: {}, budget: c.kind === "seller" ? 1500 : null }), createdAt: ago(between(5, 45)) },
    });
    const uniq = [...new Set(c.members)];
    for (const [mi2, contactId] of uniq.entries()) {
      const d = deals.find((x) => x.sellerId === contactId);
      const contact = await db.contact.findUnique({ where: { id: contactId }, select: { doNotContact: true } });
      let status = c.status === "draft" ? "pending" : c.status === "done" ? "done" : pick(["pending", "pending", "retry", "done", "done", "in_progress", "blocked"]);
      if (contact?.doNotContact) status = "stopped";
      if (d?.tag === "dnc_blocked") status = "blocked";
      await db.campaignMember.create({
        data: {
          campaignId: camp.id,
          contactId,
          propertyId: d?.propertyId ?? null,
          status,
          attempts: status === "pending" ? 0 : between(1, 3),
          nextAttemptAt: ["pending", "retry"].includes(status) ? ahead(0, between(1, 30)) : null,
          lastOutcome: status === "done" ? pick(["conversation", "conversation", "not_interested", "max_attempts"]) : status === "retry" ? pick(["no_answer", "voicemail", "busy"]) : null,
          blockedReason: status === "stopped" ? "Opted out" : status === "blocked" ? (d?.tag === "dnc_blocked" ? "On a Do Not Call list (dncscrub D)" : blockedReasons[mi2 % blockedReasons.length]) : null,
          createdAt: ago(between(2, 20)),
        },
      });
    }
    // Attribute some calls to the campaign so outcomes show.
    if (c.kind === "seller" && c.status !== "draft") {
      await db.interaction.updateMany({ where: { workspaceId: ws, contactId: { in: uniq }, channel: "call" }, data: { campaignId: camp.id } });
    }
    log(ownerId, `campaign_${c.status === "draft" ? "created" : "running"}`, "campaign", camp.id, ago(between(3, 40)));
  }

  // ---------- live DNC check history ----------
  const allSellers = await db.contact.findMany({ where: { workspaceId: ws, kind: "seller", phone: { not: null } }, take: 45 });
  await db.phoneCheck.createMany({
    data: allSellers.map((s, i) => {
      const d = deals.find((x) => x.sellerId === s.id);
      const blocked = d?.tag === "dnc_blocked" || i % 13 === 7;
      return { workspaceId: ws, phone: s.phone!, provider: i % 9 === 4 ? "blacklist_alliance" : "dncscrub", blocked, code: blocked ? (i % 9 === 4 ? "plaintiff-primary" : "D") : pick(["C", "C", "W", "E"]), reason: blocked ? (i % 9 === 4 ? "Litigator / blacklist (plaintiff-primary)" : "On a Do Not Call list") : null, lineType: pick(["wireless", "wireless", "landline", undefined]) ?? null, checkedAt: ago(between(0, 6), between(0, 20)) };
    }),
  });

  // ---------- tasks ----------
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const t = (x: Partial<Prisma.TaskCreateManyInput> & { title: string; kind: string }) => tasks.push({ workspaceId: ws, priority: 2, dueAt: new Date(), status: "open", ...x });
  for (const d of deals) {
    if (d.stage === "ENGAGED" || d.stage === "QUALIFIED") t({ kind: "call", title: `Callback: ${d.sellerName} (${d.address})`, contactId: d.sellerId, entityType: "opportunity", entityId: d.id, assignee: "agent:seller_acquisition", dueAt: ahead(between(0, 3), between(1, 8)), reason: "Asked to talk later in the week", payload: json({ agentRole: "seller_acquisition", opportunityId: d.id }) });
    if (d.stage === "PROPERTY_DISCOVERY") t({ kind: "call", title: `Property discovery follow-up: ${d.address}`, contactId: d.sellerId, entityType: "opportunity", entityId: d.id, assignee: "agent:property_discovery", dueAt: ahead(1), payload: json({ agentRole: "property_discovery", opportunityId: d.id }) });
    if (d.stage === "OFFER_READY") t({ kind: "call", title: `Present offer: ${d.address}`, contactId: d.sellerId, entityType: "opportunity", entityId: d.id, assignee: "agent:negotiation", priority: 1, dueAt: ahead(0, 3), payload: json({ agentRole: "negotiation", opportunityId: d.id }) });
    if (d.stage === "UNDERWRITING") t({ kind: "review", title: `Valuation blocked: add square footage or verified ARV for ${d.address}`, entityType: "opportunity", entityId: d.id, assignee: who("acq"), priority: 1, dueAt: ago(1) });
    if (d.stage === "UNDER_CONTRACT" && d.tag === "emd_due") t({ kind: "contract_deadline", title: `Earnest money due: ${d.address}`, entityType: "opportunity", entityId: d.id, priority: 1, dueAt: ahead(0, 20) });
    if (d.stage === "DISPOSITION") t({ kind: "chase_title", title: `Chase title: commitment for ${d.address}`, entityType: "opportunity", entityId: d.id, assignee: "agent:transaction", dueAt: ahead(1) });
  }
  const sb = buyerRows.slice(0, 6);
  t({ kind: "follow_up", title: `Check in with ${buyerRows[3].name}: ignored 5 deals`, contactId: buyerRows[3].id, assignee: who("dispo"), dueAt: ahead(1) });
  t({ kind: "follow_up", title: "Request proof of funds from 4 unverified buyers", assignee: who("dispo"), dueAt: ago(2), priority: 1 });
  t({ kind: "custom", title: "Order October direct mail for Dallas", assignee: who("admin"), dueAt: ahead(3) });
  t({ kind: "custom", title: "Have counsel review the Arizona State Pack", assignee: ownerId, dueAt: ahead(5), priority: 1 });
  t({ kind: "custom", title: "Replace SAMPLE contract templates with attorney versions", assignee: ownerId, dueAt: ago(3), priority: 1 });
  for (const b of sb) t({ kind: "sms", title: `Present deal (anonymous demand check) to ${b.name}`, contactId: b.id, assignee: "agent:disposition", dueAt: ahead(0, 1), status: "done", result: "Texted", updatedAt: ago(0, 6) });
  t({ kind: "call", title: "Houston absentee owners · October: call", status: "failed", result: "Blocked: On a Do Not Call list (dncscrub D)", dueAt: ago(1), assignee: "agent:seller_acquisition" });
  t({ kind: "call", title: "Callback (rescheduled to permitted hours)", status: "open", result: null, reason: "Outside permitted hours in FL (08:00–20:00 America/New_York)", dueAt: ahead(0, 11), assignee: "agent:seller_acquisition" });
  t({ kind: "process_interaction", title: "Read conversation and update records", status: "done", result: "Seller would consider selling; motivated by back taxes.", dueAt: ago(0, 4) });
  t({ kind: "valuation", title: "Recalculate valuation", status: "done", result: "Max buy $121,400", dueAt: ago(0, 6) });
  t({ kind: "email", title: "Send deal package to Lone Star Title", status: "failed", attempts: 3, result: "Email failed (422): The from address domain is not verified (sample)", dueAt: ago(3) });
  t({ kind: "follow_up", title: "We promised: send the seller a copy of the comps", status: "done", result: "Completed by Omar Haddad", dueAt: ago(4) });
  await db.task.createMany({ data: tasks });

  // ---------- notifications ----------
  const nearHot = deals.find((d) => d.tag === "near_hot")!;
  const hotD = deals.find((d) => d.tag === "hot")!;
  const issue = deals.find((d) => d.tag === "settlement_issue")!;
  const paid = deals.filter((d) => d.tag === "paid_month");
  await db.notification.createMany({
    data: [
      { workspaceId: ws, title: `🔥 Hot deal (${82})`, body: `2 serious investors on ${nearHot.address}. Recommend earnest money.`, href: "/approvals", createdAt: ago(0, 20) },
      { workspaceId: ws, title: `🔥 Hot deal (${88})`, body: `${hotD.address}: buyer offered above round 2.`, href: `/deals/${hotD.id}?tab=buyers`, createdAt: ago(1) },
      { workspaceId: ws, title: "Approval needed", body: `Approve final offer: ${nearHot.address}`, href: "/approvals", createdAt: ago(0, 5) },
      { workspaceId: ws, title: "⚠️ Settlement statement issues", body: `${issue.address}: county tax proration charged to us; assignment fee $2,000 short.`, href: `/deals/${issue.id}?tab=closing`, createdAt: ago(0, 6) },
      { workspaceId: ws, title: "⚠️ Possible wire fraud", body: "An email from 'closings-tx@examp1e.com' asked to change wire instructions. Do not wire; call the title company on the known number.", href: "/closing", createdAt: ago(2) },
      ...paid.map((d, i) => ({ workspaceId: ws, title: "💰 Paid", body: `Assignment fee received for ${d.address}.`, href: `/deals/${d.id}`, createdAt: ago(3 + i * 4), readAt: ago(2 + i * 4) })),
      { workspaceId: ws, title: "Signed", body: `The buyer signed the assignment for ${deals.find((d) => d.tag === "countersign")!.address}. Countersign to make it effective.`, href: `/deals/${deals.find((d) => d.tag === "countersign")!.id}?tab=contracts`, createdAt: ago(0, 1) },
      { workspaceId: ws, title: "New voicemail", body: "Gloria Perry: 'Calling about the letter for my house on Lem Turner Rd, call me after 3.'", href: "/ops", createdAt: ago(0, 8) },
      { workspaceId: ws, title: "DNC list updated", body: "National DNC: 1,240 numbers checked, 38 new. 6 queued calls stopped.", href: "/settings/compliance", createdAt: ago(1), readAt: ago(1) },
      { workspaceId: ws, title: "Deadline", body: `${deals.find((d) => d.tag === "emd_due")!.address}: earnest money due tomorrow.`, href: `/deals/${deals.find((d) => d.tag === "emd_due")!.id}?tab=closing`, createdAt: ago(0, 12) },
      { workspaceId: ws, title: "Contract viewed", body: `${deals.find((d) => d.tag === "viewed")!.sellerName} opened the purchase agreement twice but hasn't signed.`, href: `/deals/${deals.find((d) => d.tag === "viewed")!.id}?tab=contracts`, createdAt: ago(1, 3), readAt: ago(1) },
      { workspaceId: ws, title: "Valuation blocked", body: `${deals.find((d) => d.tag === "no_sqft")!.address}: square footage unknown.`, href: `/deals/${deals.find((d) => d.tag === "no_sqft")!.id}?tab=numbers`, createdAt: ago(2), readAt: ago(1) },
    ],
  });

  // ---------- inbound voicemails & notes ----------
  const vmSeller = deals.find((d) => d.stage === "ENGAGED")!;
  await db.interaction.createMany({
    data: [
      { workspaceId: ws, contactId: vmSeller.sellerId, opportunityId: vmSeller.id, channel: "call", direction: "inbound", provider: "twilio", outcome: "voicemail", summary: "Voicemail: calling back about the offer, available after 3pm", body: "Hi, this is about the letter you sent for my house. Call me back after three. Thanks.", createdAt: ago(0, 8), processedAt: ago(0, 8) },
      { workspaceId: ws, contactId: deals[20].sellerId, opportunityId: deals[20].id, channel: "note", direction: "internal", provider: "manual", body: "Drove by: roof tarp on the back, yard overgrown, two code violation notices on the door.", summary: "Drive-by: roof tarp, code notices", createdAt: ago(2), processedAt: ago(2) },
      { workspaceId: ws, contactId: deals[34].sellerId, opportunityId: deals[34].id, channel: "note", direction: "internal", provider: "manual", body: "Spoke with seller's son. He handles the paperwork but mom decides. Do not call before 10am.", summary: "Son handles paperwork; mom decides; no calls before 10am", createdAt: ago(1), processedAt: ago(1) },
    ],
  });

  // ---------- system events (some failures for the System tab) ----------
  await db.event.createMany({
    data: [
      { workspaceId: ws, type: "interaction.created", handledAt: ago(2), error: "Claude API 529: overloaded (task retried and succeeded)", createdAt: ago(2) },
      { workspaceId: ws, type: "contract.effective", handledAt: ago(5), error: null, createdAt: ago(5) },
      { workspaceId: ws, type: "opportunity.valued", handledAt: ago(0, 3), createdAt: ago(0, 3) },
      { workspaceId: ws, type: "interest.updated", handledAt: ago(1), createdAt: ago(1) },
      { workspaceId: ws, type: "property.changed", handledAt: ago(3), error: "RentCast 429: rate limit (valuation retried in 5 minutes)", createdAt: ago(3) },
    ],
  });

  await db.auditEvent.createMany({ data: audits });
}
