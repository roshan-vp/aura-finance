const CACHE_NAME = "aura-app-shell-v1";
const STATIC_FILES = [
  "/manifest.webmanifest",
  "/icons/aura.svg",
  "/icons/aura-180.png",
  "/icons/aura-192.png",
  "/icons/aura-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch("/index.html", { cache: "reload" });
    if (!response.ok) throw new Error("Unable to cache the AURA app shell.");
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin && url.pathname.startsWith("/assets/"));
    await cache.put("/", response.clone());
    await cache.put("/index.html", response.clone());
    for (const asset of assets) {
      const assetResponse = await fetch(asset, { cache: "reload" });
      if (!assetResponse.ok) throw new Error(`Unable to cache ${asset.pathname}.`);
      await cache.put(asset, assetResponse);
    }
    await cache.addAll(STATIC_FILES);
    const retainedPaths = new Set(["/", "/index.html", ...STATIC_FILES, ...assets.map((asset) => asset.pathname)]);
    for (const request of await cache.keys()) {
      if (!retainedPaths.has(new URL(request.url).pathname)) await cache.delete(request);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("aura-app-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.pathname)) || cache.match("/index.html");
    }));
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
