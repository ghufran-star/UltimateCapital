import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { twilioRequest } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { ws, params, ok } = await twilioRequest(req);
  if (!ws || !ok) return new Response("forbidden", { status: 403 });
  const sid = params.MessageSid || params.CallSid;
  const st = params.MessageStatus || params.CallStatus;
  if (sid && st) {
    const failed = ["failed", "undelivered"].includes(st);
    await db.interaction.updateMany({ where: { workspaceId: ws, providerRef: sid }, data: { status: failed ? "failed" : "done", ...(failed ? { outcome: `failed: ${params.ErrorCode || st}` } : {}) } });
    // Free number intelligence from carrier errors: landline / unreachable / inactive numbers.
    const code = String(params.ErrorCode || "");
    const status = code === "21614" || code === "30006" ? "landline" : code === "30005" || code === "21211" ? "disconnected" : null;
    if (failed && status) {
      const it = await db.interaction.findFirst({ where: { workspaceId: ws, providerRef: sid }, select: { contactId: true } });
      if (it?.contactId) await db.contact.update({ where: { id: it.contactId }, data: { phoneStatus: status, phoneCheckedAt: new Date() } });
    }
  }
  return new Response(null, { status: 204 });
}
