import { NextRequest } from "next/server";
import { ingestEmail, type Attachment } from "@/lib/title";
import { keyOk, wsFrom } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : v && typeof v === "object" && "email" in v ? String((v as { email: string }).email) : String(v ?? ""));

/** Inbound email (deal inboxes and replies). Accepts Resend/Postmark JSON or Mailgun/SendGrid form posts. */
export async function POST(req: NextRequest) {
  const ws = await wsFrom(req);
  if (!ws || !(await keyOk(ws, req))) return new Response("forbidden", { status: 403 });
  let m: { from: string; to: string; subject: string; text: string; attachments: Attachment[] };
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("json")) {
    const j = (await req.json()) as Record<string, unknown>;
    const d = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
    // Attachments with base64 content: Postmark (Attachments[].Content), Resend/SendGrid-style (attachments[].content).
    const raw = ((d.attachments ?? d.Attachments ?? []) as Record<string, unknown>[]).filter((a) => a && (a.content || a.Content));
    const attachments = raw.map((a) => ({ filename: String(a.filename ?? a.Name ?? a.name ?? "attachment"), mime: String(a.content_type ?? a.contentType ?? a.ContentType ?? "application/octet-stream"), data: Buffer.from(String(a.content ?? a.Content), "base64") }));
    m = { from: first(d.from ?? d.From ?? d.sender), to: first(d.to ?? d.To ?? d.recipient), subject: String(d.subject ?? d.Subject ?? ""), text: String(d.text ?? d.TextBody ?? d["stripped-text"] ?? d.html ?? d.HtmlBody ?? ""), attachments };
  } else {
    const f = await req.formData();
    const g = (k: string) => String(f.get(k) ?? "");
    // Mailgun / SendGrid inbound parse: attachments arrive as files.
    const attachments: Attachment[] = [];
    for (const [, v] of f.entries()) if (typeof v === "object" && "arrayBuffer" in v && v.size) attachments.push({ filename: v.name, mime: v.type || "application/octet-stream", data: Buffer.from(await v.arrayBuffer()) });
    m = { from: g("from") || g("sender"), to: g("to") || g("recipient"), subject: g("subject"), text: g("text") || g("body-plain") || g("stripped-text"), attachments };
  }
  const addr = (s: string) => (/<([^>]+)>/.exec(s)?.[1] || s).trim().toLowerCase();
  m.from = addr(m.from);
  m.to = addr(m.to);
  try {
    const r = await ingestEmail(ws, m);
    return Response.json({ ok: true, result: r });
  } catch (e) {
    console.error("email webhook", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
