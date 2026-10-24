"use client";

import { Combo } from "@/components/combo";
import { PROPERTY_GROUP_KEYS, US_STATES } from "@/lib/catalog";
import { useMemo, useState } from "react";
import { ActionForm, Submit, type ActionState } from "@/components/client";
import {
  calculate,
  CONDITION_TIERS,
  DEAL_TYPES,
  estimateRepairs,
  EXITS,
  fmtPct,
  fmtUsd,
  PROPERTY_TYPES,
  resolveParams,
  tiersFromOverall,
  type Condition,
  type Override,
  type RuleSetData,
  type Tier,
} from "@/lib/rules";

type Path = string;
const get = (o: unknown, p: Path): unknown => p.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
function set<T>(o: T, p: Path, v: unknown): T {
  const out = structuredClone(o) as Record<string, unknown>;
  const keys = p.split(".");
  let cur = out;
  keys.slice(0, -1).forEach((k) => {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  });
  if (v === undefined) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = v;
  return out as T;
}

type Kind = "pct" | "usd" | "num" | "bool" | "pctList" | "usdList" | { options: { key: string; label: string }[] };
const FIELDS: { path: Path; label: string; kind: Kind; help?: string; group: string }[] = [
  { group: "Max buying price", path: "maxBuyPctArv", label: "Max buy % of ARV", kind: "pct", help: "MAO = ARV × this − repairs − our fee − our buying costs" },
  { group: "Max buying price", path: "subtractRepairs", label: "Subtract repairs", kind: "bool" },
  { group: "Max buying price", path: "ourBuyCostsPct", label: "Our buying costs %", kind: "pct" },
  { group: "Max buying price", path: "ourBuyCostsFixed", label: "Our buying costs $ (fixed)", kind: "usd" },
  { group: "Our margin", path: "minFee", label: "Minimum fee (hard floor)", kind: "usd", help: "We never sell below contract price + this." },
  { group: "Our margin", path: "targetFee", label: "Target fee", kind: "usd" },
  { group: "Our margin", path: "feeInMaxBuy", label: "Fee used in max buy", kind: { options: [{ key: "min", label: "Minimum fee" }, { key: "target", label: "Target fee" }] } },
  { group: "Seller offers", path: "offerSteps", label: "Offers below max buy (1st, 2nd…)", kind: "pctList", help: "e.g. 15%, 7% → 1st offer 15% under max buy, 2nd 7% under, final = max buy (needs your approval)." },
  { group: "Buyer asking prices", path: "buyerRoundFees", label: "Our fee in round 1, 2, 3…", kind: "usdList", help: "Buyer price = contract price + fee, capped where the investor still meets their minimum." },
  { group: "Investor margin", path: "investor.profitBasis", label: "Investor profit measured on", kind: { options: [{ key: "net", label: "Net" }, { key: "gross", label: "Gross" }, { key: "both", label: "Both" }] } },
  { group: "Investor margin", path: "investor.minProfitPct", label: "Investor min profit % (of price + repairs)", kind: "pct" },
  { group: "Investor margin", path: "investor.minNetProfit", label: "Investor min net profit $", kind: "usd" },
  { group: "Investor margin", path: "investor.holdMonths", label: "Hold months", kind: "num" },
  { group: "Investor margin", path: "investor.monthlyHolding", label: "Holding cost / month", kind: "usd" },
  { group: "Investor margin", path: "investor.loanLtv", label: "Loan-to-cost", kind: "pct" },
  { group: "Investor margin", path: "investor.loanRateAnnual", label: "Loan rate (annual)", kind: "pct" },
  { group: "Investor margin", path: "investor.loanPointsPct", label: "Loan points", kind: "pct" },
  { group: "Investor margin", path: "investor.buyClosingPct", label: "Investor buy closing %", kind: "pct" },
  { group: "Investor margin", path: "investor.sellCostsPct", label: "Resale costs % of ARV", kind: "pct" },
  { group: "Rentals", path: "rental.minCapRate", label: "Min cap rate", kind: "pct" },
  { group: "Rentals", path: "rental.expenseRatio", label: "Expense ratio", kind: "pct" },
  { group: "Repairs", path: "repairs.contingencyPct", label: "Contingency", kind: "pct" },
  { group: "Repairs", path: "repairs.lowFactor", label: "Low estimate factor", kind: "num" },
  { group: "Repairs", path: "repairs.highFactor", label: "High estimate factor", kind: "num" },
  { group: "Approvals & hot deals", path: "approvals.nearAgreementGapAmt", label: "Near agreement: gap up to $", kind: "usd" },
  { group: "Approvals & hot deals", path: "approvals.nearAgreementGapPct", label: "…or gap up to % of max buy", kind: "pct" },
  { group: "Approvals & hot deals", path: "hotDeal.minSerious", label: "Serious investors to recommend earnest money", kind: "num" },
  { group: "Approvals & hot deals", path: "hotDeal.minScore", label: "Hot score threshold", kind: "num" },
  { group: "Investor contact limits", path: "investorContact.maxDealsPerWeek", label: "Max deals sent per investor / week", kind: "num" },
  { group: "Investor contact limits", path: "investorContact.maxDealsPerMonth", label: "Max deals per investor / month", kind: "num" },
  { group: "Investor contact limits", path: "investorContact.fatigueAfter", label: "Pause after N ignored deals", kind: "num" },
];
const OVERRIDABLE = FIELDS.filter((f) => !["subtractRepairs", "repairs.lowFactor", "repairs.highFactor"].includes(f.path));

function ValueInput({ kind, value, onChange }: { kind: Kind; value: unknown; onChange: (v: unknown) => void }) {
  if (kind === "bool") return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5" />;
  if (typeof kind === "object")
    return (
      <select className="field" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {kind.options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (kind === "pctList" || kind === "usdList") {
    const arr = (Array.isArray(value) ? value : []) as number[];
    const pct = kind === "pctList";
    return (
      <ListInput
        initial={arr.map((x) => (pct ? Math.round(x * 1000) / 10 : x)).join(", ")}
        onChange={(t) => onChange(t.split(/[,\s]+/).filter(Boolean).map((x) => (pct ? Number(x) / 100 : Number(x))).filter((x) => !isNaN(x)))}
        suffix={pct ? "%" : "$"}
      />
    );
  }
  const pct = kind === "pct";
  const n = Number(value ?? 0);
  return (
    <div className="relative">
      {kind === "usd" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>}
      <input
        className={`field tnum ${kind === "usd" ? "pl-6" : ""} ${pct ? "pr-7" : ""}`}
        inputMode="decimal"
        defaultValue={pct ? Math.round(n * 10000) / 100 : n}
        onChange={(e) => {
          const v = Number(e.target.value.replace(/[,$%]/g, ""));
          if (!isNaN(v)) onChange(pct ? v / 100 : v);
        }}
      />
      {pct && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>}
    </div>
  );
}

function ListInput({ initial, onChange, suffix }: { initial: string; onChange: (t: string) => void; suffix: string }) {
  const [t, setT] = useState(initial);
  return (
    <div className="relative">
      <input
        className="field tnum pr-7"
        value={t}
        onChange={(e) => {
          setT(e.target.value);
          onChange(e.target.value);
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>
    </div>
  );
}

function ListField({ value, onChange, placeholder }: { value?: string[]; onChange: (v: string[] | undefined) => void; placeholder: string }) {
  const [t, setT] = useState((value || []).join(", "));
  return (
    <input
      className="field"
      placeholder={placeholder}
      value={t}
      onChange={(e) => {
        setT(e.target.value);
        const arr = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
        onChange(arr.length ? arr : undefined);
      }}
    />
  );
}

function Chips({ options, value, onChange }: { options: readonly { key: string; label: string }[]; value?: string[]; onChange: (v: string[] | undefined) => void }) {
  const v = value || [];
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = v.includes(o.key);
        return (
          <button
            type="button"
            key={o.key}
            onClick={() => {
              const next = on ? v.filter((x) => x !== o.key) : [...v, o.key];
              onChange(next.length ? next : undefined);
            }}
            className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-brand text-white" : "bg-soft text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function validate(r: RuleSetData) {
  const d = r.defaults;
  const out: string[] = [];
  if (!(d.maxBuyPctArv > 0.3 && d.maxBuyPctArv <= 0.95)) out.push("Max buy % of ARV must be between 30% and 95%.");
  if (d.targetFee < d.minFee) out.push("Target fee must be at least the minimum fee.");
  if (d.offerSteps.some((x) => x < 0 || x >= 0.6)) out.push("Offer steps must be between 0% and 60%.");
  if (d.buyerRoundFees.some((x) => x < d.minFee)) out.push("Every buyer round fee must be at least the minimum fee.");
  for (const o of r.overrides) {
    const m = (o.set.minFee as number | undefined) ?? d.minFee;
    const fees = (o.set.buyerRoundFees as number[] | undefined) ?? d.buyerRoundFees;
    if (fees.some((x) => x < m)) out.push(`“${o.name}”: buyer round fees below its minimum fee.`);
    if (!o.name.trim()) out.push("Every variation needs a name.");
  }
  return out;
}

export function RulesEditor({ initial, version, action, readOnly, states }: { initial: RuleSetData; version: number; action: (p: ActionState, f: FormData) => Promise<ActionState>; readOnly: boolean; states: string[] }) {
  const [rules, setRules] = useState<RuleSetData>(initial);
  const [tab, setTab] = useState<"defaults" | "overrides" | "playbook">("defaults");
  const [pv, setPv] = useState({ arv: 250000, sqft: 1500, baths: 2, tier: "moderate" as Tier, state: states[0] || "TX", market: "", zip: "", propertyType: "sfr", dealType: "assignment", exit: "flip", occupancy: "vacant", rent: 1800, contractPrice: 0 });
  const errors = useMemo(() => validate(rules), [rules]);
  const preview = useMemo(() => {
    try {
      const facts = { state: pv.state, market: pv.market || null, zip: pv.zip || null, propertyType: pv.propertyType, dealType: pv.dealType, exit: pv.exit, conditionTier: pv.tier, occupancy: pv.occupancy, arv: pv.arv };
      const { params, applied, sources } = resolveParams(rules, facts);
      const rep = estimateRepairs(rules.playbook, tiersFromOverall(rules.playbook, pv.tier), params, { sqft: pv.sqft, baths: pv.baths });
      const calc = calculate({ arv: pv.arv, repairs: rep.likely, params, exit: pv.exit, rent: pv.rent, contractPrice: pv.contractPrice || null });
      return { calc, rep, applied, sources, params };
    } catch (e) {
      return { error: String(e) };
    }
  }, [rules, pv]);
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const setOverride = (i: number, o: Override) => setRules({ ...rules, overrides: rules.overrides.map((x, j) => (j === i ? o : x)) });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-1 text-sm">
          {(
            [
              ["defaults", "Defaults"],
              ["overrides", `Variations (${rules.overrides.length})`],
              ["playbook", "Repair playbook"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 ${tab === k ? "bg-ink text-bg" : "bg-soft"}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === "defaults" &&
          groups.map((g) => (
            <section key={g} className="card p-4">
              <h3 className="mb-3 text-sm font-semibold">{g}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {FIELDS.filter((f) => f.group === g).map((f) => (
                  <label key={f.path} className="block space-y-1">
                    <span className="text-sm font-medium">{f.label}</span>
                    <ValueInput kind={f.kind} value={get(rules.defaults, f.path)} onChange={(v) => setRules({ ...rules, defaults: set(rules.defaults, f.path, v) })} />
                    {f.help && <span className="block text-xs text-muted">{f.help}</span>}
                  </label>
                ))}
              </div>
            </section>
          ))}

        {tab === "overrides" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Variations change the defaults for matching deals: by state, market, ZIP, property type, deal type, exit, condition, occupancy or ARV range. When several match, the most specific wins.</p>
            {rules.overrides.map((o, i) => (
              <section key={o.id} className="card space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <input className="field font-semibold" value={o.name} onChange={(e) => setOverride(i, { ...o, name: e.target.value })} />
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setRules({ ...rules, overrides: rules.overrides.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Cond label="States">
                    <Combo options={US_STATES} value={o.when.states || []} multiple placeholder="Any state" onChange={(v) => setOverride(i, { ...o, when: { ...o.when, states: v.length ? v : undefined } })} />
                  </Cond>
                  <Cond label="Markets (cities)">
                    <ListField value={o.when.markets} placeholder="Houston" onChange={(v) => setOverride(i, { ...o, when: { ...o.when, markets: v } })} />
                  </Cond>
                  <Cond label="ZIPs">
                    <ListField value={o.when.zips} placeholder="77088, 77016" onChange={(v) => setOverride(i, { ...o, when: { ...o.when, zips: v } })} />
                  </Cond>
                  <Cond label="ARV range">
                    <div className="flex gap-2">
                      <input className="field" placeholder="min" defaultValue={o.when.minArv ?? ""} onChange={(e) => setOverride(i, { ...o, when: { ...o.when, minArv: Number(e.target.value) || undefined } })} />
                      <input className="field" placeholder="max" defaultValue={o.when.maxArv ?? ""} onChange={(e) => setOverride(i, { ...o, when: { ...o.when, maxArv: Number(e.target.value) || undefined } })} />
                    </div>
                  </Cond>
                  <Cond label="Property types">
                    <Combo options={[...PROPERTY_TYPES, ...Object.keys(PROPERTY_GROUP_KEYS).map((g) => ({ key: g, label: `Any ${g.toLowerCase()}`, group: "Whole groups" }))]} value={o.when.propertyTypes || []} multiple placeholder="Any type" onChange={(v) => setOverride(i, { ...o, when: { ...o.when, propertyTypes: v.length ? v : undefined } })} />
                  </Cond>
                  <Cond label="Deal types">
                    <Combo options={DEAL_TYPES} value={o.when.dealTypes || []} multiple placeholder="Any deal type" onChange={(v) => setOverride(i, { ...o, when: { ...o.when, dealTypes: v.length ? v : undefined } })} />
                  </Cond>
                  <Cond label="Condition">
                    <Chips options={CONDITION_TIERS} value={o.when.conditionTiers} onChange={(v) => setOverride(i, { ...o, when: { ...o.when, conditionTiers: v } })} />
                  </Cond>
                  <Cond label="Exit / occupancy">
                    <Chips options={[...EXITS, { key: "vacant", label: "Vacant" }, { key: "tenant", label: "Tenant" }, { key: "owner", label: "Owner" }]} value={[...(o.when.exits || []), ...(o.when.occupancy || [])]} onChange={(v) => setOverride(i, { ...o, when: { ...o.when, exits: v?.filter((x) => EXITS.some((e) => e.key === x)), occupancy: v?.filter((x) => !EXITS.some((e) => e.key === x)) } as Condition })} />
                  </Cond>
                </div>
                <div className="rounded-xl bg-soft p-3">
                  <div className="mb-2 text-xs font-semibold text-muted">CHANGE THESE VALUES</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {OVERRIDABLE.map((f) => {
                      const cur = get(o.set, f.path);
                      const on = cur !== undefined;
                      return (
                        <div key={f.path} className={`rounded-lg p-2 ${on ? "bg-card" : ""}`}>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={on} onChange={(e) => setOverride(i, { ...o, set: set(o.set, f.path, e.target.checked ? get(rules.defaults, f.path) : undefined) })} />
                            {f.label}
                          </label>
                          {on && (
                            <div className="mt-1">
                              <ValueInput kind={f.kind} value={cur} onChange={(v) => setOverride(i, { ...o, set: set(o.set, f.path, v) })} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
            <button type="button" className="btn btn-ghost" onClick={() => setRules({ ...rules, overrides: [...rules.overrides, { id: Math.random().toString(36).slice(2, 10), name: "New variation", when: {}, set: {} }] })}>
              + Add variation
            </button>
          </div>
        )}

        {tab === "playbook" && (
          <section className="card overflow-x-auto p-0">
            <div className="overflow-x-auto"><table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  {CONDITION_TIERS.map((t) => (
                    <th key={t.key} className="text-right">
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.playbook.map((it, i) => (
                  <tr key={it.key}>
                    <td>
                      <input className="field" value={it.label} onChange={(e) => setRules({ ...rules, playbook: rules.playbook.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    </td>
                    <td>
                      <select className="field" value={it.unit} onChange={(e) => setRules({ ...rules, playbook: rules.playbook.map((x, j) => (j === i ? { ...x, unit: e.target.value as typeof x.unit } : x)) })}>
                        <option value="sqft">per sq ft</option>
                        <option value="each">per bath</option>
                        <option value="fixed">fixed</option>
                      </select>
                    </td>
                    {CONDITION_TIERS.map((t) => (
                      <td key={t.key}>
                        <input
                          className="field w-24 text-right tnum"
                          defaultValue={it.costs[t.key]}
                          inputMode="decimal"
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!isNaN(v)) setRules({ ...rules, playbook: rules.playbook.map((x, j) => (j === i ? { ...x, costs: { ...x.costs, [t.key]: v } } : x)) });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="p-3">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRules({ ...rules, playbook: [...rules.playbook, { key: `item_${Date.now().toString(36)}`, label: "New item", unit: "fixed", costs: { cosmetic: 0, moderate: 0, heavy: 0, gut: 0 } }] })}>
                + Add item
              </button>
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Live preview</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <P l="ARV">
              <input className="field tnum" defaultValue={pv.arv} onChange={(e) => setPv({ ...pv, arv: Number(e.target.value) || 0 })} />
            </P>
            <P l="Sq ft">
              <input className="field tnum" defaultValue={pv.sqft} onChange={(e) => setPv({ ...pv, sqft: Number(e.target.value) || 0 })} />
            </P>
            <P l="Condition">
              <select className="field" value={pv.tier} onChange={(e) => setPv({ ...pv, tier: e.target.value as Tier })}>
                {CONDITION_TIERS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </P>
            <P l="Baths">
              <input className="field tnum" defaultValue={pv.baths} onChange={(e) => setPv({ ...pv, baths: Number(e.target.value) || 1 })} />
            </P>
            <P l="State">
              <input className="field uppercase" defaultValue={pv.state} maxLength={2} onChange={(e) => setPv({ ...pv, state: e.target.value.toUpperCase() })} />
            </P>
            <P l="Market">
              <input className="field" defaultValue={pv.market} onChange={(e) => setPv({ ...pv, market: e.target.value })} />
            </P>
            <P l="Type">
              <select className="field" value={pv.propertyType} onChange={(e) => setPv({ ...pv, propertyType: e.target.value })}>
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </P>
            <P l="Exit">
              <select className="field" value={pv.exit} onChange={(e) => setPv({ ...pv, exit: e.target.value })}>
                {EXITS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </P>
            <P l="Deal type">
              <select className="field" value={pv.dealType} onChange={(e) => setPv({ ...pv, dealType: e.target.value })}>
                {DEAL_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </P>
            <P l="Rent / mo">
              <input className="field tnum" defaultValue={pv.rent} onChange={(e) => setPv({ ...pv, rent: Number(e.target.value) || 0 })} />
            </P>
          </div>
          {"error" in preview ? (
            <p className="mt-3 text-sm text-bad">{preview.error}</p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              {preview.applied.length > 0 && <p className="text-xs text-brand">Variations applied: {preview.applied.join(", ")}</p>}
              <Row l="Repairs (likely)" v={`${fmtUsd(preview.rep.likely)}  (${fmtUsd(preview.rep.low)}–${fmtUsd(preview.rep.high)})`} />
              <div className="rounded-xl bg-soft p-3">
                <div className="text-xs font-semibold text-muted">SELLER SIDE</div>
                {preview.calc.sellerOffers.map((o, i) => (
                  <Row key={o} l={i === preview.calc.sellerOffers.length - 1 ? "🔒 Max buy (final, needs approval)" : `Offer ${i + 1}`} v={fmtUsd(o)} strong={i === preview.calc.sellerOffers.length - 1} />
                ))}
              </div>
              <div className="rounded-xl bg-soft p-3">
                <div className="text-xs font-semibold text-muted">BUYER SIDE (contract {fmtUsd(preview.calc.contractPrice)})</div>
                {preview.calc.buyerRounds.map((b, i) => (
                  <Row key={b} l={`Round ${i + 1} (fee ${fmtUsd(preview.calc.ourFeeAtRounds[i])})`} v={`${fmtUsd(b)} · inv. ${preview.calc.investorAtRounds[i].meets ? "✓" : "✗"} ${fmtPct(preview.params.investor.profitBasis === "gross" ? preview.calc.investorAtRounds[i].grossPct : preview.calc.investorAtRounds[i].netPct)}`} />
                ))}
                <Row l="🔒 Floor (min selling price)" v={fmtUsd(preview.calc.floor)} strong />
                <Row l="Investor max price" v={fmtUsd(preview.calc.investorMaxPrice)} />
              </div>
              {preview.calc.warnings.map((w) => (
                <p key={w} className="text-xs text-warn">
                  ⚠ {w}
                </p>
              ))}
              <p className="text-xs text-muted">🔒 Hard locks: agents can never offer above the max buy or sell below the floor. Anything outside comes to you as an approval.</p>
            </div>
          )}
        </section>

        <section className="card p-4">
          {errors.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm text-bad">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
          {readOnly ? (
            <p className="text-sm text-muted">View only.</p>
          ) : (
            <ActionForm action={action}>
              <input type="hidden" name="rules" value={JSON.stringify(rules)} />
              <input name="note" className="field" placeholder={`What changed? (v${version + 1})`} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="revalue" defaultChecked /> Re-value open deals with the new rules
              </label>
              {errors.length ? (
                <button className="btn btn-primary w-full" disabled>
                  Fix the errors to publish
                </button>
              ) : (
                <Submit className="btn btn-primary w-full">Publish as v{version + 1}</Submit>
              )}
            </ActionForm>
          )}
        </section>
      </aside>
    </div>
  );
}

function Cond({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      {children}
    </div>
  );
}
function P({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-xs text-muted">{l}</span>
      {children}
    </label>
  );
}
function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-muted">{l}</span>
      <span className={`tnum text-right ${strong ? "font-semibold" : ""}`}>{v}</span>
    </div>
  );
}
