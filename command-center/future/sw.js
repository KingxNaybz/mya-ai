/**
 * Mya Command Center service worker — APP SHELL ONLY.
 *
 * Hard rules:
 *   - Never intercepts, caches, or replays anything under /api/. Business
 *     data and auth always go straight to the network, so the only "offline"
 *     data behavior is the shell's own Not connected / Stale states.
 *   - Only same-origin GETs for files inside this directory are handled.
 *   - Network-first: a new deployment is always picked up on the next
 *     online load (the cache is a fallback, never the primary source), which
 *     avoids the stale-asset problem Builds 9-12 had to work around.
 *
 * Bump CACHE_VERSION whenever SHELL_ASSETS changes.
 */
var CACHE_VERSION = "mya-cc-shell-v21";
var SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=21",
  "./core.css?v=21",
  "./lib.js?v=21",
  "./mya-events.js?v=21",
  "./core.js?v=21",
  "./data.js?v=21",
  "./chat.js?v=21",
  "./presence.js?v=21",
  "./ask-about.js?v=21",
  "./views.js?v=21",
  "./shell.js?v=21",
  "./app.js?v=21",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k.indexOf("mya-cc-shell-") === 0 && k !== CACHE_VERSION;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

var SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return; // never touch business data or auth
  if (url.pathname.indexOf(SCOPE_PATH) !== 0) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: req.mode === "navigate" })
          .then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("./index.html") : null); })
          .then(function (res) { return res || Response.error(); });
      })
  );
});
