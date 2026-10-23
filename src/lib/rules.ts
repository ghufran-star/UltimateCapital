// Deal Rules engine: owner-editable, layered, versioned, deterministic.
// Everything here is pure calculation so it can run in the live preview and on the server alike.

import { DEAL_TYPES as CATALOG_DEALS, EXIT_STRATEGIES, PROPERTY_TYPES as CATALOG_TYPES, typeCovered } from "./catalog";

export const PROPERTY_TYPES = CATALOG_TYPES;
export const DEAL_TYPES = CATALOG_DEALS;

export const CONDITION_TIERS = [
  { key: "cosmetic", label: "Light" },
  { key: "moderate", label: "Medium" },
  { key: "heavy", label: "Heavy" },
  { key: "gut", label: "Full gut" },
] as const;
export type Tier = "none" | "cosmetic" | "moderate" | "heavy" | "gut";
export const TIER_ORDER: Tier[] = ["none", "cosmetic", "moderate", "heavy", "gut"];

export const EXITS = EXIT_STRATEGIES;
/** Exits valued on rent (cap rate) rather than resale. */
export const RENTAL_EXITS = ["rental", "brrrr", "str"];

// ---------- Types ----------

export type RepairItem = {
  key: string;
  label: string;
  unit: "sqft" | "each" | "fixed";
  costs: Record<Exclude<Tier, "none">, number>; // $ per unit at each tier
};

export type PricingParams = {
  maxBuyPctArv: number; // r in MAO = ARV × r − R − C − F
  subtractRepairs: boolean;
  ourBuyCostsPct: number; // our acquisition closing costs, % of purchase price
  ourBuyCostsFixed: number;
  minFee: number;
  targetFee: number;
  feeInMaxBuy: "min" | "target"; // which fee F is subtracted in the max buy formula
  offerSteps: number[]; // seller offers as % below max buy, e.g. [0.15, 0.07] → 1st, 2nd; the max buy is the ceiling
  buyerRoundFees: number[]; // buyer asking price per round = contract price + fee
  repairs: { lowFactor: number; highFactor: number; contingencyPct: number };
  investor: {
    profitBasis: "net" | "gross" | "both";
    minProfitPct: number; // on total cost (price + repairs)
    minNetProfit: number;
    holdMonths: number;
    monthlyHolding: number; // taxes, insurance, utilities per month
    loanLtv: number; // share of (price + repairs) financed
    loanRateAnnual: number;
    loanPointsPct: number;
    buyClosingPct: number;
    sellCostsPct: number; // agent + seller closing, % of ARV
  };
  rental: { minCapRate: number; expenseRatio: number };
  approvals: { nearAgreementGapPct: number; nearAgreementGapAmt: number };
  hotDeal: { minSerious: number; minScore: number };
  investorContact: { maxDealsPerWeek: number; maxDealsPerMonth: number; fatigueAfter: number };
};

export type Condition = {
  states?: string[];
  markets?: string[];
  zips?: string[];
  propertyTypes?: string[];
  dealTypes?: string[];
  exits?: string[];
  conditionTiers?: string[];
  occupancy?: string[];
  titleFlags?: string[];
  minArv?: number;
  maxArv?: number;
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export type Override = { id: string; name: string; when: Condition; set: DeepPartial<PricingParams> };

export type RuleSetData = {
  defaults: PricingParams;
  overrides: Override[];
  playbook: RepairItem[];
};

export type DealFacts = {
  state?: string | null;
  market?: string | null; // city
  zip?: string | null;
  propertyType?: string | null;
  dealType?: string | null;
  exit?: string | null;
  conditionTier?: string | null;
  occupancy?: string | null;
  titleFlags?: string[];
  arv?: number | null;
};

// ---------- Defaults ----------

export const DEFAULT_PLAYBOOK: RepairItem[] = [
  { key: "roof", label: "Roof", unit: "sqft", costs: { cosmetic: 0.5, moderate: 3, heavy: 6, gut: 9 } },
  { key: "foundation", label: "Foundation", unit: "fixed", costs: { cosmetic: 500, moderate: 5000, heavy: 15000, gut: 30000 } },
  { key: "hvac", label: "HVAC", unit: "fixed", costs: { cosmetic: 300, moderate: 2500, heavy: 7000, gut: 12000 } },
  { key: "plumbing", label: "Plumbing", unit: "fixed", costs: { cosmetic: 300, moderate: 2500, heavy: 8000, gut: 15000 } },
  { key: "electrical", label: "Electrical", unit: "fixed", costs: { cosmetic: 300, moderate: 2500, heavy: 8000, gut: 14000 } },
  { key: "kitchen", label: "Kitchen", unit: "fixed", costs: { cosmetic: 2500, moderate: 9000, heavy: 18000, gut: 30000 } },
  { key: "baths", label: "Bathrooms", unit: "each", costs: { cosmetic: 1500, moderate: 5000, heavy: 9000, gut: 14000 } },
  { key: "flooring", label: "Flooring", unit: "sqft", costs: { cosmetic: 1.5, moderate: 4, heavy: 6, gut: 8 } },
  { key: "paint", label: "Paint (interior/exterior)", unit: "sqft", costs: { cosmetic: 1.5, moderate: 3, heavy: 4.5, gut: 6 } },
  { key: "windows", label: "Windows & doors", unit: "fixed", costs: { cosmetic: 500, moderate: 3000, heavy: 8000, gut: 14000 } },
  { key: "exterior", label: "Exterior, siding & landscaping", unit: "fixed", costs: { cosmetic: 1000, moderate: 4000, heavy: 9000, gut: 15000 } },
  { key: "other", label: "Other / cleanout / permits", unit: "fixed", costs: { cosmetic: 1000, moderate: 3000, heavy: 6000, gut: 10000 } },
];

export const DEFAULT_PARAMS: PricingParams = {
  maxBuyPctArv: 0.7,
  subtractRepairs: true,
  ourBuyCostsPct: 0.01,
  ourBuyCostsFixed: 0,
  minFee: 10000,
  targetFee: 30000,
  feeInMaxBuy: "min",
  offerSteps: [0.15, 0.07],
  buyerRoundFees: [30000, 20000, 15000],
  repairs: { lowFactor: 0.85, highFactor: 1.25, contingencyPct: 0.1 },
  investor: {
    profitBasis: "net",
    minProfitPct: 0.15,
    minNetProfit: 20000,
    holdMonths: 5,
    monthlyHolding: 900,
    loanLtv: 0.85,
    loanRateAnnual: 0.11,
    loanPointsPct: 0.02,
    buyClosingPct: 0.015,
    sellCostsPct: 0.08,
  },
  rental: { minCapRate: 0.07, expenseRatio: 0.45 },
  approvals: { nearAgreementGapPct: 0.05, nearAgreementGapAmt: 5000 },
  hotDeal: { minSerious: 2, minScore: 70 },
  investorContact: { maxDealsPerWeek: 3, maxDealsPerMonth: 10, fatigueAfter: 4 },
};

export const DEFAULT_RULESET: RuleSetData = {
  defaults: DEFAULT_PARAMS,
  overrides: [
    {
      id: "heavy-multi",
      name: "2–4 units with heavy rehab",
      when: { propertyTypes: ["2_4"], conditionTiers: ["heavy", "gut"] },
      set: { maxBuyPctArv: 0.65, minFee: 15000 },
    },
  ],
  playbook: DEFAULT_PLAYBOOK,
};

// ---------- Resolution ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, patch: unknown, path: string, source: string, sources: Record<string, string>): T {
  if (!isObj(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") continue;
    const p = path ? `${path}.${k}` : k;
    if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v, p, source, sources);
    else {
      out[k] = v;
      sources[p] = source;
    }
  }
  return out as T;
}

const lc = (a?: string[]) => (a || []).map((x) => x.toLowerCase());

export function matches(when: Condition, f: DealFacts): boolean {
  const inList = (list: string[] | undefined, v?: string | null) => !list?.length || (v ? lc(list).includes(v.toLowerCase()) : false);
  if (!inList(when.states, f.state)) return false;
  if (!inList(when.markets, f.market)) return false;
  if (!inList(when.zips, f.zip)) return false;
  if (!typeCovered(when.propertyTypes, f.propertyType)) return false;
  if (!inList(when.dealTypes, f.dealType)) return false;
  if (!inList(when.exits, f.exit)) return false;
  if (!inList(when.conditionTiers, f.conditionTier)) return false;
  if (!inList(when.occupancy, f.occupancy)) return false;
  if (when.titleFlags?.length && !when.titleFlags.some((t) => (f.titleFlags || []).includes(t))) return false;
  if (when.minArv && (!f.arv || f.arv < when.minArv)) return false;
  if (when.maxArv && (!f.arv || f.arv > when.maxArv)) return false;
  return true;
}

export function specificity(when: Condition) {
  return Object.values(when).filter((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null)).length;
}

/** Applies matching overrides from least to most specific. Returns params + where each value came from. */
export function resolveParams(rs: RuleSetData, f: DealFacts) {
  const sources: Record<string, string> = {};
  const applied = rs.overrides
    .filter((o) => matches(o.when, f))
    .sort((a, b) => specificity(a.when) - specificity(b.when));
  let params = structuredClone(rs.defaults);
  for (const o of applied) params = merge(params, o.set, "", o.name, sources);
  return { params, sources, applied: applied.map((o) => o.name) };
}

// ---------- Repairs ----------

export type RepairInput = Record<string, Tier>; // item key → tier
export type RepairLine = { key: string; label: string; tier: Tier; cost: number; reason?: string };

export function estimateRepairs(
  playbook: RepairItem[],
  tiers: RepairInput,
  p: PricingParams,
  home: { sqft?: number | null; baths?: number | null },
  reasons: Record<string, string> = {}
) {
  const sqft = home.sqft || 1500;
  const baths = Math.max(1, Math.round(home.baths || 1));
  const lines: RepairLine[] = [];
  for (const it of playbook) {
    const tier = tiers[it.key] || "none";
    if (tier === "none") continue;
    const unitCost = it.costs[tier] || 0;
    const qty = it.unit === "sqft" ? sqft : it.unit === "each" ? baths : 1;
    lines.push({ key: it.key, label: it.label, tier, cost: Math.round(unitCost * qty), reason: reasons[it.key] });
  }
  const base = lines.reduce((a, l) => a + l.cost, 0);
  const likely = Math.round(base * (1 + p.repairs.contingencyPct));
  return {
    lines,
    low: Math.round(likely * p.repairs.lowFactor),
    likely,
    high: Math.round(likely * p.repairs.highFactor),
  };
}

/** A whole-house tier applied to every item (used when only an overall condition is known). */
export function tiersFromOverall(playbook: RepairItem[], tier: Tier): RepairInput {
  return Object.fromEntries(playbook.map((i) => [i.key, tier]));
}

// ---------- Calculation ----------

export type InvestorView = {
  price: number;
  gross: number;
  grossPct: number;
  net: number;
  netPct: number;
  costs: { buyClosing: number; holding: number; loan: number; selling: number; contingency: number };
  meets: boolean;
  capRate?: number;
};

export type Calculation = {
  arv: number;
  repairs: number;
  maxBuy: number;
  sellerOffers: number[]; // ladder ending at maxBuy
  contractPrice: number;
  buyerRounds: number[];
  floor: number;
  investorMaxPrice: number; // highest price that still meets the investor minimum
  investorAtRounds: InvestorView[];
  investorAtFloor: InvestorView;
  ourFeeAtRounds: number[];
  viable: boolean;
  warnings: string[];
  formula: string[];
};

const r100 = (n: number) => Math.round(n / 100) * 100;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function investorView(price: number, arv: number, repairs: number, p: PricingParams, rent?: number | null): InvestorView {
  const i = p.investor;
  const basis = price + repairs;
  const buyClosing = price * i.buyClosingPct;
  const holding = i.holdMonths * i.monthlyHolding;
  const loan = basis * i.loanLtv * (i.loanRateAnnual * (i.holdMonths / 12) + i.loanPointsPct);
  const selling = arv * i.sellCostsPct;
  const contingency = repairs * p.repairs.contingencyPct;
  const gross = arv - price - repairs;
  const net = gross - buyClosing - holding - loan - selling - contingency;
  const grossPct = basis > 0 ? gross / basis : 0;
  const netPct = basis > 0 ? net / basis : 0;
  const okNet = netPct >= i.minProfitPct && net >= i.minNetProfit;
  const okGross = grossPct >= i.minProfitPct;
  const meets = i.profitBasis === "net" ? okNet : i.profitBasis === "gross" ? okGross : okNet && okGross;
  let capRate: number | undefined;
  if (rent) {
    capRate = (rent * 12 * (1 - p.rental.expenseRatio)) / basis;
  }
  return {
    price,
    gross: Math.round(gross),
    grossPct,
    net: Math.round(net),
    netPct,
    costs: {
      buyClosing: Math.round(buyClosing),
      holding: Math.round(holding),
      loan: Math.round(loan),
      selling: Math.round(selling),
      contingency: Math.round(contingency),
    },
    meets,
    capRate,
  };
}

/** Highest price an investor can pay and still meet their minimum (closed form; net is linear in price). */
export function investorMaxPrice(arv: number, repairs: number, p: PricingParams, exit: string, rent?: number | null) {
  const i = p.investor;
  if (RENTAL_EXITS.includes(exit) && rent) {
    const noi = rent * 12 * (1 - p.rental.expenseRatio);
    return Math.max(0, Math.floor(noi / p.rental.minCapRate - repairs));
  }
  const fin = i.loanLtv * (i.loanRateAnnual * (i.holdMonths / 12) + i.loanPointsPct);
  const k = 1 + i.buyClosingPct + fin;
  const A = arv - repairs - i.holdMonths * i.monthlyHolding - repairs * fin - arv * i.sellCostsPct - repairs * p.repairs.contingencyPct;
  const limits: number[] = [];
  if (i.profitBasis !== "gross") {
    limits.push((A - i.minProfitPct * repairs) / (k + i.minProfitPct));
    limits.push((A - i.minNetProfit) / k);
  }
  if (i.profitBasis !== "net") limits.push((arv - repairs - i.minProfitPct * repairs) / (1 + i.minProfitPct));
  return Math.max(0, Math.floor(Math.min(...limits)));
}

export function calculate(input: {
  arv: number;
  repairs: number;
  params: PricingParams;
  exit?: string | null;
  rent?: number | null;
  contractPrice?: number | null;
}): Calculation {
  const { arv, repairs, params: p } = input;
  const exit = input.exit || "flip";
  const warnings: string[] = [];
  const fee = p.feeInMaxBuy === "target" ? p.targetFee : p.minFee;
  const r = p.subtractRepairs ? repairs : 0;
  const pre = arv * p.maxBuyPctArv - r - fee;
  const ourCosts = (pre * p.ourBuyCostsPct) / (1 + p.ourBuyCostsPct) + p.ourBuyCostsFixed;
  const maxBuy = Math.max(0, r100(pre - ourCosts));
  const sellerOffers = [...p.offerSteps.map((s) => r100(maxBuy * (1 - s))), maxBuy]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
  const contractPrice = input.contractPrice || sellerOffers[Math.max(0, sellerOffers.length - 2)] || maxBuy;
  const invMax = investorMaxPrice(arv, repairs, p, exit, input.rent);
  const floor = contractPrice + p.minFee;
  let buyerRounds = p.buyerRoundFees.map((f) => contractPrice + f);
  if (buyerRounds.some((b) => b > invMax)) {
    warnings.push(`Some buyer asking prices were capped at ${usd(invMax)} so the investor still meets their minimum.`);
    buyerRounds = buyerRounds.map((b) => Math.max(floor, Math.min(b, Math.floor(invMax / 100) * 100)));
  }
  buyerRounds = buyerRounds.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
  const viable = invMax >= floor && maxBuy > 0;
  if (!viable) warnings.push(`Not viable: the investor's maximum (${usd(invMax)}) is below our floor (${usd(floor)}).`);
  if (contractPrice > maxBuy) warnings.push(`Contract price ${usd(contractPrice)} is above the max buy ${usd(maxBuy)}: needs approval.`);

  const formula = [
    `Max buy = ARV ${usd(arv)} × ${pct(p.maxBuyPctArv)}${p.subtractRepairs ? ` − repairs ${usd(repairs)}` : ""} − our fee ${usd(fee)} − our buying costs ${usd(ourCosts)} = ${usd(maxBuy)}`,
    `Seller offers: ${sellerOffers.map(usd).join(" → ")} (ceiling ${usd(maxBuy)})`,
    `Buyer asking prices: ${buyerRounds.map(usd).join(" → ")}; floor ${usd(floor)} (contract ${usd(contractPrice)} + minimum fee ${usd(p.minFee)})`,
    `Investor maximum price meeting their ${p.investor.profitBasis} minimum: ${usd(invMax)}`,
  ];

  return {
    arv,
    repairs,
    maxBuy,
    sellerOffers,
    contractPrice,
    buyerRounds,
    floor,
    investorMaxPrice: invMax,
    investorAtRounds: buyerRounds.map((b) => investorView(b, arv, repairs, p, input.rent)),
    investorAtFloor: investorView(floor, arv, repairs, p, input.rent),
    ourFeeAtRounds: buyerRounds.map((b) => b - contractPrice),
    viable,
    warnings,
    formula,
  };
}

// ---------- Negotiation authority (what the AI is allowed to know) ----------

export type Authority = {
  offerNow: number | null;
  ifCounteredUpTo: number | null;
  message: string;
  needsApproval: boolean;
};

/** Seller side: only the next step of the ladder is revealed; the ceiling never is. */
export function sellerAuthority(ladder: number[], offeredSoFar: number[], sellerAsk?: number | null): Authority {
  const highest = offeredSoFar.length ? Math.max(...offeredSoFar) : 0;
  const next = ladder.filter((x) => x > highest);
  if (!next.length) {
    return { offerNow: null, ifCounteredUpTo: null, needsApproval: true, message: "No further authority. Tell them you need to check with your manager, and use request_approval." };
  }
  if (sellerAsk && sellerAsk <= next[0]) {
    return { offerNow: sellerAsk, ifCounteredUpTo: null, needsApproval: false, message: `Their price ${usd(sellerAsk)} is within authority. You may agree in principle, subject to the owner's final approval and a written contract.` };
  }
  return {
    offerNow: next[0],
    ifCounteredUpTo: next[1] ?? null,
    needsApproval: false,
    message: next[1]
      ? `You may offer ${usd(next[0])}. If they counter, you may go up to ${usd(next[1])}. Do not go higher.`
      : `You may offer ${usd(next[0])}. This is the last step: above it, use request_approval.`,
  };
}

/** Buyer side: never below the floor. Returns the next asking price to present. */
export function buyerAuthority(rounds: number[], floor: number, presentedSoFar: number[], buyerOffer?: number | null): Authority {
  const lowest = presentedSoFar.length ? Math.min(...presentedSoFar) : Infinity;
  const next = rounds.filter((x) => x < lowest);
  if (buyerOffer && buyerOffer >= floor && (!next.length || buyerOffer >= next[0])) {
    return { offerNow: buyerOffer, ifCounteredUpTo: null, needsApproval: false, message: `Their offer ${usd(buyerOffer)} is acceptable in principle, subject to the owner's approval and a written agreement.` };
  }
  if (!next.length) return { offerNow: null, ifCounteredUpTo: null, needsApproval: true, message: "No lower price is authorised. Use request_approval." };
  return { offerNow: next[0], ifCounteredUpTo: next[1] ?? null, needsApproval: false, message: `Present ${usd(next[0])}.${next[1] ? ` If they push back you may come down to ${usd(next[1])}, not lower.` : " This is the lowest authorised price."}` };
}

/** True when the gap between our highest authorised offer and the seller's lowest is "small". */
export function nearAgreement(sellerLowest: number | null | undefined, maxBuy: number, p: PricingParams) {
  if (!sellerLowest) return false;
  const gap = sellerLowest - maxBuy;
  return gap <= Math.max(p.approvals.nearAgreementGapAmt, maxBuy * p.approvals.nearAgreementGapPct);
}

export const fmtUsd = usd;
export const fmtPct = pct;
