import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The signed PDF, or with ?source=1 the original document signers read. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx();
    const { id } = await params;
    const k = await db.contract.findFirst({ where: { id, workspaceId: c.workspace.id } });
    const source = req.nextUrl.searchParams.get("source") === "1";
    const bytes = source ? k?.sourcePdf : k?.finalPdf;
    if (!k || !bytes) return new Response(source ? "No original PDF" : "Not signed yet", { status: 404 });
    const base = String(k.title || (k.fields as Record<string, string>).property_address || k.id).replace(/\W+/g, "-");
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${k.kind}-${base}${source ? "" : "-signed"}.pdf"` } });
  } catch (e) {
    return errorResponse(e);
  }
}
