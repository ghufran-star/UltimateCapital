import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { setupSteps } from "@/lib/setup";

export default async function SettingsHome() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [packs, agents, templates, numbers, members, rs, steps] = await Promise.all([
    db.statePack.findMany({ where: { workspaceId: ws }, select: { status: true } }),
    db.agent.count({ where: { workspaceId: ws } }),
    db.contractTemplate.findMany({ where: { workspaceId: ws, active: true }, select: { body: true } }),
    db.phoneNumber.count({ where: { workspaceId: ws } }),
    db.membership.count({ where: { workspaceId: ws } }),
    db.ruleSet.findFirst({ where: { workspaceId: ws, active: true }, select: { version: true } }),
    c.workspace.isDemo ? Promise.resolve([]) : setupSteps(ws, c.user.phone),
  ]);
  const sample = templates.some((t) => t.body.startsWith("SAMPLE ONLY"));
  const done = steps.filter((s) => s.done).length;
  const main: [string, string, string][] = [
    ["Connections", "Phone line, AI calling, email, data, Do Not Call checks", "/settings/integrations"],
    ["Phone numbers", `${numbers} number${numbers === 1 ? "" : "s"} · who answers incoming calls`, "/settings/phones"],
    ["States you work in", `${packs.filter((p) => p.status === "active").length} turned on`, "/settings/states"],
    ["AI callers", `${agents} agents · what they say and do`, "/settings/agents"],
    ["Contracts", `${templates.length} templates${sample ? " · samples still in use" : ""}`, "/settings/templates"],
    ["Team", `${members} people · invites`, "/settings/team"],
    ["My profile", "Name, your mobile, password", "/settings/profile"],
    ["Phone app & alerts", "Install on your phone; alerts for decisions and hot deals", "/settings/app"],
  ];
  const advanced: [string, string, string][] = [
    ["Safety switches", "Pause everything, what runs by itself, daily spend limit", "/settings/controls"],
    ["Autopilot", "What happens automatically at each step", "/settings/autopilot"],
    ["Pricing rules", `Version ${rs?.version ?? 1} · offers, margins, buyer prices`, "/settings/rules"],
    ["Do Not Call & consent", "DNC lists, blocked numbers, consent records", "/settings/compliance"],
    ["Activity log", "Everything the AI and the team did", "/ops"],
  ];
  const Grid = ({ items }: { items: [string, string, string][] }) => (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map(([t, d, href]) => (
        <Link key={href} href={href} className="card block p-4 hover:border-brand">
          <div className="font-semibold">{t}</div>
          <div className="text-sm text-muted">{d}</div>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub={c.workspace.isDemo ? "Test mode: connections are pretend" : c.workspace.name} />
      {steps.length > 0 && done < steps.length && (
        <Card title={`Getting set up · ${done} of ${steps.length}`} pad={false}>
          <ul className="divide-y divide-line">
            {steps.map((s) => (
              <li key={s.title}>
                <Link href={s.href} className="flex items-center gap-3 px-4 py-3 hover:bg-soft">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-brand text-white" : "border border-line"}`}>{s.done ? "✓" : ""}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                    <span className="block text-xs text-muted">{s.why}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Grid items={main} />
      <details className="group">
        <summary className="cursor-pointer select-none py-2 text-sm font-semibold text-muted">Advanced</summary>
        <div className="mt-2">
          <Grid items={advanced} />
        </div>
      </details>
    </div>
  );
}
