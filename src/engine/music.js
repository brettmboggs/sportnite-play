// Procedural music: a lookahead scheduler on AudioContext time that plays drums, bass, pads, arps and
// leads. The match track is adaptive: setIntensity(0..1) adds layers, opens filters and pushes the
// tempo, so the music builds as the storm closes and fights get close.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// melodies: per bar, a list of [step16, midi, lengthInSteps]
const LOBBY_MELODY = [
  [[0, 72, 2], [2, 69, 2], [4, 72, 2], [6, 74, 1], [7, 72, 2], [10, 69, 2], [12, 65, 4]],
  [[0, 67, 2], [2, 69, 2], [4, 72, 3], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
  [[0, 74, 2], [2, 72, 2], [4, 74, 2], [6, 77, 2], [8, 76, 3], [11, 74, 1], [12, 72, 4]],
  [[0, 70, 2], [2, 69, 2], [4, 70, 2], [6, 72, 2], [8, 74, 4], [12, 72, 2], [14, 69, 2]],
  [[0, 72, 2], [2, 69, 2], [4, 72, 2], [6, 74, 1], [7, 72, 2], [10, 77, 2], [12, 76, 4]],
  [[0, 79, 2], [2, 76, 2], [4, 72, 3], [8, 76, 2], [10, 79, 2], [12, 76, 4]],
  [[0, 74, 2], [2, 77, 2], [4, 81, 3], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 74, 2]],
  [[0, 77, 6], [8, 72, 2], [10, 74, 2], [12, 77, 4]],
];
const MATCH_MELODY = [
  [[0, 69, 3], [3, 72, 3], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 71, 2], [14, 72, 2]],
  [[0, 72, 3], [3, 69, 3], [6, 65, 2], [8, 69, 4], [12, 72, 4]],
  [[0, 67, 3], [3, 72, 3], [6, 76, 2], [8, 79, 4], [12, 76, 4]],
  [[0, 74, 3], [3, 71, 3], [6, 67, 2], [8, 74, 2], [10, 76, 2], [12, 79, 4]],
];
// the blimp / skydive theme: big, bright and a little heroic
const DROP_MELODY = [
  [[0, 74, 3], [3, 76, 3], [6, 78, 2], [8, 81, 6], [14, 78, 2]],
  [[0, 76, 3], [3, 74, 3], [6, 73, 2], [8, 76, 8]],
  [[0, 71, 3], [3, 74, 3], [6, 78, 2], [8, 83, 4], [12, 81, 2], [14, 78, 2]],
  [[0, 79, 3], [3, 78, 3], [6, 76, 2], [8, 74, 4], [12, 76, 4]],
];
const VICTORY_MELODY = [
  [[0, 72, 2], [2, 72, 1], [3, 72, 1], [4, 79, 6], [10, 76, 2], [12, 79, 4]],
  [[0, 77, 2], [2, 76, 2], [4, 77, 2], [6, 81, 6], [12, 79, 4]],
  [[0, 76, 2], [2, 74, 2], [4, 72, 4], [8, 76, 4], [12, 72, 4]],
  [[0, 74, 4], [4, 79, 4], [8, 83, 4], [12, 84, 4]],
];

const SONGS = {
  lobby: { bpm: 118, root: 53, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] }, // F  C  Dm  Bb
  match: { bpm: 100, root: 45, prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] }, // Am F  C  G
  victory: { bpm: 126, root: 48, prog: [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]] }, // C  F  Am G
  drop: { bpm: 128, root: 50, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] }, // D  A  Bm G
  tense: { bpm: 132, root: 45, prog: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 2, 5]] }, // Am Bb Am G
};

// stereo reverb impulse: decaying noise that gets darker over time
export function makeImpulse(c, dur = 2.4, decay = 3) {
  const sr = c.sampleRate, len = Math.floor(sr * dur), pre = Math.floor(sr * 0.012);
  const buf = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.75);
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export class Music {
  constructor(c, dest, stingDest, noise) {
    this.c = c; this.dest = dest; this.stingDest = stingDest; this.noise = noise;
    // shared reverb + tempo-synced echo
    this.reverb = c.createConvolver(); this.reverb.buffer = makeImpulse(c, 2.6, 3);
    const rv = c.createGain(); rv.gain.value = 0.8; this.reverb.connect(rv); rv.connect(dest);
    this.delay = c.createDelay(2);
    const fb = c.createGain(); fb.gain.value = 0.33;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    const dOut = c.createGain(); dOut.gain.value = 0.55; dlp.connect(dOut); dOut.connect(dest);
    // stingers get their own little reverb send
    this.stingRev = c.createGain(); this.stingRev.gain.value = 0.5; this.stingRev.connect(this.reverb);
    this.I = 0; this.target = 0; this.floor = 0;
    this.style = null; this.timer = null; this.sess = null;
  }

  // fadeIn: seconds to come up to full volume (the endgame layer creeps in slowly)
  start(style = 'lobby', fadeIn = 0.6) {
    const map = { battle: 'match', early: 'match', match: 'match', lobby: 'lobby', victory: 'victory', drop: 'drop', final: 'tense', tense: 'tense' };
    const song = map[style] || 'lobby';
    this.floor = 0;
    if (this.timer && this.song === song) { this.style = style; return; }
    this.stop(0.8);
    const c = this.c;
    this.style = style; this.song = song; this.S = SONGS[song];
    const out = c.createGain(); out.gain.setValueAtTime(0.0001, c.currentTime); out.gain.exponentialRampToValueAtTime(0.7, c.currentTime + fadeIn); out.connect(this.dest);
    const pad = c.createGain(); pad.connect(out);
    const rev = c.createGain(); rev.gain.value = 0.35; rev.connect(this.reverb);
    const dly = c.createGain(); dly.gain.value = 0.3; dly.connect(this.delay);
    pad.connect(rev);
    this.sess = { out, pad, rev, dly };
    this.step = 0; this.bar = 0;
    this.I = Math.max(this.floor, song === 'match' || song === 'tense' ? Math.min(this.target, 0.2) : 1);
    this.setTempo(this.S.bpm);
    this.next = c.currentTime + (song === 'victory' ? 1.6 : 0.12); // let the win jingle land first
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(fade = 0.6) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.style = null; this.song = null;
    const s = this.sess; this.sess = null;
    if (!s) return;
    const t = this.c.currentTime;
    s.out.gain.cancelScheduledValues(t); s.out.gain.setValueAtTime(s.out.gain.value, t); s.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { s.out.disconnect(); s.rev.disconnect(); s.dly.disconnect(); }, (fade + 0.5) * 1000);
  }

  setIntensity(x) { this.target = clamp01(x); }

  setTempo(bpm) {
    this.bpm = bpm; this.sd = 60 / bpm / 4;
    this.delay.delayTime.setTargetAtTime(this.sd * 3, this.c.currentTime, 0.05); // dotted-eighth echo
  }

  tick() {
    const now = this.c.currentTime;
    if (this.next < now - 0.1) this.next = now + 0.05; // tab was throttled: resync instead of a note burst
    while (this.next < now + 0.2) {
      const s = this.step % 16;
      const tgt = Math.max(this.floor, this.target);
      this.I += Math.max(-0.02, Math.min(0.03, tgt - this.I));
      if (s === 0) {
        this.bar = Math.floor(this.step / 16);
        if (this.song === 'match') this.setTempo(Math.round(100 + 28 * this.I));
      }
      if (this.song === 'lobby') this.lobby(this.next, s, this.bar);
      else if (this.song === 'match') this.match(this.next, s, this.bar, this.I);
      else if (this.song === 'drop') this.drop(this.next, s, this.bar);
      else if (this.song === 'tense') this.tense(this.next, s, this.bar, this.I);
      else this.victory(this.next, s, this.bar);
      this.next += this.sd;
      this.step++;
    }
  }

  // ---------- arrangements ----------
  lobby(t, s, bar) {
    const S = this.S, chord = S.prog[bar % 4], R = S.root, cyc = bar % 16;
    const breakdown = cyc === 12 || cyc === 13, build = cyc === 14 || cyc === 15, hook = cyc >= 4 && cyc < 12;
    if (s === 0) {
      this.pad(t, chord.map((n) => R + 12 + n), this.sd * 16, breakdown ? 0.05 : 0.04, breakdown ? 900 : 1800);
      if ((cyc === 0 || cyc === 4) && bar > 0) this.crash(t, 0.35);
      if (cyc === 14) this.riser(t, this.sd * 32, 0.12);
    }
    if (!breakdown) {
      if (s % 4 === 0) this.kick(t, 0.95);
      if (s === 4 || s === 12) this.clap(t, 0.5);
      if (s % 4 === 2) this.hat(t, 0.16, true);
      else if (hook && s % 2 === 1) this.hat(t, 0.06);
      const bassSteps = { 0: 0, 3: 0, 6: 12, 8: 0, 10: 12, 11: 7, 14: 0 };
      if (s in bassSteps) this.bass(t, R - 12 + chord[0] + bassSteps[s], this.sd * 1.6, 0.4, 1);
    }
    if (build) {
      const every = cyc === 14 ? 2 : 1;
      if (s % every === 0) this.snare(t, 0.12 + 0.3 * ((cyc - 14) * 16 + s) / 32);
    }
    if (s % 2 === 0) { const n = chord[(s / 2) % chord.length] + (s >= 8 ? 12 : 0); this.pluck(t, R + 24 + n, breakdown ? 0.06 : 0.04); }
    if (hook) this.melody(t, s, LOBBY_MELODY[(cyc - 4) % 8], 0.055);
  }

  match(t, s, bar, I) {
    const S = this.S, chord = S.prog[bar % 4], R = S.root;
    if (s === 0) {
      this.pad(t, chord.map((n) => R + 12 + n), this.sd * 16, 0.065 - 0.02 * I, 900 + 2200 * I);
      if (I > 0.75 && bar % 4 === 0) this.crash(t, 0.3);
      if (I > 0.6 && bar % 8 === 7) this.riser(t, this.sd * 16, 0.08);
    }
    // arp: sparse when calm, 16ths when it's on
    const every = I < 0.3 ? 4 : I < 0.6 ? 2 : 1;
    if (s % every === 0) {
      const i = s / every;
      this.pluck(t, R + 24 + chord[i % chord.length] + (i % 6 >= 3 ? 12 : 0), 0.04 + 0.025 * (1 - I));
    }
    // bass: long notes -> 8ths -> driving 16ths with octave pops
    if (I < 0.4) { if (s === 0) this.bass(t, R - 12 + chord[0], this.sd * 15, 0.22 + 0.2 * I, 0.3); }
    if (I > 0.2) {
      const kickHit = I < 0.6 ? s === 0 || s === 10 : s % 4 === 0;
      if (kickHit) this.kick(t, 0.55 + 0.4 * I);
      if (I >= 0.4 && I < 0.6) { if (s % 2 === 0) this.bass(t, R - 12 + chord[0], this.sd * 1.7, 0.34, 0.6); }
      else if (I >= 0.6) this.bass(t, R - 12 + chord[0] + (s % 4 === 2 ? 12 : 0), this.sd * 0.9, 0.3, 0.6 + 0.4 * I);
    }
    if (I > 0.4) {
      if (s === 4 || s === 12) this.snare(t, 0.35 + 0.15 * I);
      if (I < 0.6 ? s % 2 === 0 : true) this.hat(t, s % 4 === 2 ? 0.12 : 0.06, I > 0.7 && s % 8 === 6);
    }
    if (I > 0.6 && bar % 4 === 3 && s >= 12) this.tom(t, [220, 180, 150, 120][s - 12], 0.4);
    if (I > 0.75) this.melody(t, s, MATCH_MELODY[bar % 4], 0.05);
  }

  // blimp + skydive: four-on-the-floor, rolling 16th arp, a soaring lead from bar 4
  drop(t, s, bar) {
    const S = this.S, chord = S.prog[bar % 4], R = S.root, cyc = bar % 8;
    if (s === 0) {
      this.pad(t, chord.map((n) => R + 12 + n), this.sd * 16, 0.045, cyc < 2 ? 1400 : 2600);
      if (cyc === 0 || cyc === 4) this.crash(t, 0.3);
      if (cyc === 3) this.riser(t, this.sd * 16, 0.1);
    }
    if (cyc >= 2 || s % 8 === 0) { if (s % 4 === 0) this.kick(t, 0.85); }
    if (cyc >= 2) {
      if (s === 4 || s === 12) { this.clap(t, 0.4); this.snare(t, 0.2); }
      this.hat(t, s % 4 === 2 ? 0.14 : 0.05, s % 4 === 2);
      if (s % 2 === 0) this.bass(t, R - 12 + chord[0] + (s % 8 === 6 ? 12 : 0), this.sd * 1.5, 0.34, 0.9);
    } else if (s === 0) this.bass(t, R - 12 + chord[0], this.sd * 15, 0.3, 0.4);
    this.pluck(t, R + 24 + chord[s % 3] + (s % 6 >= 3 ? 12 : 0), 0.03);
    if (cyc >= 4) this.melody(t, s, DROP_MELODY[bar % 4], 0.055);
    if (cyc >= 4 && (s === 0 || s === 6 || s === 10)) this.brass(t, chord.map((n) => R + 12 + n), this.sd * 2, 0.035);
  }

  // final circles: no melody, just a pulse that tells you it's almost over.
  // Throbbing 8th bass, ticking hats, a heartbeat kick, and a minor-second ostinato on top.
  tense(t, s, bar, I) {
    const S = this.S, chord = S.prog[bar % 4], R = S.root;
    if (s === 0) {
      this.pad(t, chord.map((n) => R + n), this.sd * 16, 0.05, 500 + 900 * I);
      if (bar % 8 === 7) this.riser(t, this.sd * 16, 0.07 + 0.05 * I);
      if (bar % 8 === 0 && bar > 0) this.crash(t, 0.18);
    }
    if (s === 0 || s === 3) this.kick(t, s === 0 ? 0.8 : 0.5); // ba-dum
    if (I > 0.35 && (s === 8 || s === 11)) this.kick(t, s === 8 ? 0.6 : 0.4);
    if (s % 2 === 0) this.bass(t, R - 12 + chord[0], this.sd * 0.8, 0.3, 0.35 + 0.4 * I);
    this.hat(t, s % 4 === 0 ? 0.07 : 0.03);
    if (I > 0.5 && (s === 4 || s === 12)) this.snare(t, 0.22 + 0.15 * I);
    if (s % 4 === 0) this.pluck(t, R + 24 + chord[0] + ((s / 4) % 2 ? 1 : 0), 0.035); // that creepy half-step
    if (bar % 4 === 3 && s >= 12) this.tom(t, [180, 160, 140, 120][s - 12], 0.25 + 0.2 * I);
  }

  victory(t, s, bar) {
    const S = this.S, chord = S.prog[bar % 4], R = S.root;
    if (s === 0) { this.pad(t, chord.map((n) => R + 12 + n), this.sd * 16, 0.04, 2400); if (bar % 4 === 0) this.crash(t, 0.35); }
    if (s % 4 === 0) this.kick(t, 0.9);
    if (s === 4 || s === 12) { this.snare(t, 0.35); this.clap(t, 0.3); }
    this.hat(t, s % 2 ? 0.05 : 0.1);
    if (s % 2 === 0) this.bass(t, R - 12 + chord[0] + (s % 4 === 2 ? 12 : 0), this.sd * 1.6, 0.36, 1);
    if (s === 0 || s === 3 || s === 6 || s === 10) this.brass(t, chord.map((n) => R + 12 + n), this.sd * (s === 10 ? 4 : 2), 0.06);
    if (bar % 4 === 3 && s >= 12) this.tom(t, [240, 200, 160, 130][s - 12], 0.45);
    this.melody(t, s, VICTORY_MELODY[bar % 4], 0.06);
  }

  melody(t, s, bar, vol) {
    for (const [st, m, len] of bar) if (st === s) this.lead(t, m, this.sd * len * 0.95, vol);
  }

  // ---------- instruments ----------
  env(g, t, a, dur, vol, sus = 0.6, rel = 0.12) {
    const p = g.gain;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(vol, t + a);
    p.setTargetAtTime(vol * sus, t + a, Math.max(0.02, dur * 0.3));
    p.setTargetAtTime(0, t + dur, rel);
    return t + dur + rel * 6;
  }

  osc(type, freq, t, end, detune = 0) {
    const o = this.c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.start(t); o.stop(end); return o;
  }

  nz(t, dur, type, freq, q, vol, dst, attack = 0.001, freqEnd = 0) {
    const c = this.c;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dst || this.sess.out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
  }

  kick(t, v) {
    const c = this.c, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g); g.connect(this.sess.out); o.start(t); o.stop(t + 0.42);
    this.nz(t, 0.012, 'highpass', 3000, 0.7, v * 0.25);
    // side-chain pump on the pads
    const p = this.sess.pad.gain; p.setTargetAtTime(0.35, t, 0.004); p.setTargetAtTime(1, t + 0.03, 0.07);
  }
  snare(t, v) {
    this.nz(t, 0.16, 'bandpass', 1900, 0.7, v);
    this.nz(t, 0.09, 'highpass', 5000, 0.7, v * 0.5);
    const c = this.c, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.07);
    g.gain.setValueAtTime(v * 0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(this.sess.out); o.start(t); o.stop(t + 0.12);
    const r = this.nz(t, 0.16, 'bandpass', 1900, 0.7, v * 0.4); r.connect(this.sess.rev);
  }
  clap(t, v) {
    for (let i = 0; i < 3; i++) this.nz(t + i * 0.011, 0.02, 'bandpass', 1150, 1.2, v);
    const r = this.nz(t + 0.03, 0.16, 'bandpass', 1150, 1, v * 0.6); r.connect(this.sess.rev);
  }
  hat(t, v, open = false) { this.nz(t, open ? 0.22 : 0.035, 'highpass', 7500, 0.7, v); }
  crash(t, v) { const g = this.nz(t, 1.6, 'highpass', 4500, 0.5, v); g.connect(this.sess.rev); }
  riser(t, dur, v) { const g = this.nz(t, dur, 'bandpass', 400, 2, v, null, dur * 0.95, 6000); g.connect(this.sess.rev); }
  tom(t, f, v) {
    const c = this.c, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.25);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.sess.out); g.connect(this.sess.rev); o.start(t); o.stop(t + 0.32);
  }

  bass(t, m, dur, v, bright = 1) {
    const c = this.c, f = mtof(m), g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(180, t); lp.frequency.exponentialRampToValueAtTime(300 + 1200 * bright, t + 0.012);
    lp.frequency.setTargetAtTime(200 + 250 * bright, t + 0.015, 0.08);
    const end = this.env(g, t, 0.005, dur, v, 0.7, 0.04);
    const a = this.osc('sawtooth', f, t, end), b = this.osc('sine', f / 2, t, end);
    const bg = c.createGain(); bg.gain.value = 0.8;
    a.connect(lp); b.connect(bg); bg.connect(g); lp.connect(g); g.connect(this.sess.out);
  }

  pad(t, notes, dur, v, cutoff) {
    const c = this.c, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
    const end = this.env(g, t, 0.25, dur, v, 0.85, 0.5);
    for (const m of notes) for (const d of [-9, 9]) this.osc('sawtooth', mtof(m), t, end, d).connect(lp);
    lp.connect(g); g.connect(this.sess.pad);
  }

  pluck(t, m, v) {
    const c = this.c, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(4500, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    this.osc('triangle', mtof(m), t, t + 0.32).connect(lp);
    const sq = this.osc('square', mtof(m), t, t + 0.32); const sg = c.createGain(); sg.gain.value = 0.25; sq.connect(sg); sg.connect(lp);
    lp.connect(g); g.connect(this.sess.out); g.connect(this.sess.dly);
  }

  lead(t, m, dur, v, dst = null) {
    const c = this.c, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 1;
    const end = this.env(g, t, 0.012, dur, v, 0.75, 0.09);
    const a = this.osc('square', mtof(m), t, end), b = this.osc('sawtooth', mtof(m), t, end, 7);
    if (dur > 0.3) { // a touch of delayed vibrato on long notes
      const lfo = this.osc('sine', 5.5, t, end), lg = c.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + Math.min(dur, 0.5));
      lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune);
    }
    const bg = c.createGain(); bg.gain.value = 0.5; b.connect(bg); bg.connect(lp); a.connect(lp); lp.connect(g);
    if (dst) { g.connect(dst); g.connect(this.stingRev); return; }
    g.connect(this.sess.out); g.connect(this.sess.dly); g.connect(this.sess.rev);
  }

  brass(t, notes, dur, v, dst = null) {
    const c = this.c, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.05); lp.frequency.setTargetAtTime(1300, t + 0.06, 0.15);
    const end = this.env(g, t, 0.02, dur, v, 0.7, 0.12);
    for (const m of notes) for (const d of [-6, 6]) this.osc('sawtooth', mtof(m), t, end, d).connect(lp);
    lp.connect(g);
    if (dst) { g.connect(dst); g.connect(this.stingRev); return; }
    g.connect(this.sess.out); g.connect(this.sess.rev);
  }

  // ---------- stingers (play on top of whatever music is running) ----------
  stinger(name) {
    const c = this.c, t = c.currentTime + 0.03, D = this.stingDest;
    if (name === 'victory') {
      [60, 64, 67, 72].forEach((m, i) => this.lead(t + i * 0.09, m + 12, 0.18, 0.09, D));
      this.brass(t + 0.38, [60, 64, 67, 72], 1.6, 0.09, D);
      this.stingNoise(t + 0.38, 1.8, 'highpass', 4500, 0.15);
    } else if (name === 'defeat') {
      // the classic "wah wah wahhh"
      [[64, 0.32], [63, 0.32], [62, 0.32], [61, 1.4]].forEach(([m, d], i) => this.lead(t + i * 0.36, m - 12, d, 0.12, D));
      this.brass(t + 1.08, [49, 56], 1.4, 0.04, D);
    } else if (name === 'stormForm') {
      this.lead(t, 76, 0.5, 0.05, D); this.lead(t + 0.25, 83, 0.9, 0.05, D);
    } else if (name === 'stormClosing') {
      for (const [f0, det] of [[196, -8], [196, 8], [293.7, 0]]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2, t + 1.4);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 1.3);
        const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 1.7);
        o.connect(lp); lp.connect(g); g.connect(D); g.connect(this.stingRev); o.start(t); o.stop(t + 1.8);
      }
      this.stingNoise(t, 1.5, 'lowpass', 200, 0.3, 1.2);
    } else if (name === 'levelUp') {
      [72, 76, 79, 84].forEach((m, i) => this.lead(t + i * 0.07, m, 0.25, 0.07, D));
    }
  }

  stingNoise(t, dur, type, freq, vol, attack = 0.005) {
    const g = this.nz(t, dur, type, freq, 0.7, vol, this.stingDest, attack);
    g.connect(this.stingRev);
  }
}
