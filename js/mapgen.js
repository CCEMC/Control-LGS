// Harita üretici: Poisson noktaları -> Voronoi hücreleri -> el çizimi gibi kıvrımlı sınırlar
// -> kıta şekli -> 9 ülkeye eşit dağıtım (başkentler 3x3 ızgarada, eşit aralıklı)
(function () {
  'use strict';
  const G = window.G;
  const { mulberry32, makeNoise } = G.U;

  const COUNTRY_NAMES = ['Aurelya', 'Borvenya', 'Kaldera', 'Drakmor', 'Elvarya', 'Ferranya', 'Galmora', 'Halvren', 'İstavya'];
  const PRE = ['Kar', 'Bel', 'Os', 'Dra', 'Val', 'Mir', 'Tor', 'Ard', 'Sel', 'Ven', 'Gor', 'Lin', 'Bra', 'Zel', 'Hal', 'Dun', 'Ast', 'Mor',
    'Ruv', 'Fen', 'Ker', 'Sam', 'Tal', 'Bur', 'Ilg', 'Nev', 'Yar', 'Ak', 'Kız', 'Er', 'Sar', 'Dem', 'Gök', 'Alt', 'Kum', 'Taş', 'Ot',
    'Mar', 'Lor', 'Sev', 'Hel', 'Var', 'Ul', 'Pel', 'Rin', 'Kor', 'Asl', 'Bey', 'Çam', 'Der', 'Ezg', 'Fır', 'Kan', 'Mel', 'Nar', 'Or'];
  const SUF = ['ova', 'burg', 'grad', 'heim', 'ya', 'mar', 'stad', 'ten', 'lis', 'dor', 'vik', 'mont', 'kale', 'yurt', 'abad', 'gard',
    'pol', 'dere', 'köy', 'hisar', 'sun', 'van', 'tepe', 'ia', 'ford', 'mir', 'lan', 'zor', 'eli', 'han', 'vadi', 'ten'];

  function poisson(W, H, r, rnd, k) {
    k = k || 30;
    const cell = r / Math.SQRT2, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const grid = new Int32Array(gw * gh).fill(-1);
    const pts = [], active = [];
    function add(p) {
      pts.push(p); active.push(pts.length - 1);
      grid[Math.floor(p[1] / cell) * gw + Math.floor(p[0] / cell)] = pts.length - 1;
    }
    add([W * (0.4 + rnd() * 0.2), H * (0.4 + rnd() * 0.2)]);
    while (active.length) {
      const ai = Math.floor(rnd() * active.length);
      const p = pts[active[ai]];
      let found = false;
      for (let t = 0; t < k; t++) {
        const ang = rnd() * Math.PI * 2, d = r * (1 + rnd());
        const x = p[0] + Math.cos(ang) * d, y = p[1] + Math.sin(ang) * d;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let ok = true;
        for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++) {
          for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
            const q = grid[yy * gw + xx];
            if (q >= 0) {
              const dx = pts[q][0] - x, dy = pts[q][1] - y;
              if (dx * dx + dy * dy < r * r) { ok = false; break; }
            }
          }
        }
        if (ok) { add([x, y]); found = true; break; }
      }
      if (!found) active.splice(ai, 1);
    }
    return pts;
  }

  function clip(poly, tags, a, b, c, newTag) {
    const out = [], ot = [], n = poly.length;
    for (let k = 0; k < n; k++) {
      const P = poly[k], Q = poly[(k + 1) % n], tag = tags[k];
      const dP = a * P[0] + b * P[1] - c, dQ = a * Q[0] + b * Q[1] - c;
      const inP = dP <= 0, inQ = dQ <= 0;
      if (inP) {
        out.push(P); ot.push(tag);
        if (!inQ) {
          const t = dP / (dP - dQ);
          out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); ot.push(newTag);
        }
      } else if (inQ) {
        const t = dP / (dP - dQ);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); ot.push(tag);
      }
    }
    return [out, ot];
  }

  function voronoi(pts, W, H) {
    const n = pts.length;
    const cells = new Array(n);
    const idx = [...Array(n).keys()];
    for (let i = 0; i < n; i++) {
      const pi = pts[i];
      const order = idx.slice().sort((a, b) =>
        (pts[a][0] - pi[0]) ** 2 + (pts[a][1] - pi[1]) ** 2 - ((pts[b][0] - pi[0]) ** 2 + (pts[b][1] - pi[1]) ** 2));
      let poly = [[0, 0], [W, 0], [W, H], [0, H]], tags = [-1, -1, -1, -1];
      for (const j of order) {
        if (j === i) continue;
        const pj = pts[j];
        const dx = pj[0] - pi[0], dy = pj[1] - pi[1];
        const dd = Math.hypot(dx, dy);
        let maxR = 0;
        for (const v of poly) { const r = Math.hypot(v[0] - pi[0], v[1] - pi[1]); if (r > maxR) maxR = r; }
        if (dd > 2 * maxR + 1) break;
        const mx = (pi[0] + pj[0]) / 2, my = (pi[1] + pj[1]) / 2;
        [poly, tags] = clip(poly, tags, dx, dy, dx * mx + dy * my, j);
      }
      // sıfır uzunluklu kenarları temizle
      for (let k = poly.length - 1; k >= 0 && poly.length > 3; k--) {
        const P = poly[k], Q = poly[(k + 1) % poly.length];
        if (Math.hypot(P[0] - Q[0], P[1] - Q[1]) < 1e-6) { poly.splice(k, 1); tags.splice(k, 1); }
      }
      cells[i] = { poly, tags };
    }
    return cells;
  }

  // Flash Point.interpolate semantiği: f=1 -> p1, f=0 -> p2
  const fi = (p1, p2, f) => [p1[0] * f + p2[0] * (1 - f), p1[1] * f + p2[1] * (1 - f)];
  const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function subdivide(A, B, C, D, rnd, minLen, out) {
    if (dd(A, C) < minLen || dd(B, D) < minLen) return;
    const p = 0.2 + 0.6 * rnd(), q = 0.2 + 0.6 * rnd();
    const E = fi(A, D, p), F = fi(B, C, p), Gp = fi(A, B, q), I = fi(D, C, q);
    const H = fi(E, F, q);
    const s = 1 - (rnd() * 0.8 - 0.4), t = 1 - (rnd() * 0.8 - 0.4);
    subdivide(A, fi(Gp, B, s), H, fi(E, D, t), rnd, minLen, out);
    out.push(H);
    subdivide(H, fi(F, C, s), C, fi(I, D, t), rnd, minLen, out);
  }

  function noisyEdge(v0, v1, d0, d1, rnd, minLen) {
    if (dd(v0, v1) < minLen * 1.5) return [v0, v1];
    const mid = fi(v0, v1, 0.5);
    const t = fi(v0, d0, 0.5), q = fi(v0, d1, 0.5), r = fi(v1, d0, 0.5), s = fi(v1, d1, 0.5);
    const p0 = [v0]; subdivide(v0, t, mid, q, rnd, minLen, p0); p0.push(mid);
    const p1 = [v1]; subdivide(v1, s, mid, r, rnd, minLen, p1);
    p1.reverse();
    return p0.concat(p1);
  }

  // nCountries: ülke sayısı (tek oyunculu 9; çevrimiçide oyuncu sayısı kadar, 2–9).
  // 9 ülkede harita eskisiyle birebir aynıdır (kayıtlar tohumdan yeniden üretilir). Daha az ülkede kıta
  // ülke başına aynı alan kalacak şekilde küçülür, başkentler eşit alanlı bölgelerin merkezine yerleşir.
  // Harita tipleri. 'kita' klasik haritadır (9 ülkede eskisiyle birebir aynı, kayıtlar bozulmaz).
  const TYPES = [
    { key: 'kita', name: 'Kıta', desc: 'Körfezli, yarımadalı klasik kıta' },
    { key: 'pangea', name: 'Pangea', desc: 'Tek parça yuvarlak dev kıta; her yönden cephe' },
    { key: 'adalar', name: 'Takımadalar', desc: 'Dar kara köprüleriyle bağlı adalar; boğazlar kritik' },
    { key: 'icdeniz', name: 'İç Deniz', desc: 'Ortadaki denizi çevreleyen halka kıta' },
    { key: 'ikiz', name: 'İkiz Kıtalar', desc: 'Tek bir kara köprüsüyle bağlı iki kıta' },
  ];
  const TYPE_SCALE = { kita: 1, pangea: 1.04, adalar: 1.28, icdeniz: 1.16, ikiz: 1.12 };

  function segDist(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy);
    t = Math.max(0, Math.min(1, t));
    return [Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)), t];
  }

  // Kıta dışındaki tiplerin kara şekli: (x, y) noktası kara mı?
  function makeShape(type, o) {
    const { W, H, ax, by, edge, fq, rnd, nz, N } = o;
    const inMap = (x, y) => !(x < edge || y < edge || x > W - edge || y > H - edge);
    const big = (x, y, k) => nz.fbm(x * fq + 3.1 + k, y * fq + 7.7 - k, 4) - 0.5;
    const small = (x, y, k) => nz.noise(x * 0.01 + k, y * 0.01 - k) - 0.5;
    if (type === 'pangea') {
      return (x, y) => {
        if (!inMap(x, y)) return false;
        const nx = (x - W / 2) / ax, ny = (y - H / 2) / by;
        return Math.hypot(nx, ny) + big(x, y, 0) * 0.5 < 1;
      };
    }
    if (type === 'icdeniz') {
      const inner = 0.43;
      return (x, y) => {
        if (!inMap(x, y)) return false;
        const nx = (x - W / 2) / ax, ny = (y - H / 2) / by;
        const d = Math.pow(Math.pow(Math.abs(nx), 2.5) + Math.pow(Math.abs(ny), 2.5), 1 / 2.5);
        return d + big(x, y, 0) * 0.42 < 1 && d + big(x, y, 5) * 0.32 > inner;
      };
    }
    if (type === 'ikiz') {
      const jy = (rnd() - 0.5) * 0.18 * H;
      // iki kıta arasında en az ~3 şehir genişliğinde açık deniz kalır, yalnızca köprü bağlar
      const gap = Math.max(0.12 * W, 380);
      const half = (W / 2 - gap / 2 - edge) / 2;
      const A = [edge + half, H / 2 + jy], B = [W - edge - half, H / 2 - jy];
      const rx = half / 1.22, ry = H * 0.39;
      return (x, y) => {
        if (!inMap(x, y)) return false;
        for (const c of [A, B]) {
          const nx = (x - c[0]) / rx, ny = (y - c[1]) / ry;
          const d = Math.pow(Math.pow(Math.abs(nx), 2.4) + Math.pow(Math.abs(ny), 2.4), 1 / 2.4);
          if (d + big(x, y, c[0] * 0.001) * 0.4 < 1) return true;
        }
        return segDist([x, y], A, B)[0] < 130 + small(x, y, 2) * 50; // kara köprüsü (≈2 şehir genişliğinde)
      };
    }
    // takımadalar: ızgaraya serpiştirilmiş adalar + en kısa yollarla kara köprüleri (ağaç + bir halka)
    const K = Math.max(3, Math.min(9, N)); // yaklaşık ülke başına bir ada: ülkeler dengeli olur
    const cols = Math.max(2, Math.round(Math.sqrt((K + 1) * (W / H)))), rows = Math.ceil((K + 1) / cols); // en az bir boş hücre: açık deniz
    const cw = (W - 2 * edge) / cols, ch = (H - 2 * edge) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    // adalar arasında en az ~2 şehir genişliğinde deniz kalır (gürültüyle taşma payı 1.17)
    const gapHalf = Math.max(0.08 * Math.min(cw, ch), 170);
    const isl = cells.slice(0, K).map(([c, r]) => ({
      x: edge + (c + 0.5) * cw, y: edge + (r + 0.5) * ch,
      rx: Math.max(120, (cw / 2 - gapHalf) / 1.17) * (0.92 + rnd() * 0.08), ry: Math.max(120, (ch / 2 - gapHalf) / 1.17) * (0.92 + rnd() * 0.08),
    }));
    const dist = (a, b) => Math.hypot(isl[a].x - isl[b].x, isl[a].y - isl[b].y);
    const inT = [0], bridges = [];
    while (inT.length < K) {
      let bi = -1, bj = -1, bd = Infinity;
      for (const i of inT) for (let j = 0; j < K; j++) if (!inT.includes(j) && dist(i, j) < bd) { bd = dist(i, j); bi = i; bj = j; }
      bridges.push([bi, bj]); inT.push(bj);
    }
    if (K >= 4) { // ek bir köprü: tek yollu bir ağaç yerine bir döngü olsun
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
        if (bridges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        if (dist(i, j) < bd) { bd = dist(i, j); bi = i; bj = j; }
      }
      if (bi >= 0) bridges.push([bi, bj]);
    }
    return (x, y) => {
      if (!inMap(x, y)) return false;
      for (const s of isl) { const nx = (x - s.x) / s.rx, ny = (y - s.y) / s.ry; if (Math.hypot(nx, ny) + big(x, y, s.x * 0.001) * 0.34 < 1) return true; }
      for (const [i, j] of bridges) if (segDist([x, y], [isl[i].x, isl[i].y], [isl[j].x, isl[j].y])[0] < 110 + small(x, y, i + j) * 40) return true;
      return false;
    };
  }

  // Kıta dışı tiplerde ülke başına ~19 şehir hedeflenir: önce bir deneme üretilir, şehir sayısı hedeften
  // saparsa harita alanı orantılı büyütülüp/küçültülüp yeniden üretilir (aynı tohumla, belirleyici).
  function generate(seed, nCountries, mapType) {
    const N = nCountries >= 2 && nCountries <= 9 ? nCountries : 9;
    const type = TYPES.some((t) => t.key === mapType) ? mapType : 'kita';
    if (type === 'kita') return build(seed, N, type, 1);
    // ülkeler dengesiz çıkarsa (ör. küçük bir adada sıkışan ülke) aynı tohumun başka bir çeşidi denenir
    const score = (m) => {
      const cnt = new Array(N).fill(0);
      for (const o of m.owner) cnt[o]++;
      return (Math.max(...cnt) - Math.min(...cnt)) + Math.abs(m.cities.length / N - 19) * 0.5;
    };
    let best = null, bs = Infinity;
    for (let v = 0; v < 3; v++) {
      const m = fitSize(v === 0 ? seed : (seed + v * 7919) >>> 0, N, type);
      const s = score(m);
      if (s < bs) { best = m; bs = s; }
      if (s <= 5) break;
    }
    return best;
  }

  function fitSize(seed, N, type) {
    let mul = 1, m = build(seed, N, type, mul), best = m;
    const err = (x) => Math.abs(x.cities.length / N - 19);
    for (let i = 0; i < 4; i++) {
      const per = m.cities.length / N;
      if (per >= 16.5 && per <= 22.5) return m;
      mul = Math.max(0.5, Math.min(2.2, mul * Math.pow(19 / Math.max(1, per), 0.5)));
      m = build(seed, N, type, mul);
      if (err(m) < err(best)) best = m;
    }
    return err(m) <= err(best) ? m : best;
  }

  function build(seed, N, type, mul) {
    const rnd = mulberry32(seed);
    const nz = makeNoise(seed * 7 + 13);
    const sc = N === 9 && type === 'kita' ? 1 : Math.sqrt(N / 9) * TYPE_SCALE[type] * mul;
    const W = Math.round(3400 * sc), H = Math.round(2400 * sc);
    const mX = 300 * sc, mY = 300 * sc;
    const ax = W / 2 - mX, by = H / 2 - mY;
    const edge = 140 * sc, fq = 0.0013 / sc;
    let isLand;
    if (type === 'kita') {
      // Yarımada ve körfez (fotoğraftaki gibi düzensiz kıyı)
      const penAng = rnd() * Math.PI * 2;
      const bayAng = penAng + Math.PI * (0.6 + rnd() * 0.8);
      const edgePt = (ang, k) => [W / 2 + Math.cos(ang) * ax * k, H / 2 + Math.sin(ang) * by * k];
      const penA = edgePt(penAng, 0.9), penB = edgePt(penAng, 1.22);
      const bayA = edgePt(bayAng, 1.15), bayB = edgePt(bayAng, 0.72);
      isLand = (x, y) => {
        if (x < edge || y < edge || x > W - edge || y > H - edge) return false;
        const nx = (x - W / 2) / ax, ny = (y - H / 2) / by;
        let d = Math.pow(Math.pow(Math.abs(nx), 3) + Math.pow(Math.abs(ny), 3), 1 / 3);
        d += (nz.fbm(x * fq + 3.1, y * fq + 7.7, 4) - 0.5) * 0.62;
        const [bd] = segDist([x, y], bayA, bayB);
        if (bd < 150 * sc + (nz.noise(x * 0.01, y * 0.01) - 0.5) * 60 * sc) return false;
        if (d < 1) return true;
        const [pd, pt] = segDist([x, y], penA, penB);
        return pd < 170 * sc * (1 - pt * 0.45) + (nz.noise(x * 0.01 + 4, y * 0.01) - 0.5) * 60 * sc;
      };
    } else {
      isLand = makeShape(type, { W, H, ax, by, edge, fq, rnd, nz, N });
    }

    const pts = poisson(W, H, 128, rnd);
    const vc = voronoi(pts, W, H);
    const n = pts.length;
    const land = pts.map((p) => isLand(p[0], p[1]));
    const nbrs = vc.map((c) => [...new Set(c.tags.filter((t) => t >= 0))]);

    // Göl doldur: kenara ulaşamayan deniz hücreleri kara olur (iç denizli haritada deniz korunur)
    if (type !== 'icdeniz') {
      const reach = new Uint8Array(n);
      const q = [];
      for (let i = 0; i < n; i++) if (!land[i] && vc[i].tags.includes(-1)) { reach[i] = 1; q.push(i); }
      while (q.length) {
        const i = q.pop();
        for (const j of nbrs[i]) if (!land[j] && !reach[j]) { reach[j] = 1; q.push(j); }
      }
      for (let i = 0; i < n; i++) if (!land[i] && !reach[i]) land[i] = true;
    }
    // En büyük kara parçasını tut
    const comp = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0;
    for (let i = 0; i < n; i++) {
      if (!land[i] || comp[i] >= 0) continue;
      const stack = [i]; comp[i] = i; let size = 0;
      while (stack.length) {
        const a = stack.pop(); size++;
        for (const b of nbrs[a]) if (land[b] && comp[b] < 0) { comp[b] = i; stack.push(b); }
      }
      if (size > bestSize) { bestSize = size; best = i; }
    }
    for (let i = 0; i < n; i++) if (land[i] && comp[i] !== best) land[i] = false;

    // Şehir dizinleri
    const cityOf = new Int32Array(n).fill(-1);
    const landIdx = [];
    for (let i = 0; i < n; i++) if (land[i]) { cityOf[i] = landIdx.length; landIdx.push(i); }

    // Kenarlar (kıvrımlı)
    const edgeMap = new Map();
    const edges = [];
    const erng = mulberry32(seed ^ 0x9e3779b9);
    function getEdge(i, j, A, B) {
      const key = j < 0 ? i + '_f' + A[0].toFixed(1) : Math.min(i, j) + '_' + Math.max(i, j);
      let e = edgeMap.get(key);
      if (!e) {
        const ptsE = j < 0 ? [A, B] : noisyEdge(A, B, pts[i], pts[j], erng, 7);
        const len = dd(A, B);
        e = { from: i, pts: ptsE, len, i, j };
        edgeMap.set(key, e);
        if (land[i] || (j >= 0 && land[j])) {
          const ci = cityOf[i], cj = j >= 0 ? cityOf[j] : -1;
          if (ci >= 0 || cj >= 0) {
            const a = ci >= 0 ? ci : cj, b = ci >= 0 ? cj : ci;
            edges.push({ a, b, pts: ptsE, len });
          }
        }
      }
      return e;
    }

    const cities = [];
    const names = new Set();
    for (let ci = 0; ci < landIdx.length; ci++) {
      const i = landIdx[ci];
      const { poly, tags } = vc[i];
      const outline = [];
      const neighbors = [];
      let coastal = false;
      for (let k = 0; k < poly.length; k++) {
        const A = poly[k], B = poly[(k + 1) % poly.length], j = tags[k];
        const e = getEdge(i, j, A, B);
        let seg = e.from === i ? e.pts : e.pts.slice().reverse();
        for (let s = 0; s < seg.length - 1; s++) outline.push(seg[s]);
        if (j >= 0 && land[j]) { if (e.len > 6) neighbors.push(cityOf[j]); }
        else coastal = true;
      }
      // ağırlık merkezi
      let area = 0, cx = 0, cy = 0;
      for (let k = 0; k < poly.length; k++) {
        const P = poly[k], Q = poly[(k + 1) % poly.length];
        const cr = P[0] * Q[1] - Q[0] * P[1];
        area += cr; cx += (P[0] + Q[0]) * cr; cy += (P[1] + Q[1]) * cr;
      }
      area /= 2; cx /= 6 * area; cy /= 6 * area;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of outline) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
      let name;
      for (let tries = 0; tries < 50; tries++) {
        name = PRE[Math.floor(rnd() * PRE.length)] + SUF[Math.floor(rnd() * SUF.length)];
        if (!names.has(name)) break;
      }
      names.add(name);
      cities.push({ id: ci, name, x: cx, y: cy, site: pts[i], outline, bbox: [minx, miny, maxx, maxy], neighbors: [...new Set(neighbors)], coastal, area: Math.abs(area) });
    }

    const capitals = N === 9 && type === 'kita' ? hexCapitals(cities, rnd) : spreadCapitals(cities, N, rnd);
    const owner = new Int32Array(cities.length).fill(-1);
    const counts = new Array(N).fill(0);
    capitals.forEach((cid, k) => { owner[cid] = k; counts[k] = 1; });
    for (;;) {
      const order = [...Array(N).keys()].sort((a, b) => counts[a] - counts[b] || rnd() - 0.5);
      let grew = false;
      for (const k of order) {
        let bc = -1, bdist = Infinity;
        const cap = cities[capitals[k]];
        for (const city of cities) {
          if (owner[city.id] !== k) continue;
          for (const nb of city.neighbors) {
            if (owner[nb] !== -1) continue;
            const d = Math.hypot(cities[nb].x - cap.x, cities[nb].y - cap.y) * (0.9 + rnd() * 0.2);
            if (d < bdist) { bdist = d; bc = nb; }
          }
        }
        if (bc >= 0) { owner[bc] = k; counts[k]++; grew = true; break; }
      }
      if (!grew) break;
    }
    // sahipsiz kalan (olmamalı) -> komşu ülke
    for (let pass = 0; pass < 5; pass++) {
      for (const city of cities) {
        if (owner[city.id] >= 0) continue;
        const nb = city.neighbors.find((x) => owner[x] >= 0);
        if (nb !== undefined) owner[city.id] = owner[nb];
      }
    }
    for (const city of cities) if (owner[city.id] < 0) owner[city.id] = 0;

    // Dengeleme: büyük ülkelerin sınır şehirlerini komşu küçük ülkelere aktar (bütünlük korunarak)
    const connectedWithout = (k, removed) => {
      const start = capitals[k];
      const seen = new Set([start]);
      const st = [start];
      let n = 0;
      while (st.length) {
        const a = st.pop(); n++;
        for (const b of cities[a].neighbors) if (b !== removed && owner[b] === k && !seen.has(b)) { seen.add(b); st.push(b); }
      }
      let total = 0;
      for (let i = 0; i < owner.length; i++) if (owner[i] === k && i !== removed) total++;
      return n === total;
    };
    // Bir şehri "from" ülkesinden komşu "to" ülkesine aktar (başkent değil, "from" bütün kalmalı)
    const giveOne = (from, to) => {
      const capT = cities[capitals[to]];
      const cands = cities.filter((c) => owner[c.id] === from && !capitals.includes(c.id) && c.neighbors.some((n) => owner[n] === to))
        .sort((a, b) => Math.hypot(a.x - capT.x, a.y - capT.y) - Math.hypot(b.x - capT.x, b.y - capT.y));
      for (const c of cands) if (connectedWithout(from, c.id)) { owner[c.id] = to; return c.id; }
      return -1;
    };
    // Büyükten küçüğe, ülke komşuluk grafiği üzerinden zincirleme aktarım
    for (let iter = 0; iter < 300; iter++) {
      const cnt = new Array(N).fill(0);
      for (const o of owner) cnt[o]++;
      const adj = Array.from({ length: N }, () => new Set());
      for (const c of cities) for (const n of c.neighbors) if (owner[n] !== owner[c.id]) adj[owner[c.id]].add(owner[n]);
      const pairs = [];
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (cnt[a] - cnt[b] >= 2) pairs.push([a, b, cnt[a] - cnt[b]]);
      pairs.sort((p, q) => q[2] - p[2]);
      let moved = false;
      for (const [big, small] of pairs) {
        const prev = new Map([[big, -1]]);
        const q = [big];
        while (q.length && !prev.has(small)) { const a = q.shift(); for (const b of adj[a]) if (!prev.has(b)) { prev.set(b, a); q.push(b); } }
        if (!prev.has(small)) continue;
        const path = [];
        for (let x = small; x !== -1; x = prev.get(x)) path.unshift(x);
        const done = [];
        let ok = true;
        for (let i = 0; i < path.length - 1; i++) {
          const id = giveOne(path[i], path[i + 1]);
          if (id < 0) { ok = false; break; }
          done.push([id, path[i]]);
        }
        if (ok) { moved = true; break; }
        for (const [id, o] of done.reverse()) owner[id] = o; // geri al
      }
      if (!moved) break;
    }

    return { W, H, seed, nCountries: N, mapType: type, cities, edges, owner: Array.from(owner), capitals, countryNames: COUNTRY_NAMES.slice() };
  }

  // N ≠ 9: başkentler k-ortalamalar ile (alan ağırlıklı) eşit büyüklükte bölgelerin merkezine yerleşir
  function spreadCapitals(cities, N, rnd) {
    const first = cities[Math.floor(rnd() * cities.length)];
    const centers = [[first.x, first.y]];
    while (centers.length < N) { // en uzak nokta örneklemesi: başlangıç merkezleri birbirinden uzak
      let best = null, bd = -1;
      for (const c of cities) {
        let d = Infinity;
        for (const m of centers) d = Math.min(d, (m[0] - c.x) ** 2 + (m[1] - c.y) ** 2);
        if (d > bd) { bd = d; best = c; }
      }
      centers.push([best.x, best.y]);
    }
    for (let it = 0; it < 30; it++) {
      const sx = new Array(N).fill(0), sy = new Array(N).fill(0), sw = new Array(N).fill(0);
      for (const c of cities) {
        let k = 0, bd = Infinity;
        for (let i = 0; i < N; i++) { const d = (centers[i][0] - c.x) ** 2 + (centers[i][1] - c.y) ** 2; if (d < bd) { bd = d; k = i; } }
        sx[k] += c.x * c.area; sy[k] += c.y * c.area; sw[k] += c.area;
      }
      for (let i = 0; i < N; i++) if (sw[i] > 0) centers[i] = [sx[i] / sw[i], sy[i] / sw[i]];
    }
    const capitals = [];
    for (const [gx, gy] of centers) {
      let bi = -1, bd = Infinity;
      for (const city of cities) {
        if (capitals.includes(city.id)) continue;
        const d = Math.hypot(city.x - gx, city.y - gy);
        if (d < bd) { bd = d; bi = city.id; }
      }
      capitals.push(bi);
    }
    return capitals;
  }

  // 9 ülke: başkentler petek (altıgen) düzende, eşit aralıklarla (eski harita)
  function hexCapitals(cities, rnd) {
    const xs = cities.map((c) => c.x).sort((a, b) => a - b);
    const ys = cities.map((c) => c.y).sort((a, b) => a - b);
    const pct = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
    const x0 = pct(xs, 0.04), x1 = pct(xs, 0.96), y0 = pct(ys, 0.04), y1 = pct(ys, 0.96);
    const capitals = [];
    // Petek (altıgen) düzen: her başkent komşu başkentlere eşit uzaklıkta
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const step = Math.min(((x1 - x0) * 0.8) / 2.5, ((y1 - y0) * 0.74) / Math.sqrt(3));
    const dy = (step * Math.sqrt(3)) / 2;
    const flip = rnd() < 0.5 ? 1 : -1; // orta sıra sağa ya da sola kaysın
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const gx = mx + ((c - 1) + (r === 1 ? 0.5 : 0) - 0.25) * step * flip, gy = my + (r - 1) * dy;
        let bi = -1, bd = Infinity;
        for (const city of cities) {
          if (capitals.includes(city.id)) continue;
          const d = Math.hypot(city.x - gx, city.y - gy);
          if (d < bd) { bd = d; bi = city.id; }
        }
        capitals.push(bi);
      }
    }
    // İnce ayar: komşu başkent çiftlerinin mesafelerini birbirine yaklaştır
    {
      const grid = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push([mx + ((c - 1) + (r === 1 ? 0.5 : 0) - 0.25) * step * flip, my + (r - 1) * dy]);
      const pairs = [];
      for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) if (Math.abs(Math.hypot(grid[a][0] - grid[b][0], grid[a][1] - grid[b][1]) - step) < step * 0.05) pairs.push([a, b]);
      const cost = () => {
        const d = pairs.map(([a, b]) => Math.hypot(cities[capitals[a]].x - cities[capitals[b]].x, cities[capitals[a]].y - cities[capitals[b]].y));
        const m = d.reduce((s, v) => s + v, 0) / d.length;
        return d.reduce((s, v) => s + (v - m) ** 2, 0) + d.reduce((s, v) => s + (v - step) ** 2, 0) * 0.15;
      };
      let cur = cost();
      for (let pass = 0; pass < 8; pass++) {
        let improved = false;
        for (let k = 0; k < 9; k++) {
          const cand = new Set();
          for (const n of cities[capitals[k]].neighbors) { cand.add(n); for (const n2 of cities[n].neighbors) cand.add(n2); }
          for (const c of cand) {
            if (capitals.includes(c)) continue;
            if (Math.hypot(cities[c].x - grid[k][0], cities[c].y - grid[k][1]) > step * 0.35) continue;
            const old = capitals[k];
            capitals[k] = c;
            const v = cost();
            if (v < cur - 1e-6) { cur = v; improved = true; } else capitals[k] = old;
          }
        }
        if (!improved) break;
      }
    }
    return capitals;
  }

  G.MapGen = { generate, TYPES };
})();
