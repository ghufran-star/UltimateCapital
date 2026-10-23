import { ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { pageCtx } from "@/lib/session";
import { importBuyersAction } from "../../../actions/records";

export default async function ImportBuyers() {
  await pageCtx();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Import buyers" back={{ href: "/buyers", label: "Buyers" }} />
      <Card>
        <ActionForm action={importBuyersAction}>
          <Field label="CSV file">
            <input type="file" name="file" accept=".csv,text/csv" className="field" />
          </Field>
          <Field label="…or paste CSV">
            <textarea name="csv" rows={6} className="field font-mono text-xs" placeholder={"first_name,last_name,company,phone,email,markets,states,max_price,strategy,max_condition\nTom,Nguyen,Bayou Holdings,7135550105,tom@x.com,Houston|San Antonio,TX,300000,flip,gut"} />
          </Field>
          <Submit pendingText="Importing…">Import</Submit>
        </ActionForm>
      </Card>
      <Notice tone="info">Columns: first_name, last_name (or name), company, phone, email, city, state, markets (use | between cities), states, zips, property_types, strategy, min_price, max_price, max_condition. A buy box is created when market or price columns are present.</Notice>
    </div>
  );
}
