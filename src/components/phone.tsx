"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callOutcomeAction, pretendCallAction, ringMyPhoneAction } from "../app/actions/calls";

// The in-app phone: press Call, talk through your computer or phone browser, hang up,
// then one tap to say what happened. Test mode gets a pretend call that goes through the same steps.

type Step = "idle" | "starting" | "ringing" | "live" | "ended" | "error";
type TwilioCall = { on: (e: string, f: (...a: unknown[]) => void) => void; disconnect: () => void; mute: (m: boolean) => void; isMuted: () => boolean };

const OUTCOMES = [
  { key: "interested", label: "Interested", cls: "btn-primary" },
  { key: "callback", label: "Call back", cls: "btn-ghost" },
  { key: "not_now", label: "Not now", cls: "btn-ghost" },
  { key: "price_high", label: "Price too high", cls: "btn-ghost" },
  { key: "not_interested", label: "Not interested", cls: "btn-ghost" },
  { key: "no_answer", label: "No answer", cls: "btn-ghost" },
  { key: "voicemail", label: "Left voicemail", cls: "btn-ghost" },
  { key: "wrong_number", label: "Wrong number", cls: "btn-ghost" },
] as const;

let busy = false;
let device: { connect: (o: { params: Record<string, string> }) => Promise<TwilioCall>; destroy: () => void } | null = null;
let deviceAt = 0;

export function CallButton({ contactId, name, phone, opportunityId, label = "Call", size = "md", className, memberId, campaignId }: { contactId: string; name: string; phone?: string | null; opportunityId?: string; label?: string; size?: "sm" | "md" | "lg"; className?: string; memberId?: string; campaignId?: string }) {
  const [open, setOpen] = useState(false);
  if (!phone) return null;
  const cls = className || (size === "lg" ? "btn btn-primary w-full py-3 text-base" : size === "sm" ? "btn btn-ghost btn-sm" : "btn btn-primary");
  return (
    <>
      <button
        type="button"
        data-stop
        className={cls}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (busy) return alertOnce();
          setOpen(true);
        }}
      >
        <PhoneIcon /> {label}
      </button>
      {open && <CallPanel contactId={contactId} name={name} phone={phone} opportunityId={opportunityId} memberId={memberId} campaignId={campaignId} onClose={() => setOpen(false)} />}
    </>
  );
}

function alertOnce() {
  window.dispatchEvent(new CustomEvent("uc-toast", { detail: "Finish the current call first." }));
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function CallPanel({ contactId, name, phone, opportunityId, memberId, campaignId, onClose }: { contactId: string; name: string; phone: string; opportunityId?: string; memberId?: string; campaignId?: string; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [pretend, setPretend] = useState(false);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interactionId, setInteractionId] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [cb, setCb] = useState(false);
  const [saving, setSaving] = useState(false);
  const call = useRef<TwilioCall | null>(null);
  const key = useRef(`k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const started = useRef(0);

  useEffect(() => {
    busy = true;
    void start();
    return () => {
      busy = false;
      call.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step !== "live") return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [step]);

  async function start() {
    setStep("starting");
    setError("");
    try {
      const r = await fetch("/api/voice/token");
      const j = (await r.json()) as { token?: string; demo?: boolean; error?: string };
      if (j.demo) {
        setPretend(true);
        setTimeout(() => setStep("ringing"), 900);
        setTimeout(() => {
          started.current = Date.now();
          setStep("live");
        }, 2600);
        return;
      }
      if (!r.ok || !j.token) throw new Error(j.error || "In-app calling isn't set up yet.");
      if (!device || Date.now() - deviceAt > 50 * 60_000) {
        device?.destroy();
        const { Device } = await import("@twilio/voice-sdk");
        device = new Device(j.token, { logLevel: 1 }) as unknown as typeof device;
        deviceAt = Date.now();
      }
      const c = await device!.connect({ params: { contactId, opportunityId: opportunityId || "", callKey: key.current } });
      call.current = c;
      setStep("ringing");
      c.on("accept", () => {
        started.current = Date.now();
        setStep("live");
      });
      const end = () => setStep("ended");
      c.on("disconnect", end);
      c.on("cancel", end);
      c.on("reject", end);
      c.on("error", (e: unknown) => {
        setError((e as { message?: string })?.message || "The call failed.");
        setStep("error");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  async function hangUp() {
    if (pretend) {
      const r = await pretendCallAction({ contactId, opportunityId, seconds: (Date.now() - started.current) / 1000 });
      if (r.interactionId) setInteractionId(r.interactionId);
      setStep("ended");
      return;
    }
    call.current?.disconnect();
    setStep("ended");
  }

  async function ringMe() {
    setError("");
    const r = await ringMyPhoneAction({ contactId, opportunityId });
    if (r.error) return setError(r.error);
    if (r.interactionId) setInteractionId(r.interactionId);
    setError(r.message || "");
    setStep("ended");
  }

  async function save(outcome: string, when?: Date) {
    setSaving(true);
    const r = await callOutcomeAction({ contactId, opportunityId, interactionId, callKey: key.current, outcome, note: note || undefined, callbackAt: when?.toISOString(), memberId, campaignId });
    setSaving(false);
    if (r.error) return setError(r.error);
    window.dispatchEvent(new CustomEvent("uc-toast", { detail: r.message || "Saved" }));
    onClose();
    router.refresh();
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const later = (h: number) => new Date(Date.now() + h * 3600_000);
  const tomorrow = () => {
    const d = new Date(Date.now() + 864e5);
    d.setHours(10, 0, 0, 0);
    return d;
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 pb-[max(12px,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-4 md:right-4 md:w-96 md:p-0" onClick={(e) => e.stopPropagation()} data-stop>
      <div className="card overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-2 bg-ink px-4 py-3 text-bg">
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-xs opacity-75">{phone}</div>
          </div>
          <div className="text-right text-xs">
            {step === "starting" && "Connecting…"}
            {step === "ringing" && "Ringing…"}
            {step === "live" && <span className="tnum text-base font-semibold">{mm}</span>}
            {step === "ended" && "Call ended"}
            {step === "error" && "Not connected"}
          </div>
        </div>
        <div className="space-y-3 p-4">
          {pretend && step !== "ended" && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Test mode: pretend call, no sound.</p>}

          {(step === "starting" || step === "ringing" || step === "live") && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-ghost py-3"
                disabled={step !== "live"}
                onClick={() => {
                  if (!call.current) return setMuted(!muted);
                  call.current.mute(!call.current.isMuted());
                  setMuted(call.current.isMuted());
                }}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button type="button" className="btn btn-danger py-3" onClick={hangUp}>
                Hang up
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-bad">{error}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-primary" onClick={ringMe}>
                  Ring my phone instead
                </button>
                <button type="button" className="btn btn-ghost" onClick={start}>
                  Try again
                </button>
              </div>
              <button type="button" className="w-full text-center text-xs text-muted underline" onClick={() => setStep("ended")}>
                I called from my own phone: log what happened
              </button>
            </div>
          )}

          {step === "ended" && (
            <div className="space-y-2">
              {error && <p className="text-sm text-muted">{error}</p>}
              <div className="text-sm font-semibold">What happened?</div>
              {!cb ? (
                <div className="grid grid-cols-2 gap-2">
                  {OUTCOMES.map((o) => (
                    <button key={o.key} type="button" disabled={saving} className={`btn ${o.cls} py-2.5`} onClick={() => (o.key === "callback" ? setCb(true) : save(o.key))}>
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => save("callback", later(1))}>
                    In 1 hour
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => save("callback", tomorrow())}>
                    Tomorrow
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => save("callback", later(24 * 7))}>
                    Next week
                  </button>
                </div>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="field" placeholder="Notes (optional): price, timeline, condition…" />
              <button type="button" className="w-full text-center text-xs text-muted underline" onClick={onClose}>
                Close without saving
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small confirmation messages ("Saved: Interested"). Mounted once in the layout. */
export function Toaster() {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const h = (e: Event) => {
      setMsg(String((e as CustomEvent).detail || ""));
      clearTimeout(t);
      t = setTimeout(() => setMsg(""), 3500);
    };
    window.addEventListener("uc-toast", h);
    return () => window.removeEventListener("uc-toast", h);
  }, []);
  if (!msg) return null;
  return <div className="fixed inset-x-0 bottom-20 z-[70] mx-auto w-fit max-w-[90vw] rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg md:bottom-6">{msg}</div>;
}
