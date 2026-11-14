// Uydu görünümlü arazi (yalnızca görsel; oyun kurallarını etkilemez).
// Haritanın tohumundan belirleyici olarak üretilir: kıyıdan içeri yükselen arazi, dağ sıraları ve karlı zirveler,
// nem haritasına göre orman / çayır / bozkır / çöl, kumsallar, kuzeybatıdan ışıklı kabartma gölgesi,
// sığdan derine renk değiştiren deniz ve dağlardan denize akan nehirler.
// Hesap küçük dilimler hâlinde yapılır (oyun donmaz); bitince done(sonuç) çağrılır.
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  const TARGET_PX = 560000; // arazi dokusunun piksel bütçesi (harita boyutundan bağımsız)
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

  // renkler (uydu fotoğrafı tonları)
  const C = {
    sand: [208, 192, 146], forest: [44, 82, 40], wood: [62, 98, 48], grass: [102, 128, 64], steppe: [158, 146, 96],
    desert: [196, 176, 126], hill: [112, 104, 72], rock: [116, 104, 90], rockHi: [150, 142, 132], snow: [238, 240, 244],
    foam: [150, 205, 205], shallow: [86, 162, 176], mid: [42, 108, 148], deep: [22, 60, 104],
  };

  // Her katmanı farklı açıyla döndürülmüş fbm: değer gürültüsünün kare ızgara izini gizler
  const ROT = Array.from({ length: 6 }, (_, i) => [Math.cos(0.7 * (i + 1)), Math.sin(0.7 * (i + 1))]);
  function rfbm(n, x, y, oct) {
    let s = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      const xx = x * f, yy = y * f, r = ROT[i];
      s += amp * n.noise(xx * r[0] - yy * r[1] + i * 17.3, xx * r[1] + yy * r[0] - i * 9.1);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  }

  // İki geçişli pah (chamfer) uzaklık dönüşümü: seed=0 olan piksellere uzaklık (piksel cinsinden, ~öklid)
  function distance(isSeed, W, H) {
    const INF = 1e9, d = new Float32Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = isSeed[i] ? 0 : INF;
    const a = 1, b = 1.4142;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = d[i];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + a);
        if (y > 0) {
          v = Math.min(v, d[i - W] + a);
          if (x > 0) v = Math.min(v, d[i - W - 1] + b);
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + b);
        }
        d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = d[i];
        if (v === 0) continue;
        if (x < W - 1) v = Math.min(v, d[i + 1] + a);
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + a);
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + b);
          if (x > 0) v = Math.min(v, d[i + W - 1] + b);
        }
        d[i] = v;
      }
    }
    return d;
  }

  function build(map, done) {
    let cancelled = false;
    const seed = (map.seed >>> 0) || 1;
    const S = Math.min(0.32, Math.sqrt(TARGET_PX / (map.W * map.H))); // doku pikseli / dünya birimi
    const W = Math.max(8, Math.ceil(map.W * S)), H = Math.max(8, Math.ceil(map.H * S));
    const nz = U.makeNoise((seed * 31 + 7) >>> 0);
    const nz2 = U.makeNoise((seed * 17 + 101) >>> 0);
    const rnd = U.mulberry32((seed ^ 0x2545f491) >>> 0);

    // 1) kara maskesi (şehir çokgenleri)
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mx = mc.getContext('2d');
    mx.setTransform(S, 0, 0, S, 0, 0);
    mx.fillStyle = '#fff';
    for (const c of map.cities) {
      mx.beginPath();
      c.outline.forEach((p, i) => (i ? mx.lineTo(p[0], p[1]) : mx.moveTo(p[0], p[1])));
      mx.closePath(); mx.fill();
      mx.lineWidth = 1.5 / S; mx.strokeStyle = '#fff'; mx.stroke(); // hücre aralarında boşluk kalmasın
    }
    const md = mx.getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H), land = new Uint8Array(W * H), sea = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { alpha[i] = md[i * 4 + 3]; land[i] = alpha[i] > 127 ? 1 : 0; sea[i] = 1 - land[i]; }

    const elev = new Float32Array(W * H), moist = new Float32Array(W * H), detail = new Float32Array(W * H);
    let dIn = null, dOut = null;
    const img = new ImageData(W, H);
    const px = img.data;
    const inv = 1 / S; // doku pikseli → dünya birimi

    // adımlar küçük dilimlere bölünür (her dilim ~8 ms)
    const steps = [];
    steps.push(() => { dIn = distance(sea, W, H); });
    steps.push(() => { dOut = distance(land, W, H); });
    const ROWS = 12;
    // 2) yükseklik ve nem
    for (let y0 = 0; y0 < H; y0 += ROWS) {
      steps.push(() => {
        for (let y = y0; y < Math.min(H, y0 + ROWS); y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x, wx = x * inv, wy = y * inv;
            const det = rfbm(nz2, wx / 70, wy / 70, 2);
            detail[i] = det;
            if (!land[i]) { elev[i] = 0; continue; }
            const coast = smooth(0, 560, dIn[i] * inv);
            // dağ sıraları: geniş ölçekte bir maske, içinde sırtlar (ridged gürültü)
            const zone = smooth(0.5, 0.7, rfbm(nz, wx / 1050 + 11.3, wy / 1050 - 4.7, 3));
            const r1 = 1 - Math.abs(2 * rfbm(nz, wx / 330 + 3.1, wy / 330 + 9.2, 4) - 1);
            const ridge = r1 * r1 * r1;
            const r2 = 1 - Math.abs(2 * rfbm(nz2, wx / 115 - 1.7, wy / 115 + 6.1, 3) - 1); // ince sırtlar ve vadiler
            const hills = rfbm(nz2, wx / 210 + 5.5, wy / 210 - 2.2, 3);
            const mz = zone * Math.sqrt(coast);
            let e = 0.05 + 0.3 * coast + mz * (0.56 * ridge + 0.18 * r2 * r2 * (0.4 + ridge)) + 0.16 * (hills - 0.45) * coast + 0.04 * (det - 0.5);
            if (e > 0.8) e = 0.8 + (e - 0.8) * 0.45; // yumuşak tavan: zirveler düz bir plato olmasın
            elev[i] = Math.max(0, e);
            moist[i] = rfbm(nz, wx / 1300 - 7.7, wy / 1300 + 2.9, 3) * 0.85 + 0.15 * (1 - coast) + 0.08 * (hills - 0.5);
          }
        }
      });
    }
    // 3) renk + kabartma gölgesi
    const relief = 0.0055 * inv; // eğim → gölge katsayısı (doku çözünürlüğünden bağımsız)
    const L = [-0.62, -0.62, 0.48]; // ışık: kuzeybatı, yüksek açı
    for (let y0 = 0; y0 < H; y0 += ROWS) {
      steps.push(() => {
        for (let y = y0; y < Math.min(H, y0 + ROWS); y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x, o = i * 4;
            const det = detail[i];
            // deniz rengi: kıyıdan uzaklaştıkça derinleşir
            const dd = dOut[i] * inv;
            let sc = dd < 14 ? mix3(C.foam, C.shallow, dd / 14)
              : dd < 160 ? mix3(C.shallow, C.mid, smooth(14, 160, dd)) : mix3(C.mid, C.deep, smooth(160, 620, dd));
            const sv = 1 + (det - 0.5) * 0.12;
            sc = [sc[0] * sv, sc[1] * sv, sc[2] * sv];
            const a = alpha[i] / 255;
            if (a <= 0) { px[o] = sc[0]; px[o + 1] = sc[1]; px[o + 2] = sc[2]; px[o + 3] = 255; continue; }
            // kara rengi: nem → bitki örtüsü, yükseklik → tepe / kaya / kar
            const e = elev[i], m = moist[i];
            let low = m > 0.6 ? mix3(C.wood, C.forest, smooth(0.6, 0.72, m))
              : m > 0.47 ? mix3(C.grass, C.wood, smooth(0.47, 0.6, m))
                : m > 0.36 ? mix3(C.steppe, C.grass, smooth(0.36, 0.47, m)) : mix3(C.desert, C.steppe, smooth(0.26, 0.36, m));
            let col = low;
            if (e > 0.3) col = mix3(col, C.hill, smooth(0.3, 0.5, e) * (m > 0.55 ? 0.45 : 0.85));
            if (e > 0.5) col = mix3(col, C.rock, smooth(0.5, 0.66, e));
            if (e > 0.66) col = mix3(col, C.rockHi, smooth(0.66, 0.8, e));
            if (e > 0.8) col = mix3(col, C.snow, smooth(0.8, 0.88, e + (det - 0.5) * 0.08)); // yalnızca en yüksek sırtlar karlı
            const din = dIn[i] * inv;
            if (din < 22 && e < 0.25) col = mix3(C.sand, col, smooth(6, 22, din + (det - 0.5) * 10)); // kumsal
            // kabartma: komşu yüksekliklerden eğim
            const xl = x > 0 ? elev[i - 1] : e, xr = x < W - 1 ? elev[i + 1] : e;
            const yu = y > 0 ? elev[i - W] : e, yd = y < H - 1 ? elev[i + W] : e;
            const nx = -(xr - xl) / relief, ny = -(yd - yu) / relief;
            const nl = Math.hypot(nx, ny, 1);
            const lam = (nx * L[0] + ny * L[1] + L[2]) / nl;
            const sh = 0.38 + 1.08 * Math.max(0, lam);
            const v = sh * (1 + (det - 0.5) * 0.14);
            const lr = col[0] * v, lg = col[1] * v, lb = col[2] * v;
            // kıyı kenarı: kara/deniz kısmi piksellerde karışım
            px[o] = lerp(sc[0], lr, a); px[o + 1] = lerp(sc[1], lg, a); px[o + 2] = lerp(sc[2], lb, a); px[o + 3] = 255;
          }
        }
      });
    }
    // 4) nehirler: yüksek noktalardan en dik inişle denize (dünya koordinatında çizgiler)
    const rivers = [];
    steps.push(() => {
      const landCount = land.reduce((s, v) => s + v, 0);
      const want = Math.max(4, Math.min(16, Math.round(landCount / 22000)));
      const used = new Uint8Array(W * H);
      let maxIn = 0; for (let i = 0; i < W * H; i++) if (dIn[i] > maxIn) maxIn = dIn[i];
      const inland = Math.min(260, maxIn * inv * 0.4); // küçük haritalarda da nehir çıksın
      const nb = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      // Kaynak: iç kesimde yüksekçe bir nokta. Yön: her adımda kıyıya biraz daha yaklaşan komşulardan en alçağı
      // (kıyı uzaklığı hep azaldığı için nehir mutlaka denize ulaşır; yükseklik tercihi vadileri izletir).
      for (let tries = 0; rivers.length < want && tries < want * 60; tries++) {
        const sx = Math.floor(rnd() * W), sy = Math.floor(rnd() * H), s0 = sy * W + sx;
        if (!land[s0] || used[s0] || elev[s0] < 0.26 || dIn[s0] * inv < inland) continue;
        const path = [[sx, sy]];
        let x = sx, y = sy, ok = false;
        for (let k = 0; k < 2000; k++) {
          const i = y * W + x;
          if (!land[i]) { ok = true; break; } // denize ulaştı
          if (k > 3 && used[i]) { ok = true; break; } // başka nehre katıldı
          let bx = -1, by = -1, bs = Infinity;
          for (const [ddx, ddy] of nb) {
            const qx = x + ddx, qy = y + ddy;
            if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
            const q = qy * W + qx;
            if (dIn[q] >= dIn[i]) continue;
            const s = (land[q] ? elev[q] : -1) + (detail[q] - 0.5) * 0.04; // küçük gürültü: kıvrım
            if (s < bs) { bs = s; bx = qx; by = qy; }
          }
          if (bx < 0) break;
          x = bx; y = by; path.push([x, y]);
        }
        if (!ok || path.length < 16) continue;
        for (const [qx, qy] of path) used[qy * W + qx] = 1;
        // dünya koordinatına çevir, kırık çizgiyi seyrelt
        const pts = [];
        for (let k = 0; k < path.length; k += 2) pts.push([(path[k][0] + 0.5) * inv, (path[k][1] + 0.5) * inv]);
        const last = path[path.length - 1];
        pts.push([(last[0] + 0.5) * inv, (last[1] + 0.5) * inv]);
        rivers.push(pts);
      }
    });
    // 5) sonuç
    steps.push(() => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(img, 0, 0);
      done({ canvas: c, scale: S, rivers, W, H });
    });

    let k = 0;
    const tick = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (k < steps.length && performance.now() - t0 < 9) steps[k++]();
      if (k < steps.length) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    return { cancel() { cancelled = true; } };
  }

  G.Terrain = { build };
})();
