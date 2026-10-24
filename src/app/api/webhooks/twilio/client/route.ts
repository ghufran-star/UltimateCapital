import { NextRequest } from "next/server";
import { clientCallTwiml } from "@/lib/voice";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** A call placed from the in-app phone: check the rules, then dial the contact. */
export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  return twiml(await clientCallTwiml(ws, params));
}
