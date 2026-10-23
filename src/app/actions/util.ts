import type { ActionState } from "@/components/client";

/** Wraps a server action body: errors become { error } for the form to show. */
export async function act(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) || { ok: true };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
