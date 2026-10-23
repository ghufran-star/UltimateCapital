import { db } from "@/lib/db";
import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx();
    const { id } = await params;
    const t = await db.contractTemplate.findFirst({ where: { id, workspaceId: c.workspace.id }, select: { pdf: true, name: true } });
    if (!t?.pdf) return new Response("No PDF", { status: 404 });
    return new Response(new Uint8Array(t.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${t.name.replace(/"/g, "")}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
