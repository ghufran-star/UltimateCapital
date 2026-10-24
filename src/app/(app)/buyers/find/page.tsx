import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { countProperties } from "@/lib/leads";
import { listCosts, marketQuery } from "@/lib/lists";
import { pageCtx } from "@/lib/session";
import { STATES } from "@/lib/states";
import { findBuyersAction } from "../../../actions/leads";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
type SP = { state?: string; county?: string; area?: string; take?: string; trace?: string; check?: string };

export default async function FindBuyers({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const [s, packs, costs] = await Promise.all([loadSettings(ws), db.statePack.findMany({ where: { workspaceId: ws, status: "active" }, select: { state: true } }), listCosts(ws)]);
  const state = (sp.state || packs[0]?.state || "TX").toUpperCase();
  const area = (sp.area || "").trim();
  const query = marketQuery({ state, county: sp.county, city: /^\d{5}$/.test(area) ? null : area, zip: /^\d{5}$/.test(area) ? area : null });
  const take = Math.min(2000, Math.max(1, Number(sp.take) || 100));
  const trace = sp.check ? sp.trace === "on" : true;
  let count: number | null = null;
  let error = "";
  if (sp.check) {
    try {
      count = await countProperties(ws, { query, lists: ["cash-buyer"] });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const buying = count === null ? take : Math.min(take, count);
  const cost = buying * costs.perRecord + (trace ? buying * costs.perTrace : 0);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/buyers", label: "Buyers" }} title="Find cash buyers" sub="People and companies who recently bought with cash become buyers, each with a starting buy box from what they bought. You see the count and cost first." />
      {!s.PROPERTY_DATA_PROVIDER && !c.workspace.isDemo && (
        <Notice>
          Connect BatchData in <Link href="/settings/integrations" className="underline">Settings → Connections → Data</Link> first, or <Link href="/buyers/import" className="underline">upload a buyer list</Link>.
        </Notice>
      )}
      <Card title="1. Where">
        <form method="get" className="space-y-3">
          <input type="hidden" name="check" value="1" />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="State">
              <select name="state" defaultValue={state} className="field">
                {STATES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="County">
              <input name="county" defaultValue={sp.county} className="field" placeholder="Bexar" />
            </Field>
            <Field label="Or a city / ZIP">
              <input name="area" defaultValue={sp.area} className="field" placeholder="San Antonio or 78201" />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Recent cash purchases to look at (at most)">
              <input name="take" defaultValue={take} className="field" inputMode="numeric" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="trace" defaultChecked={trace} /> Look up their phones and emails
            </label>
          </div>
          <button className="btn btn-primary">Check how many and the cost</button>
        </form>
      </Card>
      {sp.check && (
        <Card title="2. Check and buy">
          {error ? (
            <p className="text-sm text-bad">{error}</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-soft p-4">
                <div className="text-sm text-muted">{query} · recent cash purchases</div>
                <div className="mt-1 text-2xl font-semibold tnum">{count === null ? "Count not available" : `${count.toLocaleString()} cash purchases`}</div>
                <div className="mt-1 text-sm">
                  Looking at <b className="tnum">{buying.toLocaleString()}</b> costs about <b className="tnum">{usd(cost)}</b>
                </div>
              </div>
              {count !== 0 && (
                <ActionForm action={findBuyersAction}>
                  <input type="hidden" name="query" value={query} />
                  <input type="hidden" name="state" value={state} />
                  <input type="hidden" name="take" value={buying} />
                  {trace && <input type="hidden" name="trace" value="on" />}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="campaignMode" value="new" defaultChecked /> Put the new buyers in a buyer campaign, ready to start
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="campaignMode" value="none" /> Just save them
                  </label>
                  <Submit pendingText="Buying and importing…">Buy for about {usd(cost)}</Submit>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
