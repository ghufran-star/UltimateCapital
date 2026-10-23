"use client";

import { useState } from "react";

type Row = { name: string; email: string; phone: string };

/** Signer rows typed in by hand: name, email, mobile. Each row signs as Signer 1, 2, 3… */
export function SignerRows({ initial = [] }: { initial?: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ name: "", email: "", phone: "" }]);
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[110px_1fr_1fr_1fr_auto]">
          <div className="self-center text-sm font-medium">Signer {i + 1}</div>
          <input type="hidden" name="role" value={`signer${i + 1}`} />
          <input name="name" value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Full name" className="field" />
          <input name="email" value={r.email} onChange={(e) => set(i, "email", e.target.value)} placeholder="Email" type="email" className="field" />
          <input name="phone" value={r.phone} onChange={(e) => set(i, "phone", e.target.value)} placeholder="Mobile (for the link by text)" type="tel" className="field" />
          {rows.length > 1 ? (
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm self-center" aria-label={`Remove signer ${i + 1}`}>
              ✕
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {rows.length < 4 && (
        <button type="button" onClick={() => setRows([...rows, { name: "", email: "", phone: "" }])} className="btn btn-ghost btn-sm">
          + Add signer
        </button>
      )}
    </div>
  );
}
