import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { roleLabel as agentRoleLabel } from "@/lib/agents";
import { db } from "@/lib/db";
import { label } from "@/lib/stages";
import { transcriptionOn } from "@/lib/transcribe";
import { fmtDate, fullName } from "@/lib/util";
import { reprocessAction } from "../app/actions/ops";
import { logCallAction, transcribeCallAction } from "../app/actions/comms";

// One communication history for a person, a deal or a property: emails, texts, AI calls
// (recording + transcript), team calls (recording; transcript when switched on), notes.

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "ai_calls", label: "AI calls" },
  { key: "team_calls", label: "Team calls" },
  { key: "sms", label: "Texts" },
  { key: "email", label: "Emails" },
  { key: "note", label: "Notes" },
  { key: "system", label: "System" },
] as const;

const filterWhere = (k: string): Prisma.InteractionWhereInput =>
  k === "ai_calls" ? { channel: "call", provider: "retell" } : k === "team_calls" ? { channel: "call", NOT: { provider: "retell" } } : ["sms", "email", "note", "system"].includes(k) ? { channel: k } : {};

const roleLabel = (r?: string | null) => (r ? agentRoleLabel(r) || label(r) : null);

const OUTCOMES = ["conversation", "interested", "not_interested", "callback", "voicemail", "no_answer", "wrong_number", "offer_made", "appointment_set", "dnc"];

type Props = {
  ws: string;
  contactIds: string[];
  opportunityIds: string[];
  /** Current page URL without ch/lim, used for the filter links. */
  base: string;
  ch?: string;
  lim?: number;
  writable: boolean;
  /** People the "Log a call" form can pick from. */
  people?: { id: string; name: string; role?: string }[];
  opportunityId?: string;
  title?: string;
};

export async function Timeline({ ws, contactIds, opportunityIds, base, ch = "all", lim = 60, writable, people = [], opportunityId, title = "Communication history" }: Props) {
  const scope: Prisma.InteractionWhereInput = {
    workspaceId: ws,
    OR: [...(contactIds.length ? [{ contactId: { in: contactIds } }] : []), ...(opportunityIds.length ? [{ opportunityId: { in: opportunityIds } }] : [])],
  };
  if (!contactIds.length && !opportunityIds.length) scope.id = "none";
  const take = Math.min(Math.max(lim, 20), 500);
  const [items, groups, canTranscribe] = await Promise.all([
    db.interaction.findMany({ where: { AND: [scope, filterWhere(ch)] }, include: { contact: { select: { id: true, firstName: true, lastName: true, company: true, kind: true } } }, orderBy: { createdAt: "desc" }, take: take + 1 }),
    db.interaction.groupBy({ by: ["channel", "provider"], where: scope, _count: { _all: true } }),
    transcriptionOn(ws),
  ]);
  const more = items.length > take;
  const shown = items.slice(0, take);
  const count = (k: string) =>
    groups
      .filter((g) => (k === "all" ? true : k === "ai_calls" ? g.channel === "call" && g.provider === "retell" : k === "team_calls" ? g.channel === "call" && g.provider !== "retell" : g.channel === k))
      .reduce((a, g) => a + g._count._all, 0);
  const href = (extra: Record<string, string>) => {
    const u = new URL(base, "http://x");
    for (const [k, v] of Object.entries({ ch, ...extra })) if (v && !(k === "ch" && v === "all")) u.searchParams.set(k, v);
    return `${u.pathname}?${u.searchParams}#history`;
  };
  // Day headings.
  let lastDay = "";
  return (
    <section id="history" className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-1 text-xs">
          {FILTERS.map((f) => {
            const n = count(f.key);
            if (!n && f.key !== "all" && f.key !== ch) return null;
            return (
              <Link key={f.key} href={href({ ch: f.key })} scroll={false} className={`rounded-full border px-2 py-0.5 ${ch === f.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>
                {f.label} {n}
              </Link>
            );
          })}
        </div>
      </div>

      {writable && people.length > 0 && (
        <details className="border-b border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">📞 Log a call you made or took</summary>
          <ActionForm action={logCallAction} resetOnOk className="mt-3 space-y-2">
            {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
            <div className="grid gap-2 md:grid-cols-4">
              <select name="contactId" defaultValue={people[0]?.id} className="field">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` (${p.role})` : ""}
                  </option>
                ))}
              </select>
              <select name="direction" className="field">
                <option value="outbound">I called them</option>
                <option value="inbound">They called me</option>
              </select>
              <select name="outcome" className="field" defaultValue="conversation">
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {label(o)}
                  </option>
                ))}
              </select>
              <input name="minutes" type="number" min="0" step="0.5" placeholder="Minutes" className="field" />
            </div>
            <textarea name="notes" rows={3} className="field" placeholder="What was said: price, timeline, condition, next step…" />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                Recording (optional) <input type="file" name="audio" accept="audio/*" className="field max-w-56 py-1" />
              </label>
              <label className="flex items-center gap-1" title={canTranscribe ? "Paid per minute by your transcription provider" : "Transcription is off. Turn it on in Settings → Integrations."}>
                <input type="checkbox" name="transcribe" disabled={!canTranscribe} /> Transcribe the recording{!canTranscribe && <span className="text-xs text-muted"> (off)</span>}
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="analyse" defaultChecked /> Let AI read my notes
              </label>
              <input type="datetime-local" name="when" className="field w-auto py-1" title="When (leave blank for now)" />
            </div>
            <Submit className="btn btn-ghost btn-sm">Log call</Submit>
          </ActionForm>
        </details>
      )}

      {shown.length ? (
        <ul className="divide-y divide-line">
          {shown.map((i) => {
            const day = fmtDate(i.createdAt);
            const head = day !== lastDay;
            lastDay = day;
            const ai = i.channel === "call" && i.provider === "retell";
            const intel = (i.intel || {}) as { qa?: { score: number; flags: { rule: string; severity: string; quote: string }[] }; loggedBy?: string };
            const icon = i.channel === "call" ? (ai ? "🤖" : "📞") : i.channel === "sms" ? "💬" : i.channel === "email" ? "✉️" : i.channel === "note" ? "📝" : "⚙️";
            const kind = i.channel === "call" ? (ai ? `AI call${i.agentRole ? ` · ${roleLabel(i.agentRole)}` : ""}` : i.provider === "manual" ? "Call (logged)" : "Team call") : i.channel === "sms" ? "Text" : i.channel === "email" ? "Email" : i.channel === "note" ? "Note" : "System";
            const isTranscript = i.channel === "call" && i.body && !i.body.startsWith("Caller notes:");
            return (
              <li key={i.id} className="px-4 py-3 text-sm">
                {head && <div className="-mt-1 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{day}</div>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {icon} {kind} <span className="text-muted">{i.direction === "inbound" ? "← in" : i.direction === "outbound" ? "→ out" : ""}</span>
                    {i.contact && (
                      <>
                        {" · "}
                        <Link href={`/contacts/${i.contact.id}`} className="hover:text-brand">
                          {fullName(i.contact)}
                        </Link>
                        <span className="text-xs text-muted"> ({i.contact.kind})</span>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {i.status === "failed" && <span className="badge badge-bad mr-1">failed</span>}
                    {i.outcome && <span className="badge mr-1">{label(i.outcome)}</span>}
                    {i.transferred && <span className="badge badge-good mr-1">transferred</span>}
                    {i.durationSec ? `${Math.max(1, Math.round(i.durationSec / 60))} min · ` : ""}
                    {fmtDate(i.createdAt, true).split(", ").slice(-1)[0]}
                  </span>
                </div>
                {i.channel === "email" && (i.fromAddr || i.toAddr) && (
                  <div className="text-xs text-muted">
                    {i.direction === "inbound" ? `From ${i.fromAddr || "?"}` : `To ${i.toAddr || "?"}`}
                  </div>
                )}
                {i.subject && <div className="text-xs font-medium">{i.subject}</div>}
                {i.channel === "sms" && i.body ? (
                  <p className={`mt-1 inline-block max-w-xl rounded-2xl px-3 py-1.5 whitespace-pre-wrap ${i.direction === "inbound" ? "bg-soft" : "bg-brand-soft"}`}>{i.body}</p>
                ) : (
                  i.summary && <p className="mt-1 text-muted">{i.summary}</p>
                )}
                {i.channel !== "sms" && i.body && i.body !== i.summary && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">{isTranscript ? "Transcript" : i.channel === "email" ? "Full email" : i.channel === "call" ? "Notes" : "Full text"}</summary>
                    <pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-soft p-2 text-xs whitespace-pre-wrap">{i.body}</pre>
                  </details>
                )}
                {i.recordingUrl && <audio controls preload="none" src={i.recordingUrl} className="mt-2 h-8 w-full" />}
                {i.channel === "call" && !ai && i.recordingUrl && !isTranscript && (
                  <div className="mt-1 text-xs text-muted">
                    {canTranscribe ? (
                      writable && (
                        <ActionButton action={transcribeCallAction} hidden={{ interactionId: i.id }} className="underline">
                          Transcribe this call
                        </ActionButton>
                      )
                    ) : (
                      <>No transcript: team-call transcription is off (it&apos;s paid per minute). Turn it on in Settings → Integrations.</>
                    )}
                  </div>
                )}
                {ai && (i.tools.length > 0 || i.endReason) && (
                  <div className="mt-1 text-xs text-muted">
                    {i.tools.length > 0 && <>Used: {i.tools.map((t) => label(t)).join(", ")}</>}
                    {i.endReason && <> · ended: {label(i.endReason)}</>}
                  </div>
                )}
                {intel.loggedBy && <div className="mt-1 text-xs text-muted">Logged by {intel.loggedBy}</div>}
                {intel.qa && (
                  <div className={`mt-2 rounded-lg px-2 py-1 text-xs ${intel.qa.flags.some((f) => f.severity === "high") ? "bg-bad-soft text-bad" : "bg-soft text-muted"}`}>
                    Call quality {Math.round(intel.qa.score)}/100{intel.qa.flags.length ? ` · ${intel.qa.flags.map((f) => `${f.rule}: “${f.quote.slice(0, 60)}”`).join(" · ")}` : " · no rule issues"}
                  </div>
                )}
                {writable && ["call", "sms", "email"].includes(i.channel) && !i.processedAt && i.body && (
                  <ActionButton action={reprocessAction} hidden={{ interactionId: i.id }}>
                    Analyse
                  </ActionButton>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted">{ch === "all" ? "No conversations yet." : "Nothing of this kind yet."}</p>
      )}
      {more && (
        <div className="border-t border-line px-4 py-2 text-center text-sm">
          <Link href={href({ lim: String(take + 100) })} scroll={false} className="underline">
            Show older
          </Link>
        </div>
      )}
    </section>
  );
}
