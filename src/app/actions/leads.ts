"use server";

import type { ActionState } from "@/components/client";
import { notify } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { importCashBuyers, importSellerList } from "@/lib/leads";
import { FORMAT_LABEL, loadBuyerRows, loadSellerLeads, readList } from "@/lib/lists";
import { requireCtx } from "@/lib/session";
import { int, str } from "@/lib/util";
import { act } from "./util";

const campaignChoice = (fd: FormData) => {
  const mode = String(fd.get("campaignMode") || "new");
  return { mode: (mode === "existing" ? "existing" : mode === "none" ? "none" : "new") as "new" | "existing" | "none", id: str(fd.get("campaignId")), name: str(fd.get("campaignName")) };
};

async function readUpload(fd: FormData) {
  const f = fd.get("file");
  if (f && typeof f === "object" && "text" in f && f.size > 0) return { text: await f.text(), name: (f as File).name || "upload.csv" };
  return { text: String(fd.get("csv") || ""), name: "pasted list" };
}

export async function findSellersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const query = str(fd.get("query"));
    if (!query) throw new Error("Pick a state and a county, city or ZIP.");
    const choice = campaignChoice(fd);
    const r = await importSellerList(c.workspace.id, {
      query,
      label: str(fd.get("label")) || undefined,
      state: str(fd.get("state")),
      lists: fd.getAll("lists").map(String),
      take: Math.min(5000, int(fd.get("take")) || 50),
      trace: fd.get("trace") === "on",
      campaignId: choice.mode === "existing" ? choice.id : null,
      newCampaign: choice.mode === "new",
      campaignName: choice.name,
      actor: c.user.id,
    });
    await notify(c.workspace.id, "List imported", r.message, r.campaignId ? `/campaigns/${r.campaignId}` : "/properties", c.user.id);
    return r.campaignId ? { ok: true, message: r.message, redirect: `/campaigns/${r.campaignId}` } : { ok: true, message: r.message };
  });
}

export async function findBuyersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const query = str(fd.get("query"));
    if (!query) throw new Error("Pick a state and a county, city or ZIP.");
    const r = await importCashBuyers(c.workspace.id, { query, take: Math.min(2000, int(fd.get("take")) || 100), trace: fd.get("trace") === "on", newCampaign: String(fd.get("campaignMode") || "new") === "new", state: str(fd.get("state")), actor: c.user.id });
    return r.campaignId ? { ok: true, message: r.message, redirect: `/campaigns/${r.campaignId}` } : { ok: true, message: r.message };
  });
}

/** PropStream, BatchLeads, BatchData or any CSV of properties and owners. */
export async function importSellerFileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("sellers", { write: true });
    const up = await readUpload(fd);
    const rows = parseCsv(up.text);
    if (!rows.length) throw new Error("No rows found. The first line must be the column names (exports from PropStream and BatchLeads already are).");
    const { format, leads, skipped } = readList(rows);
    if (!leads.length) throw new Error(`Couldn't find property addresses in this file (${FORMAT_LABEL[format]}). It needs address, city, state and ZIP columns.`);
    const label = str(fd.get("label")) || up.name.replace(/\.csv$/i, "");
    const r = await loadSellerLeads(c.workspace.id, leads, { source: `list:${format === "generic" ? "csv" : format}`, listLabel: label, campaign: campaignChoice(fd), actor: c.user.id });
    const message = `Recognised as ${FORMAT_LABEL[format]}. ${r.found} properties: ${r.newDeals} new deals, ${r.newContacts} new owners, ${r.duplicates} already on file${skipped ? `, ${skipped} rows without a full address skipped` : ""}. Do Not Call checks are running.`;
    await notify(c.workspace.id, "List imported", message, r.campaignId ? `/campaigns/${r.campaignId}` : "/properties", c.user.id);
    return r.campaignId ? { ok: true, message, redirect: `/campaigns/${r.campaignId}` } : { ok: true, message };
  });
}

export async function importBuyerFileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("buyers", { write: true });
    const up = await readUpload(fd);
    const rows = parseCsv(up.text);
    if (!rows.length) throw new Error("No rows found. The first line must be the column names.");
    const { format } = readList(rows);
    const label = str(fd.get("label")) || up.name.replace(/\.csv$/i, "");
    const r = await loadBuyerRows(c.workspace.id, rows, { source: `list:${format === "generic" ? "csv" : format}`, listLabel: label, campaign: campaignChoice(fd), actor: c.user.id });
    const message = `Recognised as ${FORMAT_LABEL[format]}. ${r.made} new buyers, ${r.dupes} already on file. Do Not Call checks are running.`;
    return r.campaignId ? { ok: true, message, redirect: `/campaigns/${r.campaignId}` } : { ok: true, message };
  });
}
