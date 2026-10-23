import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { SELLER_LISTS } from "@/lib/leads";
import { pageCtx } from "@/lib/session";
import { findSellersAction } from "../../../actions/leads";

export default async function FindSellers() {
  const c = await pageCtx();
  const s = await loadSettings(c.workspace.id);
  const campaigns = await db.campaign.findMany({ where: { workspaceId: c.workspace.id, kind: "seller", status: { in: ["draft", "running", "paused"] } }, orderBy: { updatedAt: "desc" } });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/properties", label: "Sellers & properties" }} title="Find sellers" sub="Pull a list from your property data provider, skip-trace the owners, and load them as deals." />
      {!s.PROPERTY_DATA_PROVIDER && (
        <Notice>
          Connect a property data provider first (BatchData or your own endpoint) in <Link href="/settings/integrations" className="underline">Settings → Integrations → Data</Link>. Until then, import CSVs from PropStream or any list source on the <Link href="/properties/import" className="underline">Import</Link> page.
        </Notice>
      )}
      <Card>
        <ActionForm action={findSellersAction}>
          <Field label="Market" hint="A city and state (Houston, TX), a county, or a ZIP code.">
            <input name="query" className="field" placeholder="Houston, TX" />
          </Field>
          <div>
            <span className="text-sm font-medium">Lists</span>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              {SELLER_LISTS.map((l) => (
                <label key={l.key} className="flex items-center gap-2">
                  <input type="checkbox" name="lists" value={l.key} defaultChecked={l.key === "absentee-owner" || l.key === "high-equity"} /> {l.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Several lists together find owners on all of them (stacked lists are the most motivated).</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="How many">
              <input name="take" defaultValue={50} className="field" inputMode="numeric" />
            </Field>
            <Field label="Add to campaign">
              <select name="campaignId" className="field">
                <option value="">No campaign</option>
                {campaigns.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trace" defaultChecked /> Skip-trace owners for phones and emails (charged by your provider per record)
          </label>
          <Submit pendingText="Searching…">Find and import</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
