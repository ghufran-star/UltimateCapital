import { db } from "@/lib/db";
import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The offer letter exactly as it was sent. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx();
    const { id } = await params;
    const o = await db.offer.findFirst({ where: { id, opportunity: { workspaceId: c.workspace.id } }, include: { opportunity: { include: { property: true } } } });
    if (!o?.pdf) return new Response("No offer letter", { status: 404 });
    return new Response(new Uint8Array(o.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Offer-${o.opportunity.property.address.replace(/\W+/g, "-")}.pdf"` } });
  } catch (e) {
    return errorResponse(e);
  }
}
