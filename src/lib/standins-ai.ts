import { db } from "./db";

// Stand-in AI for the demo: Claude answers shaped exactly like the requested structure,
// and pretend phone calls with a short, believable transcript. Costs nothing.

type Schema = { type?: string; enum?: unknown[]; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };

function fake(s: Schema | undefined, key = ""): unknown {
  if (!s) return null;
  if (s.enum?.length) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "object" || s.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties || {})) {
      const req = !s.required || s.required.includes(k);
      if (req || (v.type !== "object" && v.type !== "array")) out[k] = fake(v, k);
    }
    return out;
  }
  if (t === "array") return [];
  if (t === "number" || t === "integer") return /score/i.test(key) ? 82 : /confidence/i.test(key) ? 0.7 : 0;
  if (t === "boolean") return /ok$|^ok|valid|clean/i.test(key);
  const one = s.description?.match(/one of:\s*([a-z_]+)/i);
  if (one) return one[1];
  if (/summary/i.test(key)) return "Demo AI summary: the stand-in AI read this conversation. In your real account Claude writes this from what was actually said.";
  if (/reply|text|message|body/i.test(key)) return "Thanks for getting back to me! What would be a good time for a quick call this week?";
  if (/reason|why|note/i.test(key)) return "Demo AI: sample reasoning.";
  return "Demo";
}

export async function fakeClaude(body: { tools?: { name: string; input_schema: Schema }[]; tool_choice?: { type: string; name?: string }; model?: string }) {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const tool = body.tools?.find((t) => !body.tool_choice?.name || t.name === body.tool_choice.name) || body.tools?.[0];
  if (tool) {
    return { id: "msg_demo", type: "message", role: "assistant", model: body.model || "demo", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "toolu_demo", name: tool.name, input: fake(tool.input_schema) }] };
  }
  return { id: "msg_demo", type: "message", role: "assistant", model: body.model || "demo", stop_reason: "end_turn", usage, content: [{ type: "text", text: "This is the demo's stand-in AI. In your real account, Claude answers here using your deals, numbers and conversations." }] };
}

/** A finished pretend call for the Retell webhook handler. */
export async function fakeCall(ws: string, callId: string, body: Record<string, unknown>, meta: Record<string, string>) {
  const contact = meta.contactId ? await db.contact.findUnique({ where: { id: meta.contactId } }) : null;
  const opp = meta.opportunityId ? await db.opportunity.findUnique({ where: { id: meta.opportunityId }, include: { property: true } }) : null;
  const first = contact?.firstName || "there";
  const addr = opp?.property.address || "the property";
  const r = Math.random();
  const reason = r < 0.15 ? "dial_no_answer" : r < 0.3 ? "voicemail_reached" : "user_hangup";
  const start = Date.now() - 1000 * (reason === "user_hangup" ? 240 : 20);
  const role = meta.agentRole || "seller_acquisition";
  const buyer = contact?.kind === "buyer";
  const transcript =
    reason !== "user_hangup"
      ? ""
      : buyer
        ? `Agent: Hi ${first}, this is Jordan, an AI assistant with the team. (Demo: pretend call, no sound.) We have an off-market deal that fits what you buy. Want the numbers?\n${first}: Sure, send them over.\nAgent: I'll text you the details now. What price would work for you?\n${first}: Send the rehab estimate and I'll tell you.`
        : `Agent: Hi ${first}, this is Alex, an AI assistant calling for the team. (Demo: pretend call, no sound.) Would you consider an offer on ${addr}?\n${first}: Maybe, it depends on the number.\nAgent: Totally fair. What timeline would work for you?\n${first}: In the next couple of months.\nAgent: And is anyone else on the title?\n${first}: Just me.\nAgent: Thank you. I'll put the numbers together and follow up.`;
  return {
    call_id: callId,
    direction: "outbound",
    call_status: "ended",
    agent_id: body.override_agent_id,
    from_number: body.from_number,
    to_number: body.to_number,
    metadata: { ...meta, agentRole: role },
    start_timestamp: start,
    end_timestamp: Date.now(),
    disconnection_reason: reason,
    transcript,
    transcript_with_tool_calls: transcript ? [{ role: "tool_call_invocation", name: buyer ? "send_deal_details" : "record_facts" }] : [],
    call_analysis: { call_summary: reason === "user_hangup" ? (buyer ? `Pretend call: ${first} wants the deal numbers.` : `Pretend call: ${first} might sell ${addr} in the next couple of months.`) : reason === "voicemail_reached" ? "Reached voicemail (pretend)." : "No answer (pretend)." },
  };
}
