"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, type ActionState } from "./client";

const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  check: "M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  deals: "M4 7h16M4 12h16M4 17h10",
  house: "M4 11l8-7 8 7v9H4zM10 20v-5h4v5",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  key: "M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l6.1-6.1A4 4 0 0 1 15 7z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  menu: "M4 6h16M4 12h16M4 18h16",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  x: "M6 6l12 12M18 6 6 18",
};

/** The whole app in eight places, in the order the work happens. */
export const NAV = [
  { href: "/", label: "Today", hint: "What needs you now", icon: P.home, badge: "today", match: ["/", "/approvals", "/recommendations", "/alerts", "/ops"] },
  { href: "/properties", label: "Sellers", hint: "Owners and their properties", icon: P.house, match: ["/properties", "/contacts"] },
  { href: "/deals", label: "Deals", hint: "Every deal and its numbers", icon: P.deals, match: ["/deals"] },
  { href: "/buyers", label: "Buyers", hint: "Investors who buy from you", icon: P.users, match: ["/buyers"] },
  { href: "/dialer", label: "Calls", hint: "Dialer, campaigns, AI agents", icon: P.phone, match: ["/dialer", "/campaigns", "/agents", "/calls"] },
  { href: "/closing", label: "Closing", hint: "Contracts, title, getting paid", icon: P.key, match: ["/closing"] },
  { href: "/reports", label: "Reports", hint: "How the business is doing", icon: P.chart, match: ["/reports"] },
  { href: "/settings", label: "Settings", hint: "Connections, team, rules", icon: P.gear, match: ["/settings"] },
] as const;

const MOBILE_BAR = ["/", "/properties", "/deals", "/dialer"];

export function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function isActive(path: string, match: readonly string[]) {
  return match.some((m) => (m === "/" ? path === "/" : path === m || path.startsWith(m + "/") || path.startsWith(m + "?")));
}

type WS = { id: string; name: string; isDemo: boolean };
type Props = {
  counts: Record<string, number>;
  workspace: WS;
  workspaces: WS[];
  user: { name: string; role: string };
  canTest: boolean;
  switchAction: (p: ActionState, f: FormData) => Promise<ActionState>;
  testAction: (p: ActionState, f: FormData) => Promise<ActionState>;
  logoutAction: () => Promise<void>;
};

function MenuBody({ counts, workspace, workspaces, user, canTest, switchAction, testAction, logoutAction, onPick }: Props & { onPick?: () => void }) {
  const path = usePathname();
  const real = workspaces.find((w) => !w.isDemo);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <span className="font-semibold">UltimateCapital</span>
      </div>
      {workspaces.filter((w) => !w.isDemo).length > 1 && !workspace.isDemo && <WorkspaceSwitcher workspace={workspace} workspaces={workspaces.filter((w) => !w.isDemo)} switchAction={switchAction} />}
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV.map((n) => {
          const on = isActive(path, n.match);
          const badge = "badge" in n ? counts[n.badge] : 0;
          return (
            <Link key={n.href} href={n.href} onClick={onPick} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${on ? "bg-brand-soft text-brand" : "text-ink hover:bg-soft"}`}>
              <Icon d={n.icon} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${on ? "font-semibold" : "font-medium"}`}>{n.label}</span>
                <span className="block truncate text-[11px] text-muted">{n.hint}</span>
              </span>
              {badge ? <span className="badge badge-warn">{badge}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-line px-3 py-3">
        {workspace.isDemo ? (
          <div className="rounded-xl bg-warn-soft p-3 text-xs text-warn">
            <div className="font-semibold">You&apos;re in test mode</div>
            <div className="mt-0.5">Sample data; calls, texts, email and AI are pretend.</div>
            {real && (
              <ActionButton action={switchAction} hidden={{ workspaceId: real.id }} className="btn btn-ghost btn-sm mt-2 w-full">
                Back to my business
              </ActionButton>
            )}
          </div>
        ) : (
          canTest && (
            <ActionButton action={testAction} className="btn btn-ghost w-full">
              <Icon d={P.flask} className="h-4 w-4" /> Open test mode
            </ActionButton>
          )
        )}
        <div className="flex items-center justify-between px-1 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{user.name}</span>
            <span className="block text-xs capitalize text-muted">{user.role}</span>
          </span>
          <form action={logoutAction}>
            <button className="text-xs text-muted underline">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-card md:block">
        <MenuBody {...props} />
      </aside>

      {/* Phone: slide-in menu */}
      <div className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(false)} />
        <div className={`absolute inset-y-0 left-0 w-[82%] max-w-xs bg-card shadow-xl transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"} pt-[env(safe-area-inset-top)]`}>
          <button onClick={() => setOpen(false)} className="absolute right-3 top-[calc(env(safe-area-inset-top)+14px)] grid h-9 w-9 place-items-center rounded-full hover:bg-soft" aria-label="Close menu">
            <Icon d={P.x} />
          </button>
          <MenuBody {...props} onPick={() => setOpen(false)} />
        </div>
      </div>

      {/* Phone: bottom bar with the four most used places + the menu */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.filter((n) => MOBILE_BAR.includes(n.href)).map((n) => {
          const badge = "badge" in n ? props.counts[n.badge] : 0;
          return (
            <Link key={n.href} href={n.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive(path, n.match) ? "font-semibold text-brand" : "text-muted"}`}>
              <Icon d={n.icon} />
              {n.label}
              {badge ? <span className="absolute right-[calc(50%-18px)] top-1 h-2 w-2 rounded-full bg-hot" /> : null}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
          <Icon d={P.menu} />
          Menu
        </button>
      </nav>

      <MenuOpener onOpen={() => setOpen(true)} />
    </>
  );
}

/** The ☰ button in the phone header opens the same menu. */
function MenuOpener({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const h = () => onOpen();
    window.addEventListener("uc-open-menu", h);
    return () => window.removeEventListener("uc-open-menu", h);
  }, [onOpen]);
  return null;
}

export function MenuButton() {
  return (
    <button onClick={() => window.dispatchEvent(new Event("uc-open-menu"))} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card md:hidden" aria-label="Open menu">
      <Icon d={P.menu} />
    </button>
  );
}

function WorkspaceSwitcher({ workspace, workspaces, switchAction }: { workspace: WS; workspaces: WS[]; switchAction: (p: ActionState, f: FormData) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative px-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm">
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Business</span>
          <span className="block truncate font-medium">{workspace.name}</span>
        </span>
        <span className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute inset-x-2 top-full z-50 mt-1 space-y-0.5 rounded-xl border border-line bg-card p-1 shadow-lg">
          {workspaces.map((w) => (
            <ActionButton key={w.id} action={switchAction} hidden={{ workspaceId: w.id }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${w.id === workspace.id ? "bg-soft font-semibold" : "hover:bg-soft"}`}>
              {w.name}
            </ActionButton>
          ))}
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
