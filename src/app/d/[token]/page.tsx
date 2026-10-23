import { ActionForm, Submit } from "@/components/client";
import { portalView } from "@/lib/portal";
import { label } from "@/lib/stages";
import { usd } from "@/lib/util";
import { portalAction, portalPofAction } from "../../actions/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal", robots: { index: false } };

export default async function DealPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await portalView(token);
  if (!d) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-xl font-semibold">This deal link isn&apos;t active</h1>
        <p className="mt-2 text-muted">Reply to our message and we&apos;ll send you what&apos;s available now.</p>
      </main>
    );
  }
  const p = d.opp.property;
  const code = d.opp.id.slice(-4).toUpperCase();
  const answered = !!d.it.respondedAt;
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <div>
        <div className="text-sm text-muted">
          {d.company || "Off-market deal"} · deal {code}
        </div>
        <h1 className="text-2xl font-semibold">{d.anonymous ? `${label(p.propertyType)} in ${p.city} ${p.zip}` : `${p.address}, ${p.city} ${p.state} ${p.zip}`}</h1>
        <p className="text-sm text-muted">
          For {d.it.contact.firstName || "you"}
          {d.anonymous ? " · address shared once we're under contract" : ""}
        </p>
      </div>
      {d.closed && <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">This deal is no longer available. We&apos;ll send you the next one that fits.</div>}
      {d.photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {d.photos.map((ph) => (
            <img key={ph.id} src={`/api/portal/${token}/photo/${ph.id}`} alt={ph.name} className="aspect-[4/3] w-full rounded-lg object-cover" />
          ))}
        </div>
      )}
      <section className="card grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-3">
        <Fact l="Beds / baths" v={`${p.beds ?? "?"} / ${p.baths ?? "?"}`} />
        <Fact l="Size" v={p.sqft ? `${p.sqft.toLocaleString()} sq ft` : "?"} />
        <Fact l="Built" v={p.yearBuilt ? String(p.yearBuilt) : "?"} />
        <Fact l="Condition" v={label(p.conditionTier) || "?"} />
        <Fact l="Occupancy" v={label(p.occupancy) || "?"} />
        <Fact l="Type" v={label(p.propertyType)} />
        <Fact l="ARV (estimate)" v={usd(d.calc?.arv)} />
        <Fact l="Repairs (estimate)" v={d.v?.repairsLikely ? `${usd(d.v.repairsLow)} – ${usd(d.v.repairsHigh)}` : "?"} />
        <Fact l="Price" v={usd(d.price)} strong />
        {d.iv && <Fact l="Your est. profit" v={`${usd(d.iv.net)} net (${Math.round(d.iv.netPct * 100)}%)`} />}
      </section>
      <p className="text-xs text-muted">Estimates are ours, not guarantees. Do your own due diligence.{d.disclosure ? ` ${d.disclosure}` : ""}</p>
      {!d.closed && (
        <>
          {answered && <div className="rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand">We have your reply ({label(d.it.stage)}). You can still update it below.</div>}
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">I want it</h2>
            <ActionForm action={portalAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="kind" value="offer" />
              <div className="grid grid-cols-2 gap-2">
                <input name="price" className="field tnum" inputMode="numeric" placeholder="Your price" defaultValue={d.price ?? ""} />
                <input name="closeDays" className="field" inputMode="numeric" placeholder="Close in (days)" />
              </div>
              <input name="note" className="field" placeholder="Anything else (financing, terms)" />
              <Submit className="btn btn-primary w-full">Send offer</Submit>
            </ActionForm>
          </section>
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">See it first</h2>
            <ActionForm action={portalAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="kind" value="walkthrough" />
              <input name="when" className="field" placeholder="When suits you? e.g. Tue afternoon" />
              <Submit className="btn btn-ghost w-full">Request a walkthrough</Submit>
            </ActionForm>
          </section>
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Proof of funds</h2>
            <ActionForm action={portalPofAction} resetOnOk>
              <input type="hidden" name="token" value={token} />
              <input type="file" name="file" accept=".pdf,image/*" className="field" />
              <Submit className="btn btn-ghost w-full">Upload</Submit>
            </ActionForm>
          </section>
          <ActionForm action={portalAction} className="text-center">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="kind" value="pass" />
            <input name="note" className="field mb-2" placeholder="Not for me because… (helps us send better deals)" />
            <Submit className="btn btn-ghost btn-sm">Pass on this one</Submit>
          </ActionForm>
        </>
      )}
    </main>
  );
}

function Fact({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{l}</div>
      <div className={strong ? "text-lg font-semibold text-brand" : "font-medium"}>{v}</div>
    </div>
  );
}
