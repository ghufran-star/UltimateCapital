import { NextRequest } from "next/server";
import { setting } from "./config";
import { db } from "./db";
import { verifyTwilio } from "./comms";

/** Resolves and validates the workspace named in ?ws= */
export async function wsFrom(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("ws") || "";
  if (!ws) return null;
  const w = await db.workspace.findUnique({ where: { id: ws }, select: { id: true, isDemo: true } });
  return w && !w.isDemo ? w.id : null;
}

/** Reads a Twilio form POST and checks its signature against the public URL Twilio called. */
export async function twilioRequest(req: NextRequest) {
  const ws = await wsFrom(req);
  if (!ws) return { ws: null, params: {} as Record<string, string>, ok: false };
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  const base = (await setting(ws, "PUBLIC_URL"))?.replace(/\/$/, "");
  const url = base ? `${base}${req.nextUrl.pathname}${req.nextUrl.search}` : req.url;
  const ok = await verifyTwilio(ws, url, params, req.headers.get("x-twilio-signature"));
  return { ws, params, ok };
}

export async function keyOk(ws: string, req: NextRequest) {
  const secret = await setting(ws, "WEBHOOK_SECRET");
  const k = req.nextUrl.searchParams.get("key") || req.headers.get("x-webhook-key") || "";
  return !!secret && k === secret;
}

export const twiml = (xml: string) => new Response(xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8"?>${xml}`, { headers: { "content-type": "text/xml" } });
