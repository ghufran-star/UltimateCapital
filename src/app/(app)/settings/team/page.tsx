import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { loadSettings } from "@/lib/config";
import { db } from "@/lib/db";
import { can, pageCtx, ROLE_LABELS, ROLES } from "@/lib/session";
import { ago } from "@/lib/util";
import { createWorkspaceAction, inviteAction, memberRoleAction, openDemoAction, switchWorkspaceAction } from "../../../actions/auth";
import { workspaceSettingsAction } from "../../../actions/settings";

export default async function Team() {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [members, invites, mine, s] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: ws }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { workspaceId: ws, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.membership.findMany({ where: { userId: c.user.id }, include: { workspace: true } }),
    loadSettings(ws),
  ]);
  const canTeam = !c.workspace.isDemo && can(c.role, "team");
  const owner = c.user.isPlatformOwner || c.role === "owner";
  const base = (s.PUBLIC_URL || "").replace(/\/$/, "");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Team & workspaces" />
      <Card title={`Members of ${c.workspace.name}`} pad={false}>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <div className="font-medium">{m.user.name}</div>
                <div className="text-xs text-muted">
                  {m.user.email}
                  {m.states.length ? ` · states ${m.states.join(", ")}` : ""}
                </div>
              </div>
              {canTeam && m.userId !== c.user.id ? (
                <ActionForm action={memberRoleAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="membershipId" value={m.id} />
                  <select name="role" defaultValue={m.role} className="field w-auto">
                    {ROLES.filter((r) => r !== "owner" || c.role === "owner").map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <input name="states" defaultValue={m.states.join(", ")} placeholder="States (all)" className="field w-28" />
                  <Submit className="btn btn-ghost btn-sm">Save</Submit>
                </ActionForm>
              ) : (
                <span className="badge">{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] || m.role}</span>
              )}
              {canTeam && m.userId !== c.user.id && (
                <ActionButton action={memberRoleAction} hidden={{ membershipId: m.id, remove: "1" }} confirm={`Remove ${m.user.name}?`} className="text-xs text-bad underline">
                  Remove
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canTeam && (
        <Card title="Invite someone">
          <ActionForm action={inviteAction} className="flex flex-wrap items-end gap-2" resetOnOk>
            <input name="email" type="email" placeholder="Email (optional)" className="field max-w-xs" />
            <select name="role" defaultValue="caller" className="field w-auto">
              {ROLES.filter((r) => r !== "owner" || c.role === "owner").map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <Submit className="btn btn-primary">Create invite link</Submit>
          </ActionForm>
          {invites.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {invites.map((i) => (
                <li key={i.id}>
                  <span className="font-medium">{ROLE_LABELS[i.role as keyof typeof ROLE_LABELS]}</span> {i.email && `for ${i.email}`} <span className="text-xs text-muted">· created {ago(i.createdAt)}</span>
                  <code className="mt-1 block break-all rounded-lg bg-soft px-2 py-1 text-xs">{`${base || ""}/invite/${i.token}`}</code>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {canTeam && (
        <Card title="This workspace">
          <ActionForm action={workspaceSettingsAction} className="flex flex-wrap items-end gap-2">
            <Field label="Name">
              <input name="name" defaultValue={c.workspace.name} className="field" />
            </Field>
            <Field label="Time zone">
              <input name="timezone" defaultValue={c.workspace.timezone} className="field" />
            </Field>
            <Submit className="btn btn-ghost">Save</Submit>
          </ActionForm>
        </Card>
      )}
      <Card title="Your workspaces">
        <ul className="mb-4 space-y-2">
          {mine.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm">
              <span>
                {m.workspace.name} <span className="text-xs text-muted">· {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]}</span>
                {m.workspace.isDemo && <span className="badge ml-2">demo</span>}
              </span>
              {m.workspaceId === c.workspace.id ? (
                <span className="badge badge-good">Current</span>
              ) : (
                <ActionButton action={switchWorkspaceAction} hidden={{ workspaceId: m.workspaceId }}>
                  Switch
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm action={createWorkspaceAction} className="space-y-2">
              <input name="name" className="field" placeholder="New workspace name (e.g. a second company or market)" />
              <Submit className="btn btn-ghost">Create workspace</Submit>
            </ActionForm>
            <div className="space-y-2">
              <ActionButton action={openDemoAction} className="btn btn-ghost">
                Open demo workspace
              </ActionButton>
              <ActionButton action={openDemoAction} hidden={{ reset: "1" }} confirm="Rebuild the demo with fresh sample data?" className="ml-2 text-xs underline">
                Reset demo
              </ActionButton>
              <p className="text-xs text-muted">Sample deals at every stage. View-only; never contacts anyone.</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
