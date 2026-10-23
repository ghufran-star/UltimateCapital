// Railway start: sync the database schema when a database is configured, then start Next.js.
// Without DATABASE_URL the app still boots and shows setup instructions instead of crashing.
import { execSync, spawn } from "node:child_process";

if (process.env.DATABASE_URL) {
  try {
    execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
  } catch {
    console.error("[start] Database schema sync failed; starting anyway. Check DATABASE_URL.");
  }
} else {
  console.warn("[start] DATABASE_URL is not set. Add a Postgres database in Railway.");
}

const port = process.env.PORT || "3000";
const child = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
