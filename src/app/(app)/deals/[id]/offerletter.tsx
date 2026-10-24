"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { LetterFields } from "@/lib/offerletter";
import { sendOfferLetterAction } from "../../../actions/offers";

function L({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{l}</span>
      {children}
    </label>
  );
}

/** The written offer letter: every field editable, a live PDF preview, then send by email (attached) and text (link). */
export function OfferLetterForm({ opportunityId, d, canOverride, hasEmail, hasPhone }: { opportunityId: string; d: LetterFields; canOverride: boolean; hasEmail: boolean; hasPhone: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, run, pending] = useActionState(sendOfferLetterAction, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const preview = () => {
    if (!ref.current) return;
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(ref.current).entries()) if (typeof v === "string" && k !== "send" && k !== "opportunityId") q.set(k, v);
    window.open(`/api/offers/preview/${opportunityId}?${q}`, "_blank");
  };
  return (
    <form ref={ref} action={run} className="space-y-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="letterForm" value="1" />
      <div className="grid gap-3 md:grid-cols-4">
        <L l="Offer price">
          <input name="price" defaultValue={d.price || ""} className="field tnum" inputMode="numeric" required />
        </L>
        <L l="Close in (days)">
          <input name="closingDays" defaultValue={d.closingDays} className="field tnum" inputMode="numeric" />
        </L>
        <L l="Earnest money">
          <input name="emd" defaultValue={d.emd} className="field tnum" inputMode="numeric" />
        </L>
        <L l="Inspection (days)">
          <input name="inspectionDays" defaultValue={d.inspectionDays} className="field tnum" inputMode="numeric" />
        </L>
        <L l="Closing costs">
          <select name="closingCosts" defaultValue={d.closingCosts} className="field">
            <option value="buyer">We pay them all</option>
            <option value="customary">Customary for the county</option>
            <option value="split">Split 50/50</option>
          </select>
        </L>
        <L l="Offer good for (days)">
          <input name="expiresDays" defaultValue={d.expiresDays} className="field tnum" inputMode="numeric" />
        </L>
        <L l="Seller name on the letter">
          <input name="sellerName" defaultValue={d.sellerName} className="field" />
        </L>
        <L l="Your phone on the letter">
          <input name="fromPhone" defaultValue={d.fromPhone} className="field" />
        </L>
      </div>
      <L l="Property">
        <input name="propertyAddress" defaultValue={d.propertyAddress} className="field" />
      </L>
      <L l="Opening note">
        <textarea name="note" defaultValue={d.note} rows={2} className="field" />
      </L>
      <L l="Other terms (optional)">
        <textarea name="extraTerms" defaultValue={d.extraTerms} rows={2} className="field" placeholder="e.g. Seller may stay 2 weeks after closing rent-free; we'll handle the junk removal." />
      </L>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" name="asIs" defaultChecked={d.asIs} /> As-is
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="send" value="email" defaultChecked={hasEmail} disabled={!hasEmail} /> Email the PDF{!hasEmail && <span className="text-xs text-muted"> (no email on file)</span>}
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="send" value="sms" defaultChecked={hasPhone} disabled={!hasPhone} /> Text the link{!hasPhone && <span className="text-xs text-muted"> (no phone)</span>}
        </label>
        {canOverride && (
          <label className="flex items-center gap-1 text-warn">
            <input type="checkbox" name="confirmOver" /> I&apos;m overriding the max buy
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={preview} className="btn btn-ghost">
          Preview PDF
        </button>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send offer letter"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-brand">{state.message}</p>}
      <p className="text-xs text-muted">The seller gets the PDF attached to an email and a private link by text. You&apos;ll see when they open it, and they can press &quot;Ready to proceed&quot; or send a counter.</p>
    </form>
  );
}
