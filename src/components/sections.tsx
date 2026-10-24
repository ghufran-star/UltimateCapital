import Link from "next/link";

// Sub-sections inside one menu place, shown as pill tabs under the page title.

const SETS = {
  calls: [
    { href: "/dialer", label: "Dialer" },
    { href: "/campaigns", label: "Campaigns" },
    { href: "/agents", label: "AI agents & call log" },
  ],
  closing: [
    { href: "/closing", label: "Closings & payments" },
    { href: "/closing/documents", label: "Documents to sign" },
    { href: "/closing/title", label: "Title companies" },
  ],
} as const;

export function SectionTabs({ set, active }: { set: keyof typeof SETS; active: string }) {
  return (
    <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {SETS[set].map((t) => (
        <Link key={t.href} href={t.href} className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium ${t.href === active ? "border-brand bg-brand text-white" : "border-line bg-card text-ink hover:border-brand"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
