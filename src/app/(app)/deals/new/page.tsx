import { ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { CONDITION_TIERS, DEAL_TYPES, EXITS, PROPERTY_TYPES } from "@/lib/rules";
import { pageCtx } from "@/lib/session";
import { STATES } from "@/lib/states";
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
                <select name="state" className="field" required defaultValue="TX">
                  {STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ZIP">
                <input name="zip" className="field" required inputMode="numeric" />
              </Field>
            </div>
            <Field label="County">
              <input name="county" className="field" />
            </Field>
            <Field label="Property type">
              <select name="propertyType" className="field">
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3 md:col-span-2">
              <Field label="Beds">
                <input name="beds" className="field" inputMode="decimal" />
              </Field>
              <Field label="Baths">
                <input name="baths" className="field" inputMode="decimal" />
              </Field>
              <Field label="Sq ft">
                <input name="sqft" className="field" inputMode="numeric" />
              </Field>
            </div>
            <Field label="Year built">
              <input name="yearBuilt" className="field" inputMode="numeric" />
            </Field>
            <Field label="Occupancy">
              <select name="occupancy" className="field">
                <option value="">Unknown</option>
                <option value="vacant">Vacant</option>
                <option value="owner">Owner-occupied</option>
                <option value="tenant">Tenant</option>
              </select>
            </Field>
            <Field label="Overall condition" hint="Refine item by item later on the deal.">
              <select name="conditionTier" className="field">
                <option value="">Unknown</option>
                {CONDITION_TIERS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Seller">
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
            <Field label="Asking price">
              <input name="askingPrice" className="field" inputMode="numeric" />
            </Field>
          </div>
        </Card>
        <Card title="Deal">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Deal type">
              <select name="dealType" className="field">
                {DEAL_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Investor exit">
              <select name="exitStrategy" className="field">
                {EXITS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
        <Submit>Create deal</Submit>
      </ActionForm>
    </div>
  );
}
