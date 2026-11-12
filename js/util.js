// Ortak yardımcılar: tohumlu rastgele sayı, gürültü, biçimlendirme
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(512);
    const vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { vals[i] = rnd(); perm[i] = i; }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const v = (ix, iy) => vals[perm[perm[ix & 255] + (iy & 255)]];
    const fade = (t) => t * t * (3 - 2 * t);
    function noise(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = v(ix, iy), b = v(ix + 1, iy), c = v(ix, iy + 1), d = v(ix + 1, iy + 1);
      const u = fade(fx), w = fade(fy);
      const top = a + (b - a) * u, bot = c + (d - c) * u;
      return top + (bot - top) * w;
    }
    function fbm(x, y, oct) {
      oct = oct || 4;
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    }
    return { noise, fbm };
  }

  // 12400 -> "12.4k", 15000 -> "15k"
  function fmtK(n) {
    n = Math.max(0, Math.round(n));
    if (n < 1000) return String(n);
    const k = n / 1000;
    if (k >= 100) return Math.round(k) + 'k';
    const r = Math.round(k * 10) / 10;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + 'k';
  }
  function fmtMoney(m) {
    const r = Math.round(m * 10) / 10;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + '₺';
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function hsl(h, s, l, a) {
    return a === undefined ? `hsl(${h},${s}%,${l}%)` : `hsla(${h},${s}%,${l}%,${a})`;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  G.U = { mulberry32, makeNoise, fmtK, fmtMoney, fmtTime, esc, hsl, clamp, dist };
})();
