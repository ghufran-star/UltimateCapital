import type { TitleCompany } from "@prisma/client";
import { ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { Field } from "@/components/ui";
import { US_STATES } from "@/lib/catalog";
import { TITLE_CAPS } from "@/lib/titledir";
import { saveTitleCompanyAction } from "../../../actions/title";

const Tri = ({ name, v }: { name: string; v?: string | null }) => (
  <select name={name} defaultValue={v || ""} className="field">
    <option value="">Don&apos;t know yet</option>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select>
);

/** The full profile: identity, where they close, what they'll do, money handling. */
export function TitleProfileForm({ t, ro }: { t?: TitleCompany; ro: boolean }) {
  return (
    <ActionForm action={saveTitleCompanyAction}>
      {t && <input type="hidden" name="titleCompanyId" value={t.id} />}
      <input type="hidden" name="profileForm" value="1" />
      <fieldset disabled={ro} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Name">
            <input name="name" defaultValue={t?.name} className="field" required />
          </Field>
          <Field label="Status" hint="Preferred ones are suggested first; Avoid stops them being suggested.">
            <select name="status" defaultValue={t?.status || "active"} className="field">
              <option value="preferred">Preferred</option>
              <option value="active">Active</option>
              <option value="avoid">Avoid</option>
            </select>
          </Field>
          <Field label="Main state">
            <Combo name="state" options={US_STATES} defaultValue={t?.state} emptyLabel="None" placeholder="Search states" />
          </Field>
          <Field label="Email (contract packages go here)">
            <input name="email" type="email" defaultValue={t?.email ?? ""} className="field" />
          </Field>
          <Field label="Main phone">
            <input name="phone" defaultValue={t?.phone ?? ""} className="field" />
          </Field>
          <Field label="Website">
            <input name="website" defaultValue={t?.website ?? ""} className="field" placeholder="https://" />
          </Field>
          <Field label="Street address">
            <input name="address" defaultValue={t?.address ?? ""} className="field" />
          </Field>
          <Field label="City">
            <input name="city" defaultValue={t?.city ?? ""} className="field" />
          </Field>
          <Field label="ZIP">
            <input name="zip" defaultValue={t?.zip ?? ""} className="field" />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="States they close in">
            <Combo name="states" options={US_STATES} defaultValue={t?.states} multiple joined placeholder="Search states" />
          </Field>
          <Field label="States where they close through an attorney" hint="Common in GA, NC, SC, NY, MA, CT and others.">
            <Combo name="attorneyStates" options={US_STATES} defaultValue={t?.attorneyStates} multiple joined placeholder="Search states" />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">What they&apos;ll do</div>
          <div className="grid gap-3 md:grid-cols-5">
            {TITLE_CAPS.map((x) => (
              <Field key={x.key} label={x.label}>
                <Tri name={x.key} v={t?.[x.key]} />
              </Field>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Earnest money handling" hint="Who holds it, how it's paid, how fast it's receipted.">
            <input name="emdHandling" defaultValue={t?.emdHandling ?? ""} className="field" placeholder="Held in escrow, wire or cashier's cheque, receipt same day" />
          </Field>
          <Field label="Fees">
            <input name="fees" defaultValue={t?.fees ?? ""} className="field" placeholder="Escrow $500, assignment fee $0, double close $350" />
          </Field>
          <Field label="Turnaround">
            <input name="turnaround" defaultValue={t?.turnaround ?? ""} className="field" placeholder="Commitment in 3–5 business days" />
          </Field>
          <Field label="Underwriters" hint="Comma separated.">
            <input name="underwriters" defaultValue={t?.underwriters.join(", ") ?? ""} className="field" />
          </Field>
          <Field label="Licence number">
            <input name="licenseNo" defaultValue={t?.licenseNo ?? ""} className="field" />
          </Field>
          <Field label="Licensed in">
            <Combo name="licenseState" options={US_STATES} defaultValue={t?.licenseState} emptyLabel="None" placeholder="Search states" />
          </Field>
        </div>
        <Field label="Known phone number for wire checks" hint="From their website or a past closing — never from an email. Changing it clears the confirmation below.">
          <input name="wireVerifiedPhone" defaultValue={t?.wireVerifiedPhone ?? ""} className="field max-w-sm" />
        </Field>
        <Field label="Notes">
          <textarea name="notes" defaultValue={t?.notes ?? ""} className="field min-h-20" />
        </Field>
      </fieldset>
      {!ro && <Submit>{t ? "Save profile" : "Add title company"}</Submit>}
    </ActionForm>
  );
}

type Person = { name?: string; role?: string; email?: string; phone?: string };
type Office = { label?: string; address?: string; city?: string; state?: string; phone?: string };

/** The people there: escrow officers, closers, processors. */
export function PeopleForm({ t, ro }: { t: TitleCompany; ro: boolean }) {
  const people = ((t.contacts || []) as Person[]).concat(ro ? [] : [{}, {}]);
  return (
    <ActionForm action={saveTitleCompanyAction}>
      <input type="hidden" name="titleCompanyId" value={t.id} />
      <input type="hidden" name="contactsForm" value="1" />
      <fieldset disabled={ro} className="space-y-2">
        {people.length === 0 && <p className="text-sm text-muted">No people added.</p>}
        {people.map((p, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-4">
            <input name="cName" defaultValue={p.name} placeholder="Name" className="field" />
            <input name="cRole" defaultValue={p.role} placeholder="Role (escrow officer, closer…)" className="field" />
            <input name="cEmail" defaultValue={p.email} placeholder="Email" className="field" />
            <input name="cPhone" defaultValue={p.phone} placeholder="Direct phone" className="field" />
          </div>
        ))}
      </fieldset>
      {!ro && <Submit className="btn btn-ghost">Save people</Submit>}
      {!ro && <p className="text-xs text-muted">Clear a row to remove that person. Save to get more empty rows.</p>}
    </ActionForm>
  );
}

export function OfficesForm({ t, ro }: { t: TitleCompany; ro: boolean }) {
  const offices = ((t.offices || []) as Office[]).concat(ro ? [] : [{}]);
  return (
    <ActionForm action={saveTitleCompanyAction}>
      <input type="hidden" name="titleCompanyId" value={t.id} />
      <input type="hidden" name="officesForm" value="1" />
      <fieldset disabled={ro} className="space-y-2">
        {offices.length === 0 && <p className="text-sm text-muted">No branch offices added.</p>}
        {offices.map((o, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-5">
            <input name="oLabel" defaultValue={o.label} placeholder="Office (e.g. Downtown)" className="field" />
            <input name="oAddress" defaultValue={o.address} placeholder="Address" className="field" />
            <input name="oCity" defaultValue={o.city} placeholder="City" className="field" />
            <input name="oState" defaultValue={o.state} placeholder="State" maxLength={2} className="field" />
            <input name="oPhone" defaultValue={o.phone} placeholder="Phone" className="field" />
          </div>
        ))}
      </fieldset>
      {!ro && <Submit className="btn btn-ghost">Save offices</Submit>}
    </ActionForm>
  );
}
