import { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { importDncList } from "@/lib/eligibility";
import { keyOk, wsFrom } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Automatic DNC updates pushed by a list provider: plain text or CSV, one number per line. */
export async function POST(req: NextRequest) {
  const ws = await wsFrom(req);
  if (!ws || !(await keyOk(ws, req))) return new Response("forbidden", { status: 403 });
  const source = req.nextUrl.searchParams.get("source") || "national_dnc";
  if (!/^(national_dnc|state_dnc:[A-Z]{2}|litigator|reassigned|internal)$/.test(source)) return new Response("bad source", { status: 400 });
  const r = await importDncList(ws, await req.text(), source);
  const sup = await db.suppression.findMany({ where: { workspaceId: ws, source, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } }, select: { value: true } });
  if (sup.length) {
    const cts = await db.contact.findMany({ where: { workspaceId: ws, phone: { in: sup.map((s) => s.value) } }, select: { id: true } });
    if (cts.length) await db.campaignMember.updateMany({ where: { contactId: { in: cts.map((c) => c.id) }, status: { in: ["pending", "retry"] } }, data: { status: "blocked", blockedReason: `DNC (${source})` } });
  }
  await audit(ws, "system", "dnc_auto_update", undefined, { meta: { source, ...r } });
  return Response.json({ ok: true, ...r });
}
