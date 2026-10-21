/*
 * Offline support: keeps a copy of the game on the device so it starts without a connection
 * (solo and story; multiplayer still needs the network).
 *
 * - The page itself: network first, so a new deploy shows up on the next online launch; the saved copy
 *   when offline or when the network is too slow.
 * - Built files (assets/, names contain a content hash, never change): saved copy first.
 * - Anything else from this site and the Google font: saved copy at once, refreshed in the background.
 *
 * The page sends the list of files the current build loaded ("warm"), so the very first visit
 * (before this worker was in control) is saved too, and files from older builds get dropped.
 */
const CACHE = 'bamboo-bloodbath-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
/** After this long without an answer, a page load falls back to the saved copy. */
const NETWORK_TIMEOUT_MS = 4000;

const scopeUrl = self.registration.scope;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.t === 'warm' && Array.isArray(msg.urls)) event.waitUntil(warm(msg.urls));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return; // PeerJS and friends: network only
  // Streamed audio asks for byte ranges, which the cache can't answer: network only (offline, the menu
  // falls back to the synth tune).
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    event.respondWith(pageFirstFromNetwork(req));
  } else if (sameOrigin && url.pathname.includes('/assets/')) {
    event.respondWith(savedFirst(req));
  } else {
    event.respondWith(savedThenRefresh(req, event));
  }
});

async function pageFirstFromNetwork(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    // Saved under the start URL, so any page URL in scope (./, ./index.html, ?query) finds it offline.
    if (res.ok) cache.put(scopeUrl, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // Offline: fall through to the saved copy.
  }
  const saved = await cache.match(scopeUrl);
  return saved || network; // nothing saved yet: keep waiting for the network
}

async function savedFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function savedThenRefresh(req, event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  });
  if (saved) {
    event.waitUntil(refresh.catch(() => undefined));
    return saved;
  }
  return refresh;
}

/** Saves every file the current build uses, and forgets built files from older builds. */
async function warm(urls) {
  const cache = await caches.open(CACHE);
  const wanted = new Set(urls);
  // The page itself: on the first visit it loaded before this worker was in control.
  if (!(await cache.match(scopeUrl))) {
    try {
      const res = await fetch(scopeUrl);
      if (res.ok) await cache.put(scopeUrl, res);
    } catch {
      // Offline: saved on the next online launch.
    }
  }
  await Promise.all(
    urls.map(async (u) => {
      if (await cache.match(u)) return;
      try {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch {
        // Offline right now: it'll be saved the next time it's fetched.
      }
    }),
  );
  for (const req of await cache.keys()) {
    const url = new URL(req.url);
    if (url.origin === self.location.origin && url.pathname.includes('/assets/') && !wanted.has(req.url)) {
      await cache.delete(req);
    }
  }
}
