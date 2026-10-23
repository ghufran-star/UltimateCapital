"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ActionButton, type ActionState } from "./client";

const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  check: "M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  deals: "M4 7h16M4 12h16M4 17h10",
  house: "M4 11l8-7 8 7v9H4zM10 20v-5h4v5",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8",
  key: "M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l6.1-6.1A4 4 0 0 1 15 7z",
  bot: "M12 4v3M5 11a7 7 0 0 1 14 0v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 14h.01M15 14h.01",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
};

export const NAV = [
  { href: "/", label: "Command Centre", icon: P.home },
  { href: "/approvals", label: "Approvals", icon: P.check, badge: "approvals" },
  { href: "/deals", label: "Deals", icon: P.deals },
  { href: "/properties", label: "Sellers & Properties", icon: P.house },
  { href: "/buyers", label: "Buyers", icon: P.users },
  { href: "/campaigns", label: "Campaigns", icon: P.megaphone },
  { href: "/dialer", label: "Power dialer", icon: P.phone },
  { href: "/closing", label: "Contracts & Closing", icon: P.key },
  { href: "/ops", label: "AI Operations", icon: P.bot },
  { href: "/settings", label: "Settings", icon: P.gear },
];

const MOBILE = ["/", "/deals", "/approvals", "/buyers"];

export function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/") || (href === "/properties" && path.startsWith("/contacts"));
}

export function Sidebar({
  counts,
  workspace,
  workspaces,
  user,
  switchAction,
  logoutAction,
}: {
  counts: Record<string, number>;
  workspace: { id: string; name: string; isDemo: boolean };
  workspaces: { id: string; name: string; isDemo: boolean }[];
  user: { name: string; role: string };
  switchAction: (p: ActionState, f: FormData) => Promise<ActionState>;
  logoutAction: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="font-semibold">UltimateCapital</span>
        </div>
        <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} switchAction={switchAction} />
        <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive(path, n.href) ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-soft"}`}>
              <Icon d={n.icon} />
              <span className="flex-1">{n.label}</span>
              {n.badge && counts[n.badge] ? <span className="badge badge-warn">{counts[n.badge]}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-sm">
          <div className="font-medium">{user.name}</div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="capitalize">{user.role}</span>
            <form action={logoutAction}>
              <button className="underline">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.filter((n) => MOBILE.includes(n.href)).map((n) => (
          <Link key={n.href} href={n.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive(path, n.href) ? "text-brand" : "text-muted"}`}>
            <Icon d={n.icon} />
            {n.label.split(" ")[0]}
            {n.badge && counts[n.badge] ? <span className="absolute right-4 top-1 h-2 w-2 rounded-full bg-hot" /> : null}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
          <Icon d={P.more} />
          More
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-card p-4 pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} switchAction={switchAction} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              {NAV.filter((n) => !MOBILE.includes(n.href)).map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl border border-line px-3 py-3 text-sm">
                  <Icon d={n.icon} />
                  {n.label}
                </Link>
              ))}
            </div>
            <form action={logoutAction} className="mt-3 text-center">
              <button className="text-sm text-muted underline">Sign out ({user.name})</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function WorkspaceSwitcher({ workspace, workspaces, switchAction }: { workspace: { id: string; name: string; isDemo: boolean }; workspaces: { id: string; name: string; isDemo: boolean }[]; switchAction: (p: ActionState, f: FormData) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative px-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm">
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Workspace</span>
          <span className="block truncate font-medium">{workspace.name}</span>
        </span>
        <span className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute inset-x-2 top-full z-50 mt-1 space-y-0.5 rounded-xl border border-line bg-card p-1 shadow-lg">
          {workspaces.map((w) => (
            <ActionButton key={w.id} action={switchAction} hidden={{ workspaceId: w.id }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${w.id === workspace.id ? "bg-soft font-semibold" : "hover:bg-soft"}`}>
              {w.name}
              {w.isDemo ? " · demo" : ""}
            </ActionButton>
          ))}
          <Link href="/settings/team" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-soft">
            + New workspace / demo
          </Link>
        </div>
      )}
    </div>
  );
}

export function BellLink({ unread }: { unread: number }) {
  return (
    <Link href="/alerts" className="relative grid h-9 w-9 place-items-center rounded-full border border-line bg-card" aria-label="Alerts">
      <Icon d={P.bell} />
      {unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-hot px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}
