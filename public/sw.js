const CACHE_NAME = "qwq-music-shell-v4";
const OFFLINE_URL = "/offline";

const ASSET_CACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  /*
   * 不缓存 API 和 Next.js 构建文件。
   *
   * /_next/static 的文件本身已经包含内容哈希，
   * 交给浏览器和 Next.js 管理，避免 Service Worker
   * 长期返回旧 CSS 或旧 JavaScript。
   */
  if (
    isSameOrigin &&
    (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/_next/")
    )
  ) {
    return;
  }

  // 页面请求使用网络优先，离线时才显示离线页面。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );

    return;
  }

  // 只缓存固定的 PWA 图标和清单。
  const isPwaAsset =
    isSameOrigin &&
    (
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest"
    );

  if (!isPwaAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const responseCopy = response.clone();

          void caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, responseCopy));
        }

        return response;
      });
    })
  );
});