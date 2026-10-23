"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/components/client";
import { checkSignCode, declineToSign, needsSignCode, sendSignCode, sign, signerByToken } from "@/lib/contracts";
import { act } from "./util";

async function signer(fd: FormData) {
  const s = await signerByToken(String(fd.get("token") || ""));
  if (!s) throw new Error("This signing link has expired. Ask for a new one.");
  if (["terminated", "expired", "declined"].includes(s.contract.status)) throw new Error("This agreement is no longer open for signing.");
  return s;
}

export async function signAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const s = await signer(fd);
    if (needsSignCode(s) && !s.otpVerifiedAt) {
      const code = String(fd.get("code") || "");
      if (!code) throw new Error("Enter the code we sent you (press “Send me a code” first).");
      await checkSignCode(s.id, code);
    }
    const h = await headers();
    await sign(s.id, {
      signature: String(fd.get("signature") || ""),
      initials: String(fd.get("initials") || ""),
      consent: fd.get("consent") === "on",
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
      ua: h.get("user-agent") || "",
    });
    return { ok: true, message: "Signed. Thank you — you'll receive a copy by email once everyone has signed." };
  });
}

export async function sendCodeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const s = await signer(fd);
    return { ok: true, message: await sendSignCode(s.id) };
  });
}

export async function declineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const s = await signer(fd);
    const h = await headers();
    await declineToSign(s.id, String(fd.get("reason") || ""), h.get("x-forwarded-for")?.split(",")[0]?.trim() || "", h.get("user-agent") || "");
    return { ok: true, message: "Thanks — we've let them know. They'll be in touch." };
  });
}
