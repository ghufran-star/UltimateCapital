import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { pageCtx } from "@/lib/session";
import { findBuyersAction } from "../../../actions/leads";

export default async function FindBuyers() {
  const c = await pageCtx();
  const s = await loadSettings(c.workspace.id);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/buyers", label: "Buyers" }} title="Find cash buyers" sub="People and companies who recently bought with cash in a market become buyers, each with a starting buy box built from what they bought." />
      {!s.PROPERTY_DATA_PROVIDER && (
        <Notice>
          Connect a property data provider in <Link href="/settings/integrations" className="underline">Settings → Integrations → Data</Link> first.
        </Notice>
      )}
      <Card>
        <ActionForm action={findBuyersAction}>
          <Field label="Market" hint="City and state, county, or ZIP.">
            <input name="query" className="field" placeholder="San Antonio, TX" />
          </Field>
          <Field label="Recent cash purchases to look at">
            <input name="take" defaultValue={100} className="field" inputMode="numeric" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trace" defaultChecked /> Skip-trace buyers for phones and emails
          </label>
          <Submit pendingText="Searching…">Find cash buyers</Submit>
        </ActionForm>
      </Card>
      <Notice tone="info">New buyers start at status New. The Buyer Acquisition agent (or your team) confirms their real buy box on the first call; matching uses the starting box until then.</Notice>
    </div>
  );
}
