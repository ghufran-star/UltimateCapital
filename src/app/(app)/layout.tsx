import Link from "next/link";
import { ActionButton } from "@/components/client";
import { BellLink, MenuButton, Sidebar } from "@/components/nav";
import { Toaster } from "@/components/phone";
import { SwRegister } from "@/components/pwa";
import { db } from "@/lib/db";
import { AUTO_TASKS } from "@/lib/engine";
import { isDemoUser, pageCtx } from "@/lib/session";
import { logoutAction, openDemoAction, switchWorkspaceAction } from "../actions/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await pageCtx();
  const ws = c.workspace.id;
  const [paused, approvals, mine, unread, memberships] = await Promise.all([
    db.pause.findFirst({ where: { workspaceId: ws, scope: "all" }, select: { id: true } }),
    db.approval.count({ where: { workspaceId: ws, status: "pending" } }),
    db.task.count({ where: { workspaceId: ws, status: "open", dueAt: { lte: new Date() }, kind: { notIn: [...AUTO_TASKS] }, OR: [{ assignee: null }, { assignee: c.user.id }] } }),
    db.notification.count({ where: { workspaceId: ws, readAt: null, OR: [{ userId: null }, { userId: c.user.id }] } }),
    db.membership.findMany({ where: { userId: c.user.id }, select: { workspace: { select: { id: true, name: true, isDemo: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const canTest = (c.user.isPlatformOwner || c.role === "owner") && !isDemoUser(c);
  return (
    <div>
      <SwRegister />
      <Toaster />
      <Sidebar
        counts={{ today: approvals + mine }}
        workspace={c.workspace}
        workspaces={memberships.map((m) => m.workspace)}
        user={{ name: c.user.name, role: c.role }}
        canTest={canTest}
        switchAction={switchWorkspaceAction}
        testAction={openDemoAction}
        logoutAction={logoutAction}
      />
      <div className="md:pl-64">
        {c.workspace.isDemo && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ink px-4 py-1.5 text-center text-xs text-bg">
            <span>Test mode · sample data · calls, texts, email and AI are pretend</span>
            {c.role === "owner" && (
              <ActionButton action={openDemoAction} hidden={{ reset: "1" }} className="rounded-md bg-bg px-2 py-0.5 font-semibold text-ink" confirm="Start test mode again with fresh sample data?">
                Reset
              </ActionButton>
            )}
          </div>
        )}
        {paused && (
          <Link href="/settings/controls" className="block bg-bad px-4 py-2 text-center text-sm font-semibold text-white">
            All outreach is paused. Resume in Controls →
          </Link>
        )}
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <MenuButton />
            <Link href="/" className="flex min-w-0 items-center gap-2 md:hidden">
              <span className="truncate font-semibold">{c.workspace.isDemo ? "Test mode" : c.workspace.name}</span>
            </Link>
          </div>
          <BellLink unread={unread} />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 md:px-8 md:pb-12">{children}</main>
      </div>
    </div>
  );
}
