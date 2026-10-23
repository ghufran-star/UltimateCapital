import { ActionButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { DEFAULT_RULESET, type RuleSetData } from "@/lib/rules";
import { can, pageCtx } from "@/lib/session";
import { ago } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";
import { restoreRulesAction, saveRulesAction } from "../../../actions/settings";
import { RulesEditor } from "./editor";

export default async function RulesPage() {
  const c = await pageCtx();
  const rs = await activeRuleSet(c.workspace.id);
  const versions = await db.ruleSet.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { version: "desc" }, take: 20 });
  const packs = await db.statePack.findMany({ where: { workspaceId: c.workspace.id }, select: { state: true } });
  const data: RuleSetData = { ...DEFAULT_RULESET, ...rs.data, defaults: { ...DEFAULT_RULESET.defaults, ...rs.data.defaults } };
  const readOnly = c.workspace.isDemo || !can(c.role, "rules");
  return (
    <div className="space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Deal rules" sub={`Version ${rs.version} is live. Every valuation records which version it used.`} />
      <RulesEditor initial={data} version={versions[0]?.version || rs.version} action={saveRulesAction} readOnly={readOnly} states={packs.map((p) => p.state)} />
      <Card title="Version history" pad={false}>
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                v{v.version} {v.active && <span className="badge badge-good ml-1">live</span>} <span className="text-muted">· {v.note || "—"} · {ago(v.createdAt)}</span>
              </span>
              {!v.active && !readOnly && (
                <ActionButton action={restoreRulesAction} hidden={{ version: String(v.version) }} confirm={`Restore v${v.version} as a new version?`}>
                  Restore
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
