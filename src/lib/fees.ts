import { audit, json, notify } from "./audit";
import { db } from "./db";
import { ensureTransaction } from "./title";
import { usd } from "./util";

// "Fee received": you say the money arrived; the deal, its closing and every report update.

export async function markFeeReceived(ws: string, opportunityId: string, amount: number, when: Date, actor: string) {
  if (!amount || amount < 1) throw new Error("Enter the amount you received.");
  const opp = await db.opportunity.findFirstOrThrow({ where: { id: opportunityId, workspaceId: ws }, include: { property: true } });
  const tx = await ensureTransaction(ws, opp.id);
  const due = await db.payment.findFirst({ where: { workspaceId: ws, opportunityId: opp.id, direction: "in", kind: "assignment_fee", status: { in: ["due", "approved"] } } });
  if (due) await db.payment.update({ where: { id: due.id }, data: { status: "received", amount, reference: "Marked received", note: `Received ${when.toLocaleDateString("en-US")}` } });
  else await db.payment.create({ data: { workspaceId: ws, opportunityId: opp.id, kind: "assignment_fee", direction: "in", amount, status: "received", payee: "Us", reference: "Marked received", note: `Received ${when.toLocaleDateString("en-US")}` } });
  const items = ((tx.checklist || []) as { key: string; done: boolean; doneAt?: string }[]).map((i) => (["funded", "paid"].includes(i.key) ? { ...i, done: true, doneAt: i.doneAt || when.toISOString() } : i));
  await db.transaction.update({ where: { id: tx.id }, data: { paidAt: when, netProceeds: amount, assignmentFee: tx.assignmentFee ?? amount, stage: "RECONCILED", checklist: json(items) } });
  await db.opportunity.update({ where: { id: opp.id }, data: { stage: "CLOSED", exception: null, nextStep: null } });
  await audit(ws, actor, "fee_received", { type: "opportunity", id: opp.id }, { after: { amount, when: when.toISOString() } });
  await notify(ws, "💰 Paid", `${usd(amount)} received for ${opp.property.address}.`, `/deals/${opp.id}`);
  return `${usd(amount)} recorded. ${opp.property.address} is closed and paid.`;
}
