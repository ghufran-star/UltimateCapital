import { setting } from "./config";

// Minimal Claude Messages API client (fetch), keyed per workspace.

const API_URL = "https://api.anthropic.com/v1/messages";
type Block = { type: string; text?: string; input?: unknown; [k: string]: unknown };
type Message = { role: "user" | "assistant"; content: string };

export async function hasClaude(ws: string) {
  return Boolean(await setting(ws, "ANTHROPIC_API_KEY"));
}

async function model(ws: string, kind: "analysis" | "fast") {
  return kind === "analysis"
    ? (await setting(ws, "ANALYSIS_MODEL")) || "claude-sonnet-5-5"
    : (await setting(ws, "FAST_MODEL")) || "claude-haiku-5-5";
}

async function call(ws: string, body: Record<string, unknown>, attempt = 0): Promise<{ content: Block[] }> {
  const key = await setting(ws, "ANTHROPIC_API_KEY");
  if (!key) throw new Error("No Claude API key. Add it in Settings → Integrations.");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return call(ws, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function claudeText(
  ws: string,
  opts: { system?: string; messages: Message[]; kind?: "analysis" | "fast"; maxTokens?: number; webSearch?: number }
) {
  const body: Record<string, unknown> = {
    model: await model(ws, opts.kind || "analysis"),
    max_tokens: opts.maxTokens || 3000,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearch }];
  const out = await call(ws, body);
  return out.content.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}

/** A PDF or image for Claude to read (base64). */
export type Doc = { mime: string; data: string; name?: string };
const docBlock = (d: Doc) =>
  d.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data }, ...(d.name ? { title: d.name } : {}) }
    : { type: "image", source: { type: "base64", media_type: d.mime, data: d.data } };

/** Structured output via a forced tool. */
export async function claudeJson<T>(
  ws: string,
  opts: { system?: string; prompt: string; schema: Record<string, unknown>; kind?: "analysis" | "fast"; maxTokens?: number; documents?: Doc[] }
): Promise<T> {
  const content = opts.documents?.length ? [...opts.documents.map(docBlock), { type: "text", text: opts.prompt }] : opts.prompt;
  const body: Record<string, unknown> = {
    model: await model(ws, opts.kind || "analysis"),
    max_tokens: opts.maxTokens || 6000,
    messages: [{ role: "user", content }],
    tools: [{ name: "answer", description: "Return the answer in this exact structure.", input_schema: opts.schema }],
    tool_choice: { type: "tool", name: "answer" },
  };
  if (opts.system) body.system = opts.system;
  const out = await call(ws, body);
  const t = out.content.find((b) => b.type === "tool_use");
  if (!t) throw new Error("Claude returned no structured answer");
  return t.input as T;
}
