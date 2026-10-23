import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Which version is live and whether the database schema is current.
export async function GET() {
  const version = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown";
  const schema = process.env.UC_SCHEMA_SYNC || "unknown";
  if (!process.env.DATABASE_URL) return Response.json({ ok: true, version, db: "not configured", schema });
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, version, db: "ok", schema });
  } catch {
    return Response.json({ ok: true, version, db: "unreachable", schema });
  }
}
