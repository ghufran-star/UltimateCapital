"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/components/client";
import { audit, json } from "@/lib/audit";
import { addMembers, DEFAULT_CAMPAIGN, roleFor, settingsJson, type CampaignSettings } from "@/lib/campaigns";
import { contractFields, countersign, createContract, sendForSignature, terminateContract } from "@/lib/contracts";
import { db } from "@/lib/db";
import { decideApproval, sendVerificationPack } from "@/lib/deals";
import { emit, executeTask } from "@/lib/engine";
import { requireCtx } from "@/lib/session";
import { checkSettlement, ensureTransaction, openTitle, reconcileBankCsv, setChecklist } from "@/lib/title";
import { e164, int, list, str } from "@/lib/util";
import { act } from "./util";

// ---------- Approvals ----------

export async function decideApprovalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("approve", { write: true });
    const decision = fd.get("decision") === "approved" ? "approved" : "rejected";
    await decideApproval(c.workspace.id, String(fd.get("approvalId")), decision, c.user.id, str(fd.get("note")) || undefined, int(fd.get("price")));
    return { ok: true, message: decision === "approved" ? "Approved" : "Rejected" };
  });
}

export async function verificationPackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("deals", { write: true });
    const id = String(fd.get("opportunityId"));
    await db.opportunity.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    await sendVerificationPack(c.workspace.id, id);
    return { ok: true, message: "Verification pack sent for approval" };
  });
}

// ---------- Contracts ----------

export async function createContractAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const ws = c.workspace.id;
    const opportunityId = String(fd.get("opportunityId"));
    const opp = await db.opportunity.findFirstOrThrow({ where: { id: opportunityId, workspaceId: ws }, include: { property: { include: { ownerships: { include: { contact: true } } } } } });
    const t = await db.contractTemplate.findFirstOrThrow({ where: { id: String(fd.get("templateId")), workspaceId: ws } });
    if (t.kind === "seller_purchase" && !opp.approvedAt) throw new Error("The owner must approve the final offer before a seller contract can go out (Approvals).");
    const fields = await contractFields(ws, opportunityId, t.kind);
    for (const [k, v] of fd.entries()) if (k.startsWith("f_")) fields[k.slice(2) as keyof typeof fields] = String(v);
    const signers: { role: string; name: string; email?: string; phone?: string; order: number }[] = [];
    if (t.kind === "seller_purchase") {
      const owners = opp.property.ownerships.map((o) => o.contact);
      if (!owners.length) throw new Error("Link the seller to the property first.");
      owners.forEach((o, i) => signers.push({ role: i ? `seller${i + 1}` : "seller", name: `${o.firstName} ${o.lastName}`.trim(), email: o.email || undefined, phone: o.phone || undefined, order: 1 }));
    } else {
      const tx = await db.transaction.findUnique({ where: { opportunityId } });
      const b = tx?.buyerId ? await db.contact.findUnique({ where: { id: tx.buyerId } }) : null;
      if (!b) throw new Error("Choose the buyer first (Buyers tab on the deal).");
      signers.push({ role: "buyer", name: `${b.firstName} ${b.lastName}`.trim() || b.company || "Buyer", email: b.email || undefined, phone: b.phone || undefined, order: 1 });
    }
    signers.push({ role: "company", name: c.user.name, email: c.user.email, order: 99 });
    const k = await createContract(ws, { opportunityId, templateId: t.id, fields, signers, actor: c.user.id });
    const closing = fields.closing_date ? new Date(fields.closing_date) : null;
    if (closing && !isNaN(+closing)) await db.contract.update({ where: { id: k.id }, data: { closingAt: closing } });
    if (fd.get("send") === "on") {
      const msg = await sendForSignature(ws, k.id, c.user.id);
      return { ok: true, message: `Contract created. ${msg}` };
    }
    return { ok: true, message: "Contract draft created" };
  });
}

export async function sendContractAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const id = String(fd.get("contractId"));
    await db.contract.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    return { ok: true, message: await sendForSignature(c.workspace.id, id, c.user.id) };
  });
}

export async function countersignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("contracts", { write: true });
    const id = String(fd.get("contractId"));
    await db.contract.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const sig = String(fd.get("signature") || "");
    if (!sig) throw new Error("Draw or type your signature.");
    if (fd.get("consent") !== "on") throw new Error("Confirm you agree to sign electronically.");
    const h = await headers();
    await countersign(c.workspace.id, id, c.user.id, sig, h.get("x-forwarded-for")?.split(",")[0] || "");
    return { ok: true, message: "Countersigned" };
  });
}

export async function terminateContractAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("approve", { write: true });
    const id = String(fd.get("contractId"));
    await db.contract.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    await terminateContract(c.workspace.id, id, c.user.id, str(fd.get("reason")) || "Terminated by owner");
    return { ok: true, message: "Terminated" };
  });
}

// ---------- Closing ----------

export async function openTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const id = String(fd.get("opportunityId"));
    await db.opportunity.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const msg = await openTitle(c.workspace.id, id, String(fd.get("titleCompanyId")), c.user.id);
    return { ok: true, message: typeof msg === "string" ? msg : "Package sent to title" };
  });
}

export async function checklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const tx = await db.transaction.findFirstOrThrow({ where: { id: String(fd.get("transactionId")), workspaceId: c.workspace.id } });
    await setChecklist(c.workspace.id, tx.id, String(fd.get("key")), fd.get("done") === "1", c.user.id, str(fd.get("note")) || undefined);
    return { ok: true };
  });
}

export async function transactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const opportunityId = String(fd.get("opportunityId"));
    await db.opportunity.findFirstOrThrow({ where: { id: opportunityId, workspaceId: c.workspace.id } });
    const tx = await ensureTransaction(c.workspace.id, opportunityId);
    const closing = str(fd.get("closingAt"));
    await db.transaction.update({ where: { id: tx.id }, data: { titleCompanyId: str(fd.get("titleCompanyId")) || tx.titleCompanyId, closingAt: closing ? new Date(closing) : tx.closingAt, assignmentFee: int(fd.get("assignmentFee")) ?? tx.assignmentFee, emdAmount: int(fd.get("emdAmount")) ?? tx.emdAmount } });
    await audit(c.workspace.id, c.user.id, "transaction_updated", { type: "transaction", id: tx.id });
    return { ok: true, message: "Saved" };
  });
}

export async function settlementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const tx = await db.transaction.findFirstOrThrow({ where: { id: String(fd.get("transactionId")), workspaceId: c.workspace.id } });
    const text = String(fd.get("text") || "");
    if (text.length < 50) throw new Error("Paste the settlement statement text.");
    const out = await checkSettlement(c.workspace.id, tx.id, text);
    return { ok: true, message: out.ok ? "Checked: no issues" : `Issues: ${out.issues.join("; ")}` };
  });
}

export async function paymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const ws = c.workspace.id;
    const id = str(fd.get("paymentId"));
    const status = str(fd.get("status"));
    if (id) {
      const p = await db.payment.findFirstOrThrow({ where: { id, workspaceId: ws } });
      if (p.direction === "out" && status === "paid" && p.status !== "approved") throw new Error("Outgoing payments need owner approval first.");
      if (p.direction === "out" && status === "paid" && !p.wireVerifiedAt) throw new Error("Verify the wire instructions by phone (known number) first.");
      const data: { status?: string; wireVerifiedAt?: Date; wireVerifiedBy?: string; reference?: string | null } = {};
      if (fd.get("wireVerified") === "1") {
        data.wireVerifiedAt = new Date();
        data.wireVerifiedBy = c.user.id;
      }
      if (status) data.status = status;
      if (fd.has("reference")) data.reference = str(fd.get("reference"));
      if (status === "awaiting_approval") {
        await db.approval.create({ data: { workspaceId: ws, kind: "payment", entityType: "payment", entityId: p.id, title: `Approve payment of $${p.amount.toLocaleString()} (${p.kind}) to ${p.payee || "payee"}`, requestedBy: c.user.id, detail: json({ amount: p.amount, kind: p.kind }) } });
      }
      await db.payment.update({ where: { id }, data });
      await audit(ws, c.user.id, "payment_updated", { type: "payment", id }, { after: data });
      return { ok: true, message: "Updated" };
    }
    const amount = int(fd.get("amount"));
    if (!amount) throw new Error("Enter an amount.");
    const due = str(fd.get("dueAt"));
    const p = await db.payment.create({ data: { workspaceId: ws, opportunityId: str(fd.get("opportunityId")), kind: String(fd.get("kind") || "other"), direction: String(fd.get("direction") || "out"), amount, payee: str(fd.get("payee")), dueAt: due ? new Date(due) : null, note: str(fd.get("note")) } });
    await audit(ws, c.user.id, "payment_created", { type: "payment", id: p.id });
    return { ok: true, message: "Added" };
  });
}

export async function reconcileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const f = fd.get("file");
    const csv = f && typeof f === "object" && "text" in f && f.size ? await f.text() : String(fd.get("csv") || "");
    const r = await reconcileBankCsv(c.workspace.id, csv, c.user.id);
    return { ok: true, message: `${r.rows} rows read, ${r.matched} payments matched.` };
  });
}

// ---------- Campaigns ----------

export async function saveCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const ws = c.workspace.id;
    const id = str(fd.get("campaignId"));
    const kind = String(fd.get("kind") || "seller");
    const settings: CampaignSettings = {
      ...DEFAULT_CAMPAIGN,
      objective: str(fd.get("objective")) || "",
      maxAttempts: int(fd.get("maxAttempts")) ?? DEFAULT_CAMPAIGN.maxAttempts,
      retryGapHours: int(fd.get("retryGapHours")) ?? DEFAULT_CAMPAIGN.retryGapHours,
      dailyCap: int(fd.get("dailyCap")) ?? DEFAULT_CAMPAIGN.dailyCap,
      concurrency: int(fd.get("concurrency")) ?? DEFAULT_CAMPAIGN.concurrency,
      smsTemplate: str(fd.get("smsTemplate")) || DEFAULT_CAMPAIGN.smsTemplate,
      filters: { states: list(fd.get("fStates")).map((s) => s.toUpperCase()), zips: list(fd.get("fZips")), tags: list(fd.get("fTags")) },
      budget: int(fd.get("budget")),
    };
    const name = str(fd.get("name"));
    if (!name) throw new Error("Name the campaign.");
    const channels = fd.getAll("channels").map(String);
    const agent = await db.agent.findFirst({ where: { workspaceId: ws, role: roleFor(kind) } });
    const data = { name, kind, state: str(fd.get("state"))?.toUpperCase() || null, market: str(fd.get("market")), channels: channels.length ? channels : ["call"], settings: settingsJson(settings), agentId: str(fd.get("agentId")) || agent?.id || null, opportunityId: str(fd.get("opportunityId")) };
    const camp = id ? await db.campaign.update({ where: { id }, data: { ...data, version: { increment: 1 } } }) : await db.campaign.create({ data: { ...data, workspaceId: ws } });
    await audit(ws, c.user.id, id ? "campaign_updated" : "campaign_created", { type: "campaign", id: camp.id }, { after: data });
    return id ? { ok: true, message: "Saved" } : { ok: true, redirect: `/campaigns/${camp.id}` };
  });
}

export async function campaignStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const id = String(fd.get("campaignId"));
    const camp = await db.campaign.findFirstOrThrow({ where: { id, workspaceId: c.workspace.id } });
    const status = String(fd.get("status"));
    if (status === "running") {
      const n = await db.campaignMember.count({ where: { campaignId: id } });
      if (!n) throw new Error("Add contacts first.");
      if (camp.state) {
        const pack = await db.statePack.findUnique({ where: { workspaceId_state: { workspaceId: c.workspace.id, state: camp.state } } });
        if (pack?.status !== "active") throw new Error(`The ${camp.state} State Pack isn't active. An owner must review and activate it (Settings → States).`);
      }
    }
    await db.campaign.update({ where: { id }, data: { status } });
    if (status === "running") {
      const members = await db.campaignMember.findMany({ where: { campaignId: id, status: { in: ["pending", "retry"] } }, select: { contactId: true } });
      const { queueScrub } = await import("@/lib/dnc");
      await queueScrub(c.workspace.id, members.map((m) => m.contactId));
    }
    await audit(c.workspace.id, c.user.id, `campaign_${status}`, { type: "campaign", id });
    return { ok: true, message: status === "running" ? "Running. The dialer checks every minute." : "Updated" };
  });
}

export async function campaignMembersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("campaigns", { write: true });
    const ws = c.workspace.id;
    const id = String(fd.get("campaignId"));
    const camp = await db.campaign.findFirstOrThrow({ where: { id, workspaceId: ws } });
    const s = camp.settings as unknown as CampaignSettings;
    const how = String(fd.get("how") || "filter");
    if (how === "filter") {
      if (camp.kind === "seller") {
        const opps = await db.opportunity.findMany({
          where: {
            workspaceId: ws,
            sellerId: { not: null },
            stage: { in: ["NEW", "ELIGIBLE", "OUTREACH"] },
            exception: null,
            property: { ...(camp.state ? { state: camp.state } : {}), ...(s.filters?.zips?.length ? { zip: { in: s.filters.zips } } : {}), ...(camp.market ? { city: { equals: camp.market, mode: "insensitive" as const } } : {}) },
          },
          take: 5000,
        });
        await addMembers(id, opps.map((o) => ({ contactId: o.sellerId!, propertyId: o.propertyId })));
        return { ok: true, message: `${opps.length} sellers added` };
      }
      const buyers = await db.contact.findMany({ where: { workspaceId: ws, kind: "buyer", doNotContact: false, ...(camp.state ? { OR: [{ state: camp.state }, { buyBoxes: { some: { states: { has: camp.state } } } }] } : {}), ...(s.filters?.tags?.length ? { tags: { hasSome: s.filters.tags } } : {}) }, take: 5000 });
      await addMembers(id, buyers.map((b) => ({ contactId: b.id })));
      return { ok: true, message: `${buyers.length} buyers added` };
    }
    const phones = String(fd.get("phones") || "").split(/[\n,;]+/).map((x) => e164(x.trim())).filter(Boolean) as string[];
    const cts = await db.contact.findMany({ where: { workspaceId: ws, phone: { in: phones } } });
    await addMembers(id, cts.map((x) => ({ contactId: x.id })));
    return { ok: true, message: `${cts.length} of ${phones.length} numbers matched existing contacts and were added` };
  });
}

// ---------- Tasks ----------

export async function taskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const t = await db.task.findFirstOrThrow({ where: { id: String(fd.get("taskId")), workspaceId: c.workspace.id } });
    const what = String(fd.get("what"));
    if (what === "done" || what === "cancel") {
      await db.task.update({ where: { id: t.id }, data: { status: what === "done" ? "done" : "cancelled", result: `${what === "done" ? "Completed" : "Cancelled"} by ${c.user.name}` } });
    } else if (what === "run") {
      const r = await executeTask(t);
      await db.task.update({ where: { id: t.id }, data: { status: "done", result: String(r ?? "Done").slice(0, 500) } });
      return { ok: true, message: String(r ?? "Done") };
    } else if (what === "snooze") {
      await db.task.update({ where: { id: t.id }, data: { dueAt: new Date(Date.now() + 864e5) } });
    }
    await audit(c.workspace.id, c.user.id, `task_${what}`, { type: "task", id: t.id });
    return { ok: true };
  });
}

export async function createTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const title = str(fd.get("title"));
    if (!title) throw new Error("Describe the task.");
    const due = str(fd.get("dueAt"));
    await db.task.create({ data: { workspaceId: c.workspace.id, kind: "custom", title, entityType: str(fd.get("entityType")), entityId: str(fd.get("entityId")), contactId: str(fd.get("contactId")), assignee: str(fd.get("assignee")) || c.user.id, dueAt: due ? new Date(due) : new Date(), priority: int(fd.get("priority")) || 2 } });
    return { ok: true, message: "Task added" };
  });
}

export async function markAlertsReadAction(): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    await db.notification.updateMany({ where: { workspaceId: c.workspace.id, readAt: null, OR: [{ userId: null }, { userId: c.user.id }] }, data: { readAt: new Date() } });
    return { ok: true };
  });
}

export async function reprocessAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const i = await db.interaction.findFirstOrThrow({ where: { id: String(fd.get("interactionId")), workspaceId: c.workspace.id } });
    await emit(c.workspace.id, "interaction.created", { type: "interaction", id: i.id });
    return { ok: true, message: "Queued for analysis" };
  });
}
