// DreamBrothers Hub — service worker.
// Bumpa VERSION a ogni deploy che cambia la shell: il vecchio cache viene buttato
// in activate e i client ripartono puliti.
const VERSION = "v2";
const SHELL_CACHE = `dbhub-shell-${VERSION}`;
const ASSET_CACHE = `dbhub-assets-${VERSION}`;
// SHELL_URL è la copia viva dell'app (aggiornata a ogni navigazione riuscita);
// OFFLINE_URL è la paginetta statica, ultima spiaggia se non c'è ancora una shell.
const SHELL_URL = "/index.html";
const OFFLINE_URL = "/offline.html";

// La shell minima da avere sempre sottomano.
const SHELL_ASSETS = [OFFLINE_URL, "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Gli asset buildati da Vite sono hashati: /assets/index-a1b2c3.js.
function isStaticAsset(url) {
  return url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/icons/")
    || /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|ico)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Le API non si cachano MAI: sono dati vivi (sessioni, messaggi, KPI).
  // Una risposta stale qui è peggio di un errore.
  if (url.pathname.startsWith("/api/")) return;
  // il piano di DreamMap (/piano/) e' un'altra app: non entra nella shell dell'Hub
  if (url.pathname.startsWith("/piano/")) return;

  // Navigazioni: network-first, con la shell offline come rete di salvataggio.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => (await caches.match(SHELL_URL)) || (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  // Asset: stale-while-revalidate — si serve subito la copia, si aggiorna dietro.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
