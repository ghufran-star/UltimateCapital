"use server";

import type { ActionState } from "@/components/client";
import { syncAgent } from "@/lib/agents";
import { audit, json } from "@/lib/audit";
import { loadSettings, saveSetting, SETTING_DEFS, type SettingKey } from "@/lib/config";
import { db } from "@/lib/db";
import { ensurePacks, importDncList } from "@/lib/eligibility";
import { emit } from "@/lib/engine";
import type { RuleSetData } from "@/lib/rules";
import { requireCtx } from "@/lib/session";
import { draftPack, STATES, type StatePackData } from "@/lib/states";
import { e164, str } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";
import { act } from "./util";

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const changed: string[] = [];
    for (const d of SETTING_DEFS) {
      if (!fd.has(d.key)) continue;
      const v = String(fd.get(d.key) || "").trim();
      if (d.secret && !v) continue; // blank secret = keep current
      if (v === "__clear__") {
        await db.setting.deleteMany({ where: { workspaceId: c.workspace.id, key: d.key } });
        changed.push(d.key);
        continue;
      }
      await saveSetting(c.workspace.id, d.key as SettingKey, v);
      changed.push(d.key);
    }
    await loadSettings(c.workspace.id, true);
    await audit(c.workspace.id, c.user.id, "settings_saved", undefined, { meta: { keys: changed } });
    return { ok: true, message: "Saved" };
  });
}

export async function testIntegrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings");
    const ws = c.workspace.id;
    const s = await loadSettings(ws, true);
    const what = String(fd.get("what"));
    const ok = (m: string) => ({ ok: true, message: `✓ ${m}` });
    if (what === "claude") {
      const { claudeText } = await import("@/lib/claude");
      const r = await claudeText(ws, { messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 10, kind: "fast" });
      return ok(`Claude replied: ${r.trim().slice(0, 30)}`);
    }
    if (what === "retell") {
      const { retell } = await import("@/lib/comms");
      const r = (await retell(ws, "GET", "/list-agents")) as unknown as unknown[];
      return ok(`Retell connected (${Array.isArray(r) ? r.length : 0} agents)`);
    }
    if (what === "twilio") {
      if (!s.TWILIO_ACCOUNT_SID || !s.TWILIO_AUTH_TOKEN) throw new Error("Add the Twilio SID and token.");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.TWILIO_ACCOUNT_SID}.json`, { headers: { authorization: `Basic ${Buffer.from(`${s.TWILIO_ACCOUNT_SID}:${s.TWILIO_AUTH_TOKEN}`).toString("base64")}` } });
      if (!r.ok) throw new Error(`Twilio said ${r.status}`);
      return ok("Twilio connected");
    }
    if (what === "resend") {
      if (!s.RESEND_API_KEY) throw new Error("Add the Resend key.");
      const r = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${s.RESEND_API_KEY}` } });
      if (!r.ok) throw new Error(`Resend said ${r.status}`);
      return ok("Resend connected");
    }
    if (what === "rentcast") {
      if (!s.RENTCAST_API_KEY) throw new Error("Add the RentCast key.");
      const r = await fetch("https://api.rentcast.io/v1/avm/value?address=" + encodeURIComponent("5500 Grand Lake Dr, San Antonio, TX 78244"), { headers: { "X-Api-Key": s.RENTCAST_API_KEY } });
      if (!r.ok) throw new Error(`RentCast said ${r.status}`);
      return ok("RentCast connected");
    }
    throw new Error("Unknown test");
  });
}

// ---------- Rules ----------

export async function saveRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("rules", { write: true });
    const ws = c.workspace.id;
    let rules: RuleSetData;
    try {
      rules = JSON.parse(String(fd.get("rules") || ""));
    } catch {
      throw new Error("The rules couldn't be read.");
    }
    if (!rules?.defaults || !Array.isArray(rules.overrides) || !Array.isArray(rules.playbook)) throw new Error("Rules are incomplete.");
    const d = rules.defaults;
    const problems: string[] = [];
    if (!(d.maxBuyPctArv > 0.3 && d.maxBuyPctArv <= 0.95)) problems.push("Max buy % of ARV must be between 30% and 95%.");
    if (d.minFee < 0 || d.targetFee < d.minFee) problems.push("Target fee must be at least the minimum fee.");
    if (d.offerSteps.some((x) => x < 0 || x >= 0.6)) problems.push("Offer steps must be between 0% and 60% below max buy.");
    if (d.buyerRoundFees.some((x) => x < d.minFee)) problems.push("Every buyer round fee must be at least the minimum fee (hard lock).");
    if (problems.length) throw new Error(problems.join(" "));
    const cur = await activeRuleSet(ws);
    const last = await db.ruleSet.findFirst({ where: { workspaceId: ws }, orderBy: { version: "desc" } });
    const version = (last?.version || 0) + 1;
    await db.$transaction([db.ruleSet.updateMany({ where: { workspaceId: ws }, data: { active: false } }), db.ruleSet.create({ data: { workspaceId: ws, version, active: true, rules: json(rules), note: str(fd.get("note")), createdBy: c.user.id } })]);
    await audit(ws, c.user.id, "rules_published", { type: "ruleset", id: String(version) }, { before: { version: cur.version }, after: { version } });
    if (fd.get("revalue") === "on") {
      const opps = await db.opportunity.findMany({ where: { workspaceId: ws, stage: { in: ["UNDERWRITING", "OFFER_READY", "NEGOTIATION"] } }, select: { id: true } });
      for (const o of opps) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: o.id });
    }
    return { ok: true, message: `Published version ${version}` };
  });
}

export async function restoreRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("rules", { write: true });
    const ws = c.workspace.id;
    const old = await db.ruleSet.findFirstOrThrow({ where: { workspaceId: ws, version: Number(fd.get("version")) } });
    const last = await db.ruleSet.findFirst({ where: { workspaceId: ws }, orderBy: { version: "desc" } });
    const version = (last?.version || 0) + 1;
    await db.$transaction([db.ruleSet.updateMany({ where: { workspaceId: ws }, data: { active: false } }), db.ruleSet.create({ data: { workspaceId: ws, version, active: true, rules: json(old.rules), note: `Restored from v${old.version}`, createdBy: c.user.id } })]);
    await audit(ws, c.user.id, "rules_restored", { type: "ruleset", id: String(version) }, { meta: { from: old.version } });
    return { ok: true, message: `Restored v${old.version} as v${version}` };
  });
}

// ---------- State Packs ----------

export async function addStateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("states", { write: true });
    const codes = fd.getAll("state").map(String).filter((s) => STATES.some((x) => x.code === s));
    if (!codes.length) throw new Error("Pick a state.");
    await ensurePacks(c.workspace.id, codes);
    return { ok: true, message: `Added ${codes.join(", ")} as drafts` };
  });
}

export async function saveStatePackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("states", { write: true });
    const ws = c.workspace.id;
    const state = String(fd.get("state"));
    const pack = await db.statePack.findUniqueOrThrow({ where: { workspaceId_state: { workspaceId: ws, state } } });
    const cur = { ...draftPack(state), ...(pack.data as unknown as StatePackData) };
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const b = (k: string) => fd.get(k) === "on";
    const n = (k: string) => (s(k) === "" ? null : Number(s(k)));
    const data: StatePackData = {
      timezone: s("timezone") || cur.timezone,
      wholesaling: {
        marketingBeforeContract: (s("marketingBeforeContract") || cur.wholesaling.marketingBeforeContract) as StatePackData["wholesaling"]["marketingBeforeContract"],
        marketingAfterContract: (s("marketingAfterContract") || cur.wholesaling.marketingAfterContract) as StatePackData["wholesaling"]["marketingAfterContract"],
        disclosureText: s("disclosureText"),
        licenseNotes: s("licenseNotes"),
        maxDealsPerYearUnlicensed: n("maxDealsPerYearUnlicensed"),
      },
      contracts: { assignmentAllowed: b("assignmentAllowed"), optionPeriodDays: n("optionPeriodDays"), emdDueDays: n("emdDueDays") ?? 3, typicalEmd: n("typicalEmd"), notes: s("contractNotes") },
      closing: { attorneyState: b("attorneyState"), ronAllowed: b("ronAllowed"), notes: s("closingNotes") },
      outreach: {
        callStart: s("callStart") || "09:00",
        callEnd: s("callEnd") || "20:00",
        callDays: fd.getAll("callDays").map(String),
        textStart: s("textStart") || "09:00",
        textEnd: s("textEnd") || "20:00",
        stateDncList: b("stateDncList"),
        requireConsentAiVoice: b("requireConsentAiVoice"),
        requireConsentSms: b("requireConsentSms"),
        aiDisclosure: s("aiDisclosure"),
        identification: s("identification"),
        maxCallsPerDayPerContact: n("maxCallsPerDayPerContact") ?? 1,
        notes: s("outreachNotes"),
      },
      sellerProtections: { cancellationDays: n("cancellationDays"), notices: s("notices") },
      sources: s("sources").split("\n").map((x) => x.trim()).filter(Boolean),
    };
    // Any edit of an active pack sends it back for review unless the owner re-activates.
    const status = pack.status === "active" ? "unverified" : pack.status === "draft" ? "unverified" : pack.status;
    await db.statePack.update({ where: { id: pack.id }, data: { data: json(data), version: { increment: 1 }, status } });
    await audit(ws, c.user.id, "state_pack_saved", { type: "state_pack", id: pack.id }, { before: { status: pack.status }, after: { status } });
    return { ok: true, message: pack.status === "active" ? "Saved. The pack is now unverified: re-activate after review." : "Saved" };
  });
}

export async function statePackStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("states", { write: true });
    const status = String(fd.get("status"));
    if (status === "active" && c.role !== "owner") throw new Error("Only the owner can activate a State Pack.");
    if (status === "active" && fd.get("attest") !== "on") throw new Error("Confirm the pack was reviewed by counsel.");
    const pack = await db.statePack.findUniqueOrThrow({ where: { workspaceId_state: { workspaceId: c.workspace.id, state: String(fd.get("state")) } } });
    await db.statePack.update({ where: { id: pack.id }, data: { status, ...(status === "active" ? { approvedBy: c.user.id, approvedAt: new Date() } : {}) } });
    await audit(c.workspace.id, c.user.id, `state_pack_${status}`, { type: "state_pack", id: pack.id });
    return { ok: true, message: status === "active" ? "Activated. Outreach in this state is now allowed." : "Updated" };
  });
}

// ---------- Agents ----------

export async function saveAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const id = String(fd.get("agentId"));
    const a = await db.agent.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const data = { name: str(fd.get("name")) || a.name, persona: String(fd.get("persona") || a.persona), playbook: String(fd.get("playbook") || a.playbook), voiceId: str(fd.get("voiceId")), active: fd.get("active") === "on", tools: fd.getAll("tools").map(String) };
    await db.agent.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    await audit(c.workspace.id, c.user.id, "agent_saved", { type: "agent", id }, { before: { persona: a.persona, playbook: a.playbook }, after: data });
    let msg = "Saved";
    if (fd.get("sync") === "on") msg += `. ${await syncAgent(c.workspace.id, id)}`;
    return { ok: true, message: msg };
  });
}

export async function syncAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const id = String(fd.get("agentId"));
    await db.agent.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    return { ok: true, message: await syncAgent(c.workspace.id, id) };
  });
}

// ---------- Templates ----------

export async function saveTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    if (!["owner", "admin"].includes(c.role)) throw new Error("Only owners and admins can change contract templates.");
    const id = str(fd.get("templateId"));
    const body = String(fd.get("body") || "");
    if (!/\[\[sign:/.test(body)) throw new Error("Add at least one signature marker, e.g. [[sign:seller]] and [[sign:company]].");
    const data = { name: str(fd.get("name")) || "Contract", kind: String(fd.get("kind") || "seller_purchase"), state: str(fd.get("state"))?.toUpperCase() || null, dealType: str(fd.get("dealType")), body, active: fd.get("active") !== "off" };
    if (id) {
      await db.contractTemplate.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
      await db.contractTemplate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    } else await db.contractTemplate.create({ data: { ...data, workspaceId: c.workspace.id } });
    await audit(c.workspace.id, c.user.id, "template_saved", { type: "template", id: id || "new" }, { meta: { name: data.name } });
    return { ok: true, message: "Saved", ...(id ? {} : { redirect: "/settings/templates" }) };
  });
}

export async function deleteTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    await db.contractTemplate.updateMany({ where: { id: String(fd.get("templateId")), workspaceId: c.workspace.id }, data: { active: false } });
    return { ok: true, message: "Archived" };
  });
}

// ---------- Phone numbers ----------

export async function savePhoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const ws = c.workspace.id;
    const id = str(fd.get("phoneId"));
    if (fd.get("delete") && id) {
      await db.phoneNumber.deleteMany({ where: { id, workspaceId: ws } });
      return { ok: true, message: "Removed" };
    }
    const number = e164(str(fd.get("number")));
    if (!number) throw new Error("Enter the number in full, e.g. +12105550100.");
    const data = { number, market: str(fd.get("market")), state: str(fd.get("state"))?.toUpperCase() || null, inboundMode: String(fd.get("inboundMode") || "agent"), inboundAgentId: str(fd.get("inboundAgentId")), forwardUserId: str(fd.get("forwardUserId")) };
    if (id) await db.phoneNumber.update({ where: { id }, data });
    else await db.phoneNumber.create({ data: { ...data, workspaceId: ws } });
    await audit(ws, c.user.id, "phone_saved", { type: "phone", id: number });
    return { ok: true, message: "Saved" };
  });
}

// ---------- Title companies ----------

export async function saveTitleCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const id = str(fd.get("titleCompanyId"));
    const name = str(fd.get("name"));
    if (!name) throw new Error("Name the title company.");
    const data = { name, state: str(fd.get("state"))?.toUpperCase() || null, email: str(fd.get("email")), phone: e164(str(fd.get("phone"))), fees: str(fd.get("fees")), turnaround: str(fd.get("turnaround")), notes: str(fd.get("notes")), wireVerifiedPhone: e164(str(fd.get("wireVerifiedPhone"))) };
    if (id) {
      await db.titleCompany.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
      await db.titleCompany.update({ where: { id }, data });
    } else await db.titleCompany.create({ data: { ...data, workspaceId: c.workspace.id } });
    await audit(c.workspace.id, c.user.id, "title_company_saved", { type: "title_company", id: id || name });
    return { ok: true, message: "Saved" };
  });
}

// ---------- Compliance ----------

export async function importDncAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    const f = fd.get("file");
    const text = f && typeof f === "object" && "text" in f && f.size ? await f.text() : String(fd.get("numbers") || "");
    const source = String(fd.get("source") || "internal");
    const r = await importDncList(c.workspace.id, text, source);
    await audit(c.workspace.id, c.user.id, "dnc_imported", undefined, { meta: { source, ...r } });
    // Stop anyone now on the list.
    const sup = await db.suppression.findMany({ where: { workspaceId: c.workspace.id, source, kind: "phone" }, select: { value: true } });
    const vals = sup.map((s) => s.value);
    let stopped = 0;
    for (let i = 0; i < vals.length; i += 1000) {
      const cts = await db.contact.findMany({ where: { workspaceId: c.workspace.id, phone: { in: vals.slice(i, i + 1000) } }, select: { id: true } });
      if (!cts.length) continue;
      const u = await db.campaignMember.updateMany({ where: { contactId: { in: cts.map((x) => x.id) }, status: { in: ["pending", "retry"] } }, data: { status: "blocked", blockedReason: `DNC (${source})` } });
      stopped += u.count;
    }
    return { ok: true, message: `${r.found} numbers read, ${r.added} new. ${stopped} queued calls stopped.` };
  });
}

export async function removeSuppressionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    if (c.role !== "owner") throw new Error("Only the owner can remove a suppression.");
    const s = await db.suppression.findFirstOrThrow({ where: { id: String(fd.get("suppressionId")), workspaceId: c.workspace.id } });
    if (s.source !== "internal") throw new Error("Only internal suppressions can be removed. Regulatory lists stay.");
    await db.suppression.delete({ where: { id: s.id } });
    await audit(c.workspace.id, c.user.id, "suppression_removed", { type: "suppression", id: s.id }, { before: { value: s.value } });
    return { ok: true, message: "Removed" };
  });
}

export async function workspaceSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("settings", { write: true });
    await db.workspace.update({ where: { id: c.workspace.id }, data: { name: str(fd.get("name")) || c.workspace.name, timezone: str(fd.get("timezone")) || c.workspace.timezone } });
    return { ok: true, message: "Saved" };
  });
}
