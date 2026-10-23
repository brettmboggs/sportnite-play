// Audio engine: Kenney CC0 samples + baked synth sounds (sfx.js) + adaptive procedural music (music.js).
// Signal flow:
//   voices -> [gain -> air-absorption lowpass -> HRTF/equal-power panner] -> sfx bus ----\
//          \-> far send -> echo + outdoor reverb -> sfx bus                              |
//   ui bus, jingle bus, music (-> duck gain -> music bus) -----------------------------> mix -> glue comp -> limiter -> master
import { rand, clamp } from './utils.js';
import { RECIPES, Kit, bakeRecipe } from './sfx.js';
import { Music, makeImpulse } from './music.js';

const MAX_VOICES = 40;
const MAX_HRTF = 14;
const STEP_RANGE = 50; // enemy footsteps: audible distance (m) ...
const STEP_VOICES = 6; // ... for the nearest few moving characters
const WHIZ_DIST = 2.5; // bullets passing this close to your head whiz
const TENSE_PHASE = 4; // storm phase where the endgame music layer comes in (the last two circles)
// biome -> [ambience bed recipe, level]
const BEDS = { city: ['ambCity', 0.16], jungle: ['ambJungle', 0.2], mountains: ['ambMountain', 0.1], haunted: ['ambHaunted', 0.1], candy: ['ambCandy', 0.16] };

const n3 = (base, ...idx) => idx.map((i) => `${base}_${String(i).padStart(3, '0')}`);
const r5 = [0, 1, 2, 3, 4];

// name -> { files, vol, rate:[min,max], range, ref, synth, synthVol, prio, far }
const SFX = {
  footGrass: { files: n3('footstep_grass', ...r5), range: 28, ref: 2, prio: 0.2 },
  footHard: { files: n3('footstep_concrete', ...r5), range: 28, ref: 2, prio: 0.2 },
  footSnow: { files: n3('footstep_snow', ...r5), range: 28, ref: 2, prio: 0.2 },
  footWood: { files: n3('footstep_wood', ...r5), range: 30, ref: 2, prio: 0.2 },
  footCarpet: { files: n3('footstep_carpet', ...r5), range: 24, ref: 2, prio: 0.2 },
  footMetal: { files: n3('impactMetal_light', ...r5), vol: 0.35, rate: [1.3, 1.5], range: 30, ref: 2, prio: 0.2 },
  hitWood: { files: [...n3('impactWood_heavy', ...r5), ...n3('impactWood_medium', 0, 1, 2)], synth: 'thockWood', synthVol: 0.5, range: 70, ref: 4 },
  hitMetal: { files: [...n3('impactMetal_heavy', ...r5), ...n3('impactPlate_heavy', 0, 1, 2)], synth: 'thockMetal', synthVol: 0.35, range: 70, ref: 4 },
  hitStone: { files: n3('impactMining', ...r5), synth: 'thockStone', synthVol: 0.5, range: 70, ref: 4 },
  hitBody: { files: n3('impactPunch_medium', ...r5), range: 50, ref: 3 },
  hitHeavy: { files: n3('impactPunch_heavy', ...r5), range: 60, ref: 3 },
  hitShieldWorld: { files: n3('impactGlass_light', ...r5), vol: 0.7, synth: 'hitShield', synthVol: 0.35, range: 50, ref: 3 },
  ding: { files: n3('impactBell_heavy', ...r5), range: 60 },
  build: { files: [...n3('impactPlank_medium', 0, 1, 2, 3), ...n3('impactWood_light', 0, 1, 2)], synth: 'buildThump', synthVol: 0.5, range: 60, ref: 4 },
  buildWood: { files: [...n3('impactPlank_medium', 0, 1, 2, 3), ...n3('impactWood_light', 0, 1, 2)], synth: 'buildThump', synthVol: 0.5, range: 60, ref: 4 },
  buildBrick: { files: n3('impactSoft_heavy', ...r5), synth: 'thockStone', synthVol: 0.6, range: 60, ref: 4 },
  buildMetal: { files: n3('impactMetal_medium', ...r5), synth: 'thockMetal', synthVol: 0.4, range: 60, ref: 4 },
  explode: { files: [...n3('explosionCrunch', ...r5), ...n3('lowFrequency_explosion', 0, 1)], range: 480, ref: 14, far: true, prio: 2 },
  laser: { files: [...n3('laserLarge', 0, 1, 2), ...n3('laserRetro', 0, 2)] },
  zap: { files: ['zap1', 'zap2', 'zapThreeToneUp'] },
  forceField: { files: n3('forceField', ...r5) },
  thruster: { files: n3('thrusterFire', ...r5) },
  click: { files: n3('click', 1, 2, 3, 4) },
  select: { files: n3('select', 1, 2, 3) },
  confirm: { files: n3('confirmation', 1, 2) },
  error: { files: n3('error', 1, 4) },
  open: { files: ['open_001', 'maximize_003'] },
  drop: { files: n3('drop', 1, 2, 3, 4) },
  pickup: { files: n3('pluck', 1, 2) },
  powerUp: { files: ['powerUp1', 'powerUp2', 'powerUp3', 'powerUp5'] },
  phaser: { files: ['phaserUp1', 'phaserUp3'] },
  glass: { files: n3('glass', 1, 2, 3, 4, 5, 6) },
  slime: { files: n3('slime', 0, 1) },
  // new names
  land: { files: n3('impactSoft_heavy', ...r5), vol: 0.8, synth: 'land', synthVol: 0.7, range: 40, ref: 3 },
  chestOpen: { files: n3('doorOpen', 0, 1, 2), vol: 0.5, synth: 'chestOpen', synthVol: 0.8, range: 45, ref: 4, prio: 2 },
  gliderDeploy: { files: [], synth: 'gliderDeploy', range: 50, ref: 4 },
  pickupWeapon: { files: n3('impactMetal_light', ...r5), vol: 0.3, synth: 'weaponGrab', range: 20, prio: 2 },
  pickupAmmo: { files: [], synth: 'ammoGrab', range: 20, prio: 2 },
  pickupMats: { files: n3('impactWood_light', ...r5), vol: 0.5, rate: [1.2, 1.4], range: 20, prio: 2 },
  pickupGold: { files: [], synth: 'coin', range: 20, prio: 2 },
  pickupItem: { files: n3('pluck', 1, 2), vol: 0.6, synth: 'itemGrab', range: 20, prio: 2 },
  whiz: { files: [], synth: 'whiz', range: 30, ref: 3 },
};
const JINGLES = { win: 'jingles_HIT09', lose: 'jingles_NES09', level: 'jingles_PIZZI03', chest: 'jingles_STEEL00', start: 'jingles_HIT00', unlock: 'jingles_SAX03' };

// per-gun-sound playback profile. range = audible distance (m), ref = full-volume radius
const GUNS = {
  pistol: { range: 260, ref: 8 },
  revolver: { range: 340, ref: 10 },
  smg: { range: 240, ref: 8 },
  ar: { range: 330, ref: 10 },
  shotgun: { range: 300, ref: 10, after: [['pump', 0.42]] },
  sniper: { range: 560, ref: 14, after: [['boltBack', 0.55], ['boltFwd', 0.8]] },
  minigun: { range: 300, ref: 9 },
  rocket: { range: 400, ref: 12 },
  launcher: { range: 300, ref: 10 },
  bow: { range: 120, ref: 6, far: false },
  beam: { range: 110, ref: 6, far: false },
  zap: { range: 200, ref: 8 },
  bubble: { range: 70, ref: 5, far: false },
  whoosh: { range: 60, ref: 5, far: false },
  chicken: { range: 120, ref: 6 },
  splat: { range: 90, ref: 6, far: false },
  golf: { range: 200, ref: 8 },
  kick: { range: 80, ref: 6, far: false },
  sword: { range: 50, ref: 4, far: false },
  bonk: { range: 60, ref: 4, far: false },
  bat: { range: 40, ref: 3, far: false },
  throw: { range: 40, ref: 3, far: false },
  empty: { range: 20, ref: 2, far: false, heat: 0 },
  reload: { range: 30, ref: 3, far: false, heat: 0 },
};

// reload choreography per weapon class: [fraction of reload time, part]
const RELOADS = {
  Pistol: [[0.1, 'magOut'], [0.6, 'magIn'], [0.85, 'slide']],
  SMG: [[0.1, 'magOut'], [0.55, 'magIn'], [0.85, 'slide']],
  Rifle: [[0.12, 'magOut'], [0.6, 'magIn'], [0.88, 'boltFwd']],
  Sniper: [[0.1, 'boltBack'], [0.5, 'shellIn'], [0.85, 'boltFwd']],
  Heavy: [[0.1, 'magOut'], [0.35, 'boltBack'], [0.7, 'magIn'], [0.9, 'slide']],
  Explosive: [[0.15, 'magOut'], [0.7, 'magIn'], [0.9, 'boltFwd']],
  Bow: [[0.1, 'stringDraw']],
  Wacky: [[0.05, 'energy'], [0.85, 'magIn']],
  Sports: [[0.15, 'magOut'], [0.7, 'magIn']],
};

// bake order: what you hear first gets rendered first
const BAKE_ORDER = ['hitBody', 'hitHead', 'hitShield', 'shieldBreak', 'elim', 'elimHead', 'gun_ar', 'gun_smg', 'gun_pistol', 'gun_shotgun', 'gun_sniper', 'gun_bat'];

const NULL_LOOP = { alive: false, setPosition() {}, setVolume() {}, setRate() {}, setFilter() {}, stop() {} };

// a looping (optionally positional) sound with a handle the game can steer
class Loop {
  constructor(a, name, { pos = null, range = 30, ref = 3, vol = 1, rate = 1, filter = 20000, bus = null, hrtf = true } = {}) {
    const c = a.ctx;
    this.a = a; this.name = name; this.alive = true; this.started = false;
    this.range = range; this.ref = ref; this.vol = vol;
    this.pos = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
    this.src = c.createBufferSource(); this.src.loop = true; this.src.playbackRate.value = rate;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = filter;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.filter); this.filter.connect(this.gain);
    if (this.pos) {
      this.panner = a.makePanner(hrtf ? 'HRTF' : 'equalpower');
      this.gain.connect(this.panner); this.panner.connect(bus || a.sfxBus);
    } else this.gain.connect(bus || a.sfxBus);
    a.loops.add(this);
    this.update(c.currentTime);
  }

  setPosition(p) { if (!p) return; if (!this.pos) this.pos = { x: 0, y: 0, z: 0 }; this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z; }
  setVolume(v) { this.vol = v; }
  setRate(r) { if (this.alive) this.src.playbackRate.setTargetAtTime(r, this.a.ctx.currentTime, 0.1); }
  setFilter(f) { if (this.alive) this.filter.frequency.setTargetAtTime(clamp(f, 40, 20000), this.a.ctx.currentTime, 0.1); }

  update(now) {
    if (!this.alive) return;
    if (!this.started) {
      const bufs = this.a.baked.get(this.name);
      if (!bufs) return; // still baking; try again next frame
      this.src.buffer = bufs[0];
      this.src.start(now, Math.random() * bufs[0].duration);
      this.started = true;
    }
    let g = this.vol;
    if (this.pos && this.panner) {
      g *= this.a.falloff(this.a.dist(this.pos), this.range, this.ref);
      this.a.setPannerPos(this.panner, this.pos);
    }
    this.gain.gain.setTargetAtTime(g, now, 0.08);
  }

  stop(fade = 0.4) {
    if (!this.alive) return;
    this.alive = false;
    this.a.loops.delete(this);
    const now = this.a.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0, now, Math.max(0.01, fade / 4));
    if (this.started) this.src.stop(now + fade + 0.05);
    setTimeout(() => { this.gain.disconnect(); if (this.panner) this.panner.disconnect(); }, (fade + 0.2) * 1000);
  }
}

export class Audio {
  constructor() {
    this.buffers = new Map();
    this.baked = new Map();
    this.ready = false;
    this.volume = { master: 0.8, sfx: 1, music: 0.45 };
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.voices = [];
    this.hrtfCount = 0;
    this.recent = new Map();
    this.lastPick = new Map();
    this.loops = new Set();
    this.chestHums = new Map();
    this.heat = 0;
    this.baseIntensity = 0.15;
    this.lastHit = { t: -1, head: false };
    this.slowT = 0;
    this.stormPhase = -1; this.stormShrinking = false; this.pState = null;
    this.musicAuto = false; this.autoSong = null; // in a match, update() picks the music (drop theme -> silence -> endgame)
    this.steps = new WeakMap(); this.stepNear = new Set(); // enemy footstep stride timers
    this.beds = {}; this.supply = new Set(); this.lastWhiz = -1;
  }

  // ctx can be injected (e.g. an OfflineAudioContext for level tests)
  init(ctx = null) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
    const c = this.ctx = ctx || new AudioContext({ latencyHint: 'interactive' });
    // master chain: glue compressor -> brick-wall-ish limiter -> master volume
    this.mix = c.createGain();
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.004; glue.release.value = 0.18;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.master = c.createGain();
    this.mix.connect(glue); glue.connect(lim); lim.connect(this.master); this.master.connect(c.destination);
    this.glue = glue; this.limiter = lim;
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.mix);
    this.uiBus = c.createGain(); this.uiBus.connect(this.mix);
    this.jingleBus = c.createGain(); this.jingleBus.connect(this.mix);
    this.musicBus = c.createGain(); this.musicBus.connect(this.mix);
    this.musicDuck = c.createGain(); this.musicDuck.connect(this.musicBus);
    // ambience (biome beds, ground wind) sits under the sfx volume and dips when a fight starts
    this.ambBus = c.createGain(); this.ambBus.connect(this.sfxBus);
    // noise buffer for synth sounds
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // far-away sounds: slapback echo off the hills + an outdoor reverb tail
    this.farBus = c.createGain();
    const echo = c.createDelay(1); echo.delayTime.value = 0.31;
    const efb = c.createGain(); efb.gain.value = 0.28;
    const elp = c.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 1600;
    this.farBus.connect(echo); echo.connect(elp); elp.connect(efb); efb.connect(echo); elp.connect(this.sfxBus);
    const verb = c.createConvolver(); verb.buffer = makeImpulse(c, 2.2, 4);
    const vg = c.createGain(); vg.gain.value = 0.5;
    this.farBus.connect(verb); verb.connect(vg); vg.connect(this.sfxBus);
    this.mus = new Music(c, this.musicDuck, this.musicBus, this.noise);
    this.applyVolume();
    this.loadAll();
    this.bakeAll();
  }

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = this.volume;
    const sfx = v.sfx ?? 1;
    this.master.gain.setTargetAtTime(v.master ?? 0.8, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.03);
    this.uiBus.gain.setTargetAtTime(sfx * (v.ui ?? 1), t, 0.03);
    this.musicBus.gain.setTargetAtTime(v.music ?? 0.45, t, 0.03);
  }

  async loadAll() {
    const names = new Set();
    for (const def of Object.values(SFX)) def.files.forEach((n) => names.add('sfx/' + n));
    for (const n of Object.values(JINGLES)) names.add('music/' + n);
    await Promise.all([...names].map(async (n) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/${n}.ogg`);
        if (!res.ok) return;
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(n, buf);
      } catch { /* missing sound is fine */ }
    }));
    this.ready = true;
  }

  async bakeAll() {
    const order = [...BAKE_ORDER, ...Object.keys(RECIPES).filter((n) => !BAKE_ORDER.includes(n))];
    // each OfflineAudioContext has a fixed startup cost, so render in parallel batches
    for (let i = 0; i < order.length; i += 12) {
      await Promise.all(order.slice(i, i + 12).map(async (name) => {
        try { this.baked.set(name, await bakeRecipe(name, this.ctx.sampleRate, this.noise)); } catch (e) { console.warn('audio bake failed', name, e); }
      }));
    }
    this.bakedAll = true;
  }

  // ---------- spatial helpers ----------
  setListener(pos, fwd) {
    if (!Number.isFinite(pos.x + pos.y + pos.z + fwd.x + fwd.y + fwd.z)) return; // Web Audio throws on NaN
    const L = this.listener;
    L.x = pos.x; L.y = pos.y; L.z = pos.z;
    const h = Math.hypot(fwd.x, fwd.z);
    if (h > 1e-3) { L.fx = fwd.x / h; L.fz = fwd.z / h; }
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = L.fx; l.forwardY.value = 0; l.forwardZ.value = L.fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(L.fx, 0, L.fz, 0, 1, 0); }
    this.tickVoices();
  }

  dist(p) { const L = this.listener; return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z); }

  // full volume inside `ref`, gentle inverse falloff, faded to silence at `range`
  falloff(d, range, ref) {
    if (d >= range) return 0;
    const w = 1 - (d / range) ** 2;
    return Math.min(1, Math.pow(ref / Math.max(ref, d), 0.75)) * w * w;
  }

  // kept for old callers: {g, pan}
  spatial(pos, range = 80) {
    if (!pos) return { g: 1, pan: 0 };
    const d = this.dist(pos), L = this.listener;
    const pan = d > 0.5 ? clamp(((pos.x - L.x) * -L.fz + (pos.z - L.z) * L.fx) / d, -1, 1) : 0;
    return { g: this.falloff(d, range, range / 10), pan };
  }

  makePanner(model = 'HRTF') {
    const p = this.ctx.createPanner();
    p.panningModel = model; p.distanceModel = 'inverse'; p.rolloffFactor = 0; p.refDistance = 1;
    return p;
  }

  setPannerPos(p, pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  }

  tickVoices() {
    const now = this.ctx.currentTime;
    this.prune(now);
    for (const l of this.loops) l.update(now);
    // combat heat cools off over time and feeds the adaptive music
    if (this.lastTick) this.heat = Math.max(0, this.heat - (now - this.lastTick) * 0.1);
    this.lastTick = now;
    this.mus.setIntensity(this.baseIntensity + this.heat);
  }

  prune(now) {
    const v = this.voices;
    for (let i = v.length - 1; i >= 0; i--) {
      if (v[i].end > now) continue;
      this.release(v[i]);
      v[i] = v[v.length - 1]; v.pop();
    }
  }

  release(voice) {
    for (const n of voice.nodes) n.disconnect();
    if (voice.hrtf) this.hrtfCount--;
  }

  // allocate a voice chain; returns its input node (or null if inaudible / culled)
  voice({ pos = null, range = 60, ref = null, vol = 1, prio = 1, far = false, delay = 0, key = null, bus = null } = {}, dur = 1) {
    const c = this.ctx, now = c.currentTime;
    this.prune(now);
    let g = vol, d = 0;
    if (pos) {
      d = this.dist(pos);
      g *= this.falloff(d, range, ref || Math.max(2, range / 10));
    }
    if (g < 0.003) return null;
    if (key) { // a dozen bots on miniguns shouldn't stack 40 identical voices
      const r = this.recent.get(key);
      if (r && now - r.t < 0.05) { if (r.n >= 4) return null; r.n++; } else this.recent.set(key, { t: now, n: 1 });
    }
    const score = g * prio;
    if (this.voices.length >= MAX_VOICES) { // steal the quietest / least important voice
      let mi = 0;
      for (let i = 1; i < this.voices.length; i++) if (this.voices[i].score < this.voices[mi].score) mi = i;
      const victim = this.voices[mi];
      if (victim.score >= score) return null;
      victim.gain.gain.setTargetAtTime(0, now, 0.006);
      this.voices[mi] = this.voices[this.voices.length - 1]; this.voices.pop();
      setTimeout(() => this.release(victim), 80);
    }
    const gain = c.createGain(); gain.gain.value = g;
    const nodes = [gain];
    let hrtf = false;
    if (pos) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.value = clamp(20000 * Math.exp(-d / 110), 500, 20000); // air absorption
      hrtf = d < 45 && this.hrtfCount < MAX_HRTF;
      if (hrtf) this.hrtfCount++;
      const p = this.makePanner(hrtf ? 'HRTF' : 'equalpower');
      this.setPannerPos(p, pos);
      gain.connect(lp); lp.connect(p); p.connect(bus || this.sfxBus);
      nodes.push(lp, p);
      if (far && d > 20) {
        const s = c.createGain(); s.gain.value = Math.min(1, (d - 20) / 140) * 0.9;
        gain.connect(s); s.connect(this.farBus); nodes.push(s);
      }
    } else {
      gain.connect(bus || this.sfxBus);
      if (far) { const s = c.createGain(); s.gain.value = 0.18; gain.connect(s); s.connect(this.farBus); nodes.push(s); }
    }
    this.voices.push({ nodes, gain, end: now + delay + dur + 0.1, score, hrtf });
    return gain;
  }

  playBuffer(buf, o = {}) {
    const rate = o.rate || 1;
    const v = this.voice(o, buf.duration / rate);
    if (!v) return;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    s.connect(v); s.start(this.ctx.currentTime + (o.delay || 0));
  }

  // play a baked synth recipe (or synthesize it live if baking hasn't finished yet)
  synth(name, o = {}) {
    if (!this.ctx) return;
    const bufs = this.baked.get(name);
    if (bufs) { this.playBuffer(bufs[Math.floor(Math.random() * bufs.length)], { ...o, rate: (o.rate || 1) * rand(0.97, 1.03) }); return; }
    const r = RECIPES[name];
    if (!r) return;
    const v = this.voice({ ...o, vol: (o.vol ?? 1) * 0.5 }, r.dur);
    if (v) r.fn(new Kit(this.ctx, this.noise, Math.random()), v, this.ctx.currentTime + (o.delay || 0));
  }

  pickFile(name, files) {
    if (files.length < 2) return files[0];
    const last = this.lastPick.get(name);
    let i = Math.floor(Math.random() * files.length);
    if (i === last) i = (i + 1) % files.length;
    this.lastPick.set(name, i);
    return files[i];
  }

  play(name, { pos = null, range, ref, vol = 1, rate = 1, delay = 0, prio, bus = null } = {}) {
    if (!this.ctx) return;
    const def = SFX[name];
    if (!def) { // raw path like 'sfx/click_001'
      const buf = this.buffers.get(name);
      if (buf) this.playBuffer(buf, { pos, range: range || 60, vol, rate, delay, prio: prio ?? 1, bus });
      return;
    }
    const o = { pos, range: range || def.range || 60, ref: ref ?? def.ref, delay, prio: prio ?? def.prio ?? 1, far: def.far, bus };
    if (def.files.length) {
      const buf = this.buffers.get('sfx/' + this.pickFile(name, def.files));
      const [a, b] = def.rate || [0.94, 1.06];
      if (buf) this.playBuffer(buf, { ...o, vol: vol * (def.vol ?? 1), rate: rate * rand(a, b), key: name });
    }
    if (def.synth) this.synth(def.synth, { ...o, vol: vol * (def.synthVol ?? 1), rate, key: name + '~' });
  }

  jingle(name, vol = 0.7) {
    if (!this.ctx) return;
    const buf = this.buffers.get('music/' + JINGLES[name]);
    if (!buf) return;
    const g = this.ctx.createGain(); g.gain.value = vol; g.connect(this.jingleBus);
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start();
    s.onended = () => g.disconnect();
    this.duck(0.45, buf.duration);
  }

  ui(name) { this.play(name, { vol: 0.45, bus: this.uiBus, prio: 5 }); }

  // briefly push the music down (big explosions, stingers)
  duck(amount = 0.5, dur = 0.4) {
    if (!this.ctx) return;
    const p = this.musicDuck.gain, t = this.ctx.currentTime;
    const target = Math.min(p.value, 1 - clamp(amount, 0, 0.9));
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
    p.setTargetAtTime(target, t, 0.015);
    p.setTargetAtTime(1, t + dur, 0.35);
  }

  // ---------- weapons ----------
  gun(kind, pos, isPlayer = false) {
    if (!this.ctx) return;
    const G = GUNS[kind] || GUNS.ar;
    const recipe = RECIPES['gun_' + kind] ? 'gun_' + kind : 'gun_ar';
    const o = { pos: isPlayer ? null : pos, range: G.range, ref: G.ref, vol: isPlayer ? 0.8 : 1, prio: isPlayer ? 3 : 1, far: G.far !== false, key: (isPlayer ? 'p_' : 'g_') + kind };
    this.synth(recipe, o);
    if (G.after) for (const [part, at] of G.after) this.synth(part, { ...o, range: 40, ref: 3, far: false, delay: at, vol: o.vol * 0.8, key: null });
    if (G.heat !== 0) {
      if (isPlayer) this.heat += 0.05;
      else if (pos) { const d = this.dist(pos); if (d < 60) this.heat += 0.07 * (1 - d / 60); }
      this.heat = Math.min(this.heat, 0.6);
    }
  }

  // class-specific reload choreography; cls = weapon def.cls, dur = reload seconds
  reload(cls, pos, isPlayer = false, dur = 2) {
    if (!this.ctx) return;
    const o = { pos: isPlayer ? null : pos, range: 30, ref: 3, vol: isPlayer ? 0.9 : 1, prio: isPlayer ? 2 : 0.5 };
    if (cls === 'Shotgun') {
      const n = clamp(Math.floor(dur / 0.6), 2, 6);
      for (let i = 0; i < n; i++) this.synth('shellIn', { ...o, delay: dur * (0.08 + 0.72 * i / n) });
      this.synth('pump', { ...o, delay: dur * 0.86 });
      return;
    }
    const seq = RELOADS[cls];
    if (!seq) { this.gun('reload', pos, isPlayer); return; }
    for (const [at, part] of seq) this.synth(part, { ...o, delay: dur * at });
  }

  // one shell going into a shotgun (for shell-by-shell reloads)
  shellIn(pos, isPlayer = false) {
    if (this.ctx) this.synth('shellIn', { pos: isPlayer ? null : pos, range: 30, ref: 3, vol: isPlayer ? 0.9 : 1, prio: isPlayer ? 2 : 0.5 });
  }

  explosion(pos) {
    if (!this.ctx) return;
    this.synth('explosion', { pos, range: 480, ref: 14, vol: 1, prio: 2, far: true, key: 'boom' });
    this.play('explode', { pos, vol: 0.55 });
    const d = pos ? this.dist(pos) : 0;
    if (d < 70) { this.duck(0.6 * (1 - d / 70), 0.5); this.heat = Math.min(0.6, this.heat + 0.15); }
  }

  // ---------- feedback ----------
  // head: headshot; opts.shield: hit landed on shield; opts.broke: that hit broke the shield
  hitmarker(head = false, opts = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // shotgun pellets arrive as many hits at once: play one sound (upgrade to the headshot ding if needed)
    if (now - this.lastHit.t < 0.035 && (this.lastHit.head || !head) && !opts.broke) return;
    this.lastHit.t = now; this.lastHit.head = head;
    const o = { vol: 1, prio: 4 };
    if (opts.broke) this.synth('shieldBreak', o);
    else if (opts.shield) this.synth('hitShield', o);
    if (head) this.synth('hitHead', o);
    else this.synth('hitBody', { ...o, vol: opts.shield ? 0.5 : 1 });
    this.heat = Math.min(0.6, this.heat + 0.06);
  }

  elim(head = false) {
    if (!this.ctx) return;
    this.synth(head ? 'elimHead' : 'elim', { vol: 1, prio: 5 });
    this.duck(0.3, 0.5);
    this.heat = Math.min(0.6, this.heat + 0.2);
  }

  // pickaxe / bullet impact on a material: 'wood' | 'brick' | 'stone' | 'metal' | 'body' | 'shield'
  impact(mat, pos, vol = 0.8) {
    const name = { wood: 'hitWood', brick: 'hitStone', stone: 'hitStone', metal: 'hitMetal', body: 'hitBody', shield: 'hitShieldWorld' }[mat] || 'hitWood';
    this.play(name, { pos, vol });
  }

  build(mat, pos) {
    this.play(mat === 'metal' ? 'buildMetal' : mat === 'brick' ? 'buildBrick' : 'buildWood', { pos, vol: 0.75 });
  }

  // it: a loot entry ({kind, item}) or one of 'weapon' | 'ammo' | 'mats' | 'gold' | 'item'
  pickup(it) {
    const k = typeof it === 'string' ? it : it.kind === 'item' ? (it.item && it.item.type === 'weapon' ? 'weapon' : 'item') : it.kind;
    const name = { weapon: 'pickupWeapon', ammo: 'pickupAmmo', mats: 'pickupMats', gold: 'pickupGold', item: 'pickupItem' }[k] || 'pickup';
    this.play(name, { vol: 0.8 });
  }

  chestOpen(pos) { this.play('chestOpen', { pos, vol: 0.9 }); }

  footstep(surface = 'grass', pos = null, vol = 0.25) {
    const name = 'foot' + surface[0].toUpperCase() + surface.slice(1);
    this.play(SFX[name] ? name : 'footGrass', { pos, vol });
  }

  stinger(name) {
    if (!this.ctx) return;
    if (name === 'victory' || name === 'defeat') this.duck(0.6, 2);
    this.mus.stinger(name);
  }

  // ---------- loops ----------
  // returns a handle: setPosition(v3) / setVolume(v) / setRate(r) / setFilter(hz) / stop(fade)
  loop(name, opts = {}) {
    if (!this.ctx || !RECIPES[name]) return NULL_LOOP;
    return new Loop(this, name, opts);
  }

  // a closed chest sings so you can find it by ear: clear at ~15 m, gone by ~30 m
  chestHum(pos) { return this.loop('chestHum', { pos, range: 30, ref: 5, vol: 0.7 }); }

  stopLoops() {
    for (const k of ['wind', 'gliderLoop', 'stormLoop', 'blimpLoop', 'useLoop']) if (this[k]) { this[k].stop(0.5); this[k] = null; }
    for (const h of this.chestHums.values()) h.stop(0.3);
    this.chestHums.clear();
    for (const k in this.beds) this.beds[k].loop.stop(1);
    this.beds = {};
    for (const s of this.supply) if (s.loop) s.loop.stop(0.3);
    this.supply.clear();
  }

  // Per-frame hook: game = the Game. Drives the match soundscape: wind, glider, blimp, storm, chests, biome beds,
  // enemy footsteps, bullet whizzes, player feel (equip, heartbeat, heals, landings) and the match music.
  update(dt, game = null) {
    if (!this.ctx) return;
    const m = game && game.state === 'match' ? game.match : null;
    const p = game && game.player;
    if (!m || !p) { if (this.inMatch) this.leaveMatch(); return; }
    if (game !== this.game) this.bind(game);
    if (m !== this.match) this.newMatch(m);
    this.inMatch = true;
    // skydive wind + glider
    const st = p.alive ? p.state : 'dead', prevSt = this.pState;
    if (st !== this.pState) { if (this.pState === 'skydive' && st === 'glide') this.play('gliderDeploy', { vol: 0.9, prio: 3 }); this.pState = st; }
    const flying = st === 'skydive' || st === 'glide';
    if (flying) {
      const k = clamp(Math.hypot(p.vel.x, p.vel.y, p.vel.z) / 70, 0, 1);
      if (!this.wind) this.wind = this.loop('wind', { vol: 0 });
      this.wind.setVolume(st === 'skydive' ? 0.2 + 0.5 * k : 0.18);
      this.wind.setFilter(st === 'skydive' ? 700 + 6000 * k : 900);
      this.wind.setRate(0.8 + 0.4 * k);
      if (st === 'glide' && !this.gliderLoop) this.gliderLoop = this.loop('glider', { vol: 0.3 });
      if (st !== 'glide' && this.gliderLoop) { this.gliderLoop.stop(0.3); this.gliderLoop = null; }
    } else {
      if (this.wind) { this.wind.stop(0.5); this.wind = null; }
      if (this.gliderLoop) { this.gliderLoop.stop(0.3); this.gliderLoop = null; }
    }
    this.updatePlayerFeel(dt, game, m, p, st, prevSt);
    this.updateSteps(dt, game, p);
    this.updateProjectileWhiz(game, p);
    for (const sd of this.supply) { // supply drop balloons follow their crate down
      if (!sd.c.falling) { sd.loop.stop(0.4); this.supply.delete(sd); } else sd.loop.setPosition(sd.c.pos);
    }
    // storm wall ambience: positioned on the nearest point of the wall, everywhere when you're outside
    const s = m.storm;
    if (s && s.phase >= 0 && s.current) {
      if (!this.stormLoop) this.stormLoop = this.loop('storm', { pos: p.pos, range: 90, ref: 12, vol: 0, hrtf: false });
      const dx = p.pos.x - s.current.x, dz = p.pos.z - s.current.z, dc = Math.hypot(dx, dz) || 1;
      const outside = dc > s.current.r;
      if (outside) { this.stormLoop.setPosition(this.listener); this.stormLoop.setVolume(0.55); this.stormLoop.setFilter(5000); } else {
        this.stormLoop.setPosition({ x: s.current.x + (dx / dc) * s.current.r, y: p.pos.y + 2, z: s.current.z + (dz / dc) * s.current.r });
        this.stormLoop.setVolume(0.5); this.stormLoop.setFilter(2200);
      }
      if (s.phase > this.stormPhase) this.stinger('stormForm');
      if (s.shrinking && !this.stormShrinking) this.stinger('stormClosing');
      this.stormPhase = s.phase; this.stormShrinking = s.shrinking;
    } else if (this.stormLoop) { this.stormLoop.stop(1); this.stormLoop = null; }
    // slower checks: chest hums, footstep voices, biome beds, music
    this.slowT -= dt;
    if (this.slowT > 0) return;
    this.slowT = 0.25;
    this.updateChests(game.loot && game.loot.chests);
    this.pickStepVoices(game, p);
    this.updateBeds(game, st);
    let base = 0.1;
    if (s && s.phase >= 0) base = 0.18 + s.phase * 0.12 + (s.shrinking ? 0.08 : 0);
    const alive = typeof m.alive === 'function' ? m.alive().length : 99;
    if (alive <= 10) base += 0.08;
    if (alive <= 4) base += 0.1;
    if (st === 'bus' || flying) base = Math.min(base, 0.12);
    if (st === 'dead') base *= 0.5;
    this.baseIntensity = base;
    this.updateMusic(m, st, alive);
  }

  // listen to the game's event bus for one-shot cues (bound once per Game)
  bind(game) {
    this.game = game;
    const ev = game.events, mine = (ch) => ch && ch === game.player;
    ev.on('weakpoint', (ch) => { if (mine(ch)) this.synth('weakDing', { vol: 0.8, prio: 4 }); });
    ev.on('harvest', (ch, mat) => { if (mine(ch)) this.matTick(mat); });
    // matches the HUD's "storm is closing in" / "forming a new circle" toasts (on the sfx bus, so you hear it with music off)
    ev.on('stormClosing', () => { if (this.inMatch) this.synth('stormWarn', { vol: 0.7, prio: 5 }); });
    ev.on('stormNext', () => { if (this.inMatch) this.synth('stormWarn', { vol: 0.35, rate: 1.12, prio: 5 }); });
    ev.on('stormLightning', (pt) => this.thunder(pt));
    ev.on('supplyDrop', (c) => this.supplyDrop(c));
    ev.on('glide', (ch) => { if (!mine(ch) && this.inMatch) this.play('gliderDeploy', { pos: ch.pos, range: 90, ref: 6, vol: 0.8 }); });
  }

  newMatch(m) {
    this.match = m;
    this.lastHeld = undefined; this.hornDone = false; this.hpS = -1; this.hpH = -1; this.beatT = 0;
    this.pAirG = true; this.pAirVy = 0; this.tenseOn = false; this.useName = null; this.tickCombo = 0; this.lastMatT = -9;
    this.steps = new WeakMap(); this.stepNear.clear(); this.whizzed = new WeakSet();
  }

  leaveMatch() {
    this.stopLoops(); this.inMatch = false; this.match = null; this.stormPhase = -1; this.stormShrinking = false; this.pState = null; this.baseIntensity = 0.15;
    this.useName = null; this.stepNear.clear();
  }

  // ---------- the player's own little sounds ----------
  updatePlayerFeel(dt, game, m, p, st, prevSt) {
    // the blimp: cabin drone, and a big horn when the doors open
    if (st === 'bus') {
      if (!this.blimpLoop) this.blimpLoop = this.loop('blimpHum', { vol: 0.3 });
      if (!this.hornDone && m.time > 1.2) { this.hornDone = true; this.synth('horn', { vol: 0.85, prio: 5 }); }
    } else if (this.blimpLoop) { this.blimpLoop.stop(1.5); this.blimpLoop = null; }
    // healing: shield potions fizz, bandages rustle
    const it = st === 'ground' && p.useT > 0 && p.useItem && p.useItem.def;
    const want = it && it.use > 0.5 ? (it.shield ? 'useFizz' : 'useWrap') : null;
    if (want !== this.useName) {
      if (this.useLoop) { this.useLoop.stop(0.12); this.useLoop = null; }
      if (want) this.useLoop = this.loop(want, { vol: 0.4 });
      this.useName = want;
    }
    if (st === 'dead') return;
    // weapon equip / swap (no sound for the pickaxe you start with)
    const held = p.heldItem();
    if (held !== this.lastHeld) {
      if (this.lastHeld !== undefined && held && st === 'ground') this.equip(held);
      this.lastHeld = held;
    }
    // shield up / heal finished
    const hp = p.health;
    if (this.hpS >= 0) {
      if (p.shield - this.hpS >= 15) this.synth('shieldUp', { vol: 0.75, prio: 4 });
      else if (hp - this.hpH >= 10) this.synth('healDone', { vol: 0.7, prio: 4 });
    }
    this.hpS = p.shield; this.hpH = hp;
    // low health heartbeat: faster the closer you are to zero
    if (st === 'ground' && hp > 0 && hp < 25) {
      this.beatT -= dt;
      if (this.beatT <= 0) { const k = 1 - hp / 25; this.synth('heartbeat', { vol: 0.35 + 0.3 * k, prio: 4 }); this.beatT = 1.05 - 0.4 * k; }
    } else this.beatT = 0;
    // landings from jumps and falls (skydive/glide landings get the game's own landing sound)
    const g = (p.grounded && st === 'ground') || !!p.vehicle;
    if (g && !this.pAirG && prevSt === 'ground' && this.pAirVy < -4) {
      const k = clamp((-this.pAirVy - 4) / 18, 0, 1);
      this.play(this.stepName(game, p), { vol: 0.3 + 0.35 * k, rate: 0.9, prio: 3 });
      if (this.pAirVy < -10) this.play('land', { vol: 0.25 + 0.6 * k, rate: 1.15 - 0.25 * k, prio: 3 });
    }
    if (!g) this.pAirVy = p.vel.y;
    this.pAirG = g;
  }

  equip(item) {
    const cls = item.type === 'weapon' && item.def ? item.def.cls : null;
    const name = {
      Pistol: 'equip_light', SMG: 'equip_light', Rifle: 'equip_rifle', Shotgun: 'equip_shotgun', Sniper: 'equip_sniper', Heavy: 'equip_heavy',
      Explosive: 'equip_explosive', Sports: 'equip_explosive', Bow: 'equip_bow', Wacky: 'equip_wacky', Melee: 'equip_melee', Pickaxe: 'equip_melee',
    }[cls] || 'equip_item';
    this.synth(name, { vol: 0.7, prio: 3, key: 'equip' });
  }

  // harvesting: a tick that climbs in pitch while you keep swinging
  matTick(mat) {
    const now = this.ctx.currentTime;
    this.tickCombo = now - this.lastMatT < 1.4 ? Math.min(this.tickCombo + 1, 10) : 0;
    this.lastMatT = now;
    const base = mat === 'metal' ? 1.25 : mat === 'brick' ? 0.85 : 1;
    this.synth('matTick', { vol: 0.35, rate: base * (1 + this.tickCombo * 0.04), prio: 3 });
  }

  // ---------- enemies you can hear ----------
  stepName(game, c) {
    const w = game.world;
    if (c.pos.y > w.groundY(c.pos.x, c.pos.z) + 0.6) return 'footWood'; // builds, house floors, stairs
    const b = w.terrain.biomeAt(c.pos.x, c.pos.z);
    return b === 'city' ? 'footHard' : b === 'mountains' && c.pos.y > 35 ? 'footSnow' : 'footGrass';
  }

  // the nearest few moving characters get footstep voices (re-picked 4x a second)
  pickStepVoices(game, p) {
    const L = this.listener, near = [];
    for (const c of game.chars) {
      if (c === p || !c.alive || c.state !== 'ground' || c.vehicle) continue;
      const d2 = (c.pos.x - L.x) ** 2 + (c.pos.y - L.y) ** 2 + (c.pos.z - L.z) ** 2;
      if (d2 < STEP_RANGE * STEP_RANGE && (Math.abs(c.vel.x) + Math.abs(c.vel.z) > 1 || !c.grounded)) near.push([d2, c]);
    }
    near.sort((a, b) => a[0] - b[0]);
    this.stepNear.clear();
    for (let i = 0; i < Math.min(STEP_VOICES, near.length); i++) this.stepNear.add(near[i][1]);
  }

  // stride timers for every character: steps come faster when sprinting, quieter crouched, silent when sneaking
  updateSteps(dt, game, p) {
    for (const c of game.chars) {
      if (c === p || !c.alive || c.state !== 'ground' || c.vehicle) continue;
      let s = this.steps.get(c);
      if (!s) { s = { t: Math.random() * 1.5, g: true, vy: 0 }; this.steps.set(c, s); }
      const g = c.grounded && !c.swimming, near = this.stepNear.has(c);
      if (g && !s.g && s.vy < -5 && near) this.play(this.stepName(game, c), { pos: c.pos, range: STEP_RANGE, ref: 5, vol: clamp(-s.vy / 10, 0.7, 1.5), rate: 0.85, prio: 1.6 });
      if (!g) s.vy = c.vel.y;
      s.g = g;
      if (!g || c.slideT > 0) continue;
      const hs = Math.hypot(c.vel.x, c.vel.z);
      if (hs < 1.2) { s.t = Math.min(s.t, 0.6); continue; }
      s.t -= dt * hs;
      if (s.t > 0) continue;
      const sprint = c.sprinting || hs > 7.5;
      s.t += sprint ? 2.7 : 2.3; // stride length in meters
      if (!near || (c.crouching && hs < 3.6)) continue;
      this.play(this.stepName(game, c), { pos: c.pos, range: STEP_RANGE, ref: 5, vol: c.crouching ? 0.45 : sprint ? 1.35 : 1, rate: sprint ? 1.06 : 1, prio: 1.6 });
    }
  }

  // Hook from combat: an enemy hitscan shot went from origin to end. If it passed close to the player's head
  // without hitting them, play a whiz (plus a supersonic crack for rifles) from the side it went past.
  nearMiss(origin, end, shooter, def = null, hit = null) {
    const p = this.game && this.game.player;
    if (!this.ctx || !p || !p.alive || shooter === p || !this.inMatch) return;
    if (hit && hit.owner && hit.owner.kind === 'char' && hit.owner.char === p) return;
    this.whizCheck(origin, end, def, shooter ? shooter.pos : origin);
  }

  // fast enemy projectiles (sniper rounds, arrows, rockets) get the same treatment
  updateProjectileWhiz(game, p) {
    const list = game.combat && game.combat.projectiles;
    if (!list || !p.alive) return;
    for (const pr of list) {
      if (pr.ch === p || !pr.last || this.whizzed.has(pr)) continue;
      if (pr.vel.lengthSq() < 45 * 45 && !(pr.pd && pr.pd.model === 'rocket')) continue;
      if (this.whizCheck(pr.last, pr.pos, pr.def, pr.ch ? pr.ch.pos : pr.last)) this.whizzed.add(pr);
    }
  }

  whizCheck(o, e, def, from) {
    const p = this.game.player;
    if (p.state !== 'ground' && p.state !== 'glide') return false;
    const hx = p.pos.x, hy = p.pos.y + 1.4, hz = p.pos.z;
    const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-4) return false;
    const t = ((hx - o.x) * dx + (hy - o.y) * dy + (hz - o.z) * dz) / L2;
    if (t <= 0 || t >= 1) return false; // it stopped before reaching us
    const cx = o.x + dx * t - hx, cy = o.y + dy * t - hy, cz = o.z + dz * t - hz;
    const d = Math.hypot(cx, cy, cz);
    if (d > WHIZ_DIST || Math.hypot(hx - from.x, hz - from.z) < 4) return false; // point blank: the gunshot says it all
    const now = this.ctx.currentTime;
    if (now - this.lastWhiz < 0.08) return false; // shotgun pellets = one whiz
    this.lastWhiz = now;
    // the camera sits behind the player's head, so put the sound just beside the listener on the side it passed
    let sx = cx, sy = cy, sz = cz, sl = d;
    if (sl < 0.25) { sx = -dz; sy = 0; sz = dx; sl = Math.hypot(sx, sz) || 1; }
    const L = this.listener, k = 1 - d / WHIZ_DIST;
    const pos = { x: L.x + (sx / sl) * 1.5, y: L.y + (sy / sl) * 1.5, z: L.z + (sz / sl) * 1.5 };
    const rocket = def && def.proj && def.proj.model === 'rocket';
    this.synth('whiz', { pos, range: 20, ref: 4, vol: 0.6 + 0.4 * k, rate: rocket ? 0.45 : 1, prio: 3 });
    const cls = def && def.cls;
    if (cls === 'Rifle' || cls === 'Sniper' || cls === 'Heavy' || (def && def.sound === 'revolver')) {
      this.synth('crack', { pos, range: 20, ref: 4, vol: (cls === 'Sniper' ? 0.95 : 0.6) * (0.6 + 0.4 * k), prio: 3 });
    }
    return true;
  }

  // ---------- world ----------
  // lightning on the storm wall: thunder arrives later the further away it is (speed of sound)
  thunder(pt) {
    if (!this.inMatch || !pt) return;
    const L = this.listener, pos = { x: pt.x, y: L.y + 40, z: pt.z };
    const d = this.dist(pos);
    const now = this.ctx.currentTime;
    if (d > 650 || Math.random() < 0.35 || now - (this.lastThunder || -9) < 2.5) return;
    this.lastThunder = now;
    this.synth('thunder', { pos, range: 700, ref: 80, vol: 0.55, far: true, delay: Math.min(1.8, d / 343), prio: 1 });
  }

  supplyDrop(c) {
    if (!this.inMatch || !c || !c.pos) return;
    this.synth('supplyWhoosh', { pos: c.pos, range: 220, ref: 25, vol: 0.8, prio: 2 });
    this.supply.add({ c, loop: this.loop('balloon', { pos: c.pos, range: 160, ref: 18, vol: 0.6 }) });
  }

  // quiet biome beds under everything, crossfaded by how much of each biome you're standing in
  updateBeds(game, st) {
    const terrain = game.world && game.world.terrain;
    if (!terrain) return;
    const L = this.listener, w = terrain.biomeWeights(L.x, L.z);
    const k = st === 'ground' || st === 'dead' ? 1 : st === 'glide' ? 0.35 : 0;
    for (const b in BEDS) {
      const [name, lvl] = BEDS[b], v = lvl * (w[b] || 0) * k;
      let bed = this.beds[b];
      if (!bed && v > 0.01) bed = this.beds[b] = { loop: this.loop(name, { vol: 0, bus: this.ambBus }) };
      if (bed) bed.loop.setVolume(v);
    }
    // the beds and ground wind step back when the shooting starts
    this.ambBus.gain.setTargetAtTime(1 - 0.55 * Math.min(1, this.heat / 0.35), this.ctx.currentTime, 0.4);
  }

  // drop theme on the blimp and skydive, silence while you loot and fight, a tense layer for the endgame
  updateMusic(m, st, alive) {
    if (!this.musicAuto || m.over) return;
    const s = m.storm, total = ((m.opts && m.opts.bots) || 0) + 1;
    if (!this.tenseOn && ((s && s.phase >= TENSE_PHASE) || (alive < 10 && alive <= Math.max(3, total * 0.3)))) this.tenseOn = true;
    let want = null;
    if (st === 'bus' || st === 'skydive' || st === 'glide') want = 'drop';
    else if (st !== 'dead' && this.tenseOn) want = 'tense';
    if (want === this.autoSong) return;
    const from = this.autoSong;
    this.autoSong = want;
    if (want === 'drop') this.mus.start('drop');
    else if (want === 'tense') this.mus.start('tense', 6);
    else this.mus.stop(from === 'drop' ? 4 : 2);
  }

  updateChests(chests) {
    if (!chests) return;
    const L = this.listener, near = [];
    for (const c of chests) {
      if (c.opened || c.ammoBox || c.falling) continue;
      const d2 = (c.pos.x - L.x) ** 2 + (c.pos.y - L.y) ** 2 + (c.pos.z - L.z) ** 2;
      if (d2 < 30 * 30) near.push([d2, c]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const keep = new Set(near.slice(0, 3).map((e) => e[1]));
    for (const [c, h] of this.chestHums) if (!keep.has(c)) { h.stop(c.opened ? 0.15 : 0.5); this.chestHums.delete(c); }
    for (const c of keep) if (!this.chestHums.has(c)) this.chestHums.set(c, this.chestHum({ x: c.pos.x, y: c.pos.y + 0.6, z: c.pos.z }));
  }

  // ---------- music ----------
  // styles: 'lobby' | 'battle' (adaptive) | 'final' (adaptive, max energy) | 'victory'
  // 'battle' (what a match asks for at the start) hands the music to update(): drop theme on the blimp and
  // skydive, silence while looting and fighting, a tense layer in the last circles. Anything else is played as-is.
  startMusic(style = 'lobby') {
    if (!this.ctx) return;
    if (style === 'battle') { this.musicAuto = true; this.autoSong = 'drop'; this.mus.start('drop'); return; }
    this.musicAuto = false; this.autoSong = null;
    if (this.inMatch && style === 'lobby') this.leaveMatch();
    this.mus.start(style);
  }
  stopMusic(fade = 0.6) { this.musicAuto = false; this.autoSong = null; if (this.ctx) this.mus.stop(fade); }
  setMusicIntensity(x) { if (this.ctx) this.mus.setIntensity(x); }
  get musicStyle() { return this.mus ? this.mus.style : null; }
}

export const audio = new Audio();
