/* Service worker for the Estancia notice board — APP SHELL ONLY.

   This worker deliberately caches *only* the page itself (index.html, viewer.js
   and the logo) so the board can load with no internet at startup. It never
   caches your slides or config — those stay 100% network-fresh when online, so
   there is no risk of a stale slide being served.

   The single "offline backup" slide is cached separately by viewer.js (in
   Cache Storage) and the admin "Clear Offline Cache" button wipes everything,
   including this shell cache, on the next connection.

   Strategy: network-first for the shell (always fresh online), fall back to the
   cached copy only when the network is unreachable. */

const VERSION = "v1";
const SHELL_CACHE = "nb-shell-" + VERSION;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./viewer.js",
  "./images/estancialogo.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Don't let one missing asset abort the whole precache.
      .then(cache => Promise.all(SHELL_ASSETS.map(url => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith("nb-shell-") && k !== SHELL_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Only ever touch same-origin requests. Slides/config/GitHub API pass straight
  // through to the network, untouched.
  if (url.origin !== self.location.origin) return;

  const isShellAsset =
    req.mode === "navigate" ||
    /\/(index\.html)?$/.test(url.pathname) ||
    /viewer\.js$/.test(url.pathname) ||
    /estancialogo\.png$/.test(url.pathname);

  if (!isShellAsset) return;   // anything else: normal network

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === "navigate") {
      const idx = (await cache.match("./index.html")) || (await cache.match("./"));
      if (idx) return idx;
    }
    throw e;
  }
}
