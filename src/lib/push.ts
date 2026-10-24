import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import { decrypt, encrypt } from "./config";
import { db } from "./db";

// Web Push (RFC 8030 / 8291 / 8292) with no third-party service: alerts go straight to the
// browser's push service (Apple, Google, Mozilla). The signing key is generated once and kept encrypted.

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

type Vapid = { publicKey: string; d: string; x: string; y: string };

let cached: Vapid | null = null;

/** The app's push signing key (P-256), created on first use. */
export async function vapid(): Promise<Vapid> {
  if (cached) return cached;
  const row = await db.appSecret.findUnique({ where: { key: "VAPID" } });
  if (row) {
    const v = JSON.parse(decrypt(row.value) || "null") as Vapid | null;
    if (v?.publicKey) return (cached = v);
  }
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey(); // 65 bytes, uncompressed
  const v: Vapid = { publicKey: b64u(pub), d: b64u(ecdh.getPrivateKey()), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  await db.appSecret.upsert({ where: { key: "VAPID" }, create: { key: "VAPID", value: encrypt(JSON.stringify(v)) }, update: {} });
  const again = await db.appSecret.findUniqueOrThrow({ where: { key: "VAPID" } });
  return (cached = JSON.parse(decrypt(again.value) || "null") as Vapid);
}

function vapidJwt(v: Vapid, audience: string, subject: string) {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: v.d, x: v.x, y: v.y }, format: "jwk" });
  const sig = edSign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64u(sig)}`;
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** aes128gcm content encoding (RFC 8291). */
export function encryptPayload(p256dh: string, authSecret: string, plaintext: Buffer) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const eph = createECDH("prime256v1");
  eph.generateKeys();
  const asPublic = eph.getPublicKey();
  const shared = eph.computeSecret(uaPublic);
  const salt = randomBytes(16);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushMessage = { title: string; body: string; href?: string; tag?: string };

/** Sends one alert. Returns false when the subscription is gone (unsubscribed or expired). */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, msg: PushMessage) {
  const v = await vapid();
  const url = new URL(sub.endpoint);
  const jwt = vapidJwt(v, url.origin, process.env.PUSH_CONTACT || "mailto:alerts@ultimatecapital.app");
  const body = encryptPayload(sub.p256dh, sub.auth, Buffer.from(JSON.stringify(msg).slice(0, 3000)));
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { authorization: `vapid t=${jwt}, k=${v.publicKey}`, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high" },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404 || r.status === 410) return false;
  if (!r.ok) throw new Error(`Push service ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return true;
}

/** Which kind of alert a notification is, for people's alert preferences. */
export function topicOf(title: string, href?: string | null) {
  if (/^Approval needed/i.test(title) || href?.startsWith("/approvals")) return "approvals";
  if (/hot deal|ready to proceed|buyer offer|countered|opened your offer|walkthrough|seller question/i.test(title)) return "hot";
  if (/paid|wire|settlement|payment/i.test(title)) return "money";
  return "other";
}

/** Push a notification to the phones and browsers of people in the workspace who asked for this kind of alert. */
export async function pushNotification(ws: string, n: { title: string; body: string; href?: string | null; userId?: string | null }) {
  const topic = topicOf(n.title, n.href);
  const members = await db.membership.findMany({ where: { workspaceId: ws, ...(n.userId ? { userId: n.userId } : {}) }, select: { userId: true, workspace: { select: { isDemo: true } } } });
  if (!members.length || members[0].workspace.isDemo) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: members.map((m) => m.userId) }, OR: [{ topics: { has: topic } }, { topics: { has: "all" } }] } });
  let sent = 0;
  for (const s of subs) {
    try {
      const ok = await sendPush(s, { title: n.title, body: n.body.slice(0, 300), href: n.href || "/alerts", tag: topic });
      if (ok) {
        sent++;
        await db.pushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date(), failures: 0 } });
      } else await db.pushSubscription.delete({ where: { id: s.id } });
    } catch (e) {
      const f = s.failures + 1;
      if (f >= 10) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => null);
      else await db.pushSubscription.update({ where: { id: s.id }, data: { failures: f } }).catch(() => null);
      console.error("[push]", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
