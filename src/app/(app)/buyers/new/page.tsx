import { ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { pageCtx } from "@/lib/session";
import { createBuyerAction } from "../../../actions/records";

export default async function NewBuyer() {
  await pageCtx();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add a buyer" back={{ href: "/buyers", label: "Buyers" }} sub="Add the buy box and buying timeline on the next screen." />
      <Card>
        <ActionForm action={createBuyerAction}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="First name">
              <input name="firstName" className="field" />
            </Field>
            <Field label="Last name">
              <input name="lastName" className="field" />
            </Field>
            <Field label="Company">
              <input name="company" className="field" />
            </Field>
            <Field label="Phone">
              <input name="phone" type="tel" className="field" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="field" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input name="city" className="field" />
              </Field>
              <Field label="State">
                <input name="state" maxLength={2} className="field uppercase" />
              </Field>
            </div>
          </div>
          <Submit>Add buyer</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
