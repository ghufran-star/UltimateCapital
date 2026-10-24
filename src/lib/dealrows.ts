import type { Contact, Opportunity, Property, Valuation } from "@prisma/client";
import { conditionShort, label as catLabel, LEAD_SOURCES, SITUATIONS, shortType } from "./catalog";
import { buyerLadder, contractBasis } from "./deals";
import { resolveParams, type Calculation, type RuleSetData } from "./rules";
import { label as stageLabel } from "./stages";
import { fullName } from "./util";

// The numbers behind each deal row, shared by the deals table and CSV export.

export type DealRow = {
  id: string;
  address: string;
  place: string;
  seller: string;
  stage: string;
  exception: string | null;
  type: string;
  rehab: string;
  rehabCost: number | null;
  arv: number | null;
  maxBuy: number | null;
  asking: number | null;
  lowest: number | null;
  gapSeller: number | null; // seller's number minus our max buy (positive = they want more)
  contract: number | null;
  buyerPrice: number | null; // round-1 asking price to investors
  floor: number | null;
  investorMax: number | null; // highest price an investor can pay and still meet their minimum
  investorRoom: number | null; // investor max minus our floor (positive = room to sell)
  fee: number | null; // projected assignment fee at the round-1 price
  hot: number;
  serious: number;
  source: string;
  situations: string;
  equity: number | null;
  assignee: string;
  blocked: string | null;
  autopilotOff: boolean;
  updatedAt: Date;
};

export type DealWith = Opportunity & { property: Property; valuations: Valuation[]; interests: { serious: boolean }[] };

export function dealRow(d: DealWith, rules: RuleSetData, seller: Pick<Contact, "firstName" | "lastName" | "company"> | null, assignee?: string): DealRow {
  const p = d.property;
  const v = d.valuations[0];
  const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
  let contract: number | null = null;
  let ladder: { rounds: number[]; floor: number } | null = null;
  if (calc) {
    contract = contractBasis(d, calc);
    const { params } = resolveParams(rules, { state: p.state, market: p.city, zip: p.zip, propertyType: p.propertyType, dealType: d.dealType, exit: d.exitStrategy, conditionTier: p.conditionTier, occupancy: p.occupancy, titleFlags: p.titleFlags, arv: calc.arv });
    ladder = buyerLadder(contract, calc, params);
  }
  const sellerNumber = d.sellerLowest ?? d.askingPrice;
  const buyerPrice = ladder?.rounds[0] ?? null;
  return {
    id: d.id,
    address: p.address,
    place: `${p.city}, ${p.state} ${p.zip}`,
    seller: seller ? fullName(seller) : "—",
    stage: stageLabel(d.stage),
    exception: d.exception,
    type: shortType(p.propertyType),
    rehab: conditionShort(p.conditionTier),
    rehabCost: v?.repairsLikely ?? null,
    arv: v?.arv ?? null,
    maxBuy: calc?.maxBuy ?? null,
    asking: d.askingPrice,
    lowest: d.sellerLowest,
    gapSeller: calc && sellerNumber ? sellerNumber - calc.maxBuy : null,
    contract,
    buyerPrice,
    floor: ladder?.floor ?? null,
    investorMax: calc?.investorMaxPrice ?? null,
    investorRoom: calc && ladder ? calc.investorMaxPrice - ladder.floor : null,
    fee: contract !== null && buyerPrice !== null ? buyerPrice - contract : null,
    hot: d.hotScore,
    serious: d.interests.filter((i) => i.serious).length,
    source: d.leadSource ? catLabel(LEAD_SOURCES, d.leadSource) : "—",
    situations: p.situations.map((k) => catLabel(SITUATIONS, k).replace(/ \(.*\)$/, "")).join(", "),
    equity: p.estValue != null ? p.estValue - (p.loanBalance || 0) : null,
    assignee: assignee || "—",
    blocked: v?.blocked ?? null,
    autopilotOff: d.autopilotOff,
    updatedAt: d.updatedAt,
  };
}

export type Col = { key: keyof DealRow | "property"; label: string; money?: boolean; hint?: string };

export const DEAL_COLUMNS: Col[] = [
  { key: "property", label: "Property" },
  { key: "seller", label: "Seller" },
  { key: "stage", label: "Stage" },
  { key: "type", label: "Type" },
  { key: "rehab", label: "Repairs needed" },
  { key: "rehabCost", label: "Repair cost", money: true, hint: "Likely repair cost from the seller's answers and your playbook" },
  { key: "arv", label: "Value after repairs", money: true, hint: "What it sells for once fixed up (ARV)" },
  { key: "maxBuy", label: "Most we'll pay", money: true, hint: "The highest price your rules allow (max buy)" },
  { key: "asking", label: "Seller asked", money: true },
  { key: "lowest", label: "Seller's lowest", money: true },
  { key: "gapSeller", label: "Gap to seller", money: true, hint: "Seller's number minus the most we'll pay. Positive = they want more" },
  { key: "buyerPrice", label: "Price to investors", money: true, hint: "What we ask investors first" },
  { key: "investorMax", label: "Most an investor pays", money: true, hint: "Highest price an investor can pay and still hit their minimum profit" },
  { key: "investorRoom", label: "Room to sell", money: true, hint: "Most an investor pays minus our lowest price. Positive = room to sell" },
  { key: "fee", label: "Your profit", money: true, hint: "Your fee at the first price to investors" },
  { key: "equity", label: "Owner equity", money: true },
  { key: "hot", label: "How hot" },
  { key: "serious", label: "Serious investors" },
  { key: "situations", label: "Situation" },
  { key: "source", label: "Lead source" },
  { key: "assignee", label: "Assigned" },
  { key: "updatedAt", label: "Updated" },
];

export const DEFAULT_DEAL_COLUMNS = ["property", "seller", "stage", "rehab", "rehabCost", "arv", "maxBuy", "lowest", "gapSeller", "buyerPrice", "investorRoom", "fee", "hot"];
