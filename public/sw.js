// UltimateCapital service worker: push alerts, and an offline page when there's no connection.
const OFFLINE = "/offline.html";
const CACHE = "uc-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Pages always come from the network (the data must be live); only a failed navigation shows the offline page.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener("push", (e) => {
  let m = { title: "UltimateCapital", body: "", href: "/alerts", tag: "other" };
  try {
    m = { ...m, ...e.data.json() };
  } catch {
    if (e.data) m.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: m.tag === "approvals" ? undefined : m.tag,
      data: { href: m.href || "/alerts" },
      requireInteraction: m.tag === "approvals",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || "/alerts";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c && new URL(c.url).origin === self.location.origin) {
          c.navigate(href);
          return c.focus();
        }
      }
      return self.clients.openWindow(href);
    })
  );
});
