import { audit } from "./audit";
import { claudeJson } from "./claude";
import { setting } from "./config";
import { db } from "./db";
import { createTask } from "./engine";
import { fullName } from "./util";

// Replies to inbound texts and emails. "draft": a suggested reply waits for one click; "auto": sent at once
// unless the message needs a person (prices, offers, anything binding), which always goes to the team.

type Reply = { reply: string; handoff: boolean; reason: string };

export async function replyToInbound(ws: string, interactionId: string) {
  const { getAutopilot } = await import("./autopilot");
  const mode = (await getAutopilot(ws)).replies;
  if (mode === "off") return "Replies are off";
  const it = await db.interaction.findUnique({ where: { id: interactionId }, include: { contact: true } });
  if (!it?.contact || it.direction !== "inbound" || !["sms", "email"].includes(it.channel)) return "Not a message to answer";
  const c = it.contact;
  if (c.doNotContact) return "Opted out";
  const newer = await db.interaction.count({ where: { workspaceId: ws, contactId: c.id, direction: "outbound", channel: { in: ["sms", "email", "call"] }, createdAt: { gt: it.createdAt } } });
  if (newer) return "Already answered";
  const thread = await db.interaction.findMany({ where: { workspaceId: ws, contactId: c.id, channel: { in: ["sms", "email", "call", "note"] } }, orderBy: { createdAt: "desc" }, take: 12 });
  const facts = await db.fact.findMany({ where: { workspaceId: ws, entityId: c.id, supersededAt: null }, take: 30, orderBy: { createdAt: "desc" } });
  const opp = it.opportunityId ? await db.opportunity.findUnique({ where: { id: it.opportunityId }, include: { property: true } }) : c.kind === "seller" ? await db.opportunity.findFirst({ where: { workspaceId: ws, sellerId: c.id }, include: { property: true }, orderBy: { updatedAt: "desc" } }) : null;
  const company = (await setting(ws, "COMPANY_NAME")) || "our company";
  const agent = await db.agent.findFirst({ where: { workspaceId: ws, role: c.kind === "buyer" ? (opp ? "disposition" : "buyer_acquisition") : "seller_acquisition" } });
  const out = await claudeJson<Reply>(ws, {
    kind: "fast",
    maxTokens: 800,
    prompt: `You write the next ${it.channel === "sms" ? "text message" : "email"} reply for ${agent?.name || "the team"} at ${company}, a company that buys houses and works with investors.
Person: ${fullName(c)} (${c.kind}). ${c.summary ? `Situation: ${c.summary}` : ""}
${opp ? `Property: ${opp.property.address}, ${opp.property.city}. Deal stage: ${opp.stage}.` : ""}
Known facts: ${facts.map((f) => `${f.field}=${JSON.stringify(f.value)}`).join("; ") || "none"}
Open questions to learn naturally: ${c.openQuestions.join("; ") || "none"}
Conversation, newest first:
${thread.map((t) => `[${t.createdAt.toISOString().slice(0, 16)} ${t.direction === "inbound" ? "THEM" : "US"} ${t.channel}] ${(t.body || t.summary || "").slice(0, 600)}`).join("\n")}

Rules:
- Answer their last message helpfully, warmly and briefly${it.channel === "sms" ? " (under 300 characters, no links unless they asked)" : ""}. Ask at most one question.
- Never state or hint at a price, offer, fee or deadline, and never agree to anything. If they ask about price, an offer, or want to negotiate, set handoff=true and reply that someone will call them shortly.
- If they want a call, a walkthrough, or are upset or confused, set handoff=true.
- Don't claim to be human if asked. No legal, tax or financial advice.
- If they asked us to stop contacting them, set handoff=true and reply with an empty string.`,
    schema: { type: "object", properties: { reply: { type: "string" }, handoff: { type: "boolean" }, reason: { type: "string" } }, required: ["reply", "handoff", "reason"] },
  });
  const assignee = opp?.assigneeId || c.assigneeId || undefined;
  if (out.handoff) {
    await createTask(ws, { kind: "follow_up", title: `Reply needed: ${fullName(c)} (${out.reason})`.slice(0, 200), contactId: c.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || c.id, assignee, priority: 1, dedupeKey: `handoff:${it.id}` });
  }
  if (!out.reply.trim()) return `Handed to the team: ${out.reason}`;
  if (mode === "auto" && !out.handoff) {
    const comms = await import("./comms");
    const r = it.channel === "sms" ? await comms.sendSms(ws, { contactId: c.id, body: out.reply, opportunityId: opp?.id }) : await comms.sendEmail(ws, { to: c.email!, subject: it.subject?.startsWith("Re:") ? it.subject : `Re: ${it.subject || "your message"}`, text: out.reply, contactId: c.id, opportunityId: opp?.id });
    await audit(ws, "agent:replies", "auto_reply", { type: "contact", id: c.id }, { meta: { channel: it.channel, result: r } });
    return `Auto-replied: ${r}`;
  }
  await createTask(ws, { kind: "reply_review", title: `Suggested reply to ${fullName(c)}`, reason: out.handoff ? `Needs a person: ${out.reason}` : out.reason, contactId: c.id, entityType: opp ? "opportunity" : "contact", entityId: opp?.id || c.id, assignee, priority: out.handoff ? 1 : 2, channel: it.channel, payload: { text: out.reply, channel: it.channel, interactionId: it.id, subject: it.subject }, dedupeKey: `reply:${c.id}` });
  return "Reply drafted for review";
}

export async function sendSuggestedReply(ws: string, taskId: string, text: string, actor: string) {
  const t = await db.task.findFirstOrThrow({ where: { id: taskId, workspaceId: ws, kind: "reply_review" } });
  const p = (t.payload || {}) as { channel?: string; subject?: string | null };
  const c = await db.contact.findFirstOrThrow({ where: { id: t.contactId!, workspaceId: ws } });
  const comms = await import("./comms");
  const r = p.channel === "email" && c.email ? await comms.sendEmail(ws, { to: c.email, subject: p.subject?.startsWith("Re:") ? p.subject : `Re: ${p.subject || "your message"}`, text, contactId: c.id }) : await comms.sendSms(ws, { contactId: c.id, body: text });
  await db.task.update({ where: { id: t.id }, data: { status: "done", result: r.slice(0, 300) } });
  await audit(ws, actor, "reply_sent", { type: "contact", id: c.id }, { meta: { result: r } });
  return r;
}
