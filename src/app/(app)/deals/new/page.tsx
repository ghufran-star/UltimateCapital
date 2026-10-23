import { ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { Card, Field, PageHeader } from "@/components/ui";
import { CONDITION_TIERS, DEAL_TYPES, EXIT_STRATEGIES, LEAD_SOURCES, OCCUPANCY, OWNER_TYPES, PROPERTY_TYPES, SITUATIONS, US_STATES } from "@/lib/catalog";
import { pageCtx } from "@/lib/session";
import { createPropertyAction } from "../../../actions/records";

export default async function NewDeal() {
  await pageCtx();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a deal" back={{ href: "/deals", label: "Deals" }} sub="Property and seller. The valuation runs once condition and size are known." />
      <ActionForm action={createPropertyAction} className="space-y-5">
        <Card title="Property">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Street address">
                <input name="address" className="field" required />
              </Field>
            </div>
            <Field label="City">
              <input name="city" className="field" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State">
                <Combo name="state" options={US_STATES} defaultValue="TX" placeholder="Search states" />
              </Field>
              <Field label="ZIP">
                <input name="zip" className="field" required inputMode="numeric" />
              </Field>
            </div>
            <Field label="County">
              <input name="county" className="field" />
            </Field>
            <Field label="Property type">
              <Combo name="propertyType" options={PROPERTY_TYPES} defaultValue="sfr" placeholder="Search types" />
            </Field>
            <div className="grid grid-cols-3 gap-3 md:col-span-2">
              <Field label="Beds">
                <input name="beds" className="field" inputMode="decimal" />
              </Field>
              <Field label="Baths">
                <input name="baths" className="field" inputMode="decimal" />
              </Field>
              <Field label="Living area (sq ft)">
                <input name="sqft" className="field" inputMode="numeric" />
              </Field>
            </div>
            <Field label="Year built">
              <input name="yearBuilt" className="field" inputMode="numeric" />
            </Field>
            <Field label="Lot size (acres)">
              <input name="lotAcres" className="field" inputMode="decimal" />
            </Field>
            <Field label="Occupancy">
              <Combo name="occupancy" options={OCCUPANCY} emptyLabel="Unknown" placeholder="Unknown" />
            </Field>
            <Field label="Rehab needed" hint="Refine item by item later on the deal.">
              <Combo name="conditionTier" options={CONDITION_TIERS} emptyLabel="Unknown" placeholder="Unknown" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Seller situation" hint="Pick all that apply: pre-foreclosure, probate, tired landlord…">
                <Combo name="situations" options={SITUATIONS} multiple placeholder="Search situations" />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Owner and equity">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="First name">
              <input name="firstName" className="field" />
            </Field>
            <Field label="Last name">
              <input name="lastName" className="field" />
            </Field>
            <Field label="Phone">
              <input name="phone" className="field" type="tel" />
            </Field>
            <Field label="Email">
              <input name="email" className="field" type="email" />
            </Field>
            <Field label="Owner type">
              <Combo name="ownerType" options={OWNER_TYPES} emptyLabel="Unknown" placeholder="Unknown" />
            </Field>
            <Field label="Absentee owner?">
              <select name="absentee" className="field">
                <option value="">Unknown</option>
                <option value="yes">Yes: lives elsewhere</option>
                <option value="no">No: lives at the property</option>
              </select>
            </Field>
            <Field label="Estimated value (as-is)">
              <input name="estValue" className="field tnum" inputMode="numeric" />
            </Field>
            <Field label="Mortgage balance (estimate)">
              <input name="loanBalance" className="field tnum" inputMode="numeric" />
            </Field>
            <Field label="Asking price">
              <input name="askingPrice" className="field tnum" inputMode="numeric" />
            </Field>
          </div>
        </Card>
        <Card title="Deal">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Deal type">
              <Combo name="dealType" options={DEAL_TYPES} defaultValue="assignment" />
            </Field>
            <Field label="Investor exit">
              <Combo name="exitStrategy" options={EXIT_STRATEGIES} defaultValue="flip" />
            </Field>
            <Field label="Lead source">
              <Combo name="leadSource" options={LEAD_SOURCES} emptyLabel="Unknown" placeholder="Where did this lead come from?" />
            </Field>
          </div>
        </Card>
        <Submit>Create deal</Submit>
      </ActionForm>
    </div>
  );
}
