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

  function generate(seed) {
    const rnd = mulberry32(seed);
    const nz = makeNoise(seed * 7 + 13);
    const W = 3400, H = 2400;
    const mX = 300, mY = 300;
    const ax = W / 2 - mX, by = H / 2 - mY;

    // Yarımada ve körfez (fotoğraftaki gibi düzensiz kıyı)
    const penAng = rnd() * Math.PI * 2;
    const bayAng = penAng + Math.PI * (0.6 + rnd() * 0.8);
    const edgePt = (ang, k) => [W / 2 + Math.cos(ang) * ax * k, H / 2 + Math.sin(ang) * by * k];
    const penA = edgePt(penAng, 0.9), penB = edgePt(penAng, 1.22);
    const bayA = edgePt(bayAng, 1.15), bayB = edgePt(bayAng, 0.72);
    function segDist(p, a, b) {
      const vx = b[0] - a[0], vy = b[1] - a[1];
      let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy);
      t = Math.max(0, Math.min(1, t));
      return [Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)), t];
    }
    function isLand(x, y) {
      if (x < 140 || y < 140 || x > W - 140 || y > H - 140) return false;
      const nx = (x - W / 2) / ax, ny = (y - H / 2) / by;
      let d = Math.pow(Math.pow(Math.abs(nx), 3) + Math.pow(Math.abs(ny), 3), 1 / 3);
      d += (nz.fbm(x * 0.0013 + 3.1, y * 0.0013 + 7.7, 4) - 0.5) * 0.62;
      const [bd] = segDist([x, y], bayA, bayB);
      if (bd < 150 + (nz.noise(x * 0.01, y * 0.01) - 0.5) * 60) return false;
      if (d < 1) return true;
      const [pd, pt] = segDist([x, y], penA, penB);
      return pd < 170 * (1 - pt * 0.45) + (nz.noise(x * 0.01 + 4, y * 0.01) - 0.5) * 60;
    }

    const pts = poisson(W, H, 128, rnd);
    const vc = voronoi(pts, W, H);
    const n = pts.length;
    const land = pts.map((p) => isLand(p[0], p[1]));
    const nbrs = vc.map((c) => [...new Set(c.tags.filter((t) => t >= 0))]);

    // Göl doldur: kenara ulaşamayan deniz hücreleri kara olur
    const reach = new Uint8Array(n);
    const q = [];
    for (let i = 0; i < n; i++) if (!land[i] && vc[i].tags.includes(-1)) { reach[i] = 1; q.push(i); }
    while (q.length) {
      const i = q.pop();
      for (const j of nbrs[i]) if (!land[j] && !reach[j]) { reach[j] = 1; q.push(j); }
    }
    for (let i = 0; i < n; i++) if (!land[i] && !reach[i]) land[i] = true;
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

    // Ülkeler: başkentler 3x3 ızgarada eşit aralıklarla
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
    const owner = new Int32Array(cities.length).fill(-1);
    const counts = new Array(9).fill(0);
    capitals.forEach((cid, k) => { owner[cid] = k; counts[k] = 1; });
    for (;;) {
      const order = [...Array(9).keys()].sort((a, b) => counts[a] - counts[b] || rnd() - 0.5);
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
      const cnt = new Array(9).fill(0);
      for (const o of owner) cnt[o]++;
      const adj = Array.from({ length: 9 }, () => new Set());
      for (const c of cities) for (const n of c.neighbors) if (owner[n] !== owner[c.id]) adj[owner[c.id]].add(owner[n]);
      const pairs = [];
      for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) if (cnt[a] - cnt[b] >= 2) pairs.push([a, b, cnt[a] - cnt[b]]);
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

    return { W, H, seed, cities, edges, owner: Array.from(owner), capitals, countryNames: COUNTRY_NAMES.slice() };
  }

  G.MapGen = { generate };
})();
