import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { Combo } from "@/components/combo";
import { US_STATES } from "@/lib/catalog";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { PACK_STATUS_LABEL, STATES, stateName, type PackStatus } from "@/lib/states";
import { ago } from "@/lib/util";
import { addStateAction } from "../../../actions/settings";

export default async function States() {
  const c = await pageCtx();
  const packs = await db.statePack.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { state: "asc" } });
  const ro = c.workspace.isDemo || !can(c.role, "states");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="States" sub="Every state runs on its own pack: wholesaling rules, disclosures, contract terms, calling hours and consent. Nothing goes out in a state until its pack is active." />
      <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">New packs start as conservative drafts. They are not legal advice: have counsel review each pack before you activate it.</div>
      <div className="grid gap-3 md:grid-cols-2">
        {packs.map((p) => (
          <Link key={p.id} href={`/settings/states/${p.state}`} className="card flex items-center justify-between p-4 hover:border-brand">
            <div>
              <div className="font-semibold">
                {stateName(p.state)} ({p.state})
              </div>
              <div className="text-xs text-muted">
                v{p.version} · {p.approvedAt ? `activated ${ago(p.approvedAt)}` : `updated ${ago(p.updatedAt)}`}
              </div>
            </div>
            <span title={PACK_STATUS_LABEL[p.status as PackStatus]}>
              <StatusBadge s={p.status} />
            </span>
          </Link>
        ))}
      </div>
      {!ro && (
        <Card title="Add states">
          <ActionForm action={addStateAction}>
            <Combo name="state" options={US_STATES.filter((s) => !packs.some((p) => p.state === s.key))} multiple placeholder="Search and pick states" />
            <Submit className="btn btn-ghost">Add as drafts</Submit>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
