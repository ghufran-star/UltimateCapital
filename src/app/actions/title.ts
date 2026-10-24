"use server";

import type { ActionState } from "@/components/client";
import type { Prisma } from "@prisma/client";
import { audit, json } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { e164, str } from "@/lib/util";
import { act } from "./util";

const tri = (v: FormDataEntryValue | null) => (v === "yes" || v === "no" ? v : null);
const states = (fd: FormData, k: string) => [...new Set(fd.getAll(k).flatMap((v) => String(v).split(",")).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))];

/** Add or edit a title company's profile. */
export async function saveTitleCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const ws = c.workspace.id;
    const id = str(fd.get("titleCompanyId"));
    const full = Boolean(fd.get("profileForm"));
    if (!full && !id) throw new Error("Save the profile first.");
    const data: Prisma.TitleCompanyUncheckedUpdateInput = {};
    if (full) {
      const name = str(fd.get("name"));
      if (!name) throw new Error("Name the title company.");
      const email = str(fd.get("email"))?.toLowerCase() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`${email} doesn't look like an email address.`);
      Object.assign(data, {
        name,
        state: str(fd.get("state"))?.toUpperCase() || null,
        email,
        phone: e164(str(fd.get("phone"))),
        website: str(fd.get("website")),
        address: str(fd.get("address")),
        city: str(fd.get("city")),
        zip: str(fd.get("zip")),
        fees: str(fd.get("fees")),
        turnaround: str(fd.get("turnaround")),
        notes: str(fd.get("notes")),
        licenseNo: str(fd.get("licenseNo")),
        licenseState: str(fd.get("licenseState"))?.toUpperCase() || null,
      });
    }
    if (full) {
      Object.assign(data, {
        states: states(fd, "states"),
        attorneyStates: states(fd, "attorneyStates"),
        underwriters: String(fd.get("underwriters") || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
        assignments: tri(fd.get("assignments")),
        doubleClose: tri(fd.get("doubleClose")),
        transactionalFunding: tri(fd.get("transactionalFunding")),
        remoteClosing: tri(fd.get("remoteClosing")),
        mobileNotary: tri(fd.get("mobileNotary")),
        emdHandling: str(fd.get("emdHandling")),
        status: ["preferred", "active", "avoid"].includes(String(fd.get("status"))) ? String(fd.get("status")) : "active",
      });
      const before = id ? await db.titleCompany.findFirst({ where: { id, workspaceId: ws } }) : null;
      const wire = e164(str(fd.get("wireVerifiedPhone")));
      data.wireVerifiedPhone = wire;
      // A changed wire number must be confirmed again.
      if (before && before.wireVerifiedPhone !== wire) Object.assign(data, { wireConfirmedAt: null, wireConfirmedBy: null });
    }
    if (fd.get("contactsForm")) {
      const names = fd.getAll("cName").map(String);
      const roles = fd.getAll("cRole").map(String);
      const emails = fd.getAll("cEmail").map(String);
      const phones = fd.getAll("cPhone").map(String);
      data.contacts = json(names.map((n, i) => ({ name: n.trim(), role: roles[i]?.trim() || "", email: emails[i]?.trim().toLowerCase() || "", phone: e164(phones[i]) || phones[i]?.trim() || "" })).filter((x) => x.name || x.email || x.phone));
    }
    if (fd.get("officesForm")) {
      const labels = fd.getAll("oLabel").map(String);
      const addrs = fd.getAll("oAddress").map(String);
      const cities = fd.getAll("oCity").map(String);
      const sts = fd.getAll("oState").map(String);
      const phones = fd.getAll("oPhone").map(String);
      data.offices = json(labels.map((l, i) => ({ label: l.trim(), address: addrs[i]?.trim() || "", city: cities[i]?.trim() || "", state: sts[i]?.trim().toUpperCase() || "", phone: e164(phones[i]) || phones[i]?.trim() || "" })).filter((x) => x.label || x.address || x.city));
    }
    let tid = id;
    if (id) {
      await db.titleCompany.findFirstOrThrow({ where: { id, workspaceId: ws } });
      await db.titleCompany.update({ where: { id }, data });
    } else {
      const t = await db.titleCompany.create({ data: { ...(data as Prisma.TitleCompanyUncheckedCreateInput), workspaceId: ws } });
      tid = t.id;
    }
    await audit(ws, c.user.id, "title_company_saved", { type: "title_company", id: tid! });
    return { ok: true, message: "Saved", redirect: id ? undefined : `/closing/title/${tid}` };
  });
}

/** Records that someone called the known number and confirmed the wire instructions. */
export async function confirmWireAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const t = await db.titleCompany.findFirstOrThrow({ where: { id: String(fd.get("titleCompanyId")), workspaceId: c.workspace.id } });
    if (fd.get("clear")) {
      await db.titleCompany.update({ where: { id: t.id }, data: { wireConfirmedAt: null, wireConfirmedBy: null } });
      return { ok: true, message: "Cleared" };
    }
    if (!t.wireVerifiedPhone) throw new Error("Add the known phone number for wire checks first (from their website or a past closing, never from an email).");
    await db.titleCompany.update({ where: { id: t.id }, data: { wireConfirmedAt: new Date(), wireConfirmedBy: c.user.name } });
    await audit(c.workspace.id, c.user.id, "title_wire_confirmed", { type: "title_company", id: t.id }, { meta: { phone: t.wireVerifiedPhone } });
    return { ok: true, message: "Recorded" };
  });
}

export async function deleteTitleCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const t = await db.titleCompany.findFirstOrThrow({ where: { id: String(fd.get("titleCompanyId")), workspaceId: c.workspace.id }, include: { _count: { select: { transactions: true } } } });
    if (t._count.transactions) throw new Error(`${t.name} is on ${t._count.transactions} deal(s). Mark it "Avoid" instead so the history stays.`);
    await db.titleCompany.delete({ where: { id: t.id } });
    await db.fileObject.deleteMany({ where: { workspaceId: c.workspace.id, entityType: "title_company", entityId: t.id } });
    await audit(c.workspace.id, c.user.id, "title_company_deleted", { type: "title_company", id: t.id }, { meta: { name: t.name } });
    return { ok: true, redirect: "/closing/title" };
  });
}

/** Adds a licensed agency from the free state directory to your title companies. */
export async function addFromDirectoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const ws = c.workspace.id;
    const l = await db.titleLicensee.findFirstOrThrow({ where: { id: String(fd.get("licenseeId")), OR: [{ workspaceId: null }, { workspaceId: ws }] } });
    const existing = await db.titleCompany.findFirst({ where: { workspaceId: ws, OR: [...(l.licenseNo ? [{ licenseNo: l.licenseNo, licenseState: l.state }] : []), { name: { equals: l.name, mode: "insensitive" as const }, state: l.state }] } });
    if (existing) return { ok: true, redirect: `/closing/title/${existing.id}` };
    const t = await db.titleCompany.create({
      data: { workspaceId: ws, name: l.name, state: l.state, states: [l.state], city: l.city, zip: l.zip, phone: l.phone, email: l.email, website: l.website, licenseNo: l.licenseNo, licenseState: l.state, licenseCheckedAt: l.fetchedAt, underwriters: l.underwriters, notes: l.counties.length ? `Appointed in ${l.counties.length} counties: ${l.counties.slice(0, 30).join(", ")}${l.counties.length > 30 ? "…" : ""}` : null },
    });
    await audit(ws, c.user.id, "title_company_added_from_directory", { type: "title_company", id: t.id }, { meta: { licensee: l.key } });
    return { ok: true, redirect: `/closing/title/${t.id}` };
  });
}

/** Pulls the latest free list for a state that publishes one (Texas today). */
export async function refreshDirectoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const state = String(fd.get("state") || "TX");
    const { AUTO_STATES, refreshTexas } = await import("@/lib/titledir");
    if (!AUTO_STATES[state]) throw new Error(`${state} doesn't publish a free downloadable list. Upload one as CSV instead.`);
    const n = await refreshTexas();
    await audit(c.workspace.id, c.user.id, "title_directory_refreshed", undefined, { meta: { state, n } });
    return { ok: true, message: `Loaded ${n.toLocaleString()} licensed title agencies in ${state}` };
  });
}

/** Any state's list as a CSV (kept for this workspace only). */
export async function uploadDirectoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx("closing", { write: true });
    const state = str(fd.get("state"))?.toUpperCase();
    if (!state) throw new Error("Pick the state this list is for.");
    const f = fd.get("file");
    if (!f || typeof f !== "object" || !("text" in f) || !f.size) throw new Error("Choose the CSV file.");
    const { importLicenseeCsv } = await import("@/lib/titledir");
    const n = await importLicenseeCsv(c.workspace.id, state, await f.text());
    await audit(c.workspace.id, c.user.id, "title_directory_uploaded", undefined, { meta: { state, n } });
    return { ok: true, message: `Added ${n.toLocaleString()} title agencies for ${state}` };
  });
}
