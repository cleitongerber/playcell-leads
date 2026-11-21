const CACHE = "fluxo-app-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/brand/fluxo-logo.png",
  "/brand/fluxo-symbol.png",
  "/icons/favicon-16.png",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/fluxo-symbol-192.png",
  "/icons/fluxo-symbol-512.png",
  "/icons/fluxo-symbol-maskable-512.png",
];
self.addEventListener("install", event =>
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)))
);
self.addEventListener("activate", event =>
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key !== CACHE).map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
);
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? JSON.parse(event.data.text()) : {};
  } catch {
    // A malformed payload must not break the worker or expose its content.
  }
  const path = typeof payload.path === "string" && /^\/v2\/leads\/\d+$/.test(payload.path)
    ? payload.path
    : "/v2/follow-ups";
  const title = typeof payload.title === "string" && payload.title.length <= 120
    ? payload.title
    : "FLUXO";
  const body = typeof payload.body === "string" && payload.body.length <= 240
    ? payload.body
    : "Você tem um acompanhamento pendente.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/fluxo-symbol-192.png",
      badge: "/icons/fluxo-symbol-maskable-512.png",
      tag: typeof payload.tag === "string" && payload.tag.length <= 120 ? payload.tag : "fluxo-follow-up",
      data: { path },
    })
  );
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const path = typeof event.notification.data?.path === "string" && /^\/v2\/(?:leads\/\d+|follow-ups)$/.test(event.notification.data.path)
    ? event.notification.data.path
    : "/v2/follow-ups";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async windows => {
      const existing = windows.find(client => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (existing) {
        try {
          const navigated = await existing.navigate(target);
          if (navigated) return navigated.focus();
        } catch {
          // A stale client must not prevent the notification from opening FLUXO.
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows =>
      Promise.all(windows.map(client => client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" })))
    )
  );
});
self.addEventListener("fetch", event => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      cached =>
        cached ||
        fetch(event.request)
          .then(response => {
            if (
              response.ok &&
              new URL(event.request.url).pathname.startsWith("/assets/")
            )
              caches
                .open(CACHE)
                .then(cache => cache.put(event.request, response.clone()));
            return response;
          })
          .catch(() => cached || new Response("Offline", { status: 503 }))
    )
  );
});
