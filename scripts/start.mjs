// Railway start: bring the database schema up to date, then start Next.js.
// The schema result is shown on /api/health so a failed update is visible, not silent.
import { spawn } from "node:child_process";
import { syncDb } from "./sync-db.mjs";

const r = syncDb();
process.env.UC_SCHEMA_SYNC = r.status;
if (r.status === "failed") console.error(`[start] Database schema update failed: ${r.detail}`);
if (!process.env.DATABASE_URL) console.warn("[start] DATABASE_URL is not set. Add a Postgres database in Railway.");

const port = process.env.PORT || "3000";
const child = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
