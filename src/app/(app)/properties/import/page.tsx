import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { CampaignChoice } from "@/components/listparts";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { getCompliance } from "@/lib/switches";
import { importSellerFileAction } from "../../../actions/leads";

export default async function ImportSellers() {
  const c = await pageCtx();
  const [campaigns, sw] = await Promise.all([
    db.campaign.findMany({ where: { workspaceId: c.workspace.id, kind: "seller", status: { in: ["draft", "running", "paused"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
    getCompliance(c.workspace.id),
  ]);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Upload a seller list" back={{ href: "/properties", label: "Sellers" }} sub="Export from PropStream or BatchLeads (or any spreadsheet saved as CSV) and upload it as it is. The columns are recognised for you." />
      <Card>
        <ActionForm action={importSellerFileAction}>
          <Field label="The file (.csv)">
            <input type="file" name="file" accept=".csv,text/csv" className="field" />
          </Field>
          <Field label="Name this list" hint="Optional. Shown on the campaign, e.g. Harris County absentee, October.">
            <input name="label" className="field" placeholder="Harris County absentee · Oct" />
          </Field>
          <details>
            <summary className="cursor-pointer text-sm text-muted">Or paste the rows instead</summary>
            <textarea name="csv" rows={5} className="field mt-2 font-mono text-xs" placeholder={"address,city,state,zip,first_name,last_name,phone,email\n123 Main St,Houston,TX,77001,Jane,Doe,7135550100,"} />
          </details>
          <CampaignChoice campaigns={campaigns} cold={sw.coldOutreach} />
          <Submit pendingText="Reading the list…">Upload</Submit>
        </ActionForm>
      </Card>
      <Notice tone="info">
        <b>What happens:</b> owners already on file are merged, not duplicated. Every phone number is checked against Do Not Call lists, numbers flagged as litigators are blocked for good, and the owner&apos;s mailing address is used for calling hours. Recognised automatically: PropStream (Owner 1/2 names, Mailing address, Est. value, Est. remaining balance, Phone 1–5), BatchLeads (Property address, Owner first/last name, Mailing address, Phone 1…, DNC flags), BatchData, and plain columns like address, city, state, zip, owner, phone, email.
      </Notice>
      <p className="text-sm text-muted">
        No file? <Link href="/properties/find" className="underline">Buy a list from BatchData</Link> by state and county instead.
      </p>
    </div>
  );
}
