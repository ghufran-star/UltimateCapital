"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export type ActionState = { ok?: boolean; message?: string; error?: string; redirect?: string } | null;

export function Submit({ children, className = "btn btn-primary", pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? pendingText || "Working…" : children}
    </button>
  );
}

/** A form bound to a server action that returns ActionState; shows the result inline. */
export function ActionForm({
  action,
  children,
  className = "space-y-3",
  resetOnOk = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnOk?: boolean;
}) {
  const router = useRouter();
  const [state, run] = useActionState(action, null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (state?.redirect) router.push(state.redirect);
    else if (state?.ok) {
      router.refresh();
      if (resetOnOk) setKey((k) => k + 1);
    }
  }, [state, router, resetOnOk]);
  return (
    <form key={key} action={run} className={className}>
      {children}
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-brand">{state.message}</p>}
    </form>
  );
}

/** Single-button action with optional confirmation. */
export function ActionButton({
  action,
  children,
  className = "btn btn-ghost btn-sm",
  confirm: confirmText,
  hidden,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  hidden?: Record<string, string>;
}) {
  const router = useRouter();
  const [state, run, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.redirect) router.push(state.redirect);
    else if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className="inline"
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={className} disabled={pending} title={state?.error || state?.message}>
        {pending ? "…" : children}
      </button>
      {state?.error && <span className="ml-2 text-xs text-bad">{state.error}</span>}
      {state?.ok && state.message && <span className="ml-2 text-xs text-brand">{state.message}</span>}
    </form>
  );
}

export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr className="link" onClick={() => router.push(href)}>
      {children}
    </tr>
  );
}

export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
