import { ActionButton, ActionForm, Submit } from "@/components/client";
import { FILE_KINDS, fileSize, listFiles } from "@/lib/files";
import { label } from "@/lib/stages";
import { ago } from "@/lib/util";
import { fileAction, uploadFilesAction } from "../app/actions/files";

/** Files on a deal or a contact: photo grid + document list + upload. */
export async function FilesPanel({ ws, entityType, entityId, writable, investorShare = false }: { ws: string; entityType: string; entityId: string; writable: boolean; investorShare?: boolean }) {
  const files = await listFiles(ws, entityType, entityId);
  const photos = files.filter((f) => f.mime.startsWith("image/"));
  const docs = files.filter((f) => !f.mime.startsWith("image/"));
  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              <a href={`/api/files/${p.id}`} target="_blank">
                <img src={`/api/files/${p.id}`} alt={p.name} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
              </a>
              {investorShare && p.shared && <span className="badge badge-good absolute left-1 top-1">Investors</span>}
              {writable && (
                <div className="mt-1 flex gap-2 text-xs">
                  {investorShare && (
                    <ActionButton action={fileAction} hidden={{ fileId: p.id }} className="underline">
                      {p.shared ? "Hide" : "Share"}
                    </ActionButton>
                  )}
                  <ActionButton action={fileAction} hidden={{ fileId: p.id, delete: "1" }} className="text-bad underline" confirm="Delete this photo?">
                    Delete
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <a href={`/api/files/${d.id}`} target="_blank" className="min-w-0 truncate hover:text-brand">
                📄 {d.name}
                <span className="ml-2 text-xs text-muted">
                  {label(d.kind)} · {fileSize(d.size)} · {ago(d.createdAt)}
                </span>
              </a>
              {writable && (
                <span className="flex shrink-0 gap-2 text-xs">
                  {investorShare && (
                    <ActionButton action={fileAction} hidden={{ fileId: d.id }} className="underline">
                      {d.shared ? "Hide from investors" : "Share with investors"}
                    </ActionButton>
                  )}
                  <ActionButton action={fileAction} hidden={{ fileId: d.id, delete: "1" }} className="text-bad underline" confirm="Delete this file?">
                    Delete
                  </ActionButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!files.length && <p className="text-sm text-muted">No files yet.</p>}
      {writable && (
        <ActionForm action={uploadFilesAction} className="flex flex-wrap items-end gap-2" resetOnOk>
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="file" name="files" multiple className="field max-w-xs" />
          <select name="kind" className="field w-auto">
            {FILE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          {investorShare && (
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="shared" /> Show to investors
            </label>
          )}
          <Submit className="btn btn-ghost">Upload</Submit>
        </ActionForm>
      )}
    </div>
  );
}
