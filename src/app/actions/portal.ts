"use server";

import type { ActionState } from "@/components/client";
import { portalRespond, portalUploadPof } from "@/lib/portal";
import { int, str } from "@/lib/util";
import { act } from "./util";

export async function portalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const token = String(fd.get("token") || "");
    const kind = String(fd.get("kind")) as "offer" | "walkthrough" | "pass";
    await portalRespond(token, { kind, price: int(fd.get("price")), closeDays: int(fd.get("closeDays")), when: str(fd.get("when")), note: str(fd.get("note")) });
    return { ok: true, message: kind === "offer" ? "Offer sent. We'll be in touch shortly." : kind === "walkthrough" ? "Request sent. We'll confirm a time." : "Thanks, noted." };
  });
}

export async function portalPofAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const f = fd.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f) || !f.size) throw new Error("Choose a file.");
    await portalUploadPof(String(fd.get("token") || ""), { name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) });
    return { ok: true, message: "Uploaded. Thank you." };
  });
}
