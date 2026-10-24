import Link from "next/link";
import { BellLink, Sidebar } from "@/components/nav";
import { db } from "@/lib/db";
import { pageCtx } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { SwRegister } from "@/components/pwa";
import { logoutAction, openDemoAction, switchWorkspaceAction } from "../actions/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await pageCtx();
  const paused = await db.pause.findFirst({ where: { workspaceId: c.workspace.id, scope: "all" } });
  const demoEmpty = c.workspace.isDemo && (await db.opportunity.count({ where: { workspaceId: c.workspace.id } })) === 0;
  const [approvals, unread, memberships] = await Promise.all([
    db.approval.count({ where: { workspaceId: c.workspace.id, status: "pending" } }),
    db.notification.count({ where: { workspaceId: c.workspace.id, readAt: null, OR: [{ userId: null }, { userId: c.user.id }] } }),
    db.membership.findMany({ where: { userId: c.user.id }, include: { workspace: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div>
      <SwRegister />
      <Sidebar
        counts={{ approvals }}
        workspace={c.workspace}
        workspaces={memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, isDemo: m.workspace.isDemo }))}
        user={{ name: c.user.name, role: c.role }}
        switchAction={switchWorkspaceAction}
        logoutAction={logoutAction}
      />
      <div className="md:pl-60">
        {c.workspace.isDemo && (
          <div className="sticky top-0 z-20 bg-ink px-4 py-2 text-center text-sm text-bg">
            Demo workspace · sample data · view only — switch workspace to return to your business
            {demoEmpty && (
              <ActionButton action={openDemoAction} hidden={{ reset: "1" }} className="ml-3 rounded-md bg-bg px-2 py-0.5 text-xs font-semibold text-ink">
                Demo is empty: build sample data
              </ActionButton>
            )}
          </div>
        )}
        {paused && (
          <Link href="/settings/controls" className="block bg-bad px-4 py-2 text-center text-sm font-semibold text-white">
            All outreach is paused. Resume in Controls →
          </Link>
        )}
        <header className="flex items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 md:px-8">
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="font-semibold">{c.workspace.name}</span>
          </Link>
          <div className="hidden md:block" />
          <BellLink unread={unread} />
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 md:px-8 md:pb-12">{children}</main>
      </div>
    </div>
  );
}
