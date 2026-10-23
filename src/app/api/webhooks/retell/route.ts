import { NextRequest } from "next/server";
import { onRetellEvent, verifyRetell } from "@/lib/comms";
import { wsFrom } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ws = await wsFrom(req);
  if (!ws) return new Response("unknown workspace", { status: 404 });
  const raw = await req.text();
  if (!(await verifyRetell(ws, raw, req.headers.get("x-retell-signature")))) return new Response("bad signature", { status: 401 });
  try {
    const body = JSON.parse(raw) as { event: string; call: Record<string, unknown> };
    await onRetellEvent(ws, body.event, body.call || {});
  } catch (e) {
    console.error("retell webhook", e);
  }
  return new Response(null, { status: 204 });
}
