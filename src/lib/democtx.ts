import { AsyncLocalStorage } from "node:async_hooks";

// "Demo is active" for the current piece of work. Set around server actions and worker jobs that
// belong to the demo workspace; everything they start (including timers) stays in the demo.
// Public routes (webhooks, signing and offer links) never set it.

const als = new AsyncLocalStorage<{ ws: string }>();

export const demoWs = () => als.getStore()?.ws ?? null;
export const inDemo = () => Boolean(als.getStore());
export function runDemo<T>(ws: string, fn: () => T): T {
  return als.run({ ws }, fn);
}
