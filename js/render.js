// Çizim: eski harita teması (parşömen, mürekkep sınırlar), birlikler, efektler ve minimap
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const INK = '#3a2814';
  const FONT = "'IM Fell English', 'Palatino Linotype', Georgia, serif";
  const FONT_SC = "'IM Fell English SC', 'Palatino Linotype', Georgia, serif";

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
      this.buildStatic();
      this.resize();
      const cap = game.cities[game.player.capital];
      this.cam.x = cap.x; this.cam.y = cap.y; this.cam.zoom = 0.62;
      this.clampCam();
      game.on((ev) => {
        if (ev.type === 'fx') {
          const c = game.cities[ev.city];
          this.fx.push({ kind: ev.kind, x: c.x, y: c.y, t0: performance.now() });
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
      const b = this.baseLayer.getContext('2d');
      b.scale(S, S);
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
      c.globalCompositeOperation = 'source-over';
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
    makeHatchTile() {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const x = c.getContext('2d');
      x.strokeStyle = 'rgba(30,20,10,0.45)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, 16); x.lineTo(16, 0); x.moveTo(-4, 4); x.lineTo(4, -4); x.moveTo(12, 20); x.lineTo(20, 12); x.stroke();
      return c;
    }

    rebuildDynamic() {
      const g = this.game;
      this.version = g.version;
      this.renderLandLayer();
      this.border = new Path2D();
      this.warBorder = new Path2D(); // savaşan ülkelerin ortak sınırı kırmızı çizilir
      this.atkCache = new Map();
      for (const e of g.map.edges) {
        if (e.b < 0) continue;
        const oa = g.cities[e.a].owner, ob = g.cities[e.b].owner;
        if (oa === ob) continue;
        const war = !g.isRebel(oa) && !g.isRebel(ob) && g.atWar(oa, ob);
        const target = war ? this.warBorder : this.border;
        e.pts.forEach((pt, i) => (i ? target.lineTo(pt[0], pt[1]) : target.moveTo(pt[0], pt[1])));
      }
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
      const [wx, wy] = this.toWorld(sx, sy);
      this.cam.zoom = U.clamp(this.cam.zoom * factor, this.minZoom(), 2.4);
      this.cam.x = wx - (sx - this.vw / 2) / this.cam.zoom;
      this.cam.y = wy - (sy - this.vh / 2) / this.cam.zoom;
      this.clampCam();
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
      const ox = this.vw / 2 - cam.x * z, oy = this.vh / 2 - cam.y * z;
      const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(this.vw, this.vh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#a9b8aa'; ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
      ctx.imageSmoothingEnabled = true;
      // görünen bölgeyi önbellek katmanlarından kopyala
      const m = g.map, S = this.layerScale;
      const sx0 = U.clamp(vx0 - 4, 0, m.W), sy0 = U.clamp(vy0 - 4, 0, m.H), sx1 = U.clamp(vx1 + 4, 0, m.W), sy1 = U.clamp(vy1 + 4, 0, m.H);
      if (sx1 > sx0 && sy1 > sy0) {
        for (const layer of [this.baseLayer, this.landLayer]) {
          ctx.drawImage(layer, sx0 * S, sy0 * S, (sx1 - sx0) * S, (sy1 - sy0) * S, sx0, sy0, sx1 - sx0, sy1 - sy0);
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

      ctx.strokeStyle = 'rgba(58,40,20,0.42)'; ctx.lineWidth = 1.2 / z; ctx.stroke(this.inner);
      ctx.strokeStyle = 'rgba(40,24,10,0.92)'; ctx.lineWidth = (2.2 + 1.6 * z) / z; ctx.stroke(this.border);
      // savaşan ülkelerin sınırı: koyu zemin üstünde kırmızı
      ctx.strokeStyle = 'rgba(40,12,8,0.9)'; ctx.lineWidth = (4.4 + 1.6 * z) / z; ctx.stroke(this.warBorder);
      ctx.strokeStyle = 'rgba(206,34,22,0.95)'; ctx.lineWidth = (2.6 + 1.2 * z) / z; ctx.stroke(this.warBorder);
      this.drawAttackEdges(ctx, z, now, atk);
      ctx.strokeStyle = INK; ctx.lineWidth = (2 + 1.2 * z) / z; ctx.stroke(this.coast);

      // ekran koordinatları
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawLabels(ctx, z);
      this.drawCityIcons(ctx, visible, z);
      this.drawMoving(ctx, now);
      this.drawTokens(ctx, visible, now);
      this.drawProjectiles(ctx);
      this.drawFx(ctx, now);
      this.drawCommandHint(ctx);

      const vg = ctx.createRadialGradient(this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.45, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.75);
      vg.addColorStop(0, 'rgba(70,45,15,0)'); vg.addColorStop(1, 'rgba(70,45,15,0.32)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, this.vw, this.vh);

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
      const pts = [], path = new Path2D();
      for (const e of edges) {
        e.pts.forEach((pt, i) => (i ? path.lineTo(pt[0], pt[1]) : path.moveTo(pt[0], pt[1])));
        for (let i = 0; i < e.pts.length; i += 2) pts.push(e.pts[i]);
      }
      const city = g.cities[to];
      let maxR = 0;
      for (const v of g.map.cities[to].outline) {
        let md = Infinity;
        if (pts.length) { for (const p of pts) { const d = Math.hypot(v[0] - p[0], v[1] - p[1]); if (d < md) md = d; } } else md = Math.hypot(v[0] - city.x, v[1] - city.y);
        if (md > maxR) maxR = md;
      }
      c = { edges, path, maxR: maxR + 8 };
      this.atkCache.set(key, c);
      return c;
    }

    activeAttacks(vx0, vy0, vx1, vy1) {
      const g = this.game, list = [], seen = new Set();
      for (const u of g.units) {
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
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const a of list) {
        const { u, m, geo } = a;
        ctx.save();
        ctx.clip(this.cityPaths[m.to]);
        if (!a.battle) {
          // yürüyüş: sınır boyunca hafif kırmızı gölge
          const pulse = 0.5 + 0.5 * Math.sin(now / 240);
          if (geo.edges.length) { ctx.strokeStyle = `rgba(214,40,26,${0.08 + 0.1 * pulse})`; ctx.lineWidth = (36 + 12 * pulse) / z; ctx.stroke(geo.path); }
          ctx.restore();
          continue;
        }
        const R = a.vis * geo.maxR;
        const p = G.PALETTE[g.cityColorIdx({ owner: u.owner })];
        const fill = `hsla(${p.h},${p.s}%,${p.l}%,0.94)`;
        if (geo.edges.length) {
          ctx.strokeStyle = 'rgba(190,28,18,0.95)'; ctx.lineWidth = 2 * R + 7 / z; ctx.stroke(geo.path);
          ctx.strokeStyle = fill; ctx.lineWidth = 2 * R; ctx.stroke(geo.path);
        } else {
          const c = g.cities[m.to];
          ctx.fillStyle = 'rgba(190,28,18,0.95)'; ctx.beginPath(); ctx.arc(c.x, c.y, R + 4 / z, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // saldırı yolundaki sınır: yanıp sönen kırmızı
    drawAttackEdges(ctx, z, now, list) {
      if (!list.length) return;
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const a of list) {
        if (!a.geo.edges.length) continue;
        ctx.strokeStyle = 'rgba(40,10,6,0.85)'; ctx.lineWidth = (6.4 + 1.6 * z) / z; ctx.stroke(a.geo.path);
        ctx.strokeStyle = `rgba(${Math.round(210 + 40 * pulse)},${Math.round(30 + 40 * pulse)},20,1)`; ctx.lineWidth = (4 + 1.4 * z + 2 * pulse) / z; ctx.stroke(a.geo.path);
      }
      ctx.restore();
    }

    drawDecor(ctx) {
      const m = this.game.map;
      // pusula gülü
      const cx = 250, cy = m.H - 250, R = 120;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(58,40,20,0.7)'; ctx.fillStyle = 'rgba(233,220,184,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 0, Math.PI * 2); ctx.stroke();
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
      ctx.fillStyle = 'rgba(58,40,20,0.9)';
      ctx.font = `bold 34px ${FONT_SC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('K', 0, -R - 22);
      ctx.restore();
      // kartuş
      ctx.save();
      ctx.translate(m.W - 420, 205);
      ctx.fillStyle = 'rgba(236,224,190,0.85)'; ctx.strokeStyle = 'rgba(58,40,20,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-230, -60); ctx.lineTo(230, -60); ctx.quadraticCurveTo(260, 0, 230, 60); ctx.lineTo(-230, 60); ctx.quadraticCurveTo(-260, 0, -230, -60); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(-215, -47, 430, 94); ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `46px ${FONT_SC}`; ctx.fillText('Kadîm Kıta', 0, -8);
      ctx.font = `italic 22px ${FONT}`; ctx.fillText('Dokuz Devletin Haritası', 0, 30);
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
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const alpha = z > 1.1 ? Math.max(0, 0.5 - (z - 1.1)) : 0.5;
      if (alpha > 0.02) {
        for (const L of this.labels) {
          const [sx, sy] = this.toScreen(L.x, L.y);
          if (sx < -300 || sx > this.vw + 300 || sy < -100 || sy > this.vh + 100) continue;
          const fs = U.clamp(70 * z * Math.sqrt(Math.min(1.6, L.n / 17)), 10, 64);
          ctx.font = `${fs}px ${FONT_SC}`;
          try { ctx.letterSpacing = Math.round(fs * 0.18) + 'px'; } catch (e) { /* eski tarayıcı */ }
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(240,228,196,0.7)';
          ctx.strokeText(L.c.name.toLocaleUpperCase('tr'), sx, sy);
          ctx.fillStyle = L.c.dark; ctx.fillText(L.c.name.toLocaleUpperCase('tr'), sx, sy);
        }
      }
      ctx.globalAlpha = 1;
      try { ctx.letterSpacing = '0px'; } catch (e) { /* */ }
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
      const capitals = new Set(g.countries.filter((c) => c.alive && c.capital >= 0).map((c) => c.capital));
      for (const city of visible) {
        const [sx, sy] = this.toScreen(city.x, city.y);
        if (capitals.has(city.id)) this.star(ctx, sx, sy - 24 * s, 11 * s, '#f1c94f');
        // fabrikalar (fotoğraftaki noktalar gibi, küçük binalar)
        const icons = [];
        for (let i = 0; i < city.factories; i++) icons.push('f');
        // inşaatı süren fabrikalar: soluk, ilerleme çubuklu
        for (const t1 of city.building) icons.push('b' + U.clamp(1 - (t1 - g.time) / G.CFG.factoryBuildTime, 0, 1));
        if (city.cityDef) icons.push('d');
        if (city.airDef) icons.push('a');
        if (icons.length) {
          const w = 11 * s, x0 = sx - (icons.length * w) / 2;
          icons.forEach((k, i) => (k[0] === 'b' ? this.buildIcon(ctx, x0 + i * w + w / 2, sy + 24 * s, s, +k.slice(1)) : this.icon(ctx, k, x0 + i * w + w / 2, sy + 24 * s, s)));
        }
        const mk = this.ui.targeting && this.ui.targeting.mark ? this.ui.targeting.mark(city.id) : null;
        if (mk) {
          const txt = mk === 'give' ? 'Ver' : 'Al';
          ctx.font = `bold ${11 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const bw = ctx.measureText(txt).width + 12 * s, bx = sx + 22 * s, by = sy - 16 * s;
          ctx.fillStyle = mk === 'give' ? '#8a5a12' : '#2f5a1e';
          ctx.beginPath(); ctx.ellipse(bx, by, bw / 2, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillText(txt, bx, by + 0.5);
        }
        if (showNames) {
          ctx.font = `italic ${11.5 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const ny = sy - (capitals.has(city.id) ? 41 : 22) * s;
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(240,228,196,0.85)'; ctx.strokeText(city.name, sx, ny);
          ctx.fillStyle = INK; ctx.fillText(city.name, sx, ny);
        }
      }
    }

    // inşaattaki fabrika: yarı saydam bina + altında dolan çubuk
    buildIcon(ctx, x, y, s, p) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.globalAlpha = 0.45 + 0.4 * p;
      ctx.fillStyle = '#4a3420';
      ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(-5, -1); ctx.lineTo(-2, -3); ctx.lineTo(-2, -1); ctx.lineTo(1, -3); ctx.lineTo(1, -1);
      ctx.lineTo(3, -1); ctx.lineTo(3, -6); ctx.lineTo(5, -6); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(40,24,10,0.5)'; ctx.fillRect(-5, 6, 10, 2.2);
      ctx.fillStyle = '#e2b84a'; ctx.fillRect(-5, 6, 10 * p, 2.2);
      ctx.restore();
    }

    icon(ctx, kind, x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.lineWidth = 1; ctx.strokeStyle = INK;
      if (kind === 'f') {
        ctx.fillStyle = '#4a3420';
        ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(-5, -1); ctx.lineTo(-2, -3); ctx.lineTo(-2, -1); ctx.lineTo(1, -3); ctx.lineTo(1, -1);
        ctx.lineTo(3, -1); ctx.lineTo(3, -6); ctx.lineTo(5, -6); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
      } else if (kind === 'd') {
        ctx.fillStyle = '#6d7f96';
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, -4); ctx.lineTo(4, 2); ctx.lineTo(0, 5); ctx.lineTo(-4, 2); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (kind === 'a') {
        ctx.fillStyle = '#2f6d6a';
        ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(0, -1); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#2f6d6a'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, -1, 4, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -1, 7, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
      }
      ctx.restore();
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

    token(ctx, x, y, u, opts) {
      const g = this.game, s = this.ui.scale;
      const c = g.countries[u.owner];
      const txt = U.fmtK(u.troops);
      ctx.font = `bold ${12 * s}px ${FONT}`;
      const w = ctx.measureText(txt).width + 14 * s, h = 18 * s;
      const x0 = x - w / 2, y0 = y - h / 2;
      if (opts && opts.selected) { ctx.shadowColor = '#ffd75e'; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.moveTo(x0 + 3, y0); ctx.lineTo(x0 + w - 3, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + 3);
      ctx.lineTo(x0 + w, y0 + h - 3); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - 3, y0 + h);
      ctx.lineTo(x + 4 * s, y0 + h); ctx.lineTo(x, y0 + h + 4 * s); ctx.lineTo(x - 4 * s, y0 + h);
      ctx.lineTo(x0 + 3, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - 3);
      ctx.lineTo(x0, y0 + 3); ctx.quadraticCurveTo(x0, y0, x0 + 3, y0); ctx.closePath();
      ctx.fillStyle = c.isRebel ? '#2a2a2a' : c.dark; ctx.fill();
      ctx.shadowBlur = 0;
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
        const army = g.armies.find((a) => a.id === u.army);
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
      this.tokenHits = [];
      const byCity = new Map();
      for (const u of g.units) {
        if (u.dead || u.move || u.city === null) continue;
        if (!byCity.has(u.city)) byCity.set(u.city, []);
        byCity.get(u.city).push(u);
      }
      const visSet = new Set(visible.map((c) => c.id));
      for (const [cityId, list] of byCity) {
        if (!visSet.has(cityId)) continue;
        const city = g.cities[cityId];
        const [sx, sy] = this.toScreen(city.x, city.y);
        list.sort((a, b) => (a.owner === g.playerId) - (b.owner === g.playerId) || a.id - b.id);
        // asker sayıları doğrudan toprağın üzerine yazılır; birden çok birlik varsa alt alta dizilir
        const rowH = this.landFont() * 1.3;
        const top = sy - 2 * s - ((list.length - 1) * rowH) / 2;
        list.forEach((u, i) => {
          const r = this.landToken(ctx, sx, top + i * rowH, u, { selected: ui.selUnit === u.id, marked: ui.marked.has(u.id) });
          this.tokenHits.push({ unit: u, ...r });
        });
      }
    }

    landFont() { return U.clamp(15 * this.ui.scale * (0.72 + 0.5 * Math.min(this.cam.zoom, 1.6)), 11 * this.ui.scale, 25 * this.ui.scale); }

    // Kara üzerine yazılmış asker sayısı: parşömen renkli halka + ülkenin koyu rengi
    landToken(ctx, x, y, u, opts) {
      const g = this.game, s = this.ui.scale;
      const c = g.countries[u.owner];
      const txt = U.fmtK(u.troops);
      const fs = this.landFont();
      ctx.font = `bold ${fs}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const tw = ctx.measureText(txt).width, w = tw + 12 * s, h = fs * 1.25;
      const x0 = x - w / 2, y0 = y - h / 2;
      ctx.lineWidth = fs * 0.4; ctx.strokeStyle = 'rgba(248,240,216,0.93)';
      if (opts && opts.selected) { ctx.shadowColor = '#ffcf4a'; ctx.shadowBlur = 16; ctx.strokeStyle = 'rgba(255,236,160,1)'; }
      ctx.strokeText(txt, x, y);
      ctx.shadowBlur = 0;
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
        const army = g.armies.find((a) => a.id === u.army);
        if (army) {
          ctx.beginPath(); ctx.arc(x0 + w, y0 + 1, 6.5 * s, 0, Math.PI * 2);
          ctx.fillStyle = army.mode === 'attack' ? '#a3271c' : '#2c5a8c'; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = '#fbf1d6'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = `bold ${8.5 * s}px ${FONT}`;
          ctx.fillText(army.mode === 'attack' ? 'T' : 'S', x0 + w, y0 + 1.5);
        }
      }
      return { x: x0, y: y0, w, h };
    }

    drawMoving(ctx, now) {
      const g = this.game, s = this.ui.scale;
      for (const u of g.units) {
        if (u.dead || !u.move) continue;
        const m = u.move;
        const [wx, wy] = g.unitPos(u);
        const [sx, sy] = this.toScreen(wx, wy);
        if (sx < -80 || sx > this.vw + 80 || sy < -80 || sy > this.vh + 80) {
          if (m.kind !== 'battle') continue;
        }
        const dest = g.cities[m.to];
        const [dx, dy] = this.toScreen(dest.x, dest.y);
        const hostile = m.kind === 'attack' || m.kind === 'battle' || (m.kind === 'para' && !g.friendly(u.owner, dest.owner));
        if (m.kind !== 'battle') {
          ctx.setLineDash([6, 6]); ctx.lineDashOffset = -now / 60;
          ctx.strokeStyle = hostile ? 'rgba(170,25,15,0.85)' : 'rgba(40,28,14,0.7)'; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(dx, dy); ctx.stroke(); ctx.setLineDash([]);
          // ok ucu
          const a = Math.atan2(dy - sy, dx - sx);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - Math.cos(a - 0.4) * 11, dy - Math.sin(a - 0.4) * 11); ctx.lineTo(dx - Math.cos(a + 0.4) * 11, dy - Math.sin(a + 0.4) * 11); ctx.fill();
        } else {
          // muharebe
          const pulse = 0.5 + 0.5 * Math.sin(now / 120);
          ctx.beginPath(); ctx.arc(dx, dy, (22 + 6 * pulse) * s, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(190,30,20,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 3; ctx.stroke();
          this.swords(ctx, (sx + dx) / 2, (sy + dy) / 2, s);
          // ele geçirme yüzdesi
          const pct = '%' + Math.round(100 * (m.prog || 0));
          ctx.font = `bold ${13 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(248,240,216,0.95)'; ctx.strokeText(pct, dx, dy + 36 * s);
          ctx.fillStyle = '#a3170d'; ctx.fillText(pct, dx, dy + 36 * s);
        }
        if (m.kind === 'para') {
          ctx.font = `${20 * s}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = INK; ctx.save(); ctx.translate(sx, sy - 18 * s); ctx.rotate(Math.atan2(dy - sy, dx - sx));
          ctx.fillText('✈︎', 0, 0); ctx.restore();
        }
        this.token(ctx, sx, sy, u, {});
      }
    }

    swords(ctx, x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const k of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-9 * k, -9); ctx.lineTo(9 * k, 9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-9 * k + 4 * k, 3 + 0); ctx.lineTo(3 * k, -4); ctx.stroke();
      }
      ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = 1.3;
      for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-9 * k, -9); ctx.lineTo(7 * k, 7); ctx.stroke(); }
      ctx.restore();
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
      this.fx = this.fx.filter((f) => now - f.t0 < 1400);
      for (const f of this.fx) {
        const t = (now - f.t0) / 1400;
        const [sx, sy] = this.toScreen(f.x, f.y);
        if (f.kind === 'explosion') {
          for (let k = 0; k < 3; k++) {
            ctx.beginPath(); ctx.arc(sx, sy, 10 + t * (60 + k * 25), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${230 - k * 30},${120 - k * 30},30,${(1 - t) * 0.35})`; ctx.fill();
          }
        } else {
          ctx.beginPath(); ctx.arc(sx, sy, 10 + t * 50, 0, Math.PI * 2);
          ctx.strokeStyle = f.kind === 'intercept' ? `rgba(40,110,160,${1 - t})` : `rgba(240,200,80,${1 - t})`;
          ctx.lineWidth = 4; ctx.stroke();
        }
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
      ctx.setLineDash([10, 6]);
      ctx.strokeStyle = friendly ? 'rgba(40,120,50,0.9)' : attack ? 'rgba(180,25,15,0.95)' : 'rgba(60,60,60,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      if (attack) this.swords(ctx, bx, by - 30, this.ui.scale);
    }

    drawMinimap() {
      const g = this.game, ctx = this.mctx, m = g.map;
      const W = this.mini.width, H = this.mini.height;
      const sc = Math.min(W / m.W, H / m.H);
      const ox = (W - m.W * sc) / 2, oy = (H - m.H * sc) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#aebdaf'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(this.baseLayer, ox, oy, m.W * sc, m.H * sc);
      ctx.drawImage(this.landLayer, ox, oy, m.W * sc, m.H * sc);
      ctx.setTransform(sc, 0, 0, sc, ox, oy);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(40,24,10,0.9)'; ctx.lineWidth = 2.2 / sc * (W / 460); ctx.stroke(this.border);
      ctx.strokeStyle = INK; ctx.lineWidth = 2 / sc * (W / 460); ctx.stroke(this.coast);
      // başkent noktası
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const c of g.countries) {
        if (!c.alive || c.capital < 0) continue;
        const cc = g.cities[c.capital];
        this.miniStar(ctx, ox + cc.x * sc, oy + cc.y * sc, c.isPlayer ? 6 * this.dpr : 4 * this.dpr, c.isPlayer ? '#ffd75e' : '#f1e2b8');
      }
      // muharebeler
      for (const u of g.units) {
        if (u.dead || !u.move || (u.move.kind !== 'battle' && u.move.kind !== 'attack')) continue;
        const t = g.cities[u.move.to];
        ctx.fillStyle = 'rgba(200,20,10,0.9)';
        ctx.beginPath(); ctx.arc(ox + t.x * sc, oy + t.y * sc, 2.5 * this.dpr, 0, Math.PI * 2); ctx.fill();
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
