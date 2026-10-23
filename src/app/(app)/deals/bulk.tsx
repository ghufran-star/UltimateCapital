"use client";

import { useEffect, useRef, useState } from "react";

/** Adds the ticked table rows (checkboxes with class `tickClass`) to the enclosing form when it is submitted. */
export function BulkIdsClient({ tickClass = "deal-tick", name = "ids" }: { tickClass?: string; name?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onData = (e: FormDataEvent) => {
      document.querySelectorAll<HTMLInputElement>(`.${tickClass}:checked`).forEach((cb) => e.formData.append(name, cb.value));
    };
    const onChange = () => setCount(document.querySelectorAll(`.${tickClass}:checked`).length);
    form.addEventListener("formdata", onData);
    document.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("formdata", onData);
      document.removeEventListener("change", onChange);
    };
  }, [tickClass, name]);
  return (
    <span ref={ref} className="text-xs text-muted">
      {count} selected
    </span>
  );
}

/** Header checkbox: tick or untick every row. */
export function SelectAll({ tickClass = "deal-tick" }: { tickClass?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="h-4 w-4"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`.${tickClass}`).forEach((cb) => (cb.checked = e.target.checked));
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}
