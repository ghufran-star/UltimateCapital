"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/components/client";
import { sign, signerByToken } from "@/lib/contracts";
import { act } from "./util";

export async function signAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const s = await signerByToken(String(fd.get("token") || ""));
    if (!s) throw new Error("This signing link has expired. Ask for a new one.");
    if (["terminated", "expired"].includes(s.contract.status)) throw new Error("This agreement is no longer open for signing.");
    const h = await headers();
    await sign(s.id, {
      signature: String(fd.get("signature") || ""),
      initials: String(fd.get("initials") || ""),
      consent: fd.get("consent") === "on",
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
      ua: h.get("user-agent") || "",
    });
    return { ok: true, message: "Signed. Thank you — you'll receive a copy once everyone has signed." };
  });
}
