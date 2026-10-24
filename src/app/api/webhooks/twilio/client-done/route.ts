import { NextRequest } from "next/server";
import { clientCallDone } from "@/lib/voice";
import { twilioRequest, twiml } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  return twiml(await clientCallDone(ws, req.nextUrl.searchParams.get("it") || "", params));
}
