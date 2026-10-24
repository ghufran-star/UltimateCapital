import type { ActionState } from "@/components/client";

/** Wraps a server action body: errors become { error } for the form to show. */
export async function act(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    // Work started from the demo workspace runs against the built-in stand-ins, never real services.
    const { getCtx } = await import("@/lib/session");
    const c = await getCtx().catch(() => null);
    if (c?.workspace.isDemo) {
      const { runDemo } = await import("@/lib/democtx");
      return (await runDemo(c.workspace.id, fn)) || { ok: true };
    }
    return (await fn()) || { ok: true };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
