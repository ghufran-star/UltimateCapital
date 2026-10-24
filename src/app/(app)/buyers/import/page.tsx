import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { CampaignChoice } from "@/components/listparts";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { getCompliance } from "@/lib/switches";
import { importBuyerFileAction } from "../../../actions/leads";

export default async function ImportBuyers() {
  const c = await pageCtx();
  const [campaigns, sw] = await Promise.all([
    db.campaign.findMany({ where: { workspaceId: c.workspace.id, kind: "buyer", status: { in: ["draft", "running", "paused"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
    getCompliance(c.workspace.id),
  ]);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Upload a buyer list" back={{ href: "/buyers", label: "Buyers" }} sub="A cash-buyer export from BatchLeads or PropStream, or any CSV of investors. Columns are recognised for you." />
      <Card>
        <ActionForm action={importBuyerFileAction}>
          <Field label="The file (.csv)">
            <input type="file" name="file" accept=".csv,text/csv" className="field" />
          </Field>
          <Field label="Name this list" hint="Optional">
            <input name="label" className="field" placeholder="San Antonio cash buyers · Oct" />
          </Field>
          <details>
            <summary className="cursor-pointer text-sm text-muted">Or paste the rows instead</summary>
            <textarea name="csv" rows={5} className="field mt-2 font-mono text-xs" placeholder={"first_name,last_name,company,phone,email,markets,states,max_price\nTom,Nguyen,Bayou Holdings,7135550105,tom@x.com,Houston|San Antonio,TX,300000"} />
          </details>
          <CampaignChoice campaigns={campaigns} cold={sw.coldOutreach} />
          <Submit pendingText="Reading the list…">Upload</Submit>
        </ActionForm>
      </Card>
      <Notice tone="info">A starting buy box is made from the markets, ZIPs and prices in the file (or from what they last bought). The buyer caller confirms it on the first call.</Notice>
      <p className="text-sm text-muted">
        No file? <Link href="/buyers/find" className="underline">Find recent cash buyers</Link> by state and county.
      </p>
    </div>
  );
}
