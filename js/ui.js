// Arayüz: üst bilgi çubuğu, 4 menü (Diplomasi, Askeri Yönetim, İttifaklar, Mağaza), diyaloglar, gelen teklifler
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const { esc, fmtK, fmtMoney, fmtTime } = U;

  const SHOP = [
    { key: 'blitz', name: 'Blitzkrieg', desc: '2 dk boyunca +%35 saldırı.', target: null },
    { key: 'cityDef', name: 'Şehir Savunması', desc: 'Seçtiğin şehirde savunma 2 kat.', target: 'own' },
    { key: 'factory', name: 'Fabrika', desc: '+1₺ / 15 sn. 6 sn\'de kurulur; bağlı şehirlerdeki askerleri güçlü tutar.', target: 'own' },
    { key: 'factoryLimit', name: 'Fabrika Limiti', desc: 'Şehir başına fabrika sınırı +1.', target: null },
    { key: 'plane', name: 'Uçak', desc: 'Başkentten bir iç şehre en fazla 15k asker çıkarır.', target: 'plane' },
    { key: 'rebellion', name: 'İsyan Çıkar', desc: 'Seçtiğin ülkede 5k+ askerli rastgele bir şehir isyan eder.', target: 'country' },
    { key: 'missile', name: 'Füze', desc: 'Başkent dışı bir şehirde tüm asker ve yapıları yok eder.', target: 'missile' },
    { key: 'airDef', name: 'Hava Koruma', desc: 'Uçak çıkarmasını engeller, füzeleri %15 düşürür.', target: 'own' },
  ];

  const ICONS = {
    diplomacy: '<svg viewBox="0 0 24 24"><path d="M6 3h10l3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M7 8h9M7 12h9M7 16h5"/></svg>',
    military: '<svg viewBox="0 0 24 24"><path d="M4 3l11 11M20 3L9 14"/><path d="M12.5 16.5l3-3M11.5 16.5l-3-3"/><path d="M15 17l3 3M9 17l-3 3"/></svg>',
    alliances: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1.5 3.5h-3z"/><path d="M10.5 6.5C6 9 4 13 5 17c.6 2.3 2.7 4 5 4h4c2.3 0 4.4-1.7 5-4 1-4-1-8-5.5-10.5"/><path d="M12 10.5v8M14 12h-3a1.3 1.3 0 0 0 0 2.6h2a1.3 1.3 0 0 1 0 2.6h-3"/></svg>',
  };
  const MENU_TITLES = { diplomacy: 'Diplomasi', military: 'Askeri Yönetim', alliances: 'İttifaklar', shop: 'Mağaza' };

  class UI {
    constructor(game, opts) {
      this.game = game;
      this.mode = opts.mode;
      this.scale = opts.mode === 'mobile' ? 1.25 : 1;
      this.hoverCity = null;
      this.selUnit = null;
      this.amountK = 0;
      this.marking = false;
      this.marked = new Set();
      this.targeting = null;
      this.setupMode = !opts.resumed && game.phase === 'setup' && !game.player.setupDone;
      this.menu = null;
      this.diploSel = null;
      this.lastHtml = '';
      this.live = [];
      this.inbox = [];
      this.barKey = '';
      this.$ = (id) => document.getElementById(id);
      this.build();
      game.on((ev) => this.onEvent(ev));
      this.setupBanner(this.setupMode);
      if (opts.resumed) {
        this.inbox = game.proposals.filter((p) => p.to === game.playerId).map((p) => p.id);
        this.renderInbox();
        this.toast(`Hoş geldin ${game.player.name}! Kaldığın yerden devam ediyorsun.`, 'good');
      }
      setInterval(() => this.renderPanel(), 300);
    }

    // ---------- kurulum ----------
    build() {
      const g = this.game, p = g.player;
      document.body.classList.toggle('mobile', this.mode === 'mobile');
      this.$('hud').classList.remove('hidden');
      const sb = this.$('sidebar');
      sb.innerHTML = Object.keys(MENU_TITLES).map((k) =>
        `<button data-menu="${k}" title="${MENU_TITLES[k]}">${ICONS[k]}<span>${MENU_TITLES[k]}</span></button>`).join('');
      sb.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-menu]');
        if (b) this.openMenu(b.dataset.menu);
      });
      this.$('panelClose').addEventListener('click', () => this.openMenu(null));
      this.$('panelBody').addEventListener('click', (e) => this.onPanelClick(e));
      this.$('panelBody').addEventListener('change', (e) => this.onPanelChange(e));
      this.$('tbSwatch').style.background = p.color;
      this.$('tbName').textContent = p.name;
      this.$('tbIdeo').textContent = g.ideo(p.id).name;
      this.$('actionBar').addEventListener('click', (e) => this.onBarClick(e));
      this.$('actionBar').addEventListener('input', (e) => {
        if (e.target.id === 'amtRange') { this.amountK = +e.target.value; this.updateBarLive(); }
      });
      this.$('inbox').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-pid]');
        if (!b) return;
        const r = g.cmdRespond(g.playerId, +b.dataset.pid, b.dataset.ok === '1');
        if (r.err) this.toast(r.err, 'bad');
        this.renderInbox();
      });
    }

    // Çevrimiçi kurulum: fabrikasını kuran oyuncu diğerlerini bekler (süre dolunca host başkentlere otomatik kurar)
    updateSetup() {
      const g = this.game;
      if (this.setupMode && g.player.setupDone) { this.setupMode = false; this.setupBanner(false); }
      const el = this.$('setupBanner');
      if (g.phase === 'setup' && g.player.setupDone) {
        const all = g.countries.filter((c) => c.alive && !c.isRebel);
        const html = `Fabrikaların kuruldu. Diğer hükümdarlar bekleniyor… <b>${all.filter((c) => c.setupDone).length}/${all.length}</b> hazır
          <small>Herkes hazır olunca oyun başlar. Seçmeyenlerin fabrikaları 1 dakika sonra başkentlerine kurulur.</small>`;
        if (el.dataset.wait !== html) { el.dataset.wait = html; el.innerHTML = html; }
        el.classList.remove('hidden');
      } else if (el.dataset.wait) { el.dataset.wait = ''; if (!this.setupMode) el.classList.add('hidden'); }
    }

    setupBanner(on) {
      const el = this.$('setupBanner');
      el.classList.toggle('hidden', !on);
      if (on) {
        const n = this.game.ideo(this.game.playerId).factories;
        el.innerHTML = `<b>${esc(this.game.player.name)}</b>, hükümdarlığın başlıyor!<br>${n} fabrikanı kuracağın <b>kendi şehrini</b> haritadan seç.
          <small>Başkentin ★ ile işaretli. ${this.mode === 'mobile' ? 'Kaydırmak için sürükle, yakınlaştırmak için iki parmak kullan.' : 'Kamerayı WASD ile hareket ettir, tekerlek ile yakınlaştır.'}</small>`;
      }
    }

    // ---------- olaylar ----------
    onEvent(ev) {
      const g = this.game;
      if (ev.type === 'toast') {
        if (ev.to === null || ev.to.includes(g.playerId)) this.toast(ev.text, ev.kind, true);
      } else if (ev.type === 'proposal') {
        if (ev.p.to !== g.playerId) return;
        if (!this.inbox.includes(ev.p.id)) this.inbox.push(ev.p.id);
        if (!g.proposals.some((p) => p.id === ev.p.id)) g.proposals.push(ev.p); // istemci: anlık görüntüden önce gelebilir
        this.renderInbox();
      } else if (ev.type === 'resolved') {
        if (this.inbox.includes(ev.p.id)) { this.inbox = this.inbox.filter((x) => x !== ev.p.id); this.renderInbox(); }
      } else if (ev.type === 'income') {
        if (ev.cid !== undefined && ev.cid !== g.playerId) return;
        const el = this.$('tbMoneyBox');
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      } else if (ev.type === 'gameover') {
        if (ev.cid !== undefined && ev.cid !== g.playerId) return;
        this.showEnd(ev.win);
      }
    }
    // Çevrimiçi istemci: gelen kutusunu sunucudan gelen teklif listesiyle eşitle
    syncInbox() {
      const g = this.game, me = g.playerId;
      const mine = g.proposals.filter((p) => p.to === me).map((p) => p.id);
      const next = this.inbox.filter((id) => mine.includes(id)).concat(mine.filter((id) => !this.inbox.includes(id)));
      if (next.length !== this.inbox.length || next.some((id, i) => id !== this.inbox[i])) { this.inbox = next; this.renderInbox(); }
    }

    toast(text, kind, fromGame) {
      const box = this.$('toasts');
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || 'info');
      el.textContent = text;
      // oyuncunun kendi eylemlerinin sonucu (hata / onay) kısa bir sesle bildirilir; oyun olaylarının kendi sesi var
      if (!fromGame && G.Audio) G.Audio.sfx(kind === 'bad' ? 'error' : kind === 'good' ? 'good' : 'click');
      // mobilde önemli olaylarda titreşim
      const now = performance.now();
      const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (this.mode === 'mobile' && navigator.vibrate && activated && (kind === 'war' || kind === 'bad') && now - (this.lastVibe || 0) > 1500) {
        this.lastVibe = now;
        try { navigator.vibrate(kind === 'war' ? [70, 50, 70] : 35); } catch (e) { /* desteklenmiyor */ }
      }
      box.appendChild(el);
      while (box.children.length > 6) box.removeChild(box.firstChild);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 6500);
    }

    renderInbox() {
      const g = this.game;
      this.inbox = this.inbox.filter((id) => g.proposals.some((p) => p.id === id));
      const box = this.$('inbox');
      box.innerHTML = this.inbox.slice(0, 3).map((id) => {
        const p = g.proposals.find((x) => x.id === id);
        const f = g.countries[p.from];
        return `<div class="letter frame">
          <div class="lh"><span class="sw" style="background:${f.color}"></span><b>${esc(f.name)}</b> · ${esc(G.PROPOSAL_NAMES[p.type])}</div>
          <p>${esc(g.describeProposal(p))}</p>
          <div class="lt"><i data-exp="${p.id}"></i></div>
          <div class="lb"><button class="btn ok" data-pid="${p.id}" data-ok="1">Kabul Et</button><button class="btn no" data-pid="${p.id}" data-ok="0">Reddet</button></div>
        </div>`;
      }).join('') + (this.inbox.length > 3 ? `<div class="more">+${this.inbox.length - 3} ileti daha</div>` : '');
    }

    // ---------- seçimler ----------
    selectedUnit() {
      if (this.selUnit === null) return null;
      const g = this.game;
      const u = g.units.find((x) => x.id === this.selUnit && !x.dead);
      if (!u || u.move || u.owner !== g.playerId) { this.selUnit = null; return null; }
      return u;
    }
    selectUnit(u) {
      if (u && u.city !== null && this.game.isUnderAttack(u.city)) this.toast(`${this.game.cities[u.city].name} saldırı altında — askerler şehri terk edemez, savunmak zorunda.`, 'bad');
      this.selUnit = u ? u.id : null;
      this.amountK = u ? Math.ceil(u.troops / 1000) : 0;
      this.barKey = '';
    }
    cancel() {
      if (this.targeting) {
        const t = this.targeting;
        this.targeting = null; this.barKey = '';
        this.updateActionBar();
        if (t.onCancel) t.onCancel();
        return true;
      }
      if (this.marking) { this.marking = false; this.marked.clear(); this.barKey = ''; this.updateActionBar(); return true; }
      if (this.selUnit !== null) { this.selectUnit(null); this.updateActionBar(); return true; }
      if (this.menu) { this.openMenu(null); return true; }
      return false;
    }

    handleClick(cityId, unit) {
      const g = this.game, me = g.playerId;
      if (g.over || g.viewerDone) return;
      if (this.setupMode) {
        if (cityId === null) return;
        const r = g.cmdStartFactories(me, cityId);
        if (r.err) { this.toast(r.err, 'bad'); return; }
        this.setupMode = false;
        this.setupBanner(false);
        return;
      }
      if (this.targeting) {
        if (cityId === null) return;
        const err = this.targeting.valid(cityId);
        if (err) { this.toast(err, 'bad'); return; }
        const t = this.targeting;
        if (t.multi) { t.pick(cityId); this.updateBarLive(); return; }
        this.targeting = null; this.barKey = '';
        t.pick(cityId);
        return;
      }
      if (this.marking) {
        let u = unit;
        if (!u && cityId !== null) u = g.idleUnitsAt(cityId).find((x) => x.owner === me);
        if (u && u.owner === me && !u.move) {
          if (this.marked.has(u.id)) this.marked.delete(u.id); else this.marked.add(u.id);
        }
        return;
      }
      const sel = this.selectedUnit();
      if (sel) {
        if (unit && unit.owner === me && unit.id !== sel.id && !unit.move) { this.selectUnit(unit); return; }
        if (cityId === null) { this.selectUnit(null); this.updateActionBar(); return; } // boş yere (denize) dokununca seçim kalkar
        if (cityId === sel.city) { this.selectUnit(null); return; }
        const amount = Math.min(sel.troops, this.amountK * 1000);
        const r = g.cmdMove(me, sel.id, cityId, amount >= sel.troops - 1 ? undefined : amount);
        if (r.err) { this.toast(r.err, 'bad'); return; }
        this.selectUnit(null);
        return;
      }
      if (unit && unit.owner === me && !unit.move) { this.selectUnit(unit); return; }
      if (cityId !== null) {
        const mine = g.idleUnitsAt(cityId).filter((x) => x.owner === me);
        if (mine.length) this.selectUnit(mine.sort((a, b) => b.troops - a.troops)[0]);
      }
    }

    // ---------- eylem çubuğu ----------
    updateActionBar() {
      const g = this.game;
      const bar = this.$('actionBar');
      const sel = this.selectedUnit();
      let key = '';
      if (this.setupMode) key = '';
      else if (this.targeting) key = 'target:' + this.targeting.label;
      else if (this.marking) key = 'mark';
      else if (sel) key = 'unit:' + sel.id;
      if (key !== this.barKey) {
        this.barKey = key;
        bar.classList.toggle('hidden', !key);
        const cancelBtn = `<button class="btn" data-bar="cancel">İptal${this.mode === 'pc' ? ' (Q)' : ''}</button>`;
        if (key.startsWith('target') && this.targeting.multi) {
          bar.innerHTML = `<div class="bar-row"><span class="bar-ic">◎</span><span>${esc(this.targeting.label)}</span></div>
            <div class="bar-row"><b id="pickInfo"></b><button class="btn green" data-bar="pickdone">Tamam</button>${cancelBtn}</div>`;
        } else if (key.startsWith('target')) {
          bar.innerHTML = `<div class="bar-row"><span class="bar-ic">◎</span><span>${esc(this.targeting.label)}</span>${cancelBtn}</div>`;
        } else if (key === 'mark') {
          bar.innerHTML = `<div class="bar-row"><span>Orduya katılacak birliklerine tıkla: <b id="markInfo"></b></span></div>
            <div class="bar-row"><button class="btn red" data-bar="army" data-mode="attack">Taarruz Ordusu Kur</button>
            <button class="btn blue" data-bar="army" data-mode="defend">Savunma Ordusu Kur</button>${cancelBtn}</div>
            <small>Taarruz: düşman şehirlerini kendiliğinden işgal eder · Savunma: sınırda kalır, kayıp şehirleri geri alır</small>`;
        } else if (key.startsWith('unit')) {
          const maxK = Math.max(1, Math.ceil(sel.troops / 1000));
          bar.innerHTML = `<div class="bar-row"><span>Seçili birlik: <b id="selInfo"></b></span>
            <label class="amt">Taşınacak miktar <input type="range" id="amtRange" min="1" max="${maxK}" step="1" value="${Math.min(this.amountK, maxK)}"> <b id="amtVal"></b></label>${cancelBtn}</div>
            <small>Hedef şehre ${this.mode === 'pc' ? 'tıkla' : 'dokun'}: kendi şehrin = taşı · komşu düşman = saldır</small>`;
        } else bar.innerHTML = '';
      }
      // Her seferinde: seçim iptal edilince (barKey sıfırlanıp yine '' kalınca) çubuk açık kalıyordu
      bar.classList.toggle('hidden', !key);
      this.updateBarLive();
    }
    updateBarLive() {
      const g = this.game;
      const sel = this.selectedUnit();
      if (this.barKey.startsWith('unit') && sel) {
        const r = this.$('amtRange');
        const maxK = Math.max(1, Math.ceil(sel.troops / 1000));
        if (r && +r.max !== maxK) { r.max = maxK; }
        if (this.amountK > maxK) this.amountK = maxK;
        const info = this.$('selInfo'); if (info) info.textContent = `${fmtK(sel.troops)} · ${g.cities[sel.city].name}${sel.weak ? ' · ❗ fabrikaya bağlı değil (−%50)' : ''}`;
        const v = this.$('amtVal'); if (v) v.textContent = fmtK(Math.min(sel.troops, this.amountK * 1000));
      } else if (this.barKey.startsWith('target') && this.targeting && this.targeting.info) {
        const el = this.$('pickInfo'); if (el) el.textContent = this.targeting.info();
      } else if (this.barKey === 'mark') {
        let t = 0;
        for (const id of this.marked) { const u = g.units.find((x) => x.id === id && !x.dead); if (u) t += u.troops; else this.marked.delete(id); }
        const el = this.$('markInfo'); if (el) el.textContent = `${this.marked.size} birlik · ${fmtK(t)}`;
      }
    }
    onBarClick(e) {
      const b = e.target.closest('[data-bar]');
      if (!b) return;
      const g = this.game;
      if (b.dataset.bar === 'cancel') this.cancel();
      else if (b.dataset.bar === 'pickdone' && this.targeting) {
        const t = this.targeting;
        this.targeting = null; this.barKey = '';
        this.updateActionBar();
        if (t.done) t.done();
      }
      else if (b.dataset.bar === 'army') {
        const r = g.cmdCreateArmy(g.playerId, [...this.marked], b.dataset.mode);
        if (r.err) { this.toast(r.err, 'bad'); return; }
        this.toast(`${r.army.name} kuruldu (${b.dataset.mode === 'attack' ? 'Taarruz' : 'Savunma'})`, 'good');
        this.marking = false; this.marked.clear(); this.barKey = '';
      }
    }

    // ---------- üst çubuk ----------
    updateTop() {
      const g = this.game, p = g.player;
      this.$('tbMoney').textContent = fmtMoney(p.money);
      this.$('tbInc').style.width = (p.incomeTimer / G.CFG.incomeInterval) * 100 + '%';
      const f = g.factoriesOf(p.id);
      this.$('tbIncTxt').textContent = `+${g.incomeOf(p.id)}₺ / ${G.CFG.incomeInterval} sn`;
      this.$('tbTroops').textContent = fmtK(g.totalTroops(p.id)) + (p.queue ? ` (+${p.queue}k)` : '');
      this.$('tbFac').textContent = f;
      this.$('tbCities').textContent = g.citiesOf(p.id).length;
      this.$('tbTime').textContent = fmtTime(g.time);
      const bl = p.blitzUntil - g.time;
      const be = this.$('tbBlitz');
      be.classList.toggle('hidden', bl <= 0);
      if (bl > 0) be.textContent = 'Blitzkrieg ' + fmtTime(bl);
      const wars = g.enemiesOf(p.id).filter((x) => !g.isRebel(x));
      const we = this.$('tbWar');
      we.classList.toggle('hidden', !wars.length);
      if (wars.length) we.textContent = '⚔︎ Savaş: ' + wars.map((w) => g.countries[w].name).join(', ');
      document.querySelectorAll('#sidebar button').forEach((b) => b.classList.toggle('active', b.dataset.menu === this.menu));
      // gelen teklif süreleri
      document.querySelectorAll('[data-exp]').forEach((el) => {
        const pr = g.proposals.find((x) => x.id === +el.dataset.exp);
        if (pr) el.style.width = Math.max(0, ((pr.expires - g.time) / G.CFG.proposalTimeout) * 100) + '%';
      });
    }

    // ---------- ipucu ----------
    tooltip(cityId, sx, sy) {
      const tip = this.$('tooltip');
      if (cityId === null || this.mode === 'mobile') { tip.classList.add('hidden'); return; }
      const g = this.game, c = g.cities[cityId], o = g.countries[c.owner];
      const isCap = g.countries.some((k) => k.alive && k.capital === cityId);
      const units = g.idleUnitsAt(cityId);
      const byOwner = new Map();
      for (const u of units) byOwner.set(u.owner, (byOwner.get(u.owner) || 0) + u.troops);
      const troops = [...byOwner].map(([k, v]) => `<div><span class="sw" style="background:${g.countries[k].color}"></span>${esc(g.countries[k].name)}: <b>${fmtK(v)}</b></div>`).join('') || '<div><i>asker yok</i></div>';
      const inc = g.incomingAttacks(cityId).length;
      const struct = [];
      if (c.factories) struct.push(`${c.factories} fabrika`);
      if (c.building.length) struct.push(`🏗 ${c.building.length} fabrika inşaatta`);
      if (c.cityDef) struct.push('şehir savunması');
      if (c.airDef) struct.push('hava koruma');
      tip.innerHTML = `<div class="tt-h">${isCap ? '★ ' : ''}${esc(c.name)}</div>
        <div class="tt-o"><span class="sw" style="background:${o.color}"></span>${esc(o.name)}${isCap ? ' · başkent' : ''}${g.isBorderCity(cityId) ? ' · sınır' : ''}</div>
        ${troops}${struct.length ? `<div class="tt-s">${struct.join(' · ')}</div>` : ''}${inc ? `<div class="tt-w">⚔︎ saldırı altında!</div>` : ''}${units.some((u) => u.weak) ? `<div class="tt-w">❗ Fabrikaya bağlı değil: asker −%50</div>` : ''}`;
      tip.classList.remove('hidden');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(window.innerWidth - w - 8, sx + 16) + 'px';
      tip.style.top = Math.min(window.innerHeight - h - 8, sy + 16) + 'px';
    }

    // ---------- menüler ----------
    openMenu(name) {
      if (name && this.menu === name) name = null;
      this.menu = name;
      document.body.classList.toggle('panel-open', !!name);
      this.$('panel').classList.toggle('hidden', !name);
      if (name) {
        this.$('panelTitle').textContent = MENU_TITLES[name];
        if (name === 'diplomacy' && this.diploSel === null) {
          const first = this.game.countries.find((c) => c.alive && !c.isPlayer && !c.isRebel);
          this.diploSel = first ? first.id : null;
        }
      }
      this.lastHtml = '';
      this.renderPanel();
    }

    L(fn) { this.liveBuf.push(fn); return `<span data-l="${this.liveBuf.length - 1}"></span>`; }
    // değeri değişince küçük bir "zıplama" animasyonu yapan canlı değer
    LP(fn) { this.liveBuf.push(fn); return `<span class="lpop" data-l="${this.liveBuf.length - 1}"></span>`; }
    LW(fn) { this.liveBuf.push(fn); return `<i data-lw="${this.liveBuf.length - 1}"></i>`; }

    renderPanel() {
      if (!this.menu) return;
      this.liveBuf = [];
      let html = '';
      if (this.menu === 'diplomacy') html = this.htmlDiplomacy();
      else if (this.menu === 'military') html = this.htmlMilitary();
      else if (this.menu === 'alliances') html = this.htmlAlliances();
      else if (this.menu === 'shop') html = this.htmlShop();
      this.live = this.liveBuf;
      if (html !== this.lastHtml) {
        const body = this.$('panelBody');
        const keep = {};
        body.querySelectorAll('select[id]').forEach((s) => (keep[s.id] = s.value));
        // tüm kaydırılabilir alanların konumu korunur (diplomasi: ülke listesi + ülke kartı ayrı kayar)
        const SCR = '.scroll, .diplo';
        const tops = [...body.querySelectorAll(SCR)].map((s) => [s.scrollTop, s.scrollLeft]);
        body.innerHTML = html;
        for (const id in keep) { const s = document.getElementById(id); if (s && [...s.options].some((o) => o.value === keep[id])) s.value = keep[id]; }
        body.querySelectorAll(SCR).forEach((s, i) => { if (tops[i]) { s.scrollTop = tops[i][0]; s.scrollLeft = tops[i][1]; } });
        this.lastHtml = html;
      }
      this.updateLive();
    }
    updateLive() {
      if (!this.menu) return;
      const body = this.$('panelBody');
      if (!this.popVals || this.popMenu !== this.menu) { this.popVals = {}; this.popMenu = this.menu; }
      body.querySelectorAll('[data-l]').forEach((el) => {
        const f = this.live[+el.dataset.l];
        if (!f) return;
        const v = f();
        if (el.textContent === v) return;
        el.textContent = v;
        if (!el.classList.contains('lpop')) return;
        // panel yeniden çizilse bile önceki değer hatırlanır; değer değiştiyse zıplar
        const k = el.dataset.l, prev = this.popVals[k];
        this.popVals[k] = v;
        if (prev !== undefined && prev !== v) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      });
      body.querySelectorAll('[data-lw]').forEach((el) => { const f = this.live[+el.dataset.lw]; if (f) el.style.width = f() + '%'; });
    }

    relStatus(a, b) {
      const g = this.game;
      if (g.atWar(a, b)) return { t: 'Savaşta', c: 'war' };
      if (g.isAlly(a, b)) return { t: 'Müttefik', c: 'ally' };
      return { t: 'Barış', c: 'peace' };
    }

    // ---------- menüler (v2: sade, tek bakışta okunur) ----------
    stat(label, valueHtml) { return `<div class="stat"><span>${label}</span><b>${valueHtml}</b></div>`; }
    relWord(rel) { return rel > 40 ? 'dostane' : rel > 10 ? 'iyi' : rel > -10 ? 'nötr' : rel > -40 ? 'gergin' : 'düşmanca'; }
    soft(c, a) { const p = c.pal; return `hsla(${p.h},${p.s}%,${p.l}%,${a})`; }
    seal(c, cls) { return `<span class="seal ${cls || ''}" style="--c:${c.color}">${esc((c.name || '?')[0])}</span>`; }

    // ---------- diplomasi (v3): ülke listesi + seçili ülke kartı ----------
    htmlDiplomacy() {
      const g = this.game, me = g.playerId, P = g.player;
      const rank = (c) => (!c.alive ? 4 : g.atWar(me, c.id) ? 0 : g.isAlly(me, c.id) ? 1 : 2);
      const others = g.countries.filter((c) => !c.isRebel && !c.isPlayer && !c.absent)
        .sort((a, b) => rank(a) - rank(b) || g.rel[me][b.id] - g.rel[me][a.id] || a.id - b.id);
      if (!others.some((c) => c.id === this.diploSel)) this.diploSel = others.length ? others[0].id : null;
      const nbrs = new Set(g.neighborsOfCountry(me));
      const human = (c) => (g.mp && c.isHuman ? '<i class="hm" title="Gerçek oyuncu">👤</i>' : '');
      const list = others.map((c) => {
        const st = c.alive ? this.relStatus(me, c.id) : { t: 'Yıkıldı', c: 'dead' };
        const sub = !c.alive ? 'yıkıldı' : st.c === 'war' ? '⚔ savaşta' : st.c === 'ally' ? '🤝 müttefik' : this.relWord(g.rel[me][c.id]);
        return `<li data-act="dsel" data-id="${c.id}" class="${this.diploSel === c.id ? 'sel' : ''} ${st.c}">${this.seal(c)}
          <span class="nm"><b>${esc(c.name)}${human(c)}</b><small>${sub}${c.alive && nbrs.has(c.id) ? ' · komşu' : ''}</small></span></li>`;
      }).join('');
      let info = '<div class="empty">Diplomasi kuracak ülke yok.</div>';
      const t = this.diploSel !== null ? g.countries[this.diploSel] : null;
      if (t) {
        const id = t.id;
        const al = g.allianceOf(id), myAl = g.allianceOf(me);
        const st = t.alive ? this.relStatus(me, id) : { t: 'Yıkıldı', c: 'dead' };
        const rel = g.rel[me][id];
        const war = g.atWar(me, id), ally = g.isAlly(me, id);
        const B = (act, label, opts) => {
          opts = opts || {};
          return `<button class="btn ${opts.cls || ''}" data-act="${act}" data-id="${id}" ${opts.dis ? 'disabled' : ''} title="${esc(opts.title || '')}">${label}</button>`;
        };
        const tags = [`<span class="chip ${st.c}">${st.t}</span>`];
        if (t.alive) tags.push(`<span class="tag">${esc(g.ideo(id).name)}</span>`);
        if (al) tags.push(`<span class="tag al">⚑ ${esc(al.name)}</span>`);
        if (g.mp && t.isHuman) tags.push(`<span class="tag">👤 Oyuncu${t.isBot ? ' (bağlantı yok)' : ''}</span>`);
        if (t.alive && nbrs.has(id)) tags.push('<span class="tag">Sınır komşusu</span>');
        const head = `<div class="dp-head" style="background:linear-gradient(100deg, ${this.soft(t, 0.34)}, rgba(255,250,235,.2) 75%)">
          ${this.seal(t, 'big')}<div class="dp-title"><b>${esc(t.name)}</b><div class="tags">${tags.join('')}</div></div>
          ${t.alive && t.capital >= 0 ? `<button class="btn sm" data-act="dfocus" data-id="${id}" title="Başkentini haritada göster">◎ Harita</button>` : ''}</div>`;
        let body;
        if (!t.alive) {
          const s = g.stats && g.stats[id];
          const by = s && s.deadBy !== null && s.deadBy !== undefined ? g.countries[s.deadBy] : null;
          body = `<div class="dp-dead">☠ Bu devlet ${s && s.deadAt !== null ? fmtTime(s.deadAt) + ' anında ' : ''}yıkıldı${by ? `, <b>${esc(by.name)}</b> tarafından` : ''}.
            <small>Başkenti düşen devlet çöker; kalan şehirleri isyancılara geçer.</small></div>`;
        } else {
          // ilişki ölçeği (-100 … +100)
          const relm = `<div class="relm"><div class="relm-h"><span>İlişki</span><b>${rel > 0 ? '+' : ''}${rel} · ${this.relWord(rel)}</b></div>
            <div class="relm-bar"><i style="left:${(rel + 100) / 2}%"></i></div><div class="relm-s"><span>düşman</span><span>nötr</span><span>dost</span></div></div>`;
          // güç karşılaştırması: sen ⟷ onlar
          const vs = (label, mine, theirs, fmt) => `<div class="vs"><div class="vs-h"><span>${this.L(() => fmt(mine()))}</span><small>${label}</small><span>${this.L(() => fmt(theirs()))}</span></div>
            <div class="vs-bar" style="--a:${P.color};--b:${t.color}">${this.LW(() => { const a = mine(), b = theirs(); return a + b > 0 ? (a / (a + b)) * 100 : 50; })}</div></div>`;
          const cnt = (k) => () => { let n = 0; for (const c of g.cities) if (c.owner === k) n++; return n; };
          const power = `<div class="dcard"><h5>Güç dengesi <small>— sen ⟷ ${esc(t.name)}</small></h5>
            ${vs('Asker', () => g.totalTroops(me), () => g.totalTroops(id), fmtK)}
            ${vs('Şehir', cnt(me), cnt(id), String)}
            ${vs('Fabrika', () => g.factoriesOf(me), () => g.factoriesOf(id), String)}
            ${vs('Hazine', () => P.money, () => t.money, fmtMoney)}</div>`;
          // bekleyen teklifler
          const pend = g.proposals.filter((p) => (p.from === me && p.to === id) || (p.from === id && p.to === me));
          const pendHtml = pend.length ? `<ul class="pend">${pend.map((p) => `<li class="${p.from === me ? 'out' : 'in'}" data-pid="${p.id}">
            <span>${p.from === me ? '📤 Gönderdin' : '📥 Gelen'}: <b>${esc(G.PROPOSAL_NAMES[p.type])}</b></span>
            <small>${this.L(() => Math.max(0, Math.ceil(p.expires - g.time)) + ' sn')}</small></li>`).join('')}</ul>` : '';
          // eylemler
          const deals = `<div class="dcard"><h5>Anlaşmalar</h5><div class="actions">
              ${B('demand', '📜 Talep', { dis: war, title: 'Karşı taraftan asker, şehir veya para iste' })}
              ${B('support', '🎁 Destek', { dis: war, title: 'Asker, şehir veya para gönder' })}
              ${B('trade', '⇄ Takas', { dis: war, title: 'Hem ver hem al' })}</div>
            <p class="note">${war ? 'Savaşırken anlaşma yapılamaz.' : 'Kabul edilip edilmemesi ilişkinize ve teklifin değerine bağlıdır.'}</p></div>`;
          const ws = g.warRightState(me, id);
          const wrPrice = g.price(me, 'warRight');
          let conflict;
          if (war) {
            const w = g.wars.get(g.warKey(me, id));
            const peaceP = !!g.pendingProposal(me, id, 'peace');
            conflict = `<p class="war-line">⚔ Savaş sürüyor · ${this.L(() => fmtTime(g.time - (w ? w.since : g.time)))}
                · cephede ${this.L(() => String(g.units.filter((u) => !u.dead && u.move && u.move.kind === 'battle' && ((u.owner === me && g.cities[u.move.to].owner === id) || (u.owner === id && g.cities[u.move.to].owner === me))).length))} çatışma</p>
              <div class="actions">${B('peace', peaceP ? '🕊 Barış teklif edildi' : '🕊 Barış Teklif Et', { cls: 'green', dis: peaceP })}
              ${B('surrender', '🏳 Teslim Ol', { cls: 'white', title: 'Savaş hemen biter, hazinenin yarısını tazminat ödersin' })}
              ${myAl ? B('callallies', '📯 Müttefikleri Çağır', { cls: 'red', title: 'İttifak üyelerini bu savaşa çağır' }) : ''}</div>`;
          } else if (ally) conflict = '<p class="muted">Müttefikine savaş açamazsın. Önce ittifaktan ayrılmalısın.</p>';
          else if (ws.state === 'pending') {
            conflict = `<div class="wr"><span>Savaş hakkı hazırlanıyor</span><div class="bar">${this.LW(() => 100 - ((g.warRightState(me, id).left || 0) / G.CFG.warRightDelay) * 100)}</div>
              <b>${this.L(() => Math.ceil(g.warRightState(me, id).left || 0) + ' sn')}</b></div>`;
          } else if (ws.state === 'ready') conflict = `<div class="actions">${B('declare', '⚔ Savaş İlan Et', { cls: 'red' })}</div><p class="note">Savaş hakkın hazır. İlan ettiğinde bütün dünya duyar.</p>`;
          else conflict = `<div class="actions">${B('warright', `Savaş Hakkı Al · ${fmtMoney(wrPrice)}`, { dis: P.money < wrPrice, title: 'Ödedikten 20 sn sonra savaş ilan edebilirsin' })}</div>
              <p class="note">Hak alındığında ${esc(t.name)} bunu öğrenir ve ilişkiniz bozulur.</p>`;
          const alPrice = g.price(me, 'alliance'), lvPrice = g.price(me, 'leave');
          let pact;
          if (myAl) pact = ally ? B('leave', `İttifaktan Ayrıl · ${fmtMoney(lvPrice)}`, { dis: P.money < lvPrice }) : `<span class="muted">Zaten ${esc(myAl.name)} ittifakındasın.</span>`;
          else if (al) pact = B('alliance', `⚑ Katılma Talebi · ${fmtMoney(alPrice)}`, { dis: war || P.money < alPrice, title: `${al.name}: tüm üyeler onaylamalı` });
          else pact = B('alliance', `🤝 İttifak Teklif Et · ${fmtMoney(alPrice)}`, { dis: war || !!g.pendingProposal(me, id, 'alliance') || P.money < alPrice });
          body = `${relm}${pendHtml}
            <div class="dcards">
              <div class="dcard ${war ? 'war' : ''}"><h5>Savaş ve barış</h5>${conflict}</div>
              ${deals}
              <div class="dcard"><h5>İttifak</h5><div class="actions">${pact}</div></div>
              ${power}
            </div>`;
        }
        info = `<div class="cinfo">${head}${body}</div>`;
      }
      return `<div class="diplo"><ul class="clist scroll">${list}</ul><div class="cwrap scroll">${info}</div></div>`;
    }

    htmlMilitary() {
      const g = this.game, me = g.playerId, P = g.player;
      const tp = g.price(me, 'troop'), up = g.price(me, 'upgrade');
      const armies = g.armies.filter((a) => a.owner === me);
      const cut = g.cutOffCities(me);
      const warn = cut.length ? `<div class="warnbox"><span class="wi">!</span>
        <div><b>${cut.length === 1 ? esc(cut[0].name) : cut.length + ' şehir'} fabrikaya bağlı değil</b>
        <small>Buradaki askerler %50 zayıf ve yavaş. Fabrika kur ya da fabrikalı topraklarınla birleştir.</small></div>
        <button class="btn sm" data-act="cutfocus">Göster</button></div>` : '';
      const upRow = (kind, label) => {
        const lvl = kind === 'atk' ? P.atkLvl : P.defLvl;
        const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        return `<li><div class="up-h"><b>${label}</b><span>${lvl}/10 · +%${lvl * 5}</span></div><div class="pips">${pips}</div>
          <button class="btn sm" data-act="up" data-kind="${kind}" ${lvl >= 10 || P.money < up ? 'disabled' : ''}>${lvl >= 10 ? 'Maksimum' : `+%5 · ${fmtMoney(up)}`}</button></li>`;
      };
      // ideolojiye özel geliştirmeler (her biri 3 seviye; açıklama seviye başına etkiyi söyler)
      const iuMax = G.CFG.ideoUpMax;
      const iuRow = (x) => {
        const lvl = g.iu(me, x.key), pr = g.ideoUpPrice(me, x.key);
        const pips = Array.from({ length: iuMax }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        return `<li><div class="up-h"><b>${esc(x.name)}</b><span>${esc(x.desc)} · ${lvl}/${iuMax}</span></div><div class="pips">${pips}</div>
          <button class="btn sm" data-act="iup" data-key="${x.key}" data-name="${esc(x.name)}" ${lvl >= iuMax || P.money < pr ? 'disabled' : ''}>${lvl >= iuMax ? 'Tamam' : fmtMoney(pr)}</button></li>`;
      };
      const ideoSect = g.ideoUps(me).length ? `<div class="sect"><h5>${esc(g.ideo(me).name)} geliştirmeleri <small>(seviye başına)</small></h5>
          <ul class="equip ideo-up">${g.ideoUps(me).map(iuRow).join('')}</ul></div>` : '';
      const armyList = armies.map((a) => `<li><div class="ar-h"><b>${esc(a.name)}</b> ${this.L(() => fmtK(g.units.filter((u) => u.army === a.id && !u.dead).reduce((s, u) => s + u.troops, 0)))}</div>
          <div class="seg"><button class="btn sm ${a.mode === 'attack' ? 'red on' : ''}" data-act="amode" data-id="${a.id}" data-mode="attack">Taarruz</button>
          <button class="btn sm ${a.mode === 'defend' ? 'blue on' : ''}" data-act="amode" data-id="${a.id}" data-mode="defend">Savunma</button>
          <button class="btn sm" data-act="afocus" data-id="${a.id}" title="Haritada göster">◎</button>
          <button class="btn sm" data-act="adisband" data-id="${a.id}" title="Ordunu dağıt">✕</button></div></li>`).join('');
      const tap = this.mode === 'pc' ? 'tıkla' : 'dokun';
      return `<div class="mil scroll">
        ${warn}
        <div class="mtop">
          <div class="mstat"><span>Toplam asker</span><b>${this.L(() => fmtK(g.totalTroops(me)))}</b></div>
          <div class="mtarget"><span>Eklenecek asker</span>
            <div class="target-row"><button class="btn round" data-act="q" data-dir="-1" ${P.queue <= 0 ? 'disabled' : ''}>−</button>
              <b class="target">${this.LP(() => '+' + fmtK(P.queue * 1000))}</b>
              <button class="btn round" data-act="q" data-dir="1" ${P.money < tp ? 'disabled' : ''}>+</button></div>
            <button class="tgl ${P.autoDist ? 'on' : ''}" data-act="autodist" role="switch" aria-checked="${!!P.autoDist}"
              title="Açıkken üretilen askerler başkentte kalmaz; önce saldırı altındaki, sonra savaştığın ülkeye sınır olan, en az askeri olan şehre yürür.">
              <span class="tgl-track"><i></i></span><span class="tgl-l">Sınırlara dağıt</span><span class="tgl-ar">»</span></button></div>
        </div>
        <div class="prod"><div class="bar">${this.LW(() => (P.queue > 0 ? (P.prodTimer / g.troopTime(me)) * 100 : 0))}</div>
          <small>${this.L(() => (P.queue > 0 ? `Üretimde: ${P.queue}k` : 'Üretim yok'))} · her +1k asker = ${fmtMoney(tp)} · ${this.L(() => (P.autoDist ? 'sınırlara yürür' : 'başkentte doğar'))}</small></div>
        <div class="sect"><h5>Ekipman</h5><ul class="equip">${upRow('atk', 'Saldırı')}${upRow('def', 'Savunma')}</ul></div>
        ${ideoSect}
        <div class="sect"><div class="ar-top"><h5>Ordular</h5><button class="btn sm" data-act="mark">+ Ordu Kur</button></div>
          <ul class="armies">${armyList || '<li class="empty">Ordun yok. Birlikleri işaretleyip ordu kurabilirsin.</li>'}</ul>
          ${armyList ? '<small class="note">Ordunun bulunduğu şehre gönderdiğin askerler orduya katılır.</small>' : ''}</div>
        <p class="note">Birliğe ${tap} → miktarı seç → hedef şehre ${tap}.${this.mode === 'pc' ? ' Q: iptal.' : ''}</p>
      </div>`;
    }

    // ---------- ittifaklar (v3): güç sıralaması, ittifaklar, savaşlar ----------
    htmlAlliances() {
      const g = this.game, me = g.playerId;
      const cityCount = (k) => { let n = 0; for (const c of g.cities) if (c.owner === k) n++; return n; };
      const rows = g.countries.filter((c) => !c.isRebel && !c.absent)
        .map((c) => ({ c, n: cityCount(c.id) }))
        .sort((a, b) => (b.c.alive - a.c.alive) || b.n - a.n || a.c.id - b.c.id);
      const maxN = Math.max(1, ...rows.map((r) => r.n));
      const ranking = rows.map((r, i) => {
        const c = r.c, st = c.isPlayer ? { c: 'me' } : c.alive ? this.relStatus(me, c.id) : { c: 'dead' };
        return `<li class="${st.c}"><span class="rk">${c.alive ? i + 1 : '☠'}</span>${this.seal(c, 'sm')}
          <span class="rk-n"><b>${esc(c.name)}${c.isPlayer ? ' <small>(sen)</small>' : ''}</b>
          <span class="rk-bar"><i style="width:${(r.n / maxN) * 100}%;background:${c.color}"></i></span></span>
          <small class="rk-v">${c.alive ? `${r.n} şehir · ${this.L(() => fmtK(g.totalTroops(c.id)))}` : 'yıkıldı'}</small></li>`;
      }).join('');
      const myAlId = g.countries[me].allianceId;
      const als = g.alliances.slice().sort((a, b) => (b.id === myAlId) - (a.id === myAlId)).map((al) => {
        const p = G.PALETTE[al.colorIdx];
        const mine = al.id === myAlId;
        const members = al.members.map((m) => {
          const c = g.countries[m];
          const st = m === me ? 'me' : g.atWar(me, m) ? 'war' : '';
          return `<span class="rchip ${st}">${this.seal(c, 'xs')}${esc(c.name)}${m === me ? ' (sen)' : ''}</span>`;
        }).join('');
        const btn = mine ? `<button class="btn sm" data-act="leave">Ayrıl · ${fmtMoney(g.price(me, 'leave'))}</button>`
          : myAlId === null ? `<button class="btn sm" data-act="join" data-id="${al.id}" ${al.members.some((m) => g.atWar(me, m)) ? 'disabled title="Üyelerinden biriyle savaştasın"' : ''}>Katıl · ${fmtMoney(g.price(me, 'alliance'))}</button>` : '';
        return `<li class="${mine ? 'mine' : ''}" style="--c:${U.hsl(p.h, p.s, p.l)}"><div class="al-h"><b>⚑ ${esc(al.name)}</b>
          <small>${al.members.length} üye · ${this.L(() => fmtK(al.members.reduce((s, m) => s + g.totalTroops(m), 0)))} asker · ${al.members.reduce((s, m) => s + cityCount(m), 0)} şehir</small>${btn}</div>
          <div class="rels">${members}</div></li>`;
      }).join('');
      const wars = [...g.wars.values()].sort((a, b) => ((b.a === me || b.b === me) - (a.a === me || a.b === me))).map((w) => {
        const A = g.countries[w.a], Bc = g.countries[w.b];
        return `<li class="${w.a === me || w.b === me ? 'mine' : ''}"><span class="side">${this.seal(A, 'xs')}${esc(A.name)} <small>${cityCount(w.a)}</small></span>
          <b class="vsx">⚔</b><span class="side">${this.seal(Bc, 'xs')}${esc(Bc.name)} <small>${cityCount(w.b)}</small></span>
          <small class="dur">${this.L(() => fmtTime(g.time - w.since))}</small></li>`;
      }).join('');
      return `<div class="alls scroll">
        <h5>Güç sıralaması <small>(şehir sayısına göre)</small></h5><ol class="rank">${ranking}</ol>
        <h5>İttifaklar</h5><ul class="allist">${als || '<li class="empty">Henüz ittifak yok. Diplomasi menüsünden bir ülkeye ittifak teklif edebilirsin.</li>'}</ul>
        <h5>Savaşlar</h5><ul class="warlist">${wars || '<li class="empty">Kıtada barış var.</li>'}</ul></div>`;
    }

    htmlShop() {
      const g = this.game, me = g.playerId, P = g.player;
      const GROUPS = [
        { t: 'Ekonomi', keys: ['factory', 'factoryLimit'] },
        { t: 'Savaş', keys: ['blitz', 'plane', 'missile', 'rebellion'] },
        { t: 'Savunma', keys: ['cityDef', 'airDef'] },
      ];
      const row = (it) => {
        const pr = g.price(me, it.key);
        let extra = '', dis = P.money < pr, note = '';
        if (it.key === 'factoryLimit') { note = `Sınır: ${g.factoryLimit(me)} · ${P.limitBuys}/3 alındı`; if (P.limitBuys >= 3) dis = true; }
        if (it.key === 'factory') note = `Şehir başına en fazla ${g.factoryLimit(me)}`;
        if (it.key === 'blitz' && P.blitzUntil > g.time) note = 'Aktif — alırsan süre uzar';
        if (it.key === 'rebellion') {
          const opts = g.countries.filter((c) => c.alive && !c.isRebel && c.id !== me && !g.isAlly(me, c.id)).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
          extra = `<select id="rebelSel">${opts}</select>`;
        }
        const label = it.target && it.target !== 'country' ? 'Şehir Seç' : 'Satın Al';
        return `<li class="item"><div class="it-main"><div class="it-h"><b>${it.name}</b><span class="price">${fmtMoney(pr)}${pr !== G.PRICES[it.key] ? ` <s>${fmtMoney(G.PRICES[it.key])}</s>` : ''}</span></div>
          <p>${it.desc}${note ? ` <small>${note}</small>` : ''}</p>${extra}</div>
          <button class="btn" data-act="buy" data-item="${it.key}" ${dis ? 'disabled' : ''}>${label}</button></li>`;
      };
      const groups = GROUPS.map((gr) => `<h5>${gr.t}</h5><ul class="items">${gr.keys.map((k) => row(SHOP.find((s) => s.key === k))).join('')}</ul>`).join('');
      return `<div class="shop scroll"><div class="wallet">Hazine <b>${this.L(() => fmtMoney(P.money))}</b></div>${groups}</div>`;
    }

    onPanelChange() { /* select değişiklikleri renderPanel'de korunur */ }

    onPanelClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const g = this.game, me = g.playerId;
      const id = b.dataset.id !== undefined ? +b.dataset.id : null;
      const res = (r, okMsg) => { if (r && r.err) this.toast(r.err, 'bad'); else if (okMsg) this.toast(okMsg, 'good'); this.lastHtml = ''; this.renderPanel(); };
      switch (b.dataset.act) {
        case 'dsel': this.diploSel = id; this.lastHtml = ''; this.renderPanel(); break;
        case 'dfocus': {
          const c = g.countries[id];
          if (c && c.capital >= 0 && this.renderer) {
            const k = g.cities[c.capital];
            this.renderer.cam.x = k.x; this.renderer.cam.y = k.y;
            this.renderer.fx.push({ kind: 'capture', x: k.x, y: k.y, t0: performance.now(), dur: 1400 });
            if (this.mode === 'mobile') this.openMenu(null);
          }
          break;
        }
        case 'demand': case 'support': case 'trade': this.openBundleDialog(b.dataset.act, id); break;
        case 'warright': res(g.cmdBuyWarRight(me, id), `Savaş ilan hakkı alındı: 20 sn sonra ${g.countries[id].name} ülkesine savaş ilan edebilirsin.`); break;
        case 'declare': res(g.cmdDeclareWar(me, id)); break;
        case 'peace': res(g.cmdPropose(me, id, 'peace'), 'Barış teklifi gönderildi.'); break;
        case 'callallies': res(g.cmdCallAllies(me, id), 'Müttefiklerine savaş çağrısı gönderildi.'); break;
        case 'surrender': this.surrenderDialog(id); break;
        case 'alliance': res(g.cmdPropose(me, id, 'alliance'), g.countries[id].allianceId !== null ? 'Katılma başvurusu tüm üyelere gönderildi.' : 'İttifak teklifi gönderildi.'); break;
        case 'join': res(g.cmdJoinRequest(me, id), 'Katılma başvurusu tüm üyelere gönderildi.'); break;
        case 'leave': res(g.cmdLeaveAlliance(me), 'İttifaktan ayrıldın.'); break;
        case 'q': res(g.cmdQueueTroops(me, +b.dataset.dir)); break;
        case 'autodist': {
          // Anahtar yerinde değişir (kayarak); panel yeniden çizilmez ki geçiş animasyonu kesilmesin.
          const r = g.cmdSetAutoDist(me);
          b.classList.toggle('on', r.on); b.setAttribute('aria-checked', String(r.on));
          this.liveBuf = []; this.lastHtml = this.htmlMilitary(); this.live = this.liveBuf;
          this.updateLive();
          break;
        }
        case 'up': res(g.cmdUpgrade(me, b.dataset.kind), `${b.dataset.kind === 'atk' ? 'Saldırı' : 'Savunma'} geliştirildi.`); break;
        case 'iup': {
          const r = g.cmdIdeoUpgrade(me, b.dataset.key);
          res(r, r.ok ? `${b.dataset.name} → seviye ${r.level}` : null);
          break;
        }
        case 'mark':
          this.selectUnit(null); this.targeting = null; this.marking = true; this.marked.clear(); this.barKey = '';
          if (this.mode === 'mobile') this.openMenu(null);
          break;
        case 'amode': res(g.cmdArmyMode(me, id, b.dataset.mode)); break;
        case 'adisband': res(g.cmdDisbandArmy(me, id), 'Ordu dağıtıldı.'); break;
        case 'afocus': {
          const u = g.units.find((x) => x.army === id && !x.dead);
          if (u && this.renderer) { const [x, y] = g.unitPos(u); this.renderer.cam.x = x; this.renderer.cam.y = y; }
          break;
        }
        case 'buy': this.buy(b.dataset.item); break;
        case 'cutfocus': {
          const cut = g.cutOffCities(me);
          if (cut.length && this.renderer) {
            this.cutIdx = ((this.cutIdx || 0) + 1) % cut.length;
            const c = cut[this.cutIdx];
            this.renderer.cam.x = c.x; this.renderer.cam.y = c.y;
            if (this.mode === 'mobile') this.openMenu(null);
          }
          break;
        }
      }
    }

    buy(item) {
      const g = this.game, me = g.playerId;
      const pr = g.price(me, item);
      if (g.player.money < pr) { this.toast('Yetersiz para', 'bad'); return; }
      const done = (r, msg) => { if (r.err) this.toast(r.err, 'bad'); else this.toast(msg, 'good'); this.lastHtml = ''; this.renderPanel(); };
      const own = (check) => (cid) => { const c = g.cities[cid]; if (c.owner !== me) return 'Kendi şehrini seçmelisin'; return check ? check(c) : null; };
      const startTarget = (label, valid, pick) => {
        this.selectUnit(null); this.marking = false;
        this.targeting = { label, valid, pick };
        this.barKey = '';
        if (this.mode === 'mobile') this.openMenu(null);
      };
      switch (item) {
        case 'blitz': done(g.cmdBuy(me, 'blitz'), 'Blitzkrieg başladı!'); break;
        case 'factoryLimit': { const r = g.cmdBuy(me, 'factoryLimit'); done(r, `Fabrika sınırı artık ${g.factoryLimit(me)}`); break; }
        case 'cityDef':
          startTarget('Şehir savunması kurulacak kendi şehrini seç', own((c) => (c.cityDef ? 'Bu şehirde zaten savunma var' : null)),
            (cid) => done(g.cmdBuy(me, 'cityDef', { city: cid }), `${g.cities[cid].name} şehrine savunma kuruldu.`));
          break;
        case 'factory':
          startTarget('Fabrika kurulacak kendi şehrini seç', own((c) => (g.factorySlots(c) >= g.factoryLimit(me) ? 'Bu şehir fabrika sınırında' : null)),
            (cid) => done(g.cmdBuy(me, 'factory', { city: cid }), `${g.cities[cid].name} şehrinde fabrika inşa ediliyor (${G.CFG.factoryBuildTime} sn).`));
          break;
        case 'airDef':
          startTarget('Hava koruma kurulacak kendi şehrini seç', own((c) => (c.airDef ? 'Bu şehirde zaten hava koruma var' : null)),
            (cid) => done(g.cmdBuy(me, 'airDef', { city: cid }), `${g.cities[cid].name} şehrine hava koruma kuruldu.`));
          break;
        case 'missile':
          startTarget('Füze hedefi seç (başkent hariç, savaştığın ülke/isyancı)', (cid) => g.missileTargetError(me, cid),
            (cid) => done(g.cmdBuy(me, 'missile', { city: cid }), `Füze ${g.cities[cid].name} şehrine fırlatıldı!`));
          break;
        case 'plane':
          startTarget('Uçak çıkarması için iç şehir seç (sınırda olmayan, başkent değil)', (cid) => g.planeTargetError(me, cid),
            (cid) => this.planeDialog(cid));
          break;
        case 'rebellion': {
          const sel = document.getElementById('rebelSel');
          if (!sel || sel.value === '') { this.toast('Ülke seç', 'bad'); return; }
          done(g.cmdBuy(me, 'rebellion', { country: +sel.value }), 'İsyan ajanları görevde!');
          break;
        }
      }
    }

    planeDialog(cityId) {
      const g = this.game, me = g.playerId, P = g.player;
      const avail = g.troopsAt(P.capital, me);
      const maxK = Math.min(15, Math.floor(avail / 1000));
      if (maxK < 1) { this.toast('Başkentinde çıkarma için yeterli asker yok', 'bad'); return; }
      this.dialog(`Uçak Çıkarması → ${esc(g.cities[cityId].name)}`,
        `<p>Başkentinden (${esc(g.cities[P.capital].name)}, ${fmtK(avail)}) en fazla 15k asker gönderebilirsin.</p>
         <label class="amt">Asker <input type="range" id="planeAmt" min="1" max="${maxK}" value="${maxK}" oninput="document.getElementById('planeVal').textContent=this.value+'k'"> <b id="planeVal">${maxK}k</b></label>`,
        [{ label: `Kalk (${fmtMoney(g.price(me, 'plane'))})`, cls: 'red', fn: () => {
          const k = +document.getElementById('planeAmt').value;
          const r = g.cmdBuy(me, 'plane', { city: cityId, amount: k * 1000 });
          if (r.err) { this.toast(r.err, 'bad'); return false; }
          this.toast(`✈ ${k}k asker ${g.cities[cityId].name} üzerine uçuyor!`, 'good');
          return true;
        } }, { label: 'Vazgeç' }]);
    }

    surrenderDialog(enemy) {
      const g = this.game, me = g.playerId, E = g.countries[enemy];
      const pay = g.surrenderCost(me);
      this.dialog(`🏳︎ ${esc(E.name)} ülkesine teslim ol`,
        `<p>Savaş <b>hemen</b> sona erer, karşı tarafın onayı gerekmez.</p>
         <p>Savaş tazminatı olarak hazinenin yarısını (<b>${fmtMoney(pay)}</b>) ${esc(E.name)} ülkesine ödersin.
         İşgal edilmiş şehirlerin onlarda kalır.</p>`,
        [{ label: 'Teslim Ol', cls: 'red', fn: () => {
          const r = g.cmdSurrender(me, enemy);
          if (r.err) { this.toast(r.err, 'bad'); return false; }
          this.lastHtml = ''; this.renderPanel();
          return true;
        } }, { label: 'Vazgeç' }]);
    }

    // ---- Talep / Destek / Takas: şehirler haritadan tıklanarak seçilir ----
    newBundleState(type, target) {
      const side = () => ({ money: 0, troops: 0, cities: new Set() });
      return { type, target, give: side(), take: side() };
    }
    bundleFields(owner, side, prefix, title) {
      const g = this.game, c = g.countries[owner];
      let idle = 0;
      for (const u of g.units) if (!u.dead && u.owner === owner && !u.move && u.city !== null) idle += u.troops;
      for (const id of [...side.cities]) if (g.cities[id].owner !== owner) side.cities.delete(id); // el değiştirmişse çıkar
      const chips = [...side.cities].map((id) => {
        const ci = g.cities[id];
        return `<span class="rchip pick ${prefix}"><b>${esc(ci.name)}</b> <small>${ci.factories ? ci.factories + ' fab. · ' : ''}${fmtK(g.troopsAt(id, owner))}</small>
          <button class="unpick" data-unpick="${prefix}:${id}" title="Çıkar">×</button></span>`;
      }).join('');
      return `<fieldset><legend><span class="sw" style="background:${c.color}"></span>${esc(title)}</legend>
        <label>Para ₺ <input type="number" min="0" step="1" value="${side.money}" id="${prefix}Money"> <small>/ ${fmtMoney(c.money)}</small></label>
        <label>Asker k <input type="number" min="0" step="1" value="${side.troops / 1000}" id="${prefix}Troops"> <small>/ ${fmtK(idle)}</small></label>
        <div class="cl-h">Şehirler</div>
        <div class="picked">${chips || '<i>Seçilmedi</i>'}</div>
      </fieldset>`;
    }
    readInputs(state) {
      for (const [prefix, key] of [['gv', 'give'], ['tk', 'take']]) {
        const m = document.getElementById(prefix + 'Money'), t = document.getElementById(prefix + 'Troops');
        if (m) state[key].money = Math.max(0, +(m.value || 0));
        if (t) state[key].troops = Math.max(0, Math.round(+(t.value || 0))) * 1000;
      }
    }
    sidePayload(side) { return { money: side.money, troops: side.troops, cities: [...side.cities] }; }

    openBundleDialog(type, target, state) {
      const g = this.game, me = g.playerId, T = g.countries[target];
      state = state || this.newBundleState(type, target);
      let title, body;
      if (type === 'demand') {
        title = `Talep → ${T.name}`;
        body = this.bundleFields(target, state.take, 'tk', 'İstediklerin');
      } else if (type === 'support') {
        title = `Destek → ${T.name}`;
        body = this.bundleFields(me, state.give, 'gv', 'Gönderdiklerin');
      } else {
        title = `Takas → ${T.name}`;
        body = `<div class="two">${this.bundleFields(me, state.give, 'gv', 'Verdiklerin')}${this.bundleFields(target, state.take, 'tk', 'İstediklerin')}</div>`;
      }
      body += `<button class="btn pickbtn" data-pickmap="1">🗺︎ Haritadan şehir seç</button>
        <p class="note">Başkentler hariç.</p>`;
      this.dialog(esc(title), body, [{ label: 'Gönder', cls: 'green', fn: () => {
        this.readInputs(state);
        let payload;
        if (type === 'demand') payload = this.sidePayload(state.take);
        else if (type === 'support') payload = this.sidePayload(state.give);
        else payload = { give: this.sidePayload(state.give), take: this.sidePayload(state.take) };
        const r = g.cmdPropose(me, target, type, payload);
        if (r.err) { this.toast(r.err, 'bad'); return false; }
        this.toast(`${G.PROPOSAL_NAMES[type]} teklifi ${T.name} ülkesine gönderildi.`, 'info');
        return true;
      } }, { label: 'Vazgeç' }], type === 'trade', (e) => {
        const pickBtn = e.target.closest('[data-pickmap]');
        if (pickBtn) { this.readInputs(state); this.closeDialog(); this.startCityPick(state); return true; }
        const un = e.target.closest('[data-unpick]');
        if (un) {
          const [prefix, id] = un.dataset.unpick.split(':');
          this.readInputs(state);
          state[prefix === 'gv' ? 'give' : 'take'].cities.delete(+id);
          this.openBundleDialog(type, target, state);
          return true;
        }
        return false;
      });
    }

    startCityPick(state) {
      const g = this.game, me = g.playerId, T = state.target;
      const snapshot = { give: new Set(state.give.cities), take: new Set(state.take.cities) };
      const isCapital = (cid) => g.countries.some((k) => k.alive && k.capital === cid);
      const sideOf = (cid) => {
        const c = g.cities[cid];
        if (state.type !== 'demand' && c.owner === me) return 'give';
        if (state.type !== 'support' && c.owner === T) return 'take';
        return null;
      };
      const tName = g.countries[T].name;
      const allowed = state.type === 'demand' ? `${tName} şehirleri` : state.type === 'support' ? 'kendi şehirlerin' : `kendi şehirlerin ve ${tName} şehirleri`;
      const menuBefore = this.menu;
      const reopen = () => { if (menuBefore) this.openMenu(menuBefore); this.openBundleDialog(state.type, T, state); };
      this.selectUnit(null); this.marking = false;
      if (this.menu) this.openMenu(null);
      // kamerayı ilgili ülkeye götür
      const focus = state.type === 'support' ? g.player.capital : g.countries[T].capital;
      if (this.renderer && focus >= 0) {
        const a = g.cities[focus];
        if (state.type === 'trade' && g.player.capital >= 0) { const b = g.cities[g.player.capital]; this.renderer.cam.x = (a.x + b.x) / 2; this.renderer.cam.y = (a.y + b.y) / 2; }
        else { this.renderer.cam.x = a.x; this.renderer.cam.y = a.y; }
      }
      this.targeting = {
        multi: true,
        label: `Haritadan şehir seç: ${allowed} (başkent hariç). Tekrar tıklarsan seçim kalkar.`,
        valid: (cid) => {
          if (!sideOf(cid)) return `Sadece ${allowed} seçilebilir`;
          if (isCapital(cid)) return 'Başkentler verilemez/istenemez';
          return null;
        },
        mark: (cid) => (state.give.cities.has(cid) ? 'give' : state.take.cities.has(cid) ? 'take' : null),
        pick: (cid) => { const set = state[sideOf(cid)].cities; if (set.has(cid)) set.delete(cid); else set.add(cid); },
        info: () => {
          const parts = [];
          if (state.type !== 'demand') parts.push(`${state.give.cities.size} verilecek`);
          if (state.type !== 'support') parts.push(`${state.take.cities.size} istenecek`);
          return parts.join(' · ');
        },
        done: () => reopen(),
        onCancel: () => { state.give.cities = snapshot.give; state.take.cities = snapshot.take; reopen(); },
      };
      this.barKey = '';
    }

    dialog(title, body, buttons, wide, extra) {
      const layer = this.$('dialog');
      layer.innerHTML = `<div class="dlg frame ${wide ? 'wide' : ''}"><h3>${title}</h3><div class="dlg-b">${body}</div>
        <div class="dlg-f">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
      layer.classList.remove('hidden');
      document.body.classList.add('dialog-open');
      layer.onclick = (e) => {
        if (extra && extra(e)) return;
        const b = e.target.closest('button[data-i]');
        if (e.target === layer) { this.closeDialog(); return; }
        if (!b) return;
        const def = buttons[+b.dataset.i];
        if (def.fn) { if (def.fn() === false) return; }
        this.closeDialog();
      };
    }
    closeDialog() {
      const l = this.$('dialog'); l.classList.add('hidden'); l.innerHTML = ''; document.body.classList.remove('dialog-open');
      this.paused = false; // oyun menüsü / yardım kapanınca (tek oyunculuda) oyun devam eder
    }
    dialogOpen() { return !this.$('dialog').classList.contains('hidden'); }

    // ---------- oyun menüsü (Esc / ☰) ----------
    openGameMenu() {
      const g = this.game;
      if (this.dialogOpen()) return;
      const sp = !g.mp;
      const body = `<div class="gm">
          ${sp ? '<p class="gm-paused">Oyun duraklatıldı. Zaman akmıyor.</p>' : `<p class="note">Çevrimiçi oyun duraklatılamaz${this.netCode ? ` · Oda <b>${esc(this.netCode)}</b>` : ''}.</p>`}
          <button class="btn big green" data-gm="resume">▶ Devam Et</button>
          <button class="btn" data-gm="sound">${G.Audio && G.Audio.muted ? '🔇 Ses kapalı — aç' : '🔊 Ses açık — kapat'}</button>
          <button class="btn" data-gm="help">📖 Nasıl Oynanır</button>
          <button class="btn red" data-gm="menu">🏠 Ana Menüye Dön</button>
          <p class="gm-info">${esc(g.player.name)} · ${fmtTime(g.time)} · Control-LGS ${G.VERSION_LABEL}</p></div>`;
      this.dialog(sp ? '⏸ Duraklatıldı' : '☰ Oyun Menüsü', body, [], false, (e) => {
        const b = e.target.closest('[data-gm]');
        if (!b) return false;
        const a = b.dataset.gm;
        if (a === 'resume') this.closeDialog();
        else if (a === 'sound') { if (this.onToggleSound) this.onToggleSound(); this.closeDialog(); this.openGameMenu(); }
        else if (a === 'help') { this.closeDialog(); this.openHelp(true); }
        else if (a === 'menu') this.confirmMainMenu();
        return true;
      });
      this.paused = sp;
    }
    openHelp(back) {
      const sp = !this.game.mp;
      this.dialog('📖 Nasıl Oynanır', G.HELP_HTML, back ? [{ label: '◀ Menüye Dön', fn: () => { setTimeout(() => this.openGameMenu(), 0); } }, { label: 'Tamam', cls: 'green' }] : [{ label: 'Tamam', cls: 'green' }], true);
      this.paused = sp;
    }
    confirmMainMenu() {
      const g = this.game;
      const text = !g.mp ? '<p>Oyunun kaydedilir; giriş ekranında <b>Kaldığın Yerden Devam Et</b> ile geri dönebilirsin.</p>'
        : g.mp === 'host' ? '<p><b>Oda senin cihazında çalışıyor.</b> Çıkarsan oyun herkes için biter.</p>'
          : '<p>Odadan çıkarsın; ülkeni bot yönetir. Aynı adla yeniden katılırsan kaldığın yerden devam edersin.</p>';
      this.closeDialog();
      this.dialog('🏠 Ana menüye dön?', text, [{ label: 'Ana Menü', cls: 'red', fn: () => { if (this.onMainMenu) this.onMainMenu(); return false; } }, { label: 'Vazgeç' }]);
      this.paused = !g.mp;
    }

    // ---------- oyun sonu: zafer / yenilgi ----------
    showEnd(win) {
      const g = this.game, me = g.playerId, P = g.player;
      const s = (g.stats && g.stats[me]) || {};
      const el = this.$('endScreen');
      this.closeDialog();
      document.body.classList.remove('end-win', 'end-lose');
      document.body.classList.add(win ? 'end-win' : 'end-lose');
      // Çevrimiçi: oyun diğerleri için sürebilir. Odayı kuran cihaz kapanırsa oyun herkes için biter.
      const live = g.mp && !g.over;
      const note = !live ? '' : g.mp === 'host'
        ? '<p class="note"><b>Oda senin cihazında çalışıyor.</b> Diğer hükümdarlar oynamaya devam ediyor; bu sekmeyi kapatırsan oyun herkes için biter.</p>'
        : '<p class="note">Diğer hükümdarlar oynamaya devam ediyor. İstersen izleyebilirsin.</p>';
      const cityCount = (k) => { let n = 0; for (const c of g.cities) if (c.owner === k) n++; return n; };
      const st = (k) => (g.stats && g.stats[k]) || {};
      const rows = g.countries.filter((c) => !c.isRebel && !c.absent).map((c) => ({ c, n: cityCount(c.id), s: st(c.id) }))
        .sort((a, b) => (b.c.alive - a.c.alive) || (a.c.alive ? b.n - a.n : (b.s.deadAt || 0) - (a.s.deadAt || 0)));
      const rank = rows.map((r, i) => {
        const by = r.s.deadBy !== null && r.s.deadBy !== undefined && g.countries[r.s.deadBy] ? g.countries[r.s.deadBy] : null;
        return `<li class="${r.c.isPlayer ? 'me' : ''} ${r.c.alive ? '' : 'dead'}" style="animation-delay:${1 + i * 0.07}s">
          <span class="rk">${i + 1}</span>${this.seal(r.c, 'sm')}<b>${esc(r.c.name)}</b>
          <small>${r.c.alive ? `${r.n} şehir` : `☠ ${r.s.deadAt !== null && r.s.deadAt !== undefined ? fmtTime(r.s.deadAt) : ''}${by ? ' · ' + esc(by.name) : ''}`}</small></li>`;
      }).join('');
      const killer = s.deadBy !== null && s.deadBy !== undefined && g.countries[s.deadBy] ? g.countries[s.deadBy] : null;
      const sub = win ? `<b>${esc(P.name)}</b>, kıtanın tartışmasız hâkimi oldu! Tarih bu zaferi altın harflerle yazacak.`
        : killer && !killer.isRebel ? `<b>${esc(P.name)}</b>, <b>${esc(killer.name)}</b> karşısında düştü. Başkentini kaybeden devlet çöker.`
          : `<b>${esc(P.name)}</b> tarih sahnesinden silindi. Başkentini kaybeden devlet çöker.`;
      const stat = (label, val, fmt) => `<div class="es"><b data-count="${val}" data-fmt="${fmt || ''}">${fmt === 't' ? fmtTime(val) : '0'}</b><span>${label}</span></div>`;
      const stats = stat('Süre', g.time, 't') + stat('Ele geçirilen şehir', s.captured || 0) + stat('Kaybedilen şehir', s.lost || 0)
        + stat('Yıkılan devlet', s.destroyed || 0) + stat('En çok şehir', s.peakCities || 0) + stat('En büyük ordu', s.peakTroops || 0, 'k');
      const rnd = (a, b) => a + Math.random() * (b - a);
      const fx = win
        ? `<div class="confetti">${Array.from({ length: 60 }, (_, i) => `<i style="left:${rnd(0, 100).toFixed(1)}%;animation-delay:${rnd(0, 4).toFixed(2)}s;animation-duration:${rnd(3.2, 6).toFixed(2)}s;background:${['#e2b84a', '#c4483a', '#f4ead0', '#4d6b2f', '#2f5476'][i % 5]};--r:${Math.round(rnd(360, 1080))}deg;--x:${Math.round(rnd(-60, 60))}px"></i>`).join('')}</div>`
        : `<div class="embers">${Array.from({ length: 34 }, () => `<i style="left:${rnd(0, 100).toFixed(1)}%;animation-delay:${rnd(0, 6).toFixed(2)}s;animation-duration:${rnd(5, 9).toFixed(2)}s;--x:${Math.round(rnd(-80, 80))}px"></i>`).join('')}</div>`;
      el.innerHTML = `${fx}<div class="end frame ${win ? 'win' : 'lose'}">
        <div class="end-emblem">${win ? END_CROWN : END_SHIELD}</div>
        <div class="end-ribbon"><h1>${win ? 'Zafer' : 'Yenilgi'}</h1></div>
        <p class="end-sub">${sub}</p>
        <div class="end-stats">${stats}</div>
        <h5>Son durum</h5><ol class="end-rank">${rank}</ol>${note}
        <div class="end-b">${live ? '<button class="btn big" data-end="watch">👁 İzlemeye Devam Et</button>' : ''}
          <button class="btn big ${win ? 'green' : 'red'}" data-end="menu">${g.mp ? '🏠 Ana Menü' : '⟳ Yeni Oyun'}</button></div></div>`;
      el.classList.remove('hidden');
      // sayılar sıfırdan yukarı sayar
      el.querySelectorAll('[data-count]').forEach((b) => {
        if (b.dataset.fmt === 't') return;
        const target = +b.dataset.count, k = b.dataset.fmt === 'k';
        const t0 = performance.now() + 700;
        const step = (now) => {
          const f = Math.min(1, Math.max(0, (now - t0) / 1200)), e = 1 - Math.pow(1 - f, 3);
          b.textContent = k ? fmtK(Math.round(target * e)) : String(Math.round(target * e));
          if (f < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      el.onclick = (e) => {
        const b = e.target.closest('[data-end]');
        if (!b) return;
        if (b.dataset.end === 'watch') { el.classList.add('hidden'); document.body.classList.remove('end-win', 'end-lose'); return; }
        if (g.mp === 'host' && live && !confirm('Odayı kapatırsan oyun herkes için biter. Emin misin?')) return;
        location.href = location.pathname;
      };
    }
  }

  // zafer tacı ve kırık kalkan amblemleri
  const END_CROWN = `<svg viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#b8892e"/></linearGradient></defs>
    <circle cx="48" cy="50" r="44" fill="#3a2814" stroke="#e2b84a" stroke-width="3"/>
    <path d="M18 64 L22 30 L36 46 L48 22 L60 46 L74 30 L78 64 Z" fill="url(#gGold)" stroke="#6b4a12" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="18" y="63" width="60" height="10" rx="3" fill="#c9962e" stroke="#6b4a12" stroke-width="2.5"/>
    <circle cx="48" cy="22" r="4.5" fill="#c4483a" stroke="#6b4a12" stroke-width="1.5"/><circle cx="22" cy="30" r="3.5" fill="#c4483a" stroke="#6b4a12" stroke-width="1.5"/><circle cx="74" cy="30" r="3.5" fill="#c4483a" stroke="#6b4a12" stroke-width="1.5"/>
    <circle cx="34" cy="68" r="2.4" fill="#2f5476"/><circle cx="48" cy="68" r="2.4" fill="#4d6b2f"/><circle cx="62" cy="68" r="2.4" fill="#2f5476"/></svg>`;
  const END_SHIELD = `<svg viewBox="0 0 96 96" aria-hidden="true">
    <circle cx="48" cy="50" r="44" fill="#2a1d10" stroke="#7c2014" stroke-width="3"/>
    <path d="M48 16 L74 25 V45 C74 62 63 73 48 80 C33 73 22 62 22 45 V25 Z" fill="#6b5a48" stroke="#1b120a" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M48 16 V80" stroke="#4d3f31" stroke-width="2"/>
    <path d="M51 17 L44 33 L54 43 L43 56 L49 79" fill="none" stroke="#120b05" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M30 70 L66 30" stroke="#a3271c" stroke-width="4" stroke-linecap="round" opacity=".85"/></svg>`;

  // Nasıl oynanır (giriş ekranında ve oyun menüsünde)
  G.VERSION_LABEL = 'v1.0';
  G.HELP_HTML = `<div class="help">
    <section><h4>🎯 Amaç</h4><p>Rakip devletlerin <b>başkentlerini</b> ele geçir. Başkenti düşen devlet çöker, kalan şehirleri isyancılara geçer.
      Haritada senden başka yalnızca müttefiklerin kalınca kazanırsın.</p></section>
    <section><h4>🏭 Başlangıç ve ekonomi</h4><p>Önce fabrikalarını kuracağın kendi şehrini seç. Her fabrika <b>15 sn'de 1₺</b> verir, yenisi 6 sn'de kurulur.
      Kendi toprağın üzerinden hiçbir fabrikaya bağlı olmayan şehirlerdeki askerler <b>❗ %50 zayıf ve yavaştır</b>.</p></section>
    <section><h4>⚔ Asker ve savaş</h4><p>Birliğe (haritadaki asker sayısına) dokun, miktarı seç, hedef şehre dokun: kendi şehrine taşır, <b>komşu düşman şehrine saldırır</b>.
      Saldırı sınırda hemen başlar; büyük birlik şehri daha çabuk alır. Bir ülkeye saldırmak için önce Diplomasi'den <b>savaş hakkı</b> alıp (20 sn) savaş ilan et.
      Saldırdığın şehrin çıkış şehri saldırıya uğrarsa birliğin yarısı savunmaya döner.</p></section>
    <section><h4>🤝 Diplomasi</h4><p>Talep, destek ve takas teklif et; ittifak kur ya da bir ittifaka katıl; barış teklif et ya da teslim ol.
      İlişkiler tekliflerin kabul edilme şansını etkiler. Müttefiklerini savaşa çağırabilirsin.</p></section>
    <section><h4>🎖 Askeri yönetim ve mağaza</h4><p>Asker üret (+1k = 1₺), <b>Sınırlara dağıt</b> ile yeni askerleri cepheye yolla, saldırı/savunma geliştir,
      ideolojine özel geliştirmeleri al, ordu kur (ordunun şehrine gelen askerler orduya katılır). Mağazada fabrika, blitzkrieg, uçak, füze, isyan ve savunmalar var.</p></section>
    <section><h4>🌐 Çevrimiçi</h4><p>Giriş ekranında <b>Oda Kur</b> ile 5 harfli bir kod al, arkadaşların kodla katılsın. Harita oyuncu sayısına göre oluşur.
      Oyun odayı kuran cihazda çalışır; o sekme açık kalmalı.</p></section>
    <section><h4>⌨ Kısayollar</h4><p>WASD / oklar: kamera · tekerlek: yakınlaştır · 1–4: menüler · Boşluk: başkente dön · Q / sağ tık: iptal ·
      Esc: oyun menüsü · P: duraklat · M: ses</p></section></div>`;

  G.UI = UI;
})();
