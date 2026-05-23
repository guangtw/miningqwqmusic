const CACHE_NAME = "qwq-music-shell-v2";
const OFFLINE_URL = "/offline";
const ASSET_CACHE = ["/offline", "/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSET_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isApiRequest = isSameOrigin && requestUrl.pathname.startsWith("/api/");
  if (isApiRequest) return;

  const isPageRequest = request.mode === "navigate";
  if (isPageRequest) {
    // Keep HTML network-first and do not cache page responses.
    // This avoids stale SSR HTML causing hydration mismatches with fresh JS bundles.
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  const isStaticAsset =
    isSameOrigin &&
    (requestUrl.pathname.startsWith("/_next/static/") ||
      requestUrl.pathname.startsWith("/icons/") ||
      requestUrl.pathname === "/manifest.webmanifest");
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          if (response.ok) {
            cache.put(request, responseClone);
          }
        });
        return response;
      });
    })
  );
});
