/* Versecue service worker — cache everything, serve from cache first,
   so the app works with zero network in the karaoke room. */

const CACHE = 'versecue-v10';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/state.js',
  './js/ui-core.js',
  './js/translit.js',
  './js/tokenize.js',
  './js/library.js',
  './js/editor.js',
  './js/perform.js',
  './js/perform-youtube.js',
  './js/sharing.js',
  './js/main.js',
  './manifest.webmanifest',
  './lib/kuromoji.js',
  './lib/pinyin-pro.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.ico',
  './dict/base.dat.gz',
  './dict/cc.dat.gz',
  './dict/check.dat.gz',
  './dict/tid.dat.gz',
  './dict/tid_map.dat.gz',
  './dict/tid_pos.dat.gz',
  './dict/unk.dat.gz',
  './dict/unk_char.dat.gz',
  './dict/unk_compat.dat.gz',
  './dict/unk_invoke.dat.gz',
  './dict/unk_map.dat.gz',
  './dict/unk_pos.dat.gz',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
