import { ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { importSellersAction } from "../../../actions/records";

export default async function ImportSellers() {
  const c = await pageCtx();
  const campaigns = await db.campaign.findMany({ where: { workspaceId: c.workspace.id, kind: "seller" }, orderBy: { createdAt: "desc" } });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Import sellers" back={{ href: "/properties", label: "Sellers & properties" }} sub="A CSV from your list provider or skip-trace. Duplicates (same phone, or same address and ZIP) are merged." />
      <Card>
        <ActionForm action={importSellersAction}>
          <Field label="CSV file">
            <input type="file" name="file" accept=".csv,text/csv" className="field" />
          </Field>
          <Field label="…or paste CSV">
            <textarea name="csv" rows={6} className="field font-mono text-xs" placeholder={"address,city,state,zip,first_name,last_name,phone,email,beds,baths,sqft,condition\n123 Main St,Houston,TX,77001,Jane,Doe,7135550100,,3,2,1400,moderate"} />
          </Field>
          <Field label="Add to campaign (optional)">
            <select name="campaignId" className="field">
              <option value="">No campaign</option>
              {campaigns.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Submit pendingText="Importing…">Import</Submit>
        </ActionForm>
      </Card>
      <Notice tone="info">
        Columns recognised: address, city, state, zip, county, property_type, beds, baths, sqft, year_built, occupancy, condition, first_name, last_name (or owner), phone, phone2, email, tags. Every number is checked against your DNC lists and State Pack rules before anyone is contacted.
      </Notice>
    </div>
  );
}
