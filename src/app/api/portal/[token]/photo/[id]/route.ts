import { db } from "@/lib/db";
import { portalByToken } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** A photo the team marked "share with investors", only on a deal under contract, only through the investor's own link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const it = await portalByToken(token);
  if (!it || !["UNDER_CONTRACT", "DISPOSITION", "CLOSING"].includes(it.opportunity.stage)) return new Response("Not found", { status: 404 });
  const f = await db.fileObject.findFirst({ where: { id, workspaceId: it.opportunity.workspaceId, entityType: "opportunity", entityId: it.opportunityId, shared: true } });
  if (!f || !f.mime.startsWith("image/")) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" } });
}
