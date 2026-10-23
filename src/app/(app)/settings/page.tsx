import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";

export default async function SettingsHome() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const s = await loadSettings(ws);
  const [packs, agents, templates, numbers, titles, members, rs] = await Promise.all([
    db.statePack.findMany({ where: { workspaceId: ws } }),
    db.agent.findMany({ where: { workspaceId: ws } }),
    db.contractTemplate.findMany({ where: { workspaceId: ws, active: true } }),
    db.phoneNumber.count({ where: { workspaceId: ws } }),
    db.titleCompany.count({ where: { workspaceId: ws } }),
    db.membership.count({ where: { workspaceId: ws } }),
    db.ruleSet.findFirst({ where: { workspaceId: ws, active: true } }),
  ]);
  const sample = templates.some((t) => t.body.startsWith("SAMPLE ONLY"));
  const steps: [boolean, string, string, string][] = [
    [!!s.PUBLIC_URL, "Set your public app URL", "Needed for signing links and call/text webhooks.", "/settings/integrations"],
    [!!s.ANTHROPIC_API_KEY, "Add your Claude API key", "Powers call analysis, title emails and research.", "/settings/integrations"],
    [!!(s.RETELL_API_KEY && s.TWILIO_ACCOUNT_SID), "Connect calling and texting", "Retell for AI calls, Twilio for texts and your own calls.", "/settings/integrations"],
    [!!(s.RESEND_API_KEY && s.EMAIL_FROM), "Connect email", "Resend sends contracts, deal packages and title emails.", "/settings/integrations"],
    [packs.some((p) => p.status === "active"), "Review and activate a State Pack", "No outreach happens in a state until you activate its pack.", "/settings/states"],
    [!sample && templates.length > 0, "Add your attorney's contracts", "Replace the sample templates.", "/settings/templates"],
    [agents.some((a) => a.retellAgentId), "Sync your AI agents to Retell", "Publishes the 6-layer prompts and tools.", "/settings/agents"],
    [numbers > 0, "Add a phone number", "For inbound calls and texts.", "/settings/phones"],
  ];
  const done = steps.filter((x) => x[0]).length;
  const links: [string, string, string][] = [
    ["Controls", "Pause switches, what runs by itself, spend cap", "/settings/controls"],
    ["Deal rules", `v${rs?.version ?? 1} live · offers, margins, buyer rounds, variations`, "/settings/rules"],
    ["States", `${packs.filter((p) => p.status === "active").length} active of ${packs.length}`, "/settings/states"],
    ["AI agents", `${agents.length} agents · 6-layer prompts`, "/settings/agents"],
    ["Contract templates", `${templates.length} active${sample ? " · sample in use" : ""}`, "/settings/templates"],
    ["Integrations", "Claude, Retell, Twilio, Resend, RentCast, DNC", "/settings/integrations"],
    ["Phone numbers", `${numbers} numbers · inbound routing`, "/settings/phones"],
    ["Title companies", `${titles} saved`, "/settings/title"],
    ["Compliance", "DNC lists, suppressions, consent", "/settings/compliance"],
    ["Team & workspaces", `${members} members · invites · demo`, "/settings/team"],
    ["My profile", "Name, phone for calls, password", "/settings/profile"],
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub={c.workspace.name} />
      {done < steps.length && !c.workspace.isDemo && (
        <Card title={`Getting set up · ${done}/${steps.length}`} pad={false}>
          <ul className="divide-y divide-line">
            {steps.map(([ok, t, d, href]) => (
              <li key={t}>
                <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-soft">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${ok ? "bg-brand text-white" : "border border-line"}`}>{ok ? "✓" : ""}</span>
                  <span>
                    <span className={`block text-sm font-medium ${ok ? "text-muted line-through" : ""}`}>{t}</span>
                    <span className="block text-xs text-muted">{d}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {links.map(([t, d, href]) => (
          <Link key={href} href={href} className="card block p-4 hover:border-brand">
            <div className="font-semibold">{t}</div>
            <div className="text-sm text-muted">{d}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
