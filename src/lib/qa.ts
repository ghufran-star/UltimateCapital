import { audit, json, notify } from "./audit";
import { claudeJson } from "./claude";
import { db } from "./db";
import { usd } from "./util";

// Call quality and compliance check on every AI call: did the agent stay inside its price authority,
// disclose it's an AI, honour an opt-out, avoid misrepresentation? Breaches alert the owner.

export type QA = { score: number; flags: { rule: string; severity: "high" | "medium" | "low"; quote: string }[]; pricesSaid: number[]; summary: string; checkedAt: string };

export async function reviewCall(ws: string, interactionId: string) {
  const it = await db.interaction.findUnique({ where: { id: interactionId }, include: { contact: true } });
  if (!it || it.channel !== "call" || it.provider !== "retell" || !it.body || it.body.length < 200) return null;
  const meta = (it.intel || {}) as Record<string, unknown>;
  const role = String(meta.agentRole || (it.contact?.kind === "buyer" ? "disposition" : "seller_acquisition"));
  // What the agent was allowed to say: offers the rules engine released on this deal up to this call.
  const allowed = it.opportunityId ? await db.offer.findMany({ where: { opportunityId: it.opportunityId, by: "us", createdAt: { lte: new Date(+it.createdAt + 60 * 60_000) } } }) : [];
  const sellerMax = Math.max(0, ...allowed.filter((o) => o.side === "seller").map((o) => o.price));
  const buyerMin = allowed.filter((o) => o.side === "buyer").length ? Math.min(...allowed.filter((o) => o.side === "buyer").map((o) => o.price)) : null;
  const out = await claudeJson<Omit<QA, "checkedAt">>(ws, {
    kind: "fast",
    maxTokens: 1500,
    prompt: `Audit this AI phone call (${role.replace(/_/g, " ")} agent) for a real estate company.
Rules the agent must follow:
1. Identify itself and the company, and say it's an AI assistant, near the start.
2. ${role === "disposition" ? `Never offer the property below ${buyerMin ? usd(buyerMin) : "a price released by the system"}.` : `Never offer the seller more than ${sellerMax ? usd(sellerMax) : "a price released by the system (none released: it should not name any price)"}.`}
3. Never misrepresent: ownership, funding, condition, deadlines, ARV, competing offers or buyer commitments.
4. If asked to stop calling, acknowledge, stop, and end the call.
5. No legal, tax or financial advice. A verbal agreement is never presented as a binding contract.
List every dollar amount the AGENT said as a price or offer (not what the other person said). Score the call 0-100 for rule-following and quality. Flag each breach with a short quote.
Transcript:
"""
${it.body.slice(0, 25000)}
"""`,
    schema: {
      type: "object",
      properties: {
        score: { type: "number" },
        flags: { type: "array", items: { type: "object", properties: { rule: { type: "string" }, severity: { type: "string", enum: ["high", "medium", "low"] }, quote: { type: "string" } }, required: ["rule", "severity", "quote"] } },
        pricesSaid: { type: "array", items: { type: "number" } },
        summary: { type: "string" },
      },
      required: ["score", "flags", "pricesSaid", "summary"],
    },
  });
  // Price breaches are also checked in code, so they never depend on the model noticing.
  const flags = [...out.flags];
  if (role !== "disposition") {
    for (const p of out.pricesSaid) if (p > 1000 && (!sellerMax || p > sellerMax)) flags.push({ rule: "Price above authority", severity: "high", quote: `Agent said ${usd(p)}; highest released ${sellerMax ? usd(sellerMax) : "none"}` });
  } else if (buyerMin) {
    for (const p of out.pricesSaid) if (p > 1000 && p < buyerMin) flags.push({ rule: "Price below floor", severity: "high", quote: `Agent said ${usd(p)}; lowest released ${usd(buyerMin)}` });
  }
  const qa: QA = { ...out, flags, checkedAt: new Date().toISOString() };
  await db.interaction.update({ where: { id: it.id }, data: { intel: json({ ...meta, qa }) } });
  const high = flags.filter((f) => f.severity === "high");
  if (high.length) {
    await notify(ws, "⚠️ Call broke a rule", `${it.contact ? `${it.contact.firstName} ${it.contact.lastName}` : "A call"}: ${high.map((f) => `${f.rule} (“${f.quote.slice(0, 80)}”)`).join("; ")}`, it.contactId ? `/contacts/${it.contactId}` : "/ops");
    await audit(ws, "agent:qa", "call_breach", { type: "interaction", id: it.id }, { meta: { flags: high } });
  }
  return `QA ${Math.round(out.score)}${flags.length ? `, ${flags.length} flag(s)` : ""}`;
}
