// Başlangıç ekranı, oyun döngüsü ve girişler (PC: WASD + fare, Mobil: sürükle/kıstır + D-pad)
(function () {
  'use strict';
  const G = window.G;
  const $ = (id) => document.getElementById(id);

  // ---------- uygulama (PWA) ----------
  const SAVE_KEY = 'hc_save_v1';
  const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isStandalone()) document.body.classList.add('app');

  function initApp() {
    // çevrimdışı çalışma (yalnızca güvenli bağlamda: https veya localhost)
    if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* yok say */ });
    }
    // "Uygulamayı Yükle" (Android/Chrome/Edge)
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferred = e;
      $('installBox').classList.remove('hidden');
    });
    $('installBtn').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* yok */ }
      deferred = null;
      $('installBox').classList.add('hidden');
    });
    window.addEventListener('appinstalled', () => $('installBox').classList.add('hidden'));
    // iOS: elle ana ekrana ekleme ipucu
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()) $('iosHint').classList.remove('hidden');
  }

  function readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // eski/bozuk kayıt giriş ekranını bozmasın
      const ok = s && s.game && s.game.v === 1 && !s.game.over && s.game.phase === 'play' &&
        s.game.countries && s.game.countries[s.game.playerId] && G.IDEO[s.game.countries[s.game.playerId].ideology];
      return ok ? s : null;
    } catch (e) { return null; }
  }
  function writeSave() {
    if (!game || game.phase !== 'play' || game.mp) return; // çevrimiçi oyun kaydedilmez
    try {
      if (game.over) { localStorage.removeItem(SAVE_KEY); return; }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ mode: ui.mode, savedAt: Date.now(), game: game.serialize() }));
    } catch (e) { /* depolama dolu ya da kapalı */ }
  }

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* yok */ }
  }
  function goFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen || isStandalone()) return;
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* yok */ });
  }

  // ---------- başlangıç ekranı ----------
  const startState = { mode: isTouch ? 'mobile' : 'pc', ideology: null };
  function initStart() {
    const save = readSave();
    if (save) {
      const g = save.game, p = g.countries[g.playerId];
      const cities = g.cities.filter((c) => c[0] === g.playerId).length;
      $('resumeBox').classList.remove('hidden');
      $('resumeInfo').textContent = `${p.name} · ${G.IDEO[p.ideology].name} · ${G.U.fmtTime(g.time)} · ${cities} şehir · ${save.mode === 'mobile' ? 'Mobil' : 'Bilgisayar'}`;
      $('resumeBtn').addEventListener('click', () => start(save));
    }
    const ideoBox = $('ideoCards');
    ideoBox.innerHTML = Object.values(G.IDEO).map((d) => `
      <button class="ideo" data-k="${d.key}">
        <div class="ideo-seal">${d.name[0]}</div>
        <b>${d.name}</b>
        <ul>${d.perks.map((p) => `<li>${p}</li>`).join('')}</ul>
        ${G.IDEO_UP && G.IDEO_UP[d.key] ? `<div class="ideo-sp"><span>Özel geliştirmeler</span>${G.IDEO_UP[d.key].map((x) => `<i title="${x.desc}">${x.name}</i>`).join('')}</div>` : ''}
      </button>`).join('');
    ideoBox.addEventListener('click', (e) => {
      const b = e.target.closest('.ideo'); if (!b) return;
      startState.ideology = b.dataset.k;
      ideoBox.querySelectorAll('.ideo').forEach((x) => x.classList.toggle('on', x === b));
      validate();
    });
    const modeBox = $('modeBtns');
    const syncMode = () => modeBox.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.m === startState.mode));
    modeBox.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      startState.mode = b.dataset.m; syncMode();
    });
    syncMode();
    $('nameIn').addEventListener('input', validate);
    $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('startBtn').disabled) start(null); });
    $('startBtn').addEventListener('click', () => start(null));
    try { const n = localStorage.getItem('hc_name'); if (n) $('nameIn').value = n; } catch (e) { /* yok */ }
    // çevrimiçi
    $('hostBtn').addEventListener('click', hostRoom);
    $('joinBtn').addEventListener('click', joinRoom);
    $('codeIn').addEventListener('input', () => { const v = G.Net.cleanCode($('codeIn').value); if (v !== $('codeIn').value) $('codeIn').value = v; validate(); });
    $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('joinBtn').disabled) joinRoom(); });
    $('lobby').addEventListener('click', onLobbyClick);
    // davet bağlantısı: ?oda=KOD
    const inv = G.Net.cleanCode(new URLSearchParams(location.search).get('oda'));
    if (inv.length === 5) { $('codeIn').value = inv; $('onlineHint').textContent = `Davet: ${inv} odası. Adını yaz, ideolojini seç ve Katıl'a bas.`; }
    validate();
  }
  function validate() {
    const ok = $('nameIn').value.trim().length >= 2 && startState.ideology;
    const busy = !!session || onlineBusy;
    $('startBtn').disabled = !ok || busy;
    $('hostBtn').disabled = !ok || busy;
    $('joinBtn').disabled = !ok || busy || G.Net.cleanCode($('codeIn').value).length !== 5;
    $('startHint').textContent = !$('nameIn').value.trim() ? 'Bir ad gir' : !startState.ideology ? 'Bir ideoloji seç' : 'Hazırsın!';
  }

  // ---------- çevrimiçi lobi ----------
  let session = null, onlineBusy = false, lobbyRole = null;
  const esc = G.U.esc;
  const meInfo = () => ({ name: $('nameIn').value.trim().slice(0, 22), ideology: startState.ideology });
  const saveName = () => { try { localStorage.setItem('hc_name', meInfo().name); } catch (e) { /* yok */ } };
  function lockStart(on) {
    $('nameIn').disabled = on;
    document.querySelectorAll('#ideoCards .ideo').forEach((b) => { b.disabled = on; });
    validate();
  }
  function onlineMsg(text, bad) { const h = $('onlineHint'); h.textContent = text; h.classList.toggle('bad', !!bad); }
  function resetOnline(msg) {
    session = null; onlineBusy = false; lobbyRole = null;
    $('lobby').classList.add('hidden'); $('lobby').innerHTML = '';
    $('onlineRow').classList.remove('hidden');
    lockStart(false);
    if (msg) onlineMsg(msg, true);
  }
  async function hostRoom() {
    if (session || onlineBusy) return;
    onlineBusy = true; lobbyRole = 'host'; lockStart(true); onlineMsg('Oda kuruluyor…');
    saveName();
    try {
      session = await G.Net.host(meInfo(), { onLobby: renderLobby });
      onlineBusy = false; validate();
    } catch (e) { resetOnline(e.message); }
  }
  async function joinRoom() {
    if (session || onlineBusy) return;
    const code = G.Net.cleanCode($('codeIn').value);
    onlineBusy = true; lobbyRole = 'client'; lockStart(true); onlineMsg(`${code} odasına bağlanılıyor…`);
    saveName();
    try {
      const s = await G.Net.join(code, meInfo(), {
        onLobby: renderLobby,
        onStart: (g, sess) => { session = sess; launch(g, { mode: startState.mode, net: sess }); },
        onLost: (msg) => { if (!game) resetOnline(msg); },
      });
      session = s; onlineBusy = false; validate();
    } catch (e) { resetOnline(e.message); }
  }
  function renderLobby(st) {
    if (game) return;
    const isHost = lobbyRole === 'host';
    const n = st.players.length;
    const box = $('lobby');
    box.innerHTML = `<div class="lb-code"><span>Oda kodu</span><b>${esc(st.code)}</b>
        ${isHost ? '<button class="btn sm" data-lb="copy">🔗 Daveti Paylaş</button>' : ''}</div>
      <ul class="lb-list">${st.players.map((p) => {
        const d = G.IDEO[p.ideology] || G.IDEO.demokrasi;
        return `<li><span class="lb-seal">${esc(d.name[0])}</span><b>${esc(p.name)}</b><small>${esc(d.name)}</small>${p.host ? '<i>oda sahibi</i>' : ''}</li>`;
      }).join('')}</ul>
      <p class="lb-note">${isHost ? (n < 2 ? 'Arkadaşların bu kodla ya da davet bağlantısıyla katılabilir. En az 2 oyuncu gerekli.'
        : `${n} oyuncu hazır · harita ${n} ülkeyle oluşturulacak (en fazla ${G.Net.MAX_PLAYERS}).`) : 'Oda sahibinin oyunu başlatması bekleniyor…'}</p>
      <div class="lb-btns">${isHost ? `<button class="btn big green" data-lb="start" ${n < 2 ? 'disabled' : ''}>Oyunu Başlat</button>` : ''}
        <button class="btn" data-lb="leave">Odadan Çık</button></div>`;
    box.classList.remove('hidden');
    $('onlineRow').classList.add('hidden');
    onlineMsg(isHost ? 'Oda açık. Oyunu kuran cihaz oyunu çalıştırır; oyun boyunca bu sekmeyi kapatma.' : `${st.code} odasındasın.`);
  }
  async function onLobbyClick(e) {
    const b = e.target.closest('[data-lb]');
    if (!b || !session) return;
    if (b.dataset.lb === 'leave') { session.close(); resetOnline(); onlineMsg('Odadan çıktın.'); return; }
    if (b.dataset.lb === 'copy') {
      const url = location.origin + location.pathname + '?oda=' + session.code;
      try {
        if (navigator.share && isTouch) await navigator.share({ title: 'Hükümdarlar Çağı', text: `Hükümdarlar Çağı odama gel! Kod: ${session.code}`, url });
        else { await navigator.clipboard.writeText(url); onlineMsg('Davet bağlantısı kopyalandı: ' + url); }
      } catch (err) { onlineMsg('Kopyalanamadı; kodu elle paylaş: ' + session.code); }
      return;
    }
    if (b.dataset.lb === 'start') {
      try { const g = session.start(); if (g) launch(g, { mode: startState.mode, net: session }); } catch (err) { onlineMsg(err.message, true); }
    }
  }

  let game, ui, renderer;
  const keys = {};

  function start(save) {
    let mode = startState.mode;
    if (save) {
      try { game = G.Game.restore(save.game); mode = save.mode || mode; } catch (e) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e2) { /* yok */ }
        alert('Kayıt yüklenemedi, yeni oyun başlat.');
        location.reload();
        return;
      }
    } else {
      const name = $('nameIn').value.trim().slice(0, 22);
      try { localStorage.setItem('hc_name', name); } catch (e) { /* yok */ }
      game = new G.Game({ playerName: name, ideology: startState.ideology });
    }
    launch(game, { mode, resumed: !!save });
  }

  function launch(g, opts) {
    game = g;
    const mode = opts.mode;
    const net = opts.net || null;
    $('start').classList.add('hidden');
    if (mode === 'mobile') goFullscreen();
    keepAwake();
    // ses ve müzik (başlat düğmesine basıldığı için tarayıcı sesi açmaya izin verir)
    G.Audio.unlock();
    G.Audio.startMusic();
    game.on((ev) => G.Audio.onGameEvent(ev, game));
    const sndBtn = $('sndBtn');
    const syncSnd = () => { sndBtn.textContent = G.Audio.muted ? '🔇' : '🔊'; sndBtn.classList.toggle('off', G.Audio.muted); };
    sndBtn.addEventListener('click', () => { G.Audio.toggle(); syncSnd(); });
    syncSnd();
    ui = new G.UI(game, { mode, resumed: !!opts.resumed });
    renderer = new G.Renderer($('map'), $('mini'), game, ui);
    ui.renderer = renderer;
    if (!game.mp) {
      // otomatik kayıt: 10 sn'de bir ve uygulama arka plana geçince
      setInterval(writeSave, 10000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeSave(); else keepAwake(); });
      window.addEventListener('pagehide', writeSave);
      game.on((ev) => { if (ev.type === 'gameover') { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* yok */ } } });
    } else {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
      // odayı kuran cihaz kapanırsa oyun herkes için biter: yanlışlıkla kapatmaya karşı uyar
      if (game.mp === 'host') window.addEventListener('beforeunload', (e) => { if (!game.over) { e.preventDefault(); e.returnValue = ''; } });
      if (net && net.role === 'client') {
        net.cb.onSnap = () => ui.syncInbox();
        net.cb.onCmdError = (m) => ui.toast(m, 'bad');
        net.cb.onLost = (m) => ui.dialog('Bağlantı koptu', `<p>${esc(m)}</p><p class="note">Bağlantın koptuysa aynı adla aynı odaya yeniden katılarak ülkene kaldığın yerden devam edebilirsin (bu arada ülkeni bot yönetir). Oda sahibi oyunu kapattıysa oyun sona ermiştir.</p>`,
          [{ label: 'Ana Menü', cls: 'red', fn: () => { location.href = location.pathname + '?oda=' + net.code; } }]);
      }
      ui.toast(game.mp === 'host' ? `Oda ${net.code}: oyun başladı. Herkes fabrikalarını kurunca savaş saati işlemeye başlar.`
        : game.player.setupDone ? 'Oyuna geri döndün, ülkene kaldığın yerden devam ediyorsun.' : 'Oyuna katıldın! Fabrikalarını kuracağın şehri seç.', 'good');
    }
    const fsBtn = $('fsBtn');
    if (!document.documentElement.requestFullscreen || isStandalone()) fsBtn.classList.add('hidden');
    fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else goFullscreen(); });
    // hata ayıklama: konsoldan __dbg.step(saniye) ile oyunu ilerletebilirsin
    window.__game = game;
    window.__dbg = {
      game, ui, renderer, writeSave, net,
      step(sec) { for (let t = 0; t < sec; t += 0.05) game.update(0.05); renderer.draw(); ui.updateTop(); ui.updateActionBar(); ui.renderPanel(); },
    };
    bindInput();
    if (mode === 'mobile') $('dpad').classList.remove('hidden');
    let last = performance.now(), acc = 0, topT = 0, soundT = 0, moodT = 0, lastSim = performance.now();
    // Oyun ilerletme. İstemci oyunu ilerletmez (durum host'tan gelir), yalnızca zamanı akıcı yürütür.
    function simulate(now, cap) {
      const dt = Math.min(cap, Math.max(0, (now - lastSim) / 1000));
      lastSim = now;
      if (game.mp === 'client') { net.advance(dt); return; }
      acc += dt;
      while (acc >= 0.05) { game.update(0.05); acc -= 0.05; }
    }
    // Host'un sekmesi arka plandayken çizim durur ama oyun herkes için sürmeli
    if (game.mp === 'host') setInterval(() => { if (document.hidden) simulate(performance.now(), 1.5); }, 250);
    const netFlag = $('tbNet');
    if (net) netFlag.classList.remove('hidden');
    // Müzik havası ve çatışma sesleri oyun durumuna göre
    function updateSound(dt) {
      soundT += dt; moodT += dt;
      if (soundT < 0.2) return;
      soundT = 0;
      const me = game.playerId;
      let mine = 0, other = 0, marching = 0;
      for (const u of game.units) {
        if (u.dead || !u.move) continue;
        const k = u.move.kind;
        if (k !== 'battle' && k !== 'attack') continue;
        const involves = u.owner === me || game.cities[u.move.to].owner === me;
        if (k === 'battle') {
          if (involves) mine++;
          else {
            const c = game.cities[u.move.to], [sx, sy] = renderer.toScreen(c.x, c.y);
            if (sx > 0 && sx < renderer.vw && sy > 0 && sy < renderer.vh) other++;
          }
        } else if (involves) marching++;
      }
      G.Audio.battleLevel(mine ? 1 : other ? 0.35 : 0);
      if (moodT >= 0.6) {
        moodT = 0;
        const atWar = !game.over && (mine > 0 || marching > 0 || game.enemiesOf(me).some((e) => !game.isRebel(e)));
        G.Audio.setMood({ war: atWar, battle: mine ? 1 : marching ? 0.6 : 0 });
      }
    }
    function loop(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // kamera
      const sp = (keys.shift ? 1400 : 800) * dt / renderer.cam.zoom;
      if (keys.w) renderer.cam.y -= sp;
      if (keys.s) renderer.cam.y += sp;
      if (keys.a) renderer.cam.x -= sp;
      if (keys.d) renderer.cam.x += sp;
      renderer.clampCam();
      simulate(now, 0.1);
      updateSound(dt);
      renderer.draw();
      topT += dt;
      if (topT > 0.1) {
        topT = 0; ui.updateTop(); ui.updateActionBar(); ui.updateLive(); ui.updateSetup();
        if (lastMouse) ui.tooltip(ui.hoverCity, lastMouse[0], lastMouse[1]);
        if (net) { const st = net.status(); if (netFlag.textContent !== st.text) netFlag.textContent = st.text; netFlag.classList.toggle('bad', st.bad); }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  let lastMouse = null;
  function bindInput() {
    const cv = $('map');
    window.addEventListener('resize', () => renderer.resize());
    const keyMap = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd', ShiftLeft: 'shift', ShiftRight: 'shift' };
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (keyMap[e.code]) { keys[keyMap[e.code]] = true; e.preventDefault(); }
      if (e.code === 'KeyQ') ui.cancel();
      if (e.code === 'KeyM') $('sndBtn').click();
      if (e.code === 'Escape') { if (ui.dialogOpen()) ui.closeDialog(); else ui.cancel(); }
      if (e.code === 'Digit1') ui.openMenu('diplomacy');
      if (e.code === 'Digit2') ui.openMenu('military');
      if (e.code === 'Digit3') ui.openMenu('alliances');
      if (e.code === 'Digit4') ui.openMenu('shop');
      if (e.code === 'Space' && game.player.capital >= 0) { const c = game.cities[game.player.capital]; renderer.cam.x = c.x; renderer.cam.y = c.y; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (keyMap[e.code]) keys[keyMap[e.code]] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    // fare / dokunma (Pointer Events)
    const pointers = new Map();
    let drag = null, pinch = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: renderer.cam.zoom };
        drag = null;
      } else if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y, moved: false, button: e.button };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      lastMouse = [e.clientX, e.clientY];
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const target = pinch.zoom * (d / pinch.d);
        renderer.zoomAt(mx, my, target / renderer.cam.zoom);
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 10 : 6)) drag.moved = true;
        if (drag.moved) {
          renderer.cam.x = drag.cx - dx / renderer.cam.zoom;
          renderer.cam.y = drag.cy - dy / renderer.cam.zoom;
          renderer.clampCam();
        }
      }
      if (e.pointerType !== 'touch') {
        const [wx, wy] = renderer.toWorld(e.clientX, e.clientY);
        ui.hoverCity = renderer.cityAt(wx, wy);
        ui.tooltip(ui.hoverCity, e.clientX, e.clientY);
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved) {
        if (drag.button === 2) ui.cancel();
        else if (drag.button === 0) {
          const [wx, wy] = renderer.toWorld(e.clientX, e.clientY);
          const city = renderer.cityAt(wx, wy);
          const unit = renderer.unitAtScreen(e.clientX, e.clientY);
          if (e.pointerType === 'touch') ui.hoverCity = city;
          ui.handleClick(city, unit);
        }
      }
      drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
    cv.addEventListener('pointerleave', () => { if (!drag) { ui.hoverCity = null; ui.tooltip(null); lastMouse = null; } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

    // minimap
    const mini = $('mini');
    let miniDrag = false;
    const miniJump = (e) => {
      const r = mini.getBoundingClientRect();
      const w = renderer.miniToWorld(e.clientX - r.left, e.clientY - r.top);
      if (w) { renderer.cam.x = w[0]; renderer.cam.y = w[1]; renderer.clampCam(); }
    };
    mini.addEventListener('pointerdown', (e) => { miniDrag = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
    mini.addEventListener('pointermove', (e) => { if (miniDrag) miniJump(e); });
    mini.addEventListener('pointerup', () => (miniDrag = false));

    // mobil D-pad
    document.querySelectorAll('#dpad [data-k]').forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[k] = true; b.setPointerCapture(e.pointerId); });
      const off = () => (keys[k] = false);
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    });
    $('zoomIn').addEventListener('click', () => renderer.zoomAt(innerWidth / 2, innerHeight / 2, 1.25));
    $('zoomOut').addEventListener('click', () => renderer.zoomAt(innerWidth / 2, innerHeight / 2, 0.8));
  }

  // ses: ilk dokunuşta aç; düğmelere basınca tıklama sesi çal
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => G.Audio.unlock(), { capture: true, once: true }));
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('button, .btn, select, .ideo, [data-menu], .rchip')) G.Audio.sfx('click');
  }, true);

  initApp();
  initStart();
})();
