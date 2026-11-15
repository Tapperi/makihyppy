// Service worker: peli toimii ilman verkkoa asennuksen jälkeen.
// Strategia: verkko ensin (uusin versio aina kun yhteys on), välimuisti varalla.
// Kasvata VERSION-arvoa, kun tiedostolista muuttuu.

const VERSION = 'tuulimaki-v4';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/config.js',
  'js/util.js',
  'js/hill.js',
  'js/wind.js',
  'js/physics.js',
  'js/scoring.js',
  'js/jump.js',
  'js/input.js',
  'js/storage.js',
  'js/leaderboard.js',
  'js/ui.js',
  'js/render/scene.js',
  'js/render/jumper.js',
  'js/render/hud.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
