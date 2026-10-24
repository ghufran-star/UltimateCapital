import { NextRequest } from "next/server";
import { markViewed, offerByToken } from "@/lib/offerletter";

export const dynamic = "force-dynamic";

/** The seller's copy of the offer letter (public, by private link). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await offerByToken(token);
  if (!o?.pdf) return new Response("This offer link isn't valid.", { status: 404 });
  if (!req.nextUrl.searchParams.get("preview")) await markViewed(token).catch(() => null);
  const dl = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(o.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `${dl}; filename="Offer-${o.opportunity.property.address.replace(/\W+/g, "-")}.pdf"`, "cache-control": "private, no-store" } });
}
