import { dialerTick } from "./campaigns";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { runEvents, runTasks } from "./engine";

const ME = `${process.env.RAILWAY_REPLICA_ID || "local"}:${randomBytes(4).toString("hex")}`;

/** Only one server runs automation at a time, even with several replicas. The lease lasts 5 minutes and is renewed every loop. */
async function holdLease() {
  const now = new Date();
  const until = new Date(Date.now() + 5 * 60_000);
  const r = await db.lease.updateMany({ where: { name: "worker", OR: [{ holder: ME }, { expiresAt: { lt: now } }] }, data: { holder: ME, expiresAt: until } });
  if (r.count) return true;
  try {
    await db.lease.create({ data: { name: "worker", holder: ME, expiresAt: until } });
    return true;
  } catch {
    return false;
  }
}

// Background worker on the long-running server (Railway): events → tasks → actions, and the dialer.

const g = globalThis as unknown as { __ucWorker?: boolean };

export function startWorker() {
  if (g.__ucWorker || process.env.RUN_WORKER === "false" || !process.env.DATABASE_URL) return;
  g.__ucWorker = true;
  console.log("[worker] started");
  let lastDial = 0;
  let lastDigest = 0;
  let lastSync = 0;
  const loop = async () => {
    while (true) {
      let worked = 0;
      try {
        if (!(await holdLease())) {
          await new Promise((r) => setTimeout(r, 15_000));
          continue;
        }
        worked += await runEvents(25);
        worked += await runTasks(8);
        worked += await (await import("./controls")).announceApprovals();
        if (Date.now() - lastDial > 60_000) {
          lastDial = Date.now();
          worked += await dialerTick();
        }
        if (Date.now() - lastSync > 60 * 60_000) {
          lastSync = Date.now();
          const { syncRetellCalls } = await import("./comms");
          for (const w of await db.workspace.findMany({ where: { isDemo: false }, select: { id: true } })) await syncRetellCalls(w.id, 6).catch((e) => console.error("[retell sync]", e instanceof Error ? e.message : e));
        }
        if (Date.now() - lastDigest > 10 * 60_000) {
          lastDigest = Date.now();
          await (await import("./digest")).digestTick();
          worked += await (await import("./autopilot")).autopilotTick();
        }
      } catch (err) {
        console.error("[worker]", err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, worked ? 300 : 5000));
    }
  };
  void loop();
}
