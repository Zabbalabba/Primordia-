// Offline cache for the installed app. Generated from tools/sw-template.js
// by `npm run build`: do not edit sw.js by hand.
//
// Strategy: network first (so updates arrive as soon as you are online),
// falling back to the cache when offline or when the network is slow.
// Cache names start with "primordia-" because a GitHub Pages address is
// shared by all of an account's projects: other apps' caches are left alone.

const VERSION = "52764712c6e7";
const CACHE = `primordia-${VERSION}`;
const FONT_CACHE = 'primordia-fonts';
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "js/ai.js",
  "js/audio.js",
  "js/biology.js",
  "js/cellDraw.js",
  "js/eco.js",
  "js/editor.js",
  "js/environment.js",
  "js/foodDraw.js",
  "js/genome.js",
  "js/hud.js",
  "js/main.js",
  "js/parts.js",
  "js/pressures.js",
  "js/render.js",
  "js/save.js",
  "js/species.js",
  "js/util.js",
  "js/vision.js",
  "js/world.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-32.png",
  "icons/icon-512.png"
];
const SLOW_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('primordia-') && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

async function fromCache(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
  return null;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  // On a slow connection, answer from the cache after a few seconds.
  const slow = new Promise((resolve) => setTimeout(resolve, SLOW_MS, 'slow'));
  try {
    const first = await Promise.race([network, slow]);
    if (first !== 'slow') return first;
    const cached = await fromCache(req);
    return cached || (await network);
  } catch {
    const cached = await fromCache(req);
    return cached || new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}
