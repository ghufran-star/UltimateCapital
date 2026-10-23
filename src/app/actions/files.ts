"use server";

import type { ActionState } from "@/components/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { saveFile } from "@/lib/files";
import { assertDeal, requireCtx } from "@/lib/session";
import { str } from "@/lib/util";
import { act } from "./util";

export async function uploadFilesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const entityType = String(fd.get("entityType"));
    const entityId = String(fd.get("entityId"));
    if (entityType === "opportunity") await assertDeal(c, entityId);
    else if (entityType === "contact") await db.contact.findFirstOrThrow({ where: { id: entityId, workspaceId: c.workspace.id } });
    else throw new Error("Unknown record.");
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
    if (!files.length) throw new Error("Choose a file.");
    for (const f of files) {
      await saveFile(c.workspace.id, { entityType, entityId, kind: String(fd.get("kind") || (f.type.startsWith("image/") ? "photo" : "other")), name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()), uploadedBy: c.user.id, shared: fd.get("shared") === "on", note: str(fd.get("note")) });
    }
    if (entityType === "contact" && fd.get("kind") === "pof") await db.contact.update({ where: { id: entityId }, data: { fundsVerified: false } });
    return { ok: true, message: `${files.length} file${files.length > 1 ? "s" : ""} uploaded` };
  });
}

export async function fileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const c = await requireCtx(undefined, { write: true });
    const f = await db.fileObject.findFirstOrThrow({ where: { id: String(fd.get("fileId")), workspaceId: c.workspace.id }, select: { id: true, entityType: true, entityId: true, shared: true, name: true } });
    if (fd.get("delete")) {
      await db.fileObject.delete({ where: { id: f.id } });
      await audit(c.workspace.id, c.user.id, "file_deleted", { type: f.entityType, id: f.entityId }, { meta: { name: f.name } });
      return { ok: true, message: "Deleted" };
    }
    await db.fileObject.update({ where: { id: f.id }, data: { shared: !f.shared } });
    return { ok: true, message: f.shared ? "Hidden from investors" : "Shown to investors" };
  });
}
