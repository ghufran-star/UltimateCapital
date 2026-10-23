// Small shared helpers.

/** Normalise a US phone number to E.164 (+1XXXXXXXXXX). Returns null if it can't. */
export function e164(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith("+")) {
    const d = s.replace(/[^\d]/g, "");
    return d.length >= 8 ? `+${d}` : null;
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export const areaCode = (p?: string | null) => (p && p.startsWith("+1") ? p.slice(2, 5) : null);

export const fullName = (c: { firstName?: string | null; lastName?: string | null; company?: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.company || "Unknown";

export const usd = (n?: number | null) => (n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export const int = (v: FormDataEntryValue | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};
export const num = (v: FormDataEntryValue | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const str = (v: FormDataEntryValue | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
};
export const list = (v: FormDataEntryValue | null | undefined) =>
  String(v || "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Local time parts in a time zone. */
export function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return { day: parts.weekday as string, hm: `${hh}:${parts.minute}` };
}

/** Next moment (from now) when local time in tz is within [start,end) on an allowed day. */
export function nextWindow(tz: string, start: string, end: string, days: string[], from = new Date()): Date {
  for (let i = 0; i < 7 * 24 * 4; i++) {
    const t = new Date(from.getTime() + i * 15 * 60_000);
    const { day, hm } = localParts(tz, t);
    if (days.includes(day) && hm >= start && hm < end) return t;
  }
  return from;
}

export function fmtDate(d?: Date | string | null, withTime = false) {
  if (!d) return "—";
  const x = new Date(d);
  return x.toLocaleString("en-US", withTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
}

export function ago(d?: Date | string | null) {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export function fill(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
