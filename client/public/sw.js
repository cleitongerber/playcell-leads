const CACHE = "fluxo-app-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/brand/fluxo-logo.png", "/brand/fluxo-symbol.png", "/icons/favicon-16.png", "/icons/favicon-32.png", "/icons/apple-touch-icon.png", "/icons/fluxo-symbol-192.png", "/icons/fluxo-symbol-512.png", "/icons/fluxo-symbol-maskable-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).pathname.startsWith("/assets/")) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => cached || new Response("Offline", { status: 503 }))));
});
