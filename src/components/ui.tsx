import Link from "next/link";
import { label as stageLabel } from "@/lib/stages";

export function PageHeader({ title, sub, actions, back }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 space-y-1">
      {back && (
        <Link href={back.href} className="text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "good" | "warn" | "bad" | "hot" }) {
  const color = tone === "good" ? "text-brand" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : tone === "hot" ? "text-hot" : "";
  const inner = (
    <div className="card h-full p-3 md:p-4">
      <div className="label truncate text-[10px] md:text-xs">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tnum md:text-2xl ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const GOOD = ["ACTIVE", "QUALIFIED", "UNDER_CONTRACT", "DISPOSITION", "CLOSED", "RECONCILED", "COMPLETED", "AGREEMENT_EXECUTED", "TERMS_AGREED", "active", "done", "effective", "signed", "paid", "received", "approved", "running"];
const WARN = ["NEGOTIATION", "CONTRACT_PREPARATION", "OFFER_READY", "INTERESTED", "OFFER_SUBMITTED", "DUE_DILIGENCE", "CLOSING", "pending", "sent", "viewed", "partially_signed", "awaiting_approval", "due", "unverified", "draft", "paused", "open", "QUALIFYING"];
const BAD = ["DECLINED", "WITHDRAWN", "DO_NOT_CONTACT", "CONTRACT_FAILED", "REJECTED", "failed", "rejected", "terminated", "expired", "blocked", "cancelled", "VALUATION_BLOCKED", "APPROVAL_REQUIRED", "OWNERSHIP_DISPUTE"];

export function StatusBadge({ s }: { s?: string | null }) {
  if (!s) return null;
  const cls = GOOD.includes(s) ? "badge-good" : BAD.includes(s) ? "badge-bad" : WARN.includes(s) ? "badge-warn" : "";
  return <span className={`badge ${cls}`}>{stageLabel(s)}</span>;
}

export function HotBadge({ score }: { score: number }) {
  if (!score) return null;
  return <span className={`badge ${score >= 70 ? "badge-hot" : ""}`}>{score >= 70 ? "🔥 " : ""}Hot {score}</span>;
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "good" | "info"; children: React.ReactNode }) {
  const cls = tone === "bad" ? "bg-bad-soft text-bad" : tone === "good" ? "bg-brand-soft text-brand" : tone === "info" ? "bg-soft text-ink" : "bg-warn-soft text-warn";
  return <div className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

/** Extra page actions tucked into one "More" button (keeps headers to one main button). */
export function MoreMenu({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="relative">
      <summary className="btn btn-ghost cursor-pointer list-none [&::-webkit-details-marker]:hidden">{label} ▾</summary>
      <div className="absolute right-0 z-40 mt-1 flex w-56 flex-col gap-1 rounded-xl border border-line bg-card p-1.5 shadow-lg [&>*]:w-full [&>*]:justify-start [&_.btn]:w-full [&_.btn]:justify-start [&_.btn]:border-0">{children}</div>
    </details>
  );
}

/** A list row on phones (tables show on bigger screens). */
export function MobileCard({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="card block p-3 active:bg-soft">
      {children}
    </Link>
  );
}
