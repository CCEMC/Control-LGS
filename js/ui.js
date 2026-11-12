// Arayüz: üst bilgi çubuğu, 4 menü (Diplomasi, Askeri Yönetim, İttifaklar, Mağaza), diyaloglar, gelen teklifler
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const { esc, fmtK, fmtMoney, fmtTime } = U;

  const SHOP = [
    { key: 'blitz', name: 'Blitzkrieg', desc: '2 dakika boyunca +%35 saldırı gücü.', target: null },
    { key: 'cityDef', name: 'Şehir Savunması', desc: 'Seçtiğin şehirdeki askerler 2 kat güçlü savunma yapar.', target: 'own' },
    { key: 'factory', name: 'Fabrika', desc: 'Seçtiğin şehre fabrika kurar (her 7 sn +1₺). Şehir başına sınır var.', target: 'own' },
    { key: 'factoryLimit', name: 'Fabrika Limitini Arttır', desc: 'Şehir başına fabrika sınırını 1 arttırır. En fazla 3 kez.', target: null },
    { key: 'plane', name: 'Uçak', desc: 'Başkentinden, başkent olmayan bir iç şehre en fazla 15k asker çıkarması.', target: 'plane' },
    { key: 'rebellion', name: 'İsyan Çıkar', desc: 'Seçtiğin ülkenin en az 5k askerli rastgele bir şehri isyan eder.', target: 'country' },
    { key: 'missile', name: 'Füze', desc: 'Başkent dışı bir şehirdeki tüm askerleri ve yapıları yok eder.', target: 'missile' },
    { key: 'airDef', name: 'Hava Koruma', desc: 'Şehre uçak çıkarmasını engeller, füzeleri %15 ihtimalle düşürür.', target: 'own' },
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
      this.setupMode = !opts.resumed && game.phase === 'setup';
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
        this.inbox.push(ev.p.id);
        this.renderInbox();
      } else if (ev.type === 'resolved') {
        if (this.inbox.includes(ev.p.id)) { this.inbox = this.inbox.filter((x) => x !== ev.p.id); this.renderInbox(); }
      } else if (ev.type === 'income') {
        const el = this.$('tbMoneyBox');
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      } else if (ev.type === 'gameover') {
        this.showEnd(ev.win);
      }
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
      if (g.over) return;
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
            <small>Taarruz: sınırdan çıkar, düşman şehirlerini kendiliğinden işgal eder · Savunma: sınır dışına çıkmaz, saldırı olursa karşı taarruz yapar ve kayıp şehirleri geri alır</small>`;
        } else if (key.startsWith('unit')) {
          const maxK = Math.max(1, Math.ceil(sel.troops / 1000));
          bar.innerHTML = `<div class="bar-row"><span>Seçili birlik: <b id="selInfo"></b></span>
            <label class="amt">Taşınacak miktar <input type="range" id="amtRange" min="1" max="${maxK}" step="1" value="${Math.min(this.amountK, maxK)}"> <b id="amtVal"></b></label>${cancelBtn}</div>
            <small>${this.mode === 'pc' ? 'Sol tık' : 'Dokun'}: hedef şehir · kendi/müttefik şehrine = taşı (5 sn) · komşu düşman şehrine = tüm birlikle saldır</small>`;
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
        const info = this.$('selInfo'); if (info) info.textContent = `${fmtK(sel.troops)} · ${g.cities[sel.city].name}`;
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
      this.$('tbIncTxt').textContent = `+${f}₺ / 7 sn`;
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
      if (c.cityDef) struct.push('şehir savunması');
      if (c.airDef) struct.push('hava koruma');
      tip.innerHTML = `<div class="tt-h">${isCap ? '★ ' : ''}${esc(c.name)}</div>
        <div class="tt-o"><span class="sw" style="background:${o.color}"></span>${esc(o.name)}${isCap ? ' · başkent' : ''}${g.isBorderCity(cityId) ? ' · sınır' : ''}</div>
        ${troops}${struct.length ? `<div class="tt-s">${struct.join(' · ')}</div>` : ''}${inc ? `<div class="tt-w">⚔︎ saldırı altında!</div>` : ''}`;
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
        const scroll = body.querySelector('.scroll');
        const st = scroll ? scroll.scrollTop : 0;
        body.innerHTML = html;
        for (const id in keep) { const s = document.getElementById(id); if (s && [...s.options].some((o) => o.value === keep[id])) s.value = keep[id]; }
        const sc2 = body.querySelector('.scroll'); if (sc2) sc2.scrollTop = st;
        this.lastHtml = html;
      }
      this.updateLive();
    }
    updateLive() {
      if (!this.menu) return;
      const body = this.$('panelBody');
      body.querySelectorAll('[data-l]').forEach((el) => { const f = this.live[+el.dataset.l]; if (f) { const v = f(); if (el.textContent !== v) el.textContent = v; } });
      body.querySelectorAll('[data-lw]').forEach((el) => { const f = this.live[+el.dataset.lw]; if (f) el.style.width = f() + '%'; });
    }

    relStatus(a, b) {
      const g = this.game;
      if (g.atWar(a, b)) return { t: 'Savaşta', c: 'war' };
      if (g.isAlly(a, b)) return { t: 'Müttefik', c: 'ally' };
      return { t: 'Barış', c: 'peace' };
    }

    htmlDiplomacy() {
      const g = this.game, me = g.playerId, P = g.player;
      const list = g.countries.filter((c) => !c.isRebel && !c.isPlayer).map((c) => {
        const st = c.alive ? this.relStatus(me, c.id) : { t: 'Yıkıldı', c: 'dead' };
        return `<li data-act="dsel" data-id="${c.id}" class="${this.diploSel === c.id ? 'sel' : ''} ${c.alive ? '' : 'dead'}">
          <span class="sw" style="background:${c.color}"></span><span class="nm">${esc(c.name)}</span><span class="chip ${st.c}">${st.t}</span></li>`;
      }).join('');
      let info = '<div class="empty">Bir ülke seç</div>';
      const t = this.diploSel !== null ? g.countries[this.diploSel] : null;
      if (t) {
        const id = t.id;
        const al = g.allianceOf(id);
        const st = t.alive ? this.relStatus(me, id) : { t: 'Yıkıldı', c: 'dead' };
        const rel = g.rel[me][id];
        const relWord = rel > 40 ? 'Dostane' : rel > 10 ? 'İyi' : rel > -10 ? 'Nötr' : rel > -40 ? 'Gergin' : 'Düşmanca';
        const rels = g.countries.filter((c) => c.alive && !c.isRebel && c.id !== id).map((c) => {
          const s = this.relStatus(id, c.id);
          return `<span class="rchip ${s.c}"><span class="sw" style="background:${c.color}"></span>${esc(c.name)}: ${s.t}</span>`;
        }).join('');
        const war = g.atWar(me, id);
        const ally = g.isAlly(me, id);
        const myAl = g.allianceOf(me);
        const B = (act, label, opts) => {
          opts = opts || {};
          return `<button class="btn ${opts.cls || ''}" data-act="${act}" data-id="${id}" ${opts.dis ? 'disabled' : ''} title="${esc(opts.title || '')}">${label}</button>`;
        };
        let buttons = '';
        if (t.alive) {
          const dis = war || !t.alive;
          buttons += B('demand', 'Talep Et', { dis, title: 'Asker, toprak ve para talep et' });
          buttons += B('support', 'Destek Gönder', { dis, title: 'Asker, toprak ve para gönder' });
          buttons += B('trade', 'Takas', { dis, title: 'Hem ver hem al' });
          // savaş ilan hakkı
          const ws = g.warRightState(me, id);
          if (war) buttons += B('peace', 'Barış Antlaşması İmzala', { cls: 'green', dis: !!g.pendingProposal(me, id, 'peace') });
          else if (ally) buttons += B('warright', 'Savaş İlan Hakkı', { dis: true, title: 'Müttefikine savaş açamazsın' });
          else if (ws.state === 'pending') buttons += `<button class="btn" disabled>Savaş hakkı hazırlanıyor… ${this.L(() => Math.ceil(g.warRightState(me, id).left || 0) + ' sn')}</button>`;
          else if (ws.state === 'ready') buttons += B('declare', '⚔︎ SAVAŞ İLAN ET', { cls: 'red' });
          else buttons += B('warright', `Savaş İlan Hakkı (${fmtMoney(g.price(me, 'warRight'))})`, { dis: P.money < g.price(me, 'warRight'), title: 'Ödedikten 20 sn sonra savaş ilan edebilirsin' });
          // ittifak
          if (myAl) buttons += B('leave', `İttifaktan Ayrıl (${fmtMoney(g.price(me, 'leave'))})`, { dis: P.money < g.price(me, 'leave') });
          else if (al) buttons += B('alliance', `İttifaka Katılma Talebi (${fmtMoney(g.price(me, 'alliance'))})`, { dis: war || P.money < g.price(me, 'alliance'), title: `${al.name} — tüm üyeler onaylamalı` });
          else buttons += B('alliance', `İttifak Talebi (${fmtMoney(g.price(me, 'alliance'))})`, { dis: war || !!g.pendingProposal(me, id, 'alliance') || P.money < g.price(me, 'alliance') });
          if (war) buttons += B('callallies', 'Müttefikleri Savaşa Çağır', { cls: 'red', dis: !myAl });
          if (war) buttons += B('surrender', '🏳︎ Teslim Ol', { cls: 'white', title: 'Savaş hemen biter, hazinenin yarısını tazminat olarak ödersin' });
        }
        info = `<div class="cinfo">
          <h3><span class="sw big" style="background:${t.color}"></span>${esc(t.name)} <small>${t.alive ? esc(g.ideo(id).name) : ''}</small></h3>
          <table class="stats">
            <tr><th>Para</th><td>${this.L(() => fmtMoney(t.money))}</td><th>Fabrika</th><td>${this.L(() => String(g.factoriesOf(id)))}</td></tr>
            <tr><th>Asker</th><td>${this.L(() => fmtK(g.totalTroops(id)))}</td><th>Şehir</th><td>${this.L(() => String(g.citiesOf(id).length))}</td></tr>
            <tr><th>İdeoloji</th><td>${t.alive ? esc(g.ideo(id).name) : '—'}</td><th>İttifak</th><td>${al ? `<span class="sw" style="background:${G.PALETTE[al.colorIdx] ? U.hsl(G.PALETTE[al.colorIdx].h, G.PALETTE[al.colorIdx].s, G.PALETTE[al.colorIdx].l) : ''}"></span>${esc(al.name)}` : '—'}</td></tr>
            <tr><th>Seninle</th><td><span class="chip ${st.c}">${st.t}</span></td><th>İlişki</th><td>${rel > 0 ? '+' : ''}${rel} (${relWord})</td></tr>
          </table>
          <h4>İlişkileri</h4><div class="rels">${rels || '<i>—</i>'}</div>
          <div class="actions">${buttons}</div>
          ${war ? '<p class="note">Savaş sırasında talep, destek ve takas yapılamaz.</p>' : ''}
        </div>`;
      }
      return `<div class="diplo"><ul class="clist scroll">${list}</ul>${info}</div>`;
    }

    htmlMilitary() {
      const g = this.game, me = g.playerId, P = g.player;
      const tp = g.price(me, 'troop'), up = g.price(me, 'upgrade');
      const armies = g.armies.filter((a) => a.owner === me);
      const upRow = (kind, label) => {
        const lvl = kind === 'atk' ? P.atkLvl : P.defLvl;
        const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        return `<li><div class="up-h"><b>${label}</b><span>Seviye ${lvl}/10 · +%${lvl * 5}</span></div><div class="pips">${pips}</div>
          <button class="btn" data-act="up" data-kind="${kind}" ${lvl >= 10 || P.money < up ? 'disabled' : ''}>${lvl >= 10 ? 'Maksimum' : `Geliştir (+%5) · ${fmtMoney(up)}`}</button></li>`;
      };
      const armyList = armies.map((a) => {
        return `<li><div class="ar-h"><b>${esc(a.name)}</b> ${this.L(() => fmtK(g.units.filter((u) => u.army === a.id && !u.dead).reduce((s, u) => s + u.troops, 0)))}</div>
          <div class="seg"><button class="btn sm ${a.mode === 'attack' ? 'red on' : ''}" data-act="amode" data-id="${a.id}" data-mode="attack">Taarruz</button>
          <button class="btn sm ${a.mode === 'defend' ? 'blue on' : ''}" data-act="amode" data-id="${a.id}" data-mode="defend">Savunma</button>
          <button class="btn sm" data-act="afocus" data-id="${a.id}">Göster</button>
          <button class="btn sm" data-act="adisband" data-id="${a.id}">Dağıt</button></div></li>`;
      }).join('');
      return `<div class="mil scroll">
        <div class="mil-top">
          <div class="bigstat"><span>Toplam Asker</span><b>${this.L(() => fmtK(g.totalTroops(me)))}</b></div>
          <div class="target-box">
            <span>Asker Hedefi</span>
            <div class="target-row"><button class="btn round" data-act="q" data-dir="-1" ${P.queue <= 0 ? 'disabled' : ''}>−</button>
              <b class="target">${this.L(() => fmtK(g.totalTroops(me) + P.queue * 1000))}</b>
              <button class="btn round" data-act="q" data-dir="1" ${P.money < tp ? 'disabled' : ''}>+</button></div>
            <div class="prod"><div class="bar">${this.LW(() => (P.queue > 0 ? (P.prodTimer / G.CFG.troopBuildTime) * 100 : 0))}</div>
              <small>${this.L(() => (P.queue > 0 ? `Üretimde: ${P.queue}k · başkentte doğar` : 'Üretim yok'))}</small></div>
          </div>
        </div>
        <p class="note">Her + adımı 1k asker = ${fmtMoney(tp)}. 1k asker ~2 sn'de başkentte üretilir. Hedefi azaltmak para iade etmez.</p>
        <div class="equip">
          <div class="equip-l"><h4>Ekipman Gelişimi</h4><p>Her seviye +%5 güç, ${fmtMoney(up)}. En fazla 10 seviye.</p></div>
          <ul class="equip-r">${upRow('def', 'Savunma Geliştirme')}${upRow('atk', 'Saldırı Geliştirme')}</ul>
        </div>
        <div class="armies">
          <div class="ar-top"><h4>Ordular</h4><button class="btn" data-act="mark">Ordu Kur</button></div>
          <ul>${armyList || '<li class="empty">Henüz ordun yok. "Ordu Kur" ile birliklerini işaretle.</li>'}</ul>
        </div>
        <div class="help">
          <b>Kontroller:</b> Birliğine ${this.mode === 'pc' ? 'tıkla' : 'dokun'}, miktarı seç, sonra hedef şehre ${this.mode === 'pc' ? 'sol tıkla' : 'dokun'}.
          Hareket 5 sn sürer. Saldırıda miktar seçilmez, tüm birlik saldırır. ${this.mode === 'pc' ? 'Q ile iptal.' : ''}
          Güçlü taraf kazanır (kalan = fark); zayıf saldıran 3k'ya düşene kadar kuşatmayı sürdürür.
        </div>
      </div>`;
    }

    htmlAlliances() {
      const g = this.game, me = g.playerId;
      const als = g.alliances.map((al) => {
        const p = G.PALETTE[al.colorIdx];
        const members = al.members.map((m) => `<span class="rchip"><span class="sw" style="background:${g.countries[m].color}"></span>${esc(g.countries[m].name)}</span>`).join('');
        const mine = al.members.includes(me);
        return `<li class="${mine ? 'mine' : ''}"><div class="al-h"><span class="sw big" style="background:${U.hsl(p.h, p.s, p.l)}"></span><b>${esc(al.name)}</b>
          <small>kuruluş ${fmtTime(al.founded)} · ${al.members.length} üye</small>
          ${mine ? `<button class="btn sm" data-act="leave">Ayrıl (${fmtMoney(g.price(me, 'leave'))})</button>` : g.countries[me].allianceId === null ? `<button class="btn sm" data-act="join" data-id="${al.id}">Katılma Talebi (${fmtMoney(g.price(me, 'alliance'))})</button>` : ''}
          </div><div class="rels">${members}</div></li>`;
      }).join('');
      const wars = [...g.wars.values()].map((w) => `<li><span class="sw" style="background:${g.countries[w.a].color}"></span>${esc(g.countries[w.a].name)} <b>⚔︎</b>
        <span class="sw" style="background:${g.countries[w.b].color}"></span>${esc(g.countries[w.b].name)} <small>(${fmtTime(g.time - w.since)})</small></li>`).join('');
      return `<div class="alls scroll"><h4>Aktif İttifaklar</h4><ul class="allist">${als || '<li class="empty">Şu an aktif ittifak yok.</li>'}</ul>
        <h4>Aktif Savaşlar</h4><ul class="warlist">${wars || '<li class="empty">Kıtada barış hüküm sürüyor.</li>'}</ul>
        <p class="note">İttifak üyelerinin toprakları haritada aynı renkte görünür. Yeni üye için tüm üyelerin onayı gerekir.</p></div>`;
    }

    htmlShop() {
      const g = this.game, me = g.playerId, P = g.player;
      const cards = SHOP.map((it) => {
        const pr = g.price(me, it.key);
        let extra = '', dis = P.money < pr, note = '';
        if (it.key === 'factoryLimit') { note = `Mevcut sınır: ${g.factoryLimit(me)} · ${P.limitBuys}/3 alındı`; if (P.limitBuys >= 3) dis = true; }
        if (it.key === 'factory') note = `Şehir başına en fazla ${g.factoryLimit(me)}`;
        if (it.key === 'blitz' && P.blitzUntil > g.time) note = 'Aktif — alırsan süre uzar';
        if (it.key === 'rebellion') {
          const opts = g.countries.filter((c) => c.alive && !c.isRebel && c.id !== me).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
          extra = `<select id="rebelSel">${opts}</select>`;
        }
        return `<div class="card"><div class="card-h"><b>${it.name}</b><span class="price">${fmtMoney(pr)}${pr !== G.PRICES[it.key] ? ` <s>${fmtMoney(G.PRICES[it.key])}</s>` : ''}</span></div>
          <p>${it.desc}</p>${note ? `<small>${note}</small>` : ''}${extra}
          <button class="btn" data-act="buy" data-item="${it.key}" ${dis ? 'disabled' : ''}>${it.target && it.target !== 'country' ? 'Satın Al → Şehir Seç' : 'Satın Al'}</button></div>`;
      }).join('');
      return `<div class="shop scroll"><div class="cards">${cards}</div></div>`;
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
        case 'up': res(g.cmdUpgrade(me, b.dataset.kind), `${b.dataset.kind === 'atk' ? 'Saldırı' : 'Savunma'} geliştirildi.`); break;
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
        case 'factoryLimit': done(g.cmdBuy(me, 'factoryLimit'), `Fabrika sınırı artık ${g.factoryLimit(me) + 1}`); break;
        case 'cityDef':
          startTarget('Şehir savunması kurulacak kendi şehrini seç', own((c) => (c.cityDef ? 'Bu şehirde zaten savunma var' : null)),
            (cid) => done(g.cmdBuy(me, 'cityDef', { city: cid }), `${g.cities[cid].name} şehrine savunma kuruldu.`));
          break;
        case 'factory':
          startTarget('Fabrika kurulacak kendi şehrini seç', own((c) => (c.factories >= g.factoryLimit(me) ? 'Bu şehir fabrika sınırında' : null)),
            (cid) => done(g.cmdBuy(me, 'factory', { city: cid }), `${g.cities[cid].name} şehrine fabrika kuruldu.`));
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
        <label>Para (₺) <input type="number" min="0" step="1" value="${side.money}" id="${prefix}Money"> <small>mevcut ${fmtMoney(c.money)}</small></label>
        <label>Asker (k) <input type="number" min="0" step="1" value="${side.troops / 1000}" id="${prefix}Troops"> <small>boşta ${fmtK(idle)}</small></label>
        <div class="cl-h">Toprak (şehirler)</div>
        <div class="picked">${chips || '<i>Şehir seçilmedi — aşağıdaki butonla haritadan seç</i>'}</div>
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
      let title, body, pickHint;
      if (type === 'demand') {
        title = `Talep Et → ${T.name}`;
        body = this.bundleFields(target, state.take, 'tk', `${T.name} ülkesinden istediklerin`);
        pickHint = `${T.name} şehirlerine tıkla`;
      } else if (type === 'support') {
        title = `Destek Gönder → ${T.name}`;
        body = this.bundleFields(me, state.give, 'gv', 'Göndereceklerin');
        pickHint = 'kendi şehirlerine tıkla';
      } else {
        title = `Takas → ${T.name}`;
        body = `<div class="two">${this.bundleFields(me, state.give, 'gv', 'Vereceklerin')}${this.bundleFields(target, state.take, 'tk', 'İsteklerin')}</div>`;
        pickHint = `kendi şehrin = vereceğin, ${T.name} şehri = isteğin`;
      }
      body += `<button class="btn pickbtn" data-pickmap="1">🗺︎ Haritadan Şehir Seç <small>(${esc(pickHint)})</small></button>
        <p class="note">Başkentler verilemez/istenemez. Teklif karşı tarafın ekranında ileti olarak görünür.</p>`;
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
    closeDialog() { const l = this.$('dialog'); l.classList.add('hidden'); l.innerHTML = ''; document.body.classList.remove('dialog-open'); }
    dialogOpen() { return !this.$('dialog').classList.contains('hidden'); }

    showEnd(win) {
      const g = this.game;
      const el = this.$('endScreen');
      el.classList.remove('hidden');
      el.innerHTML = `<div class="end frame"><h1>${win ? 'ZAFER' : 'YENİLGİ'}</h1>
        <p>${win ? `${esc(g.player.name)}, kıtanın tartışmasız hâkimi oldu!` : `${esc(g.player.name)} tarih sahnesinden silindi. Başkentini kaybeden devlet çöker.`}</p>
        <p>Süre: ${fmtTime(g.time)}</p>
        <button class="btn big" onclick="location.reload()">Yeniden Başla</button></div>`;
    }
  }

  G.UI = UI;
})();
