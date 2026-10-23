import { NextRequest } from "next/server";
import { handleTool } from "@/lib/agents";
import { verifyRetell } from "@/lib/comms";
import { wsFrom } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ws = await wsFrom(req);
  if (!ws) return new Response("unknown workspace", { status: 404 });
  const raw = await req.text();
  if (!(await verifyRetell(ws, raw, req.headers.get("x-retell-signature")))) return new Response("bad signature", { status: 401 });
  try {
    const body = JSON.parse(raw) as { name?: string; args?: Record<string, unknown>; call?: Record<string, unknown> };
    const out = await handleTool(ws, body.name || name, body.args || {}, body.call || {});
    return Response.json(out);
  } catch (e) {
    console.error("retell tool", name, e);
    return Response.json({ ok: false, result: "That didn't work on our side. Say you'll follow up, and carry on." });
  }
}
