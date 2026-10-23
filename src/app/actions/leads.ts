"use server";

import type { ActionState } from "@/components/client";
import { importCashBuyers, importSellerList } from "@/lib/leads";
import { requireCtx } from "@/lib/session";
import { int, str } from "@/lib/util";
import { act } from "./util";

export async function findSellersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const query = str(fd.get("query"));
    if (!query) throw new Error("Enter a market: a city and state, a county, or a ZIP.");
    const msg = await importSellerList(c.workspace.id, { query, lists: fd.getAll("lists").map(String), take: Math.min(500, int(fd.get("take")) || 50), trace: fd.get("trace") === "on", campaignId: str(fd.get("campaignId")), actor: c.user.id });
    return { ok: true, message: msg };
  });
}

export async function findBuyersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const query = str(fd.get("query"));
    if (!query) throw new Error("Enter a market.");
    const msg = await importCashBuyers(c.workspace.id, { query, take: Math.min(500, int(fd.get("take")) || 100), trace: fd.get("trace") === "on", actor: c.user.id });
    return { ok: true, message: msg };
  });
}
