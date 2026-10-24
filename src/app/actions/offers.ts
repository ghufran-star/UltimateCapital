"use server";

import type { ActionState } from "@/components/client";
import { db } from "@/lib/db";
import { assertDeal, requireCtx } from "@/lib/session";
import { usd } from "@/lib/util";
import { act } from "./util";

/** Send the written offer letter from the deal page (edited by hand). */
export async function sendOfferLetterAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    await assertDeal(c, id);
    const { letterDefaults, offerLimit, parseLetter, sendOfferLetter } = await import("@/lib/offerletter");
    const u = await db.user.findUnique({ where: { id: c.user.id } });
    const base = await letterDefaults(ws, id, undefined, { name: c.user.name, email: c.user.email, phone: u?.phone });
    const fields = parseLetter((k) => (fd.has(k) ? String(fd.get(k)) : null), base);
    if (!fields.price) throw new Error("Enter the offer price.");
    const lim = await offerLimit(id, fields.price);
    if (lim.over) {
      if (!["owner", "admin"].includes(c.role)) throw new Error(`That's above the max buy of ${usd(lim.maxBuy)}. Ask the owner to approve it first.`);
      if (fd.get("confirmOver") !== "on") throw new Error(`That's ${usd(fields.price - (lim.maxBuy || 0))} above the max buy. Tick the box to confirm you're overriding the rules.`);
    }
    const channels = fd.getAll("send").map(String).filter((x): x is "email" | "sms" => x === "email" || x === "sms");
    if (!channels.length) throw new Error("Choose email, text or both.");
    const r = await sendOfferLetter(ws, { opportunityId: id, fields, actor: c.user.id, channels, authority: lim.over ? "owner_override" : "manual" });
    return { ok: true, message: r.message };
  });
}

// ---------- the seller's side (public link, no sign-in) ----------

export async function sellerReadyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { sellerReady } = await import("@/lib/offerletter");
    const r = await sellerReady(String(fd.get("token")), String(fd.get("message") || "").slice(0, 1000) || undefined);
    return { ok: true, message: r === "already" ? "You've already told us you're ready. We'll be in touch shortly." : "Thank you! We've let the team know. The purchase agreement is on its way for you to review." };
  });
}

export async function sellerCounterAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const message = String(fd.get("message") || "").trim().slice(0, 2000);
    const raw = String(fd.get("price") || "").replace(/[$,\s]/g, "");
    const price = raw ? Math.round(Number(raw)) : null;
    if (raw && (!price || price < 1000)) throw new Error("Enter the price as a number, e.g. 185000.");
    if (!price && !message) throw new Error("Type your question or the price you'd accept.");
    const { sellerCounter } = await import("@/lib/offerletter");
    await sellerCounter(String(fd.get("token")), price, message);
    return { ok: true, message: "Thanks, we've received it and will get back to you shortly." };
  });
}
