import { errorResponse, requireCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Access token for the in-app phone. Test mode gets a pretend phone instead. */
export async function GET() {
  try {
    const c = await requireCtx("calls");
    if (c.workspace.isDemo) return Response.json({ demo: true });
    const { voiceToken } = await import("@/lib/voice");
    return Response.json({ token: await voiceToken(c.workspace.id, c.user.id), identity: c.user.id });
  } catch (e) {
    if (e instanceof Error && !("status" in e)) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
