// Ses ve müzik — tamamı Web Audio ile üretilir (ses dosyası yok, çevrimdışı da çalışır).
// Müzik: barışta sakin pad + lavta; savaşta taiko davulları + bas yaylılar + pirinç; çatışmada ek vurmalı + keman.
(function () {
  'use strict';
  const G = window.G;
  const KEY = 'hc_audio_v1';

  let ctx = null, master, sfxBus, musicBus, noiseBuf, analyser;
  const state = { muted: false, sfx: 0.85, music: 0.6 };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* yok */ }
  const saveState = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* yok */ } };

  // ---------- temel parçalar ----------
  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = null; return null; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = state.muted ? 0 : 1;
    sfxBus = ctx.createGain(); sfxBus.gain.value = state.sfx;
    musicBus = ctx.createGain(); musicBus.gain.value = state.music * 0.8;
    sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; comp.connect(analyser); // hata ayıklama için çıkış seviyesi
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => { /* yok */ }); }
  function ready() { return !!ctx && ctx.state === 'running' && !state.muted; }

  // tek bir ton: {f, f2, type, delay, dur, vol, a, hold, bus, filter:{type,f,f2,q}, detune}
  function tone(o) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay || 0), dur = o.dur, a = o.a || 0.005;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + a);
    if (o.hold) g.gain.setValueAtTime(o.vol, t0 + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass'; f.Q.value = o.filter.q || 0.7;
      f.frequency.setValueAtTime(o.filter.f, t0);
      if (o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t0 + dur);
      osc.connect(f); f.connect(g);
    } else osc.connect(g);
    g.connect(o.bus || sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  // gürültü patlaması: {delay, dur, vol, a, filter:{type,f,f2,q}}
  function noise(o) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay || 0), dur = o.dur, a = o.a || 0.003;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f = ctx.createBiquadFilter();
    f.type = (o.filter && o.filter.type) || 'lowpass'; f.Q.value = (o.filter && o.filter.q) || 0.7;
    f.frequency.setValueAtTime((o.filter && o.filter.f) || 2000, t0);
    if (o.filter && o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }
  // davul vuruşu (taiko / kös): düşen perdeli gövde + deri çıtırtısı
  function drum(vol, o) {
    o = o || {};
    const f = o.f || 110;
    tone({ f, f2: f * 0.38, dur: o.dur || 0.34, vol, a: 0.002, type: 'sine', delay: o.delay, bus: o.bus });
    tone({ f: f * 2.1, f2: f * 0.8, dur: 0.12, vol: vol * 0.35, a: 0.001, type: 'triangle', delay: o.delay, bus: o.bus });
    noise({ dur: 0.07, vol: vol * 0.55, filter: { type: 'lowpass', f: 900, f2: 200 }, delay: o.delay, bus: o.bus });
  }
  function gong(vol, base, dur, bus, delay) {
    [1, 1.504, 2.18, 2.76, 3.4].forEach((r, i) => tone({ f: base * r, dur: dur / (1 + i * 0.35), vol: vol / (1 + i * 0.6), a: 0.004, type: 'sine', bus, delay }));
    noise({ dur: 0.4, vol: vol * 0.7, filter: { type: 'bandpass', f: base * 3, q: 0.8 }, bus, delay });
  }
  function horn(f, dur, vol, delay) {
    [-7, 7].forEach((dt) => tone({ f, dur, vol, a: dur * 0.28, hold: dur * 0.6, type: 'sawtooth', detune: dt, delay,
      filter: { type: 'lowpass', f: 380, f2: 1300, q: 1.4 } }));
    tone({ f: f / 2, dur, vol: vol * 0.8, a: dur * 0.25, hold: dur * 0.6, type: 'sine', delay });
  }
  function trumpet(f, dur, vol, delay) {
    [-5, 5].forEach((dt) => tone({ f, dur, vol, a: 0.03, hold: dur * 0.55, type: 'sawtooth', detune: dt, delay,
      filter: { type: 'lowpass', f: 900, f2: 3000, q: 1.2 } }));
    tone({ f: f * 2, dur: dur * 0.8, vol: vol * 0.25, a: 0.03, type: 'square', delay, filter: { type: 'lowpass', f: 2500 } });
  }
  function bell(f, vol, dur, delay) {
    tone({ f, dur, vol, a: 0.004, type: 'sine', delay });
    tone({ f: f * 2.76, dur: dur * 0.5, vol: vol * 0.3, a: 0.004, type: 'sine', delay });
    tone({ f: f * 5.4, dur: dur * 0.25, vol: vol * 0.12, a: 0.004, type: 'sine', delay });
  }
  function clashHit(vol) {
    const p = 0.85 + Math.random() * 0.5;
    noise({ dur: 0.09, vol: vol * 0.5, filter: { type: 'bandpass', f: 3200 * p, q: 1.1 } });
    tone({ f: 2300 * p, f2: 1500 * p, dur: 0.16, vol: vol * 0.16, type: 'triangle', a: 0.002 });
    tone({ f: 3900 * p, f2: 3000 * p, dur: 0.1, vol: vol * 0.08, type: 'sine', a: 0.002 });
    tone({ f: 120 * p, f2: 60, dur: 0.1, vol: vol * 0.3, type: 'sine', a: 0.002 });
  }

  // ---------- ses efektleri ----------
  const SFX = {
    click() { tone({ f: 900, f2: 600, dur: 0.06, vol: 0.2, type: 'triangle' }); noise({ dur: 0.025, vol: 0.08, filter: { type: 'highpass', f: 3000 } }); },
    error() { tone({ f: 150, dur: 0.13, vol: 0.2, type: 'square', filter: { type: 'lowpass', f: 600 } }); tone({ f: 120, dur: 0.16, vol: 0.2, type: 'square', delay: 0.11, filter: { type: 'lowpass', f: 500 } }); },
    good() { bell(880, 0.14, 0.35); bell(1175, 0.12, 0.4, 0.09); },
    coin() { bell(1318, 0.09, 0.3); bell(1760, 0.08, 0.38, 0.07); },
    buy() { bell(1046, 0.12, 0.3); tone({ f: 160, f2: 70, dur: 0.12, vol: 0.2, type: 'triangle', delay: 0.04 }); noise({ dur: 0.05, vol: 0.12, delay: 0.04, filter: { type: 'bandpass', f: 1800 } }); bell(1568, 0.1, 0.35, 0.1); },
    troop() { tone({ f: 330, f2: 200, dur: 0.1, vol: 0.14, type: 'triangle' }); noise({ dur: 0.04, vol: 0.08, filter: { type: 'bandpass', f: 1500 } }); },
    march() { drum(0.34, { f: 95 }); drum(0.3, { f: 90, delay: 0.17 }); drum(0.4, { f: 85, delay: 0.34 }); horn(196, 0.55, 0.07, 0.08); },
    horn() { horn(147, 1.1, 0.12); horn(220, 0.9, 0.08, 0.12); drum(0.45, { f: 80 }); drum(0.4, { f: 80, delay: 0.4 }); },
    alarm() { horn(131, 0.55, 0.14); horn(131, 0.55, 0.14, 0.7); horn(110, 0.9, 0.16, 1.4); drum(0.5, { f: 70 }); drum(0.5, { f: 70, delay: 0.7 }); drum(0.55, { f: 65, delay: 1.4 }); },
    clash() { for (let i = 0; i < 4; i++) setTimeout(() => ready() && clashHit(0.8), i * 130 + Math.random() * 60); },
    victory() {
      [293.7, 370, 440, 587.3].forEach((f, i) => trumpet(f, i === 3 ? 1.1 : 0.32, 0.12, i * 0.22));
      drum(0.5, { f: 90 }); drum(0.55, { f: 85, delay: 0.66 });
    },
    victorySmall() { trumpet(392, 0.25, 0.1); trumpet(587.3, 0.7, 0.1, 0.2); drum(0.35, { f: 100 }); },
    defeat() {
      [392, 349.2, 293.7, 220].forEach((f, i) => horn(f, 0.7, 0.1, i * 0.4));
      drum(0.6, { f: 60, delay: 1.5 }); gong(0.08, 110, 2.5, null, 1.5);
    },
    capitalFall() {
      gong(0.16, 98, 5); gong(0.1, 73, 6, null, 0.5);
      [196, 174.6, 146.8, 110, 98].forEach((f, i) => horn(f, 1.0, 0.11, i * 0.55));
      for (let i = 0; i < 6; i++) drum(0.55, { f: 62, delay: 0.3 + i * 0.5 });
    },
    warDecl() { gong(0.16, 87, 4); horn(110, 1.4, 0.14, 0.2); horn(165, 1.2, 0.1, 0.3); drum(0.6, { f: 70, delay: 0.1 }); drum(0.6, { f: 70, delay: 0.7 }); drum(0.7, { f: 65, delay: 1.2 }); },
    gongSoft() { gong(0.07, 110, 2.5); drum(0.28, { f: 80 }); },
    peace() { [440, 554.4, 659.3, 880].forEach((f, i) => bell(f, 0.12, 1.4, i * 0.22)); tone({ f: 220, dur: 2, vol: 0.05, a: 0.5, type: 'sine', delay: 0.1 }); },
    msg() { noise({ dur: 0.12, vol: 0.07, filter: { type: 'bandpass', f: 2600, q: 0.6 } }); bell(659, 0.1, 0.5, 0.05); bell(880, 0.08, 0.5, 0.2); },
    explosion() {
      noise({ dur: 1.5, vol: 0.55, a: 0.005, filter: { type: 'lowpass', f: 1400, f2: 50, q: 0.8 } });
      tone({ f: 90, f2: 24, dur: 1.2, vol: 0.55, type: 'sine', a: 0.004 });
      noise({ dur: 0.9, vol: 0.2, delay: 0.1, filter: { type: 'bandpass', f: 500, f2: 120, q: 0.5 } });
      for (let i = 0; i < 6; i++) noise({ dur: 0.05, vol: 0.12, delay: 0.3 + Math.random() * 0.9, filter: { type: 'highpass', f: 2500 } });
    },
    // topçu atışı: namlu patlaması + uzaktan gelen düşüş gümbürtüsü
    cannon() {
      tone({ f: 120, f2: 38, dur: 0.45, vol: 0.4, type: 'sine', a: 0.003 });
      noise({ dur: 0.35, vol: 0.32, a: 0.002, filter: { type: 'lowpass', f: 1800, f2: 200, q: 0.7 } });
      for (let i = 0; i < 3; i++) {
        noise({ dur: 0.5, vol: 0.16, delay: 0.75 + i * 0.12, filter: { type: 'lowpass', f: 700, f2: 90, q: 0.6 } });
        tone({ f: 70, f2: 30, dur: 0.4, vol: 0.14, type: 'sine', delay: 0.75 + i * 0.12 });
      }
    },
    missile() { noise({ dur: 1.4, vol: 0.28, a: 0.4, filter: { type: 'bandpass', f: 300, f2: 2200, q: 0.9 } }); tone({ f: 70, f2: 160, dur: 1.2, vol: 0.14, type: 'sawtooth', filter: { type: 'lowpass', f: 400 } }); },
    plane() {
      for (let i = 0; i < 3; i++) tone({ f: 92 + i * 3, f2: 80, dur: 1.4, vol: 0.07, a: 0.4, hold: 0.9, type: 'sawtooth', delay: i * 0.06, filter: { type: 'lowpass', f: 420 } });
      noise({ dur: 1.4, vol: 0.06, a: 0.5, filter: { type: 'bandpass', f: 700, q: 0.5 } });
    },
    zap() { tone({ f: 2200, f2: 260, dur: 0.22, vol: 0.14, type: 'sawtooth', filter: { type: 'lowpass', f: 3000 } }); noise({ dur: 0.12, vol: 0.12, filter: { type: 'highpass', f: 4000 } }); },
    win() { [392, 493.9, 587.3, 784, 987.8].forEach((f, i) => trumpet(f, i === 4 ? 1.6 : 0.34, 0.12, i * 0.26)); drum(0.55, { f: 90 }); drum(0.55, { f: 85, delay: 1.3 }); gong(0.08, 196, 4, null, 1.3); },
    lose() { [329.6, 293.7, 261.6, 220, 164.8].forEach((f, i) => horn(f, 1.3, 0.1, i * 0.7)); gong(0.14, 82, 6, null, 0.2); },
  };
  const lastPlay = {};
  const MIN_GAP = { cannon: 0.6, click: 0.04, troop: 0.35, coin: 0.4, msg: 0.5, error: 0.3, good: 0.3, buy: 0.2, march: 0.35, zap: 0.2, gongSoft: 1.2 };
  function sfx(name) {
    if (!ready() || !SFX[name]) return;
    const now = ctx.currentTime, gap = MIN_GAP[name] || 0.08;
    if (lastPlay[name] && now - lastPlay[name] < gap) return;
    lastPlay[name] = now;
    SFX[name]();
  }

  // savaş gürültüsü: çatışma süren her savaş için rastgele kılıç sesleri
  function battleLevel(level) {
    if (!ready() || level <= 0) return;
    if (Math.random() < Math.min(1, level) * 0.55) clashHit(0.55 * Math.min(1, level) + 0.1);
  }

  // ---------- müzik ----------
  // D minör: Dm Dm Bb Bb Gm A Dm A
  const ROOT = [73.42, 73.42, 58.27, 58.27, 49.0, 55.0, 73.42, 55.0];
  const THIRD = [1.189, 1.189, 1.26, 1.26, 1.189, 1.26, 1.189, 1.26];
  const FIFTH = 1.498;
  const mus = { timer: null, step: 0, nextT: 0, mix: { calm: 1, war: 0, battle: 0 }, target: { calm: 1, war: 0, battle: 0 }, g: {} };
  const BPM = { calm: 84, war: 104, battle: 112 };
  const LAYER_VOL = { calm: 0.85, war: 1.9, battle: 1.7 }; // savaş müziği barış müziğinden belirgin şekilde gür

  function startMusic() {
    if (!ctx || mus.timer) return;
    for (const k of ['calm', 'war', 'battle']) {
      const g = ctx.createGain();
      g.gain.value = mus.mix[k] * LAYER_VOL[k];
      g.connect(musicBus); mus.g[k] = g;
    }
    mus.nextT = ctx.currentTime + 0.15;
    mus.timer = setInterval(musicTick, 90);
  }
  function stopMusic() { if (mus.timer) { clearInterval(mus.timer); mus.timer = null; } }

  // mood: {war: boolean, battle: 0..1}
  function setMood(m) {
    const battle = m.war ? Math.max(0, Math.min(1, m.battle || 0)) : 0;
    mus.target.calm = m.war ? 0 : 1;
    mus.target.war = m.war ? 1 : 0;
    mus.target.battle = battle;
  }

  function musicTick() {
    if (!ctx || ctx.state !== 'running') { mus.nextT = Math.max(mus.nextT, ctx ? ctx.currentTime : 0); return; }
    const now = ctx.currentTime;
    for (const k of ['calm', 'war', 'battle']) {
      mus.mix[k] += (mus.target[k] - mus.mix[k]) * 0.1;
      if (Math.abs(mus.target[k] - mus.mix[k]) < 0.004) mus.mix[k] = mus.target[k];
      mus.g[k].gain.setTargetAtTime(mus.mix[k] * LAYER_VOL[k], now, 0.08);
    }
    if (mus.nextT < now - 0.5) mus.nextT = now + 0.05; // sekme arka plandaydı: geri sarma
    const mood = mus.target.war ? (mus.target.battle > 0.3 ? 'battle' : 'war') : 'calm';
    while (mus.nextT < now + 0.4) {
      scheduleStep(mus.step, mus.nextT);
      mus.nextT += 60 / BPM[mood] / 4;
      mus.step++;
    }
  }

  // müzik notaları: bus = katman, t = mutlak zaman
  function mTone(layer, t, o) { tone({ ...o, delay: t - ctx.currentTime, bus: mus.g[layer] }); }
  function mNoise(layer, t, o) { noise({ ...o, delay: t - ctx.currentTime, bus: mus.g[layer] }); }
  function mDrum(layer, t, vol, f) { drum(vol, { f, delay: t - ctx.currentTime, bus: mus.g[layer] }); }

  function scheduleStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16) % 8;
    const root = ROOT[bar], third = THIRD[bar];
    const act = (k) => mus.mix[k] > 0.03 || mus.target[k] > 0.03;
    const barDur = 16 * (60 / 100 / 4); // yaklaşık pad süresi

    if (act('calm')) {
      if (s === 0) {
        // sakin pad + bas
        [root * 4, root * 4 * third, root * 4 * FIFTH].forEach((f, i) => {
          mTone('calm', t, { f, dur: barDur + 0.8, vol: 0.05, a: 1.1, hold: barDur * 0.5, type: i === 0 ? 'triangle' : 'sine', filter: { type: 'lowpass', f: 1400 } });
        });
        mTone('calm', t, { f: root * 2, dur: barDur + 0.6, vol: 0.09, a: 0.6, hold: barDur * 0.6, type: 'sine' });
      }
      // lavta: tınılı arpej
      const arp = [0, 3, 6, 8, 11, 14];
      if (arp.includes(s)) {
        const i = arp.indexOf(s);
        const notes = [root * 8, root * 8 * third, root * 8 * FIFTH, root * 16, root * 8 * FIFTH, root * 8 * third];
        mTone('calm', t, { f: notes[i], dur: 0.9, vol: 0.075, a: 0.004, type: 'triangle', filter: { type: 'lowpass', f: 2600, f2: 500 } });
        if (i === 0 || i === 3) mTone('calm', t, { f: notes[i] * 2, dur: 0.4, vol: 0.02, a: 0.004, type: 'sine' });
      }
    }

    if (act('war')) {
      // taiko
      if (s === 0 || s === 8) mDrum('war', t, 0.62, 78);
      if (s === 6 || s === 14) mDrum('war', t, 0.28, 92);
      if (s === 11) mDrum('war', t, 0.22, 100);
      // bas yaylılar: dörtlük başına dörtnala ritmi
      if ([0, 2, 3].includes(s % 4)) {
        const accent = s % 4 === 0;
        let f = root * 2;
        if (s === 15 && (bar === 3 || bar === 7)) f = root * 2 * 1.0595; // gerilim notası
        if (s === 7 || s === 11) f = root * 2 * (s === 7 ? FIFTH : 1);
        mTone('war', t, { f, dur: 0.17, vol: accent ? 0.13 : 0.085, a: 0.006, type: 'sawtooth', filter: { type: 'lowpass', f: 520, f2: 220, q: 2 } });
        mTone('war', t, { f: f / 2, dur: 0.19, vol: accent ? 0.1 : 0.06, a: 0.006, type: 'sine' });
      }
      // pirinç vuruşu
      if (s === 0 && bar % 2 === 0) {
        [root * 4, root * 4 * third, root * 4 * FIFTH, root * 8].forEach((f) => {
          [-8, 8].forEach((dt) => mTone('war', t, { f, dur: 1.2, vol: 0.036, a: 0.05, hold: 0.25, type: 'sawtooth', detune: dt, filter: { type: 'lowpass', f: 700, f2: 2000, q: 1 } }));
        });
      }
      // uzun boru çağrısı
      if (s === 8 && bar === 4) {
        [root * 8, root * 8 * FIFTH].forEach((f) => mTone('war', t, { f, dur: 2.2, vol: 0.04, a: 0.4, hold: 1.2, type: 'sawtooth', filter: { type: 'lowpass', f: 900, f2: 1600, q: 1 } }));
      }
    }

    if (act('battle')) {
      if (s === 4 || s === 12) {
        mDrum('battle', t, 0.4, 130);
        mNoise('battle', t, { dur: 0.16, vol: 0.2, filter: { type: 'bandpass', f: 1900, q: 0.8 } }); // trampet
      }
      if (s % 2 === 0) mNoise('battle', t, { dur: 0.04, vol: s % 4 === 2 ? 0.085 : 0.05, filter: { type: 'highpass', f: 6000 } });
      // keman spiccato arpeji
      const chordNotes = [root * 8, root * 8 * third, root * 8 * FIFTH, root * 16];
      mTone('battle', t, { f: chordNotes[s % 4], dur: 0.1, vol: 0.034, a: 0.004, type: 'sawtooth', filter: { type: 'bandpass', f: 1800, q: 1.2 } });
      // koro benzeri yükselen pad
      if (s === 0 && bar % 2 === 1) {
        [root * 4 * third, root * 4 * FIFTH, root * 8].forEach((f) => {
          [-9, 9].forEach((dt) => mTone('battle', t, { f, dur: 3.6, vol: 0.026, a: 1.4, hold: 1.8, type: 'sawtooth', detune: dt, filter: { type: 'lowpass', f: 1100, q: 0.7 } }));
        });
      }
      // zil / gong
      if (s === 0 && bar % 4 === 0) {
        mNoise('battle', t, { dur: 1.5, vol: 0.09, a: 0.01, filter: { type: 'highpass', f: 4500 } });
        mTone('battle', t, { f: root * 2, dur: 3, vol: 0.07, a: 0.004, type: 'sine' });
      }
    }
  }

  // ---------- oyun olayları ----------
  function onGameEvent(ev, game) {
    if (!ctx) return;
    const me = game.playerId;
    if (ev.type === 'income') { if (ev.cid === undefined || ev.cid === me) sfx('coin'); return; }
    if (ev.type === 'proposal') { if (ev.p && ev.p.to === me) sfx('msg'); return; }
    if (ev.type === 'gameover') { if (ev.cid === undefined || ev.cid === me) sfx(ev.win ? 'win' : 'lose'); return; }
    if (ev.type === 'fx') {
      if (ev.kind === 'explosion') sfx('explosion');
      else if (ev.kind === 'intercept') sfx('zap');
      return;
    }
    if (ev.type !== 'sound') return;
    switch (ev.name) {
      case 'march': if (ev.cid === me) sfx('march'); break;
      case 'attackLaunch': if (ev.cid === me) sfx('horn'); else if (ev.target === me) sfx('alarm'); break;
      case 'battleStart': if (ev.cid === me || ev.target === me) sfx('clash'); break;
      case 'repelled': if (ev.target === me) sfx('victorySmall'); else if (ev.cid === me) sfx('error'); break;
      case 'capture':
        if (ev.capital) break; // başkent düşünce 'eliminated' sesi çalar
        if (ev.cid === me) sfx('victory'); else if (ev.prev === me) sfx('defeat');
        break;
      case 'eliminated':
        if (ev.cid === me) break; // oyuncu yenilgisi 'gameover' ile çalar
        sfx('capitalFall'); break;
      case 'warDeclared': sfx(ev.cid === me || ev.target === me ? 'warDecl' : 'gongSoft'); break;
      case 'peace': if (ev.cid === me || ev.target === me) sfx('peace'); break;
      case 'troopReady': if (ev.cid === me) sfx('troop'); break;
      case 'recall': if (ev.cid === me) { sfx('march'); sfx('horn'); } break;
      case 'armyJoin': if (ev.cid === me) sfx('good'); break;
      case 'cannon': if (ev.cid === me || ev.target === me) sfx('cannon'); break;
      case 'buy':
        if (ev.item === 'missile') sfx('missile');
        else if (ev.item === 'plane') sfx('plane');
        else if (ev.cid === me) sfx(ev.item === 'blitz' ? 'horn' : 'buy');
        break;
      default: break;
    }
  }

  // ---------- ayarlar ----------
  function applyVolumes() {
    if (!ctx) return;
    master.gain.setTargetAtTime(state.muted ? 0 : 1, ctx.currentTime, 0.03);
    sfxBus.gain.value = state.sfx;
    musicBus.gain.value = state.music * 0.8;
  }
  function setMuted(m) { state.muted = !!m; saveState(); applyVolumes(); if (!m) resume(); }
  function toggle() { setMuted(!state.muted); return !state.muted; }

  // tarayıcı sekmesi arka plana geçince sustur
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend().catch(() => { /* yok */ });
    else resume();
  });

  G.Audio = {
    init, resume, sfx, startMusic, stopMusic, setMood, battleLevel, onGameEvent, setMuted, toggle,
    get muted() { return state.muted; },
    get running() { return !!ctx && ctx.state === 'running'; },
    unlock() { init(); resume(); },
    // çıkış seviyesi (RMS, 0..1): müziğin/seslerin gerçekten üretildiğini denetlemek için
    level() {
      if (!analyser) return 0;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    },
  };
})();
