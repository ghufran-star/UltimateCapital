import { markViewed } from "@/lib/offerletter";

export const dynamic = "force-dynamic";

/** Sent by the seller's browser when the offer page is actually opened (link-preview bots don't run it). */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await markViewed(token).catch(() => null);
  return new Response(null, { status: 204 });
}
