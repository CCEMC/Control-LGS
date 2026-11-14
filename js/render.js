// Çizim: eski harita teması (parşömen, mürekkep sınırlar), birlikler, efektler ve minimap
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const INK = '#3a2814';
  const FONT = "'IM Fell English', 'Palatino Linotype', Georgia, serif";
  const FONT_SC = "'IM Fell English SC', 'Palatino Linotype', Georgia, serif";
  // efekt süreleri (ms)
  const FX_DUR = { explosion: 1400, capture: 1400, intercept: 1400, recall: 1900, shield: 1300, join: 2000, arrive: 1500, spawn: 1300, depart: 1700 };
  const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
  const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  class Renderer {
    constructor(canvas, mini, game, ui) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.mini = mini; this.mctx = mini.getContext('2d');
      this.game = game; this.ui = ui;
      this.cam = { x: 0, y: 0, zoom: 0.5 };
      this.fx = [];
      this.tokenHits = [];
      this.frame = 0;
      this.version = -1;
      // görünüm: 'arazi' (uydu görünümlü yer şekilleri) ya da 'eski' (parşömen harita); cihazda hatırlanır
      this.view = 'arazi';
      try { const v = localStorage.getItem('clgs_view'); if (v === 'eski' || v === 'arazi') this.view = v; } catch (e) { /* yok */ }
      this.terrain = null;
      this.buildStatic();
      if (this.view === 'arazi') this.startTerrain();
      this.resize();
      const cap = game.cities[game.player.capital];
      this.cam.x = cap.x; this.cam.y = cap.y; this.cam.zoom = 0.62;
      this.clampCam();
      game.on((ev) => {
        if (ev.type === 'fx') {
          const c = game.cities[ev.city];
          const f = { ...ev, x: c.x, y: c.y, t0: performance.now(), dur: FX_DUR[ev.kind] || 1400 };
          if (ev.front !== undefined) { const b = game.cities[ev.front]; f.bx = (c.x + b.x) / 2; f.by = (c.y + b.y) / 2; }
          this.fx.push(f);
          if (this.fx.length > 60) this.fx.splice(0, this.fx.length - 60);
        }
      });
    }

    buildStatic() {
      const g = this.game, map = g.map;
      this.cityPaths = map.cities.map((c) => {
        const p = new Path2D();
        c.outline.forEach((pt, i) => (i ? p.lineTo(pt[0], pt[1]) : p.moveTo(pt[0], pt[1])));
        p.closePath();
        return p;
      });
      this.bbox = map.cities.map((c) => c.bbox);
      this.inner = new Path2D();
      this.coast = new Path2D();
      for (const e of map.edges) {
        const path = e.b < 0 ? this.coast : this.inner;
        e.pts.forEach((pt, i) => (i ? path.lineTo(pt[0], pt[1]) : path.moveTo(pt[0], pt[1])));
      }
      // şehir -> sınır kenarları (saldırı çizimi için)
      this.edgesByCity = map.cities.map(() => []);
      for (const e of map.edges) {
        if (e.b < 0) continue;
        this.edgesByCity[e.a].push({ e, other: e.b });
        this.edgesByCity[e.b].push({ e, other: e.a });
      }
      this.atkCache = new Map();
      this.pv = new Map();
      // her şehir için hafif ton farkı (elle boyanmış hissi)
      this.shade = map.cities.map((c) => ((Math.sin(c.id * 12.9898) * 43758.5453) % 1 + 1) % 1);
      this.seaPattern = this.ctx.createPattern(this.makeSeaTile(), 'repeat');
      this.grainPattern = this.ctx.createPattern(this.makeGrainTile(), 'repeat');
      this.hatch = this.ctx.createPattern(this.makeHatchTile(), 'repeat');
      // Önbellek katmanları (her karede tek drawImage): deniz+kıyı (statik), kara (sahiplik değişince)
      const S = (this.layerScale = 0.5);
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(map.W * S); c.height = Math.ceil(map.H * S); return c; };
      this.baseLayer = mk();
      this.landLayer = mk();
      this.mapLayer = mk();
      this.drawBase();
      this.mapLayer.getContext('2d').drawImage(this.baseLayer, 0, 0);
    }

    // ---- görünüm: uydu (arazi) / eski harita ----
    isTerrain() { return this.view === 'arazi' && !!this.terrain; }
    startTerrain() {
      if (this.terrain || this._terrainJob || !G.Terrain) return;
      this._terrainJob = G.Terrain.build(this.game.map, (t) => {
        this.terrain = t; this._terrainJob = null;
        if (this.view === 'arazi') { this.drawBase(); this.version = -1; }
      });
    }
    setView(v) {
      if (v !== 'arazi' && v !== 'eski') return;
      this.view = v;
      try { localStorage.setItem('clgs_view', v); } catch (e) { /* yok */ }
      if (v === 'arazi' && !this.terrain) this.startTerrain();
      this.drawBase();
      this.version = -1; // kara katmanı, sınırlar ve minimap yeniden çizilsin
      this._vgW = -1;
    }
    // deniz + kıyı katmanı: arazi görünümünde uydu dokusu, eski görünümde parşömen deniz ve süslemeler
    drawBase() {
      const map = this.game.map, S = this.layerScale;
      const b = this.baseLayer.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, this.baseLayer.width, this.baseLayer.height);
      b.setTransform(S, 0, 0, S, 0, 0);
      if (this.isTerrain()) {
        b.imageSmoothingEnabled = true;
        try { b.imageSmoothingQuality = 'high'; } catch (e) { /* yok */ }
        b.drawImage(this.terrain.canvas, 0, 0, map.W, map.H);
        // yakın planda doku: bitki örtüsü / kaya pürüzü (orta gri = değişiklik yok, 'overlay' ile)
        if (!this._detailPat) this._detailPat = b.createPattern(this.makeDetailTile(), 'repeat');
        b.globalCompositeOperation = 'overlay'; b.globalAlpha = 0.55;
        b.fillStyle = this._detailPat; b.fillRect(0, 0, map.W, map.H);
        b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1;
        return;
      }
      b.fillStyle = this.seaPattern; b.fillRect(0, 0, map.W, map.H);
      b.lineJoin = 'round'; b.lineCap = 'round';
      for (const [w, a] of [[62, 0.06], [40, 0.08], [22, 0.11]]) { b.strokeStyle = `rgba(45,70,70,${a})`; b.lineWidth = w; b.stroke(this.coast); }
      b.setLineDash([2, 10]); b.strokeStyle = 'rgba(45,70,70,0.35)'; b.lineWidth = 1.6; b.stroke(this.coast); b.setLineDash([]);
      this.drawDecor(b);
    }

    renderLandLayer() {
      const g = this.game, S = this.layerScale;
      const c = this.landLayer.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.landLayer.width, this.landLayer.height);
      c.setTransform(S, 0, 0, S, 0, 0);
      if (this.isTerrain()) { this.renderTerrainLand(c); this.composeMap(); return; }
      for (const city of g.cities) {
        c.fillStyle = this.fillFor(city);
        c.fill(this.cityPaths[city.id]);
        // komşu hücreyle arada ince boşluk kalmasın
        c.strokeStyle = c.fillStyle; c.lineWidth = 2; c.stroke(this.cityPaths[city.id]);
        if (g.isRebel(city.owner)) { c.fillStyle = this.hatch; c.fill(this.cityPaths[city.id]); }
      }
      // parşömen dokusu yalnızca karanın üstüne
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = this.grainPattern;
      c.fillRect(0, 0, g.map.W, g.map.H);
      // iç kıyı gölge şeridi (kara tarafında antika harita derinliği)
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(42,30,18,0.16)'; c.lineWidth = 18; c.stroke(this.coast);
      c.strokeStyle = 'rgba(62,46,28,0.22)'; c.lineWidth = 6; c.stroke(this.coast);
      c.globalCompositeOperation = 'source-over';
      // iç şehir sınırlarını arazi katmanına bas (her karede binlerce çizgi tekrarını önler)
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.strokeStyle = 'rgba(58,40,20,0.42)'; c.lineWidth = 1.8; c.stroke(this.inner);
      this.drawTerrainGlyphs(c);
      this.composeMap();
    }

    // Eski harita görünümünde yer şekilleri: antika harita usulü mürekkep işaretleri (dağ, tepe, orman, kum tepesi).
    // Şehrin orta-altına iki işaret; asker sayısı ortada, adı üstte kalır.
    drawTerrainGlyphs(c) {
      const g = this.game, S = this.layerScale;
      if (!g.terrain) return;
      const INKG = 'rgba(58,40,20,0.72)';
      c.save();
      c.lineJoin = 'round'; c.lineCap = 'round';
      for (const city of g.cities) {
        const key = g.terrainOf(city.id).key;
        if (key === 'ova') continue;
        const r = Math.sqrt(g.map.cities[city.id].area / Math.PI);
        const sz = U.clamp(r * 0.24, 7, 19);
        const path = this.cityPaths[city.id];
        for (const [fx, fy] of [[-0.5, 0.36], [0.5, 0.36]]) {
          const x = city.x + fx * r, y = city.y + fy * r;
          if (!c.isPointInPath(path, x * S, y * S)) continue;
          c.lineWidth = Math.max(1.2, sz * 0.13); c.strokeStyle = INKG;
          if (key === 'dag') {
            for (const [dx, k] of [[-0.45, 0.75], [0.35, 1]]) {
              const px = x + dx * sz, s2 = sz * k, top = y - s2 * 0.8, base = y + sz * 0.5;
              c.beginPath(); c.moveTo(px - s2 * 0.85, base); c.lineTo(px, top); c.lineTo(px + s2 * 0.85, base); c.closePath();
              c.fillStyle = 'rgba(244,234,206,0.7)'; c.fill();
              c.beginPath(); c.moveTo(px, top); c.lineTo(px + s2 * 0.85, base); c.lineTo(px + s2 * 0.12, base); c.closePath();
              c.fillStyle = 'rgba(58,40,20,0.38)'; c.fill();
              c.beginPath(); c.moveTo(px - s2 * 0.85, base); c.lineTo(px, top); c.lineTo(px + s2 * 0.85, base); c.stroke();
            }
          } else if (key === 'tepe') {
            for (const dx of [-0.5, 0.5]) {
              const px = x + dx * sz;
              c.beginPath(); c.moveTo(px - sz * 0.7, y + sz * 0.3); c.quadraticCurveTo(px, y - sz * 0.75, px + sz * 0.7, y + sz * 0.3); c.stroke();
              c.beginPath(); c.moveTo(px + sz * 0.12, y - sz * 0.12); c.lineTo(px + sz * 0.42, y + sz * 0.22); c.stroke();
            }
          } else if (key === 'orman') {
            for (const [dx, dy] of [[-0.55, 0.15], [0, -0.1], [0.55, 0.15]]) {
              const px = x + dx * sz, py = y + dy * sz;
              c.beginPath(); c.moveTo(px, py + sz * 0.55); c.lineTo(px, py + sz * 0.1); c.stroke();
              c.beginPath(); c.arc(px, py - sz * 0.08, sz * 0.3, 0, Math.PI * 2);
              c.fillStyle = 'rgba(66,92,48,0.55)'; c.fill(); c.stroke();
            }
          } else if (key === 'col') {
            for (const [dx, dy] of [[-0.4, 0], [0.45, 0.35]]) {
              const px = x + dx * sz, py = y + dy * sz;
              c.beginPath(); c.moveTo(px - sz * 0.6, py + sz * 0.15); c.quadraticCurveTo(px - sz * 0.1, py - sz * 0.35, px + sz * 0.6, py + sz * 0.15); c.stroke();
            }
            c.fillStyle = INKG;
            for (const [dx, dy] of [[-0.7, 0.5], [0, 0.55], [0.15, -0.3], [-0.2, 0.25]]) { c.beginPath(); c.arc(x + dx * sz, y + dy * sz, Math.max(0.8, sz * 0.06), 0, Math.PI * 2); c.fill(); }
          }
        }
      }
      c.restore();
    }

    // Arazi görünümünde kara katmanı: nehirler + yarı saydam ülke renkleri (yer şekilleri altından görünür)
    renderTerrainLand(c) {
      const g = this.game, t = this.terrain;
      c.lineJoin = 'round'; c.lineCap = 'round';
      // nehirler: kaynaktan denize doğru kalınlaşır
      for (const r of t.rivers) {
        const n = r.length, parts = 3;
        for (let p = 0; p < parts; p++) {
          const a = Math.floor((p * (n - 1)) / parts), b = Math.floor(((p + 1) * (n - 1)) / parts);
          if (b <= a) continue;
          c.beginPath();
          c.moveTo(r[a][0], r[a][1]);
          for (let k = a + 1; k < b; k++) {
            const mx = (r[k][0] + r[k + 1][0]) / 2, my = (r[k][1] + r[k + 1][1]) / 2;
            c.quadraticCurveTo(r[k][0], r[k][1], mx, my);
          }
          c.lineTo(r[b][0], r[b][1]);
          c.strokeStyle = 'rgba(28,62,92,0.45)'; c.lineWidth = 3.4 + p * 2.4; c.stroke();
          c.strokeStyle = 'rgba(70,130,175,0.95)'; c.lineWidth = 1.8 + p * 1.7; c.stroke();
        }
      }
      // tam renkli ülke katmanı: uzaklaştıkça ve minimapte saydamlıkla üste bindirilir
      const S = this.layerScale;
      if (!this.tintLayer) { this.tintLayer = document.createElement('canvas'); this.tintLayer.width = this.landLayer.width; this.tintLayer.height = this.landLayer.height; }
      const tc = this.tintLayer.getContext('2d');
      tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, this.tintLayer.width, this.tintLayer.height);
      tc.setTransform(S, 0, 0, S, 0, 0); tc.lineJoin = 'round';
      for (const city of g.cities) {
        const p = G.PALETTE[g.cityColorIdx(city)];
        tc.fillStyle = tc.strokeStyle = U.hsl(p.h, Math.min(85, p.s + 15), p.l);
        tc.fill(this.cityPaths[city.id]); tc.lineWidth = 2; tc.stroke(this.cityPaths[city.id]);
      }
      // Ülke renkleri: iç kısımda araziyi örtmeyen hafif boya (orman, çöl, kar, kayalar görünür kalır);
      // ülke kimliğini sınır boyunca içeri doğru solan renkli şerit verir.
      c.globalAlpha = 0.22;
      for (const city of g.cities) { c.fillStyle = this.fillFor(city); c.fill(this.cityPaths[city.id]); }
      // Ülke sınırı boyunca içeri doğru renkli şerit: ülke kimliği kenardan okunur, iç kısımda yer şekilleri görünür kalır
      if (!this._cityEdges) {
        this._cityEdges = g.cities.map(() => []);
        for (const e of g.map.edges) { if (e.b < 0) continue; this._cityEdges[e.a].push(e); this._cityEdges[e.b].push(e); }
      }
      c.globalAlpha = 1;
      for (const city of g.cities) {
        const own = g.cities[city.id].owner, list = this._cityEdges[city.id];
        let path = null;
        for (const e of list) {
          const other = e.a === city.id ? e.b : e.a;
          if (g.cities[other].owner === own) continue;
          if (!path) path = new Path2D();
          e.pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
        }
        if (!path) continue;
        const p = G.PALETTE[g.cityColorIdx(city)];
        c.save(); c.clip(this.cityPaths[city.id]);
        c.strokeStyle = U.hsl(p.h, Math.min(85, p.s + 22), p.l);
        c.globalAlpha = 0.38; c.lineWidth = 76; c.stroke(path);
        c.globalAlpha = 0.6; c.lineWidth = 38; c.stroke(path);
        c.globalAlpha = 0.95; c.lineWidth = 15; c.stroke(path);
        c.restore();
      }
      c.globalAlpha = 1;
      c.globalAlpha = 0.55;
      for (const city of g.cities) if (g.isRebel(city.owner)) { c.fillStyle = this.hatch; c.fill(this.cityPaths[city.id]); }
      c.globalAlpha = 1;
      // şehir sınırları: ince, açık çizgi
      c.strokeStyle = 'rgba(255,250,232,0.2)'; c.lineWidth = 1.5; c.stroke(this.inner);
    }

    // tek blit için deniz+kıyı ve kara katmanlarını önceden birleştir
    composeMap() {
      const mc = this.mapLayer.getContext('2d');
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.clearRect(0, 0, this.mapLayer.width, this.mapLayer.height);
      mc.drawImage(this.baseLayer, 0, 0);
      mc.drawImage(this.landLayer, 0, 0);
      this._miniVer = -1;
      this._brdVer = -1;
    }

    makeSeaTile() {
      const c = document.createElement('canvas'); c.width = c.height = 320;
      const x = c.getContext('2d');
      x.fillStyle = '#b5c3b6'; x.fillRect(0, 0, 320, 320);
      const r = U.mulberry32(77);
      for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(70,90,80,${r() * 0.06})`; x.fillRect(r() * 320, r() * 320, 2, 2); }
      x.strokeStyle = 'rgba(55,80,80,0.28)'; x.lineWidth = 1.4;
      for (let i = 0; i < 16; i++) {
        const px = 20 + r() * 270, py = 20 + r() * 280;
        x.beginPath();
        for (let k = 0; k < 3; k++) { x.moveTo(px + k * 9, py); x.quadraticCurveTo(px + k * 9 + 4.5, py - 4, px + k * 9 + 9, py); }
        x.stroke();
      }
      return c;
    }
    makeGrainTile() {
      // yarı saydam kahverengi lekeler (source-atop ile karanın üstüne)
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      const img = x.createImageData(256, 256);
      const r = U.mulberry32(5);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = 90; img.data[i + 1] = 62; img.data[i + 2] = 28; img.data[i + 3] = r() * 34;
      }
      x.putImageData(img, 0, 0);
      for (let i = 0; i < 18; i++) {
        const gx = r() * 256, gy = r() * 256, rad = 20 + r() * 50;
        const gr = x.createRadialGradient(gx, gy, 0, gx, gy, rad);
        gr.addColorStop(0, 'rgba(150,110,60,0.13)'); gr.addColorStop(1, 'rgba(150,110,60,0)');
        x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
      }
      return c;
    }
    // ince arazi dokusu (gri tonlu, çok ölçekli gürültü + benekler): uydu fotoğrafındaki bitki/kaya pürüzü
    makeDetailTile() {
      const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
      const x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data;
      const nz = U.makeNoise(913), r = U.mulberry32(41);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          // döşemenin kenarları birleşsin diye periyodik koordinat (çember üzerinde örnekleme yerine yumuşak karışım)
          const a = nz.fbm(i / 9, j / 9, 3), b2 = nz.fbm((i + N) / 9, j / 9, 3), c2 = nz.fbm(i / 9, (j + N) / 9, 3), e = nz.fbm((i + N) / 9, (j + N) / 9, 3);
          const u = i / N, v = j / N;
          const n = (a * (1 - u) + b2 * u) * (1 - v) + (c2 * (1 - u) + e * u) * v;
          const val = 128 + (n - 0.5) * 70 + (r() - 0.5) * 22;
          const o = (j * N + i) * 4;
          d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, val)); d[o + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      return c;
    }
    makeHatchTile() {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const x = c.getContext('2d');
      x.strokeStyle = 'rgba(30,20,10,0.45)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, 16); x.lineTo(16, 0); x.moveTo(-4, 4); x.lineTo(4, -4); x.moveTo(12, 20); x.lineTo(20, 12); x.stroke();
      return c;
    }

    _addEdgePts(path, pts, lo) {
      const n = pts.length;
      if (!n) return;
      path.moveTo(pts[0][0], pts[0][1]);
      if (!lo || n <= 3) {
        for (let i = 1; i < n; i++) path.lineTo(pts[i][0], pts[i][1]);
      } else {
        for (let i = 3; i < n - 1; i += 3) path.lineTo(pts[i][0], pts[i][1]);
        path.lineTo(pts[n - 1][0], pts[n - 1][1]);
      }
    }

    _mkChunks() {
      const chunks = new Array(16);
      for (let i = 0; i < 16; i++) {
        chunks[i] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, hi: new Path2D(), lo: new Path2D(), has: false };
      }
      return chunks;
    }

    _pushChunkEdge(chunks, e, mW, mH) {
      const pts = e.pts;
      if (!pts.length) return;
      let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const px = pts[i][0], py = pts[i][1];
        if (px < ex0) ex0 = px; if (px > ex1) ex1 = px;
        if (py < ey0) ey0 = py; if (py > ey1) ey1 = py;
      }
      const mx = (ex0 + ex1) * 0.5, my = (ey0 + ey1) * 0.5;
      const gx = U.clamp((mx / mW * 4) | 0, 0, 3), gy = U.clamp((my / mH * 4) | 0, 0, 3);
      const ch = chunks[gy * 4 + gx];
      ch.has = true;
      if (ex0 < ch.x0) ch.x0 = ex0; if (ey0 < ch.y0) ch.y0 = ey0;
      if (ex1 > ch.x1) ch.x1 = ex1; if (ey1 > ch.y1) ch.y1 = ey1;
      this._addEdgePts(ch.hi, pts, false);
      this._addEdgePts(ch.lo, pts, true);
    }

    _strokeChunks(ctx, chunks, vx0, vy0, vx1, vy1, lo) {
      for (let i = 0; i < 16; i++) {
        const ch = chunks[i];
        if (!ch.has || ch.x1 < vx0 || ch.x0 > vx1 || ch.y1 < vy0 || ch.y0 > vy1) continue;
        ctx.stroke(lo ? ch.lo : ch.hi);
      }
    }

    rebuildDynamic() {
      const g = this.game, mW = g.map.W, mH = g.map.H;
      this.version = g.version;
      this.renderLandLayer();
      this.border = new Path2D();
      this.warBorder = new Path2D(); // savaşan ülkelerin ortak sınırı kırmızı çizilir
      this.atkCache = new Map();
      const borderChunks = this._borderChunks = this._mkChunks();
      const warChunks = this._warChunks = this._mkChunks();
      let hasWar = false;
      const buildCoast = !this._coastChunks;
      const coastChunks = buildCoast ? (this._coastChunks = this._mkChunks()) : null;
      const edges = g.map.edges;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.b < 0) {
          if (buildCoast) this._pushChunkEdge(coastChunks, e, mW, mH);
          continue;
        }
        const oa = g.cities[e.a].owner, ob = g.cities[e.b].owner;
        if (oa === ob) continue;
        const war = !g.isRebel(oa) && !g.isRebel(ob) && g.atWar(oa, ob);
        if (war) hasWar = true;
        this._addEdgePts(war ? this.warBorder : this.border, e.pts, true);
        this._pushChunkEdge(war ? warChunks : borderChunks, e, mW, mH);
      }
      this._hasWar = hasWar;
      // ülke etiket konumları
      this.labels = [];
      for (const c of g.countries) {
        if (!c.alive) continue;
        const mine = g.cities.filter((x) => x.owner === c.id);
        if (!mine.length) continue;
        let sx = 0, sy = 0;
        for (const m of mine) { sx += m.x; sy += m.y; }
        sx /= mine.length; sy /= mine.length;
        // merkeze en yakın kendi şehri (etiket toprağın dışına düşmesin)
        let best = mine[0], bd = Infinity;
        for (const m of mine) { const d = Math.hypot(m.x - sx, m.y - sy); if (d < bd) { bd = d; best = m; } }
        this.labels.push({ c, x: (sx + best.x) / 2, y: (sy + best.y) / 2, n: mine.length });
      }
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.dpr = dpr;
      this.vw = window.innerWidth; this.vh = window.innerHeight;
      this.canvas.width = Math.round(this.vw * dpr); this.canvas.height = Math.round(this.vh * dpr);
      this.canvas.style.width = this.vw + 'px'; this.canvas.style.height = this.vh + 'px';
      const mw = this.mini.clientWidth || 230, mh = this.mini.clientHeight || 163;
      this.mini.width = Math.round(mw * dpr); this.mini.height = Math.round(mh * dpr);
      this.clampCam();
    }

    minZoom() { const m = this.game.map; return Math.min(this.vw / m.W, this.vh / m.H) * 0.95; }
    clampCam() {
      const m = this.game.map;
      this.cam.zoom = U.clamp(this.cam.zoom, this.minZoom(), 2.4);
      this.cam.x = U.clamp(this.cam.x, 0, m.W);
      this.cam.y = U.clamp(this.cam.y, 0, m.H);
    }
    toWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.zoom + this.cam.x, (sy - this.vh / 2) / this.cam.zoom + this.cam.y]; }
    toScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.zoom + this.vw / 2, (wy - this.cam.y) * this.cam.zoom + this.vh / 2]; }
    zoomAt(sx, sy, factor) {
      this._camTween = null;
      const [wx, wy] = this.toWorld(sx, sy);
      this.cam.zoom = U.clamp(this.cam.zoom * factor, this.minZoom(), 2.4);
      this.cam.x = wx - (sx - this.vw / 2) / this.cam.zoom;
      this.cam.y = wy - (sy - this.vh / 2) / this.cam.zoom;
      this.clampCam();
    }
    focus(wx, wy, dur = 260) {
      const m = this.game.map;
      const tx = U.clamp(wx, 0, m.W), ty = U.clamp(wy, 0, m.H);
      if (Math.hypot(tx - this.cam.x, ty - this.cam.y) < 4) { this.cam.x = tx; this.cam.y = ty; this._camTween = null; return; }
      this._camTween = { x0: this.cam.x, y0: this.cam.y, x1: tx, y1: ty, t0: performance.now(), dur };
    }

    cityAt(wx, wy) {
      const cities = this.game.map.cities;
      for (let i = 0; i < cities.length; i++) {
        const b = this.bbox[i];
        if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;
        const poly = cities[i].outline;
        let inside = false;
        for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
          const [xa, ya] = poly[a], [xc, yc] = poly[c];
          if ((ya > wy) !== (yc > wy) && wx < ((xc - xa) * (wy - ya)) / (yc - ya) + xa) inside = !inside;
        }
        if (inside) return i;
      }
      return null;
    }
    unitAtScreen(sx, sy) {
      for (let i = this.tokenHits.length - 1; i >= 0; i--) {
        const h = this.tokenHits[i], pad = 4;
        if (sx >= h.x - pad && sx <= h.x + h.w + pad && sy >= h.y - pad && sy <= h.y + h.h + pad) return h.unit;
      }
      return null;
    }

    fillFor(city) {
      const g = this.game;
      const idx = g.cityColorIdx(city);
      const p = G.PALETTE[idx];
      const v = (this.shade[city.id] - 0.5) * 6;
      return U.hsl(p.h, p.s, p.l + v);
    }

    draw() {
      const g = this.game, ctx = this.ctx, cam = this.cam, dpr = this.dpr, ui = this.ui;
      this.frame++;
      if (this.version !== g.version) this.rebuildDynamic();
      const z = cam.zoom, now = performance.now();
      const tw = this._camTween;
      if (tw) {
        const p = Math.min(1, (now - tw.t0) / tw.dur);
        const e = 1 - Math.pow(1 - p, 3);
        cam.x = tw.x0 + (tw.x1 - tw.x0) * e;
        cam.y = tw.y0 + (tw.y1 - tw.y0) * e;
        this.clampCam();
        if (p >= 1) this._camTween = null;
      }
      const ox = this.vw / 2 - cam.x * z, oy = this.vh / 2 - cam.y * z;
      const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(this.vw, this.vh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const terr = this.isTerrain();
      ctx.fillStyle = terr ? '#16395f' : '#a9b8aa'; ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
      ctx.imageSmoothingEnabled = true;
      // görünen bölgeyi önbellek katmanlarından kopyala
      const m = g.map, S = this.layerScale;
      const sx0 = U.clamp(vx0 - 4, 0, m.W), sy0 = U.clamp(vy0 - 4, 0, m.H), sx1 = U.clamp(vx1 + 4, 0, m.W), sy1 = U.clamp(vy1 + 4, 0, m.H);
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(this.mapLayer, sx0 * S, sy0 * S, (sx1 - sx0) * S, (sy1 - sy0) * S, sx0, sy0, sx1 - sx0, sy1 - sy0);
        // uydu görünümünde uzaklaştıkça ülke renkleri belirginleşir (yakında yer şekilleri, uzakta siyasi harita)
        const ta = this.isTerrain() && this.tintLayer ? U.clamp((0.8 - z) * 0.9, 0, 0.5) : 0;
        if (ta > 0.01) {
          ctx.globalAlpha = ta;
          ctx.drawImage(this.tintLayer, sx0 * S, sy0 * S, (sx1 - sx0) * S, (sy1 - sy0) * S, sx0, sy0, sx1 - sx0, sy1 - sy0);
          ctx.globalAlpha = 1;
        }
      }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      const visible = [];
      for (const city of g.cities) {
        const b = this.bbox[city.id];
        if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
        visible.push(city);
      }

      // seçim/hedef vurguları (dünya koordinatı)
      this.drawHighlights(ctx, visible, z, now);
      const atk = this.activeAttacks(vx0, vy0, vx1, vy1);
      this.drawAttackFill(ctx, z, now, atk);

      // ülke sınırları + kıyılar: kamera sabitken önbellek katmanından tek blit
      const bw = Math.max(1, Math.round(this.vw * dpr)), bh = Math.max(1, Math.round(this.vh * dpr));
      if (!this._brdCanvas || this._brdX !== cam.x || this._brdY !== cam.y || this._brdZ !== z ||
          this._brdVw !== this.vw || this._brdVh !== this.vh || this._brdDpr !== dpr || this._brdVer !== this.version) {
        const bcEl = this._brdCanvas || (this._brdCanvas = document.createElement('canvas'));
        if (bcEl.width !== bw || bcEl.height !== bh) { bcEl.width = bw; bcEl.height = bh; }
        const bc = bcEl.getContext('2d');
        bc.setTransform(1, 0, 0, 1, 0, 0);
        bc.clearRect(0, 0, bw, bh);
        bc.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
        bc.lineJoin = z < 0.85 ? 'bevel' : 'round';
        bc.lineCap = 'round';
        const pad = 16 / z, lo = z < 0.78;
        bc.strokeStyle = terr ? 'rgba(12,10,8,0.72)' : 'rgba(40,24,10,0.92)'; bc.lineWidth = (terr ? 3.2 + 1.8 * z : 2.2 + 1.6 * z) / z;
        this._strokeChunks(bc, this._borderChunks, vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, lo);
        if (terr) { // uydu görünümünde siyasi sınır: koyu kenarlı açık çizgi
          bc.strokeStyle = 'rgba(255,240,200,0.92)'; bc.lineWidth = (1.1 + 0.7 * z) / z;
          this._strokeChunks(bc, this._borderChunks, vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, lo);
        }
        if (this._hasWar) {
          bc.strokeStyle = 'rgba(40,12,8,0.9)'; bc.lineWidth = (4.4 + 1.6 * z) / z;
          this._strokeChunks(bc, this._warChunks, vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, lo);
          bc.strokeStyle = 'rgba(206,34,22,0.95)'; bc.lineWidth = (2.6 + 1.2 * z) / z;
          this._strokeChunks(bc, this._warChunks, vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, lo);
        }
        bc.strokeStyle = terr ? 'rgba(18,28,24,0.42)' : INK; bc.lineWidth = (terr ? 1 + 0.6 * z : 2 + 1.2 * z) / z;
        this._strokeChunks(bc, this._coastChunks, vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, lo);
        this._brdX = cam.x; this._brdY = cam.y; this._brdZ = z;
        this._brdVw = this.vw; this._brdVh = this.vh; this._brdDpr = dpr; this._brdVer = this.version;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this._brdCanvas, 0, 0);
      if (atk.length) {
        ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
        this.drawAttackEdges(ctx, z, now, atk);
      }

      // ekran koordinatları
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawWalls(ctx, visible, z);
      this.drawLabels(ctx, z);
      this.drawCityIcons(ctx, visible, z);
      this.drawMoving(ctx, now);
      this.drawTokens(ctx, visible, now);
      this.drawTerrainBadges(ctx);
      this.drawProjectiles(ctx);
      this.drawFx(ctx, now);
      this.drawCommandHint(ctx);

      if (!this._vgCanvas || this._vgW !== this.vw || this._vgH !== this.vh || this._vgT !== terr) {
        this._vgW = this.vw; this._vgH = this.vh; this._vgT = terr;
        const c = this._vgCanvas || (this._vgCanvas = document.createElement('canvas'));
        const vw = Math.max(1, Math.ceil(this.vw * 0.25)), vh = Math.max(1, Math.ceil(this.vh * 0.25));
        c.width = vw; c.height = vh;
        const vc = c.getContext('2d');
        const vg = vc.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.45, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
        const vcol = terr ? '0,8,18' : '70,45,15';
        vg.addColorStop(0, `rgba(${vcol},0)`); vg.addColorStop(1, `rgba(${vcol},${terr ? 0.3 : 0.32})`);
        vc.fillStyle = vg; vc.fillRect(0, 0, vw, vh);
      }
      ctx.drawImage(this._vgCanvas, 0, 0, this.vw, this.vh);

      if (this.frame % 3 === 0) this.drawMinimap();
    }

    // ---- saldırı çizimi (OpenFront tarzı): sınır kızarır, toprak sınırdan içeri doğru yavaş yavaş ele geçirilir ----
    // saldırganın hedef şehirle ortak sınır kenarları (ve hedefin en uzak köşesine mesafe)
    attackGeo(to, owner, fromOnly) {
      const key = to + ':' + owner + ':' + (fromOnly === undefined ? '' : fromOnly);
      let c = this.atkCache.get(key);
      if (c) return c;
      const g = this.game;
      const edges = [];
      for (const { e, other } of this.edgesByCity[to]) {
        if (fromOnly !== undefined ? other === fromOnly : g.friendly(owner, g.cities[other].owner)) edges.push(e);
      }
      const pts = [], path = new Path2D(), fillPath = new Path2D();
      for (const e of edges) {
        this._addEdgePts(path, e.pts, false);
        this._addEdgePts(fillPath, e.pts, true);
        for (let i = 0; i < e.pts.length; i += 2) pts.push(e.pts[i]);
      }
      const city = g.cities[to];
      let maxR = 0;
      for (const v of g.map.cities[to].outline) {
        let md = Infinity;
        if (pts.length) { for (const p of pts) { const d = Math.hypot(v[0] - p[0], v[1] - p[1]); if (d < md) md = d; } } else md = Math.hypot(v[0] - city.x, v[1] - city.y);
        if (md > maxR) maxR = md;
      }
      c = { edges, path, fillPath, maxR: maxR + 8 };
      this.atkCache.set(key, c);
      return c;
    }

    activeAttacks(vx0, vy0, vx1, vy1) {
      const g = this.game;
      const list = this._atkList || (this._atkList = []);
      list.length = 0;
      const seen = this._seenAtk || (this._seenAtk = new Set());
      seen.clear();
      for (let i = 0; i < g.units.length; i++) {
        const u = g.units[i];
        if (u.dead || !u.move) continue;
        const m = u.move;
        if (m.kind !== 'attack' && m.kind !== 'battle') continue;
        seen.add(u.id);
        const b = this.bbox[m.to];
        if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
        const battle = m.kind === 'battle';
        const prev = this.pv.get(u.id) || 0, target = battle ? (m.prog || 0) : 0;
        const vis = prev + (target - prev) * 0.1;
        this.pv.set(u.id, vis);
        // renk, saldıran şehrin hedefle ortak sınırından içeri doğru yayılır (paraşütçü gibi komşu olmayanlarda tüm sınırlardan)
        const adj = g.cities[m.to].neighbors.includes(m.from);
        list.push({ u, m, battle, vis, geo: this.attackGeo(m.to, u.owner, adj ? m.from : undefined) });
      }
      if (this.pv.size > seen.size) for (const k of this.pv.keys()) if (!seen.has(k)) this.pv.delete(k);
      return list;
    }

    // ele geçirilen kısım: sınırdan içeri genişleyen, saldıranın renginde bant (kırmızı ön cephe çizgisiyle)
    drawAttackFill(ctx, z, now, list) {
      if (!list.length) return;
      const g = this.game;
      const atkCols = this._atkCols || (this._atkCols = {});
      if (this._atkColVer !== this.version) { this._atkColVer = this.version; for (const k in atkCols) delete atkCols[k]; }
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (let i = 0; i < list.length; i++) {
        const a = list[i], { u, m, geo } = a;
        if (!a.battle && !geo.edges.length) continue;
        ctx.save();
        ctx.clip(this.cityPaths[m.to]);
        if (!a.battle) {
          // yürüyüş: sınır boyunca hafif kırmızı gölge
          const pulse = 0.5 + 0.5 * Math.sin(now / 240);
          ctx.strokeStyle = `rgba(214,40,26,${0.08 + 0.1 * pulse})`; ctx.lineWidth = (36 + 12 * pulse) / z; ctx.stroke(geo.fillPath);
          ctx.restore();
          continue;
        }
        const R = a.vis * geo.maxR;
        if (R > 0.2) {
          let fill = atkCols[u.owner];
          if (!fill) {
            const p = G.PALETTE[g.cityColorIdx({ owner: u.owner })];
            fill = atkCols[u.owner] = `hsla(${p.h},${p.s}%,${p.l}%,0.94)`;
          }
          if (geo.edges.length) {
            ctx.strokeStyle = 'rgba(190,28,18,0.95)'; ctx.lineWidth = 2 * R + 7 / z; ctx.stroke(geo.fillPath);
            ctx.strokeStyle = fill; ctx.lineWidth = 2 * R; ctx.stroke(geo.fillPath);
          } else {
            const c = g.cities[m.to];
            ctx.fillStyle = 'rgba(190,28,18,0.95)'; ctx.beginPath(); ctx.arc(c.x, c.y, R + 4 / z, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // saldırı yolundaki sınır: yanıp sönen kırmızı
    drawAttackEdges(ctx, z, now, list) {
      if (!list.length) return;
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      const lo = z < 0.78;
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.geo.edges.length) continue;
        const p = lo ? a.geo.fillPath : a.geo.path;
        ctx.strokeStyle = 'rgba(40,10,6,0.85)'; ctx.lineWidth = (6.4 + 1.6 * z) / z; ctx.stroke(p);
        ctx.strokeStyle = `rgba(${Math.round(210 + 40 * pulse)},${Math.round(30 + 40 * pulse)},20,1)`; ctx.lineWidth = (4 + 1.4 * z + 2 * pulse) / z; ctx.stroke(p);
      }
      ctx.restore();
    }

    drawDecor(ctx) {
      const g = this.game, m = g.map;
      // 1) Antika harita dış çerçevesi (çift çerçeve + dönüşümlü derece şeridi)
      ctx.save();
      const pad = 16, bw = 10, x0 = pad, y0 = pad, w0 = m.W - pad * 2, h0 = m.H - pad * 2;
      ctx.strokeStyle = 'rgba(58,40,20,0.75)'; ctx.lineWidth = 2.6;
      ctx.strokeRect(x0, y0, w0, h0);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0 + bw, y0 + bw, w0 - bw * 2, h0 - bw * 2);
      const step = 160;
      ctx.fillStyle = 'rgba(58,40,20,0.72)';
      for (let x = x0 + bw, idx = 0; x < x0 + w0 - bw; x += step, idx++) {
        if (idx % 2 === 0) {
          const sw = Math.min(step, x0 + w0 - bw - x);
          ctx.fillRect(x, y0, sw, bw);
          ctx.fillRect(x, y0 + h0 - bw, sw, bw);
        }
      }
      for (let y = y0 + bw, idx = 0; y < y0 + h0 - bw; y += step, idx++) {
        if (idx % 2 === 0) {
          const sh = Math.min(step, y0 + h0 - bw - y);
          ctx.fillRect(x0, y, bw, sh);
          ctx.fillRect(x0 + w0 - bw, y, bw, sh);
        }
      }
      for (const [kx, ky] of [[x0, y0], [x0 + w0 - bw, y0], [x0, y0 + h0 - bw], [x0 + w0 - bw, y0 + h0 - bw]]) {
        ctx.fillStyle = '#d4b362'; ctx.fillRect(kx, ky, bw, bw);
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.strokeRect(kx, ky, bw, bw);
      }
      // 2) Portolan kerteriz (rhumb) çizgileri — çerçeve içinde kalır
      ctx.beginPath(); ctx.rect(x0 + bw, y0 + bw, w0 - bw * 2, h0 - bw * 2); ctx.clip();
      const cx = 250, cy = m.H - 250, R = 120, diag = Math.hypot(m.W, m.H);
      ctx.strokeStyle = 'rgba(58,40,20,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
        ctx.lineTo(cx + Math.cos(a) * diag, cy + Math.sin(a) * diag);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(130,52,24,0.06)';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.moveTo(m.W - 220, 220);
        ctx.lineTo(m.W - 220 + Math.cos(a) * diag, 220 + Math.sin(a) * diag);
      }
      ctx.stroke();
      ctx.restore();

      // 3) Pusula gülü
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(58,40,20,0.7)'; ctx.fillStyle = 'rgba(233,220,184,0.62)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
        ctx.lineTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82); ctx.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, long = i % 4 === 0, mid = i % 2 === 0;
        const r1 = long ? R : mid ? R * 0.62 : R * 0.45;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a + 0.18) * R * 0.14, Math.sin(a + 0.18) * R * 0.14);
        ctx.lineTo(Math.cos(a - 0.18) * R * 0.14, Math.sin(a - 0.18) * R * 0.14);
        ctx.closePath();
        ctx.fillStyle = long ? 'rgba(58,40,20,0.85)' : 'rgba(150,100,50,0.7)';
        ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, R * 0.1, 0, Math.PI * 2); ctx.fillStyle = '#d4b362'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(58,40,20,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold 34px ${FONT_SC}`; ctx.fillText('K', 0, -R - 22);
      ctx.font = `bold 20px ${FONT_SC}`;
      ctx.fillText('G', 0, R + 18); ctx.fillText('D', R + 18, 0); ctx.fillText('B', -R - 18, 0);
      ctx.restore();

      // 4) Harita kartuşu (harita tipi ve devlet sayısı dinamik)
      const tInfo = G.MapGen && G.MapGen.TYPES && G.MapGen.TYPES.find((t) => t.key === m.mapType);
      const title = m.mapType === 'kita' || !tInfo ? 'Kadîm Kıta' : tInfo.name;
      const sub = g.countries.length === 9 ? 'Dokuz Devletin Haritası' : `${g.countries.length} Devletin Haritası`;
      ctx.save();
      ctx.translate(m.W - 420, 205);
      ctx.fillStyle = 'rgba(236,224,190,0.88)'; ctx.strokeStyle = 'rgba(58,40,20,0.82)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-230, -60); ctx.lineTo(230, -60); ctx.quadraticCurveTo(260, 0, 230, 60); ctx.lineTo(-230, 60); ctx.quadraticCurveTo(-260, 0, -230, -60); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(-215, -47, 430, 94); ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `44px ${FONT_SC}`; ctx.fillText(title, 0, -8);
      ctx.font = `italic 22px ${FONT}`; ctx.fillText(sub, 0, 30);
      ctx.restore();

      // 5) Menzil ölçeği çubuğu (sağ alt deniz köşesi)
      ctx.save();
      ctx.translate(m.W - 350, m.H - 135);
      ctx.fillStyle = 'rgba(236,224,190,0.78)'; ctx.strokeStyle = 'rgba(58,40,20,0.68)'; ctx.lineWidth = 1.6;
      ctx.fillRect(-130, -26, 260, 56); ctx.strokeRect(-130, -26, 260, 56);
      ctx.fillStyle = INK; ctx.font = `italic 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Menzil Ölçeği', 0, -14);
      const sw = 55;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(58,40,20,0.84)' : '#efe2bc';
        ctx.fillRect(-110 + i * sw, -2, sw, 8);
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(-110 + i * sw, -2, sw, 8);
      }
      ctx.fillStyle = INK; ctx.font = `bold 13px ${FONT}`;
      ctx.fillText('0', -110, 18); ctx.fillText('100', 0, 18); ctx.fillText('200 Fersah', 102, 18);
      ctx.restore();
    }

    drawHighlights(ctx, visible, z, now) {
      const g = this.game, ui = this.ui;
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      if (ui.targeting) {
        for (const city of visible) {
          const mk = ui.targeting.mark ? ui.targeting.mark(city.id) : null;
          if (mk) {
            ctx.fillStyle = mk === 'give' ? 'rgba(230,170,40,0.6)' : 'rgba(80,170,70,0.55)';
            ctx.fill(this.cityPaths[city.id]);
            ctx.strokeStyle = mk === 'give' ? '#7a4a08' : '#24501a'; ctx.lineWidth = 4 / z;
            ctx.stroke(this.cityPaths[city.id]);
            continue;
          }
          if (ui.targeting.valid(city.id)) continue;
          ctx.fillStyle = `rgba(255,220,120,${0.18 + 0.15 * pulse})`;
          ctx.fill(this.cityPaths[city.id]);
        }
      }
      if (ui.setupMode) {
        for (const city of visible) {
          if (city.owner !== g.playerId) { ctx.fillStyle = 'rgba(40,30,20,0.35)'; ctx.fill(this.cityPaths[city.id]); }
          else { ctx.fillStyle = `rgba(255,230,140,${0.1 + 0.15 * pulse})`; ctx.fill(this.cityPaths[city.id]); }
        }
      }
      const sel = ui.selectedUnit();
      if (sel) {
        const here = g.cities[sel.city];
        for (const n of here.neighbors) {
          if (g.hostile(sel.owner, g.cities[n].owner)) { ctx.fillStyle = `rgba(190,30,20,${0.12 + 0.12 * pulse})`; ctx.fill(this.cityPaths[n]); }
        }
        ctx.strokeStyle = '#f3cf5a'; ctx.lineWidth = 4 / z; ctx.stroke(this.cityPaths[sel.city]);
      }
      if (ui.hoverCity !== null) {
        const h = ui.hoverCity;
        let col = 'rgba(255,250,230,0.22)';
        if (sel && h !== sel.city) {
          const o = g.cities[h].owner;
          col = g.friendly(sel.owner, o) ? 'rgba(80,190,90,0.35)' : g.hostile(sel.owner, o) && g.cities[sel.city].neighbors.includes(h) ? 'rgba(220,40,30,0.4)' : 'rgba(60,60,60,0.25)';
        } else if (ui.targeting) {
          col = ui.targeting.valid(h) ? 'rgba(60,60,60,0.25)' : 'rgba(255,215,90,0.45)';
        }
        ctx.fillStyle = col; ctx.fill(this.cityPaths[h]);
      }
    }

    drawLabels(ctx, z) {
      const alpha = z > 1.1 ? Math.max(0, 0.5 - (z - 1.1)) : 0.5;
      if (alpha <= 0.02) return;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const terr = this.isTerrain();
      ctx.globalAlpha = terr ? Math.min(1, alpha * 1.5) : alpha;
      ctx.lineWidth = terr ? 5 : 4; ctx.strokeStyle = terr ? 'rgba(10,10,8,0.6)' : 'rgba(240,228,196,0.7)';
      let lastLs = '';
      for (let i = 0; i < this.labels.length; i++) {
        const L = this.labels[i];
        const [sx, sy] = this.toScreen(L.x, L.y);
        if (sx < -300 || sx > this.vw + 300 || sy < -100 || sy > this.vh + 100) continue;
        const fs = U.clamp(70 * z * Math.sqrt(Math.min(1.6, L.n / 17)), 10, 64);
        ctx.font = `${fs}px ${FONT_SC}`;
        const ls = Math.round(fs * 0.18) + 'px';
        if (ls !== lastLs) { lastLs = ls; try { ctx.letterSpacing = ls; } catch (e) { /* eski tarayıcı */ } }
        const up = L.upper || (L.upper = L.c.name.toLocaleUpperCase('tr'));
        ctx.strokeText(up, sx, sy);
        ctx.fillStyle = terr ? L.c.light : L.c.dark; ctx.fillText(up, sx, sy);
      }
      ctx.globalAlpha = 1;
      if (lastLs) try { ctx.letterSpacing = '0px'; } catch (e) { /* */ }
    }

    star(ctx, x, y, r, fill) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
    }

    drawCityIcons(ctx, visible, z) {
      const g = this.game, s = this.ui.scale;
      const showNames = z >= 0.7;
      let capitals = this._capSet;
      if (!capitals || this._capVer !== this.version) {
        capitals = this._capSet || (this._capSet = new Set());
        capitals.clear();
        for (let i = 0; i < g.countries.length; i++) {
          const c = g.countries[i];
          if (c.alive && c.capital >= 0) capitals.add(c.capital);
        }
        this._capVer = this.version;
      }
      const invDur = 1 / G.CFG.factoryBuildTime;
      const mS = this.modelScale(), now = performance.now();
      const markFn = this.ui.targeting && this.ui.targeting.mark;
      const nameFont = showNames ? `italic ${11.5 * s}px ${FONT}` : '';
      const markFont = markFn ? `bold ${11 * s}px ${FONT}` : '';
      let curFont = '';
      for (let i = 0; i < visible.length; i++) {
        const city = visible[i];
        const [sx, sy] = this.toScreen(city.x, city.y);
        const isCap = capitals.has(city.id);
        if (isCap) ctx.drawImage(this.capSprite(city.id === g.player.capital), sx - 13 * s, sy - 37 * s, 26 * s, 26 * s);
        if (city.factories || city.building.length || city.airDef) this.drawCityModels(ctx, city, sx, sy, mS, now, invDur);
        const mk = markFn ? markFn(city.id) : null;
        if (mk) {
          const txt = mk === 'give' ? 'Ver' : 'Al';
          if (curFont !== markFont) { ctx.font = curFont = markFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
          const bw = this.measureCached(ctx, markFont, txt) + 12 * s, bx = sx + 22 * s, by = sy - 16 * s;
          ctx.fillStyle = mk === 'give' ? '#8a5a12' : '#2f5a1e';
          ctx.beginPath(); ctx.ellipse(bx, by, bw / 2, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillText(txt, bx, by + 0.5);
        }
        if (showNames) {
          if (curFont !== nameFont) { ctx.font = curFont = nameFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
          const ny = sy - (isCap ? 41 : 22) * s;
          const terr = this.isTerrain();
          ctx.lineWidth = 3; ctx.strokeStyle = terr ? 'rgba(10,10,8,0.7)' : 'rgba(240,228,196,0.85)'; ctx.strokeText(city.name, sx, ny);
          ctx.fillStyle = terr ? '#fbf3dc' : INK; ctx.fillText(city.name, sx, ny);
        }
      }
    }

    // Birlik seçiliyken saldırılabilir komşu şehirlerin arazi rozeti: yer şekli, savunma etkisi, yükseklik farkı.
    // Kırmızımsı = saldırana zor (dağ, tepe, orman, yokuş yukarı), yeşil = kolay (çöl, yüksekten saldırı).
    drawTerrainBadges(ctx) {
      const g = this.game, ui = this.ui, s = ui.scale;
      const sel = ui.selectedUnit();
      if (!sel || sel.city === null || !g.terrain) return;
      const here = g.cities[sel.city];
      const font = `bold ${11 * s}px ${FONT}`;
      ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const n of here.neighbors) {
        const c = g.cities[n];
        if (!g.hostile(sel.owner, c.owner)) continue;
        const T = g.terrainOf(n), h = g.heightAtk(sel.city, n);
        if (T.def === 1 && h === 1) continue;
        const [sx, sy] = this.toScreen(c.x, c.y);
        if (sx < -60 || sx > this.vw + 60 || sy < -60 || sy > this.vh + 60) continue;
        let txt = T.icon;
        if (T.def !== 1) txt += ` ${T.def > 1 ? '+' : '−'}%${Math.round(Math.abs(T.def - 1) * 100)}`;
        if (h > 1) txt += ' ⬇'; else if (h < 1) txt += ' ⬆';
        const net = h / T.def;
        const rowsN = this.modelRowsCount(c);
        const bw = this.measureCached(ctx, font, txt) + 12 * s, bx = sx, by = rowsN ? sy + (38 + (rowsN - 1) * 25 + 13) * this.modelScale() : sy + 26 * s;
        ctx.fillStyle = net < 0.97 ? 'rgba(122,38,22,0.92)' : net > 1.03 ? 'rgba(40,92,32,0.92)' : 'rgba(74,58,40,0.92)';
        ctx.beginPath(); ctx.ellipse(bx, by, bw / 2, 9.5 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillText(txt, bx, by + 0.5);
      }
    }

    // ---------- şehir yapıları: fabrika ve hava savunma modelleri, şehir savunması için sur ----------
    // Yakınlaştıkça büyür; uzakta küçülür ama okunur kalır.
    modelScale() { return this.ui.scale * U.clamp(0.42 + 0.7 * this.cam.zoom, 0.66, 1.75); }

    // Yapıların yerleşimi: şehrin altında satırlar (hava savunma, fabrikalar, inşaattakiler).
    // Satır en fazla ~110 birim genişlikte; dolarsa alta yeni satır açılır.
    cityModelLayout(city) {
      const items = [];
      if (city.airDef) items.push({ k: 'aa', w: 28 });
      for (let j = 0; j < city.factories; j++) items.push({ k: 'f', w: 22 });
      for (let j = 0; j < city.building.length; j++) items.push({ k: 'b', w: 22, j });
      const rows = [[]];
      let rw = 0;
      for (const it of items) {
        if (rw + it.w > 112 && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
        rows[rows.length - 1].push(it); rw += it.w;
      }
      return rows;
    }
    modelRowsCount(city) {
      const n = city.factories + city.building.length + (city.airDef ? 1 : 0);
      return n ? this.cityModelLayout(city).length : 0;
    }

    drawCityModels(ctx, city, sx, sy, m, now, invDur) {
      const g = this.game, rows = this.cityModelLayout(city);
      const smoke = this.cam.zoom >= 0.32;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        let tw = 0; for (const it of row) tw += it.w;
        let x = sx - (tw * m) / 2;
        const base = sy + (34 + r * 22) * m; // satırın zemin çizgisi
        for (const it of row) {
          const cx = x + (it.w * m) / 2;
          if (it.k === 'aa') { this.drawModel(ctx, this.modelSprite('aa'), cx, base, m); this.aaRadar(ctx, cx, base, m, now, city.id); }
          else if (it.k === 'f') {
            this.drawModel(ctx, this.modelSprite('factory'), cx, base, m);
            if (smoke) this.factorySmoke(ctx, cx + 5.5 * m, base - 19 * m, m, now, city.id * 3.1 + x * 0.013);
          } else {
            // inşaattaki fabrika: soluk siluet + altında dolan çubuk
            const p = U.clamp(1 - (city.building[it.j] - g.time) * invDur, 0, 1);
            ctx.globalAlpha = 0.28 + 0.4 * p;
            this.drawModel(ctx, this.modelSprite('factory'), cx, base, m);
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(20,14,8,0.7)'; ctx.fillRect(cx - 9 * m, base + 2 * m, 18 * m, 2.6 * m);
            ctx.fillStyle = '#e2b84a'; ctx.fillRect(cx - 9 * m, base + 2 * m, 18 * m * p, 2.6 * m);
          }
          x += it.w * m;
        }
      }
    }

    // Şehir savunması: şehrin sınırı boyunca, biraz içeriden giden sur çizgisi ve üzerinde dik çizgiler.
    // Çizgiler ekranda eşit aralıklı ve sabit boyludur (yakınlaşınca sıklaşmaz, uzaklaşınca kaybolmaz).
    drawWalls(ctx, visible, z) {
      let any = false;
      for (let i = 0; i < visible.length; i++) if (visible[i].cityDef) { any = true; break; }
      if (!any) return;
      const s = this.ui.scale, pts = this._wallPts || (this._wallPts = []);
      const h = U.clamp(4 + 4 * z, 4.5, 10) * s; // dik çizgi boyu (px)
      const gap = U.clamp(5.5 + 2 * z, 6, 10) * s; // dik çizgiler arası (px)
      const base = new Path2D(), posts = new Path2D();
      for (const c of visible) {
        if (!c.cityDef) continue;
        const P = pts[c.id] || (pts[c.id] = this.wallPoints(c.id));
        let acc = gap, px = 0, py = 0;
        for (let i = 0; i < P.length; i++) {
          const sx = (P[i][0] - this.cam.x) * z + this.vw / 2, sy = (P[i][1] - this.cam.y) * z + this.vh / 2;
          if (i === 0) base.moveTo(sx, sy); else { base.lineTo(sx, sy); acc += Math.abs(sx - px) + Math.abs(sy - py); }
          if (acc >= gap) { posts.moveTo(sx, sy); posts.lineTo(sx, sy - h); acc = 0; }
          px = sx; py = sy;
        }
        base.closePath();
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,14,8,0.85)';
      ctx.lineWidth = 4 * s; ctx.stroke(base);
      ctx.lineWidth = 3.4 * s; ctx.stroke(posts);
      ctx.strokeStyle = '#ece4cf';
      ctx.lineWidth = 1.9 * s; ctx.stroke(base);
      ctx.lineWidth = 1.4 * s; ctx.stroke(posts);
      ctx.lineCap = 'round';
    }
    // şehrin dış çizgisi, merkeze doğru biraz içeri çekilip ~3 birim aralıkla örneklenir
    wallPoints(cid) {
      const mc = this.game.map.cities[cid], out = [];
      const r = Math.sqrt(mc.area / Math.PI), ins = Math.min(8, r * 0.1);
      const o = mc.outline.map(([x, y]) => { const dx = mc.x - x, dy = mc.y - y, d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * ins, y + (dy / d) * ins]; });
      for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      return out;
    }
    // sprite: birim koordinatlı çizim, alt orta noktası (ax, ay) zemine oturur
    drawModel(ctx, sp, x, y, m) { ctx.drawImage(sp.c, x - sp.ax * m, y - sp.ay * m, sp.w * m, sp.h * m); }

    modelSprite(kind) {
      const cache = this._mdl || (this._mdl = {});
      if (cache[kind]) return cache[kind];
      const R = 4; // birim başına piksel (keskin görünüm için)
      const dims = { factory: [24, 24, 12, 21], aa: [30, 26, 15, 22] }[kind];
      const [w, h, ax, ay] = dims;
      const c = document.createElement('canvas'); c.width = w * R; c.height = h * R;
      const x = c.getContext('2d');
      x.scale(R, R); x.translate(ax, ay); x.lineJoin = 'round'; x.lineCap = 'round';
      const poly = (pts, fill, stroke, lw) => {
        x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath();
        if (fill) { x.fillStyle = fill; x.fill(); }
        if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 0.7; x.stroke(); }
      };
      const shadow = (rx, ry) => { x.fillStyle = 'rgba(0,0,0,0.32)'; x.beginPath(); x.ellipse(1.5, 0.5, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
      const OUT = 'rgba(28,18,10,0.9)';
      if (kind === 'factory') {
        // sade siluet: düz gövde, üç dişli çatı ve baca; açık renkli ince kenar her zeminde okunur
        poly([[-10, 0], [-10, -11], [-5, -7], [-5, -11], [0, -7], [0, -11], [4, -7], [4, -18], [7, -18], [7, -7], [8, -7], [8, 0]],
          '#2f2c29', 'rgba(250,242,222,0.92)', 1.1);
      } else if (kind === 'aa') {
        shadow(14, 3);
        // kum torbası çemberi
        x.fillStyle = '#b9a473'; x.strokeStyle = OUT; x.lineWidth = 0.45;
        for (let k = 0; k < 9; k++) { const px = -12 + k * 3; x.beginPath(); x.ellipse(px, -1.6, 1.9, 1.5, 0, 0, Math.PI * 2); x.fill(); x.stroke(); }
        for (let k = 0; k < 8; k++) { const px = -10.5 + k * 3; x.beginPath(); x.ellipse(px, -4, 1.9, 1.4, 0, 0, Math.PI * 2); x.fill(); x.stroke(); }
        // top kaidesi + çift namlu
        poly([[-5, -4], [5, -4], [3.5, -8], [-3.5, -8]], '#4f5d3a', OUT);
        x.strokeStyle = '#2c3324'; x.lineWidth = 1.3;
        x.beginPath(); x.moveTo(-1, -7.5); x.lineTo(7, -18); x.moveTo(1, -7); x.lineTo(9, -17); x.stroke();
        x.strokeStyle = '#1a1e16'; x.lineWidth = 0.5;
        x.beginPath(); x.moveTo(-1, -7.5); x.lineTo(7, -18); x.moveTo(1, -7); x.lineTo(9, -17); x.stroke();
        x.fillStyle = '#3d4a2e'; x.beginPath(); x.arc(0, -7.5, 2.4, 0, Math.PI * 2); x.fill(); x.strokeStyle = OUT; x.lineWidth = 0.5; x.stroke();
        // radar direği (çanak her karede döner)
        x.strokeStyle = '#4a4a44'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-9, -4); x.lineTo(-9, -12); x.stroke();
      }
      cache[kind] = { c, w, h, ax, ay };
      return cache[kind];
    }
    // fabrika bacasından yükselen duman
    factorySmoke(ctx, x, y, m, now, seed) {
      for (let k = 0; k < 2; k++) {
        const ph = (now / 2400 + k / 2 + seed) % 1;
        const r = (1.1 + ph * 2.6) * m;
        ctx.fillStyle = `rgba(222,220,214,${(0.45 * (1 - ph)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x + ph * 5 * m, y - ph * 11 * m, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // hava savunmanın dönen radar çanağı
    aaRadar(ctx, x, y, m, now, id) {
      const cx = x - 9 * m, cy = y - 12.5 * m, a = now / 700 + id, rx = Math.abs(Math.cos(a)) * 3.2 * m + 0.6 * m;
      ctx.fillStyle = '#c9cdc4'; ctx.strokeStyle = 'rgba(28,18,10,0.85)'; ctx.lineWidth = Math.max(0.6, 0.45 * m);
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, 2.6 * m, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Önbellekli başkent yıldızı (oyuncu başkentine ekstra altın hale)
    capSprite(isPlayer) {
      const cache = this._capSpr || (this._capSpr = {});
      const key = isPlayer ? 1 : 0;
      if (cache[key]) return cache[key];
      const sz = 52, c = document.createElement('canvas');
      c.width = c.height = sz;
      const x = c.getContext('2d'), cx = sz / 2, cy = sz / 2, r = isPlayer ? 22 : 21;
      if (isPlayer) {
        const gr = x.createRadialGradient(cx, cy, 4, cx, cy, 26);
        gr.addColorStop(0, 'rgba(255,224,96,0.55)');
        gr.addColorStop(1, 'rgba(255,224,96,0)');
        x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, 26, 0, Math.PI * 2); x.fill();
      }
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        i ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      x.closePath();
      x.fillStyle = isPlayer ? '#ffd95e' : '#f1c94f'; x.fill();
      x.lineWidth = 3; x.strokeStyle = INK; x.stroke();
      cache[key] = c;
      return c;
    }


    // Fabrikaya bağlı olmayan (zayıf) birliklerin üstündeki uyarı işareti: sarı üçgen + ünlem
    weakBadge(ctx, x, y, size) {
      const bob = Math.sin(performance.now() / 260) * size * 0.07;
      const cy = y + bob, r = size * 0.62;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x, cy - r); ctx.lineTo(x + r * 0.95, cy + r * 0.72); ctx.lineTo(x - r * 0.95, cy + r * 0.72); ctx.closePath();
      ctx.fillStyle = '#f5b800'; ctx.fill();
      ctx.lineWidth = Math.max(1.6, size * 0.14); ctx.strokeStyle = '#7a160c'; ctx.stroke();
      ctx.fillStyle = '#4a0d07'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${size * 0.95}px ${FONT}`;
      ctx.fillText('!', x, cy + r * 0.2);
      ctx.restore();
    }

    measureCached(ctx, fontKey, txt) {
      let cache = this._twCache;
      if (!cache) cache = this._twCache = new Map();
      let byFont = cache.get(fontKey);
      if (!byFont) {
        if (cache.size > 16) cache.clear();
        byFont = new Map();
        cache.set(fontKey, byFont);
      }
      let w = byFont.get(txt);
      if (w === undefined) {
        if (byFont.size > 600) byFont.clear();
        w = ctx.measureText(txt).width;
        byFont.set(txt, w);
      }
      return w;
    }

    findArmy(id) {
      const arr = this.game.armies;
      for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    }

    token(ctx, x, y, u, opts) {
      const g = this.game, s = this.ui.scale;
      const c = g.countries[u.owner];
      const txt = U.fmtK(u.troops);
      const font = `bold ${12 * s}px ${FONT}`;
      ctx.font = font;
      const w = this.measureCached(ctx, font, txt) + 14 * s, h = 18 * s;
      const x0 = x - w / 2, y0 = y - h / 2;
      ctx.beginPath();
      ctx.moveTo(x0 + 3, y0); ctx.lineTo(x0 + w - 3, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + 3);
      ctx.lineTo(x0 + w, y0 + h - 3); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - 3, y0 + h);
      ctx.lineTo(x + 4 * s, y0 + h); ctx.lineTo(x, y0 + h + 4 * s); ctx.lineTo(x - 4 * s, y0 + h);
      ctx.lineTo(x0 + 3, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - 3);
      ctx.lineTo(x0, y0 + 3); ctx.quadraticCurveTo(x0, y0, x0 + 3, y0); ctx.closePath();
      ctx.fillStyle = c.isRebel ? '#2a2a2a' : c.dark; ctx.fill();
      if (opts && opts.selected) {
        // GPU shadowBlur yerine hafif altın dış hale: belirgin ve çok daha hızlı
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,215,90,0.45)'; ctx.stroke();
      }
      ctx.lineWidth = c.isPlayer ? 2.2 : 1.4;
      ctx.strokeStyle = opts && opts.selected ? '#ffe27a' : c.isPlayer ? '#e2b84a' : c.color;
      ctx.stroke();
      if (opts && opts.marked) {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2;
        ctx.strokeRect(x0 - 3, y0 - 3, w + 6, h + 6); ctx.setLineDash([]);
      }
      ctx.fillStyle = '#fbf1d6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, x, y + 0.5);
      if (u.weak) this.weakBadge(ctx, x, y0 - 9 * s, 15 * s);
      if (u.army !== null) {
        const army = this.findArmy(u.army);
        if (army) {
          ctx.beginPath(); ctx.arc(x0 + w, y0, 6.5 * s, 0, Math.PI * 2);
          ctx.fillStyle = army.mode === 'attack' ? '#a3271c' : '#2c5a8c'; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = `bold ${8.5 * s}px ${FONT}`;
          ctx.fillText(army.mode === 'attack' ? 'T' : 'S', x0 + w, y0 + 0.5);
        }
      }
      return { x: x0, y: y0, w, h };
    }

    drawTokens(ctx, visible, now) {
      const g = this.game, ui = this.ui, s = ui.scale;
      const hits = this.tokenHits = [];
      const visSet = this._visSet || (this._visSet = new Set());
      visSet.clear();
      for (let i = 0; i < visible.length; i++) visSet.add(visible[i].id);
      const byCity = this._byCity || (this._byCity = new Map());
      for (const arr of byCity.values()) arr.length = 0;
      for (let i = 0; i < g.units.length; i++) {
        const u = g.units[i];
        if (u.dead || u.move || u.city === null || !visSet.has(u.city)) continue;
        let arr = byCity.get(u.city);
        if (!arr) { arr = []; byCity.set(u.city, arr); }
        arr.push(u);
      }
      const fs = this.landFont();
      const rowH = fs * 1.3;
      const font = `bold ${fs}px ${FONT}`;
      const armyFont = `bold ${8.5 * s}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const [cityId, list] of byCity) {
        if (!list.length) continue;
        const city = g.cities[cityId];
        const [sx, sy] = this.toScreen(city.x, city.y);
        if (list.length > 1) list.sort((a, b) => (a.owner === g.playerId) - (b.owner === g.playerId) || a.id - b.id);
        // asker sayıları doğrudan toprağın üzerine yazılır; birden çok birlik varsa alt alta dizilir
        const top = sy - 2 * s - ((list.length - 1) * rowH) / 2;
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          const r = this.landToken(ctx, sx, top + i * rowH, u, { selected: ui.selUnit === u.id, marked: ui.marked.has(u.id) }, fs, font, armyFont);
          hits.push({ unit: u, ...r });
        }
      }
    }

    landFont() { return U.clamp(15 * this.ui.scale * (0.72 + 0.5 * Math.min(this.cam.zoom, 1.6)), 11 * this.ui.scale, 25 * this.ui.scale); }

    // Kara üzerine yazılmış asker sayısı: parşömen renkli halka + ülkenin koyu rengi
    landToken(ctx, x, y, u, opts, fsArg, fontArg, armyFontArg) {
      const g = this.game, s = this.ui.scale;
      const c = g.countries[u.owner];
      const txt = U.fmtK(u.troops);
      const fs = fsArg || this.landFont();
      const font = fontArg || `bold ${fs}px ${FONT}`;
      ctx.font = font;
      if (!fsArg) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; }
      const tw = this.measureCached(ctx, font, txt), w = tw + 12 * s, h = fs * 1.25;
      const x0 = x - w / 2, y0 = y - h / 2;
      if (opts && opts.selected) {
        ctx.lineWidth = fs * 0.68; ctx.strokeStyle = 'rgba(255,207,74,0.45)';
        ctx.strokeText(txt, x, y);
        ctx.strokeStyle = 'rgba(255,236,160,1)';
      } else {
        ctx.strokeStyle = 'rgba(248,240,216,0.93)';
      }
      ctx.lineWidth = fs * 0.4;
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = c.isRebel ? '#1d1d1d' : c.dark;
      ctx.fillText(txt, x, y + 0.5);
      if (c.isPlayer) {
        ctx.strokeStyle = '#d6a22a'; ctx.lineWidth = Math.max(2, fs * 0.13); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - tw / 2, y + fs * 0.58); ctx.lineTo(x + tw / 2, y + fs * 0.58); ctx.stroke();
      }
      if (u.weak) this.weakBadge(ctx, x, y0 - fs * 0.32, fs * 0.95);
      if (opts && opts.marked) {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#8a5a12'; ctx.lineWidth = 2;
        ctx.strokeRect(x0 - 2, y0 - 2, w + 4, h + 4); ctx.setLineDash([]);
      }
      if (u.army !== null) {
        const army = this.findArmy(u.army);
        if (army) {
          ctx.beginPath(); ctx.arc(x0 + w, y0 + 1, 6.5 * s, 0, Math.PI * 2);
          ctx.fillStyle = army.mode === 'attack' ? '#a3271c' : '#2c5a8c'; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = armyFontArg || `bold ${8.5 * s}px ${FONT}`;
          ctx.fillText(army.mode === 'attack' ? 'T' : 'S', x0 + w, y0 + 1.5);
        }
      }
      return { x: x0, y: y0, w, h };
    }

    drawMoving(ctx, now) {
      const g = this.game, s = this.ui.scale;
      for (let i = 0; i < g.units.length; i++) {
        const u = g.units[i];
        if (u.dead || !u.move) continue;
        const m = u.move;
        const [wx, wy] = g.unitPos(u);
        const [sx, sy] = this.toScreen(wx, wy);
        const dest = g.cities[m.to];
        const [dx, dy] = this.toScreen(dest.x, dest.y);
        const sOff = sx < -80 || sx > this.vw + 80 || sy < -80 || sy > this.vh + 80;
        if (sOff && (m.kind !== 'battle' || dx < -80 || dx > this.vw + 80 || dy < -80 || dy > this.vh + 80)) continue;
        const hostile = m.kind === 'attack' || m.kind === 'battle' || (m.kind === 'para' && !g.friendly(u.owner, dest.owner));
        const ang = Math.atan2(dy - sy, dx - sx);
        let bob = 0;
        if (m.kind === 'move' || m.kind === 'retreat') {
          // yürüyüş: birlik hafifçe sallanır, arkasında toz bulutu kalkar
          bob = Math.sin(now / 95 + u.id) * 1.6 * s;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          for (let k = 0; k < 4; k++) {
            const ph = (now / 520 + k / 4 + u.id * 0.13) % 1;
            const back = (10 + ph * 26) * s, side = Math.sin((ph + k) * 9) * 4 * s;
            ctx.fillStyle = `rgba(132,104,66,${0.32 * (1 - ph)})`;
            ctx.beginPath(); ctx.arc(sx - ca * back - sa * side, sy + 8 * s - sa * back + ca * side, (2 + ph * 5) * s, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (m.kind !== 'battle') {
          ctx.setLineDash([6, 6]); ctx.lineDashOffset = -now / 60;
          ctx.strokeStyle = hostile ? 'rgba(170,25,15,0.85)' : m.back ? 'rgba(196,140,22,0.95)' : m.dist ? 'rgba(46,112,52,0.75)' : 'rgba(40,28,14,0.7)';
          ctx.lineWidth = m.back ? 3 : 2.2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(dx, dy); ctx.stroke(); ctx.setLineDash([]);
          // ok ucu
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - Math.cos(ang - 0.4) * 11, dy - Math.sin(ang - 0.4) * 11); ctx.lineTo(dx - Math.cos(ang + 0.4) * 11, dy - Math.sin(ang + 0.4) * 11); ctx.fill();
        } else {
          // muharebe
          const pulse = 0.5 + 0.5 * Math.sin(now / 120);
          ctx.beginPath(); ctx.arc(dx, dy, (22 + 6 * pulse) * s, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(190,30,20,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 3; ctx.stroke();
          const mx = (sx + dx) / 2, my = (sy + dy) / 2, bt = now / 210;
          ctx.fillStyle = 'rgba(255,216,104,0.88)';
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = bt + k * 2.094, rx = mx + Math.cos(a) * 16 * s, ry = my + Math.sin(a) * 12 * s;
            ctx.moveTo(rx + 2.2 * s, ry); ctx.arc(rx, ry, 2.2 * s, 0, Math.PI * 2);
          }
          ctx.fill();
          this.swords(ctx, mx, my, s);
          (this._mvPcts || (this._mvPcts = [])).push(dx, dy + 36 * s, '%' + Math.round(100 * (m.prog || 0)));
        }
        if (m.kind === 'para') {
          ctx.font = `${20 * s}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = INK; ctx.save(); ctx.translate(sx, sy - 18 * s); ctx.rotate(ang);
          ctx.fillText('✈︎', 0, 0); ctx.restore();
        }
        (this._mvToks || (this._mvToks = [])).push(sx, sy + bob, u);
      }
      const pcts = this._mvPcts;
      if (pcts && pcts.length) {
        ctx.font = `bold ${13 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(248,240,216,0.95)'; ctx.fillStyle = '#a3170d';
        for (let i = 0; i < pcts.length; i += 3) {
          ctx.strokeText(pcts[i + 2], pcts[i], pcts[i + 1]);
          ctx.fillText(pcts[i + 2], pcts[i], pcts[i + 1]);
        }
        pcts.length = 0;
      }
      const toks = this._mvToks;
      if (toks && toks.length) {
        for (let i = 0; i < toks.length; i += 3) this.token(ctx, toks[i], toks[i + 1], toks[i + 2], {});
        toks.length = 0;
      }
    }

    swords(ctx, x, y, s) {
      const k = s + ':' + this.dpr;
      let spr = this._swordSpr;
      if (!spr || this._swordKey !== k) {
        const sc = Math.max(1, s * (this.dpr || 1)), sz = 26;
        spr = this._swordSpr = document.createElement('canvas');
        spr.width = Math.ceil(sz * sc); spr.height = Math.ceil(sz * sc);
        const scx = spr.getContext('2d');
        scx.setTransform(sc, 0, 0, sc, spr.width / 2, spr.height / 2);
        scx.strokeStyle = '#2a1a0c'; scx.lineWidth = 3; scx.lineCap = 'round';
        for (const d of [-1, 1]) {
          scx.beginPath(); scx.moveTo(-9 * d, -9); scx.lineTo(9 * d, 9); scx.stroke();
          scx.beginPath(); scx.moveTo(-5 * d, 3); scx.lineTo(3 * d, -4); scx.stroke();
        }
        scx.strokeStyle = '#e8d9b0'; scx.lineWidth = 1.3;
        for (const d of [-1, 1]) { scx.beginPath(); scx.moveTo(-9 * d, -9); scx.lineTo(7 * d, 7); scx.stroke(); }
        this._swordKey = k;
        this._swordW = sz * s;
      }
      const w = this._swordW;
      ctx.drawImage(spr, x - w / 2, y - w / 2, w, w);
    }

    drawProjectiles(ctx) {
      const g = this.game;
      for (const p of g.projectiles) {
        const a = g.cities[p.from] || g.cities[p.to], b = g.cities[p.to];
        const t = U.clamp((g.time - p.t0) / (p.t1 - p.t0), 0, 1);
        const wx = a.x + (b.x - a.x) * t, wy = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 260;
        const [sx, sy] = this.toScreen(wx, wy);
        for (let k = 1; k < 8; k++) {
          const tt = Math.max(0, t - k * 0.02);
          const [tx, ty] = this.toScreen(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt - Math.sin(tt * Math.PI) * 260);
          ctx.fillStyle = `rgba(90,80,70,${0.35 - k * 0.04})`;
          ctx.beginPath(); ctx.arc(tx, ty, 3 + k * 0.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#7a1c12'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffcf6a'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    drawFx(ctx, now) {
      const s = this.ui.scale, me = this.game.playerId;
      this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
      for (const f of this.fx) {
        const t = (now - f.t0) / f.dur;
        const [sx, sy] = this.toScreen(f.x, f.y);
        if (sx < -160 || sx > this.vw + 160 || sy < -160 || sy > this.vh + 160) continue;
        const mine = f.owner === me;
        switch (f.kind) {
          case 'explosion':
            for (let k = 0; k < 3; k++) {
              ctx.beginPath(); ctx.arc(sx, sy, 10 + t * (60 + k * 25), 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${230 - k * 30},${120 - k * 30},30,${(1 - t) * 0.35})`; ctx.fill();
            }
            break;
          case 'recall': {
            // cepheden şehre akan altın ok + şehirde açılan kalkan halkası
            const [bx, by] = this.toScreen(f.bx, f.by);
            const k = easeOut(Math.min(1, t * 1.7));
            const nx = -(sy - by), ny = sx - bx, nl = Math.hypot(nx, ny) || 1;
            const cx = (bx + sx) / 2 + (nx / nl) * 26 * s, cy = (by + sy) / 2 + (ny / nl) * 26 * s;
            const q = (p) => [(1 - p) * (1 - p) * bx + 2 * (1 - p) * p * cx + p * p * sx, (1 - p) * (1 - p) * by + 2 * (1 - p) * p * cy + p * p * sy];
            const al = 1 - Math.max(0, (t - 0.6) / 0.4);
            ctx.save(); ctx.lineCap = 'round';
            ctx.strokeStyle = `rgba(214,160,36,${0.95 * al})`; ctx.lineWidth = 4.5 * s;
            ctx.beginPath(); ctx.moveTo(bx, by);
            for (let i = 1; i <= 16; i++) { const [px, py] = q((i / 16) * k); ctx.lineTo(px, py); }
            ctx.stroke();
            const [hx, hy] = q(k), [px, py] = q(Math.max(0, k - 0.05));
            const ang = Math.atan2(hy - py, hx - px);
            ctx.fillStyle = `rgba(214,160,36,${al})`;
            ctx.beginPath(); ctx.moveTo(hx + Math.cos(ang) * 9 * s, hy + Math.sin(ang) * 9 * s);
            ctx.lineTo(hx + Math.cos(ang + 2.4) * 9 * s, hy + Math.sin(ang + 2.4) * 9 * s);
            ctx.lineTo(hx + Math.cos(ang - 2.4) * 9 * s, hy + Math.sin(ang - 2.4) * 9 * s); ctx.fill();
            ctx.restore();
            if (t > 0.35) this.fxRing(ctx, sx, sy, (t - 0.35) / 0.65, [214, 160, 36], 16 * s, 46 * s);
            this.floatText(ctx, sx, sy - 34 * s, f.text, t, '#7a4c08');
            break;
          }
          case 'shield': {
            // savunmaya dönen birlik şehre girdi: kalkan belirir
            const p = Math.min(1, t / 0.35), al = 1 - Math.max(0, (t - 0.55) / 0.45);
            this.fxRing(ctx, sx, sy, t, [44, 90, 140], 14 * s, 40 * s);
            ctx.save(); ctx.globalAlpha = al; ctx.translate(sx, sy - 30 * s); const sc = easeBack(p) * s; ctx.scale(sc, sc);
            ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, -7); ctx.quadraticCurveTo(9, 6, 0, 12); ctx.quadraticCurveTo(-9, 6, -9, -7); ctx.closePath();
            ctx.fillStyle = '#2c5a8c'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#f1dc9a'; ctx.stroke();
            ctx.restore();
            break;
          }
          case 'join': {
            // orduya katılım: ordu renginde iki halka + bayrak yazısı
            const col = f.mode === 'attack' ? [163, 39, 28] : [44, 90, 140];
            this.fxRing(ctx, sx, sy, t, col, 12 * s, 54 * s);
            this.fxRing(ctx, sx, sy, Math.max(0, t - 0.18) / 0.82, col, 12 * s, 38 * s);
            if (mine) this.floatText(ctx, sx, sy - 34 * s, f.text, t, `rgb(${col.join(',')})`);
            break;
          }
          case 'arrive':
            if (!mine) break;
            this.fxRing(ctx, sx, sy, t, [46, 112, 52], 10 * s, 34 * s);
            this.floatText(ctx, sx, sy - 30 * s, f.text, t, '#2e7034');
            break;
          case 'spawn':
            if (!mine) break;
            this.sparkle(ctx, sx, sy, t, s);
            this.floatText(ctx, sx, sy - 30 * s, f.text, t, '#2e7034');
            break;
          case 'capture':
            this.fxRing(ctx, sx, sy, t, [226, 178, 56], 10 * s, 54 * s);
            this.fxRing(ctx, sx, sy, Math.max(0, t - 0.16) / 0.84, [241, 201, 79], 8 * s, 38 * s);
            if (mine) this.sparkle(ctx, sx, sy, t, s);
            break;
          case 'depart':
            if (!mine) break;
            this.floatText(ctx, sx, sy - 30 * s, f.text, t, '#2e7034', 0.8);
            break;
          default:
            ctx.beginPath(); ctx.arc(sx, sy, 10 + t * 50, 0, Math.PI * 2);
            ctx.strokeStyle = f.kind === 'intercept' ? `rgba(40,110,160,${1 - t})` : `rgba(240,200,80,${1 - t})`;
            ctx.lineWidth = 4; ctx.stroke();
        }
      }
    }
    // genişleyip sönen halka
    fxRing(ctx, x, y, t, rgb, r0, r1) {
      if (t <= 0 || t >= 1) return;
      const e = easeOut(t);
      ctx.beginPath(); ctx.arc(x, y, r0 + (r1 - r0) * e, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(1 - t) * 0.9})`; ctx.lineWidth = 2 + 3 * (1 - t); ctx.stroke();
    }
    // yükselip sönen yazı (önce büyüyerek belirir)
    floatText(ctx, x, y, text, t, color, size) {
      if (!text) return;
      const s = this.ui.scale;
      const rise = easeOut(Math.min(1, t)) * 26 * s;
      const al = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.62) / 0.38);
      const sc = easeBack(Math.min(1, t / 0.25));
      ctx.save();
      ctx.globalAlpha = Math.max(0, al);
      ctx.translate(x, y - rise); ctx.scale(sc, sc);
      ctx.font = `bold ${15 * (size || 1) * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 4.5 * s; ctx.strokeStyle = 'rgba(250,242,220,0.96)'; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color; ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    // asker doğunca başkentte parlayan küçük kıvılcımlar
    sparkle(ctx, x, y, t, s) {
      const al = 1 - t;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 1.5, r = (8 + easeOut(t) * 22) * s;
        ctx.fillStyle = `rgba(226,184,74,${al})`;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.2 * s * (1 - t * 0.6), 0, Math.PI * 2); ctx.fill();
      }
    }

    drawCommandHint(ctx) {
      const g = this.game, ui = this.ui;
      const sel = ui.selectedUnit();
      if (!sel || ui.hoverCity === null || ui.hoverCity === sel.city) return;
      const a = g.cities[sel.city], b = g.cities[ui.hoverCity];
      const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(b.x, b.y);
      const friendly = g.friendly(sel.owner, b.owner);
      const attack = !friendly && g.hostile(sel.owner, b.owner) && a.neighbors.includes(b.id);
      const col = friendly ? 'rgba(40,120,50,0.9)' : attack ? 'rgba(180,25,15,0.95)' : 'rgba(60,60,60,0.6)';
      ctx.setLineDash([10, 6]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      if (friendly || attack) {
        const ang = Math.atan2(by - ay, bx - ax), s = ui.scale, hs = 9 * s;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - Math.cos(ang - 0.45) * hs, by - Math.sin(ang - 0.45) * hs);
        ctx.lineTo(bx - Math.cos(ang + 0.45) * hs, by - Math.sin(ang + 0.45) * hs);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(bx, by, 14 * s, 0, Math.PI * 2);
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      }
      if (attack) this.swords(ctx, bx, by - 30, ui.scale);
    }

    drawMinimap() {
      const g = this.game, ctx = this.mctx, m = g.map;
      const W = this.mini.width, H = this.mini.height;
      const sc = Math.min(W / m.W, H / m.H);
      const ox = (W - m.W * sc) / 2, oy = (H - m.H * sc) / 2;
      if (!this.miniLayer || this._miniVer !== this.version || this._miniW !== W || this._miniH !== H) {
        const mc = this.miniLayer || (this.miniLayer = document.createElement('canvas'));
        mc.width = W; mc.height = H;
        const mctx = mc.getContext('2d');
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.fillStyle = this.isTerrain() ? '#16395f' : '#aebdaf'; mctx.fillRect(0, 0, W, H);
        mctx.drawImage(this.mapLayer, ox, oy, m.W * sc, m.H * sc);
        if (this.isTerrain() && this.tintLayer) { mctx.globalAlpha = 0.6; mctx.drawImage(this.tintLayer, ox, oy, m.W * sc, m.H * sc); mctx.globalAlpha = 1; }
        mctx.setTransform(sc, 0, 0, sc, ox, oy);
        mctx.lineJoin = 'round';
        mctx.strokeStyle = 'rgba(40,24,10,0.9)'; mctx.lineWidth = 2.2 / sc * (W / 460); mctx.stroke(this.border);
        mctx.strokeStyle = INK; mctx.lineWidth = 2 / sc * (W / 460); mctx.stroke(this.coast);
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const c of g.countries) {
          if (!c.alive || c.capital < 0) continue;
          const cc = g.cities[c.capital];
          this.miniStar(mctx, ox + cc.x * sc, oy + cc.y * sc, c.isPlayer ? 6 * this.dpr : 4 * this.dpr, c.isPlayer ? '#ffd75e' : '#f1e2b8');
        }
        this._miniVer = this.version; this._miniW = W; this._miniH = H;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.miniLayer, 0, 0);
      // muharebeler
      for (const u of g.units) {
        if (u.dead || !u.move || (u.move.kind !== 'battle' && u.move.kind !== 'attack')) continue;
        const t = g.cities[u.move.to];
        ctx.fillStyle = 'rgba(200,20,10,0.9)';
        ctx.beginPath(); ctx.arc(ox + t.x * sc, oy + t.y * sc, 2.5 * this.dpr, 0, Math.PI * 2); ctx.fill();
      }
      const sel = this.ui && this.ui.selectedUnit && this.ui.selectedUnit();
      if (sel) {
        const scCity = g.cities[sel.city];
        if (scCity) {
          ctx.strokeStyle = '#ffd95e'; ctx.lineWidth = 1.6 * this.dpr;
          ctx.beginPath(); ctx.arc(ox + scCity.x * sc, oy + scCity.y * sc, 4.5 * this.dpr, 0, Math.PI * 2); ctx.stroke();
        }
      }
      const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.vw, this.vh);
      ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeRect(ox + x0 * sc, oy + y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc);
      ctx.strokeStyle = 'rgba(30,20,10,0.6)'; ctx.lineWidth = 0.8 * this.dpr;
      ctx.strokeRect(ox + x0 * sc - 1.2, oy + y0 * sc - 1.2, (x1 - x0) * sc + 2.4, (y1 - y0) * sc + 2.4);
      this.miniMeta = { sc, ox, oy };
    }
    miniStar(ctx, x, y, r, fill) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
    }
    miniToWorld(mx, my) {
      const mm = this.miniMeta; if (!mm) return null;
      const px = mx * this.dpr, py = my * this.dpr;
      return [(px - mm.ox) / mm.sc, (py - mm.oy) / mm.sc];
    }
  }

  G.Renderer = Renderer;
})();
