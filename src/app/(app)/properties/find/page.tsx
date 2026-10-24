import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { CampaignChoice } from "@/components/listparts";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { countProperties, SELLER_LISTS } from "@/lib/leads";
import { listCosts, marketQuery } from "@/lib/lists";
import { pageCtx } from "@/lib/session";
import { STATES } from "@/lib/states";
import { getCompliance } from "@/lib/switches";
import { findSellersAction } from "../../../actions/leads";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type SP = { state?: string; county?: string; area?: string; lists?: string | string[]; take?: string; trace?: string; check?: string };

export default async function FindSellers({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const sp = await searchParams;
  const [s, campaigns, packs, costs, sw] = await Promise.all([
    loadSettings(ws),
    db.campaign.findMany({ where: { workspaceId: ws, kind: "seller", status: { in: ["draft", "running", "paused"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
    db.statePack.findMany({ where: { workspaceId: ws, status: "active" }, select: { state: true } }),
    listCosts(ws),
    getCompliance(ws),
  ]);
  const lists = (Array.isArray(sp.lists) ? sp.lists : sp.lists ? [sp.lists] : sp.check ? [] : ["absentee-owner", "high-equity"]).filter((l) => SELLER_LISTS.some((x) => x.key === l));
  const state = (sp.state || packs[0]?.state || "TX").toUpperCase();
  const take = Math.min(5000, Math.max(1, Number(sp.take) || 100));
  const trace = sp.check ? sp.trace === "on" : true;
  const active = new Set(packs.map((p) => p.state));
  const area = (sp.area || "").trim();
  const query = marketQuery({ state, county: sp.county, city: /^\d{5}$/.test(area) ? null : area, zip: /^\d{5}$/.test(area) ? area : null });

  let count: number | null = null;
  let error = "";
  if (sp.check) {
    try {
      count = await countProperties(ws, { query, lists });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const buying = count === null ? take : Math.min(take, count);
  const cost = buying * costs.perRecord + (trace ? buying * costs.perTrace : 0);
  const listNames = lists.map((l) => SELLER_LISTS.find((x) => x.key === l)?.label).join(" + ");

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/properties", label: "Sellers" }} title="Get a seller list" sub="Pick a state, a county and the kind of owners. You'll see how many there are and the cost before anything is bought." />
      {!s.PROPERTY_DATA_PROVIDER && !c.workspace.isDemo && (
        <Notice>
          Connect BatchData first in <Link href="/settings/integrations" className="underline">Settings → Connections → Data</Link>. Have a PropStream or BatchLeads export instead? <Link href="/properties/import" className="underline">Upload the file</Link>.
        </Notice>
      )}
      <Card title="1. Where and who">
        <form className="space-y-3" method="get">
          <input type="hidden" name="check" value="1" />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="State">
              <select name="state" defaultValue={state} className="field">
                {STATES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                    {active.has(x.code) ? " ✓" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="County" hint="e.g. Harris">
              <input name="county" defaultValue={sp.county} className="field" placeholder="Harris" />
            </Field>
            <Field label="Or a city / ZIP" hint="Optional: narrower">
              <input name="area" defaultValue={sp.area} className="field" placeholder="Pasadena or 77502" />
            </Field>
          </div>
          <div>
            <span className="text-sm font-medium">Kind of owners</span>
            <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
              {SELLER_LISTS.map((l) => (
                <label key={l.key} className="flex items-center gap-2">
                  <input type="checkbox" name="lists" value={l.key} defaultChecked={lists.includes(l.key)} /> {l.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Ticking several finds owners on all of them (stacked lists are the most motivated).</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="How many to buy (at most)">
              <input name="take" defaultValue={take} className="field" inputMode="numeric" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="trace" defaultChecked={trace} /> Look up owners&apos; phones and emails (skip trace)
            </label>
          </div>
          <button className="btn btn-primary">Check how many and the cost</button>
          {!active.has(state) && <p className="text-xs text-warn">{state} isn&apos;t turned on in States you work in yet: you can buy the list, but nobody is contacted until it is.</p>}
        </form>
      </Card>

      {sp.check && (
        <Card title="2. Check and buy">
          {error ? (
            <p className="text-sm text-bad">{error}</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-soft p-4">
                <div className="text-sm text-muted">{query}{listNames ? ` · ${listNames}` : ""}</div>
                <div className="mt-1 text-2xl font-semibold tnum">{count === null ? "Count not available" : `${count.toLocaleString()} owners match`}</div>
                <div className="mt-1 text-sm">
                  Buying <b className="tnum">{buying.toLocaleString()}</b> costs about <b className="tnum">{usd(cost)}</b>
                  <span className="text-muted">
                    {" "}
                    ({buying.toLocaleString()} × {usd(costs.perRecord)}
                    {trace ? ` + ${buying.toLocaleString()} skip traces × ${usd(costs.perTrace)}` : ""}). Your prices can be changed in Settings → Connections → Costs.
                  </span>
                </div>
              </div>
              {count === 0 ? (
                <p className="text-sm text-muted">Nothing matches. Try fewer kinds of owners or a bigger area.</p>
              ) : (
                <ActionForm action={findSellersAction}>
                  <input type="hidden" name="query" value={query} />
                  <input type="hidden" name="state" value={state} />
                  <input type="hidden" name="take" value={buying} />
                  {trace && <input type="hidden" name="trace" value="on" />}
                  {lists.map((l) => (
                    <input key={l} type="hidden" name="lists" value={l} />
                  ))}
                  <input type="hidden" name="label" value={`${sp.county ? `${sp.county} County ${state}` : query}${listNames ? ` · ${listNames}` : ""}`} />
                  <CampaignChoice campaigns={campaigns} cold={sw.coldOutreach} />
                  <p className="text-xs text-muted">Duplicates are merged with people you already have, every number is checked against Do Not Call lists, and no one is contacted until you start the campaign.</p>
                  <Submit pendingText="Buying and importing…">Buy {buying.toLocaleString()} for about {usd(cost)}</Submit>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
