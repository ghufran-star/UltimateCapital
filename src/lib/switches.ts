import { audit } from "./audit";
import { loadSettings, saveSetting, type SettingKey } from "./config";

// Owner compliance switches. Defaults are the cautious choice; the owner decides (ideally with an attorney).
//   aiDisclosure:    AI callers say they're an AI at the start of the call
//   recordingNotice: calls start with a short "this call is recorded" notice
//   coldOutreach:    lists you upload or pull can be called by the AI and texted without a consent record
//                    (DNC, litigator, opt-outs, calling hours and daily caps still apply)
//   ownerHours:      calling hours follow where the owner actually lives too (mailing address, phone area code)
// Per-state exceptions override the first two.

export type Compliance = {
  aiDisclosure: boolean;
  recordingNotice: boolean;
  coldOutreach: boolean;
  ownerHours: boolean;
  coldConfirmedAt?: string;
  coldConfirmedBy?: string;
  states: Record<string, { aiDisclosure?: boolean; recordingNotice?: boolean }>;
};

export const DEFAULT_COMPLIANCE: Compliance = { aiDisclosure: true, recordingNotice: true, coldOutreach: false, ownerHours: true, states: {} };

const KEY = "COMPLIANCE" as SettingKey;

export async function getCompliance(ws: string): Promise<Compliance> {
  const raw = (await loadSettings(ws)).COMPLIANCE;
  if (!raw) return { ...DEFAULT_COMPLIANCE, states: {} };
  try {
    const v = JSON.parse(raw) as Partial<Compliance>;
    return { ...DEFAULT_COMPLIANCE, ...v, states: v.states || {} };
  } catch {
    return { ...DEFAULT_COMPLIANCE, states: {} };
  }
}

/** The switches that apply to one call: workspace setting, then that state's exception. */
export async function complianceFor(ws: string, state?: string | null) {
  const c = await getCompliance(ws);
  const s = (state && c.states[state]) || {};
  return {
    aiDisclosure: s.aiDisclosure ?? c.aiDisclosure,
    recordingNotice: s.recordingNotice ?? c.recordingNotice,
    coldOutreach: c.coldOutreach,
    ownerHours: c.ownerHours,
  };
}

/** Saves the switches and logs exactly what changed and who changed it. */
export async function saveCompliance(ws: string, next: Compliance, actor: string) {
  const before = await getCompliance(ws);
  await saveSetting(ws, KEY, JSON.stringify(next));
  const changed: Record<string, unknown> = {};
  for (const k of ["aiDisclosure", "recordingNotice", "coldOutreach", "ownerHours"] as const) if (before[k] !== next[k]) changed[k] = next[k];
  if (JSON.stringify(before.states) !== JSON.stringify(next.states)) changed.states = next.states;
  if (Object.keys(changed).length) await audit(ws, actor, "compliance_switches", undefined, { before: { ...before }, after: changed });
  return changed;
}
