// State machines from the blueprint. Transitions are validated in deals.ts / buyers.

export const SELLER_STAGES = [
  "NEW",
  "ELIGIBLE",
  "OUTREACH",
  "ENGAGED",
  "QUALIFIED",
  "PROPERTY_DISCOVERY",
  "UNDERWRITING",
  "OFFER_READY",
  "NEGOTIATION",
  "CONTRACT_PREPARATION",
  "UNDER_CONTRACT",
  "DISPOSITION",
  "CLOSING",
  "CLOSED",
] as const;
export type SellerStage = (typeof SELLER_STAGES)[number];

export const SELLER_EXCEPTIONS = [
  "CALLBACK",
  "AWAITING_DOCS",
  "VALUATION_BLOCKED",
  "APPROVAL_REQUIRED",
  "DECLINED",
  "WITHDRAWN",
  "OWNERSHIP_DISPUTE",
  "CONTRACT_FAILED",
  "DO_NOT_CONTACT",
] as const;

export const BUYER_STATUSES = ["NEW", "ELIGIBLE", "CONTACTED", "ENGAGED", "QUALIFYING", "QUALIFIED", "ACTIVE"] as const;
export const BUYER_OTHER = ["DORMANT", "CAPACITY_UNVERIFIED", "UNAVAILABLE", "DO_NOT_CONTACT"] as const;

export const INTEREST_STAGES = [
  "MATCHED",
  "CONTACT_ELIGIBLE",
  "PRESENTED",
  "INTERESTED",
  "DUE_DILIGENCE",
  "OFFER_SUBMITTED",
  "TERMS_AGREED",
  "AGREEMENT_EXECUTED",
  "CLOSING",
  "COMPLETED",
] as const;
export const INTEREST_OTHER = ["REJECTED", "NO_RESPONSE", "FINANCING_UNVERIFIED", "WITHDRAWN", "DEAL_UNAVAILABLE"] as const;

export const CLOSING_STAGES = [
  "CONTRACT_EFFECTIVE",
  "TITLE_OPENED",
  "DUE_DILIGENCE",
  "BUYER_AGREEMENT",
  "CONDITIONS_SATISFIED",
  "CLOSING_SCHEDULED",
  "FUNDS_CONFIRMED",
  "CLOSED",
  "RECONCILED",
] as const;

export const label = (s?: string | null) =>
  (s || "")
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

export const DEFAULT_TITLE_CHECKLIST = [
  { key: "package_sent", label: "Contract package sent to title" },
  { key: "title_opened", label: "Title opened / file number received" },
  { key: "emd_deposited", label: "Earnest money deposited" },
  { key: "commitment", label: "Title commitment received" },
  { key: "liens_payoffs", label: "Liens and payoffs identified" },
  { key: "curative", label: "Curative items cleared" },
  { key: "buyer_assignment", label: "Buyer assignment / agreement sent to title" },
  { key: "buyer_funds", label: "Buyer funds / EMD received by title" },
  { key: "settlement_draft", label: "Settlement statement received and checked" },
  { key: "closing_scheduled", label: "Closing scheduled" },
  { key: "signed", label: "All parties signed" },
  { key: "funded", label: "Funded / recorded" },
  { key: "paid", label: "Our fee received" },
];
