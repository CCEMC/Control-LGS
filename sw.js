// Servis çalışanı: oyunu çevrimdışı çalıştırır. Dosyaları değiştirince VERSION'ı arttır.
const VERSION = 'clgs-v35'; // js/net.js içindeki BUILD ile aynı olmalı (çevrimiçi sürüm kontrolü)
const FONTS = 'clgs-fonts'; // yazı tipi önbelleği sürüm değişince silinmez (çevrimdışı yazı tipleri kalsın)
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/util.js', './js/mapgen.js', './js/game.js', './js/bot.js', './js/terrain.js', './js/render.js', './js/audio.js', './js/ui.js', './js/net.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: önce önbellek, arkada güncelle
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Uygulama dosyaları: ağ öncelikli (HTTP önbelleğini atlayıp sunucudan doğrula), ağ yoksa önbellek
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
