// Service worker: makes the site installable and keeps it usable on a bad connection.
//  - Pages: network first, falling back to the cached app shell when offline.
//  - Built assets (/assets/*, content-hashed): cache first.
//  - Public API reads (search, car pages, dealer pages, site settings): network first, cached copy offline.
//  - Photos: cache first, a limited number kept.
// Nothing private (messages, own listings, moderation) is ever cached.
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const API = `api-${VERSION}`;
const PHOTOS = `photos-${VERSION}`;
const KEEP = [SHELL, ASSETS, API, PHOTOS];

const PUBLIC_API = [/^\/api\/meta$/, /^\/api\/listings(\?|$)/, /^\/api\/listings\/models/, /^\/api\/listings\/[^/]+$/, /^\/api\/dealers\//];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/favicon.svg", "/manifest.webmanifest"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // After sign-out, forget cached API answers (they can carry the member's saved hearts).
  if (event.data && event.data.type === "signed-out") event.waitUntil(caches.delete(API));
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(fallbackUrl ?? request, response.clone());
      if (cacheName === API) trim(API, 150);
    }
    return response;
  } catch (err) {
    const hit = await cache.match(fallbackUrl ?? request);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cacheName, max);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Every page is the same app shell; keep the latest copy for offline starts.
    event.respondWith(networkFirst(request, SHELL, "/"));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSETS, 80));
    return;
  }
  if (url.pathname.startsWith("/api/photos/")) {
    event.respondWith(cacheFirst(request, PHOTOS, 300));
    return;
  }
  const path = url.pathname + url.search;
  if (PUBLIC_API.some((re) => re.test(path))) {
    event.respondWith(networkFirst(request, API));
  }
});
