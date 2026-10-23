"use client";

import { useEffect, useRef, useState } from "react";

/** Draw-or-type signature. Writes a PNG data URL (or "typed:Name") into a hidden input. */
export function SignaturePad({ name = "signature", label = "Signature", defaultTyped = "" }: { name?: string; label?: string; defaultTyped?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [value, setValue] = useState("");
  const [typed, setTyped] = useState(defaultTyped);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ratio = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * ratio;
    cv.height = h * ratio;
    const ctx = cv.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f3a";
  }, [mode]);

  useEffect(() => {
    if (mode === "type") setValue(typed.trim() ? `typed:${typed.trim()}` : "");
  }, [mode, typed]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setMode("draw")} className={`rounded-full px-3 py-1 ${mode === "draw" ? "bg-ink text-bg" : "bg-soft"}`}>
            Draw
          </button>
          <button type="button" onClick={() => setMode("type")} className={`rounded-full px-3 py-1 ${mode === "type" ? "bg-ink text-bg" : "bg-soft"}`}>
            Type
          </button>
        </div>
      </div>
      {mode === "draw" ? (
        <div className="relative">
          <canvas
            ref={ref}
            className="h-36 w-full touch-none rounded-xl border border-dashed border-line bg-white"
            onPointerDown={(e) => {
              drawing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const ctx = e.currentTarget.getContext("2d")!;
              const p = pos(e);
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = e.currentTarget.getContext("2d")!;
              const p = pos(e);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              dirty.current = true;
            }}
            onPointerUp={(e) => {
              drawing.current = false;
              if (dirty.current) setValue(e.currentTarget.toDataURL("image/png"));
            }}
          />
          <span className="pointer-events-none absolute bottom-2 left-3 text-xs text-gray-400">Sign here</span>
          <button
            type="button"
            className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-xs text-gray-600 shadow"
            onClick={() => {
              const cv = ref.current!;
              cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
              dirty.current = false;
              setValue("");
            }}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full legal name" />
          {typed && <div className="rounded-xl border border-line bg-white px-4 py-3 text-3xl text-[#0b1f3a]" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>{typed}</div>}
        </div>
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
