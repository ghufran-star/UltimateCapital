import { db } from "@/lib/db";
import { signerByToken } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/** The document a signer is reading (PDF templates), through their own signing link only. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await signerByToken(token);
  if (!s) return new Response("Link expired", { status: 404 });
  const c = await db.contract.findUnique({ where: { id: s.contractId }, select: { sourcePdf: true, finalPdf: true, status: true } });
  const pdf = c?.status === "effective" && c.finalPdf ? c.finalPdf : c?.sourcePdf;
  if (!pdf) return new Response("Not a PDF agreement", { status: 404 });
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="agreement.pdf"', "cache-control": "private, no-store" } });
}
