// Çevrimiçi oyun: oda kodu ile, sunucusuz (WebRTC — PeerJS).
// Odayı kuran cihaz (host) oyunu çalıştırır ve tek doğru kopyayı tutar. Katılan oyuncular (client) komutlarını
// host'a gönderir; host saniyede 5 kez oyunun tüm durumunu ve o oyuncuyu ilgilendiren olayları geri yollar.
// İstemci, düğmeye bastığı anda komutu kendi kopyasında da uygular (anında tepki); gerçek sonuç host'tan gelir.
(function () {
  'use strict';
  const G = window.G;
  const BUILD = 'clgs-v22'; // host ve istemci aynı sürümü çalıştırmalı (harita aynı tohumdan aynı üretilsin)
  const PROTO = 1;
  const PREFIX = 'control-lgs-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_PLAYERS = 9;
  const SNAP_MS = 200;
  const SETUP_LIMIT_MS = 60000; // fabrika yeri seçmeyen oyuncu için başkente otomatik kurulum
  const PEER_SRC = [
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  ];

  let peerLoad = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    if (peerLoad) return peerLoad;
    peerLoad = new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= PEER_SRC.length) { peerLoad = null; reject(new Error('Bağlantı kütüphanesi yüklenemedi. İnternet bağlantını kontrol et.')); return; }
        const s = document.createElement('script');
        s.src = PEER_SRC[i++]; s.async = true; s.crossOrigin = 'anonymous';
        s.onload = () => (window.Peer ? resolve() : next());
        s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      };
      next();
    });
    return peerLoad;
  }
  const makeCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 22) || 'Hükümdar';
  const peerErrText = (e) => {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'Bu kodla açık bir oda bulunamadı. Kodu kontrol et.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Bağlantı sunucusuna ulaşılamadı. İnternet bağlantını kontrol et.';
    if (t === 'browser-incompatible') return 'Bu tarayıcı çevrimiçi oyunu desteklemiyor.';
    return 'Bağlantı hatası' + (t ? ` (${t})` : '') + '.';
  };
  // olay o oyuncuyu ilgilendiriyor mu? (her oyuncu yalnızca kendi bildirimlerini alır)
  function relevant(ev, cid) {
    switch (ev.type) {
      case 'toast': return ev.to === null || ev.to.includes(cid);
      case 'proposal': return ev.p.to === cid;
      case 'income': return ev.cid === cid;
      case 'gameover': return false; // her cihaz kendisi hesaplar
      default: return true; // ses, efekt, teklif kapandı
    }
  }

  // ======================= HOST =======================
  class Host {
    constructor(me, cb, opts) {
      this.role = 'host';
      this.cb = cb || {};
      this.mapType = (opts && opts.mapType) || 'kita'; // 'rastgele' oyun başlarken seçilir
      this.players = [{ key: 'host', name: cleanName(me.name), ideology: me.ideology, host: true, conn: null, connected: true, cid: null, queue: [] }];
      this.started = false;
      this.closed = false;
    }
    async open() {
      await loadPeer();
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeCode();
        try { await this.tryOpen(code); this.code = code; this.lobbyChanged(); return this; } catch (e) {
          if (!e || e.type !== 'unavailable-id') throw new Error(peerErrText(e));
        }
      }
      throw new Error('Oda kodu alınamadı, tekrar dene.');
    }
    tryOpen(code) {
      return new Promise((resolve, reject) => {
        const peer = new window.Peer(PREFIX + code, { debug: 0 });
        const fail = (e) => { try { peer.destroy(); } catch (x) { /* yok */ } reject(e); };
        peer.once('error', fail);
        peer.once('open', () => {
          peer.off('error', fail);
          this.peer = peer;
          peer.on('connection', (conn) => this.onConn(conn));
          peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { if (!this.closed && peer.disconnected) peer.reconnect(); } catch (x) { /* yok */ } }, 1500); });
          peer.on('error', (e) => console.warn('peer', e && e.type));
          resolve();
        });
      });
    }
    onConn(conn) {
      conn.on('data', (msg) => { try { this.onData(conn, msg); } catch (e) { console.warn(e); } });
      conn.on('close', () => this.onClose(conn));
      conn.on('error', () => this.onClose(conn));
    }
    send(p, msg) { if (p.conn && p.connected) { try { p.conn.send(msg); } catch (e) { /* bağlantı kapanıyor */ } } }
    playerOf(conn) { return this.players.find((p) => p.conn === conn); }
    onData(conn, msg) {
      if (!msg || typeof msg !== 'object') return;
      let p = this.playerOf(conn);
      if (msg.t === 'hello') {
        if (msg.build !== BUILD || msg.proto !== PROTO) {
          conn.send({ t: 'reject', msg: `Oyun sürümleri farklı (oda: ${BUILD}, sen: ${msg.build || '?'}). İkiniz de sayfayı yenileyip tekrar deneyin.` });
          return;
        }
        const name = cleanName(msg.name);
        if (this.started) {
          // oyun sürerken: bağlantısı kopmuş bir oyuncu (lobide aldığı anahtarla) geri dönebilir
          // yeniden bağlanma lobide verilen gizli anahtarla olur (aynı adı yazan başkası ülkeyi devralamaz)
          const back = msg.token ? this.players.find((x) => !x.host && !x.connected && x.token === msg.token) : null;
          if (!back) { conn.send({ t: 'reject', msg: 'Bu odada oyun başladı. Yeni oyuncu katılamaz.' }); return; }
          back.conn = conn; back.connected = true; back.lastSeen = performance.now(); back.queue = [];
          const c = this.game.countries[back.cid];
          if (c.alive) { c.isBot = false; this.game.say(null, `🔌 ${c.name} oyuna geri döndü.`, 'info'); }
          conn.send(this.startMsg(back));
          return;
        }
        if (p) return;
        if (this.players.length >= MAX_PLAYERS) { conn.send({ t: 'reject', msg: `Oda dolu (en fazla ${MAX_PLAYERS} oyuncu).` }); return; }
        let nm = name, k = 2;
        while (this.players.some((x) => x.name === nm)) nm = `${name.slice(0, 19)} ${k++}`;
        p = { key: conn.peer, name: nm, ideology: G.IDEO[msg.ideology] ? msg.ideology : 'demokrasi', host: false, conn, connected: true, cid: null, queue: [], lastSeen: performance.now(),
          token: Array.from({ length: 16 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('') };
        this.players.push(p);
        this.lobbyChanged();
        return;
      }
      if (!p) return;
      p.lastSeen = performance.now();
      if (msg.t === 'cmd' && this.started) this.dispatch(p, msg);
      else if (msg.t === 'bye') { try { conn.close(); } catch (e) { /* yok */ } this.onClose(conn); }
    }
    onClose(conn) {
      const p = this.playerOf(conn);
      if (!p || !p.connected) return;
      p.connected = false;
      if (!this.started) {
        this.players = this.players.filter((x) => x !== p);
        this.lobbyChanged();
        return;
      }
      // oyun sürüyorsa ülkesi bota geçer; aynı cihazdan geri dönerse kaldığı yerden devam eder
      const c = this.game.countries[p.cid];
      if (c && c.alive) {
        c.isBot = true;
        this.game.say(null, `🔌 ${c.name} bağlantısını kaybetti; dönene kadar ülkesini bot yönetiyor.`, 'bad');
      }
    }
    lobbyState() {
      return { code: this.code, mapType: this.mapType, players: this.players.map((x) => ({ name: x.name, ideology: x.ideology, host: x.host })) };
    }
    // oda sahibi lobide harita tipini değiştirebilir
    setMap(t) { if (this.started) return; this.mapType = t; this.lobbyChanged(); }
    lobbyChanged() {
      const st = this.lobbyState();
      for (const p of this.players) if (!p.host) this.send(p, { t: 'lobby', ...st, you: p.name, token: p.token });
      if (this.cb.onLobby) this.cb.onLobby(st, this);
    }
    // Oyunu başlat: harita oyuncu sayısı kadar ülkeyle üretilir, ülkeler rastgele dağıtılır
    start() {
      if (this.started) return null;
      const n = this.players.length;
      if (n < 2) throw new Error('En az 2 oyuncu gerekli.');
      const ids = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      this.players.forEach((p, i) => { p.cid = ids[i]; });
      this.seed = Math.floor(Math.random() * 1e9);
      this.humans = this.players.map((p) => ({ name: p.name, ideology: p.ideology }));
      this.humanIds = ids;
      const keys = G.MapGen.TYPES.map((t) => t.key);
      if (!keys.includes(this.mapType)) this.mapType = keys[Math.floor(Math.random() * keys.length)]; // rastgele
      const game = new G.Game({ seed: this.seed, nCountries: n, humans: this.humans, humanIds: ids, localIndex: 0, mp: 'host', mapType: this.mapType });
      this.game = game;
      this.started = true;
      this.startedAt = performance.now();
      game.on((ev) => this.queueEvent(ev));
      for (const p of this.players) if (!p.host) { p.lastSeen = performance.now(); this.send(p, this.startMsg(p)); }
      this.timer = setInterval(() => this.tick(), SNAP_MS);
      return game;
    }
    startMsg(p) {
      return { t: 'start', seed: this.seed, n: this.humans.length, humans: this.humans, humanIds: this.humanIds, mapType: this.game.mapType,
        index: this.players.indexOf(p), code: this.code, snap: this.game.snapshot() };
    }
    queueEvent(ev) {
      for (const p of this.players) {
        if (p.host || !p.connected || p.cid === null || !relevant(ev, p.cid)) continue;
        p.queue.push(ev);
        if (p.queue.length > 150) p.queue.splice(0, p.queue.length - 150);
      }
    }
    // Ağdan gelen komut: sadece cmd* komutları, ilk argüman (ülke) her zaman gönderen oyuncunun ülkesi
    dispatch(p, msg) {
      const name = String(msg.name || '');
      if (!/^cmd[A-Z]\w*$/.test(name) || typeof this.game[name] !== 'function') return;
      const args = Array.isArray(msg.args) ? msg.args.slice(0, 5) : [];
      args[0] = p.cid;
      let r;
      try { r = this.game[name](...args); } catch (e) { console.warn('komut', name, e); r = { err: 'Komut işlenemedi' }; }
      if (r && r.err) this.send(p, { t: 'err', msg: r.err });
    }
    tick() {
      if (this.closed || !this.game) return;
      const g = this.game, now = performance.now();
      // fabrika yerini seçmeyenler: süre dolunca başkente kurulur
      if (g.phase === 'setup' && now - this.startedAt > SETUP_LIMIT_MS) {
        for (const c of g.countries) if (c.alive && !c.isRebel && !c.setupDone) g.cmdStartFactories(c.id, c.capital);
      }
      const d = g.snapshot();
      for (const p of this.players) {
        if (p.host || !p.connected) continue;
        if (now - (p.lastSeen || now) > 15000) { try { p.conn.close(); } catch (e) { /* yok */ } this.onClose(p.conn); continue; }
        const ev = p.queue; p.queue = [];
        this.send(p, { t: 'snap', d, ev });
      }
    }
    status() {
      const on = this.players.filter((p) => p.connected).length;
      return { text: `🌐 ${this.code} · ${on}/${this.players.length}`, bad: false };
    }
    close() {
      this.closed = true;
      clearInterval(this.timer);
      for (const p of this.players) if (!p.host) this.send(p, { t: 'end', msg: 'Oda sahibi odayı kapattı.' });
      setTimeout(() => { try { this.peer && this.peer.destroy(); } catch (e) { /* yok */ } }, 300);
    }
  }

  // ======================= İSTEMCİ =======================
  class Client {
    constructor(me, cb) {
      this.role = 'client';
      this.me = { name: cleanName(me.name), ideology: me.ideology };
      this.cb = cb || {};
      this.closed = false;
      this.started = false;
      this.snapTime = 0;
      this.lastMsg = performance.now();
    }
    async join(code) {
      code = cleanCode(code);
      if (code.length !== 5) throw new Error('Oda kodu 5 karakter olmalı.');
      this.code = code;
      await loadPeer();
      await new Promise((resolve, reject) => {
        const peer = new window.Peer({ debug: 0 });
        this.peer = peer;
        let done = false;
        const fail = (msg) => { if (done) return; done = true; clearTimeout(to); try { peer.destroy(); } catch (e) { /* yok */ } reject(new Error(msg)); };
        const to = setTimeout(() => fail('Odaya bağlanılamadı (zaman aşımı). Kodu ve internet bağlantını kontrol et.'), 15000);
        peer.on('error', (e) => { if (!done) fail(peerErrText(e)); else console.warn('peer', e && e.type); });
        peer.once('open', () => {
          const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
          this.conn = conn;
          conn.on('open', () => {
            let token = null;
            try { token = localStorage.getItem('clgs_tok_' + code); } catch (e) { /* yok */ }
            conn.send({ t: 'hello', name: this.me.name, ideology: this.me.ideology, build: BUILD, proto: PROTO, token });
          });
          conn.on('data', (msg) => {
            if (!done && msg && (msg.t === 'lobby' || msg.t === 'start')) { done = true; clearTimeout(to); resolve(); }
            if (!done && msg && msg.t === 'reject') { fail(msg.msg); return; }
            try { this.onData(msg); } catch (e) { console.warn(e); }
          });
          conn.on('close', () => { if (!done) fail('Oda bağlantıyı kapattı.'); else this.lost('Oda sahibiyle bağlantı koptu.'); });
          conn.on('error', () => { if (!done) fail('Odaya bağlanılamadı.'); });
        });
      });
      this.ping = setInterval(() => {
        this.send({ t: 'ping' });
        if (this.started && performance.now() - this.lastMsg > 12000) this.lost('Oda sahibinden 12 saniyedir haber yok; bağlantı koptu.');
      }, 2000);
      return this;
    }
    send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) { /* yok */ } } }
    onData(msg) {
      if (!msg || typeof msg !== 'object') return;
      this.lastMsg = performance.now();
      switch (msg.t) {
        case 'lobby':
          if (msg.token) { try { localStorage.setItem('clgs_tok_' + this.code, msg.token); } catch (e) { /* yok */ } }
          if (this.cb.onLobby) this.cb.onLobby(msg, this);
          break;
        case 'reject': this.lost(msg.msg); break;
        case 'start': this.onStart(msg); break;
        case 'snap':
          if (!this.game) return;
          this.game.applySnapshot(msg.d);
          this.snapTime = msg.d.time;
          for (const ev of msg.ev || []) this.game.emit(ev);
          if (this.cb.onSnap) this.cb.onSnap();
          break;
        case 'err': if (this.cb.onCmdError) this.cb.onCmdError(msg.msg); break;
        case 'end': this.lost(msg.msg || 'Oyun sona erdi.'); break;
        default: break;
      }
    }
    onStart(msg) {
      if (this.game) { // yeniden bağlanma: aynı oyuna devam
        this.game.applySnapshot(msg.snap); this.snapTime = msg.snap.time; return;
      }
      const game = new G.Game({ seed: msg.seed, nCountries: msg.n, humans: msg.humans, humanIds: msg.humanIds, localIndex: msg.index, mp: 'client', mapType: msg.mapType });
      if (game.cities.length !== msg.snap.nCities) { this.lost('Harita bu cihazda farklı oluştu (sürüm uyuşmazlığı). Sayfayı yenileyip tekrar katıl.'); return; }
      this.game = game;
      game.applySnapshot(msg.snap);
      this.snapTime = msg.snap.time;
      this.installProxy(game);
      this.started = true;
      if (this.cb.onStart) this.cb.onStart(game, this);
    }
    // cmd* çağrıları: yerelde hemen uygulanır (olaylar susturulur), sonra host'a gönderilir
    installProxy(game) {
      let depth = 0;
      for (const k of Object.getOwnPropertyNames(G.Game.prototype)) {
        if (!/^cmd[A-Z]/.test(k)) continue;
        const local = G.Game.prototype[k];
        game[k] = (...args) => {
          if (depth > 0) return local.apply(game, args); // iç içe çağrı (ör. teklif → katılma başvurusu): tek komut gider
          depth++; game.muted = true;
          let r;
          try { r = local.apply(game, args); } catch (e) { r = { ok: true }; } finally { depth--; game.muted = false; }
          if (!(r && r.err)) this.send({ t: 'cmd', name: k, args: JSON.parse(JSON.stringify(args)) });
          return r;
        };
      }
    }
    // istemcide oyun ilerletilmez; sadece akıcı görüntü için zaman bir sonraki duruma kadar yürür
    advance(dt) {
      const g = this.game;
      if (!g || g.phase !== 'play' || g.over) return;
      g.time = Math.min(g.time + dt, this.snapTime + 0.4);
      g.supplyWarn(dt);
    }
    lost(msg) {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.ping);
      try { this.peer && this.peer.destroy(); } catch (e) { /* yok */ }
      if (this.cb.onLost) this.cb.onLost(msg);
    }
    status() {
      const late = performance.now() - this.lastMsg > 2500;
      return { text: this.closed ? '🔌 Bağlantı yok' : late ? '⚠ Bağlantı yavaş' : `🌐 ${this.code}`, bad: this.closed || late };
    }
    close() { this.send({ t: 'bye' }); this.closed = true; clearInterval(this.ping); setTimeout(() => { try { this.peer && this.peer.destroy(); } catch (e) { /* yok */ } }, 200); }
  }

  G.Net = {
    BUILD, MAX_PLAYERS, cleanCode,
    host: (me, cb, opts) => new Host(me, cb, opts).open(),
    join: (code, me, cb) => new Client(me, cb).join(code),
  };
})();
