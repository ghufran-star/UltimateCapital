// Brings the database schema up to date on start.
// 1. Plain `prisma db push`.
// 2. If Prisma stops on a data-loss warning, read the exact SQL it would run. When that SQL only
//    adds things (tables, columns, indexes, unique constraints on new columns), apply it with
//    --accept-data-loss. Anything that drops a table or column or changes a column type is refused.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const DESTRUCTIVE = /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE)\b|\bALTER\s+COLUMN\s+"[^"]+"\s+(SET\s+DATA\s+)?TYPE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i;

export function syncDb() {
  if (!process.env.DATABASE_URL) return { status: "skipped", detail: "DATABASE_URL not set" };
  try {
    const out = run("npx prisma db push --skip-generate");
    process.stdout.write(out);
    return { status: "ok" };
  } catch (e) {
    const msg = `${e.stdout || ""}${e.stderr || ""}`;
    process.stdout.write(msg);
    if (!/accept-data-loss|data loss/i.test(msg)) return { status: "failed", detail: msg.slice(-500) };
  }
  let sql = "";
  try {
    sql = run('npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script');
  } catch (e) {
    return { status: "failed", detail: `Could not inspect the change: ${(e.stderr || e.message || "").slice(-300)}` };
  }
  const bad = sql.split("\n").filter((l) => DESTRUCTIVE.test(l));
  if (bad.length) {
    console.error("[db] Refusing a schema change that would delete data:\n" + bad.join("\n"));
    return { status: "failed", detail: `destructive change refused: ${bad[0].slice(0, 200)}` };
  }
  try {
    process.stdout.write(run("npx prisma db push --skip-generate --accept-data-loss"));
    console.log("[db] Applied additive schema change (checked: nothing is dropped or retyped).");
    return { status: "ok" };
  } catch (e) {
    return { status: "failed", detail: `${e.stderr || e.message}`.slice(-500) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = syncDb();
  console.log(`[db] schema sync: ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
  process.exit(r.status === "failed" ? 1 : 0);
}
