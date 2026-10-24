"use client";

import { useState } from "react";

/** On phones the search and filters fold away behind one button; on bigger screens they're always shown. */
export function Filters({ children, active = 0 }: { children: React.ReactNode; active?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(!open)} className="btn btn-ghost w-full md:hidden">
        {open ? "Hide search & filters" : `Search & filter${active ? ` (${active} on)` : ""}`}
      </button>
      <div className={`${open ? "mt-2 block" : "hidden"} md:mt-0 md:block`}>{children}</div>
    </div>
  );
}
