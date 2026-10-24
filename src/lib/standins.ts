import { randomBytes } from "node:crypto";
import { demoWs, inDemo, runDemo } from "./democtx";

// Built-in stand-ins for every outside service, used by the demo workspace. One choke point:
// globalThis.fetch is wrapped, and any request made from demo work (or carrying a demo stand-in key)
// is answered here in-process. Nothing from the demo ever reaches a real service.

const MARK = /uc-demo-([a-z0-9]+)/i;
const realFetch: typeof fetch = (globalThis as { __ucRealFetch?: typeof fetch }).__ucRealFetch || globalThis.fetch.bind(globalThis);
(globalThis as { __ucRealFetch?: typeof fetch }).__ucRealFetch = realFetch;

/** Hosts that are free public data: allowed from the demo too. */
const FREE = new Set(["data.texas.gov"]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const id = (p: string) => `${p}${randomBytes(8).toString("hex")}`;
const later = (ms: number, ws: string, fn: () => Promise<unknown>) => {
  setTimeout(() => void runDemo(ws, fn).catch((e) => console.error("[demo stand-in]", e instanceof Error ? e.message : e)), ms);
};

function markerWs(url: string, headers: Headers) {
  const m = url.match(MARK);
  if (m) return m[1];
  for (const [, v] of headers) {
    const x = v.match(MARK);
    if (x) return x[1];
    const b = v.match(/^Basic (.+)$/i);
    if (b) {
      const y = Buffer.from(b[1], "base64").toString().match(MARK);
      if (y) return y[1];
    }
  }
  return null;
}

async function bodyText(init?: RequestInit) {
  const b = init?.body;
  if (!b) return "";
  if (typeof b === "string") return b;
  if (b instanceof URLSearchParams) return b.toString();
  if (b instanceof Uint8Array || b instanceof ArrayBuffer) return "";
  if (typeof FormData !== "undefined" && b instanceof FormData) return "";
  return "";
}

const wrapped: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  const ws = demoWs() || markerWs(url, headers);
  if (!ws) return realFetch(input, init);
  const host = new URL(url, "http://local").hostname;
  if (FREE.has(host) || host === "localhost" || host === "127.0.0.1") return realFetch(input, init);
  if (process.env.DEMO_TRACE) console.log(`[demo] stand-in ${init?.method || "GET"} ${host}${new URL(url, "http://local").pathname}`);
  try {
    return await standIn(ws, host, url, init);
  } catch (e) {
    return json({ message: `Demo stand-in error: ${e instanceof Error ? e.message : e}` }, 500);
  }
};
globalThis.fetch = wrapped;

/** True if this request would be answered by a stand-in (used in tests). */
export const demoActive = () => inDemo();

async function standIn(ws: string, host: string, url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  const text = await bodyText(init);
  switch (host) {
    case "api.anthropic.com":
      return json(await (await import("./standins-ai")).fakeClaude(JSON.parse(text || "{}")));
    case "api.retellai.com":
      return retell(ws, path, text ? JSON.parse(text) : {});
    case "api.twilio.com":
      return twilio(ws, path, new URLSearchParams(text));
    case "lookups.twilio.com":
      return json({ valid: true, phone_number: decodeURIComponent(path.split("/").pop() || ""), line_type_intelligence: { type: "mobile", carrier_name: "Demo Wireless" } });
    case "api.resend.com":
      return json({ id: id("demo_email_") });
    case "api.rentcast.io":
      return rentcast(path, new URL(url).searchParams);
    case "api.batchdata.com":
      return batchdata(path, text ? JSON.parse(text) : {});
    case "www.dncscrub.com":
      return json([{ Phone: new URL(url).searchParams.get("phoneList"), ResultCode: "C", Reason: "Clean (demo)", IsWirelessOrVoIP: "1" }]);
    case "api.tcpalitigatorlist.com":
      return json({ results: { status: "Clean", status_array: [], phone_type: "mobile" } });
    case "api.blacklistalliance.net":
      return json({ status: "success", message: "Good", code: "", results: 0, wireless: 1 });
    case "api.deepgram.com":
      return json({ results: { utterances: [{ speaker: 0, transcript: "Hi, it's the team calling back about the house. (Demo transcript: pretend call, no sound.)" }, { speaker: 1, transcript: "Thanks for calling. I could do it if we close next month." }] } });
    case "api.openai.com":
      return json({ text: "Demo transcript: pretend call, no sound. The seller said they could close next month." });
    case "api.mercury.com":
      return json({ accounts: [], transactions: [] });
    default:
      if (/push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com/.test(host)) return new Response(null, { status: 201 });
      throw new Error(`${host} isn't available in the demo`);
  }
}

// ---------- Retell: calls are "placed", then a pretend result arrives a few seconds later ----------

async function retell(ws: string, path: string, body: Record<string, unknown>): Promise<Response> {
  if (path.endsWith("/create-phone-call")) {
    const call_id = id("call_demo_");
    const meta = (body.metadata || {}) as Record<string, string>;
    later(5000 + Math.random() * 4000, ws, async () => {
      const { onRetellEvent } = await import("./comms");
      const call = await (await import("./standins-ai")).fakeCall(ws, call_id, body, meta);
      await onRetellEvent(ws, "call_ended", call);
    });
    return json({ call_id, call_status: "registered", agent_id: body.override_agent_id || "agent_demo" });
  }
  if (path.endsWith("/create-web-call")) return json({ call_id: id("call_demo_"), access_token: "demo-web-call" });
  if (path.endsWith("/list-calls")) return json([]);
  if (path.includes("retell-llm")) return json({ llm_id: id("llm_demo_"), ...body });
  if (path.includes("agent")) return json({ agent_id: id("agent_demo_"), version: 1, ...body });
  if (path.includes("phone-number")) return json({ phone_number: body.phone_number || "+15555550100" });
  return json({ ok: true });
}

// ---------- Twilio: texts are "delivered" and get a pretend reply; team calls "connect" ----------

const SELLER_REPLIES = ["Who is this? How did you get my number?", "Maybe. What would you offer?", "Call me after 5 please.", "I might sell next year, not right now.", "Is this a real cash offer? What's the catch?"];
const BUYER_REPLIES = ["Send me the address, I can look this week.", "What's the rehab look like?", "I'd need it closer to 60% of ARV.", "In. Can I walk it tomorrow?"];

async function twilio(ws: string, path: string, form: URLSearchParams): Promise<Response> {
  if (path.endsWith("/Messages.json")) {
    const sid = id("SMdemo");
    const to = form.get("To") || "";
    const from = form.get("From") || "";
    later(6000 + Math.random() * 6000, ws, async () => {
      const { db } = await import("./db");
      const c = await db.contact.findFirst({ where: { workspaceId: ws, OR: [{ phone: to }, { phone2: to }] }, select: { kind: true, doNotContact: true } });
      if (!c || c.doNotContact) return;
      const list = c.kind === "buyer" ? BUYER_REPLIES : SELLER_REPLIES;
      const { onInboundSms } = await import("./comms");
      await onInboundSms(ws, { From: to, To: from, Body: `${list[Math.floor(Math.random() * list.length)]}`, MessageSid: id("SMdemoin") });
    });
    return json({ sid, status: "queued", to, from });
  }
  if (path.endsWith("/Calls.json")) {
    const sid = id("CAdemo");
    later(8000, ws, async () => {
      const { db } = await import("./db");
      const it = await db.interaction.findFirst({ where: { workspaceId: ws, providerRef: sid } });
      if (it) await db.interaction.update({ where: { id: it.id }, data: { status: "done", outcome: "conversation", durationSec: 120 + Math.floor(Math.random() * 300), summary: "Pretend team call (demo: no sound). Connected and talked." } });
    });
    return json({ sid, status: "queued" });
  }
  if (path.includes("IncomingPhoneNumbers")) return json({ incoming_phone_numbers: [] });
  return json({});
}

// ---------- data providers ----------

function rentcast(path: string, q: URLSearchParams): Response {
  const sqft = Number(q.get("squareFootage")) || 1450;
  const base = 120 + Math.round(Math.random() * 80); // $ per sq ft
  if (path.includes("/rent/")) return json({ rent: Math.round((sqft * base * 0.0085) / 10) * 10 });
  const comps = Array.from({ length: 6 }, (_, i) => {
    const s = sqft + Math.round((Math.random() - 0.5) * 400);
    return { formattedAddress: `${100 + i * 37} Sample St, ${q.get("city") || "Demo City"}, ${q.get("state") || "TX"}`, price: Math.round((s * base * (0.9 + Math.random() * 0.25)) / 1000) * 1000, squareFootage: s, bedrooms: 3, bathrooms: 2, removedDate: new Date(Date.now() - (20 + i * 25) * 864e5).toISOString(), distance: 0.2 + i * 0.15 };
  });
  return json({ price: Math.round((sqft * base * 0.62) / 1000) * 1000, comparables: comps });
}

const STREETS = ["Maple Ave", "Cedar Ln", "Elm St", "Birch Dr", "Willow Way", "Hickory Ct", "Sycamore Rd", "Poplar St"];
const NAMES = [["Gloria", "Hayes"], ["Dennis", "Price"], ["Arlene", "Walker"], ["Theo", "Lopez"], ["Marva", "Brown"], ["Curtis", "Jenkins"], ["Opal", "Ramirez"], ["Lionel", "Coleman"]];

function batchdata(path: string, body: Record<string, unknown>): Response {
  if (path.endsWith("/skip-trace")) {
    const reqs = (body.requests || []) as unknown[];
    return json({ results: { persons: reqs.map((_, i) => ({ name: { first: NAMES[i % NAMES.length][0], last: NAMES[i % NAMES.length][1] }, phoneNumbers: [{ number: `+1555555${String(100 + (i % 100)).padStart(4, "0")}`, type: "Mobile", reachable: true, dnc: i % 7 === 3 }], emails: [{ email: `owner${i}@example.com` }] })) } });
  }
  const crit = (body.searchCriteria || {}) as { query?: string };
  const take = Math.min(25, Number((body.options as { take?: number })?.take) || 10);
  const [city = "Houston", state = "TX"] = String(crit.query || "Houston, TX").split(",").map((x) => x.trim());
  const found = 300 + (String(crit.query || "").length * 97) % 4000;
  return json({
    results: {
      meta: { results: { resultsFound: found } },
      properties: Array.from({ length: take }, (_, i) => ({
        address: { street: `${1000 + i * 17} ${STREETS[i % STREETS.length]}`, city, state: state.slice(0, 2).toUpperCase(), zip: "77001", county: "Demo" },
        building: { bedroomCount: 2 + (i % 3), bathroomCount: 1 + (i % 2), livingAreaSquareFeet: 1100 + i * 40, yearBuilt: 1955 + i },
        owner: { names: [{ first: NAMES[i % NAMES.length][0], last: NAMES[i % NAMES.length][1] }], ...(i % 3 === 0 ? { mailingAddress: { street: `${200 + i} Elm Ave`, city: "Dallas", state: "TX", zip: "75201" } } : {}) },
        valuation: { estimatedValue: 140000 + i * 5000 },
        sale: { lastSale: { price: 60000 + i * 3500, saleDate: `20${String(5 + (i % 15)).padStart(2, "0")}-06-01`, mortgageAmount: i % 3 ? 50000 : 0 } },
      })),
    },
  });
}
