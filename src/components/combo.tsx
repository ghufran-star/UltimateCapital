"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Option } from "@/lib/catalog";

/**
 * Searchable dropdown. Single or multiple choice, typed filtering, keyboard support.
 * Form value: one hidden input per selected key under `name`
 * (or one comma-joined input when `joined`, for fields parsed as a list).
 */
export function Combo({
  name,
  options,
  defaultValue,
  value: controlled,
  onChange,
  multiple = false,
  joined = false,
  placeholder = "Search…",
  emptyLabel,
  required = false,
  disabled = false,
  allowCustom = false,
  className = "",
}: {
  name?: string;
  options: Option[];
  defaultValue?: string | string[] | null;
  value?: string[];
  onChange?: (keys: string[]) => void;
  multiple?: boolean;
  joined?: boolean;
  placeholder?: string;
  emptyLabel?: string; // single choice: label for "none" (adds a clear option)
  required?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
  className?: string;
}) {
  const initial = Array.isArray(defaultValue) ? defaultValue.filter(Boolean) : defaultValue ? [defaultValue] : [];
  const [inner, setInner] = useState<string[]>(initial);
  const selected = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const set = (keys: string[]) => {
    if (!controlled) setInner(keys);
    onChange?.(keys);
  };
  const labelOf = (k: string) => options.find((o) => o.key === k)?.label || k;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? options.filter((o) => `${o.label} ${o.key} ${o.group || ""} ${o.hint || ""}`.toLowerCase().includes(t)) : options;
    const list = emptyLabel && !multiple ? [{ key: "", label: emptyLabel }, ...base] : base;
    if (allowCustom && t && !options.some((o) => o.label.toLowerCase() === t || o.key.toLowerCase() === t)) return [...list, { key: q.trim(), label: `Use "${q.trim()}"` }];
    return list;
  }, [q, options, emptyLabel, multiple, allowCustom]);

  useEffect(() => setHi(0), [q, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (k: string) => {
    if (multiple) {
      set(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
      setQ("");
      input.current?.focus();
    } else {
      set(k ? [k] : []);
      setQ("");
      setOpen(false);
    }
  };

  const single = !multiple && selected[0] ? labelOf(selected[0]) : "";
  let lastGroup: string | undefined;

  return (
    <div ref={box} className={`relative ${className}`}>
      <div
        className={`field flex min-h-[42px] flex-wrap items-center gap-1 ${disabled ? "opacity-60" : "cursor-text"}`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          input.current?.focus();
        }}
      >
        {multiple &&
          selected.map((k) => (
            <span key={k} className="badge badge-good">
              {labelOf(k)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(k)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(k);
                  }}
                  className="ml-0.5"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        <input
          ref={input}
          disabled={disabled}
          value={open ? q : multiple ? q : single}
          placeholder={multiple ? (selected.length ? "" : placeholder) : single || placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(h + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (open && filtered[hi]) {
                e.preventDefault();
                pick(filtered[hi].key);
              }
            } else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && multiple && !q && selected.length) set(selected.slice(0, -1));
          }}
          className="min-w-[6rem] flex-1 bg-transparent outline-none"
          autoComplete="off"
          aria-expanded={open}
          role="combobox"
        />
        <span className="pointer-events-none text-xs text-muted">▾</span>
      </div>
      {open && !disabled && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-lg">
          {filtered.length ? (
            filtered.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const on = selected.includes(o.key);
              return (
                <li key={`${o.key}-${i}`}>
                  {head && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{head}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setHi(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.key)}
                    className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === hi ? "bg-soft" : ""}`}
                  >
                    <span className="w-4 shrink-0 text-brand">{on ? "✓" : ""}</span>
                    <span>
                      {o.label}
                      {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-3 py-2 text-sm text-muted">No match</li>
          )}
        </ul>
      )}
      {name &&
        (joined || !multiple ? (
          <input type="hidden" name={name} value={selected.join(",")} required={required} />
        ) : (
          selected.map((k) => <input key={k} type="hidden" name={name} value={k} />)
        ))}
    </div>
  );
}
