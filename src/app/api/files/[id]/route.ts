import { db } from "@/lib/db";
import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx();
    const { id } = await params;
    const f = await db.fileObject.findFirst({ where: { id, workspaceId: c.workspace.id } });
    if (!f) return new Response("Not found", { status: 404 });
    const dl = new URL(req.url).searchParams.has("download");
    return new Response(new Uint8Array(f.data), { headers: { "content-type": f.mime, "content-disposition": `${dl ? "attachment" : "inline"}; filename="${f.name.replace(/"/g, "")}"`, "cache-control": "private, max-age=3600", "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return errorResponse(e);
  }
}
