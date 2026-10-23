// The fixed choices used across the app, in US real estate / wholesaling terms.
// Sources: RESO Data Dictionary 2.1 PropertySubType (MLS standard) and PropStream's motivated-seller lead lists.
// Pure data: safe to import in client components.

export type Option = { key: string; label: string; group?: string; hint?: string };

export const US_STATES: Option[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([key, name]) => ({ key, label: `${name} (${key})` }));

/**
 * Property types. `group` is the broad class buy boxes and rule variations can target:
 * a buy box for "2–4 units" matches a duplex, triplex or fourplex.
 */
export const PROPERTY_TYPES: Option[] = [
  { key: "sfr", label: "Single-family home (detached)", group: "Residential 1 unit" },
  { key: "townhouse", label: "Townhouse / rowhouse", group: "Residential 1 unit" },
  { key: "condo", label: "Condominium", group: "Residential 1 unit" },
  { key: "coop", label: "Co-op (stock cooperative)", group: "Residential 1 unit" },
  { key: "duplex", label: "Duplex (2 units)", group: "Small multifamily 2–4" },
  { key: "triplex", label: "Triplex (3 units)", group: "Small multifamily 2–4" },
  { key: "fourplex", label: "Fourplex / quadruplex (4 units)", group: "Small multifamily 2–4" },
  { key: "multifamily", label: "Apartment building (5+ units)", group: "Multifamily 5+" },
  { key: "manufactured_land", label: "Manufactured / mobile home on owned land", group: "Manufactured" },
  { key: "mobile_no_land", label: "Mobile home, lot rented (no land)", group: "Manufactured" },
  { key: "mobile_park", label: "Mobile home park", group: "Commercial" },
  { key: "land", label: "Vacant / unimproved land", group: "Land" },
  { key: "lot", label: "Residential building lot", group: "Land" },
  { key: "farm_ranch", label: "Farm / ranch / agricultural", group: "Land" },
  { key: "mixed_use", label: "Mixed-use (residential + commercial)", group: "Commercial" },
  { key: "retail", label: "Retail", group: "Commercial" },
  { key: "office", label: "Office", group: "Commercial" },
  { key: "industrial", label: "Industrial / warehouse", group: "Commercial" },
  { key: "hotel_motel", label: "Hotel / motel", group: "Commercial" },
  { key: "storage", label: "Self-storage", group: "Commercial" },
  { key: "church", label: "Church / special purpose", group: "Commercial" },
  { key: "other", label: "Other", group: "Other" },
];

// Older keys still stored on records and buy boxes, mapped to the types they cover.
export const LEGACY_PROPERTY_TYPES: Record<string, string[]> = {
  condo_th: ["condo", "townhouse", "coop"],
  "2_4": ["duplex", "triplex", "fourplex"],
  "5_plus": ["multifamily"],
  mobile: ["manufactured_land", "mobile_no_land"],
  commercial: ["mixed_use", "retail", "office", "industrial", "hotel_motel", "storage", "church", "mobile_park"],
};
export const PROPERTY_GROUP_KEYS: Record<string, string[]> = {
  "Residential 1 unit": ["sfr", "townhouse", "condo", "coop"],
  "Small multifamily 2–4": ["duplex", "triplex", "fourplex"],
  "Multifamily 5+": ["multifamily"],
  Manufactured: ["manufactured_land", "mobile_no_land"],
  Land: ["land", "lot", "farm_ranch"],
  Commercial: ["mixed_use", "retail", "office", "industrial", "hotel_motel", "storage", "church", "mobile_park"],
};

/** Expands a list of type keys (new, legacy or group names) into concrete type keys. */
export function expandTypes(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    for (const x of LEGACY_PROPERTY_TYPES[k] || PROPERTY_GROUP_KEYS[k] || []) out.add(x);
  }
  return [...out];
}
/** True when a property type is covered by the list (empty list = any). */
export function typeCovered(list: string[] | undefined, type: string | null | undefined) {
  if (!list?.length) return true;
  if (!type) return false;
  const all = expandTypes(list);
  return all.includes(type) || expandTypes([type]).some((t) => all.includes(t));
}

export const DEAL_TYPES: Option[] = [
  { key: "assignment", label: "Assignment of contract", hint: "We assign our purchase contract to an investor for a fee" },
  { key: "double_close", label: "Double close", hint: "We buy and resell the same day, two closings" },
  { key: "purchase", label: "Direct purchase (we close and own)", hint: "Flip, wholetail or hold ourselves" },
  { key: "wholetail", label: "Wholetail", hint: "Buy, light clean-up, resell retail" },
  { key: "novation", label: "Novation", hint: "Seller's agreement lets us list and sell; we take the spread" },
  { key: "subject_to", label: "Subject-to", hint: "Take title with the existing loan left in place" },
  { key: "seller_finance", label: "Seller (owner) financing", hint: "Seller carries the note" },
  { key: "wrap", label: "Wraparound mortgage", hint: "New note wraps the existing loan" },
  { key: "lease_option", label: "Lease option / rent-to-own", hint: "Control the property with an option to buy" },
  { key: "jv", label: "Joint venture (JV) with another wholesaler", hint: "Split the fee on a shared deal" },
  { key: "land_contract", label: "Contract for deed / land contract", hint: "Title passes after payments" },
];

export const EXIT_STRATEGIES: Option[] = [
  { key: "flip", label: "Fix and flip" },
  { key: "rental", label: "Buy and hold (long-term rental)" },
  { key: "brrrr", label: "BRRRR (buy, rehab, rent, refinance, repeat)" },
  { key: "str", label: "Short-term rental" },
  { key: "wholetail", label: "Wholetail" },
  { key: "new_construction", label: "Teardown / new construction" },
  { key: "land_development", label: "Land development / subdivision" },
];
export const BUYER_STRATEGIES: Option[] = [{ key: "any", label: "Any strategy" }, ...EXIT_STRATEGIES];

export const CONDITION_TIERS: Option[] = [
  { key: "none", label: "Turnkey (no work needed)" },
  { key: "cosmetic", label: "Light rehab (cosmetic: paint, flooring, fixtures)" },
  { key: "moderate", label: "Medium rehab (kitchen/baths, some systems)" },
  { key: "heavy", label: "Heavy rehab (roof, systems, structure)" },
  { key: "gut", label: "Full gut / major structural" },
];
export const conditionShort = (k?: string | null) => ({ none: "Turnkey", cosmetic: "Light", moderate: "Medium", heavy: "Heavy", gut: "Full gut" })[k || ""] || "—";

export const OCCUPANCY: Option[] = [
  { key: "owner", label: "Owner-occupied" },
  { key: "tenant", label: "Tenant-occupied" },
  { key: "vacant", label: "Vacant" },
  { key: "family", label: "Family member living there" },
  { key: "squatter", label: "Squatters / unauthorised occupants" },
];

export const OWNER_TYPES: Option[] = [
  { key: "individual", label: "Individual" },
  { key: "joint", label: "Joint owners / married couple" },
  { key: "llc", label: "LLC / corporation" },
  { key: "trust", label: "Trust" },
  { key: "estate", label: "Estate (owner deceased)" },
  { key: "bank", label: "Bank / lender (REO)" },
  { key: "government", label: "Government / tax authority" },
];

/** Seller situations ("distress indicators"), as wholesaling lead lists name them. */
export const SITUATIONS: Option[] = [
  { key: "pre_foreclosure", label: "Pre-foreclosure (notice of default)", group: "Financial" },
  { key: "auction", label: "Scheduled for auction (trustee/sheriff sale)", group: "Financial" },
  { key: "reo", label: "Bank-owned (REO)", group: "Financial" },
  { key: "bankruptcy", label: "Bankruptcy", group: "Financial" },
  { key: "tax_delinquent", label: "Tax delinquent", group: "Financial" },
  { key: "liens", label: "Liens (tax, HOA, mechanics)", group: "Financial" },
  { key: "upside_down", label: "Upside down (owes more than it's worth)", group: "Financial" },
  { key: "behind_payments", label: "Behind on payments", group: "Financial" },
  { key: "assumable", label: "Assumable mortgage (FHA/VA/USDA)", group: "Financial" },
  { key: "high_equity", label: "High equity", group: "Equity" },
  { key: "free_clear", label: "Free and clear (no mortgage)", group: "Equity" },
  { key: "probate", label: "Probate / inherited", group: "Life event" },
  { key: "pre_probate", label: "Pre-probate (owner deceased, no filing yet)", group: "Life event" },
  { key: "divorce", label: "Divorce", group: "Life event" },
  { key: "senior", label: "Senior owner / long-term owner", group: "Life event" },
  { key: "relocation", label: "Relocating / job transfer", group: "Life event" },
  { key: "health", label: "Health / moving to care", group: "Life event" },
  { key: "job_loss", label: "Job loss / income drop", group: "Life event" },
  { key: "downsizing", label: "Downsizing", group: "Life event" },
  { key: "tired_landlord", label: "Tired landlord", group: "Property" },
  { key: "problem_tenant", label: "Problem tenant / eviction", group: "Property" },
  { key: "vacant", label: "Vacant", group: "Property" },
  { key: "zombie", label: "Zombie (vacant + pre-foreclosure)", group: "Property" },
  { key: "code_violations", label: "Code violations", group: "Property" },
  { key: "fire_damage", label: "Fire / water / storm damage", group: "Property" },
  { key: "major_repairs", label: "Needs major repairs", group: "Property" },
  { key: "absentee", label: "Absentee owner", group: "Ownership" },
  { key: "out_of_state", label: "Out-of-state owner", group: "Ownership" },
  { key: "failed_listing", label: "Failed / expired MLS listing", group: "Market" },
  { key: "fsbo", label: "For sale by owner (FSBO)", group: "Market" },
];

export const LEAD_SOURCES: Option[] = [
  { key: "cold_call", label: "Cold calling", group: "Outbound" },
  { key: "sms", label: "Text campaign", group: "Outbound" },
  { key: "direct_mail", label: "Direct mail", group: "Outbound" },
  { key: "ringless_vm", label: "Ringless voicemail", group: "Outbound" },
  { key: "door_knocking", label: "Door knocking", group: "Outbound" },
  { key: "driving_for_dollars", label: "Driving for dollars", group: "Outbound" },
  { key: "website", label: "Website / SEO", group: "Inbound" },
  { key: "ppc", label: "Pay-per-click (Google Ads)", group: "Inbound" },
  { key: "social", label: "Social media ads", group: "Inbound" },
  { key: "ppl", label: "Pay-per-lead service", group: "Inbound" },
  { key: "inbound_call", label: "Inbound call", group: "Inbound" },
  { key: "bandit_signs", label: "Bandit signs", group: "Inbound" },
  { key: "referral", label: "Referral", group: "Network" },
  { key: "agent", label: "Real estate agent / MLS", group: "Network" },
  { key: "wholesaler", label: "Other wholesaler (JV)", group: "Network" },
  { key: "probate_court", label: "Probate court records", group: "Public records" },
  { key: "county_records", label: "County records (tax, code, liens)", group: "Public records" },
  { key: "list_provider", label: "List provider (PropStream, BatchLeads…)", group: "Data" },
  { key: "imported", label: "Imported list", group: "Data" },
  { key: "other", label: "Other", group: "Other" },
];

export const FUNDING_METHODS: Option[] = [
  { key: "cash", label: "Cash" },
  { key: "hard_money", label: "Hard money" },
  { key: "private", label: "Private money" },
  { key: "dscr", label: "DSCR loan" },
  { key: "conventional", label: "Conventional loan" },
  { key: "heloc", label: "HELOC / line of credit" },
  { key: "sdira", label: "Self-directed IRA" },
  { key: "transactional", label: "Transactional funding" },
];

export const OWNERSHIP_ROLES: Option[] = [
  { key: "owner", label: "Owner" },
  { key: "co_owner", label: "Co-owner" },
  { key: "spouse", label: "Spouse" },
  { key: "heir", label: "Heir" },
  { key: "executor", label: "Executor / personal representative" },
  { key: "trustee", label: "Trustee" },
  { key: "poa", label: "Power of attorney" },
  { key: "attorney", label: "Seller's attorney" },
];

export const TITLE_FLAGS: Option[] = [
  { key: "probate", label: "Probate needed" },
  { key: "liens", label: "Liens" },
  { key: "back_taxes", label: "Back taxes" },
  { key: "judgments", label: "Judgments" },
  { key: "hoa_liens", label: "HOA liens" },
  { key: "mechanics_liens", label: "Mechanics liens" },
  { key: "open_permits", label: "Open permits" },
  { key: "code_violations", label: "Code violations" },
  { key: "missing_heirs", label: "Missing heirs" },
  { key: "divorce_decree", label: "Divorce decree needed" },
  { key: "boundary", label: "Boundary / survey issue" },
  { key: "unpaid_utilities", label: "Unpaid utilities / water liens" },
];

export const label = (list: Option[], key?: string | null) => list.find((o) => o.key === key)?.label || key || "—";
export const shortType = (k?: string | null) => {
  const legacy: Record<string, string> = { condo_th: "Condo / townhouse", "2_4": "2–4 units", "5_plus": "5+ units", mobile: "Mobile home", commercial: "Commercial" };
  return legacy[k || ""] || PROPERTY_TYPES.find((o) => o.key === k)?.label.replace(/ \(.*\)$/, "") || k || "—";
};

/** Maps free text from lists and data providers ("Single Family", "Quad", "MFR 5+") to a property type key. */
export function normalizeType(raw?: string | null): string {
  const t = (raw || "").toLowerCase().trim();
  if (!t) return "sfr";
  if (PROPERTY_TYPES.some((o) => o.key === t)) return t;
  if (LEGACY_PROPERTY_TYPES[t]) return t;
  const rules: [RegExp, string][] = [
    [/mobile home park|mhp|trailer park/, "mobile_park"],
    [/mobile|manufactured|modular|trailer/, /no land|rented lot|park lot/.test(t) ? "mobile_no_land" : "manufactured_land"],
    [/duplex|2[- ]?unit|two family/, "duplex"],
    [/triplex|3[- ]?unit|three family/, "triplex"],
    [/quad|four ?plex|4[- ]?unit|four family/, "fourplex"],
    [/apartment|multi.?family|mfr|5\+|five|units/, "multifamily"],
    [/town ?house|town ?home|row ?house/, "townhouse"],
    [/condo/, "condo"],
    [/co-?op|cooperative/, "coop"],
    [/farm|ranch|agri/, "farm_ranch"],
    [/lot\b|residential lot/, "lot"],
    [/land|acre|vacant lot|unimproved/, "land"],
    [/mixed/, "mixed_use"],
    [/retail|store|shop/, "retail"],
    [/office/, "office"],
    [/industrial|warehouse|flex/, "industrial"],
    [/hotel|motel/, "hotel_motel"],
    [/storage/, "storage"],
    [/church|special/, "church"],
    [/single|sfr|sfh|residential|house|home/, "sfr"],
  ];
  for (const [re, key] of rules) if (re.test(t)) return key;
  return "other";
}
