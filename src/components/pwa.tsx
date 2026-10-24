"use client";

import { useEffect, useState } from "react";
import { removePushAction, savePushAction } from "../app/actions/push";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker once the app loads (makes it installable and able to receive alerts). */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
    const keep = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __bip?: BIP }).__bip = e as BIP;
      window.dispatchEvent(new Event("uc-installable"));
    };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  return null;
}

const toKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
};

/** Install the app + turn alerts on/off for this device. */
export function PushSetup({ publicKey, topics }: { publicKey: string; topics: string[] }) {
  const [state, setState] = useState<"loading" | "unsupported" | "ios_install" | "denied" | "off" | "on">("loading");
  const [msg, setMsg] = useState("");
  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const sa = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(sa);
    setInstallable(Boolean((window as unknown as { __bip?: BIP }).__bip));
    const on = () => setInstallable(true);
    window.addEventListener("uc-installable", on);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !sa ? "ios_install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
    return () => window.removeEventListener("uc-installable", on);
  }, []);

  const install = async () => {
    const e = (window as unknown as { __bip?: BIP }).__bip;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    setInstallable(false);
  };

  const enable = async () => {
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
      const r = await savePushAction(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, topics, `${navigator.platform || ""} ${/mobile/i.test(navigator.userAgent) ? "phone" : "browser"}`.trim());
      if (r?.error) throw new Error(r.error);
      setState("on");
      setMsg(r?.message || "Alerts are on");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await removePushAction(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
    setMsg("Alerts are off for this device");
  };

  return (
    <div className="space-y-3 text-sm">
      {!standalone && (
        <div className="rounded-xl bg-soft p-3">
          <div className="font-medium">Install the app</div>
          {installable ? (
            <button type="button" onClick={install} className="btn btn-primary btn-sm mt-2">
              Install UltimateCapital
            </button>
          ) : (
            <p className="mt-1 text-muted">
              iPhone/iPad: open this site in Safari, tap Share → <b>Add to Home Screen</b>. Android/Chrome: menu → <b>Install app</b>. Desktop Chrome/Edge: the install icon in the address bar.
            </p>
          )}
        </div>
      )}
      <div>
        <div className="font-medium">Alerts on this device</div>
        {state === "loading" && <p className="text-muted">Checking…</p>}
        {state === "unsupported" && <p className="text-muted">This browser can&apos;t receive push alerts. Use Chrome, Edge, Firefox or Safari (on iPhone, install the app to your Home Screen first).</p>}
        {state === "ios_install" && <p className="text-muted">On iPhone and iPad, alerts work once the app is on your Home Screen (iOS 16.4 or later). Add it, open it from the Home Screen, then come back here.</p>}
        {state === "denied" && <p className="text-bad">Alerts are blocked for this site. Allow notifications in your browser or phone settings, then reload.</p>}
        {state === "off" && (
          <button type="button" onClick={enable} className="btn btn-primary btn-sm mt-1">
            Turn on alerts
          </button>
        )}
        {state === "on" && (
          <div className="mt-1 flex items-center gap-3">
            <span className="text-brand">✓ On</span>
            <button type="button" onClick={disable} className="underline text-muted">
              Turn off on this device
            </button>
          </div>
        )}
        {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
      </div>
    </div>
  );
}
