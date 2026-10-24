import { audit, json, notify } from "./audit";
import { setting } from "./config";
import { db } from "./db";
import { createTask, emit } from "./engine";
import type { StatePackData } from "./states";
import { fill, fullName } from "./util";

// AI agents: three callers, each working in stages.
//   Seller caller: first conversation (information and the seller's price only, never an offer),
//                  follow-up (fill in what's missing), offer (present and negotiate within authority).
//   Buyer caller:  getting to know an investor, then presenting a deal.
//   Receptionist:  incoming calls.
// Each call's instructions are built from layers: role (editable) · hard rules (fixed) · state rules (automatic)
// · playbook (editable) · this call's stage (automatic) · live context (automatic) · tools.

export const AGENT_ROLES = [
  { key: "seller_acquisition", label: "Seller caller", side: "seller" },
  { key: "buyer_acquisition", label: "Buyer caller", side: "buyer" },
  { key: "receptionist", label: "Receptionist", side: "any" },
] as const;

/** Older agent roles (before the 7 → 3 merge) and the caller that now does their job. */
export const LEGACY_ROLES: Record<string, string> = {
  property_discovery: "seller_acquisition",
  negotiation: "seller_acquisition",
  transaction: "seller_acquisition",
  disposition: "buyer_acquisition",
};
const LEGACY_LABEL: Record<string, string> = {
  property_discovery: "Seller caller (follow-up)",
  negotiation: "Seller caller (offer)",
  transaction: "Transaction coordinator (retired)",
  disposition: "Buyer caller (deal)",
};
export const canonicalRole = (r?: string | null) => (r ? LEGACY_ROLES[r] || r : "seller_acquisition");
/** Every role key whose calls belong to this caller (for history and stats). */
export const rolesFor = (r: string) => [r, ...Object.keys(LEGACY_ROLES).filter((k) => LEGACY_ROLES[k] === r)];
export const roleLabel = (r?: string | null) => (r ? (AGENT_ROLES.find((a) => a.key === r)?.label as string) || LEGACY_LABEL[r] || r.replace(/_/g, " ") : "");

/** Call stages. The first conversation with a seller is information and price only. */
export const CALL_STAGES = {
  first: "First conversation",
  discovery: "Follow-up",
  offer: "Offer",
  intro: "Getting to know the investor",
  deal: "Presenting a deal",
  inbound: "Incoming call",
} as const;
export type CallStage = keyof typeof CALL_STAGES;

const STAGE_RULES: Record<CallStage, string> = {
  first:
    "THIS IS THE FIRST CONVERSATION. Your only goals: understand the property, their situation and timeline, and find out what price they have in mind. NEVER make an offer, name a number, or negotiate on this call, even if they ask for one: say you'll review everything and come back with a written offer, usually within a day or two. When they give a price, log it with record_offer (by: them).",
  discovery:
    "FOLLOW-UP CONVERSATION. Fill in what's still missing (OPEN QUESTIONS), confirm their price and timeline, and offer to receive photos by text. Our offer isn't ready yet: don't name a number. If they push, say the written offer is being prepared.",
  offer:
    "OFFER CONVERSATION. Recap what they told us, explain our offer honestly (as-is, cash, no agent fees, close on their timeline, repairs needed), and negotiate. Call get_offer_authority before naming any number and never go beyond it; log every offer with record_offer; use request_approval for anything above your authority.",
  intro: "GETTING TO KNOW THE INVESTOR. Learn exactly what they buy, how they fund and how fast they close. Don't pitch a specific property unless DEAL DETAILS are given.",
  deal: "PRESENTING A DEAL. Describe it using only DEAL DETAILS, follow the marketing note, call get_buyer_price before naming a price, and record their interest with record_buyer_interest.",
  inbound: "INCOMING CALL. Find out who they are and why they're calling, then help or book a callback.",
};

export const TOOL_DEFS: Record<string, { description: string; properties: Record<string, unknown>; required?: string[]; say?: string }> = {
  record_fact: {
    description: "Save something important the person told you (e.g. roof age, asking price, timeline, buying criteria). Use it as soon as you learn it.",
    properties: {
      field: { type: "string", description: "Short field name, e.g. roof_age, asking_price, motivation, timeline, occupancy, decision_makers, buy_box_max_price" },
      value: { type: "string", description: "What they said, in plain words" },
    },
    required: ["field", "value"],
  },
  schedule_callback: {
    description: "Book a callback the person agreed to.",
    properties: {
      when: { type: "string", description: "When they asked to be called, as ISO date-time if you can, otherwise in their words" },
      reason: { type: "string", description: "What the callback is about" },
    },
    required: ["when"],
  },
  send_text: {
    description: "Text the person something they asked for (a link, our details, a summary).",
    properties: { message: { type: "string", description: "The text to send, short and polite" } },
    required: ["message"],
    say: "I'll text that over to you now.",
  },
  get_offer_authority: {
    description: "Before stating ANY price to a seller, call this. It tells you the only price you may offer now and how far you may go if they counter. On a first conversation it will tell you not to offer.",
    properties: { seller_price: { type: "number", description: "The seller's latest price, if they named one" } },
    say: "Let me just check something.",
  },
  record_offer: {
    description: "Log a price as soon as it is said, by us or by them. Use by: them for the seller's asking price.",
    properties: {
      price: { type: "number", description: "The price" },
      by: { type: "string", enum: ["us", "them"], description: "Who said it" },
      terms: { type: "string", description: "Any terms mentioned (closing time, as-is, who pays costs)" },
    },
    required: ["price", "by"],
  },
  get_buyer_price: {
    description: "Before stating ANY price to an investor, call this. It tells you the only price you may present and how low you may go.",
    properties: { buyer_offer: { type: "number", description: "The investor's offer, if they made one" } },
    say: "One second.",
  },
  record_buyer_interest: {
    description: "Record how interested the investor is in this deal.",
    properties: {
      interest: { type: "string", enum: ["interested", "maybe", "not_interested"], description: "Their interest" },
      serious: { type: "boolean", description: "True if they asked for details, a walkthrough, made an offer, or confirmed funds" },
      price: { type: "number", description: "A price they mentioned, if any" },
      notes: { type: "string", description: "Why, objections, what they need" },
    },
    required: ["interest"],
  },
  request_approval: {
    description: "Ask the owner to approve something you have no authority for (a higher price, special terms). Then tell the person you'll confirm shortly.",
    properties: {
      what: { type: "string", description: "What needs approval" },
      price: { type: "number", description: "Price involved, if any" },
    },
    required: ["what"],
    say: "Let me run that by my manager.",
  },
  mark_do_not_contact: {
    description: "The person asked not to be contacted again. Use immediately, apologise, and end the call.",
    properties: { reason: { type: "string", description: "What they said" } },
  },
};

export const ROLE_TOOLS: Record<string, string[]> = {
  seller_acquisition: ["record_fact", "schedule_callback", "send_text", "get_offer_authority", "record_offer", "request_approval", "mark_do_not_contact"],
  buyer_acquisition: ["record_fact", "schedule_callback", "send_text", "get_buyer_price", "record_buyer_interest", "record_offer", "request_approval", "mark_do_not_contact"],
  receptionist: ["record_fact", "schedule_callback", "send_text", "mark_do_not_contact"],
};

export const HARD_RULES = `HARD RULES (these override everything else):
- Say who you are and the company name at the start: {{identification}} {{ai_disclosure}} {{recording_notice}}
- Never misrepresent anything: who we are, that we own a property, available funding, property condition, deadlines, ARV, repairs, competing offers or buyer commitments. If you don't know, say you'll find out.
- Never state a price you didn't get from get_offer_authority or get_buyer_price. Never go beyond what it allows. If asked for more, use request_approval.
- Never make an offer to a seller on the first conversation. The first call is for information and their price only.
- A verbal agreement is never a contract. Say the paperwork will follow for them to review.
- If the person asks not to be contacted, use mark_do_not_contact immediately, apologise and end the call.
- Don't give legal, tax or financial advice. Suggest they speak to their own professional.
- Keep it natural and short: one question at a time, never read a list of questions.
- Don't re-ask anything already in KNOWN FACTS.`;

const DEFAULTS: Record<string, { persona: string; playbook: string }> = {
  seller_acquisition: {
    persona:
      "You are {{agent_name}}, calling homeowners for {{company}}, a local company that buys houses for cash, as-is. You're speaking with {{contact_name}} about {{property_address}}.",
    playbook:
      "FIRST CONVERSATION (information and price only):\n1. Introduce yourself and ask if they'd ever consider selling {{property_address}}.\n2. If open: what's got them thinking about it (motivation), and when they'd ideally like to sell (timeline).\n3. Anyone else on the title or involved in the decision?\n4. Condition in a relaxed way: roof age, HVAC, plumbing/electrical, kitchen and baths, foundation, anything needing repair. Record each answer with record_fact.\n5. Occupied by them, tenants, or vacant?\n6. What price do they have in mind? Log it with record_offer (by: them). Don't counter, don't offer.\n7. Agree a next step: we'll review and come back with a written offer; ask the best time and number to reach them.\n\nFOLLOW-UP: go through OPEN QUESTIONS (roof, foundation, HVAC, water heater, plumbing, electrical, kitchen, baths, flooring, windows, exterior, damage, renovations, occupancy and leases, access for a walkthrough, liens, back taxes, mortgage). Offer to receive photos by text.\n\nOFFER: recap their situation, explain our offer's reasoning honestly, use get_offer_authority before any number, log every offer, use request_approval above your authority. If they agree, say the written agreement will be sent to review and sign, and confirm their email and mobile.\n\nObjections: 'not interested' → thank them, ask if it's ok to check back in a few months. 'Price too low' (offer calls) → ask what number works and why, log it with record_offer by them.",
  },
  buyer_acquisition: {
    persona:
      "You are {{agent_name}} from {{company}}. We find off-market investment properties and share them with investors. You're speaking with {{contact_name}}.",
    playbook:
      "GETTING TO KNOW THEM (record each with record_fact): markets/ZIPs they buy in and avoid; property types; strategy (flip, rental, BRRRR); price range and max; how much rehab they'll take on; required profit or returns; how they fund (cash, hard money) and proof of funds; how fast they close; how many deals a month and when they're next buying; how they want deals sent (text, email, call) and how often.\n\nPRESENTING A DEAL: describe it using only DEAL DETAILS. {{marketing_note}}\nUse get_buyer_price before naming a price. Ask what they'd pay and what they need to decide (walkthrough, photos, inspection). Record interest with record_buyer_interest (serious = asked for details, walkthrough, offer, or confirmed funds). Log offers with record_offer.",
  },
  receptionist: {
    persona:
      "You are {{agent_name}}, answering calls for {{company}}. Callers may be sellers calling back, investors, or title companies.",
    playbook:
      "Find out who they are and why they're calling. If KNOWN FACTS show who they are, greet them by name and continue from the last conversation. Sellers: get the property address, what they're looking for, best time to call. Investors: what they buy. Title/other: take a message. Book callbacks with schedule_callback.",
  },
};

/** The previous default playbooks, so untouched agents can be upgraded to the staged versions. */
const OLD_SELLER_PLAYBOOK_START = "1. Introduce yourself and ask if they'd ever consider an offer on {{property_address}}.";
const OLD_BUYER_PLAYBOOK_START = "Learn naturally over the conversation (record each with record_fact)";

/** Three callers per workspace. Older 7-agent setups are merged: the extra agents are switched off, untouched prompts upgraded. */
export async function ensureDefaultAgents(ws: string) {
  const company = (await setting(ws, "COMPANY_NAME")) || "UltimateCapital";
  for (const r of AGENT_ROLES) {
    const exists = await db.agent.findFirst({ where: { workspaceId: ws, role: r.key } });
    if (!exists) {
      await db.agent.create({
        data: {
          workspaceId: ws,
          role: r.key,
          name: r.key === "receptionist" ? "Sam" : r.key === "buyer_acquisition" ? "Jordan" : "Alex",
          persona: DEFAULTS[r.key].persona,
          playbook: DEFAULTS[r.key].playbook,
          tools: ROLE_TOOLS[r.key],
        },
      });
      continue;
    }
    const tools = [...new Set([...exists.tools.filter((t) => TOOL_DEFS[t]), ...ROLE_TOOLS[r.key]])];
    const untouched = exists.playbook.startsWith(OLD_SELLER_PLAYBOOK_START) || exists.playbook.startsWith(OLD_BUYER_PLAYBOOK_START);
    const changed = untouched || tools.length !== exists.tools.length || !exists.active;
    if (changed)
      await db.agent.update({
        where: { id: exists.id },
        data: { tools, active: true, ...(untouched ? { persona: DEFAULTS[r.key].persona, playbook: DEFAULTS[r.key].playbook, version: { increment: 1 } } : {}) },
      });
    // The fixed parts of the prompt (hard rules, this call's stage) change with app updates: re-send once per start.
    if (exists.retellAgentId) await syncAgent(ws, exists.id).catch((e) => console.error("[agents] resync", e instanceof Error ? e.message : e));
  }
  await db.agent.updateMany({ where: { workspaceId: ws, role: { in: Object.keys(LEGACY_ROLES) }, active: true }, data: { active: false } });
  return company;
}

export async function agentForRole(ws: string, role: string) {
  const key = canonicalRole(role);
  return (
    (await db.agent.findFirst({ where: { workspaceId: ws, role: key, active: true }, orderBy: { updatedAt: "desc" } })) ||
    (await db.agent.findFirst({ where: { workspaceId: ws, role: { in: rolesFor(key) } }, orderBy: [{ active: "desc" }, { updatedAt: "desc" }] }))
  );
}

/** Which stage this call is in. A seller's first real conversation is always the information-and-price call. */
export async function callStageFor(ws: string, o: { contactId: string; requestedRole: string; opportunityId?: string | null; inbound?: boolean }): Promise<CallStage> {
  if (o.inbound) return "inbound";
  const role = canonicalRole(o.requestedRole);
  if (role === "receptionist") return "inbound";
  if (role === "buyer_acquisition") return o.opportunityId || o.requestedRole === "disposition" ? "deal" : "intro";
  const talked = await db.interaction.count({
    where: {
      workspaceId: ws,
      contactId: o.contactId,
      OR: [
        { channel: "call", outcome: { in: ["conversation", "interested", "callback", "not_now", "price_high", "offer_discussed"] } },
        { channel: "call", durationSec: { gte: 45 } },
        { channel: { in: ["sms", "email"] }, direction: "inbound" },
      ],
    },
  });
  if (!talked) return "first";
  if (o.requestedRole === "negotiation") return "offer";
  if (o.requestedRole === "property_discovery") return "discovery";
  const opp = o.opportunityId ? await db.opportunity.findUnique({ where: { id: o.opportunityId }, select: { stage: true } }) : null;
  return opp && ["OFFER_READY", "NEGOTIATION", "CONTRACT_PREPARATION"].includes(opp.stage) ? "offer" : "discovery";
}

/** The full general prompt sent to Retell. Live context arrives per call as dynamic variables. */
export function generalPrompt(a: { persona: string; playbook: string }) {
  return `${a.persona}

${HARD_RULES}

STATE RULES:
{{state_rules}}

PLAYBOOK:
${a.playbook}

THIS CALL:
{{call_stage}}

LIVE CONTEXT (from our records, may be partial):
{{context}}

KNOWN FACTS (don't re-ask):
{{known_facts}}

OPEN QUESTIONS (find these out if it's natural):
{{open_questions}}

DEAL DETAILS (only if relevant):
{{deal_details}}`;
}

async function toolUrl(ws: string, name: string) {
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  if (!base) throw new Error("Set the Public app URL in Settings → Integrations so agents can reach their tools.");
  return `${base}/api/retell/tools/${name}?ws=${ws}`;
}

/** Creates or updates the agent in Retell (LLM + agent). Returns the Retell agent id. */
export async function syncAgent(ws: string, agentId: string): Promise<string> {
  const { retell } = await import("./comms");
  const a = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  const owner = await db.membership.findFirst({ where: { workspaceId: ws, role: "owner" }, include: { user: true } });
  const tools: unknown[] = [];
  for (const name of a.tools) {
    const d = TOOL_DEFS[name];
    if (!d) continue;
    tools.push({
      type: "custom",
      name,
      description: d.description,
      url: await toolUrl(ws, name),
      method: "POST",
      speak_during_execution: Boolean(d.say),
      execution_message_description: d.say,
      speak_after_execution: true,
      timeout_ms: 8000,
      parameters: { type: "object", properties: d.properties, required: d.required || [] },
    });
  }
  if (owner?.user.phone) {
    tools.push({
      type: "transfer_call",
      name: "transfer_to_human",
      description: "Transfer to the team when the person is ready to agree terms, insists on a human, or has a question you can't answer.",
      // {{transfer_number}} is filled per call: the contact's or deal's assigned rep, else the owner.
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      transfer_option: { type: "warm_transfer", public_handoff_option: { message: "Connecting you with my manager now." } },
    });
  }
  tools.push({ type: "end_call", name: "end_call", description: "End the call when the conversation is over, at voicemail, or when asked to stop." });
  const llmBody = { general_prompt: generalPrompt(a), general_tools: tools, start_speaker: "agent", begin_message: "{{opening_line}}" };
  let llmId = a.retellLlmId;
  if (llmId) await retell(ws, "PATCH", `/update-retell-llm/${llmId}`, llmBody);
  else llmId = String((await retell(ws, "POST", "/create-retell-llm", llmBody)).llm_id);
  const base = (await setting(ws, "PUBLIC_URL"))!.replace(/\/$/, "");
  const agentBody = {
    agent_name: `${a.name} · ${a.role}`,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: a.voiceId || "11labs-Adrian",
    webhook_url: `${base}/api/webhooks/retell?ws=${ws}`,
    post_call_analysis_data: [],
  };
  let rid = a.retellAgentId;
  if (rid) await retell(ws, "PATCH", `/update-agent/${rid}`, agentBody);
  else rid = String((await retell(ws, "POST", "/create-agent", agentBody)).agent_id);
  await db.agent.update({ where: { id: a.id }, data: { retellLlmId: llmId, retellAgentId: rid } });
  return rid;
}

/** Who a live transfer rings: the assigned rep if they have a phone, otherwise the owner. */
export async function transferNumber(ws: string, assigneeId?: string | null) {
  if (assigneeId && !assigneeId.startsWith("agent:")) {
    const u = await db.user.findUnique({ where: { id: assigneeId } });
    if (u?.phone) return u.phone;
  }
  const owner = await db.membership.findFirst({ where: { workspaceId: ws, role: "owner" }, include: { user: true } });
  return owner?.user.phone || "";
}

/** Layer 3 + 5: per-call dynamic variables. */
export async function buildDynamicVariables(
  ws: string,
  o: { contactId: string; opportunityId?: string; agentId: string; pack?: StatePackData; stage?: CallStage }
): Promise<Record<string, string>> {
  const [contact, agent, company] = await Promise.all([
    db.contact.findUniqueOrThrow({ where: { id: o.contactId }, include: { ownerships: { include: { property: true } }, buyBoxes: true } }),
    db.agent.findUniqueOrThrow({ where: { id: o.agentId } }),
    setting(ws, "COMPANY_NAME"),
  ]);
  const opp = o.opportunityId
    ? await db.opportunity.findUnique({ where: { id: o.opportunityId }, include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 } } })
    : null;
  const property = opp?.property || contact.ownerships[0]?.property || null;
  const facts = await db.fact.findMany({
    where: { workspaceId: ws, supersededAt: null, OR: [{ entityType: "contact", entityId: contact.id }, ...(property ? [{ entityType: "property", entityId: property.id }] : []), ...(opp ? [{ entityType: "opportunity", entityId: opp.id }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const last = await db.interaction.findFirst({ where: { contactId: contact.id, summary: { not: null } }, orderBy: { createdAt: "desc" } });
  const vars: Record<string, string> = {
    company: company || "our company",
    agent_name: agent.name,
    contact_name: fullName(contact),
    first_name: contact.firstName || fullName(contact),
    property_address: property ? `${property.address}, ${property.city}` : "",
  };
  const pack = o.pack;
  vars.identification = fill(pack?.outreach.identification || "This is {{agent_name}} with {{company}}.", vars);
  const { complianceFor } = await import("./switches");
  const sw = await complianceFor(ws, property?.state || contact.state);
  vars.ai_disclosure = sw.aiDisclosure ? fill(pack?.outreach.aiDisclosure || "Just so you know, I'm an AI assistant calling on behalf of {{company}}.", vars) : "";
  vars.recording_notice = sw.recordingNotice ? "Mention that the call is recorded for quality." : "";
  const stage: CallStage = o.stage || (agent.role === "receptionist" ? "inbound" : contact.kind === "buyer" ? (opp ? "deal" : "intro") : "discovery");
  vars.call_stage = `${CALL_STAGES[stage]}. ${STAGE_RULES[stage]}`;
  vars.state_rules = pack
    ? [
        `Disclosure when presenting a contract interest: ${pack.wholesaling.disclosureText}`,
        `Marketing before contract: ${pack.wholesaling.marketingBeforeContract === "anonymous_only" ? "describe the property without address or seller details" : pack.wholesaling.marketingBeforeContract}`,
        pack.outreach.notes,
      ]
        .filter(Boolean)
        .join("\n")
    : "Follow federal rules.";
  vars.context = [
    contact.summary ? `Current situation: ${contact.summary}` : "",
    last?.summary ? `Last conversation (${last.createdAt.toDateString()}): ${last.summary}` : "First conversation.",
    opp ? `Deal stage: ${opp.stage}. Seller motivation: ${opp.motivation || "?"}; timeline: ${opp.timeline || "?"}; asking: ${opp.askingPrice || "?"}` : "",
    contact.kind === "buyer" && contact.buyBoxes.length
      ? `Their buy boxes: ${contact.buyBoxes.map((b) => `${b.name}: ${[b.markets.join("/"), b.propertyTypes.join("/"), b.strategy, b.maxPrice ? `max $${b.maxPrice}` : ""].filter(Boolean).join(", ")}`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  vars.known_facts = facts.length ? facts.map((f) => `- ${f.field}: ${typeof f.value === "string" ? f.value : JSON.stringify(f.value)} (${f.kind})`).join("\n") : "None yet.";
  vars.open_questions = contact.openQuestions.length ? contact.openQuestions.map((q) => `- ${q}`).join("\n") : "None listed.";
  vars.deal_details = "";
  vars.marketing_note = "";
  if (opp && canonicalRole(agent.role) === "buyer_acquisition" && property) {
    const v = opp.valuations[0];
    const anonymous = !["UNDER_CONTRACT", "DISPOSITION", "CLOSING"].includes(opp.stage);
    vars.marketing_note = anonymous
      ? "We are NOT under contract yet: describe it WITHOUT the street address or seller details. Ask whether they would buy at that price, to gauge demand."
      : `We are under contract. Say this disclosure: ${pack?.wholesaling.disclosureText || ""}`;
    vars.deal_details = [
      `${property.beds ?? "?"} bed / ${property.baths ?? "?"} bath ${property.propertyType}, ${property.sqft ?? "?"} sq ft, built ${property.yearBuilt ?? "?"}`,
      anonymous ? `Area: ZIP ${property.zip}, ${property.city}` : `Address: ${property.address}, ${property.city} ${property.zip}`,
      `Condition: ${property.conditionTier || "unknown"}; occupancy: ${property.occupancy || "unknown"}`,
      v ? `ARV estimate: $${v.arv?.toLocaleString()} (estimate, with comps available); repairs estimate: $${v.repairsLikely?.toLocaleString()} (estimate)` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  vars.transfer_number = await transferNumber(ws, opp?.assigneeId || contact.assigneeId);
  vars.opening_line = contact.kind === "buyer" ? `Hi, is this ${vars.first_name}?` : `Hi, is this ${vars.first_name}?`;
  return vars;
}

// ---------------------------------------------------------------- Tool calls during a conversation

export async function handleTool(ws: string, name: string, args: Record<string, unknown>, call: Record<string, unknown>) {
  const meta = (call.metadata || {}) as Record<string, string>;
  let contactId = meta.contactId || "";
  if (!contactId && call.from_number) {
    const c = await db.contact.findFirst({ where: { workspaceId: ws, phone: String(call.from_number) } });
    contactId = c?.id || "";
  }
  const opportunityId = meta.opportunityId || "";
  const it = call.call_id ? await db.interaction.findUnique({ where: { providerRef: String(call.call_id) } }) : null;
  const actor = `agent:${meta.agentRole || "call"}`;

  switch (name) {
    case "record_fact": {
      if (!contactId) return { ok: true };
      const field = String(args.field || "note").slice(0, 60);
      const entity = opportunityId ? { t: "opportunity", id: opportunityId } : { t: "contact", id: contactId };
      await db.fact.create({ data: { workspaceId: ws, entityType: entity.t, entityId: entity.id, field, value: json(String(args.value || "")), kind: "reported", confidence: 0.7, interactionId: it?.id } });
      return { ok: true, result: "Saved." };
    }
    case "schedule_callback": {
      if (!contactId) return { ok: true };
      const when = new Date(String(args.when || ""));
      const due = isNaN(when.getTime()) ? new Date(Date.now() + 24 * 3600_000) : when;
      await createTask(ws, {
        kind: "call",
        title: `Callback: ${String(args.reason || "agreed on call")}`,
        reason: `They asked to be called ${String(args.when)}`,
        contactId,
        dueAt: due,
        payload: { agentRole: meta.agentRole || "seller_acquisition", opportunityId },
        dedupeKey: `callback:${contactId}`,
      });
      if (opportunityId) await db.opportunity.update({ where: { id: opportunityId }, data: { exception: "CALLBACK" } }).catch(() => null);
      return { ok: true, result: `Callback booked for ${isNaN(when.getTime()) ? String(args.when) : due.toISOString()}.` };
    }
    case "send_text": {
      if (!contactId) return { ok: false, result: "I can't text from here." };
      const { sendSms } = await import("./comms");
      const r = await sendSms(ws, { contactId, body: String(args.message || ""), opportunityId: opportunityId || undefined });
      return { ok: !r.startsWith("Blocked"), result: r.startsWith("Blocked") ? "Texts aren't allowed to this number; offer email instead." : "Sent." };
    }
    case "get_offer_authority": {
      if (meta.callStage === "first") return { ok: true, result: "This is the first conversation: don't make an offer or name any number. Thank them for their price, say we'll review everything and come back with a written offer, and agree the best time to reach them." };
      if (meta.callStage === "discovery") return { ok: true, result: "Our offer isn't ready yet: don't name a number. Say we're preparing a written offer and will be back in touch shortly." };
      if (!opportunityId) return { ok: false, result: "No deal on file yet. Don't name a price; say we'll prepare a written offer." };
      const { sellerAuthorityFor } = await import("./deals");
      const a = await sellerAuthorityFor(ws, opportunityId, typeof args.seller_price === "number" ? args.seller_price : null, actor);
      return { ok: true, result: a.message };
    }
    case "get_buyer_price": {
      if (!opportunityId || !contactId) return { ok: false, result: "No price is available yet." };
      const { buyerAuthorityFor } = await import("./deals");
      const a = await buyerAuthorityFor(ws, opportunityId, contactId, typeof args.buyer_offer === "number" ? args.buyer_offer : null);
      return { ok: true, result: a.message };
    }
    case "record_offer": {
      if (!opportunityId) return { ok: true };
      const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
      const isBuyerSide = canonicalRole(meta.agentRole) === "buyer_acquisition";
      const price = Math.round(Number(args.price || 0));
      if (!price) return { ok: false, result: "No price given." };
      const by = args.by === "us" ? "us" : "them";
      if (by === "us" && !isBuyerSide && meta.callStage && meta.callStage !== "offer") return { ok: false, result: "No offers on this call. Don't name a number; say a written offer will follow." };
      const round = (await db.offer.count({ where: { opportunityId, side: isBuyerSide ? "buyer" : "seller", contactId } })) + 1;
      await db.offer.create({ data: { opportunityId, side: isBuyerSide ? "buyer" : "seller", contactId, round, price, by, terms: args.terms ? json({ text: String(args.terms) }) : undefined, authority: by === "us" ? "rule" : null } });
      if (!isBuyerSide && by === "them" && (!opp.sellerLowest || price < opp.sellerLowest)) {
        await db.opportunity.update({ where: { id: opportunityId }, data: { sellerLowest: price, stage: opp.stage === "OFFER_READY" ? "NEGOTIATION" : opp.stage } });
        await emit(ws, "opportunity.seller_moved", { type: "opportunity", id: opportunityId });
        // First price from the seller: check sold comparables now (not before: each lookup costs money).
        if (!opp.sellerLowest && !opp.askingPrice) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: opportunityId });
      }
      if (isBuyerSide && by === "them") {
        await db.buyerInterest.updateMany({ where: { opportunityId, contactId }, data: { priceMentioned: price, stage: "OFFER_SUBMITTED", serious: true } });
        await emit(ws, "interest.updated", { type: "opportunity", id: opportunityId });
      }
      await audit(ws, actor, "offer_logged", { type: "opportunity", id: opportunityId }, { after: { price, by } });
      return { ok: true, result: "Logged." };
    }
    case "record_buyer_interest": {
      if (!opportunityId || !contactId) return { ok: true };
      const stage = args.interest === "interested" ? "INTERESTED" : args.interest === "not_interested" ? "REJECTED" : "PRESENTED";
      await db.buyerInterest.upsert({
        where: { opportunityId_contactId: { opportunityId, contactId } },
        create: { opportunityId, contactId, stage, serious: Boolean(args.serious), priceMentioned: args.price ? Math.round(Number(args.price)) : null, notes: String(args.notes || ""), respondedAt: new Date() },
        update: { stage, serious: Boolean(args.serious), priceMentioned: args.price ? Math.round(Number(args.price)) : undefined, notes: String(args.notes || ""), respondedAt: new Date() },
      });
      await db.contact.update({ where: { id: contactId }, data: { ignoredInRow: 0 } });
      await emit(ws, "interest.updated", { type: "opportunity", id: opportunityId });
      return { ok: true, result: "Noted." };
    }
    case "request_approval": {
      const ap = await db.approval.create({
        data: {
          workspaceId: ws,
          kind: "agent_request",
          entityType: opportunityId ? "opportunity" : "contact",
          entityId: opportunityId || contactId,
          title: String(args.what || "Agent request").slice(0, 200),
          detail: json({ price: args.price ?? null, callId: call.call_id ?? null }),
          requestedBy: actor,
        },
      });
      await notify(ws, "Approval needed (live call)", String(args.what || ""), `/approvals#${ap.id}`);
      if (opportunityId) await db.opportunity.update({ where: { id: opportunityId }, data: { exception: "APPROVAL_REQUIRED" } }).catch(() => null);
      return { ok: true, result: "Request sent. Tell them you'll confirm shortly, and agree when to follow up." };
    }
    case "mark_do_not_contact": {
      if (contactId) await emit(ws, "contact.opt_out", { type: "contact", id: contactId }, { reason: String(args.reason || "Asked on call"), source: "opt_out" });
      return { ok: true, result: "Done. Apologise and end the call." };
    }
  }
  return { ok: false, result: "Unknown tool." };
}
