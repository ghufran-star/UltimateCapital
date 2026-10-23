import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ ok: true, db: "not configured" });
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "ok" });
  } catch {
    return Response.json({ ok: true, db: "unreachable" });
  }
}
