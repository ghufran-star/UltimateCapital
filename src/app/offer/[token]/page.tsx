import { ActionForm, Submit } from "@/components/client";
import { setting } from "@/lib/config";
import type { LetterFields } from "@/lib/offerletter";
import { offerByToken } from "@/lib/offerletter";
import { fmtDate, usd } from "@/lib/util";
import { sellerCounterAction, sellerReadyAction } from "../../actions/offers";
import { ViewBeacon } from "./beacon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your offer", robots: { index: false } };

export default async function OfferPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { token } = await params;
  const preview = Boolean((await searchParams).preview);
  const o = await offerByToken(token);
  if (!o || !o.letter) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This offer link isn&apos;t valid</h1>
        <p className="mt-2 text-muted">Please contact the person who sent it for a new link.</p>
      </Shell>
    );
  }
  const f = o.letter as unknown as LetterFields;
  const company = f.companyName || (await setting(o.opportunity.workspaceId, "COMPANY_NAME")) || "UltimateCapital";
  const expired = o.expiresAt ? o.expiresAt < new Date() : false;
  const done = o.status === "accepted";
  const pdf = `/api/offer/${token}/pdf${preview ? "?preview=1" : ""}`;
  return (
    <Shell>
      {!preview && <ViewBeacon token={token} />}
      {preview && <p className="mb-4 rounded-lg bg-soft px-3 py-2 text-xs text-muted">Preview of the seller&apos;s page: opening it here isn&apos;t counted as the seller viewing it, and the buttons below would act as the seller.</p>}
      <div className="text-sm text-muted">{company}</div>
      <h1 className="text-2xl font-semibold">Our cash offer for {o.opportunity.property.address}</h1>
      <p className="mt-1 text-sm text-muted">For {f.sellerName}</p>

      <div className="card mt-5 p-5">
        <div className="text-xs text-muted">Offer price</div>
        <div className="text-4xl font-semibold text-brand tnum">{usd(o.price)}</div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Closing</dt>
            <dd>About {f.closingDays} days, or when suits you</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Condition</dt>
            <dd>{f.asIs ? "As-is, no repairs" : "Subject to inspection"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Earnest money</dt>
            <dd>{usd(f.emd)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Agent fees</dt>
            <dd>None</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Offer good until</dt>
            <dd className={expired ? "text-bad" : ""}>{fmtDate(o.expiresAt)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a href={pdf} target="_blank" className="btn btn-ghost">
            View the letter (PDF)
          </a>
          <a href={`${pdf}${preview ? "&" : "?"}download=1`} className="btn btn-ghost">
            Download
          </a>
        </div>
      </div>

      {done ? (
        <div className="card mt-5 p-5">
          <h2 className="font-semibold">You&apos;re ready to proceed ✓</h2>
          <p className="mt-1 text-sm text-muted">Thank you. We&apos;ll send the purchase agreement for you to review and sign. Nothing is binding until you sign it.</p>
        </div>
      ) : expired ? (
        <div className="card mt-5 p-5">
          <h2 className="font-semibold">This offer has expired</h2>
          <p className="mt-1 text-sm text-muted">Reply to our message and we&apos;ll send you an updated offer.</p>
        </div>
      ) : (
        <>
          <div className="card mt-5 p-5">
            <h2 className="font-semibold">Happy with the offer?</h2>
            <p className="mt-1 text-sm text-muted">Let us know and we&apos;ll send the purchase agreement for you to review. Pressing this doesn&apos;t commit you to anything.</p>
            <ActionForm action={sellerReadyAction} className="mt-3 space-y-2">
              <input type="hidden" name="token" value={token} />
              <input name="message" className="field" placeholder="Anything we should know? (optional, e.g. best closing date)" />
              <Submit>Ready to proceed</Submit>
            </ActionForm>
          </div>
          <div className="card mt-5 p-5">
            <h2 className="font-semibold">Questions, or a different number in mind?</h2>
            <ActionForm action={sellerCounterAction} className="mt-3 space-y-2" resetOnOk>
              <input type="hidden" name="token" value={token} />
              <input name="price" className="field tnum" inputMode="numeric" placeholder="Price you'd accept (optional)" />
              <textarea name="message" rows={3} className="field" placeholder="Your question or message" />
              <Submit className="btn btn-ghost">Send to {company}</Submit>
            </ActionForm>
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-muted">This is a non-binding offer, not a contract. Only a purchase agreement signed by both parties is binding.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">{children}</main>;
}
