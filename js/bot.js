// Bot yapay zekâsı: ekonomi, askeri hareket, diplomasi ve teklif değerlendirme.
// Botlar oyuncuyla aynı cmd* komutlarını kullanır (hile yok).
(function () {
  'use strict';
  const G = window.G;

  function update(game, cid, dt) {
    const b = game.countries[cid].bot;
    b.eco -= dt; b.mil -= dt; b.dip -= dt;
    if (b.eco <= 0) { b.eco = 2 + game.rnd() * 2; economy(game, cid); }
    if (b.mil <= 0) { b.mil = 1.4 + game.rnd() * 1.4; military(game, cid); }
    if (b.dip <= 0) { b.dip = 6 + game.rnd() * 6; diplomacy(game, cid); }
  }

  function frontInfo(game, cid) {
    const res = [];
    for (const city of game.cities) {
      if (city.owner !== cid) continue;
      let hostileT = 0, foreignT = 0, hostileN = 0, foreignN = 0;
      for (const n of city.neighbors) {
        const o = game.cities[n].owner;
        if (o === cid) continue;
        if (game.hostile(cid, o)) { hostileN++; hostileT += game.troopsAt(n, o); }
        else if (!game.isAlly(cid, o)) { foreignN++; foreignT += game.troopsAt(n, o); }
      }
      res.push({ city, hostileT, foreignT, hostileN, foreignN, mine: game.troopsAt(city.id, cid) });
    }
    return res;
  }

  function economy(game, cid) {
    const c = game.countries[cid];
    const rnd = game.rnd;
    const enemies = game.enemiesOf(cid);
    const atWar = enemies.length > 0;
    const facs = game.factoriesOf(cid) + game.factoriesPending(cid); // inşaatı süren fabrikalar da sayılır
    const want = 3 + Math.floor(game.time / 40);
    const fp = game.price(cid, 'factory');

    if (facs < want && c.money >= fp + (atWar ? 6 : 0) && rnd() < (atWar ? 0.3 : 0.7)) {
      // fabrikasız (bağlantısı kopmuş) bölgede askerleri varsa oraya fabrika kur; yoksa iç şehirleri tercih et
      const unfed = (x) => (game.supply && !game.supply[x.id] && game.troopsAt(x.id, cid) > 3000 ? 0 : 1);
      const opts = game.citiesOf(cid).filter((x) => game.factorySlots(x) < game.factoryLimit(cid))
        .sort((a, b) => (unfed(a) - unfed(b)) || (game.isBorderCity(a.id) - game.isBorderCity(b.id)) || (b.factories - a.factories));
      if (opts.length) game.cmdBuy(cid, 'factory', { city: opts[0].id });
      else if (c.limitBuys < 3) game.cmdBuy(cid, 'factoryLimit');
    }
    if (atWar && c.blitzUntil < game.time && c.money >= 14 && rnd() < 0.3) game.cmdBuy(cid, 'blitz');
    if (c.money >= 9 && rnd() < 0.22) {
      const k = atWar ? (rnd() < 0.6 ? 'atk' : 'def') : rnd() < 0.5 ? 'def' : 'atk';
      game.cmdUpgrade(cid, k);
    }
    // ideolojiye özel geliştirmeler
    if (c.money >= 8 && rnd() < 0.12) {
      const ups = game.ideoUps(cid).filter((x) => game.iu(cid, x.key) < G.CFG.ideoUpMax);
      if (ups.length) {
        const pick = ups[Math.floor(rnd() * ups.length)];
        if (c.money >= game.ideoUpPrice(cid, pick.key) + 3) game.cmdIdeoUpgrade(cid, pick.key);
      }
    }
    if (atWar && c.money >= 45 && rnd() < 0.1) {
      let best = null, bt = 0;
      for (const city of game.cities) {
        if (!game.hostile(cid, city.owner) || game.missileTargetError(cid, city.id)) continue;
        if (!city.neighbors.some((n) => game.cities[n].owner === cid)) continue;
        const t = game.troopsAt(city.id) + city.factories * 6000;
        if (t > bt) { bt = t; best = city; }
      }
      if (best && bt > 15000) game.cmdBuy(cid, 'missile', { city: best.id });
    }
    if (atWar && c.money >= 60 && rnd() < 0.05) {
      const e = enemies.find((x) => !game.isRebel(x));
      if (e !== undefined) game.cmdBuy(cid, 'rebellion', { country: e });
    }
    if (c.money >= 24 && rnd() < 0.08) {
      const f = frontInfo(game, cid).filter((x) => x.hostileN && !x.city.cityDef).sort((a, b) => b.hostileT - a.hostileT)[0];
      if (f) game.cmdBuy(cid, 'cityDef', { city: f.city.id });
    }
    if (c.money >= 40 && rnd() < 0.04) {
      const t = game.citiesOf(cid).filter((x) => x.factories > 0 && !x.airDef && !game.isBorderCity(x.id))[0];
      if (t) game.cmdBuy(cid, 'airDef', { city: t.id });
    }
    // barışta önce fabrikaya biriktir (ekonomi büyüsün)
    const saving = !atWar && facs < want && game.citiesOf(cid).some((x) => game.factorySlots(x) < game.factoryLimit(cid));
    const threatened = game.neighborsOfCountry(cid).some((n) => game.countries[n] && game.countries[n].warRights && game.countries[n].warRights[cid] !== undefined);
    const reserve = atWar || threatened ? 1 : saving ? fp + 2 : 4;
    const spend = Math.floor((c.money - reserve) * (atWar ? 0.9 : 0.55) / game.price(cid, 'troop'));
    for (let i = 0; i < spend; i++) if (game.cmdQueueTroops(cid, 1).err) break;
  }

  function military(game, cid) {
    const c = game.countries[cid];
    const idle = game.units.filter((u) => !u.dead && u.owner === cid && !u.move && u.city !== null && u.army === null)
      .sort((a, b) => b.troops - a.troops);
    let actions = 0;
    const attacked = new Set();
    // Başkent düşerse devlet yıkılır: başkentte her zaman yeterli asker bırak (komşusu düşmansa daha fazla)
    const info = frontInfo(game, cid);
    const capInfo = info.find((x) => x.city.id === c.capital);
    const capKeep = Math.max(6000, capInfo && capInfo.hostileN > 0 ? capInfo.hostileT * 1.6 + 8000 : 0);
    // 1) Saldırılar
    for (const u of idle) {
      if (actions >= 4) break;
      const avail = u.city === c.capital ? Math.floor((u.troops - capKeep) / 1000) * 1000 : u.troops;
      if (avail < 4000) continue;
      const here = game.cities[u.city];
      let best = null, bestScore = -Infinity;
      for (const n of here.neighbors) {
        const t = game.cities[n];
        if (!game.hostile(cid, t.owner) || attacked.has(n)) continue;
        const effD = game.effDefense(t, game.defendersOf(n, cid));
        const effA = avail * game.unitAtk(u, t.owner);
        const margin = effA - effD * 1.18 - 1500;
        if (margin <= 0) continue;
        const isCap = game.countries.some((k) => k.capital === n && k.alive);
        const score = margin + t.factories * 4000 + (isCap ? 40000 : 0) - effD * 0.2; // düşman başkenti = ülkeyi bitirir
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (best && !game.cmdMove(cid, u.id, best.id, avail >= u.troops ? undefined : avail).err) { attacked.add(best.id); actions++; }
    }
    // 2) Takviye
    const atWar = info.some((x) => x.hostileN > 0);
    const needs = info.filter((x) => (atWar ? x.hostileN > 0 : x.foreignN > 0)).map((x) => ({
      x, need: (atWar ? x.hostileT * 1.25 + 4000 : x.foreignT * 0.6 + 3000) - x.mine,
    })).filter((n) => n.need > 0).sort((a, b) => b.need - a.need);
    if (!needs.length) return;
    const frontSet = new Set(info.filter((x) => (atWar ? x.hostileN > 0 : x.foreignN > 0)).map((x) => x.city.id));
    let moves = 0;
    for (const u of game.units.filter((u) => !u.dead && u.owner === cid && !u.move && u.city !== null && u.army === null)) {
      if (moves >= 3 || !needs.length) break;
      if (frontSet.has(u.city) && !(u.city === c.capital)) continue;
      const keep = u.city === c.capital ? Math.max(capKeep, u.troops * (atWar ? 0.15 : 0.3)) : 0;
      const avail = Math.floor((u.troops - keep) / 1000) * 1000;
      if (avail < 2000) continue;
      const tgt = needs[0];
      if (tgt.x.city.id === u.city) continue;
      const amount = Math.min(avail, Math.max(2000, Math.ceil(tgt.need / 1000) * 1000));
      const r = game.cmdMove(cid, u.id, tgt.x.city.id, amount);
      if (!r.err) { tgt.need -= amount; moves++; if (tgt.need <= 0) needs.shift(); }
      else if (!r.locked) needs.shift();
    }
  }

  function canPingPlayer(game, cid, to) {
    if (!game.countries[to].isHuman) return true;
    const b = game.countries[cid].bot;
    if (b.lastToPlayer && game.time - b.lastToPlayer < 75) return false;
    b.lastToPlayer = game.time;
    return true;
  }

  function diplomacy(game, cid) {
    const c = game.countries[cid];
    const rnd = game.rnd;
    if (game.time < 25) return;
    const enemies = game.enemiesOf(cid).filter((e) => !game.isRebel(e));
    const myP = allyPower(game, cid);

    for (const e of enemies) {
      const war = game.wars.get(game.warKey(cid, e));
      const ep = allyPower(game, e);
      const dur = game.time - war.since;
      // çok kötü durumdaysa teslim ol
      if (myP < ep * 0.4 && dur > 60 && game.citiesOf(cid).length <= 8 && rnd() < 0.35) { game.cmdSurrender(cid, e); continue; }
      if ((myP < ep * 0.72 || (dur > 200 && rnd() < 0.25)) && !game.pendingProposal(cid, e, 'peace') && canPingPlayer(game, cid, e)) {
        game.cmdPropose(cid, e, 'peace');
      }
      c.bot.called = c.bot.called || {};
      const ck = e + ':' + war.since;
      if (c.allianceId !== null && !c.bot.called[ck] && rnd() < 0.5) { c.bot.called[ck] = true; game.cmdCallAllies(cid, e); }
    }
    for (const k in c.warRights) {
      const t = +k;
      if (game.warRightState(cid, t).state !== 'ready') continue;
      if (!game.countries[t].alive || game.isAlly(cid, t)) { delete c.warRights[k]; continue; }
      if (game.power(cid) > game.power(t) * 0.95) {
        game.cmdDeclareWar(cid, t);
      } else if (rnd() < 0.2) delete c.warRights[k];
    }
    if (enemies.length === 0 && game.time > 110 && rnd() < 0.18) {
      const neigh = game.neighborsOfCountry(cid).filter((x) => !game.isRebel(x) && game.countries[x].alive && !game.isAlly(cid, x) && c.warRights[x] === undefined);
      let best = null, bs = 0;
      for (const n of neigh) {
        const ratio = game.power(cid) / Math.max(1, allyPower(game, n));
        const s = ratio * (1 - game.rel[cid][n] / 150);
        if (s > bs) { bs = s; best = n; }
      }
      if (best !== null && bs > 1.3) game.cmdBuyWarRight(cid, best);
    }
    if (c.allianceId === null && rnd() < 0.22) {
      const cands = game.countries.filter((k) => k.alive && !k.isRebel && k.id !== cid && !game.atWar(cid, k.id) && game.rel[cid][k.id] >= -5);
      let best = null, bs = -Infinity;
      const myEnemies = new Set(enemies);
      for (const k of cands) {
        const common = game.enemiesOf(k.id).some((e) => myEnemies.has(e)) ? 40 : 0;
        const s = game.rel[cid][k.id] + common + rnd() * 25;
        if (s > bs) { bs = s; best = k; }
      }
      if (best && canPingPlayer(game, cid, best.id)) game.cmdPropose(cid, best.id, 'alliance');
    }
    if (rnd() < 0.05) {
      const weak = game.neighborsOfCountry(cid).filter((x) => !game.isRebel(x) && game.countries[x].alive && !game.isAlly(cid, x) &&
        !game.atWar(cid, x) && game.power(x) < myP * 0.5 && game.countries[x].money >= 2);
      if (weak.length) {
        const t = weak[Math.floor(rnd() * weak.length)];
        const amt = Math.max(1, Math.floor(game.countries[t].money * 0.4));
        if (canPingPlayer(game, cid, t)) game.cmdPropose(cid, t, 'demand', { money: amt, troops: 0, cities: [] });
      }
    }
    if (c.allianceId !== null && c.money > 22 && rnd() < 0.12) {
      const al = game.allianceOf(cid);
      const needy = al.members.find((m) => m !== cid && game.enemiesOf(m).length > 0);
      if (needy !== undefined && canPingPlayer(game, cid, needy)) game.cmdPropose(cid, needy, 'support', { money: 6, troops: 0, cities: [] });
    }
  }

  function allyPower(game, cid) {
    let p = game.power(cid);
    const al = game.allianceOf(cid);
    if (al) for (const m of al.members) if (m !== cid) p += game.power(m) * 0.35;
    return p;
  }

  function decide(game, p) {
    const me = p.to, from = p.from;
    const rel = game.rel[me][from] + game.diploBonus(from); // Demokrasi: Diplomasi Ağı
    const r = game.rnd();
    const myP = game.power(me), fP = game.power(from);
    const yes = { accept: true }, no = (reason) => ({ accept: false, reason });
    switch (p.type) {
      case 'support': return yes;
      case 'alliance': case 'join': {
        if (game.atWar(me, from)) return no('savaştayız');
        const myEnemies = new Set(game.enemiesOf(me));
        const common = game.enemiesOf(from).some((e) => myEnemies.has(e));
        let score = 0.28 + rel / 100 + (common ? 0.35 : 0) + (fP > myP ? 0.1 : 0);
        if (p.type === 'join') score += 0.05;
        if (game.enemiesOf(from).length && !common) score -= 0.15;
        return r < score ? yes : no('ilişkiler yeterince iyi değil');
      }
      case 'demand': {
        const v = game.bundleValue(p.payload);
        const wealth = game.countries[me].money + game.totalTroops(me) / 1000;
        if (fP > myP * 1.5 && v <= wealth * 0.25 && r < 0.75) return yes;
        if (rel > 50 && v <= wealth * 0.1) return yes;
        return no('talebiniz kabul edilemez');
      }
      case 'trade': {
        const get = game.bundleValue(p.payload.give), give = game.bundleValue(p.payload.take);
        const factor = rel > 30 ? 0.9 : rel < -20 ? 1.3 : 1.05;
        return get >= give * factor ? yes : no('takas adil değil');
      }
      case 'peace': {
        const war = game.wars.get(game.warKey(me, from));
        const dur = war ? game.time - war.since : 0;
        const ratio = allyPower(game, me) / Math.max(1, allyPower(game, from));
        if (ratio < 0.85) return yes;
        if (dur > 120 && ratio < 1.3 && r < 0.6) return yes;
        if (dur > 260 && r < 0.45) return yes;
        return no('savaşı kazanıyoruz');
      }
      case 'callToWar': {
        const enemy = p.payload.enemy;
        if (game.isAlly(me, enemy)) return no('düşmanla müttefikiz');
        const score = 0.5 + rel / 200 + (myP > game.power(enemy) * 0.8 ? 0.2 : -0.1);
        return r < score ? yes : no('şimdilik tarafsız kalıyoruz');
      }
    }
    return no('');
  }

  G.Bot = { update, decide };
})();
