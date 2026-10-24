"use server";

import type { ActionState } from "@/components/client";
import { readUnsubToken, unsubscribe } from "@/lib/emails";

export async function unsubscribeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = readUnsubToken(String(fd.get("token") || ""));
  if (!id) return { error: "This link isn't valid." };
  await unsubscribe(id, "unsubscribe page");
  return { ok: true, message: "You're unsubscribed." };
}
