import { NextRequest } from "next/server";
import { agentForRole, buildDynamicVariables } from "@/lib/agents";
import { setting } from "@/lib/config";
import { escapeXml, inboundVoiceTwiml, retell } from "@/lib/comms";
import { db } from "@/lib/db";
import { e164 } from "@/lib/util";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Inbound call to one of our Twilio numbers: AI receptionist (via Retell), forward to a person, or voicemail. */
export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  const to = e164(params.To) || params.To;
  const from = e164(params.From) || params.From;
  const num = await db.phoneNumber.findFirst({ where: { workspaceId: ws, number: to } });
  if (!num || num.inboundMode === "agent") {
    try {
      const agent = num?.inboundAgentId ? await db.agent.findUnique({ where: { id: num.inboundAgentId } }) : await agentForRole(ws, "receptionist");
      if (agent?.retellAgentId) {
        // Retell custom telephony: register the call, then dial sip:{call_id}@sip.retellai.com within 5 minutes.
        // Give the receptionist the caller's history so it greets known people by name and doesn't re-ask.
        const contact = await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: from }, { phone2: from }] } });
        const company = (await setting(ws, "COMPANY_NAME")) || "our company";
        let vars: Record<string, string> = { company, agent_name: agent.name, contact_name: "", first_name: "", identification: `This is ${agent.name} with ${company}.`, ai_disclosure: "", state_rules: "", context: "Unknown caller.", known_facts: "None yet.", open_questions: "None listed.", deal_details: "", marketing_note: "", property_address: "", opening_line: `Thanks for calling ${company}, this is ${agent.name}. How can I help?` };
        if (contact) {
          const { governingState, activePack } = await import("@/lib/eligibility");
          const pack = await activePack(ws, await governingState(ws, contact.id));
          vars = { ...(await buildDynamicVariables(ws, { contactId: contact.id, agentId: agent.id, pack: pack || undefined })), opening_line: `Thanks for calling ${company}, this is ${agent.name}. Is this ${contact.firstName || "you"}?` };
        }
        const r = await retell(ws, "POST", "/v2/register-phone-call", { agent_id: agent.retellAgentId, from_number: from, to_number: to, direction: "inbound", retell_llm_dynamic_variables: vars, metadata: { ws, contactId: contact?.id || "", agentRole: agent.role } });
        if (r.call_id) return twiml(`<Response><Dial><Sip>sip:${escapeXml(String(r.call_id))}@sip.retellai.com</Sip></Dial></Response>`);
      }
    } catch (e) {
      console.error("inbound to retell", e);
    }
  }
  return twiml(await inboundVoiceTwiml(ws, to, from));
}
