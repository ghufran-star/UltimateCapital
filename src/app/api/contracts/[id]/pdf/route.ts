import { db } from "@/lib/db";
import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx();
    const { id } = await params;
    const k = await db.contract.findFirst({ where: { id, workspaceId: c.workspace.id } });
    if (!k?.finalPdf) return new Response("Not signed yet", { status: 404 });
    const name = `${k.kind}-${String((k.fields as Record<string, string>).property_address || k.id).replace(/\W+/g, "-")}.pdf`;
    return new Response(new Uint8Array(k.finalPdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"` } });
  } catch (e) {
    return errorResponse(e);
  }
}
