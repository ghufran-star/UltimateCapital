"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { ensureWorkspaceDefaults } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { ensureDemoWorkspace, resetDemo } from "@/lib/demo";
import {
  endSession,
  hashPassword,
  DEMO_USER_EMAIL,
  HttpError,
  isDemoUser,
  normEmail,
  passwordProblem,
  requireCtx,
  ROLES,
  startSession,
  switchWorkspace,
  verifyPassword,
} from "@/lib/session";
import { e164, str } from "@/lib/util";
import { act } from "./util";

export async function setupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    if (!process.env.DATABASE_URL) throw new Error("Connect a database first.");
    if ((await db.user.count()) > 0) throw new Error("Setup is already done. Sign in instead.");
    const name = str(fd.get("name"));
    const email = str(fd.get("email"));
    const pw = String(fd.get("password") || "");
    const company = str(fd.get("company")) || "UltimateCapital";
    if (!name || !email?.includes("@")) throw new Error("Enter your name and email.");
    const bad = passwordProblem(pw);
    if (bad) throw new Error(bad);
    const user = await db.user.create({ data: { name, email: normEmail(email), passwordHash: await hashPassword(pw), isPlatformOwner: true, phone: e164(str(fd.get("phone"))) } });
    const ws = await db.workspace.create({ data: { name: company } });
    await db.membership.create({ data: { workspaceId: ws.id, userId: user.id, role: "owner" } });
    await ensureWorkspaceDefaults(ws.id);
    const { saveSetting } = await import("@/lib/config");
    await saveSetting(ws.id, "COMPANY_NAME", company);
    await startSession(user.id, ws.id);
    return { ok: true, redirect: "/settings" };
  });
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const email = normEmail(String(fd.get("email") || ""));
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const since = new Date(Date.now() - 15 * 60_000);
    const [byEmail, byIp] = await Promise.all([
      db.loginAttempt.count({ where: { key: `email:${email}`, createdAt: { gte: since } } }),
      db.loginAttempt.count({ where: { key: `ip:${ip}`, createdAt: { gte: since } } }),
    ]);
    if (byEmail >= 5 || byIp >= 20) throw new Error("Too many sign-in attempts. Wait 15 minutes and try again.");
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(String(fd.get("password") || ""), user.passwordHash))) {
      await db.loginAttempt.createMany({ data: [{ key: `email:${email}` }, { key: `ip:${ip}` }] });
      throw new Error("Email or password isn't right.");
    }
    await db.loginAttempt.deleteMany({ where: { key: `email:${email}` } });
    await startSession(user.id);
    return { ok: true, redirect: "/" };
  });
}

/** "Try the demo" on the sign-in page: a shared demo profile that only belongs to the demo workspace. */
export async function tryDemoAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return act(async () => {
    if (process.env.DEMO_PUBLIC === "off") throw new Error("The public demo is switched off.");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const since = new Date(Date.now() - 60 * 60_000);
    if ((await db.loginAttempt.count({ where: { key: `demo:${ip}`, createdAt: { gte: since } } })) >= 30) throw new Error("Too many demo sign-ins from here. Try again in an hour.");
    await db.loginAttempt.create({ data: { key: `demo:${ip}` } });
    const user = await db.user.upsert({ where: { email: DEMO_USER_EMAIL }, create: { email: DEMO_USER_EMAIL, name: "Demo Visitor", passwordHash: "disabled", phone: "+12145550199" }, update: {} });
    const ws = await ensureDemoWorkspace(user.id);
    await startSession(user.id, ws.id);
    return { ok: true, redirect: "/" };
  });
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const token = String(fd.get("token") || "");
    const inv = await db.invite.findUnique({ where: { token } });
    if (!inv || inv.usedAt || inv.expiresAt < new Date()) throw new Error("This invite link is no longer valid.");
    const name = str(fd.get("name"));
    const email = normEmail(String(fd.get("email") || ""));
    const pw = String(fd.get("password") || "");
    if (!name || !email.includes("@")) throw new Error("Enter your name and email.");
    if (inv.email && inv.email !== email) throw new Error(`This invite is for ${inv.email}.`);
    const bad = passwordProblem(pw);
    if (bad) throw new Error(bad);
    let user = await db.user.findUnique({ where: { email } });
    if (user && !(await verifyPassword(pw, user.passwordHash))) throw new Error("You already have an account: enter its password to join this workspace.");
    if (!user) user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(pw), phone: str(fd.get("phone")) } });
    await db.membership.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } }, create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role }, update: { role: inv.role } });
    await db.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    await audit(inv.workspaceId, user.id, "joined", { type: "user", id: user.id }, { meta: { role: inv.role } });
    await startSession(user.id, inv.workspaceId);
    return { ok: true, redirect: "/" };
  });
}

export async function switchWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    let id = String(fd.get("workspaceId"));
    const target = await db.workspace.findUnique({ where: { id }, select: { isDemo: true } });
    if (target?.isDemo) {
      // Entering the demo always goes through the builder, so an old or half-built demo is rebuilt first.
      const c = await requireCtx();
      id = (await ensureDemoWorkspace(c.user.id)).id;
    }
    if (!(await switchWorkspace(id))) throw new Error("Not a member of that workspace.");
    return { ok: true, redirect: "/" };
  });
}

export async function createWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    if (isDemoUser(c)) throw new HttpError(403, "The demo sign-in can't create workspaces. Sign up for your own account.");
    if (!c.user.isPlatformOwner && c.role !== "owner") throw new HttpError(403, "Only owners can create workspaces.");
    const name = str(fd.get("name"));
    if (!name) throw new Error("Name the workspace.");
    const ws = await db.workspace.create({ data: { name } });
    await db.membership.create({ data: { workspaceId: ws.id, userId: c.user.id, role: "owner" } });
    await ensureWorkspaceDefaults(ws.id);
    const { saveSetting } = await import("@/lib/config");
    await saveSetting(ws.id, "COMPANY_NAME", name);
    await switchWorkspace(ws.id);
    return { ok: true, redirect: "/settings" };
  });
}

export async function openDemoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    if (!c.user.isPlatformOwner && c.role !== "owner") throw new HttpError(403, "Only owners can open the demo.");
    if (fd.get("reset") && isDemoUser(c)) {
      const cur = await db.workspace.findFirst({ where: { isDemo: true }, select: { createdAt: true } });
      if (cur && Date.now() - cur.createdAt.getTime() < 15 * 60_000) throw new Error("The demo was reset less than 15 minutes ago.");
    }
    const ws = fd.get("reset") ? await resetDemo(c.user.id) : await ensureDemoWorkspace(c.user.id);
    await switchWorkspace(ws.id);
    return { ok: true, redirect: "/" };
  });
}

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("team", { write: true });
    const role = String(fd.get("role") || "caller");
    if (!ROLES.includes(role as (typeof ROLES)[number]) || (role === "owner" && c.role !== "owner")) throw new Error("Pick a valid role.");
    const email = str(fd.get("email"));
    const inv = await db.invite.create({
      data: { workspaceId: c.workspace.id, token: randomBytes(18).toString("base64url"), email: email ? normEmail(email) : null, role, createdById: c.user.id, expiresAt: new Date(Date.now() + 14 * 864e5) },
    });
    await audit(c.workspace.id, c.user.id, "invite_created", { type: "invite", id: inv.id }, { meta: { role, email } });
    return { ok: true, message: `Invite created. Share the link below.` };
  });
}

export async function memberRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("team", { write: true });
    const id = String(fd.get("membershipId"));
    const m = await db.membership.findUniqueOrThrow({ where: { id } });
    if (m.workspaceId !== c.workspace.id) throw new Error("Not found");
    if (m.userId === c.user.id) throw new Error("You can't change your own role.");
    if (fd.get("remove")) {
      await db.membership.delete({ where: { id } });
      await audit(c.workspace.id, c.user.id, "member_removed", { type: "user", id: m.userId });
      return { ok: true, message: "Removed" };
    }
    const role = String(fd.get("role"));
    if (!ROLES.includes(role as (typeof ROLES)[number])) throw new Error("Pick a valid role.");
    await db.membership.update({ where: { id }, data: { role, states: String(fd.get("states") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) } });
    await audit(c.workspace.id, c.user.id, "member_role", { type: "user", id: m.userId }, { after: { role } });
    return { ok: true, message: "Saved" };
  });
}

export async function profileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx();
    if (isDemoUser(c)) throw new Error("The shared demo profile can't be changed. Sign up for your own account.");
    const data: { name?: string; phone?: string | null; passwordHash?: string } = { name: str(fd.get("name")) || c.user.name, phone: e164(str(fd.get("phone"))) };
    const next = String(fd.get("newPassword") || "");
    if (next) {
      const u = await db.user.findUniqueOrThrow({ where: { id: c.user.id } });
      if (!(await verifyPassword(String(fd.get("currentPassword") || ""), u.passwordHash))) throw new Error("Current password isn't right.");
      const bad = passwordProblem(next);
      if (bad) throw new Error(bad);
      data.passwordHash = await hashPassword(next);
    }
    await db.user.update({ where: { id: c.user.id }, data });
    return { ok: true, message: "Saved" };
  });
}
