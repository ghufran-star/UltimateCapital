import { headers } from "next/headers";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { SignaturePad } from "@/components/signature";
import { setting } from "@/lib/config";
import { needsSignCode, recordView, signerByToken } from "@/lib/contracts";
import { fmtDate } from "@/lib/util";
import { declineAction, sendCodeAction, signAction } from "../../actions/sign";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review and sign", robots: { index: false } };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await signerByToken(token);
  if (!s) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-muted">Signing links last 14 days. Please ask the sender for a new one.</p>
      </Shell>
    );
  }
  const h = await headers();
  await recordView(s.id, h.get("x-forwarded-for")?.split(",")[0] || "", h.get("user-agent") || "");
  const company = (await setting(s.contract.workspaceId, "COMPANY_NAME")) || "UltimateCapital";
  const f = s.contract.fields as Record<string, string>;
  const tpl = s.contract.sourcePdf && s.contract.templateId ? await db.contractTemplate.findUnique({ where: { id: s.contract.templateId }, select: { placements: true } }) : null;
  const placed = ((tpl?.placements || []) as { kind: string; role?: string }[]).filter((p) => p.role === s.role);
  const needsInitials = s.contract.body.includes(`[[initial:${s.role}]]`) || placed.some((p) => p.kind === "initial");
  const parts = s.contract.body.split(/(\[\[(?:sign|initial):[a-z0-9_]+\]\])/g);
  const closed = ["terminated", "expired", "declined"].includes(s.contract.status) || s.status === "declined";
  const needCode = needsSignCode(s) && !s.otpVerifiedAt;
  return (
    <Shell>
      <div className="mb-4">
        <div className="text-sm text-muted">{company}</div>
        <h1 className="text-xl font-semibold">{s.contract.title || (f.property_address ? `Agreement for ${f.property_address}` : "Agreement")}</h1>
        <p className="text-sm text-muted">
          For {s.name} · please read the full agreement before signing.
        </p>
      </div>
      {s.contract.sourcePdf ? (
        <div className="space-y-2">
          <iframe src={`/api/sign/${token}/pdf`} className="h-[70vh] w-full rounded-xl border border-line bg-white" title="Agreement" />
          <a href={`/api/sign/${token}/pdf`} target="_blank" className="text-sm text-brand underline">
            Open the agreement in a new tab
          </a>
        </div>
      ) : (
      <article className="card max-h-[60vh] overflow-y-auto p-5 text-sm leading-relaxed whitespace-pre-wrap">
        {parts.map((p, i) => {
          const m = /\[\[(sign|initial):([a-z0-9_]+)\]\]/.exec(p);
          if (!m) return <span key={i}>{p}</span>;
          const mine = m[2] === s.role;
          return (
            <span key={i} className={`my-1 inline-block rounded-md border border-dashed px-3 py-1 text-xs ${mine ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>
              {m[1] === "sign" ? "Signature" : "Initials"}: {mine ? "you" : m[2]}
            </span>
          );
        })}
      </article>
      )}
      {s.status === "signed" ? (
        <div className="mt-5 rounded-xl bg-brand-soft p-4 text-brand">You signed this on {fmtDate(s.signedAt, true)}. Thank you.</div>
      ) : closed ? (
        <div className="mt-5 rounded-xl bg-bad-soft p-4 text-bad">This agreement is no longer open for signing.</div>
      ) : (
        <ActionForm action={signAction} className="card mt-5 space-y-4 p-5">
          <input type="hidden" name="token" value={token} />
          {needCode && (
            <div className="space-y-2 rounded-xl bg-soft p-3">
              <p className="text-sm">To confirm it&apos;s you, we&apos;ll send a 6-digit code to your {s.phone ? `phone ending ${s.phone.slice(-4)}` : "email"}.</p>
              <div className="flex gap-2">
                <input name="code" className="field w-36 tnum" inputMode="numeric" maxLength={6} placeholder="Code" autoComplete="one-time-code" />
              </div>
            </div>
          )}
          <SignaturePad defaultTyped={s.name} />
          {needsInitials && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">Initials</span>
              <input name="initials" className="field w-32 uppercase" maxLength={5} required />
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent" className="mt-1" required />
            <span>I have read the agreement, I agree to use electronic records and signatures, and I intend my electronic signature to have the same effect as a handwritten one. I can ask for a paper copy at no cost.</span>
          </label>
          <Submit pendingText="Signing…">Sign agreement</Submit>
        </ActionForm>
      )}
      {!closed && s.status !== "signed" && (
        <div className="mt-4 space-y-3">
          {needCode && (
            <ActionButton action={sendCodeAction} hidden={{ token }} className="btn btn-ghost w-full">
              Send me a code
            </ActionButton>
          )}
          <details className="card p-4">
            <summary className="cursor-pointer text-sm text-muted">I don&apos;t want to sign / I need changes</summary>
            <ActionForm action={declineAction} className="mt-3 space-y-2">
              <input type="hidden" name="token" value={token} />
              <textarea name="reason" rows={3} className="field" placeholder="What would you like changed, or why not?" />
              <Submit className="btn btn-ghost">Send</Submit>
            </ActionForm>
          </details>
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted">Secured signing · your IP address, device and the time are recorded on the certificate of completion.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">{children}</main>;
}
