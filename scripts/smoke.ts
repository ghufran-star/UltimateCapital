// CI smoke test: builds the demo against a real Postgres, exercises compliance logic,
// and writes session cookies + every page URL for the HTTP crawl that follows.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ensureWorkspaceDefaults } from "../src/lib/bootstrap";
import { db } from "../src/lib/db";
import { ensureDemoWorkspace } from "../src/lib/demo";
import { checkEligibility } from "../src/lib/eligibility";
import { liveCheck } from "../src/lib/dnc";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fail = (m: string) => {
  console.error(`SMOKE FAIL: ${m}`);
  console.log(`::error title=smoke::${m.replace(/\n/g, " ")}`);
  process.exit(1);
};

async function main() {
  const user = await db.user.create({ data: { email: "owner@smoke.test", name: "Smoke Owner", passwordHash: "x", isPlatformOwner: true, phone: "+17135550999" } });
  const real = await db.workspace.create({ data: { name: "Smoke Co" } });
  await db.membership.create({ data: { workspaceId: real.id, userId: user.id, role: "owner" } });
  await ensureWorkspaceDefaults(real.id);

  let t = Date.now();
  const demo = await ensureDemoWorkspace(user.id);
  console.log(`demo built in ${Date.now() - t} ms`);
  t = Date.now();
  const again = await ensureDemoWorkspace(user.id);
  if (again.id !== demo.id) fail("demo rebuilt on second open");
  console.log(`demo reopened in ${Date.now() - t} ms`);

  const ws = demo.id;
  const counts = {
    deals: await db.opportunity.count({ where: { workspaceId: ws } }),
    sellers: await db.contact.count({ where: { workspaceId: ws, kind: "seller" } }),
    buyers: await db.contact.count({ where: { workspaceId: ws, kind: "buyer" } }),
    interests: await db.buyerInterest.count({ where: { opportunity: { workspaceId: ws } } }),
    interactions: await db.interaction.count({ where: { workspaceId: ws } }),
    contracts: await db.contract.count({ where: { workspaceId: ws } }),
    signedPdfs: await db.contract.count({ where: { workspaceId: ws, finalPdf: { not: null } } }),
    transactions: await db.transaction.count({ where: { workspaceId: ws } }),
    approvalsPending: await db.approval.count({ where: { workspaceId: ws, status: "pending" } }),
    campaigns: await db.campaign.count({ where: { workspaceId: ws } }),
    tasks: await db.task.count({ where: { workspaceId: ws } }),
    payments: await db.payment.count({ where: { workspaceId: ws } }),
    audit: await db.auditEvent.count({ where: { workspaceId: ws } }),
  };
  console.log(counts);
  for (const [k, v] of Object.entries(counts)) if (!v) fail(`demo has no ${k}`);
  const stages = await db.opportunity.groupBy({ by: ["stage"], where: { workspaceId: ws }, _count: true });
  if (stages.length < 14) fail(`demo covers only ${stages.length} stages`);

  // Compliance: no provider configured → cold outreach blocked; consent → allowed.
  await db.statePack.update({ where: { workspaceId_state: { workspaceId: real.id, state: "TX" } }, data: { status: "active" } });
  const c = await db.contact.create({ data: { workspaceId: real.id, kind: "seller", firstName: "Test", phone: "+17135550998", state: "TX" } });
  const daytime = new Date("2026-10-21T19:00:00Z"); // 2pm Houston, a Wednesday
  const cold = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (cold.ok || !/No live DNC check/.test(cold.reason || "")) fail(`cold call without provider should be blocked, got ${JSON.stringify(cold)}`);
  await db.consent.create({ data: { contactId: c.id, channel: "call", evidence: "smoke" } });
  const warm = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (!warm.ok) fail(`consented call should pass, got ${warm.reason}`);
  const night = await checkEligibility(real.id, c.id, "human_call", new Date("2026-10-22T04:00:00Z"));
  if (night.ok || !night.retryAt) fail("night call should be rescheduled");
  const sup = await db.suppression.create({ data: { workspaceId: real.id, kind: "phone", value: "+17135550998", source: "national_dnc" } });
  const listed = await checkEligibility(real.id, c.id, "human_call", daytime);
  if (listed.ok) fail("suppressed number should be blocked");
  await db.suppression.delete({ where: { id: sup.id } });
  const lc = await liveCheck(real.id, "+17135550998", { hasConsent: false });
  if (lc.ok) fail("liveCheck without provider should block cold outreach");
  console.log("compliance checks ok");

  // Sessions and URLs for the crawl.
  const demoToken = randomBytes(24).toString("base64url");
  const realToken = randomBytes(24).toString("base64url");
  await db.session.create({ data: { id: sha(demoToken), userId: user.id, workspaceId: ws, expiresAt: new Date(Date.now() + 864e5) } });
  await db.session.create({ data: { id: sha(realToken), userId: user.id, workspaceId: real.id, expiresAt: new Date(Date.now() + 864e5) } });

  const urls: string[] = ["/", "/approvals", "/approvals?tab=done", "/alerts", "/deals/new", "/properties", "/properties?tab=properties", "/properties/import", "/buyers", "/buyers/new", "/buyers/import", "/campaigns", "/campaigns/new", "/closing", "/closing?tab=signatures", "/closing?tab=payments", "/ops", "/ops?tab=tasks", "/ops?tab=tasks&who=ai", "/ops?tab=audit", "/ops?tab=system", "/settings", "/settings/integrations", "/settings/rules", "/settings/states", "/settings/agents", "/settings/templates", "/settings/templates/new", "/settings/phones", "/settings/title", "/settings/team", "/settings/compliance", "/settings/profile"];
  for (const v of ["active", "hot", "contract", "leads", "closed", "all"]) urls.push(`/deals?view=${v}`);
  for (const p of await db.statePack.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/states/${p.state}`);
  for (const a of await db.agent.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/agents/${a.id}`);
  for (const tp of await db.contractTemplate.findMany({ where: { workspaceId: ws } })) urls.push(`/settings/templates/${tp.id}`);
  for (const d of await db.opportunity.findMany({ where: { workspaceId: ws } })) for (const tab of ["overview", "numbers", "buyers", "contracts", "closing", "activity"]) urls.push(`/deals/${d.id}?tab=${tab}`);
  for (const ct of await db.contact.findMany({ where: { workspaceId: ws } })) urls.push(`/contacts/${ct.id}`);
  for (const cp of await db.campaign.findMany({ where: { workspaceId: ws } })) urls.push(`/campaigns/${cp.id}`);
  for (const k of await db.contract.findMany({ where: { workspaceId: ws, finalPdf: { not: null } }, take: 3 })) urls.push(`/api/contracts/${k.id}/pdf`);

  // A real signing link for the public signing page.
  const signToken = randomBytes(24).toString("base64url");
  const k = await db.contract.findFirstOrThrow({ where: { workspaceId: ws, status: "sent" }, include: { signers: true } });
  await db.contractSigner.update({ where: { id: k.signers.find((s) => s.role !== "company")!.id }, data: { tokenHash: sha(signToken) } });

  writeFileSync("smoke-demo-cookie.txt", demoToken);
  writeFileSync("smoke-real-cookie.txt", realToken);
  writeFileSync("smoke-urls.txt", urls.join("\n") + "\n");
  writeFileSync("smoke-public-urls.txt", [`/sign/${signToken}`, "/sign/expired-token", "/login", "/api/health"].join("\n") + "\n");
  console.log(`${urls.length} pages to crawl`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  console.log(`::error title=smoke crash::${String(e instanceof Error ? e.stack || e.message : e).replace(/\n/g, " | ").slice(0, 3000)}`);
  process.exit(1);
});
