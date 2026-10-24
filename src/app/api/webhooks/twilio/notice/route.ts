import { NextRequest } from "next/server";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Played to the person we call, before they're connected: the recording notice (owner switch). */
export async function POST(req: NextRequest) {
  const { ws, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  return twiml("<Response><Say>This call is recorded.</Say></Response>");
}
