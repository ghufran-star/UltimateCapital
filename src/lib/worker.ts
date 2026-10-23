import { dialerTick } from "./campaigns";
import { runEvents, runTasks } from "./engine";

// Background worker on the long-running server (Railway): events → tasks → actions, and the dialer.

const g = globalThis as unknown as { __ucWorker?: boolean };

export function startWorker() {
  if (g.__ucWorker || process.env.RUN_WORKER === "false" || !process.env.DATABASE_URL) return;
  g.__ucWorker = true;
  console.log("[worker] started");
  let lastDial = 0;
  const loop = async () => {
    while (true) {
      let worked = 0;
      try {
        worked += await runEvents(25);
        worked += await runTasks(8);
        if (Date.now() - lastDial > 60_000) {
          lastDial = Date.now();
          worked += await dialerTick();
        }
      } catch (err) {
        console.error("[worker]", err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, worked ? 300 : 5000));
    }
  };
  void loop();
}
