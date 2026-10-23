"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { emit } from "@/lib/engine";
import { startDemandCampaign } from "@/lib/matching";
import type { Calculation } from "@/lib/rules";
import { assertDeal, dealScope, requireCtx } from "@/lib/session";
import { fullName, int, str, usd } from "@/lib/util";
import { act } from "./util";

const UNDER_CONTRACT = ["UNDER_CONTRACT", "DISPOSITION", "CLOSING", "CLOSED"];

/** Remembers which columns you want on the deals table (per browser). */
export async function dealColumnsAction(fd: FormData) {
  const cols = fd.getAll("cols").map(String).filter(Boolean);
  (await cookies()).set("uc_deal_cols", cols.join(","), { path: "/", maxAge: 365 * 864e5 / 1000, sameSite: "lax" });
  const back = String(fd.get("back") || "/deals");
  redirect(back.startsWith("/deals") ? back : "/deals");
}

/** Pitch one deal to matching investors: anonymous demand check before a contract, full details after. */
export async function pitchDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const mode = UNDER_CONTRACT.includes(opp.stage) ? "full" : "anonymous";
    const msg = await startDemandCampaign(c.workspace.id, id, mode);
    await audit(c.workspace.id, c.user.id, "pitched_manually", { type: "opportunity", id }, { meta: { mode } });
    return { ok: true, message: `${mode === "full" ? "Marketing" : "Anonymous demand check"}: ${msg}` };
  });
}

/** Bulk actions on selected deals. */
export async function bulkDealsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) throw new Error("Tick at least one deal.");
    const deals = await db.opportunity.findMany({ where: { id: { in: ids }, workspaceId: ws, ...dealScope(c) } });
    const what = String(fd.get("bulk") || "");
    let n = 0;
    if (what === "pitch") {
      for (const d of deals) {
        await startDemandCampaign(ws, d.id, UNDER_CONTRACT.includes(d.stage) ? "full" : "anonymous");
        n++;
      }
      return { ok: true, message: `Pitching ${n} deal${n === 1 ? "" : "s"} to matching investors` };
    }
    if (what === "autopilot_off" || what === "autopilot_on") {
      const r = await db.opportunity.updateMany({ where: { id: { in: deals.map((d) => d.id) } }, data: { autopilotOff: what === "autopilot_off" } });
      await audit(ws, c.user.id, what, undefined, { meta: { ids } });
      return { ok: true, message: `Autopilot ${what === "autopilot_off" ? "off" : "on"} for ${r.count} deals` };
    }
    if (what === "assign") {
      const to = str(fd.get("assignee"));
      if (to && !(await db.membership.findFirst({ where: { workspaceId: ws, userId: to } }))) throw new Error("Pick a team member.");
      const r = await db.opportunity.updateMany({ where: { id: { in: deals.map((d) => d.id) } }, data: { assigneeId: to } });
      await audit(ws, c.user.id, "bulk_assign", undefined, { meta: { ids, to } });
      return { ok: true, message: `${r.count} deals ${to ? "assigned" : "unassigned"}` };
    }
    if (what === "revalue") {
      for (const d of deals) await emit(ws, "opportunity.facts_changed", { type: "opportunity", id: d.id });
      return { ok: true, message: `Re-valuing ${deals.length} deals` };
    }
    throw new Error("Pick what to do with the selected deals.");
  });
}

/** A manual offer to the seller: recorded and sent by text and/or email (checked against DNC and hours). */
export async function makeOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("opportunityId"));
    const opp = await assertDeal(c, id);
    const price = int(fd.get("price"));
    if (!price) throw new Error("Enter the offer price.");
    const v = await db.valuation.findFirst({ where: { opportunityId: id }, orderBy: { createdAt: "desc" } });
    const calc = v && !v.blocked ? (v.result as unknown as Calculation) : null;
    const over = calc ? price > calc.maxBuy && !opp.approvedAt : false;
    if (over) {
      if (!["owner", "admin"].includes(c.role)) throw new Error(`That's above the max buy of ${usd(calc!.maxBuy)}. Ask the owner to approve it first.`);
      if (fd.get("confirmOver") !== "on") throw new Error(`That's ${usd(price - calc!.maxBuy)} above the max buy. Tick the box to confirm you're overriding the rules.`);
    }
    const count = await db.offer.count({ where: { opportunityId: id, side: "seller" } });
    await db.offer.create({ data: { opportunityId: id, side: "seller", contactId: opp.sellerId, round: count + 1, price, by: "us", authority: over ? "owner_override" : "manual", response: str(fd.get("note")) } });
    if (["NEW", "ELIGIBLE", "OUTREACH", "ENGAGED", "QUALIFIED", "PROPERTY_DISCOVERY", "UNDERWRITING", "OFFER_READY"].includes(opp.stage)) {
      await db.opportunity.update({ where: { id }, data: { stage: "NEGOTIATION" } });
    }
    await audit(ws, c.user.id, "manual_offer", { type: "opportunity", id }, { after: { price, over } });
    const channels = fd.getAll("send").map(String);
    const sent: string[] = [];
    if (channels.length && opp.sellerId) {
      const seller = await db.contact.findUniqueOrThrow({ where: { id: opp.sellerId } });
      const prop = await db.property.findUniqueOrThrow({ where: { id: opp.propertyId } });
      const text = (str(fd.get("message")) || `Hi ${seller.firstName || fullName(seller)}, following up on ${prop.address}: we can offer ${usd(price)} cash, as-is, no agent fees, closing on your timeline. A written agreement would follow for you to review.`).replace("{{price}}", usd(price));
      const comms = await import("@/lib/comms");
      if (channels.includes("sms")) sent.push(`text: ${(await comms.sendSms(ws, { contactId: seller.id, body: text, opportunityId: id })) || "sent"}`);
      if (channels.includes("email") && seller.email) sent.push(`email: ${(await comms.sendEmail(ws, { to: seller.email, subject: `Our offer for ${prop.address}`, text, contactId: seller.id, opportunityId: id })) || "sent"}`);
      if (channels.includes("email") && !seller.email) sent.push("email: no address on file");
    }
    return { ok: true, message: `Offer of ${usd(price)} recorded${sent.length ? `. ${sent.join(" · ")}` : ""}` };
  });
}
