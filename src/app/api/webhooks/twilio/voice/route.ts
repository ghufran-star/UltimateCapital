import { NextRequest } from "next/server";
import { agentForRole } from "@/lib/agents";
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
        const r = await retell(ws, "POST", "/v2/register-phone-call", { agent_id: agent.retellAgentId, from_number: from, to_number: to, direction: "inbound" });
        if (r.call_id) return twiml(`<Response><Dial><Sip>sip:${escapeXml(String(r.call_id))}@5t4n6j0wnrl.sip.livekit.cloud</Sip></Dial></Response>`);
      }
    } catch (e) {
      console.error("inbound to retell", e);
    }
  }
  return twiml(await inboundVoiceTwiml(ws, to, from));
}
