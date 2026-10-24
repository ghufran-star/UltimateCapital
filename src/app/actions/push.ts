"use server";

import type { ActionState } from "@/components/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { act } from "./util";

const TOPICS = ["approvals", "hot", "money", "all"];

/** Saves this phone/browser's push subscription for the signed-in person. */
export async function savePushAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, topics: string[], device: string): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("This browser didn't return a valid push subscription.");
    const t = topics.filter((x) => TOPICS.includes(x));
    const data = { userId: c.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, topics: t.length ? t : ["approvals", "hot"], device: device.slice(0, 120), failures: 0 };
    await db.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: data });
    return { ok: true, message: "Alerts are on for this device" };
  });
}

export async function removePushAction(endpoint: string): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: c.user.id } });
    return { ok: true, message: "Alerts are off for this device" };
  });
}

/** Removes a device from the list (any of your devices). */
export async function forgetDeviceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    await db.pushSubscription.deleteMany({ where: { id: String(fd.get("id")), userId: c.user.id } });
    return { ok: true, message: "Removed" };
  });
}

export async function setPushTopicsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    const t = fd.getAll("topics").map(String).filter((x) => TOPICS.includes(x));
    await db.pushSubscription.updateMany({ where: { userId: c.user.id }, data: { topics: t } });
    return { ok: true, message: t.length ? "Saved" : "Saved: no alerts will be sent until you pick at least one" };
  });
}

export async function testPushAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    const subs = await db.pushSubscription.findMany({ where: { userId: c.user.id } });
    if (!subs.length) throw new Error("Turn alerts on for this device first.");
    const { sendPush } = await import("@/lib/push");
    let ok = 0;
    const errs: string[] = [];
    for (const s of subs) {
      try {
        if (await sendPush(s, { title: "UltimateCapital alerts work ✓", body: "You'll get approvals and hot deals here.", href: "/approvals", tag: "test" })) ok++;
        else await db.pushSubscription.delete({ where: { id: s.id } });
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (!ok) throw new Error(errs[0] || "No device accepted the alert.");
    return { ok: true, message: `Test alert sent to ${ok} device${ok > 1 ? "s" : ""}` };
  });
}
