import { NextRequest } from "next/server";
import { onInboundSms } from "@/lib/comms";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  await onInboundSms(ws, { From: params.From, To: params.To, Body: params.Body || "", MessageSid: params.MessageSid });
  return twiml("<Response/>");
}
