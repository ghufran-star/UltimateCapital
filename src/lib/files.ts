import { audit } from "./audit";
import { db } from "./db";

export const FILE_KINDS = [
  { key: "photo", label: "Photo" },
  { key: "pof", label: "Proof of funds" },
  { key: "id", label: "ID" },
  { key: "title", label: "Title document" },
  { key: "settlement", label: "Settlement statement" },
  { key: "contract", label: "Contract" },
  { key: "wire", label: "Wire instructions" },
  { key: "eo", label: "E&O / insurance certificate" },
  { key: "cpl", label: "Closing protection letter" },
  { key: "w9", label: "W-9" },
  { key: "other", label: "Other" },
] as const;

export const MAX_FILE = 15 * 1024 * 1024;

export async function saveFile(ws: string, o: { entityType: string; entityId: string; kind: string; name: string; mime: string; data: Buffer; uploadedBy: string; shared?: boolean; note?: string | null }) {
  if (o.data.length > MAX_FILE) throw new Error("Files can be up to 15 MB.");
  const f = await db.fileObject.create({
    data: { workspaceId: ws, entityType: o.entityType, entityId: o.entityId, kind: o.kind, name: o.name.slice(0, 200), mime: o.mime || "application/octet-stream", size: o.data.length, data: new Uint8Array(o.data), uploadedBy: o.uploadedBy, shared: !!o.shared, note: o.note || null },
    select: { id: true },
  });
  await audit(ws, o.uploadedBy, "file_uploaded", { type: o.entityType, id: o.entityId }, { meta: { fileId: f.id, name: o.name, kind: o.kind } });
  return f;
}

export async function listFiles(ws: string, entityType: string, entityId: string) {
  return db.fileObject.findMany({ where: { workspaceId: ws, entityType, entityId }, select: { id: true, name: true, kind: true, mime: true, size: true, shared: true, note: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export const fileSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
