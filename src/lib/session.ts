import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

export const SESSION_COOKIE = "uc_session";
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ROLES = ["owner", "admin", "acquisitions", "dispositions", "tc", "caller", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  acquisitions: "Acquisitions",
  dispositions: "Dispositions",
  tc: "Transaction coordinator",
  caller: "Caller / VA",
  viewer: "View only",
};

export type Permission =
  | "settings"
  | "rules"
  | "states"
  | "approve"
  | "team"
  | "sellers"
  | "buyers"
  | "deals"
  | "contracts"
  | "closing"
  | "campaigns"
  | "calls";

const PERMS: Record<Role, Permission[] | "all"> = {
  owner: "all",
  admin: ["settings", "rules", "states", "approve", "team", "sellers", "buyers", "deals", "contracts", "closing", "campaigns", "calls"],
  acquisitions: ["sellers", "deals", "campaigns", "calls", "contracts"],
  dispositions: ["buyers", "deals", "campaigns", "calls"],
  tc: ["contracts", "closing", "deals", "calls"],
  caller: ["calls", "sellers", "buyers"],
  viewer: [],
};

export function can(role: string, p: Permission) {
  const x = PERMS[role as Role];
  return x === "all" || (Array.isArray(x) && x.includes(p));
}

export type Ctx = {
  user: { id: string; email: string; name: string; phone: string | null; isPlatformOwner: boolean };
  workspace: { id: string; name: string; isDemo: boolean; timezone: string };
  role: Role;
  /** States this member may work. Empty = all states. */
  states: string[];
};

// ---------- Passwords ----------

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(pw, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

export const passwordProblem = (pw: string) => (!pw || pw.length < 8 ? "Use at least 8 characters." : null);
export const normEmail = (e: string) => e.trim().toLowerCase();

// ---------- Sessions ----------

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startSession(userId: string, workspaceId?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 90 * 864e5);
  await db.session.create({ data: { id: sha(token), userId, workspaceId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await db.session.delete({ where: { id: sha(t) } }).catch(() => null);
  jar.delete(SESSION_COOKIE);
}

async function currentSession() {
  if (!process.env.DATABASE_URL) return null;
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const s = await db.session.findUnique({ where: { id: sha(t) }, include: { user: true } }).catch(() => null);
  if (!s || s.expiresAt < new Date()) return null;
  return s;
}

/** Signed-in user + current workspace + role, or null. */
export async function getCtx(): Promise<Ctx | null> {
  const s = await currentSession();
  if (!s) return null;
  const memberships = await db.membership.findMany({
    where: { userId: s.userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  let m = memberships.find((x) => x.workspaceId === s.workspaceId) || memberships.find((x) => !x.workspace.isDemo) || memberships[0];
  if (!m) return null;
  if (m.workspaceId !== s.workspaceId) await db.session.update({ where: { id: s.id }, data: { workspaceId: m.workspaceId } });
  const u = s.user;
  return {
    user: { id: u.id, email: u.email, name: u.name, phone: u.phone, isPlatformOwner: u.isPlatformOwner },
    workspace: { id: m.workspace.id, name: m.workspace.name, isDemo: m.workspace.isDemo, timezone: m.workspace.timezone },
    role: m.role as Role,
    states: ["owner", "admin"].includes(m.role) ? [] : m.states,
  };
}

/** Prisma filter on a Property for the member's states (empty = no limit). */
export const propertyScope = (c: Ctx) => (c.states.length ? { state: { in: c.states } } : {});
/** Prisma filter on an Opportunity for the member's states. */
export const dealScope = (c: Ctx) => (c.states.length ? { property: { state: { in: c.states } } } : {});

/** Throws unless the deal is in this workspace and in the member's states. */
export async function assertDeal(c: Ctx, opportunityId: string) {
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId: c.workspace.id, ...dealScope(c) } });
  if (!o) throw new HttpError(404, "Deal not found, or it's outside the states you work.");
  return o;
}

export async function switchWorkspace(workspaceId: string) {
  const s = await currentSession();
  if (!s) return false;
  const m = await db.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: s.userId } } });
  if (!m) return false;
  await db.session.update({ where: { id: s.id }, data: { workspaceId } });
  return true;
}

export async function hasAnyUser() {
  if (!process.env.DATABASE_URL) return false;
  return (await db.user.count().catch(() => 0)) > 0;
}

// ---------- Guards ----------

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For pages: redirects to sign-in or setup when needed. */
export async function pageCtx(): Promise<Ctx> {
  if (!process.env.DATABASE_URL || !(await hasAnyUser())) redirect("/setup");
  const c = await getCtx();
  if (!c) redirect("/login");
  return c;
}

/** For actions and API routes. */
export async function requireCtx(p?: Permission, opts: { write?: boolean } = {}): Promise<Ctx> {
  const c = await getCtx();
  if (!c) throw new HttpError(401, "Please sign in.");
  if (p && !can(c.role, p)) throw new HttpError(403, "Your role doesn't allow this.");
  if (opts.write && (c.workspace.isDemo || c.role === "viewer")) {
    throw new HttpError(403, c.workspace.isDemo ? "The demo workspace is view-only." : "Your role is view-only.");
  }
  return c;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 500 });
}

export const actor = (c: Ctx) => c.user.id;
