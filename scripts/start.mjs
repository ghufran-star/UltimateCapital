// Railway start: sync the database schema when a database is configured, then start Next.js.
// Without DATABASE_URL the app still boots and shows setup instructions instead of crashing.
import { execSync, spawn } from "node:child_process";

// The result is shown on /api/health so a failed schema update is visible, not silent.
process.env.UC_SCHEMA_SYNC = "skipped";
if (process.env.DATABASE_URL) {
  try {
    execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
    process.env.UC_SCHEMA_SYNC = "ok";
  } catch {
    process.env.UC_SCHEMA_SYNC = "failed";
    console.error("[start] Database schema sync failed; starting anyway. Check DATABASE_URL and the log above.");
  }
} else {
  console.warn("[start] DATABASE_URL is not set. Add a Postgres database in Railway.");
}

const port = process.env.PORT || "3000";
const child = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
