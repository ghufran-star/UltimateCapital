import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { letterDefaults, parseLetter, renderOfferPdf } from "@/lib/offerletter";
import { assertDeal, errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Preview of the letter with the fields as currently typed (nothing is saved or sent). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await requireCtx("deals");
    const { id } = await params;
    await assertDeal(c, id);
    const u = await db.user.findUnique({ where: { id: c.user.id } });
    const base = await letterDefaults(c.workspace.id, id, undefined, { name: c.user.name, email: c.user.email, phone: u?.phone });
    const sp = req.nextUrl.searchParams;
    const pdf = await renderOfferPdf(parseLetter((k) => sp.get(k), base));
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Offer-preview.pdf"` } });
  } catch (e) {
    return errorResponse(e);
  }
}
