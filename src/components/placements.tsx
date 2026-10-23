"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, Submit, type ActionState } from "./client";

type Placement = { id: string; page: number; x: number; y: number; w: number; h: number; kind: "field" | "sign" | "initial" | "date_signed"; key?: string; role?: string };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (src: string) => { promise: Promise<PdfDoc> } };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } };

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const SCALE = 1.4;
const SIZES: Record<Placement["kind"], [number, number]> = { field: [170, 16], sign: [170, 40], initial: [50, 24], date_signed: [90, 16] };

function loadPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS;
    s.onload = () => {
      const lib = (window as unknown as { pdfjsLib: PdfJs }).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = WORKER;
      resolve(lib);
    };
    s.onerror = () => reject(new Error("Couldn't load the PDF viewer"));
    document.head.appendChild(s);
  });
}

/** Click on the page to place a field or signature box; click a box to remove it. */
export function PlacementEditor({ templateId, initial, fields, roles, action }: { templateId: string; initial: Placement[]; fields: string[]; roles: string[]; action: (p: ActionState, f: FormData) => Promise<ActionState> }) {
  const [items, setItems] = useState<Placement[]>(initial);
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const [tool, setTool] = useState<{ kind: Placement["kind"]; key: string; role: string }>({ kind: "sign", key: fields[0] || "", role: roles[0] || "seller" });
  const [err, setErr] = useState("");
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await loadPdfJs();
        const doc = await lib.getDocument(`/api/templates/${templateId}/pdf`).promise;
        const out: { w: number; h: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: SCALE });
          const canvas = holder.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${i - 1}"]`) || null;
          out.push({ w: vp.width, h: vp.height });
          if (cancelled) return;
          setPages([...out]);
          await new Promise((r) => setTimeout(r, 0));
          const cv = canvas || holder.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${i - 1}"]`);
          if (cv) {
            cv.width = vp.width;
            cv.height = vp.height;
            await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const place = (pageIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.box) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = SIZES[tool.kind];
    const px = (e.clientX - r.left) / SCALE;
    const pyTop = (e.clientY - r.top) / SCALE;
    const pageH = pages[pageIdx].h / SCALE;
    setItems((xs) => [...xs, { id: Math.random().toString(36).slice(2, 9), page: pageIdx, x: Math.round(px), y: Math.round(pageH - pyTop - h), w, h, kind: tool.kind, ...(tool.kind === "field" ? { key: tool.key } : { role: tool.role }) }]);
  };

  const labelOf = (p: Placement) => (p.kind === "field" ? `{{${p.key}}}` : `${p.kind === "sign" ? "Signature" : p.kind === "initial" ? "Initials" : "Date signed"}: ${p.role}`);

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-2 text-sm">
        <select className="field w-auto" value={tool.kind} onChange={(e) => setTool({ ...tool, kind: e.target.value as Placement["kind"] })}>
          <option value="sign">Signature box</option>
          <option value="initial">Initials box</option>
          <option value="date_signed">Date signed</option>
          <option value="field">Field</option>
        </select>
        {tool.kind === "field" ? (
          <select className="field w-auto" value={tool.key} onChange={(e) => setTool({ ...tool, key: e.target.value })}>
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <select className="field w-auto" value={tool.role} onChange={(e) => setTool({ ...tool, role: e.target.value })}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-muted">Click the page to place · click a box to remove · {items.length} placed</span>
        <ActionForm action={action} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="templateId" value={templateId} />
          <input type="hidden" name="placements" value={JSON.stringify(items)} />
          <Submit className="btn btn-primary btn-sm">Save placements</Submit>
        </ActionForm>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
      <div ref={holder} className="space-y-4 overflow-x-auto">
        {pages.map((pg, i) => (
          <div key={i} className="relative mx-auto shadow" style={{ width: pg.w, height: pg.h }} onClick={(e) => place(i, e)}>
            <canvas data-page={i} className="absolute inset-0" />
            {items
              .filter((p) => p.page === i)
              .map((p) => (
                <div
                  key={p.id}
                  data-box="1"
                  title="Click to remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setItems((xs) => xs.filter((x) => x.id !== p.id));
                  }}
                  className={`absolute flex cursor-pointer items-center overflow-hidden rounded border-2 px-1 text-[10px] font-semibold ${p.kind === "field" ? "border-sky-500 bg-sky-500/15 text-sky-800" : "border-amber-500 bg-amber-400/20 text-amber-800"}`}
                  style={{ left: p.x * SCALE, top: pg.h - (p.y + p.h) * SCALE, width: p.w * SCALE, height: p.h * SCALE }}
                >
                  {labelOf(p)}
                </div>
              ))}
          </div>
        ))}
        {!pages.length && !err && <p className="text-sm text-muted">Loading the PDF…</p>}
      </div>
    </div>
  );
}
