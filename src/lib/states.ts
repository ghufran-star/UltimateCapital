// State Packs: per-state legal and operational settings the app enforces automatically.
// The legal content must come from counsel; drafts are marked unverified until approved.

export const STATES: { code: string; name: string; tz: string }[] = [
  ["AL", "Alabama", "America/Chicago"], ["AK", "Alaska", "America/Anchorage"], ["AZ", "Arizona", "America/Phoenix"],
  ["AR", "Arkansas", "America/Chicago"], ["CA", "California", "America/Los_Angeles"], ["CO", "Colorado", "America/Denver"],
  ["CT", "Connecticut", "America/New_York"], ["DE", "Delaware", "America/New_York"], ["DC", "District of Columbia", "America/New_York"],
  ["FL", "Florida", "America/New_York"], ["GA", "Georgia", "America/New_York"], ["HI", "Hawaii", "Pacific/Honolulu"],
  ["ID", "Idaho", "America/Boise"], ["IL", "Illinois", "America/Chicago"], ["IN", "Indiana", "America/Indiana/Indianapolis"],
  ["IA", "Iowa", "America/Chicago"], ["KS", "Kansas", "America/Chicago"], ["KY", "Kentucky", "America/New_York"],
  ["LA", "Louisiana", "America/Chicago"], ["ME", "Maine", "America/New_York"], ["MD", "Maryland", "America/New_York"],
  ["MA", "Massachusetts", "America/New_York"], ["MI", "Michigan", "America/Detroit"], ["MN", "Minnesota", "America/Chicago"],
  ["MS", "Mississippi", "America/Chicago"], ["MO", "Missouri", "America/Chicago"], ["MT", "Montana", "America/Denver"],
  ["NE", "Nebraska", "America/Chicago"], ["NV", "Nevada", "America/Los_Angeles"], ["NH", "New Hampshire", "America/New_York"],
  ["NJ", "New Jersey", "America/New_York"], ["NM", "New Mexico", "America/Denver"], ["NY", "New York", "America/New_York"],
  ["NC", "North Carolina", "America/New_York"], ["ND", "North Dakota", "America/Chicago"], ["OH", "Ohio", "America/New_York"],
  ["OK", "Oklahoma", "America/Chicago"], ["OR", "Oregon", "America/Los_Angeles"], ["PA", "Pennsylvania", "America/New_York"],
  ["RI", "Rhode Island", "America/New_York"], ["SC", "South Carolina", "America/New_York"], ["SD", "South Dakota", "America/Chicago"],
  ["TN", "Tennessee", "America/Chicago"], ["TX", "Texas", "America/Chicago"], ["UT", "Utah", "America/Denver"],
  ["VT", "Vermont", "America/New_York"], ["VA", "Virginia", "America/New_York"], ["WA", "Washington", "America/Los_Angeles"],
  ["WV", "West Virginia", "America/New_York"], ["WI", "Wisconsin", "America/Chicago"], ["WY", "Wyoming", "America/Denver"],
].map(([code, name, tz]) => ({ code, name, tz }));

export const stateName = (c?: string | null) => STATES.find((s) => s.code === c)?.name || c || "";
export const stateTz = (c?: string | null) => STATES.find((s) => s.code === c)?.tz || "America/Chicago";

export type StatePackData = {
  timezone: string;
  wholesaling: {
    marketingBeforeContract: "anonymous_only" | "allowed" | "prohibited";
    marketingAfterContract: "with_disclosure" | "allowed" | "prohibited";
    disclosureText: string;
    licenseNotes: string;
    maxDealsPerYearUnlicensed: number | null;
  };
  contracts: {
    assignmentAllowed: boolean;
    optionPeriodDays: number | null;
    emdDueDays: number;
    typicalEmd: number | null;
    notes: string;
  };
  closing: { attorneyState: boolean; ronAllowed: boolean; notes: string };
  outreach: {
    callStart: string; // HH:MM local
    callEnd: string;
    callDays: string[]; // Mon..Sun
    textStart: string;
    textEnd: string;
    stateDncList: boolean;
    requireConsentAiVoice: boolean;
    requireConsentSms: boolean;
    aiDisclosure: string; // said at the start of AI calls
    identification: string; // who we are line
    maxCallsPerDayPerContact: number;
    notes: string;
  };
  sellerProtections: { cancellationDays: number | null; notices: string };
  sources: string[];
};

/** Conservative federal-baseline draft. Must be reviewed and completed by counsel before activation. */
export function draftPack(code: string): StatePackData {
  return {
    timezone: stateTz(code),
    wholesaling: {
      marketingBeforeContract: "anonymous_only",
      marketingAfterContract: "with_disclosure",
      disclosureText:
        "We hold an equitable interest in this property under a purchase contract and are offering to assign that contract. We are not the owner of the property and are not acting as a licensed real estate agent.",
      licenseNotes: "Confirm with counsel whether wholesaling in this state requires a licence or limits the number of deals.",
      maxDealsPerYearUnlicensed: null,
    },
    contracts: { assignmentAllowed: true, optionPeriodDays: null, emdDueDays: 3, typicalEmd: 1000, notes: "" },
    closing: { attorneyState: false, ronAllowed: false, notes: "" },
    outreach: {
      callStart: "09:00",
      callEnd: "20:00",
      callDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      textStart: "09:00",
      textEnd: "20:00",
      stateDncList: false,
      requireConsentAiVoice: true,
      requireConsentSms: true,
      aiDisclosure: "Just so you know, I'm an AI assistant calling on behalf of {{company}}.",
      identification: "This is {{agent_name}} with {{company}}.",
      maxCallsPerDayPerContact: 1,
      notes: "",
    },
    sellerProtections: { cancellationDays: null, notices: "" },
    sources: [],
  };
}

export type PackStatus = "draft" | "unverified" | "active" | "disabled";
export const PACK_STATUS_LABEL: Record<PackStatus, string> = {
  draft: "Draft",
  unverified: "Unverified: needs legal review",
  active: "Active",
  disabled: "Disabled",
};
