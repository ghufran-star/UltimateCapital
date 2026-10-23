import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader, Stat } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { STATES } from "@/lib/states";
import { ago } from "@/lib/util";
import { importDncAction, removeSuppressionAction } from "../../../actions/settings";

export default async function Compliance({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const q = (await searchParams).q?.trim();
  const [bySource, recent, s, consents, dnc] = await Promise.all([
    db.suppression.groupBy({ by: ["source"], where: { workspaceId: ws }, _count: true }),
    db.suppression.findMany({ where: { workspaceId: ws, ...(q ? { value: { contains: q.replace(/\D/g, "") || q } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    loadSettings(ws),
    db.consent.count({ where: { contact: { workspaceId: ws }, granted: true } }),
    db.contact.count({ where: { workspaceId: ws, doNotContact: true } }),
  ]);
  const ro = c.workspace.isDemo || !can(c.role, "settings");
  const base = (s.PUBLIC_URL || "https://YOUR-APP").replace(/\/$/, "");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Compliance" sub="Every call and text is checked at send time: State Pack active, permitted hours, consent, DNC lists, opt-outs and daily caps." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Suppressed numbers" value={bySource.reduce((a, x) => a + x._count, 0)} />
        <Stat label="Do-not-contact" value={dnc} />
        <Stat label="Consents on file" value={consents} />
        <Stat label="Live DNC scrub" value={s.DNC_SCRUB_URL ? "On" : "Off"} tone={s.DNC_SCRUB_URL ? "good" : "warn"} />
      </div>
      <Card title="Lists">
        <ul className="space-y-1 text-sm">
          {bySource.length ? (
            bySource.map((b) => (
              <li key={b.source}>
                {b.source.replace(/_/g, " ")}: <span className="tnum font-medium">{b._count.toLocaleString()}</span>
              </li>
            ))
          ) : (
            <li className="text-muted">No lists imported yet.</li>
          )}
        </ul>
      </Card>
      {!ro && (
        <Card title="Import a DNC list">
          <ActionForm action={importDncAction}>
            <Field label="List">
              <select name="source" className="field">
                <option value="national_dnc">National DNC (FTC download for your area codes)</option>
                {STATES.map((x) => (
                  <option key={x.code} value={`state_dnc:${x.code}`}>
                    {x.name} state DNC
                  </option>
                ))}
                <option value="litigator">Known litigators</option>
                <option value="reassigned">Reassigned numbers</option>
                <option value="internal">Internal DNC</option>
              </select>
            </Field>
            <input type="file" name="file" accept=".txt,.csv" className="field" />
            <textarea name="numbers" rows={3} className="field font-mono text-xs" placeholder="…or paste numbers, one per line" />
            <Submit pendingText="Importing…">Import</Submit>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">
            Automatic updates: set a DNC scrub provider in Integrations for a live check on every call, and/or have your provider push updates to <code className="break-all">{`${base}/api/webhooks/dnc?ws=${ws}&key=WEBHOOK_SECRET&source=national_dnc`}</code> (plain text, one number per line). Every queued call and text is re-checked against all lists at the moment it is sent.
          </p>
        </Card>
      )}
      <Card title="Search suppressions" pad={false}>
        <form className="flex gap-2 border-b border-line p-4">
          <input name="q" defaultValue={q} placeholder="Phone or email" className="field" />
          <button className="btn btn-ghost">Search</button>
        </form>
        <ul className="divide-y divide-line">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {r.value} <span className="text-xs text-muted">· {r.source.replace(/_/g, " ")} · {r.reason || ""} {ago(r.createdAt)}</span>
              </span>
              {!ro && r.source === "internal" && c.role === "owner" && (
                <ActionButton action={removeSuppressionAction} hidden={{ suppressionId: r.id }} confirm="Remove from internal DNC?">
                  Remove
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
