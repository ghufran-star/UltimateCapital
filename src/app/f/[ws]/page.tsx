import { ActionForm, Submit } from "@/components/client";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { consentText } from "@/lib/leadform";
import { STATES } from "@/lib/states";
import { leadFormAction } from "../../actions/leadform";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get a cash offer" };

export default async function LeadForm({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { ws } = await params;
  const embed = Boolean((await searchParams).embed);
  const w = await db.workspace.findUnique({ where: { id: ws }, select: { id: true, name: true } });
  if (!w) return <main className="mx-auto max-w-md px-4 py-12 text-muted">This form isn&apos;t available.</main>;
  const company = (await setting(ws, "COMPANY_NAME")) || w.name;
  const state = (await db.statePack.findFirst({ where: { workspaceId: ws, status: "active" }, select: { state: true } }))?.state || "TX";
  return (
    <main className={`mx-auto max-w-lg px-4 ${embed ? "py-4" : "min-h-dvh py-10"}`}>
      {!embed && <div className="text-sm text-muted">{company}</div>}
      <h1 className="text-2xl font-semibold">Get a fair cash offer</h1>
      <p className="mt-1 text-sm text-muted">As-is, no repairs, no agent fees. You pick the closing date.</p>
      <div className="card mt-5 p-5">
        <ActionForm action={leadFormAction} resetOnOk>
          <input type="hidden" name="ws" value={w.id} />
          <input type="hidden" name="t" value={Date.now()} />
          <input type="hidden" name="page" value={`/f/${w.id}`} />
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              First name
              <input name="firstName" required className="field mt-1" autoComplete="given-name" />
            </label>
            <label className="text-sm">
              Last name
              <input name="lastName" className="field mt-1" autoComplete="family-name" />
            </label>
          </div>
          <label className="block text-sm">
            Mobile phone
            <input name="phone" type="tel" className="field mt-1" autoComplete="tel" inputMode="tel" />
          </label>
          <label className="block text-sm">
            Email
            <input name="email" type="email" className="field mt-1" autoComplete="email" />
          </label>
          <label className="block text-sm">
            Property address
            <input name="address" required className="field mt-1" autoComplete="street-address" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              City
              <input name="city" required className="field mt-1" />
            </label>
            <label className="text-sm">
              State
              <select name="state" defaultValue={state} className="field mt-1">
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              ZIP
              <input name="zip" required className="field mt-1" inputMode="numeric" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Price in mind (optional)
              <input name="askingPrice" className="field mt-1" inputMode="numeric" placeholder="$" />
            </label>
            <label className="text-sm">
              When do you want to sell?
              <select name="timeline" className="field mt-1">
                <option value="">Choose…</option>
                <option>As soon as possible</option>
                <option>Within 30 days</option>
                <option>1–3 months</option>
                <option>3+ months</option>
                <option>Just exploring</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Condition
            <select name="condition" className="field mt-1">
              <option value="">Choose…</option>
              <option value="cosmetic">Good: needs little or nothing</option>
              <option value="moderate">Needs some updates</option>
              <option value="heavy">Needs major repairs</option>
              <option value="gut">Needs a full rebuild</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" name="consent" className="mt-0.5" />
            <span>{consentText(company)}</span>
          </label>
          <Submit pendingText="Sending…">Get my cash offer</Submit>
        </ActionForm>
      </div>
    </main>
  );
}
