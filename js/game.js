// Oyun motoru — DOM'dan bağımsız. Tüm eylemler cmd* komutlarıyla gelir (insan, bot ya da ileride ağ).
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  const CFG = {
    incomeInterval: 7, troopBuildTime: 2, moveTime: 5, retreatTime: 2.5, warRightDelay: 20,
    blitzDuration: 120, blitzBonus: 0.35, baseFactoryLimit: 3, maxLimitBuys: 3, maxUpgrade: 10,
    upgradeStep: 0.05, minAttackRemain: 3000, planeMax: 15000, planeTime: 4, missileTime: 3,
    rebellionMin: 5000, missileIntercept: 0.15, startMoney: 10, proposalTimeout: 30, REBEL: 9,
    // Saldırı artık yavaş: düşman şehrine yürüyüş uzun sürer, muharebe de saniyelerce sürer.
    attackTime: 12, battleMin: 9, battleMax: 45, battleSpeed: 1800, siegeEmpty: 4,
  };

  const IDEO = {
    komunizm: { key: 'komunizm', name: 'Komünizm', troops: 90000, price: 0.9, atk: 1, def: 1, war: 1, factories: 2, rebelAtk: 1.05,
      perks: ['%10 daha ucuz fiyatlar', 'İsyancılara karşı +%5 saldırı', '90k asker ile başlar'] },
    demokrasi: { key: 'demokrasi', name: 'Demokrasi', troops: 75000, price: 1, atk: 1, def: 1.2, war: 0.5, factories: 2, rebelAtk: 1,
      perks: ['+%20 savunma', 'Savaş ilan hakkı %50 daha ucuz', '75k asker ile başlar'] },
    monarsi: { key: 'monarsi', name: 'Monarşi', troops: 85000, price: 1, atk: 1.1, def: 1, war: 1, factories: 3, rebelAtk: 1,
      perks: ['+%10 saldırı', '3 fabrika ile başlar', '85k asker ile başlar'] },
  };

  const PRICES = { warRight: 5, alliance: 5, leave: 5, upgrade: 5, troop: 1, blitz: 5, cityDef: 5, factory: 12, factoryLimit: 5,
    plane: 10, rebellion: 40, missile: 35, airDef: 20 };

  const PALETTE = [
    { h: 8, s: 55, l: 56 }, { h: 32, s: 66, l: 57 }, { h: 50, s: 62, l: 58 }, { h: 95, s: 34, l: 50 }, { h: 170, s: 34, l: 46 },
    { h: 212, s: 42, l: 56 }, { h: 262, s: 30, l: 60 }, { h: 320, s: 32, l: 56 }, { h: 26, s: 32, l: 40 }, { h: 30, s: 6, l: 38 },
  ];

  const ALLIANCE_NAMES = ['Kuzey Paktı', 'Demir Birlik', 'Altın Yemin', 'Taç Birliği', 'Kartal Paktı', 'Şafak Konfederasyonu',
    'Gümüş Sancak', 'Yedi Kale Birliği', 'Mavi Bayrak Paktı', 'Kızıl Mühür'];

  const PROPOSAL_NAMES = { demand: 'Talep', support: 'Destek', trade: 'Takas', alliance: 'İttifak', join: 'İttifaka Katılma',
    peace: 'Barış Antlaşması', callToWar: 'Savaşa Çağrı' };

  class Game {
    constructor(opts) {
      this.seed = opts.seed || Math.floor(Math.random() * 1e9);
      this.rnd = U.mulberry32(this.seed ^ 0x5bd1e995);
      this.map = G.MapGen.generate(this.seed);
      this.time = 0;
      this.phase = 'setup';
      this.version = 1; // sahiplik/ittifak değiştikçe artar (çizim önbelleği için)
      this.listeners = [];
      this.nextId = 1;
      this.units = [];
      this.wars = new Map();
      this.alliances = [];
      this.proposals = [];
      this.joinGroups = {};
      this.armies = [];
      this.projectiles = [];
      this.armyTimer = 0;
      this.over = false;

      this.cities = this.map.cities.map((c) => ({
        id: c.id, name: c.name, x: c.x, y: c.y, neighbors: c.neighbors, coastal: c.coastal,
        owner: this.map.owner[c.id], origOwner: this.map.owner[c.id], factories: 0, cityDef: false, airDef: false,
      }));

      const playerId = Math.floor(this.rnd() * 9);
      this.playerId = playerId;
      const ideoKeys = Object.keys(IDEO);
      this.countries = [];
      for (let k = 0; k < 10; k++) {
        const isRebel = k === CFG.REBEL;
        const pal = PALETTE[k];
        this.countries.push({
          id: k,
          name: isRebel ? 'İsyancılar' : k === playerId ? opts.playerName : this.map.countryNames[k],
          isPlayer: k === playerId, isBot: k !== playerId && !isRebel, isRebel,
          pal, color: U.hsl(pal.h, pal.s, pal.l), dark: U.hsl(pal.h, Math.min(80, pal.s + 10), Math.max(14, pal.l - 30)),
          light: U.hsl(pal.h, pal.s, Math.min(90, pal.l + 18)),
          ideology: isRebel ? null : k === playerId ? opts.ideology : ideoKeys[Math.floor(this.rnd() * 3)],
          alive: !isRebel, money: isRebel ? 0 : CFG.startMoney, incomeTimer: 0, limitBuys: 0, atkLvl: 0, defLvl: 0, blitzUntil: 0,
          capital: isRebel ? -1 : this.map.capitals[k], queue: 0, prodTimer: 0, warRights: {}, allianceId: null,
          setupDone: false, bot: { eco: 1 + this.rnd() * 2, mil: 1 + this.rnd(), dip: 4 + this.rnd() * 4 },
        });
      }
      this.rel = [];
      for (let a = 0; a < 10; a++) { this.rel.push(new Array(10).fill(0)); }
      for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) { const v = Math.round((this.rnd() - 0.5) * 30); this.rel[a][b] = this.rel[b][a] = v; }

      // Başlangıç askerleri: sınır şehirleri + başkent eşit
      for (let k = 0; k < 9; k++) this.distributeStartTroops(k);
      // Botlar fabrika şehrini seçer
      for (let k = 0; k < 9; k++) {
        if (!this.countries[k].isBot) continue;
        const mine = this.citiesOf(k);
        const interior = mine.filter((c) => !this.isBorderCity(c.id));
        const pick = interior.length ? interior[Math.floor(this.rnd() * interior.length)] : this.cities[this.countries[k].capital];
        this.cmdStartFactories(k, pick.id);
      }
    }

    // ---------- olaylar ----------
    on(fn) { this.listeners.push(fn); }
    emit(ev) { for (const fn of this.listeners) fn(ev); }
    say(to, text, kind) { this.emit({ type: 'toast', to: to === null ? null : [].concat(to), text, kind: kind || 'info' }); }

    // ---------- sorgular ----------
    get player() { return this.countries[this.playerId]; }
    ideo(cid) { return IDEO[this.countries[cid].ideology] || IDEO.demokrasi; }
    isRebel(cid) { return cid === CFG.REBEL; }
    citiesOf(cid) { return this.cities.filter((c) => c.owner === cid); }
    allianceOf(cid) { const a = this.countries[cid].allianceId; return a === null ? null : this.alliances.find((x) => x.id === a) || null; }
    isAlly(a, b) {
      if (a === b) return true;
      const ca = this.countries[a], cb = this.countries[b];
      return ca.allianceId !== null && ca.allianceId === cb.allianceId;
    }
    friendly(a, b) { return this.isAlly(a, b); }
    warKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
    atWar(a, b) { return this.wars.has(this.warKey(a, b)); }
    hostile(a, b) { return a !== b && (this.isRebel(a) || this.isRebel(b) || this.atWar(a, b)); }
    enemiesOf(cid) { const r = []; for (const w of this.wars.values()) { if (w.a === cid) r.push(w.b); else if (w.b === cid) r.push(w.a); } return r; }
    isBorderCity(cityId) { const c = this.cities[cityId]; return c.neighbors.some((n) => this.cities[n].owner !== c.owner); }
    neighborsOfCountry(cid) {
      const s = new Set();
      for (const c of this.cities) if (c.owner === cid) for (const n of c.neighbors) { const o = this.cities[n].owner; if (o !== cid) s.add(o); }
      return [...s];
    }
    factoryLimit(cid) { return CFG.baseFactoryLimit + this.countries[cid].limitBuys; }
    factoriesOf(cid) { let s = 0; for (const c of this.cities) if (c.owner === cid) s += c.factories; return s; }
    totalTroops(cid) { let s = 0; for (const u of this.units) if (!u.dead && u.owner === cid) s += u.troops; return s; }
    idleUnitsAt(cityId) { return this.units.filter((u) => !u.dead && u.city === cityId && !u.move); }
    troopsAt(cityId, owner) { let s = 0; for (const u of this.units) if (!u.dead && u.city === cityId && !u.move && (owner === undefined || u.owner === owner)) s += u.troops; return s; }
    price(cid, key) {
      const id = this.ideo(cid);
      let p = PRICES[key] * id.price;
      if (key === 'warRight') p *= id.war;
      return Math.round(p * 100) / 100;
    }
    atkMult(cid, targetOwner) {
      const c = this.countries[cid];
      if (c.isRebel) return 1;
      let m = (1 + c.atkLvl * CFG.upgradeStep) * this.ideo(cid).atk;
      if (this.time < c.blitzUntil) m *= 1 + CFG.blitzBonus;
      if (this.isRebel(targetOwner)) m *= this.ideo(cid).rebelAtk;
      return m;
    }
    defMult(cid, city) {
      const c = this.countries[cid];
      let m = c.isRebel ? 1 : (1 + c.defLvl * CFG.upgradeStep) * this.ideo(cid).def;
      if (city && city.cityDef) m *= 2;
      return m;
    }
    power(cid) {
      const c = this.countries[cid];
      if (!c.alive) return 0;
      const m = ((1 + c.atkLvl * 0.05) * this.ideo(cid).atk + (1 + c.defLvl * 0.05) * this.ideo(cid).def) / 2;
      return (this.totalTroops(cid) + c.queue * 1000) * m + c.money * 600;
    }
    addRel(a, b, d) { if (a >= 9 || b >= 9) return; const v = U.clamp(this.rel[a][b] + d, -100, 100); this.rel[a][b] = this.rel[b][a] = v; }
    cityColorIdx(city) {
      if (this.isRebel(city.owner)) return CFG.REBEL;
      const al = this.allianceOf(city.owner);
      return al ? al.colorIdx : city.owner;
    }
    warRightState(a, b) {
      const t = this.countries[a].warRights[b];
      if (t === undefined) return { state: 'none' };
      if (this.time >= t) return { state: 'ready' };
      return { state: 'pending', left: t - this.time };
    }
    pendingProposal(from, to, type) { return this.proposals.find((p) => p.from === from && p.to === to && p.type === type); }

    // ---------- birimler ----------
    newUnit(owner, cityId, troops, army) {
      const u = { id: this.nextId++, owner, city: cityId, troops, army: army === undefined ? null : army, move: null, dead: false };
      this.units.push(u);
      return u;
    }
    addTroops(owner, cityId, troops, army) {
      army = army === undefined ? null : army;
      const u = this.units.find((x) => !x.dead && x.city === cityId && !x.move && x.owner === owner && x.army === army);
      if (u) { u.troops += troops; return u; }
      return this.newUnit(owner, cityId, troops, army);
    }
    mergeCity(cityId) {
      const seen = new Map();
      for (const u of this.units) {
        if (u.dead || u.city !== cityId || u.move) continue;
        const k = u.owner + ':' + u.army;
        const prev = seen.get(k);
        if (prev) { prev.troops += u.troops; u.dead = true; } else seen.set(k, u);
      }
    }
    placeUnit(u, cityId) { u.move = null; u.city = cityId; this.mergeCity(cityId); }
    sendHome(u) {
      const c = this.countries[u.owner];
      if (!c.alive || c.capital < 0 || this.cities[c.capital].owner !== u.owner) { u.dead = true; return; }
      this.placeUnit(u, c.capital);
    }
    findPath(from, to, cid) {
      if (from === to) return [from];
      const prev = new Map([[from, -1]]);
      const q = [from];
      while (q.length) {
        const a = q.shift();
        for (const b of this.cities[a].neighbors) {
          if (prev.has(b)) continue;
          if (!this.friendly(cid, this.cities[b].owner)) continue;
          prev.set(b, a);
          if (b === to) {
            const path = [b];
            let x = a;
            while (x !== -1) { path.push(x); x = prev.get(x); }
            return path.reverse();
          }
          q.push(b);
        }
      }
      return null;
    }
    unitPos(u) {
      if (!u.move) { const c = this.cities[u.city]; return [c.x, c.y]; }
      const m = u.move;
      if (m.kind === 'battle') {
        const a = this.cities[m.from], b = this.cities[m.to];
        return [a.x + (b.x - a.x) * 0.62, a.y + (b.y - a.y) * 0.62];
      }
      const t = U.clamp((this.time - m.t0) / (m.t1 - m.t0), 0, 1);
      const pts = m.path.map((id) => [this.cities[id].x, this.cities[id].y]);
      if (pts.length === 1) return pts[0];
      let total = 0;
      const seg = [];
      for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); total += l; }
      let d = t * total;
      for (let i = 0; i < seg.length; i++) {
        if (d <= seg[i] || i === seg.length - 1) {
          const f = seg[i] ? Math.min(1, d / seg[i]) : 1;
          return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
        }
        d -= seg[i];
      }
      return pts[pts.length - 1];
    }

    distributeStartTroops(k) {
      const c = this.countries[k];
      const total = this.ideo(k).troops;
      const set = new Set([c.capital]);
      for (const city of this.citiesOf(k)) if (this.isBorderCity(city.id)) set.add(city.id);
      const ids = [...set];
      const per = Math.floor(total / ids.length / 1000) * 1000;
      let left = total;
      for (const id of ids) { if (id === c.capital) continue; this.addTroops(k, id, per); left -= per; }
      this.addTroops(k, c.capital, left);
    }

    // ---------- komutlar ----------
    cmdStartFactories(cid, cityId) {
      const c = this.countries[cid];
      if (c.setupDone) return { err: 'Fabrikalar zaten yerleştirildi' };
      const city = this.cities[cityId];
      if (!city || city.owner !== cid) return { err: 'Kendi şehrini seçmelisin' };
      city.factories += this.ideo(cid).factories;
      c.setupDone = true;
      if (c.isPlayer) {
        this.phase = 'play';
        this.say(cid, `${this.ideo(cid).factories} fabrika ${city.name} şehrine kuruldu. Oyun başladı!`, 'good');
      }
      return { ok: true };
    }

    pay(cid, amount) {
      const c = this.countries[cid];
      if (c.money + 1e-9 < amount) return false;
      c.money = Math.round((c.money - amount) * 100) / 100;
      return true;
    }

    cmdQueueTroops(cid, dir) {
      const c = this.countries[cid];
      if (dir > 0) {
        const p = this.price(cid, 'troop');
        if (!this.pay(cid, p)) return { err: 'Yetersiz para' };
        c.queue++;
      } else {
        if (c.queue <= 0) return { err: 'Kuyrukta asker yok' };
        c.queue--;
        if (c.queue === 0) c.prodTimer = 0;
      }
      return { ok: true };
    }

    cmdUpgrade(cid, kind) {
      const c = this.countries[cid];
      const key = kind === 'atk' ? 'atkLvl' : 'defLvl';
      if (c[key] >= CFG.maxUpgrade) return { err: 'Maksimum seviye' };
      if (!this.pay(cid, this.price(cid, 'upgrade'))) return { err: 'Yetersiz para' };
      c[key]++;
      return { ok: true };
    }

    cmdMove(cid, unitId, toCity, amount) {
      const u = this.units.find((x) => x.id === unitId && !x.dead);
      if (!u || u.owner !== cid) return { err: 'Birlik bulunamadı' };
      if (u.move || u.city === null) {
        const m = u.move;
        const fighting = m && (m.kind === 'attack' || m.kind === 'battle');
        return { err: fighting ? 'Saldırıdaki birlik savaş bitene kadar hareket ettirilemez' : 'Birlik şu an hareket halinde', locked: true };
      }
      const from = u.city;
      if (from === toCity) return { err: 'Aynı şehir' };
      // saldırı altındaki şehirdeki askerler şehri terk edemez: savunmak zorundadır
      if (this.isUnderAttack(from)) return { err: `${this.cities[from].name} saldırı altında — askerler şehri terk edemez`, locked: true };
      const tc = this.cities[toCity];
      if (this.friendly(cid, tc.owner)) {
        const path = this.findPath(from, toCity, cid);
        if (!path) return { err: 'Bu şehre kendi/müttefik topraklarından yol yok' };
        amount = amount === undefined ? u.troops : Math.round(amount);
        amount = U.clamp(amount, 1, u.troops);
        let mover = u;
        if (amount < u.troops) { u.troops -= amount; mover = this.newUnit(cid, null, amount, u.army); }
        mover.city = null;
        mover.move = { kind: 'move', from, to: toCity, path, t0: this.time, t1: this.time + CFG.moveTime };
        this.emit({ type: 'sound', name: 'march', cid });
        return { ok: true, unit: mover };
      }
      if (this.hostile(cid, tc.owner)) {
        if (!this.cities[from].neighbors.includes(toCity)) return { err: 'Sadece komşu şehirlere saldırabilirsin' };
        // seçilen miktar kadar asker saldırıya çıkar, geri kalanı şehirde kalır
        let atk = u;
        if (amount !== undefined && Math.round(amount) < u.troops) {
          const part = U.clamp(Math.round(amount), 1, u.troops);
          u.troops -= part; atk = this.newUnit(cid, null, part, u.army);
        }
        atk.city = null;
        atk.move = { kind: 'attack', from, to: toCity, path: [from, toCity], t0: this.time, t1: this.time + CFG.attackTime };
        if (!this.isRebel(tc.owner)) this.say(tc.owner, `${this.countries[cid].name} ${U.fmtK(atk.troops)} askerle ${tc.name} şehrine saldırıyor!`, 'bad');
        this.emit({ type: 'sound', name: 'attackLaunch', cid, target: tc.owner });
        return { ok: true, unit: atk };
      }
      return { err: `${this.countries[tc.owner].name} ile savaşta değilsin` };
    }

    cmdBuyWarRight(cid, target) {
      if (target === cid || this.isRebel(target)) return { err: 'Geçersiz hedef' };
      const t = this.countries[target];
      if (!t.alive) return { err: 'Bu ülke yıkıldı' };
      if (this.isAlly(cid, target)) return { err: 'Müttefikine savaş açamazsın' };
      if (this.atWar(cid, target)) return { err: 'Zaten savaştasınız' };
      if (this.countries[cid].warRights[target] !== undefined) return { err: 'Hak zaten alındı' };
      if (!this.pay(cid, this.price(cid, 'warRight'))) return { err: 'Yetersiz para' };
      this.countries[cid].warRights[target] = this.time + CFG.warRightDelay;
      this.addRel(cid, target, -15);
      this.say(target, `⚠ ${this.countries[cid].name}, sana karşı savaş ilan hakkı satın aldı! (20 sn)`, 'bad');
      return { ok: true };
    }

    cmdDeclareWar(cid, target) {
      const st = this.warRightState(cid, target);
      if (st.state !== 'ready') return { err: 'Savaş ilan hakkın hazır değil' };
      if (this.isAlly(cid, target)) return { err: 'Müttefikine savaş açamazsın' };
      delete this.countries[cid].warRights[target];
      this.startWar(cid, target);
      return { ok: true };
    }

    startWar(a, b, joined) {
      if (this.atWar(a, b)) return;
      this.wars.set(this.warKey(a, b), { a, b, since: this.time });
      delete this.countries[a].warRights[b];
      delete this.countries[b].warRights[a];
      this.addRel(a, b, -60);
      this.emit({ type: 'sound', name: 'warDeclared', cid: a, target: b });
      this.proposals = this.proposals.filter((p) => !((p.from === a && p.to === b) || (p.from === b && p.to === a)) || p.type === 'peace');
      const A = this.countries[a].name, B = this.countries[b].name;
      this.say(null, joined ? `⚔ ${A}, müttefikinin çağrısıyla ${B} ile savaşa girdi!` : `⚔ ${A}, ${B} ülkesine SAVAŞ İLAN ETTİ!`, 'war');
      this.version++;
    }

    endWar(a, b, silent) {
      if (!this.wars.delete(this.warKey(a, b))) return;
      this.addRel(a, b, 20);
      // devam eden saldırılar geri çekilir
      for (const u of this.units) {
        if (u.dead || !u.move || (u.move.kind !== 'attack' && u.move.kind !== 'battle')) continue;
        const tgt = this.cities[u.move.to].owner;
        if ((u.owner === a && tgt === b) || (u.owner === b && tgt === a)) this.retreat(u);
      }
      if (!silent) this.say(null, `🕊 ${this.countries[a].name} ile ${this.countries[b].name} barış imzaladı.`, 'good');
      this.emit({ type: 'sound', name: 'peace', cid: a, target: b });
      this.version++;
    }

    // Teslim ol: savaş onay beklemeden hemen biter, hazinenin yarısı savaş tazminatı olarak karşı tarafa gider.
    // İşgal edilmiş şehirler işgalcide kalır.
    surrenderCost(cid) { return Math.floor(this.countries[cid].money * 0.5 * 10) / 10; }
    cmdSurrender(cid, enemy) {
      if (!this.atWar(cid, enemy)) return { err: 'Bu ülkeyle savaşta değilsin' };
      const c = this.countries[cid], e = this.countries[enemy];
      const pay = this.surrenderCost(cid);
      c.money = Math.round((c.money - pay) * 100) / 100;
      e.money = Math.round((e.money + pay) * 100) / 100;
      this.proposals = this.proposals.filter((p) => !(p.type === 'peace' && ((p.from === cid && p.to === enemy) || (p.from === enemy && p.to === cid))));
      this.say(null, `🏳 ${c.name}, ${e.name} ülkesine TESLİM OLDU! (savaş tazminatı: ${U.fmtMoney(pay)})`, 'war');
      this.endWar(cid, enemy, true);
      this.addRel(cid, enemy, -10);
      return { ok: true, paid: pay };
    }

    cmdLeaveAlliance(cid) {
      const al = this.allianceOf(cid);
      if (!al) return { err: 'Bir ittifakta değilsin' };
      if (!this.pay(cid, this.price(cid, 'leave'))) return { err: 'Yetersiz para' };
      this.removeFromAlliance(cid);
      return { ok: true };
    }

    removeFromAlliance(cid, silent) {
      const al = this.allianceOf(cid);
      if (!al) return;
      const former = al.members.filter((m) => m !== cid);
      al.members = former;
      this.countries[cid].allianceId = null;
      if (!silent) this.say(former.concat(cid), `${this.countries[cid].name}, ${al.name} ittifakından ayrıldı.`, 'info');
      if (al.members.length <= 1) {
        for (const m of al.members) this.countries[m].allianceId = null;
        this.alliances = this.alliances.filter((x) => x !== al);
        if (!silent) this.say(null, `${al.name} dağıldı.`, 'info');
      }
      // eski müttefik topraklarındaki birlikler eve döner
      for (const u of this.units) {
        if (u.dead) continue;
        if (u.city !== null && !u.move && !this.friendly(u.owner, this.cities[u.city].owner)) this.sendHome(u);
      }
      this.version++;
    }

    validateBundle(giver, b) {
      if (!b) return null;
      const c = this.countries[giver];
      if ((b.money || 0) < 0 || (b.troops || 0) < 0) return 'Geçersiz miktar';
      if ((b.money || 0) > c.money + 1e-9) return `${c.name} yeterli paraya sahip değil`;
      if ((b.troops || 0) > 0) {
        let idle = 0;
        for (const u of this.units) if (!u.dead && u.owner === giver && !u.move && u.city !== null) idle += u.troops;
        if (b.troops > idle) return `${c.name} yeterli boşta askere sahip değil`;
      }
      for (const id of b.cities || []) {
        const city = this.cities[id];
        if (!city || city.owner !== giver) return 'Şehir artık o ülkeye ait değil';
        if (id === c.capital) return 'Başkent verilemez';
      }
      return null;
    }
    bundleEmpty(b) { return !b || (!(b.money > 0) && !(b.troops > 0) && !(b.cities && b.cities.length)); }
    bundleText(b) {
      if (this.bundleEmpty(b)) return 'hiçbir şey';
      const parts = [];
      if (b.money > 0) parts.push(U.fmtMoney(b.money));
      if (b.troops > 0) parts.push(U.fmtK(b.troops) + ' asker');
      if (b.cities && b.cities.length) parts.push(b.cities.map((id) => this.cities[id].name).join(', ') + (b.cities.length > 1 ? ' şehirleri' : ' şehri'));
      return parts.join(' + ');
    }
    bundleValue(b) {
      if (!b) return 0;
      let v = (b.money || 0) + (b.troops || 0) / 1000;
      for (const id of b.cities || []) { const c = this.cities[id]; v += 8 + c.factories * 12 + this.troopsAt(id, c.owner) / 1000; }
      return v;
    }
    transferBundle(giver, receiver, b) {
      if (this.bundleEmpty(b)) return;
      const gc = this.countries[giver], rc = this.countries[receiver];
      if (b.money > 0) { gc.money = Math.round((gc.money - b.money) * 100) / 100; rc.money = Math.round((rc.money + b.money) * 100) / 100; }
      if (b.troops > 0) {
        let need = b.troops;
        const pool = this.units.filter((u) => !u.dead && u.owner === giver && !u.move && u.city !== null)
          .sort((x, y) => (y.city === gc.capital) - (x.city === gc.capital) || y.troops - x.troops);
        for (const u of pool) {
          if (need <= 0) break;
          const t = Math.min(u.troops, need);
          u.troops -= t; need -= t;
          if (u.troops <= 0) u.dead = true;
        }
        this.addTroops(receiver, rc.capital, b.troops);
      }
      for (const id of b.cities || []) this.capture(this.cities[id], receiver, true);
    }

    cmdPropose(cid, to, type, payload) {
      payload = payload || {};
      const me = this.countries[cid], them = this.countries[to];
      if (!them || to === cid || them.isRebel || !them.alive) return { err: 'Geçersiz hedef' };
      if (type !== 'join' && type !== 'callToWar' && this.pendingProposal(cid, to, type)) return { err: 'Bu teklif zaten beklemede' };
      const war = this.atWar(cid, to);
      if (type === 'demand' || type === 'support' || type === 'trade') {
        if (war) return { err: 'Savaş sırasında bu eylem yapılamaz' };
        const give = type === 'support' ? payload : type === 'trade' ? payload.give : null;
        const take = type === 'demand' ? payload : type === 'trade' ? payload.take : null;
        if (this.bundleEmpty(give) && this.bundleEmpty(take)) return { err: 'Bir şey seçmelisin' };
        const e1 = this.validateBundle(cid, give); if (e1) return { err: e1 };
        const e2 = this.validateBundle(to, take); if (e2) return { err: e2 };
      } else if (type === 'alliance') {
        if (war) return { err: 'Savaştığın ülkeyle ittifak kuramazsın' };
        if (me.allianceId !== null) return { err: 'Zaten bir ittifaktasın' };
        if (them.allianceId !== null) return this.cmdJoinRequest(cid, them.allianceId);
        if (!this.pay(cid, this.price(cid, 'alliance'))) return { err: 'Yetersiz para' };
      } else if (type === 'peace') {
        if (!war) return { err: 'Savaşta değilsiniz' };
      } else if (type === 'callToWar') {
        return this.cmdCallAllies(cid, to);
      } else return { err: 'Bilinmeyen eylem' };
      const p = this.makeProposal(cid, to, type, payload);
      return { ok: true, proposal: p };
    }

    makeProposal(from, to, type, payload, group) {
      const p = { id: this.nextId++, from, to, type, payload, group: group || null, created: this.time,
        expires: this.time + CFG.proposalTimeout, decideAt: this.time + 1.2 + this.rnd() * 2.2 };
      this.proposals.push(p);
      if (this.countries[to].isPlayer) this.emit({ type: 'proposal', p });
      return p;
    }

    cmdJoinRequest(cid, allianceId) {
      const al = this.alliances.find((a) => a.id === allianceId);
      if (!al) return { err: 'İttifak bulunamadı' };
      if (this.countries[cid].allianceId !== null) return { err: 'Zaten bir ittifaktasın' };
      if (al.members.some((m) => this.atWar(cid, m))) return { err: 'İttifak üyelerinden biriyle savaştasın' };
      if (Object.values(this.joinGroups).some((g) => g.applicant === cid && g.allianceId === allianceId)) return { err: 'Başvurun zaten beklemede' };
      if (!this.pay(cid, this.price(cid, 'alliance'))) return { err: 'Yetersiz para' };
      const gid = 'g' + this.nextId++;
      this.joinGroups[gid] = { applicant: cid, allianceId, pending: new Set(al.members) };
      for (const m of al.members) this.makeProposal(cid, m, 'join', { allianceId }, gid);
      return { ok: true };
    }

    cmdCallAllies(cid, enemy) {
      const al = this.allianceOf(cid);
      if (!al) return { err: 'Bir ittifakta değilsin' };
      if (!this.atWar(cid, enemy)) return { err: 'Bu ülkeyle savaşta değilsin' };
      let n = 0;
      for (const m of al.members) {
        if (m === cid || this.atWar(m, enemy) || this.pendingProposal(cid, m, 'callToWar')) continue;
        this.makeProposal(cid, m, 'callToWar', { enemy });
        n++;
      }
      if (!n) return { err: 'Çağrılacak müttefik yok' };
      return { ok: true };
    }

    cmdRespond(cid, pid, accept) {
      const p = this.proposals.find((x) => x.id === pid);
      if (!p || p.to !== cid) return { err: 'Teklif bulunamadı' };
      this.resolveProposal(p, accept);
      return { ok: true };
    }

    resolveProposal(p, accept, reason) {
      this.proposals = this.proposals.filter((x) => x !== p);
      const from = this.countries[p.from], to = this.countries[p.to];
      this.emit({ type: 'resolved', p });
      if (!from.alive || !to.alive) return;
      const label = PROPOSAL_NAMES[p.type];

      if (p.type === 'join') {
        const g = this.joinGroups[p.group];
        if (!g) return;
        if (!accept) {
          delete this.joinGroups[p.group];
          for (const q of this.proposals.filter((x) => x.group === p.group)) { this.proposals = this.proposals.filter((x) => x !== q); this.emit({ type: 'resolved', p: q }); }
          this.addRel(p.from, p.to, -8);
          this.say([p.from, p.to], `${to.name}, ${from.name} ülkesinin ittifaka katılma başvurusunu reddetti.`, 'bad');
          return;
        }
        g.pending.delete(p.to);
        this.addRel(p.from, p.to, 6);
        if (g.pending.size === 0) {
          delete this.joinGroups[p.group];
          const al = this.alliances.find((a) => a.id === g.allianceId);
          if (al && from.allianceId === null && !al.members.some((m) => this.atWar(p.from, m))) {
            al.members.push(p.from); from.allianceId = al.id; this.version++;
            this.say(null, `🤝 ${from.name}, ${al.name} ittifakına katıldı!`, 'good');
          }
        }
        return;
      }

      if (!accept) {
        this.addRel(p.from, p.to, p.type === 'demand' ? -4 : -6);
        this.say([p.from, p.to], `${to.name}, ${from.name} ülkesinin ${label.toLowerCase()} teklifini reddetti.${reason ? ' (' + reason + ')' : ''}`, 'bad');
        return;
      }
      let err = null;
      if (p.type === 'demand') {
        err = this.validateBundle(p.to, p.payload);
        if (!err) { this.transferBundle(p.to, p.from, p.payload); this.addRel(p.from, p.to, -8); }
      } else if (p.type === 'support') {
        err = this.validateBundle(p.from, p.payload);
        if (!err) { this.transferBundle(p.from, p.to, p.payload); this.addRel(p.from, p.to, 15); }
      } else if (p.type === 'trade') {
        err = this.validateBundle(p.from, p.payload.give) || this.validateBundle(p.to, p.payload.take);
        if (!err && this.atWar(p.from, p.to)) err = 'Savaş başladı';
        if (!err) { this.transferBundle(p.from, p.to, p.payload.give); this.transferBundle(p.to, p.from, p.payload.take); this.addRel(p.from, p.to, 6); }
      } else if (p.type === 'alliance') {
        if (from.allianceId !== null || to.allianceId !== null) err = 'Taraflardan biri başka ittifaka girdi';
        else if (this.atWar(p.from, p.to)) err = 'Taraflar savaşta';
        else {
          const used = new Set(this.alliances.map((a) => a.name));
          const name = ALLIANCE_NAMES.find((n) => !used.has(n)) || 'Birlik ' + this.nextId;
          const al = { id: this.nextId++, name, colorIdx: p.from, members: [p.from, p.to], founded: this.time };
          this.alliances.push(al);
          from.allianceId = to.allianceId = al.id;
          this.addRel(p.from, p.to, 25);
          this.version++;
          this.say(null, `🤝 ${from.name} ve ${to.name}, ${name} ittifakını kurdu!`, 'good');
          return;
        }
      } else if (p.type === 'peace') {
        if (this.atWar(p.from, p.to)) { this.endWar(p.from, p.to); return; }
        err = 'Zaten barıştalar';
      } else if (p.type === 'callToWar') {
        const enemy = p.payload.enemy;
        if (!this.countries[enemy].alive) err = 'Düşman artık yok';
        else if (this.isAlly(p.to, enemy)) err = 'Düşmanla müttefik';
        else if (!this.atWar(p.from, enemy)) err = 'Savaş sona ermiş';
        else { this.addRel(p.from, p.to, 10); this.startWar(p.to, enemy, true); return; }
      }
      if (err) { this.say([p.from, p.to], `${label} gerçekleşmedi: ${err}`, 'bad'); return; }
      this.say([p.from, p.to], `${to.name}, ${from.name} ülkesinin ${label.toLowerCase()} teklifini KABUL ETTİ: ${this.describeProposal(p)}`, 'good');
    }

    describeProposal(p) {
      const f = this.countries[p.from].name;
      switch (p.type) {
        case 'demand': return `${f} senden ${this.bundleText(p.payload)} talep ediyor.`;
        case 'support': return `${f} sana destek gönderiyor: ${this.bundleText(p.payload)}.`;
        case 'trade': return `${f} takas öneriyor — Verecekleri: ${this.bundleText(p.payload.give)} · İstedikleri: ${this.bundleText(p.payload.take)}.`;
        case 'alliance': return `${f} seninle yeni bir ittifak kurmak istiyor.`;
        case 'join': { const al = this.alliances.find((a) => a.id === p.payload.allianceId); return `${f}, ${al ? al.name : 'ittifakınıza'} katılmak istiyor. (Tüm üyelerin onayı gerekir)`; }
        case 'peace': return `${f} barış antlaşması imzalamak istiyor.`;
        case 'callToWar': return `Müttefikin ${f} seni ${this.countries[p.payload.enemy].name} ile savaşa çağırıyor!`;
      }
      return '';
    }

    // ---------- mağaza ----------
    cmdBuy(cid, item, args) {
      const tgt = args && args.city !== undefined && this.cities[args.city] ? this.cities[args.city].owner : undefined;
      const r = this.buyItem(cid, item, args);
      if (r && r.ok) this.emit({ type: 'sound', name: 'buy', cid, item, target: tgt });
      return r;
    }

    buyItem(cid, item, args) {
      args = args || {};
      const c = this.countries[cid];
      const pr = this.price(cid, item);
      const city = args.city !== undefined ? this.cities[args.city] : null;
      const fail = (e) => ({ err: e });
      switch (item) {
        case 'blitz':
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          c.blitzUntil = Math.max(this.time, c.blitzUntil) + CFG.blitzDuration;
          this.say(cid, 'Blitzkrieg aktif: 2 dakika boyunca +%35 saldırı!', 'good');
          return { ok: true };
        case 'cityDef':
          if (!city || city.owner !== cid) return fail('Kendi şehrini seçmelisin');
          if (city.cityDef) return fail('Bu şehirde zaten savunma var');
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          city.cityDef = true;
          return { ok: true };
        case 'factory':
          if (!city || city.owner !== cid) return fail('Kendi şehrini seçmelisin');
          if (city.factories >= this.factoryLimit(cid)) return fail(`Bu şehir fabrika sınırında (${this.factoryLimit(cid)})`);
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          city.factories++;
          return { ok: true };
        case 'factoryLimit':
          if (c.limitBuys >= CFG.maxLimitBuys) return fail('En fazla 3 kez alınabilir');
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          c.limitBuys++;
          return { ok: true };
        case 'airDef':
          if (!city || city.owner !== cid) return fail('Kendi şehrini seçmelisin');
          if (city.airDef) return fail('Bu şehirde zaten hava koruma var');
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          city.airDef = true;
          return { ok: true };
        case 'plane': {
          const e = this.planeTargetError(cid, args.city);
          if (e) return fail(e);
          const amount = U.clamp(Math.round((args.amount || 0) / 1000) * 1000, 1000, CFG.planeMax);
          const capU = this.units.filter((u) => !u.dead && u.owner === cid && u.city === c.capital && !u.move);
          const avail = capU.reduce((s, u) => s + u.troops, 0);
          if (avail < amount) return fail(`Başkentte yeterli asker yok (${U.fmtK(avail)})`);
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          let need = amount;
          for (const u of capU.sort((a, b) => (a.army === null ? -1 : 1) - (b.army === null ? -1 : 1))) {
            const t = Math.min(need, u.troops); u.troops -= t; need -= t; if (u.troops <= 0) u.dead = true; if (!need) break;
          }
          const nu = this.newUnit(cid, null, amount, null);
          nu.move = { kind: 'para', from: c.capital, to: args.city, path: [c.capital, args.city], t0: this.time, t1: this.time + CFG.planeTime };
          const tgt = this.cities[args.city];
          if (!this.friendly(cid, tgt.owner)) this.say(tgt.owner, `✈ ${c.name} uçaklarla ${tgt.name} şehrine çıkarma yapıyor!`, 'bad');
          return { ok: true };
        }
        case 'rebellion': {
          const t = args.country;
          if (t === undefined || t === cid || this.isRebel(t) || !this.countries[t].alive) return fail('Kendin dışında bir ülke seç');
          const cands = this.citiesOf(t).filter((x) => x.id !== this.countries[t].capital && this.troopsAt(x.id, t) >= CFG.rebellionMin);
          if (!cands.length) return fail('Bu ülkede en az 5k askerli (başkent dışı) şehir yok');
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          const target = cands[Math.floor(this.rnd() * cands.length)];
          for (const u of this.idleUnitsAt(target.id)) { if (u.owner === t) { u.owner = CFG.REBEL; u.army = null; } }
          target.owner = CFG.REBEL;
          for (const u of this.idleUnitsAt(target.id)) if (u.owner !== CFG.REBEL) this.sendHome(u);
          this.mergeCity(target.id);
          this.version++;
          this.addRel(cid, t, -10);
          this.say(null, `🔥 ${this.countries[t].name} ülkesinin ${target.name} şehrinde İSYAN çıktı!`, 'war');
          if (this.countries[cid].isPlayer) this.say(cid, `İsyan başarıyla kışkırtıldı: ${target.name}`, 'good');
          return { ok: true };
        }
        case 'missile': {
          const e = this.missileTargetError(cid, args.city);
          if (e) return fail(e);
          if (!this.pay(cid, pr)) return fail('Yetersiz para');
          this.projectiles.push({ id: this.nextId++, kind: 'missile', owner: cid, from: c.capital, to: args.city, t0: this.time, t1: this.time + CFG.missileTime });
          const tgt = this.cities[args.city];
          this.say(tgt.owner, `🚀 ${c.name} ${tgt.name} şehrine füze fırlattı!`, 'bad');
          return { ok: true };
        }
      }
      return fail('Bilinmeyen ürün');
    }

    planeTargetError(cid, cityId) {
      const city = this.cities[cityId];
      if (!city) return 'Şehir seç';
      if (this.countries.some((k) => k.capital === cityId && k.alive)) return 'Başkentlere çıkarma yapılamaz';
      if (this.isBorderCity(cityId)) return 'Sadece sınırda olmayan (iç) şehirlere çıkarma yapılabilir';
      if (city.airDef) return 'Bu şehirde hava koruma var';
      if (!this.friendly(cid, city.owner) && !this.hostile(cid, city.owner)) return 'Bu ülkeyle savaşta değilsin';
      return null;
    }
    missileTargetError(cid, cityId) {
      const city = this.cities[cityId];
      if (!city) return 'Şehir seç';
      if (this.countries.some((k) => k.capital === cityId && k.alive)) return 'Başkentlere füze atılamaz';
      if (city.owner === cid) return 'Kendi şehrine füze atamazsın';
      if (!this.hostile(cid, city.owner)) return 'Sadece savaştığın ülkelere / isyancılara füze atabilirsin';
      return null;
    }

    // ---------- ordular ----------
    cmdCreateArmy(cid, unitIds, mode) {
      const units = unitIds.map((id) => this.units.find((u) => u.id === id && !u.dead)).filter((u) => u && u.owner === cid && !u.move);
      if (!units.length) return { err: 'Birlik seçilmedi' };
      const n = this.armies.filter((a) => a.owner === cid).length;
      const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      const army = { id: this.nextId++, owner: cid, mode, name: (roman[n] || n + 1) + '. Ordu' };
      this.armies.push(army);
      for (const u of units) u.army = army.id;
      for (const u of units) this.mergeCity(u.city);
      return { ok: true, army };
    }
    cmdArmyMode(cid, armyId, mode) {
      const a = this.armies.find((x) => x.id === armyId && x.owner === cid);
      if (!a) return { err: 'Ordu yok' };
      a.mode = mode; return { ok: true };
    }
    cmdDisbandArmy(cid, armyId) {
      const a = this.armies.find((x) => x.id === armyId && x.owner === cid);
      if (!a) return { err: 'Ordu yok' };
      const cities = new Set();
      for (const u of this.units) if (u.army === armyId) { u.army = null; if (u.city !== null && !u.move) cities.add(u.city); }
      this.armies = this.armies.filter((x) => x !== a);
      for (const c of cities) this.mergeCity(c);
      return { ok: true };
    }

    // ---------- savaş çözümü ----------
    defendersOf(cityId, attacker) {
      return this.idleUnitsAt(cityId).filter((d) => this.hostile(attacker, d.owner));
    }
    effDefense(city, defenders) { let s = 0; for (const d of defenders) s += d.troops * this.defMult(d.owner, city); return s; }

    retreat(u) {
      const m = u.move;
      const from = m ? m.from : u.city;
      let dest = from;
      if (dest === undefined || dest === null || !this.friendly(u.owner, this.cities[dest].owner)) dest = this.countries[u.owner].capital;
      if (dest < 0 || !this.friendly(u.owner, this.cities[dest].owner)) { u.dead = true; return; }
      const start = m ? m.to : from;
      u.city = null;
      u.move = { kind: 'retreat', from: start, to: dest, path: [start, dest], t0: this.time, t1: this.time + CFG.retreatTime };
    }

    resolveAttack(u, cityId, fromId) {
      const city = this.cities[cityId];
      if (this.friendly(u.owner, city.owner)) { this.placeUnit(u, cityId); return; }
      if (!this.hostile(u.owner, city.owner)) { u.move.from = fromId; this.retreat(u); return; }
      const defenders = this.defendersOf(cityId, u.owner);
      const aM = this.atkMult(u.owner, city.owner);
      const effA = u.troops * aM, effD = this.effDefense(city, defenders);
      // Muharebe her zaman zaman alır: boş şehir kısa bir kuşatma, savunulan şehir uzun bir çatışmadır.
      let dur = CFG.siegeEmpty, spend = 0;
      if (defenders.length) {
        if (effA <= effD && u.troops <= CFG.minAttackRemain) {
          this.say([u.owner, city.owner], `${this.countries[u.owner].name} ordusu ${city.name} önünde püskürtüldü.`, 'info');
          this.retreat(u);
          return;
        }
        spend = effA > effD ? effD / aM : u.troops - CFG.minAttackRemain;
        dur = U.clamp(spend / CFG.battleSpeed, CFG.battleMin, CFG.battleMax);
      }
      // prog: şehrin ne kadarının ele geçirildiği (0..1) — haritada sınırdan içeri doğru yavaş yavaş ilerler
      u.move = { kind: 'battle', from: fromId, to: cityId, path: [fromId, cityId], t0: this.time, t1: this.time + dur, effD0: Math.max(effD, 1), prog: 0 };
      this.emit({ type: 'sound', name: 'battleStart', cid: u.owner, target: city.owner, city: cityId });
    }

    winAttack(u, city, defenders, effA, effD, aM) {
      for (const d of defenders) d.dead = true;
      u.troops = Math.max(200, Math.round((effA - effD) / aM));
      const prev = city.owner;
      u.move = null; u.city = city.id;
      const wasCapital = prev !== CFG.REBEL && this.countries[prev].capital === city.id;
      if (prev !== u.owner) this.capture(city, u.owner);
      this.mergeCity(city.id);
      this.emit({ type: 'fx', kind: 'capture', city: city.id });
      this.emit({ type: 'sound', name: 'capture', cid: u.owner, prev, city: city.id, capital: wasCapital });
      const pn = this.countries[prev].name;
      if (!wasCapital) this.say([u.owner, prev], `🏴 ${this.countries[u.owner].name}, ${pn} ülkesinden ${city.name} şehrini ele geçirdi!`, this.countries[u.owner].isPlayer ? 'good' : 'bad');
    }

    capture(city, newOwner, peaceful) {
      const prev = city.owner;
      city.owner = newOwner;
      if (!peaceful) city.cityDef = false;
      for (const u of this.idleUnitsAt(city.id)) if (!this.friendly(u.owner, newOwner)) this.sendHome(u);
      this.version++;
      if (prev !== CFG.REBEL) {
        const pc = this.countries[prev];
        if (pc.capital === city.id) {
          // Başkent savaşla düşerse devlet çöker; barışçıl devirde (takas/talep) başkent başka şehre taşınır.
          if (peaceful) this.relocateCapital(prev);
          else { this.eliminate(prev, newOwner, city); return; }
        }
        if (!this.cities.some((c) => c.owner === prev)) this.eliminate(prev, newOwner);
      }
    }

    relocateCapital(cid) {
      const mine = this.citiesOf(cid);
      const c = this.countries[cid];
      if (!mine.length) { c.capital = -1; return; }
      mine.sort((a, b) => this.troopsAt(b.id, cid) - this.troopsAt(a.id, cid));
      c.capital = mine[0].id;
      this.say(null, `${c.name} başkentini kaybetti! Yeni başkent: ${mine[0].name}`, 'war');
    }

    // capitalCity verilirse: başkent savaşta düştü. Kalan şehirler isyancılara geçer, hazinenin yarısı fatihe ganimet olur.
    eliminate(cid, by, capitalCity) {
      const c = this.countries[cid];
      if (!c.alive) return;
      let loot = 0;
      if (capitalCity) {
        if (by !== undefined && by !== CFG.REBEL) {
          loot = Math.floor(c.money * 0.5 * 10) / 10;
          this.countries[by].money = Math.round((this.countries[by].money + loot) * 100) / 100;
        }
        const rebelCities = [];
        for (const city of this.cities) {
          if (city.owner !== cid) continue;
          city.owner = CFG.REBEL; city.factories = 0; city.cityDef = false; city.airDef = false;
          rebelCities.push(city.id);
        }
        // halk ayaklanır: kalan şehirlerdeki askerlerin yarısı isyancılara katılır, yarısı dağılır
        for (const u of this.units) {
          if (u.dead || u.owner !== cid || u.city === null || u.move || !rebelCities.includes(u.city)) continue;
          u.owner = CFG.REBEL; u.army = null; u.troops = Math.round(u.troops * 0.5);
        }
        // müttefik askerler artık düşman olan bu şehirlerden başkentlerine döner
        for (const u of this.units.slice()) {
          if (u.dead || u.owner === cid || u.owner === CFG.REBEL || u.city === null || u.move || !rebelCities.includes(u.city)) continue;
          this.sendHome(u);
        }
        for (const id of rebelCities) this.mergeCity(id);
      }
      c.alive = false; c.capital = -1; c.queue = 0;
      for (const u of this.units) if (u.owner === cid) u.dead = true;
      this.removeFromAlliance(cid, true);
      for (const e of this.enemiesOf(cid)) this.wars.delete(this.warKey(cid, e));
      this.proposals = this.proposals.filter((p) => p.from !== cid && p.to !== cid);
      this.armies = this.armies.filter((a) => a.owner !== cid);
      this.version++;
      const byName = by !== undefined && by !== CFG.REBEL ? this.countries[by].name : null;
      if (capitalCity) {
        this.say(null, `☠ ${c.name} YIKILDI! Başkent ${capitalCity.name}${byName ? ', ' + byName + ' tarafından' : ''} ele geçirildi; kalan şehirleri isyancılar aldı.${loot ? ' Ganimet: ' + U.fmtMoney(loot) : ''}`, 'war');
      } else {
        this.say(null, `☠ ${c.name} YIKILDI!${byName ? ' (' + byName + ' tarafından)' : ''}`, 'war');
      }
      this.emit({ type: 'sound', name: 'eliminated', cid, by, player: c.isPlayer });
    }

    // ---------- güncelleme ----------
    update(dt) {
      if (this.phase !== 'play' || this.over) return;
      this.time += dt;
      const T = this.time;

      for (const c of this.countries) {
        if (!c.alive || c.isRebel) continue;
        c.incomeTimer += dt;
        if (c.incomeTimer >= CFG.incomeInterval) {
          c.incomeTimer -= CFG.incomeInterval;
          const f = this.factoriesOf(c.id);
          c.money = Math.round((c.money + f) * 100) / 100;
          if (c.isPlayer && f > 0) this.emit({ type: 'income', amount: f });
        }
        if (c.queue > 0 && c.capital >= 0) {
          c.prodTimer += dt;
          while (c.prodTimer >= CFG.troopBuildTime && c.queue > 0) {
            c.prodTimer -= CFG.troopBuildTime; c.queue--;
            this.addTroops(c.id, c.capital, 1000);
            if (c.isPlayer) this.emit({ type: 'sound', name: 'troopReady', cid: c.id });
          }
          if (c.queue === 0) c.prodTimer = 0;
        }
        for (const k in c.warRights) {
          if (c.warRights[k] <= T && c.warRights[k] > T - dt && c.isPlayer) this.say(c.id, `Savaş ilan hakkın hazır: ${this.countries[k].name}`, 'war');
        }
        if (c.blitzUntil > 0 && c.blitzUntil <= T && c.blitzUntil > T - dt) this.say(c.id, 'Blitzkrieg sona erdi.', 'info');
      }

      // hareketler ve muharebeler
      for (const u of this.units) {
        if (u.dead || !u.move) continue;
        const m = u.move;
        if (m.kind === 'battle') { this.updateBattle(u, dt); continue; }
        if (T < m.t1) continue;
        const city = this.cities[m.to];
        if (m.kind === 'attack' || m.kind === 'para') this.resolveAttack(u, m.to, m.from);
        else if (this.friendly(u.owner, city.owner)) this.placeUnit(u, m.to);
        else if (this.hostile(u.owner, city.owner) && m.kind === 'move') this.resolveAttack(u, m.to, m.path.length > 1 ? m.path[m.path.length - 2] : m.from);
        else this.sendHome(u);
      }

      // füzeler
      for (const p of this.projectiles) {
        if (p.done || T < p.t1) continue;
        p.done = true;
        const city = this.cities[p.to];
        if (city.airDef && this.rnd() < CFG.missileIntercept) {
          this.say([p.owner, city.owner], `🛡 ${city.name} hava koruması füzeyi düşürdü!`, 'info');
          this.emit({ type: 'fx', kind: 'intercept', city: city.id });
          continue;
        }
        for (const u of this.idleUnitsAt(city.id)) u.dead = true;
        city.factories = 0; city.cityDef = false; city.airDef = false;
        this.emit({ type: 'fx', kind: 'explosion', city: city.id });
        this.say([p.owner, city.owner], `💥 Füze ${city.name} şehrini vurdu! Tüm askerler ve yapılar yok oldu.`, 'war');
      }
      this.projectiles = this.projectiles.filter((p) => !p.done);

      // teklifler
      for (const p of this.proposals.slice()) {
        if (!this.proposals.includes(p)) continue;
        const to = this.countries[p.to];
        if (to.isBot && T >= p.decideAt) {
          const r = G.Bot.decide(this, p);
          this.resolveProposal(p, r.accept, r.reason);
        } else if (T >= p.expires) {
          this.resolveProposal(p, false, 'süre doldu');
        }
      }

      // ordular
      this.armyTimer += dt;
      if (this.armyTimer >= 1.2) { this.armyTimer = 0; this.updateArmies(); }

      // botlar
      for (const c of this.countries) if (c.isBot && c.alive) G.Bot.update(this, c.id, dt);

      // temizlik
      for (const u of this.units) if (!u.dead && u.troops < 50) u.dead = true;
      if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
      this.armies = this.armies.filter((a) => this.units.some((u) => u.army === a.id));
      this.checkGameOver();
    }

    updateBattle(u, dt) {
      const m = u.move;
      const city = this.cities[m.to];
      if (this.friendly(u.owner, city.owner)) { this.placeUnit(u, city.id); return; }
      if (!this.hostile(u.owner, city.owner)) { this.retreat(u); return; }
      const defenders = this.defendersOf(city.id, u.owner);
      const aM = this.atkMult(u.owner, city.owner);
      const effD = this.effDefense(city, defenders);
      const effA = u.troops * aM;
      // savunan kalmadıysa kuşatma süresi dolunca şehir düşer
      if (!defenders.length || effD < 1) {
        m.prog = U.clamp((this.time - m.t0) / Math.max(0.1, m.t1 - m.t0), 0, 1);
        if (this.time >= m.t1) this.winAttack(u, city, defenders, effA, 0, aM);
        return;
      }
      m.effD0 = Math.max(m.effD0 || 1, effD); // takviye gelirse ilerleme geriye düşer
      const winning = effA > effD;
      if (!winning && u.troops <= CFG.minAttackRemain + 1) {
        u.troops = Math.max(u.troops, CFG.minAttackRemain);
        this.say([u.owner, city.owner], `${city.name} savunması saldırıyı durdurdu. ${this.countries[u.owner].name} geri çekiliyor.`, this.countries[city.owner].isPlayer ? 'good' : 'bad');
        this.emit({ type: 'sound', name: 'repelled', cid: u.owner, target: city.owner, city: city.id });
        this.retreat(u);
        return;
      }
      // Kayıplar savaşın süresine yayılır: kazanan taraf bitişe kadar eriyerek ilerler.
      const spend = winning ? effD / aM : u.troops - CFG.minAttackRemain;
      const left = Math.max(m.t1 - this.time, 0.5);
      const loss = Math.min((spend / left) * dt, spend);
      u.troops -= loss;
      const frac = Math.min(1, (loss * aM) / effD);
      for (const d of defenders) d.troops -= d.troops * frac;
      m.prog = U.clamp(1 - (effD * (1 - frac)) / m.effD0, 0, 1);
      if (winning) {
        const effD2 = effD * (1 - frac);
        if (effD2 <= 150 || this.time >= m.t1 + 4) this.winAttack(u, city, defenders, u.troops * aM, effD2, aM);
      }
    }

    updateArmies() {
      for (const army of this.armies) {
        const cid = army.owner;
        const units = this.units.filter((u) => !u.dead && u.army === army.id && !u.move && u.city !== null);
        for (const u of units) {
          if (u.dead || u.move) continue;
          const here = this.cities[u.city];
          const aM = (o) => this.atkMult(cid, o);
          if (army.mode === 'attack') {
            const targets = here.neighbors.map((n) => this.cities[n]).filter((c) => this.hostile(cid, c.owner));
            if (targets.length) {
              let best = null, bestScore = -Infinity;
              for (const t of targets) {
                const effD = this.effDefense(t, this.defendersOf(t.id, cid));
                const effA = u.troops * aM(t.owner);
                const score = effA - effD * 1.05;
                if (score > bestScore) { bestScore = score; best = t; }
              }
              if (best && bestScore > 0 && u.troops >= 2000) this.cmdMove(cid, u.id, best.id);
            } else {
              // en yakın cepheye ilerle
              const front = this.nearestFront(u.city, cid);
              if (front !== null && front !== u.city) this.cmdMove(cid, u.id, front);
            }
          } else {
            // savunma: kendi sınırları içinde kal, kaybedilen şehirleri geri al, saldırı altındakilere destek ver
            const lost = here.neighbors.map((n) => this.cities[n]).filter((c) => c.origOwner === cid && this.hostile(cid, c.owner));
            let done = false;
            for (const t of lost) {
              const effD = this.effDefense(t, this.defendersOf(t.id, cid));
              if (u.troops * aM(t.owner) > effD * 1.05) { this.cmdMove(cid, u.id, t.id); done = true; break; }
            }
            if (done) continue;
            const threatenedHere = this.incomingAttacks(u.city).length > 0;
            if (threatenedHere) continue;
            const attacked = this.units.filter((x) => !x.dead && x.move && (x.move.kind === 'attack' || x.move.kind === 'battle') &&
              this.cities[x.move.to].owner === cid && this.hostile(cid, x.owner));
            for (const a of attacked) {
              const tgt = a.move.to;
              if (tgt === u.city || army['sent' + a.id]) continue;
              const path = this.findPath(u.city, tgt, cid);
              if (!path || path.some((id) => this.cities[id].owner !== cid)) continue;
              army['sent' + a.id] = true;
              this.cmdMove(cid, u.id, tgt, Math.floor(u.troops * 0.6));
              break;
            }
          }
        }
      }
    }

    incomingAttacks(cityId) {
      return this.units.filter((x) => !x.dead && x.move && x.move.to === cityId &&
        (x.move.kind === 'attack' || x.move.kind === 'battle' || (x.move.kind === 'para' && this.hostile(x.owner, this.cities[cityId].owner))));
    }
    isUnderAttack(cityId) {
      for (const x of this.units) {
        if (x.dead || !x.move || x.move.to !== cityId) continue;
        const k = x.move.kind;
        if (k === 'attack' || k === 'battle') return true;
        if (k === 'para' && this.hostile(x.owner, this.cities[cityId].owner)) return true;
      }
      return false;
    }

    nearestFront(fromCity, cid) {
      const seen = new Set([fromCity]);
      const q = [fromCity];
      while (q.length) {
        const a = q.shift();
        const ca = this.cities[a];
        if (ca.neighbors.some((n) => this.hostile(cid, this.cities[n].owner))) return a;
        for (const b of ca.neighbors) {
          if (seen.has(b) || !this.friendly(cid, this.cities[b].owner)) continue;
          seen.add(b); q.push(b);
        }
      }
      return null;
    }

    // ---------- kayıt / yükleme ----------
    // Harita tohumdan aynen yeniden üretilir; sadece değişen durum kaydedilir.
    serialize() {
      const strip = (c) => { const { pal, color, dark, light, ...rest } = c; return rest; };
      return {
        v: 1, seed: this.seed, time: this.time, phase: this.phase, nextId: this.nextId, playerId: this.playerId, over: this.over,
        armyTimer: this.armyTimer, nCities: this.cities.length,
        cities: this.cities.map((c) => [c.owner, c.origOwner, c.factories, c.cityDef ? 1 : 0, c.airDef ? 1 : 0]),
        countries: this.countries.map(strip),
        units: this.units.filter((u) => !u.dead),
        wars: [...this.wars.values()],
        alliances: this.alliances, proposals: this.proposals,
        joinGroups: Object.fromEntries(Object.entries(this.joinGroups).map(([k, j]) => [k, { applicant: j.applicant, allianceId: j.allianceId, pending: [...j.pending] }])),
        armies: this.armies, projectiles: this.projectiles, rel: this.rel,
      };
    }
    static restore(d) {
      if (!d || d.v !== 1) throw new Error('Kayıt sürümü uyumsuz');
      const pc = d.countries[d.playerId];
      const g = new Game({ seed: d.seed, playerName: pc.name, ideology: pc.ideology });
      if (g.cities.length !== d.nCities) throw new Error('Harita yeniden üretilemedi');
      g.listeners = [];
      g.time = d.time; g.phase = d.phase; g.nextId = d.nextId; g.playerId = d.playerId; g.over = d.over; g.armyTimer = d.armyTimer || 0;
      d.cities.forEach((a, i) => { const c = g.cities[i]; c.owner = a[0]; c.origOwner = a[1]; c.factories = a[2]; c.cityDef = !!a[3]; c.airDef = !!a[4]; });
      g.countries.forEach((c, i) => Object.assign(c, d.countries[i]));
      g.units = d.units;
      g.wars = new Map(d.wars.map((w) => [g.warKey(w.a, w.b), w]));
      g.alliances = d.alliances; g.proposals = d.proposals; g.armies = d.armies; g.projectiles = d.projectiles; g.rel = d.rel;
      g.joinGroups = Object.fromEntries(Object.entries(d.joinGroups || {}).map(([k, j]) => [k, { ...j, pending: new Set(j.pending) }]));
      g.version++;
      return g;
    }

    checkGameOver() {
      if (this.over) return;
      const p = this.player;
      if (!p.alive) { this.over = true; this.emit({ type: 'gameover', win: false }); return; }
      const rivals = this.countries.filter((c) => c.alive && !c.isRebel && !this.isAlly(c.id, p.id));
      if (!rivals.length) { this.over = true; this.emit({ type: 'gameover', win: true }); }
    }
  }

  G.Game = Game;
  G.CFG = CFG;
  G.IDEO = IDEO;
  G.PRICES = PRICES;
  G.PALETTE = PALETTE;
  G.PROPOSAL_NAMES = PROPOSAL_NAMES;
})();
