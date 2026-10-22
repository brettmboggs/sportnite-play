// Sound design kit: small synth building blocks plus "recipes" for every synthesized sound effect.
// Recipes are pre-rendered once ("baked") into AudioBuffers with an OfflineAudioContext, so firing a
// minigun is just one buffer playback instead of a dozen oscillators per shot.

const TANH = (() => {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.5) / Math.tanh(2.5); }
  return c;
})();

export class Kit {
  constructor(c, noise, seed = 1) {
    this.c = c;
    this.noiseBuf = noise;
    this.s = (Math.floor(seed * 2147483646) % 2147483646) + 1;
  }

  // seeded random so each baked variant is a little different but reproducible
  r(a = 0, b = 1) { this.s = (this.s * 16807) % 2147483647; return a + (b - a) * ((this.s - 1) / 2147483646); }

  env(g, t, attack, dur, vol, hold = false) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    if (!hold) g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.005, dur));
  }

  // filtered noise burst
  noise(out, t, dur, { type = 'lowpass', freq = 2000, freqEnd = null, q = 0.7, vol = 1, attack = 0.002, rate = 1, hold = false } = {}) {
    const c = this.c;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = rate * this.r(0.92, 1.08);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); this.env(g, t, attack, dur, vol, hold);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, this.r(0, 1.5)); src.stop(t + dur + 0.05);
    return g;
  }

  // oscillator with pitch sweep
  tone(out, t, dur, { type = 'sine', freq = 200, freqEnd = null, vol = 1, attack = 0.003, detune = 0, sweep = null, hold = false } = {}) {
    const c = this.c;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + (sweep || dur));
    const g = c.createGain(); this.env(g, t, attack, dur, vol, hold);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  // inharmonic bell / ding
  bell(out, t, dur, freq, vol = 1, partials = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]]) {
    for (const [m, a] of partials) this.tone(out, t, dur * (1.1 - Math.min(0.7, m * 0.07)), { freq: freq * m, vol: vol * a, attack: 0.002 });
  }

  // very short metallic click
  click(out, t, vol = 0.6, freq = 3000, q = 4) { this.noise(out, t, 0.018, { type: 'bandpass', freq, q, vol, attack: 0.0008 }); }

  // soft saturation stage: returns an input node that feeds `out`
  drive(out, amount = 1) {
    const ws = this.c.createWaveShaper(); ws.curve = TANH; ws.oversample = '2x';
    const pre = this.c.createGain(); pre.gain.value = amount;
    pre.connect(ws); ws.connect(out);
    return pre;
  }

  // a delayed, darker copy path for baked echoes
  echo(out, delay, vol, freq = 900) {
    const c = this.c;
    const d = c.createDelay(2); d.delayTime.value = delay;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    d.connect(f); f.connect(g); g.connect(out);
    return d;
  }
}

// helper layers shared by gunshots
const crack = (k, o, t, { freq = 5000, dur = 0.02, vol = 1 } = {}) => k.noise(o, t, dur, { type: 'bandpass', freq: freq * k.r(0.9, 1.1), q: 0.9, vol, attack: 0.0006 });
const body = (k, o, t, { freq = 3000, end = 400, dur = 0.15, vol = 0.9 } = {}) => k.noise(o, t, dur, { freq: freq * k.r(0.9, 1.1), freqEnd: end, vol, attack: 0.001 });
const thump = (k, o, t, { freq = 160, end = 50, dur = 0.1, vol = 0.9, type = 'sine' } = {}) => k.tone(o, t, dur, { type, freq: freq * k.r(0.95, 1.05), freqEnd: end, vol, attack: 0.001 });
const tail = (k, o, t, { freq = 800, end = 150, dur = 0.5, vol = 0.25, attack = 0.02 } = {}) => k.noise(o, t, dur, { freq, freqEnd: end, vol, attack });

// name -> { dur (seconds rendered), vars (variants), peak (normalized peak level), loop (seconds, for loops), fn(kit, out, t) }
export const RECIPES = {
  // ---------- guns ----------
  gun_pistol: { dur: 0.5, peak: 0.72, fn(k, o, t) {
    const d = k.drive(o, 1.2);
    crack(k, d, t, { freq: 4500, dur: 0.02 }); body(k, d, t, { freq: 2800, end: 500, dur: 0.14, vol: 0.8 });
    thump(k, d, t, { freq: 220, end: 70, dur: 0.07, vol: 0.7, type: 'triangle' }); tail(k, o, t + 0.02, { freq: 900, end: 200, dur: 0.35, vol: 0.18 });
    k.click(o, t + 0.035, 0.25, 3400);
  } },
  gun_revolver: { dur: 1.1, peak: 0.95, fn(k, o, t) {
    const d = k.drive(o, 1.6);
    crack(k, d, t, { freq: 3500, dur: 0.03, vol: 1.1 }); body(k, d, t, { freq: 2200, end: 250, dur: 0.35, vol: 1 });
    thump(k, d, t, { freq: 140, end: 40, dur: 0.22, vol: 1 }); tail(k, o, t + 0.03, { freq: 700, end: 120, dur: 0.9, vol: 0.32 });
  } },
  gun_smg: { dur: 0.3, vars: 4, peak: 0.6, fn(k, o, t) {
    const d = k.drive(o, 1.4);
    crack(k, d, t, { freq: 6000, dur: 0.012, vol: 0.9 }); body(k, d, t, { freq: 4000, end: 900, dur: 0.075, vol: 0.7 });
    thump(k, d, t, { freq: 260, end: 110, dur: 0.045, vol: 0.4, type: 'square' }); k.click(o, t + 0.012, 0.3, 3200);
    tail(k, o, t + 0.01, { freq: 1000, end: 250, dur: 0.22, vol: 0.12 });
  } },
  gun_ar: { dur: 0.7, vars: 4, peak: 0.85, fn(k, o, t) {
    const d = k.drive(o, 1.5);
    crack(k, d, t, { freq: 5000, dur: 0.018 }); body(k, d, t, { freq: 3200, end: 420, dur: 0.16, vol: 0.85 });
    thump(k, d, t, { freq: 170, end: 55, dur: 0.1, vol: 0.85, type: 'triangle' }); tail(k, o, t + 0.02, { freq: 700, end: 150, dur: 0.55, vol: 0.24 });
    k.click(o, t + 0.02, 0.2, 2600);
  } },
  gun_shotgun: { dur: 1.3, peak: 1.0, fn(k, o, t) {
    const d = k.drive(o, 1.8);
    crack(k, d, t, { freq: 3000, dur: 0.03, vol: 1 }); body(k, d, t, { freq: 1800, end: 160, dur: 0.42, vol: 1.2 });
    thump(k, d, t, { freq: 95, end: 35, dur: 0.28, vol: 1.3 });
    k.noise(d, t, 0.2, { type: 'bandpass', freq: 420, q: 1.2, vol: 0.6 });
    tail(k, o, t + 0.04, { freq: 600, end: 90, dur: 1.1, vol: 0.34, attack: 0.04 });
  } },
  gun_sniper: { dur: 2.8, peak: 1.0, fn(k, o, t) {
    const d = k.drive(o, 1.8);
    k.noise(d, t, 0.03, { type: 'highpass', freq: 6500, vol: 1.2, attack: 0.0005 }); // supersonic snap
    body(k, d, t, { freq: 4500, end: 250, dur: 0.6, vol: 1 }); thump(k, d, t, { freq: 110, end: 28, dur: 0.42, vol: 1.2 });
    tail(k, o, t + 0.05, { freq: 600, end: 80, dur: 1.9, vol: 0.4, attack: 0.06 });
    // baked canyon echoes so the shot rolls across the map
    const e1 = k.echo(o, 0.22, 0.35, 1400), e2 = k.echo(o, 0.55, 0.22, 900), e3 = k.echo(o, 1.0, 0.12, 600);
    for (const e of [e1, e2, e3]) body(k, e, t, { freq: 2500, end: 200, dur: 0.5, vol: 0.9 });
  } },
  gun_minigun: { dur: 0.25, vars: 5, peak: 0.55, fn(k, o, t) {
    const d = k.drive(o, 1.3);
    crack(k, d, t, { freq: 4500, dur: 0.01, vol: 0.85 }); body(k, d, t, { freq: 2600, end: 600, dur: 0.06, vol: 0.75 });
    thump(k, d, t, { freq: 180, end: 80, dur: 0.045, vol: 0.55, type: 'triangle' }); k.click(o, t + 0.008, 0.18, 4200, 8);
  } },
  gun_rocket: { dur: 1.3, peak: 0.9, fn(k, o, t) {
    thump(k, o, t, { freq: 90, end: 38, dur: 0.32, vol: 1 }); crack(k, o, t, { freq: 2200, dur: 0.03, vol: 0.7 });
    k.noise(o, t + 0.02, 1.0, { type: 'bandpass', freq: 600, freqEnd: 1900, q: 1.3, vol: 0.85, attack: 0.04 });
    k.noise(o, t + 0.02, 0.9, { type: 'highpass', freq: 4000, vol: 0.3, attack: 0.06 });
  } },
  gun_launcher: { dur: 0.6, peak: 0.85, fn(k, o, t) {
    const d = k.drive(o, 1.4);
    thump(k, d, t, { freq: 230, end: 80, dur: 0.18, vol: 1 }); k.noise(d, t, 0.15, { freq: 900, freqEnd: 200, vol: 0.6 });
    k.click(o, t + 0.005, 0.4, 1800, 6); k.noise(o, t + 0.04, 0.4, { type: 'bandpass', freq: 500, freqEnd: 1200, q: 2, vol: 0.25, attack: 0.05 });
  } },
  gun_bow: { dur: 0.5, peak: 0.6, fn(k, o, t) {
    k.tone(o, t, 0.3, { type: 'triangle', freq: 430 * k.r(0.95, 1.05), freqEnd: 190, vol: 0.7, sweep: 0.05 });
    k.tone(o, t, 0.18, { type: 'sawtooth', freq: 860, freqEnd: 380, vol: 0.12, sweep: 0.04 });
    k.noise(o, t + 0.01, 0.3, { type: 'bandpass', freq: 1500, freqEnd: 600, q: 1.5, vol: 0.45, attack: 0.02 });
  } },
  gun_beam: { dur: 0.15, vars: 4, peak: 0.35, fn(k, o, t) {
    k.tone(o, t, 0.1, { type: 'sawtooth', freq: 1300 * k.r(0.97, 1.03), freqEnd: 1650, vol: 0.4 });
    k.tone(o, t, 0.1, { freq: 2600, freqEnd: 3100, vol: 0.3 }); k.noise(o, t, 0.1, { type: 'highpass', freq: 6000, vol: 0.35 });
  } },
  gun_zap: { dur: 0.45, peak: 0.7, fn(k, o, t) {
    k.tone(o, t, 0.28, { type: 'sawtooth', freq: 1800, freqEnd: 120, vol: 0.55 });
    for (let i = 0; i < 6; i++) k.noise(o, t + i * k.r(0.02, 0.05), 0.03, { type: 'highpass', freq: 2500, vol: k.r(0.4, 0.9), attack: 0.001 });
    thump(k, o, t, { freq: 140, end: 60, dur: 0.1, vol: 0.5 });
  } },
  gun_bubble: { dur: 0.3, peak: 0.45, fn(k, o, t) {
    k.tone(o, t, 0.12, { freq: 400 * k.r(0.9, 1.1), freqEnd: 900, vol: 0.6 });
    k.tone(o, t + 0.05, 0.1, { freq: 650 * k.r(0.9, 1.1), freqEnd: 1400, vol: 0.4 });
  } },
  gun_whoosh: { dur: 0.5, peak: 0.5, fn(k, o, t) { k.noise(o, t, 0.42, { type: 'bandpass', freq: 600, freqEnd: 1900, q: 3, vol: 0.7, attack: 0.1 }); } },
  gun_chicken: { dur: 0.5, peak: 0.65, fn(k, o, t) {
    for (let i = 0; i < 3; i++) k.tone(o, t + i * 0.07, 0.08, { type: 'square', freq: (950 - i * 120) * k.r(0.95, 1.05), freqEnd: 600, vol: 0.4 });
    thump(k, o, t, { freq: 170, end: 70, dur: 0.15, vol: 0.9, type: 'square' });
  } },
  gun_splat: { dur: 0.35, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 0.16, { freq: 1000, freqEnd: 200, vol: 0.7 }); k.tone(o, t, 0.14, { freq: 320, freqEnd: 90, vol: 0.5 });
    k.tone(o, t + 0.03, 0.08, { freq: 500, freqEnd: 900, vol: 0.2 });
  } },
  gun_golf: { dur: 0.45, peak: 0.7, fn(k, o, t) {
    k.tone(o, t, 0.08, { type: 'triangle', freq: 2200, freqEnd: 1500, vol: 0.6 }); k.click(o, t, 0.8, 4000, 2);
    k.noise(o, t, 0.32, { freq: 4000, freqEnd: 600, vol: 0.6 });
  } },
  gun_kick: { dur: 0.35, peak: 0.8, fn(k, o, t) { thump(k, o, t, { freq: 150, end: 50, dur: 0.2, vol: 1.1 }); k.noise(o, t, 0.08, { freq: 1500, vol: 0.5 }); } },
  gun_sword: { dur: 0.4, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 0.28, { type: 'bandpass', freq: 3000, freqEnd: 800, q: 2, vol: 0.7, attack: 0.03 });
    k.tone(o, t, 0.3, { type: 'sawtooth', freq: 200, freqEnd: 330, vol: 0.18, attack: 0.02 });
    k.tone(o, t, 0.3, { type: 'sawtooth', freq: 203, freqEnd: 336, vol: 0.14, attack: 0.02 });
  } },
  gun_bonk: { dur: 0.35, peak: 0.8, fn(k, o, t) { k.tone(o, t, 0.22, { type: 'triangle', freq: 620, freqEnd: 150, vol: 0.9 }); k.click(o, t, 0.5, 1200, 3); } },
  gun_bat: { dur: 0.3, peak: 0.5, fn(k, o, t) { k.noise(o, t, 0.2, { type: 'bandpass', freq: 700, freqEnd: 1700, q: 1.6, vol: 0.6, attack: 0.04 }); } },
  gun_throw: { dur: 0.35, peak: 0.45, fn(k, o, t) { k.noise(o, t, 0.26, { type: 'bandpass', freq: 800, freqEnd: 1600, q: 2, vol: 0.5, attack: 0.05 }); } },
  gun_empty: { dur: 0.1, peak: 0.35, fn(k, o, t) { k.click(o, t, 0.8, 2200, 5); k.click(o, t + 0.025, 0.5, 3500, 6); } },
  gun_reload: { dur: 0.45, peak: 0.45, fn(k, o, t) { k.click(o, t, 0.7, 3000, 3); k.click(o, t + 0.25, 0.9, 2100, 3); k.tone(o, t + 0.25, 0.05, { freq: 900, vol: 0.15, type: 'square' }); } },

  // ---------- reload parts (sequenced per weapon class) ----------
  magOut: { dur: 0.2, peak: 0.42, fn(k, o, t) { k.click(o, t, 0.8, 2600, 3); k.noise(o, t + 0.01, 0.12, { type: 'bandpass', freq: 1800, freqEnd: 900, q: 2, vol: 0.4 }); } },
  magIn: { dur: 0.2, peak: 0.5, fn(k, o, t) { k.noise(o, t, 0.04, { type: 'bandpass', freq: 1400, q: 2, vol: 0.4 }); k.click(o, t + 0.04, 1, 2200, 4); k.tone(o, t + 0.04, 0.05, { type: 'square', freq: 700, vol: 0.12 }); } },
  slide: { dur: 0.25, peak: 0.5, fn(k, o, t) { k.noise(o, t, 0.07, { type: 'bandpass', freq: 2500, freqEnd: 4000, q: 2, vol: 0.5 }); k.click(o, t + 0.08, 1, 3200, 5); } },
  boltBack: { dur: 0.25, peak: 0.5, fn(k, o, t) { k.click(o, t, 0.8, 1800, 4); k.noise(o, t + 0.02, 0.12, { type: 'bandpass', freq: 1200, freqEnd: 2600, q: 3, vol: 0.5 }); } },
  boltFwd: { dur: 0.25, peak: 0.55, fn(k, o, t) { k.noise(o, t, 0.1, { type: 'bandpass', freq: 2600, freqEnd: 1300, q: 3, vol: 0.5 }); k.click(o, t + 0.1, 1, 2000, 4); } },
  shellIn: { dur: 0.18, peak: 0.42, fn(k, o, t) { k.noise(o, t, 0.03, { type: 'bandpass', freq: 900, q: 1.5, vol: 0.4 }); k.click(o, t + 0.03, 0.8, 1500, 3); } },
  pump: { dur: 0.4, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 0.09, { type: 'bandpass', freq: 1100, freqEnd: 2200, q: 2, vol: 0.6 }); k.click(o, t + 0.09, 1, 1700, 3);
    k.noise(o, t + 0.16, 0.08, { type: 'bandpass', freq: 2200, freqEnd: 1100, q: 2, vol: 0.6 }); k.click(o, t + 0.24, 1, 1400, 3);
  } },
  energy: { dur: 0.6, peak: 0.4, fn(k, o, t) { k.tone(o, t, 0.5, { type: 'sawtooth', freq: 180, freqEnd: 1200, vol: 0.3, attack: 0.05 }); k.tone(o, t, 0.5, { freq: 360, freqEnd: 2400, vol: 0.2, attack: 0.05 }); } },
  stringDraw: { dur: 0.4, peak: 0.35, fn(k, o, t) { k.noise(o, t, 0.3, { type: 'bandpass', freq: 600, freqEnd: 1400, q: 6, vol: 0.4, attack: 0.08 }); } },

  // ---------- hit feedback (heard by the shooter) ----------
  hitBody: { dur: 0.12, vars: 4, peak: 0.42, fn(k, o, t) {
    k.tone(o, t, 0.05, { type: 'triangle', freq: 1250 * k.r(0.96, 1.04), freqEnd: 900, vol: 0.6 });
    k.noise(o, t, 0.03, { type: 'bandpass', freq: 3200, q: 1.5, vol: 0.5, attack: 0.0008 });
    k.tone(o, t, 0.06, { freq: 180, freqEnd: 90, vol: 0.4 });
  } },
  hitHead: { dur: 0.6, vars: 2, peak: 0.55, fn(k, o, t) {
    k.bell(o, t, 0.55, 1975 * k.r(0.99, 1.01), 0.7); k.click(o, t, 0.6, 5000, 2); k.tone(o, t, 0.08, { freq: 220, freqEnd: 110, vol: 0.4 });
  } },
  hitShield: { dur: 0.3, vars: 3, peak: 0.4, fn(k, o, t) {
    const f = 2600 * k.r(0.93, 1.07);
    k.bell(o, t, 0.25, f, 0.5, [[1, 1], [1.5, 0.5], [2.4, 0.3]]); k.noise(o, t, 0.05, { type: 'highpass', freq: 6000, vol: 0.5, attack: 0.0008 });
  } },
  shieldBreak: { dur: 0.9, peak: 0.7, fn(k, o, t) {
    for (let i = 0; i < 7; i++) k.bell(o, t + k.r(0, 0.12), k.r(0.15, 0.4), k.r(2400, 5200), 0.25, [[1, 1], [1.7, 0.4]]);
    k.noise(o, t, 0.5, { type: 'highpass', freq: 3500, freqEnd: 8000, vol: 0.7, attack: 0.002 });
    k.tone(o, t, 0.45, { type: 'sawtooth', freq: 1600, freqEnd: 200, vol: 0.18 });
    k.tone(o, t, 0.2, { freq: 160, freqEnd: 60, vol: 0.6 });
  } },
  elim: { dur: 1.0, vars: 2, peak: 0.75, fn(k, o, t) {
    k.tone(o, t, 0.3, { freq: 110, freqEnd: 40, vol: 1 }); k.noise(o, t, 0.08, { freq: 2500, freqEnd: 400, vol: 0.5 });
    k.bell(o, t + 0.05, 0.6, 1318, 0.45, [[1, 1], [2, 0.3], [3, 0.12]]);
    k.bell(o, t + 0.13, 0.8, 1976, 0.5, [[1, 1], [2, 0.3], [3, 0.12]]);
    k.noise(o, t + 0.05, 0.6, { type: 'bandpass', freq: 3000, freqEnd: 9000, q: 1, vol: 0.15, attack: 0.1 });
  } },
  elimHead: { dur: 1.1, peak: 0.8, fn(k, o, t) {
    k.tone(o, t, 0.3, { freq: 110, freqEnd: 40, vol: 1 }); k.bell(o, t, 0.5, 1975, 0.5);
    k.bell(o, t + 0.08, 0.6, 1568, 0.4, [[1, 1], [2, 0.3]]); k.bell(o, t + 0.16, 0.9, 2637, 0.5, [[1, 1], [2, 0.3], [3, 0.15]]);
    k.noise(o, t + 0.05, 0.7, { type: 'bandpass', freq: 3000, freqEnd: 10000, q: 1, vol: 0.18, attack: 0.1 });
  } },

  // ---------- impacts / building / world ----------
  thockWood: { dur: 0.25, peak: 0.6, fn(k, o, t) { k.tone(o, t, 0.12, { type: 'triangle', freq: 320 * k.r(0.9, 1.1), freqEnd: 180, vol: 0.8 }); k.noise(o, t, 0.08, { type: 'bandpass', freq: 900, q: 1.5, vol: 0.5 }); } },
  thockStone: { dur: 0.3, peak: 0.6, fn(k, o, t) { k.tone(o, t, 0.1, { freq: 180 * k.r(0.9, 1.1), freqEnd: 90, vol: 0.9 }); k.noise(o, t, 0.15, { freq: 2500, freqEnd: 500, vol: 0.6 }); k.click(o, t, 0.4, 4000, 2); } },
  thockMetal: { dur: 0.6, peak: 0.55, fn(k, o, t) { k.bell(o, t, 0.5, 820 * k.r(0.9, 1.1), 0.5, [[1, 1], [2.32, 0.6], [4.1, 0.3], [6.7, 0.2]]); k.click(o, t, 0.6, 3000, 2); } },
  buildThump: { dur: 0.35, peak: 0.6, fn(k, o, t) { k.tone(o, t, 0.2, { freq: 130 * k.r(0.9, 1.1), freqEnd: 55, vol: 1 }); k.noise(o, t, 0.12, { freq: 1200, freqEnd: 300, vol: 0.4 }); } },
  buildSparkle: { dur: 0.35, peak: 0.25, fn(k, o, t) { const f = k.r(1400, 1700); k.tone(o, t, 0.2, { type: 'triangle', freq: f, vol: 0.4 }); k.tone(o, t + 0.05, 0.25, { type: 'triangle', freq: f * 1.5, vol: 0.3 }); } },
  land: { dur: 0.4, peak: 0.6, fn(k, o, t) { k.tone(o, t, 0.22, { freq: 95, freqEnd: 40, vol: 1 }); k.noise(o, t, 0.2, { freq: 900, freqEnd: 150, vol: 0.6 }); } },
  gliderDeploy: { dur: 0.9, peak: 0.8, fn(k, o, t) {
    k.noise(o, t, 0.12, { type: 'bandpass', freq: 900, q: 1.2, vol: 0.9, attack: 0.003 }); // fabric snap
    k.noise(o, t + 0.02, 0.06, { type: 'bandpass', freq: 1800, q: 2, vol: 0.5, attack: 0.002 });
    k.tone(o, t + 0.01, 0.35, { freq: 110, freqEnd: 38, vol: 1.1, attack: 0.006 }); // the canopy filling with air: "fwump"
    k.noise(o, t + 0.01, 0.3, { freq: 500, freqEnd: 90, vol: 0.7, attack: 0.01 });
    k.noise(o, t + 0.08, 0.7, { type: 'bandpass', freq: 400, freqEnd: 1200, q: 1.5, vol: 0.4, attack: 0.1 });
  } },
  chestOpen: { dur: 1.6, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 0.08, { type: 'bandpass', freq: 600, q: 1.5, vol: 0.7 }); k.tone(o, t, 0.12, { freq: 140, freqEnd: 70, vol: 0.7 });
    const notes = [1046.5, 1318.5, 1568, 2093, 2637];
    notes.forEach((f, i) => k.bell(o, t + 0.06 + i * 0.06, 0.9, f, 0.35, [[1, 1], [2, 0.25], [3, 0.08]]));
    k.noise(o, t + 0.05, 1.2, { type: 'bandpass', freq: 5000, freqEnd: 9000, q: 0.8, vol: 0.15, attack: 0.2 });
  } },
  coin: { dur: 0.45, vars: 2, peak: 0.4, fn(k, o, t) { k.tone(o, t, 0.08, { type: 'square', freq: 988, vol: 0.4 }); k.tone(o, t + 0.07, 0.32, { type: 'square', freq: 1319, vol: 0.4 }); } },
  ammoGrab: { dur: 0.25, vars: 2, peak: 0.4, fn(k, o, t) { for (let i = 0; i < 3; i++) k.click(o, t + i * 0.03 + k.r(0, 0.01), 0.7, k.r(2500, 4500), 6); } },
  weaponGrab: { dur: 0.3, peak: 0.5, fn(k, o, t) { k.noise(o, t, 0.06, { type: 'bandpass', freq: 1500, q: 2, vol: 0.5 }); k.click(o, t + 0.07, 1, 2300, 4); k.click(o, t + 0.12, 0.7, 3300, 5); } },
  itemGrab: { dur: 0.35, peak: 0.4, fn(k, o, t) { k.tone(o, t, 0.12, { type: 'triangle', freq: 660, freqEnd: 990, vol: 0.5 }); k.tone(o, t + 0.08, 0.2, { type: 'triangle', freq: 1320, vol: 0.3 }); } },
  explosion: { dur: 2.6, vars: 2, peak: 1.0, fn(k, o, t) {
    const d = k.drive(o, 2);
    k.noise(d, t, 0.05, { type: 'highpass', freq: 2000, vol: 1, attack: 0.001 });
    k.noise(d, t, 1.6, { freq: 1600, freqEnd: 60, vol: 1.3, attack: 0.004 });
    k.tone(d, t, 0.9, { freq: 70, freqEnd: 22, vol: 1.5 });
    for (let i = 0; i < 10; i++) k.noise(o, t + k.r(0.05, 0.6), k.r(0.03, 0.12), { type: 'bandpass', freq: k.r(800, 3500), q: 2, vol: k.r(0.1, 0.3) }); // debris crackle
    tail(k, o, t + 0.1, { freq: 400, end: 50, dur: 2.3, vol: 0.4, attack: 0.15 });
  } },
  // a bullet passing your head: a quick rising-then-falling "fwip" with a little doppler whistle
  whiz: { dur: 0.32, vars: 4, peak: 0.7, fn(k, o, t) {
    const f = k.r(3000, 4200);
    k.noise(o, t, 0.22, { type: 'bandpass', freq: f, freqEnd: f * 0.3, q: 3.5, vol: 0.7, attack: 0.07 });
    k.tone(o, t + 0.03, 0.16, { freq: f * 0.7, freqEnd: f * 0.3, vol: 0.12, attack: 0.05 });
    k.noise(o, t + 0.06, 0.05, { type: 'highpass', freq: 5000, vol: 0.3, attack: 0.01 });
  } },
  // supersonic crack: the sharp snap a rifle round makes going past
  crack: { dur: 0.16, vars: 3, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 0.012, { type: 'highpass', freq: 3500, vol: 1, attack: 0.0004 });
    k.noise(o, t + 0.002, 0.05, { type: 'bandpass', freq: k.r(2200, 3000), q: 1.2, vol: 0.5, attack: 0.0006 });
    k.noise(o, t + 0.01, 0.12, { freq: 1400, freqEnd: 300, vol: 0.15, attack: 0.005 });
  } },

  // ---------- player feel ----------
  heartbeat: { dur: 0.5, vars: 2, peak: 0.7, fn(k, o, t) {
    k.tone(o, t, 0.14, { freq: 70, freqEnd: 42, vol: 1, attack: 0.008 }); k.noise(o, t, 0.05, { freq: 220, vol: 0.4, attack: 0.004 });
    k.tone(o, t + 0.17, 0.16, { freq: 62, freqEnd: 38, vol: 0.7, attack: 0.01 });
  } },
  shieldUp: { dur: 0.9, peak: 0.5, fn(k, o, t) {
    k.tone(o, t, 0.45, { freq: 300, freqEnd: 1200, vol: 0.35, attack: 0.03 }); // the "gulp" rising
    for (let i = 0; i < 5; i++) k.tone(o, t + 0.04 * i, 0.06, { freq: k.r(500, 900) * (1 + i * 0.2), freqEnd: k.r(1200, 1600), vol: 0.15 }); // bubbles
    k.bell(o, t + 0.3, 0.6, 1568, 0.3, [[1, 1], [1.5, 0.6], [2, 0.3]]);
    k.noise(o, t + 0.28, 0.5, { type: 'bandpass', freq: 6000, freqEnd: 9000, q: 1, vol: 0.12, attack: 0.05 });
  } },
  healDone: { dur: 0.7, peak: 0.45, fn(k, o, t) {
    k.tone(o, t, 0.25, { type: 'triangle', freq: 784, vol: 0.4, attack: 0.01 }); k.tone(o, t + 0.12, 0.5, { type: 'triangle', freq: 1175, vol: 0.4, attack: 0.01 });
    k.tone(o, t + 0.12, 0.5, { freq: 587, vol: 0.2, attack: 0.02 });
  } },
  weakDing: { dur: 0.55, vars: 2, peak: 0.45, fn(k, o, t) {
    k.bell(o, t, 0.5, 2637 * k.r(0.99, 1.01), 0.6, [[1, 1], [2, 0.35], [3.01, 0.15]]); k.click(o, t, 0.5, 6000, 2);
  } },
  matTick: { dur: 0.08, vars: 3, peak: 0.35, fn(k, o, t) { k.tone(o, t, 0.05, { type: 'triangle', freq: 1500, freqEnd: 1700, vol: 0.5 }); k.click(o, t, 0.4, 4500, 4); } },
  // weapon equip / swap, by class
  equip_light: { dur: 0.3, peak: 0.45, fn(k, o, t) { k.noise(o, t, 0.06, { type: 'bandpass', freq: 1200, q: 1.5, vol: 0.4 }); k.click(o, t + 0.07, 0.9, 3000, 4); k.click(o, t + 0.12, 0.6, 4200, 6); } },
  equip_rifle: { dur: 0.4, peak: 0.5, fn(k, o, t) {
    k.noise(o, t, 0.12, { type: 'bandpass', freq: 700, freqEnd: 1300, q: 1.2, vol: 0.45, attack: 0.02 }); // strap / cloth
    k.click(o, t + 0.13, 1, 2200, 4); k.noise(o, t + 0.15, 0.06, { type: 'bandpass', freq: 2600, freqEnd: 1600, q: 3, vol: 0.4 }); k.click(o, t + 0.22, 0.9, 1800, 4);
  } },
  equip_shotgun: { dur: 0.45, peak: 0.55, fn(k, o, t) {
    k.noise(o, t, 0.08, { type: 'bandpass', freq: 600, q: 1.2, vol: 0.4, attack: 0.02 });
    k.noise(o, t + 0.1, 0.08, { type: 'bandpass', freq: 1100, freqEnd: 2200, q: 2, vol: 0.6 }); k.click(o, t + 0.18, 1, 1700, 3);
    k.noise(o, t + 0.24, 0.07, { type: 'bandpass', freq: 2200, freqEnd: 1100, q: 2, vol: 0.6 }); k.click(o, t + 0.31, 1, 1400, 3);
  } },
  equip_sniper: { dur: 0.45, peak: 0.5, fn(k, o, t) {
    k.noise(o, t, 0.1, { type: 'bandpass', freq: 700, q: 1.2, vol: 0.4, attack: 0.02 });
    k.click(o, t + 0.12, 0.8, 1800, 4); k.noise(o, t + 0.14, 0.1, { type: 'bandpass', freq: 1200, freqEnd: 2600, q: 3, vol: 0.45 });
    k.noise(o, t + 0.26, 0.08, { type: 'bandpass', freq: 2600, freqEnd: 1300, q: 3, vol: 0.45 }); k.click(o, t + 0.34, 1, 2000, 4);
  } },
  equip_heavy: { dur: 0.6, peak: 0.6, fn(k, o, t) {
    k.tone(o, t, 0.15, { freq: 140, freqEnd: 70, vol: 0.6 }); k.click(o, t, 0.8, 1500, 3); k.bell(o, t + 0.01, 0.3, 620, 0.2, [[1, 1], [2.3, 0.5]]);
    k.tone(o, t + 0.12, 0.4, { type: 'sawtooth', freq: 90, freqEnd: 260, vol: 0.12, attack: 0.08 }); // motor spin-up whir
  } },
  equip_explosive: { dur: 0.5, peak: 0.55, fn(k, o, t) {
    k.tone(o, t, 0.12, { freq: 180, freqEnd: 90, vol: 0.6 }); k.noise(o, t, 0.1, { type: 'bandpass', freq: 500, q: 1.2, vol: 0.4 });
    k.click(o, t + 0.16, 1, 1300, 3); k.bell(o, t + 0.16, 0.3, 900, 0.15, [[1, 1], [2.7, 0.4]]);
  } },
  equip_melee: { dur: 0.35, peak: 0.45, fn(k, o, t) { k.noise(o, t, 0.25, { type: 'bandpass', freq: 600, freqEnd: 2200, q: 1.8, vol: 0.6, attack: 0.08 }); k.click(o, t + 0.24, 0.5, 1200, 3); } },
  equip_wacky: { dur: 0.4, peak: 0.45, fn(k, o, t) { k.tone(o, t, 0.25, { type: 'sawtooth', freq: 300, freqEnd: 1600, vol: 0.2, attack: 0.03 }); k.tone(o, t + 0.05, 0.3, { type: 'triangle', freq: 1200, freqEnd: 2400, vol: 0.3 }); k.click(o, t + 0.25, 0.6, 3500, 5); } },
  equip_bow: { dur: 0.45, peak: 0.4, fn(k, o, t) { k.noise(o, t, 0.35, { type: 'bandpass', freq: 500, freqEnd: 900, q: 6, vol: 0.45, attack: 0.1 }); k.tone(o, t + 0.05, 0.3, { type: 'triangle', freq: 180, freqEnd: 200, vol: 0.15, attack: 0.05 }); } },
  equip_item: { dur: 0.3, peak: 0.35, fn(k, o, t) { k.noise(o, t, 0.15, { type: 'bandpass', freq: 2000, freqEnd: 3500, q: 1.2, vol: 0.4, attack: 0.03 }); k.tone(o, t + 0.08, 0.15, { type: 'triangle', freq: 880, freqEnd: 1320, vol: 0.2 }); } },

  // ---------- match events ----------
  stormWarn: { dur: 1.9, peak: 0.55, fn(k, o, t) {
    // two-tone alert with a wobble, then a low swell
    for (const [at, f] of [[0, 740], [0.32, 554], [0.7, 740], [1.02, 554]]) {
      k.tone(o, t + at, 0.3, { type: 'triangle', freq: f, vol: 0.45, attack: 0.01 });
      k.tone(o, t + at, 0.3, { type: 'square', freq: f / 2, vol: 0.06, attack: 0.01 });
    }
    k.noise(o, t + 0.2, 1.6, { type: 'bandpass', freq: 200, freqEnd: 900, q: 1, vol: 0.35, attack: 0.9 });
  } },
  thunder: { dur: 4, vars: 3, peak: 0.9, fn(k, o, t) {
    const d = k.drive(o, 1.5);
    k.noise(d, t, 0.25, { freq: 3000, freqEnd: 400, vol: 0.6, attack: 0.004 }); // crack
    for (let i = 0; i < 5; i++) k.noise(d, t + k.r(0.05, 1.2), k.r(0.6, 1.6), { freq: k.r(200, 450), freqEnd: 60, vol: k.r(0.5, 1), attack: k.r(0.05, 0.2) });
    k.noise(o, t + 0.2, 3.6, { freq: 160, freqEnd: 40, vol: 0.8, attack: 0.4 }); // long roll
  } },
  horn: { dur: 2.6, peak: 0.8, fn(k, o, t) {
    // the blimp's big friendly two-tone horn: "BWAAAP — BWAAAAAP"
    for (const [at, len] of [[0, 0.7], [0.9, 1.4]]) {
      const lp = k.c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t + at); lp.frequency.linearRampToValueAtTime(1400, t + at + 0.08); lp.Q.value = 2; lp.connect(o);
      for (const [f, v] of [[116.5, 0.5], [146.8, 0.45], [233, 0.25], [175, 0.3]]) {
        k.tone(lp, t + at, len, { type: 'sawtooth', freq: f * 0.94, freqEnd: f, sweep: 0.08, vol: v, attack: 0.03 });
      }
    }
  } },
  supplyWhoosh: { dur: 1.4, peak: 0.6, fn(k, o, t) {
    k.noise(o, t, 1.3, { type: 'bandpass', freq: 300, freqEnd: 1600, q: 1.5, vol: 0.8, attack: 0.6 });
    k.bell(o, t + 0.9, 0.5, 1318, 0.2, [[1, 1], [2, 0.3]]);
  } },

  // ---------- looping beds (rendered with crossfade so they loop seamlessly) ----------
  chestHum: { dur: 4.4, loop: 4, vars: 1, peak: 0.5, fn(k, o, t) {
    // choir-ish shimmer; frequencies are multiples of 0.25 Hz so the 4 s loop is phase-continuous
    const trem = k.c.createOscillator(); trem.frequency.value = 3; const tg = k.c.createGain(); tg.gain.value = 0.35;
    const amp = k.c.createGain(); amp.gain.value = 0.65; trem.connect(tg); tg.connect(amp.gain); amp.connect(o);
    trem.start(t); trem.stop(t + 4.5);
    for (const [f, v] of [[523.25, 0.5], [659.25, 0.35], [784, 0.35], [1046.5, 0.25], [1568, 0.12], [2093, 0.08]]) {
      for (const det of [-0.75, 0.75]) { const os = k.c.createOscillator(); os.frequency.value = f + det; const g = k.c.createGain(); g.gain.value = v * 0.5; os.connect(g); g.connect(amp); os.start(t); os.stop(t + 4.5); }
    }
    k.noise(o, t, 4.4, { type: 'bandpass', freq: 6000, q: 1, vol: 0.05, attack: 0.01, hold: true });
  } },
  wind: { dur: 3.4, loop: 3, vars: 1, peak: 0.7, fn(k, o, t) {
    k.noise(o, t, 3.4, { type: 'bandpass', freq: 700, q: 0.6, vol: 0.8, attack: 0.01, hold: true });
    k.noise(o, t, 3.4, { type: 'lowpass', freq: 250, vol: 0.6, attack: 0.01, hold: true });
  } },
  glider: { dur: 2.4, loop: 2, vars: 1, peak: 0.6, fn(k, o, t) {
    // fabric flutter: noise amplitude-modulated at 7 Hz (14 cycles per loop)
    const lfo = k.c.createOscillator(); lfo.frequency.value = 7; const lg = k.c.createGain(); lg.gain.value = 0.4;
    const amp = k.c.createGain(); amp.gain.value = 0.6; lfo.connect(lg); lg.connect(amp.gain); amp.connect(o);
    lfo.start(t); lfo.stop(t + 2.5);
    k.noise(amp, t, 2.4, { type: 'bandpass', freq: 500, q: 0.8, vol: 0.9, attack: 0.01, hold: true });
  } },
  storm: { dur: 6.5, loop: 6, vars: 1, peak: 0.7, fn(k, o, t) {
    k.noise(o, t, 6.5, { type: 'lowpass', freq: 160, vol: 1, attack: 0.01, hold: true }); // rumble
    k.noise(o, t, 6.5, { type: 'bandpass', freq: 900, q: 0.5, vol: 0.25, attack: 0.01, hold: true }); // swirl
    for (const f of [55, 82.5, 110]) k.tone(o, t, 6.5, { type: 'sawtooth', freq: f, vol: 0.06, attack: 0.01, hold: true });
    for (let i = 0; i < 9; i++) k.noise(o, t + k.r(0.2, 5.8), k.r(0.05, 0.25), { type: 'highpass', freq: k.r(1500, 4000), vol: k.r(0.08, 0.25) }); // crackles
  } },
  // blimp cabin: propeller chop (12 Hz = 48 cycles per loop) over a low engine drone
  blimpHum: { dur: 4.4, loop: 4, vars: 1, peak: 0.6, fn(k, o, t) {
    const lfo = k.c.createOscillator(); lfo.frequency.value = 12; const lg = k.c.createGain(); lg.gain.value = 0.35;
    const amp = k.c.createGain(); amp.gain.value = 0.6; lfo.connect(lg); lg.connect(amp.gain); amp.connect(o);
    lfo.start(t); lfo.stop(t + 4.5);
    const lp = k.c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.connect(amp);
    for (const f of [55, 55.25, 110]) k.tone(lp, t, 4.4, { type: 'sawtooth', freq: f, vol: 0.4, attack: 0.01, hold: true });
    k.noise(amp, t, 4.4, { type: 'bandpass', freq: 500, q: 0.7, vol: 0.35, attack: 0.01, hold: true });
  } },
  // a supply drop on its way down: wind past the balloon + flapping
  balloon: { dur: 3.4, loop: 3, vars: 1, peak: 0.6, fn(k, o, t) {
    const lfo = k.c.createOscillator(); lfo.frequency.value = 5; const lg = k.c.createGain(); lg.gain.value = 0.35;
    const amp = k.c.createGain(); amp.gain.value = 0.6; lfo.connect(lg); lg.connect(amp.gain); amp.connect(o);
    lfo.start(t); lfo.stop(t + 3.5);
    k.noise(amp, t, 3.4, { type: 'bandpass', freq: 650, q: 1, vol: 0.9, attack: 0.01, hold: true });
    k.noise(o, t, 3.4, { type: 'lowpass', freq: 220, vol: 0.5, attack: 0.01, hold: true });
    for (let i = 0; i < 4; i++) k.bell(o, t + k.r(0.1, 2.8), 0.6, k.r(1800, 2600), 0.06, [[1, 1], [2, 0.3]]); // twinkle so it reads as "loot!"
  } },
  // using a heal: shield potions fizz, bandages / med kits rustle
  useFizz: { dur: 2.4, loop: 2, vars: 1, peak: 0.45, fn(k, o, t) {
    k.noise(o, t, 2.4, { type: 'highpass', freq: 5000, vol: 0.25, attack: 0.01, hold: true });
    for (let i = 0; i < 28; i++) { const f = k.r(500, 1400); k.tone(o, t + k.r(0, 2.05), 0.05, { freq: f, freqEnd: f * 1.8, vol: k.r(0.1, 0.3) }); }
  } },
  useWrap: { dur: 2.4, loop: 2, vars: 1, peak: 0.4, fn(k, o, t) {
    for (let i = 0; i < 9; i++) k.noise(o, t + i * 0.23 + k.r(0, 0.06), k.r(0.12, 0.2), { type: 'bandpass', freq: k.r(1500, 3200), q: 1, vol: k.r(0.3, 0.6), attack: 0.03 });
  } },

  // ---------- biome ambience beds (quiet; the match has no music while looting) ----------
  ambCity: { dur: 8.5, loop: 8, vars: 1, peak: 0.5, fn(k, o, t) {
    k.noise(o, t, 8.5, { type: 'lowpass', freq: 260, vol: 0.5, attack: 0.01, hold: true }); // far-off town hum
    k.noise(o, t, 8.5, { type: 'bandpass', freq: 900, q: 0.4, vol: 0.12, attack: 0.01, hold: true }); // breeze
    birds(k, o, t, 5, 0.22);
  } },
  ambJungle: { dur: 8.5, loop: 8, vars: 1, peak: 0.5, fn(k, o, t) {
    // insect buzz: band noise amplitude-modulated at 25 Hz (200 cycles per loop)
    const lfo = k.c.createOscillator(); lfo.frequency.value = 25; const lg = k.c.createGain(); lg.gain.value = 0.5;
    const amp = k.c.createGain(); amp.gain.value = 0.5; lfo.connect(lg); lg.connect(amp.gain); amp.connect(o);
    lfo.start(t); lfo.stop(t + 8.6);
    k.noise(amp, t, 8.5, { type: 'bandpass', freq: 5200, q: 4, vol: 0.18, attack: 0.01, hold: true });
    k.noise(o, t, 8.5, { type: 'bandpass', freq: 1800, q: 0.5, vol: 0.12, attack: 0.01, hold: true }); // leaves
    birds(k, o, t, 11, 0.3);
    for (let i = 0; i < 2; i++) { const at = t + k.r(0.5, 7); k.tone(o, at, 0.35, { freq: 520, freqEnd: 380, vol: 0.12, attack: 0.05 }); k.tone(o, at + 0.4, 0.4, { freq: 470, freqEnd: 340, vol: 0.1, attack: 0.05 }); } // "hoo-hoo"
  } },
  ambMountain: { dur: 8.5, loop: 8, vars: 1, peak: 0.55, fn(k, o, t) {
    k.noise(o, t, 8.5, { type: 'bandpass', freq: 500, q: 0.7, vol: 0.6, attack: 0.01, hold: true });
    k.noise(o, t, 8.5, { type: 'lowpass', freq: 180, vol: 0.5, attack: 0.01, hold: true });
    for (let i = 0; i < 3; i++) k.noise(o, t + k.r(0, 6), k.r(1.5, 2.5), { type: 'bandpass', freq: k.r(900, 1400), freqEnd: k.r(600, 1800), q: 8, vol: 0.25, attack: 0.7 }); // gust whistles
  } },
  ambHaunted: { dur: 8.5, loop: 8, vars: 1, peak: 0.5, fn(k, o, t) {
    for (const [f, v] of [[110, 0.2], [110.5, 0.2], [164.75, 0.1], [233, 0.05]]) k.tone(o, t, 8.5, { freq: f, vol: v, attack: 0.01, hold: true }); // slow beating drone
    k.noise(o, t, 8.5, { type: 'lowpass', freq: 300, vol: 0.3, attack: 0.01, hold: true });
    for (let i = 0; i < 2; i++) k.noise(o, t + k.r(0, 5.5), 2.5, { type: 'bandpass', freq: k.r(500, 700), freqEnd: k.r(300, 450), q: 12, vol: 0.4, attack: 1 }); // ghostly moan
    for (let i = 0; i < 3; i++) k.bell(o, t + k.r(0, 7.5), 1.2, k.r(1200, 1700), 0.05, [[1, 1], [2.4, 0.4]]); // distant chimes
  } },
  ambCandy: { dur: 8.5, loop: 8, vars: 1, peak: 0.45, fn(k, o, t) {
    for (const [f, v] of [[523.25, 0.05], [659.25, 0.04], [784, 0.04]]) k.tone(o, t, 8.5, { freq: f, vol: v, attack: 0.01, hold: true }); // soft major shimmer
    k.noise(o, t, 8.5, { type: 'bandpass', freq: 900, q: 0.4, vol: 0.1, attack: 0.01, hold: true });
    const scale = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349, 2637];
    for (let i = 0; i < 16; i++) k.bell(o, t + k.r(0, 7.6), 0.7, scale[Math.floor(k.r(0, scale.length))], k.r(0.06, 0.16), [[1, 1], [2, 0.3], [3, 0.1]]); // sparkles
  } },

  // ---------- vehicles (vehicles.js): engine loops get setRate() from speed ----------
  // Sport Board: hover hum + airy whoosh
  boardHum: { dur: 2.4, loop: 2, vars: 1, peak: 0.5, fn(k, o, t) {
    k.tone(o, t, 2.4, { type: 'sine', freq: 110, vol: 0.5, attack: 0.01, hold: true });
    k.tone(o, t, 2.4, { type: 'triangle', freq: 220, vol: 0.16, attack: 0.01, hold: true, detune: 6 });
    k.noise(o, t, 2.4, { type: 'bandpass', freq: 1400, q: 0.7, vol: 0.35, attack: 0.01, hold: true });
  } },
  // Golf Cart: putt-putt motor (12 Hz wobble = 24 cycles per loop) with an electric whine
  cartMotor: { dur: 2.2, loop: 2, vars: 1, peak: 0.55, fn(k, o, t) {
    const f = k.c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.connect(o);
    const lfo = k.c.createOscillator(); lfo.frequency.value = 12; const lg = k.c.createGain(); lg.gain.value = 0.35;
    const amp = k.c.createGain(); amp.gain.value = 0.65; lfo.connect(lg); lg.connect(amp.gain); amp.connect(f);
    lfo.start(t); lfo.stop(t + 2.3);
    k.tone(amp, t, 2.2, { type: 'sawtooth', freq: 60, vol: 0.6, attack: 0.01, hold: true });
    k.tone(amp, t, 2.2, { type: 'square', freq: 90, vol: 0.2, attack: 0.01, hold: true });
    k.noise(amp, t, 2.2, { type: 'lowpass', freq: 400, vol: 0.3, attack: 0.01, hold: true });
    k.tone(o, t, 2.2, { type: 'sine', freq: 440, vol: 0.05, attack: 0.01, hold: true });
  } },
  // Sport Copter: rotor chop (9 Hz = 18 cycles per loop) over a low drone and turbine whine
  copterRotor: { dur: 2.2, loop: 2, vars: 1, peak: 0.65, fn(k, o, t) {
    const lfo = k.c.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 9; const lg = k.c.createGain(); lg.gain.value = 0.5;
    const amp = k.c.createGain(); amp.gain.value = 0.5; lfo.connect(lg); lg.connect(amp.gain); amp.connect(o);
    lfo.start(t); lfo.stop(t + 2.3);
    k.noise(amp, t, 2.2, { type: 'lowpass', freq: 300, vol: 1, attack: 0.01, hold: true });
    k.noise(amp, t, 2.2, { type: 'bandpass', freq: 900, q: 1, vol: 0.35, attack: 0.01, hold: true });
    k.tone(o, t, 2.2, { type: 'triangle', freq: 54, vol: 0.25, attack: 0.01, hold: true });
    k.tone(o, t, 2.2, { type: 'sine', freq: 620, vol: 0.04, attack: 0.01, hold: true });
  } },
  // cartoon "meep meep" horn
  honk: { dur: 0.5, vars: 2, peak: 0.8, fn(k, o, t) {
    for (const d of [0, 0.2]) { k.tone(o, t + d, 0.16, { type: 'square', freq: 392, vol: 0.4, attack: 0.01 }); k.tone(o, t + d, 0.16, { type: 'square', freq: 494, vol: 0.3, attack: 0.01 }); }
  } },
  // board ollie pop
  boardPop: { dur: 0.3, vars: 3, peak: 0.7, fn(k, o, t) {
    k.noise(o, t, 0.05, { type: 'bandpass', freq: 2500, q: 2, vol: 0.8, attack: 0.001 });
    k.tone(o, t, 0.12, { type: 'triangle', freq: 300, freqEnd: 120, vol: 0.6 });
    k.tone(o, t + 0.02, 0.2, { type: 'sine', freq: 500, freqEnd: 1100, vol: 0.25 });
  } },
  // boost / mini-turbo whoosh
  boostBurst: { dur: 0.9, vars: 2, peak: 0.7, fn(k, o, t) {
    k.noise(o, t, 0.8, { type: 'bandpass', freq: 400, freqEnd: 3000, q: 1.2, vol: 0.8, attack: 0.05 });
    k.tone(o, t, 0.6, { type: 'sawtooth', freq: 120, freqEnd: 480, vol: 0.2, attack: 0.02 });
  } },
};

// a few chirping birds scattered across a loop
function birds(k, o, t, n, vol) {
  for (let i = 0; i < n; i++) {
    const at = t + k.r(0, 7.6), f = k.r(2400, 4400), notes = Math.floor(k.r(2, 6));
    for (let j = 0; j < notes; j++) k.tone(o, at + j * k.r(0.07, 0.12), 0.06, { freq: f * k.r(0.9, 1.1), freqEnd: f * k.r(1.15, 1.4), vol: vol * k.r(0.5, 1), attack: 0.005 });
  }
}

// render all variants of one recipe into AudioBuffers (one OfflineAudioContext per recipe)
export async function bakeRecipe(name, sampleRate, noise) {
  const r = RECIPES[name];
  const vars = r.vars || 3;
  const slot = r.dur + 0.05;
  const len = Math.ceil(slot * vars * sampleRate);
  const oc = new OfflineAudioContext(1, len, sampleRate);
  const bus = oc.createGain(); bus.connect(oc.destination);
  for (let v = 0; v < vars; v++) {
    const k = new Kit(oc, noise, (v + 1) / (vars + 1) * 0.618 + name.length * 0.01);
    r.fn(k, bus, v * slot + 0.001);
  }
  const all = (await oc.startRendering()).getChannelData(0);
  const out = [];
  for (let v = 0; v < vars; v++) {
    const n = Math.floor(r.dur * sampleRate);
    let data = all.slice(Math.floor(v * slot * sampleRate), Math.floor(v * slot * sampleRate) + n);
    if (r.loop) data = crossfadeLoop(data, Math.floor(r.loop * sampleRate));
    else data = trim(data, sampleRate);
    normalize(data, r.peak || 0.8);
    const buf = new AudioBuffer({ length: data.length, sampleRate, numberOfChannels: 1 });
    buf.copyToChannel(data, 0);
    out.push(buf);
  }
  return out;
}

function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m < 1e-6 || !Number.isFinite(m)) return;
  const k = peak / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function trim(d, sr) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  let end = d.length - 1;
  while (end > 0 && Math.abs(d[end]) < m * 0.0008) end--;
  end = Math.min(d.length, end + Math.floor(sr * 0.01));
  const out = d.slice(0, end);
  const f = Math.min(out.length, Math.floor(sr * 0.008));
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
  return out;
}

// make data[0..L) loop seamlessly by blending the rendered overhang into the start
function crossfadeLoop(d, L) {
  const x = Math.min(d.length - L, Math.floor(L * 0.25));
  const out = d.slice(0, L);
  for (let i = 0; i < x; i++) {
    const a = i / x;
    out[i] = out[i] * Math.sqrt(a) + d[L + i] * Math.sqrt(1 - a);
  }
  return out;
}
