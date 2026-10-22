import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { rand, clamp, damp, lerp } from '../engine/utils.js';
import { projectileModel, heldModel } from './models.js';
import { PICKAXE } from './weapons/data.js';
import { Poser } from './dances.js';
import { buildHero } from './heroRig.js';
import { applySkin } from './skins.js';
import { glyph, padGlyph, keyGlyph } from '../ui/glyphs.js';
import { HOOP_SPOTS } from '../world/venues.js';

// Sports mini-games: Home Run Derby, 3-Point Shootout (Hoops) and a Penalty Shootout.
// Played at their venues during a match (win = Rare Chest + gold) or from the menu (coins + high scores).
// Each game is a small class with setup / begin / update / animate / camera / dispose. The Minigames
// manager owns the flow (intro card -> play -> results), the controls, slow-mo, camera, crowd and UI,
// and always hands the player back in a clean state when a game ends or is quit.

const G = 9.8, MPH = 2.237, FT = 3.281;
const HR_GOAL = 4, HOOPS_GOAL = 15;
const INFO = {
  homerun: { title: 'HOME RUN DERBY', icon: '⚾', color: '#3aa0ff', unit: 'home runs' },
  hoops: { title: '3-POINT SHOOTOUT', icon: '🏀', color: '#ff7a1f', unit: 'points' },
  penalty: { title: 'PENALTY SHOOTOUT', icon: '⚽', color: '#3bbf4a', unit: 'goals' },
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V(), _v2 = V(), _v3 = V(), _m4 = new THREE.Matrix4(), _zero = V();
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _plane = new THREE.Plane();
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const NO_BUTTONS = new Array(18).fill(false);

// interpolate keyframes [{ s, ...arrays/numbers }] at progress s
function keyAt(keys, s, field) {
  let i = 0;
  while (i < keys.length - 2 && s > keys[i + 1].s) i++;
  const a = keys[i], b = keys[i + 1];
  const f = ease((s - a.s) / Math.max(1e-4, b.s - a.s));
  const x = a[field], y = b[field];
  return Array.isArray(x) ? x.map((v, k) => lerp(v, y[k], f)) : lerp(x, y, f);
}

// closest distance from point p to segment ab
function segDist(p, a, b, out = null) {
  const ab = _v2.subVectors(b, a), t = clamp(_v3.subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  const c = _v3.copy(a).addScaledVector(ab, t);
  if (out) out.copy(c);
  return c.distanceTo(p);
}

// ---------- prompts (both keyboard and controller versions; CSS shows the right one) ----------
const both = (kb, pad) => `<span class="kb-only">${kb}</span><span class="pad-only">${pad}</span>`;
const stick = (s) => `<span class="glyph pad wide">${s}</span>`;
function prompts(g) {
  return {
    act: both(glyph(g, 'fire', false) + glyph(g, 'jump', false), glyph(g, 'fire', true) + padGlyph(0)),
    aim: both(keyGlyph('Mouse') + keyGlyph('WASD'), stick('L STICK')),
    lr: both(keyGlyph('A') + keyGlyph('D'), stick('L STICK ◀▶')),
    dive: both(keyGlyph('A') + keyGlyph('D') + keyGlyph('W'), stick('L STICK') + padGlyph(0)),
    quit: both(glyph(g, 'pause', false), padGlyph(1)),
    ok: both(glyph(g, 'jump', false), padGlyph(0)),
  };
}

// ---------- little synth sounds on the game's audio graph (no new files) ----------
const sfx = {
  tone(freq, dur, { type = 'sine', vol = 0.2, end = null, delay = 0, attack = 0.005, vib = 0 } = {}) {
    const c = audio.ctx; if (!c || !audio.sfxBus) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(audio.sfxBus);
    if (vib) { const l = c.createOscillator(); l.frequency.value = 22; const lg = c.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, { freq = 1000, end = null, q = 1, type = 'bandpass', vol = 0.3, delay = 0, attack = 0.004 } = {}) {
    const c = audio.ctx; if (!c || !audio.noise || !audio.sfxBus) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = audio.noise; s.playbackRate.value = rand(0.9, 1.1);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (end) f.frequency.exponentialRampToValueAtTime(end, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(audio.sfxBus);
    s.start(t, rand(0, 1)); s.stop(t + dur + 0.05);
  },
  crack(k = 1) { // bat on ball
    this.noise(0.05, { type: 'highpass', freq: 2200, vol: 0.55 * k });
    this.tone(2100, 0.1, { type: 'triangle', end: 900, vol: 0.22 * k });
    this.tone(420, 0.12, { type: 'square', end: 160, vol: 0.12 * k });
    audio.play('hitWood', { vol: 0.5 + 0.4 * k });
  },
  whiff() { this.noise(0.22, { freq: 500, end: 1800, q: 1.4, vol: 0.25, attack: 0.05 }); },
  swish() { this.noise(0.3, { freq: 4200, end: 1600, q: 0.7, vol: 0.3, attack: 0.03 }); },
  glove() { this.noise(0.08, { type: 'lowpass', freq: 900, vol: 0.5 }); this.tone(160, 0.08, { vol: 0.25, end: 90 }); },
  whistle(long = false) { this.tone(2950, long ? 0.7 : 0.28, { vol: 0.08, vib: 90, attack: 0.02 }); if (long) this.tone(2950, 0.3, { vol: 0.08, vib: 90, delay: 0.8 }); },
  buzzer() { this.tone(180, 0.9, { type: 'sawtooth', vol: 0.12, attack: 0.01 }); this.tone(184, 0.9, { type: 'square', vol: 0.06, attack: 0.01 }); },
  beep() { this.tone(1320, 0.12, { type: 'square', vol: 0.06 }); },
  charge() { // ballpark organ "da da da DUN da DUNNN"
    [[67, 0], [72, 0.16], [76, 0.32], [79, 0.48], [76, 0.78], [79, 0.94]].forEach(([m, d], i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      this.tone(f, i === 5 ? 0.7 : 0.2, { type: 'square', vol: 0.05, delay: d });
      this.tone(f * 2, i === 5 ? 0.7 : 0.2, { type: 'sine', vol: 0.04, delay: d });
    });
  },
};

// Crowd noise bed that swells for big moments.
class Crowd {
  start() {
    const c = audio.ctx;
    if (!c || !audio.noise || this.src) return;
    this.src = c.createBufferSource(); this.src.buffer = audio.noise; this.src.loop = true; this.src.playbackRate.value = 0.5;
    this.f = c.createBiquadFilter(); this.f.type = 'bandpass'; this.f.frequency.value = 650; this.f.Q.value = 0.6;
    this.g = c.createGain(); this.g.gain.value = 0;
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 2.7;
    this.lfoG = c.createGain(); this.lfoG.gain.value = 0.01;
    this.lfo.connect(this.lfoG); this.lfoG.connect(this.g.gain);
    this.src.connect(this.f); this.f.connect(this.g); this.g.connect(audio.sfxBus);
    this.src.start(); this.lfo.start();
    this.base = 0.04; this.level(0.4);
  }
  level(x) { this.base = 0.02 + x * 0.06; if (this.g) this.g.gain.setTargetAtTime(this.base, audio.ctx.currentTime, 0.5); }
  cheer(k = 1) {
    if (!this.g) return;
    const t = audio.ctx.currentTime, gn = this.g.gain, f = this.f.frequency;
    gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
    gn.setTargetAtTime(0.12 + 0.13 * Math.min(k, 1.6), t, 0.06); gn.setTargetAtTime(this.base, t + 0.6 + k * 1.4, 0.7);
    f.cancelScheduledValues(t); f.setTargetAtTime(1150, t, 0.08); f.setTargetAtTime(650, t + 0.8 + k, 0.8);
    for (let i = 0; i < Math.round(1 + k * 3); i++) sfx.tone(rand(1900, 2700), rand(0.25, 0.5), { vol: 0.025, vib: 60, delay: rand(0.05, 0.9), attack: 0.03 });
    for (let i = 0; i < Math.round(4 + k * 8); i++) sfx.noise(0.05, { freq: rand(1500, 3000), q: 2, vol: 0.05, delay: rand(0, 1.2) });
  }
  aww() {
    if (!this.g) return;
    const t = audio.ctx.currentTime, gn = this.g.gain, f = this.f.frequency;
    gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
    gn.setTargetAtTime(0.11, t, 0.1); gn.setTargetAtTime(this.base, t + 0.9, 0.5);
    f.cancelScheduledValues(t); f.setValueAtTime(900, t); f.exponentialRampToValueAtTime(320, t + 1.0); f.setTargetAtTime(650, t + 1.1, 0.5);
  }
  stop() {
    if (!this.src) return;
    const t = audio.ctx.currentTime, src = this.src, lfo = this.lfo;
    this.g.gain.cancelScheduledValues(t); this.g.gain.setTargetAtTime(0, t, 0.3);
    src.stop(t + 1.5); lfo.stop(t + 1.5);
    this.src = null; this.g = null;
  }
}

// A non-player character for the pitcher, goalie and penalty taker (no physics, just a posed model).
class Npc {
  constructor(game, file, kit) {
    const h = buildHero(file);
    this.body = h.frame;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group(); // pivot at the hips, for dives
    this.tilt.position.y = 0.9; this.body.position.y = -0.9;
    this.tilt.add(this.body); this.root.add(this.tilt);
    // team kit: the shirt is repainted in the team color
    this.materials = h.materials;
    applySkin(this, { model: file, effect: 'kit', kit });
    this.mixer = h.mixer;
    this.actions = h.actions;
    this.bones = h.bones;
    this.poser = new Poser(this.body, this.bones);
    this.cur = null;
    this.play('Idle');
    game.scene.add(this.root);
  }
  play(name, fade = 0.15, once = false) {
    const a = this.actions[name];
    if (!a || (this.cur === name && !once)) return;
    const prev = this.actions[this.cur];
    if (prev && prev !== a) prev.fadeOut(fade);
    a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.cur = name;
  }
  // advance the animation and return the poser, ready for procedural tweaks on top
  update(dt) {
    this.poser.restore();
    this.mixer.update(dt);
    return this.poser.begin();
  }
  point(local, out = V()) { this.root.updateMatrixWorld(true); return this.tilt.localToWorld(out.set(local[0], local[1] - 0.9, local[2])); }
  dispose() { this.root.removeFromParent(); this.mixer.stopAllAction(); }
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// Strand nets built in venues.js: wobble them around their rest shape
function wobbleNet(net, fn) {
  const arr = net.mesh.geometry.attributes.position.array, base = net.base, w = net.w;
  for (let i = 0, n = w.length; i < n; i++) {
    const o = fn(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], w[i]);
    arr[i * 3] = base[i * 3] + o[0]; arr[i * 3 + 1] = base[i * 3 + 1] + o[1]; arr[i * 3 + 2] = base[i * 3 + 2] + o[2];
  }
  net.mesh.geometry.attributes.position.needsUpdate = true;
}
function resetNet(net) { if (!net) return; net.mesh.geometry.attributes.position.array.set(net.base); net.mesh.geometry.attributes.position.needsUpdate = true; }

// =====================================================================================
export class Minigames {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.done = new Set();
    this.doneMatch = null;
    this.mustLeave = null; // the zone we just played: you have to step out before it triggers again
    this.ts = 1; this.slowT = 0; this.slowTo = 1; this.stopT = 0;
    this.shakeAmt = 0;
    this.hype = 0.4;
    this.mouse = { x: 0, y: 0, moved: false };
    this.prevPad = new Array(18).fill(false);
    this.prevKeys = new Set();
    this.prevAction = false;
    this.camPos = V(); this.camLook = V(); this.cut = true;
    this.crowd = new Crowd();
    this.ui = new MgUI(this);
    addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1; this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) this.mouse.moved = true;
    });
    // the bleacher crowds jump with the mini-game hype
    const animateCrowd = game.animateCrowd.bind(game);
    game.animateCrowd = (crowd) => (this.active ? this.animateCrowd(crowd) : animateCrowd(crowd));
  }

  get zones() { return this.game.world.minigames; }

  zoneAt(pos) {
    const g = this.game;
    if (this.active) return null;
    if (g.match !== this.doneMatch) { this.done.clear(); this.doneMatch = g.match; }
    for (const z of this.zones) {
      const inside = Math.hypot(pos.x - z.x, pos.z - z.z) < z.r && Math.abs(pos.y - z.y) < 3;
      if (z === this.mustLeave) { if (!inside) this.mustLeave = null; continue; }
      if (inside) { z.done = this.done.has(z.type); return z; }
    }
    return null;
  }

  // ---------- lifecycle ----------
  start(zone, practice = false) {
    const g = this.game, p = g.player;
    const Game = zone && GAMES[zone.type];
    if (!p || this.active || !Game) return;
    if (!practice && this.done.has(zone.type)) return;
    audio.init();
    const inp = g.input;
    this.saved = { pos: p.pos.clone(), sel: p.inv.sel, hideHeld: !!p.hideHeld, yaw: g.cameraRig.yaw, pitch: g.cameraRig.pitch, fov: g.cameraRig.cam.fov, wantLock: inp.wantLock, onPause: inp.onPauseRequest };
    if (g.playerCtl) { g.playerCtl.setBuild(false); g.playerCtl.ghostOff(); }
    Object.assign(p, { emoting: false, aiming: false, firing: false, crouching: false, slideT: 0, swingT: 0, useT: 0, useItem: null });
    p.vel.set(0, 0, 0);
    p.hideHeld = true;
    p.inv.sel = -1;
    // free the mouse: mini-games aim with the cursor, and Esc must reach us instead of unlocking the pointer
    inp.wantLock = false; inp.releaseLock();
    inp.onPauseRequest = () => { if (this.active && this.active.phase === 'play') this.pause(); };
    this.ts = 1; this.slowT = 0; this.stopT = 0; this.shakeAmt = 0; this.cut = true;
    this.prevAction = true; // a held button from before doesn't count as a fresh press
    const a = { type: zone.type, zone, practice, info: INFO[zone.type], phase: 'intro', t: 0, phaseT: 0, phaseAt: performance.now() };
    this.active = a;
    a.game = new Game(this, a);
    a.game.setup();
    this.crowd.start(); this.crowd.level(0.5);
    this.hype = 0.8;
    this.ui.show(a);
    this.ui.intro(a);
    audio.jingle('start', 0.5);
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    try { this.tick(dt, a); }
    catch (e) {
      // never trap the player inside a broken mini-game
      console.error('Mini-game error, returning to normal play', e);
      this.stop();
      if (a.practice) this.game.returnToLobby();
    }
  }

  tick(dt, a) {
    const g = this.game, p = g.player;
    if (!p || !p.alive) { this.stop(); return; }
    const c = this.controls(dt);
    // time: hit-stop freezes for a few frames, slow-mo eases in and out
    if (this.stopT > 0) { this.stopT -= dt; this.ts = 0; }
    else {
      if (this.slowT > 0) this.slowT -= dt;
      this.ts = damp(this.ts, this.slowT > 0 ? this.slowTo : 1, this.slowT > 0 ? 18 : 5, dt);
      if (Math.abs(this.ts - 1) < 0.01) this.ts = 1;
    }
    const sdt = a.phase === 'pause' ? 0 : dt * this.ts;
    a.t += dt; a.phaseT += dt;
    p.vel.set(0, 0, 0);
    const game = a.game;
    if (a.phase === 'play') {
      if (c.back) this.pause();
      else game.update(sdt, c, dt);
    } else if (c.back) this.cardAction('back');
    else if ((c.confirm || (c.actionPressed && a.phase !== 'result')) && performance.now() - a.phaseAt > (a.phase === 'result' ? 1200 : 300)) this.cardAction('go');
    if (this.active !== a) return; // the game ended this frame
    game.animate(sdt, dt);
    this.updateCamera(dt, a);
    this.hype = damp(this.hype, 0.45, 0.5, dt);
    this.ui.update(dt, a, c);
  }

  cardAction(act) {
    const a = this.active;
    if (!a) return;
    audio.ui(act === 'go' ? 'confirm' : 'click');
    if (a.phase === 'intro') {
      if (act === 'back') return this.quit();
      a.phase = 'play'; a.phaseT = 0; a.phaseAt = performance.now(); this.ui.hideCard(); a.game.needRelease = true; a.game.begin();
    } else if (a.phase === 'pause') {
      if (act === 'back') return this.quit();
      a.phase = 'play'; a.phaseAt = performance.now(); this.ui.hideCard(); a.game.needRelease = true; this.crowd.level(0.5);
    } else if (a.phase === 'result') {
      if (act === 'go' && a.practice) this.restart();
      else this.finish();
    } else if (a.phase === 'play' && act === 'back') this.pause();
  }

  pause() {
    const a = this.active;
    if (!a || a.phase !== 'play') return;
    a.phase = 'pause'; a.phaseT = 0; a.phaseAt = performance.now();
    this.crowd.level(0.2);
    this.ui.pauseCard(a);
  }

  // leave without a result
  quit() {
    const a = this.active;
    if (!a) return;
    this.end();
    if (a.practice) this.game.returnToLobby();
    else this.game.hud.toast('Left the mini-game. Step out and back in to play again!');
  }

  // called by a game when it's over
  endGame(res) {
    const a = this.active;
    if (!a || a.phase === 'result') return;
    a.phase = 'result'; a.phaseT = 0; a.phaseAt = performance.now(); a.res = res;
    const g = this.game, p = g.player;
    if (a.practice) {
      const d = g.save.data;
      d.highscores = d.highscores || {};
      const prev = d.highscores[a.type] || 0;
      res.newBest = res.score > prev;
      res.best = Math.max(prev, res.score);
      d.highscores[a.type] = res.best;
      res.coinsWon = (res.coins || 0) + (res.win ? 50 : 0);
      d.coins += res.coinsWon;
      g.save.write();
    }
    if (res.win) {
      audio.jingle('win', 0.6); audio.stinger('victory'); this.crowd.cheer(1.6); this.hype = 1.8;
      for (let i = 0; i < 4; i++) setTimeout(() => this.active === a && g.effects.confetti(p.center.add(V(rand(-3, 3), rand(1, 3), rand(-3, 3))), 70), i * 280);
    } else { audio.jingle('lose', 0.5); this.crowd.aww(); }
    this.ui.result(a);
  }

  finish() {
    const a = this.active;
    if (!a) return;
    const win = a.res && a.res.win;
    this.end();
    const g = this.game;
    if (a.practice) { g.returnToLobby(); return; }
    if (win) {
      this.done.add(a.type);
      const p = g.player;
      const fwd = V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const at = p.pos.clone().addScaledVector(fwd, 2.2);
      at.y = g.loot.surfaceY ? g.loot.surfaceY(at) : at.y;
      g.loot.spawnChest(at, true);
      p.inv.gold += 150;
      g.effects.confetti(at.clone().add(V(0, 1, 0)), 80);
      g.hud.bigMessage('🏆 MINI-GAME WON!', 'A Rare Chest + 150 gold appeared!');
    } else g.hud.toast('Step out and back in to try again!');
  }

  restart() {
    const a = this.active;
    if (!a) return;
    const zone = a.zone;
    this.end();
    this.start(zone, true);
    // straight back into the action, no intro card the second time
    if (this.active) this.cardAction('go');
  }

  // hard stop (returning to the lobby, errors). Safe to call any time.
  stop() { if (this.active) this.end(); }

  end() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    try { a.game.dispose(); } catch (e) { console.error(e); }
    this.ui.hide();
    this.crowd.stop();
    this.ts = 1; this.slowT = 0; this.stopT = 0; this.shakeAmt = 0;
    const g = this.game, p = g.player, inp = g.input, s = this.saved || {};
    if (s.onPause) inp.onPauseRequest = s.onPause;
    inp.enabled = true;
    inp.circleT = -1; // the ◯ that quit us must not toggle build mode when it's let go
    for (const act of ['jump', 'interact', 'fire', 'pause']) inp.consume(act);
    if (p) {
      p.hideHeld = s.hideHeld || false;
      p.inv.sel = s.sel ?? -1;
      Object.assign(p, { swingT: 0, emoting: false, aiming: false, firing: false, grounded: true, state: 'ground' });
      if (p.anim) p.anim.onceUntil = 0;
      if (p.alive) p.play('Idle', 0.1);
      if (s.pos) p.setPosition(s.pos);
      p.vel.set(0, 0, 0);
      p.root.visible = true;
      g.events.emit('inventory', p);
    }
    const rig = g.cameraRig;
    rig.yaw = s.yaw ?? rig.yaw; rig.pitch = clamp(s.pitch ?? 0, -0.6, 0.6); rig.pivotY = null; rig.shakeAmt = 0;
    rig.cam.fov = s.fov || rig.fovBase; rig.cam.updateProjectionMatrix();
    if (!a.practice) {
      this.mustLeave = a.zone;
      inp.wantLock = s.wantLock ?? true;
      inp.requestLock();
    }
  }

  // ---------- feel ----------
  slow(to, dur) { this.slowTo = to; this.slowT = Math.max(this.slowT, dur); }
  hitstop(dur) { this.stopT = Math.max(this.stopT, dur); }
  shake(k) { this.shakeAmt = Math.min(1.5, this.shakeAmt + k); this.game.input.rumble(Math.min(1, k), Math.min(1, k * 0.8), 90 + k * 120); }
  cheer(k = 1) { this.crowd.cheer(k); this.hype = Math.max(this.hype, 0.9 + k * 0.6); }

  animateCrowd(crowd) {
    const t = this.game.time, h = this.hype;
    for (let i = 0; i < crowd.base.length; i++) {
      _m4.copy(crowd.base[i]);
      _m4.elements[13] += Math.max(0, Math.sin(t * (5 + h * 5) + i * 1.7)) * (0.08 + h * 0.4);
      crowd.mesh.setMatrixAt(i, _m4);
    }
    crowd.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- controls ----------
  controls() {
    const inp = this.game.input, st = inp.pad ? inp.padState : null;
    const b = st ? st.buttons : NO_BUTTONS;
    const edge = (i) => b[i] && !this.prevPad[i];
    const kp = (code) => inp.keys.has(code) && !this.prevKeys.has(code);
    const kd = (code) => inp.keys.has(code);
    const action = inp.down('fire') || inp.down('jump');
    let mx = inp.move.x + (kd('ArrowRight') ? 1 : 0) - (kd('ArrowLeft') ? 1 : 0);
    let my = inp.move.y + (kd('ArrowUp') ? 1 : 0) - (kd('ArrowDown') ? 1 : 0);
    let lx = 0, ly = 0;
    if (st) { lx = Math.abs(st.axes[2]) > 0.15 ? st.axes[2] : 0; ly = Math.abs(st.axes[3]) > 0.15 ? -st.axes[3] : 0; }
    const c = {
      action, actionPressed: action && !this.prevAction, actionReleased: !action && this.prevAction,
      confirm: inp.pressed('jump') || kp('Enter') || kp('NumpadEnter') || inp.pressed('interact'),
      back: inp.pressed('pause') || edge(1) || kp('Backspace'),
      move: { x: clamp(mx, -1, 1), y: clamp(my, -1, 1) },
      stick: { x: clamp(mx + lx, -1, 1), y: clamp(my + ly, -1, 1) },
      mouse: this.mouse.moved && !inp.usingPad ? { x: this.mouse.x, y: this.mouse.y } : null,
      mouseAt: { x: this.mouse.x, y: this.mouse.y },
      pad: inp.usingPad,
    };
    for (let i = 0; i < 18; i++) this.prevPad[i] = b[i];
    this.prevKeys = new Set(inp.keys);
    this.prevAction = action;
    this.mouse.moved = false;
    return c;
  }

  // where the mouse ray hits a plane (normal, point)
  mouseOnPlane(ndc, normal, point, out = V()) {
    _ndc.set(ndc.x, ndc.y);
    _ray.setFromCamera(_ndc, this.game.cameraRig.cam);
    _plane.setFromNormalAndCoplanarPoint(normal, point);
    return _ray.ray.intersectPlane(_plane, out);
  }

  toScreen(p) {
    _v.copy(p).project(this.game.cameraRig.cam);
    return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, ok: _v.z < 1 && _v.z > -1 };
  }

  // ---------- broadcast camera ----------
  updateCamera(dt, a) {
    const g = this.game, cam = g.cameraRig.cam, goal = a.game.cam;
    a.game.camera(dt, a.phase);
    if (a.phase === 'result') {
      // celebration orbit around the player
      const p = g.player.pos, t = a.phaseT * 0.35 + 1;
      goal.eye.set(p.x + Math.sin(t) * 5.5, p.y + 2.2, p.z + Math.cos(t) * 5.5);
      goal.look.set(p.x, p.y + 2.3, p.z); goal.fov = 50; goal.k = 2; goal.kl = 3;
    }
    if (this.cut) { this.camPos.copy(goal.eye); this.camLook.copy(goal.look); cam.fov = goal.fov; this.cut = false; }
    else {
      const k = 1 - Math.exp(-(goal.k || 5) * dt);
      this.camPos.lerp(goal.eye, k); this.camLook.lerp(goal.look, 1 - Math.exp(-(goal.kl || goal.k || 5) * dt));
      cam.fov = damp(cam.fov, goal.fov, 4, dt);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.025;
      cam.rotation.x += rand(-s, s); cam.rotation.y += rand(-s, s); cam.rotation.z += rand(-s, s) * 0.5;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    }
    cam.updateProjectionMatrix();
    g.renderer.followShadow(goal.shadow || g.player.pos);
    audio.setListener(cam.position, cam.getWorldDirection(_v));
  }

  // big moments: callout text + crowd + particles
  call(text, cls = '', dur = 1.4) { this.ui.call(text, cls, dur); }
}

// =====================================================================================
// HUD for the mini-games: scorebug, callouts, meters, reticle, hint bar and the intro/pause/result cards
class MgUI {
  constructor(mg) {
    this.mg = mg; this.game = mg.game;
    const root = this.root = document.createElement('div');
    root.className = 'mgx hidden';
    root.innerHTML = `
      <div class="mgx-bug"><div class="mgx-bug-head"><span class="mgx-bug-icon"></span><span class="mgx-bug-title"></span></div><div class="mgx-bug-body"></div></div>
      <button class="mgx-quit"></button>
      <div class="mgx-tags"></div>
      <div class="mgx-reticle hidden"><i></i></div>
      <div class="mgx-meter hidden"><div class="mgx-meter-good"></div><div class="mgx-meter-green"></div><div class="mgx-meter-fill"></div><div class="mgx-meter-needle"></div><div class="mgx-meter-label"></div></div>
      <div class="mgx-timing hidden"><span>EARLY</span><span>PERFECT</span><span>LATE</span><i></i></div>
      <div class="mgx-lower hidden"><b></b><span></span></div>
      <div class="mgx-call"></div>
      <div class="mgx-hints"></div>
      <div class="mgx-flash"></div>
      <div class="mgx-card hidden"></div>`;
    document.getElementById('ui').appendChild(root);
    const q = (s) => root.querySelector(s);
    this.el = {
      icon: q('.mgx-bug-icon'), title: q('.mgx-bug-title'), bug: q('.mgx-bug-body'), quit: q('.mgx-quit'), tags: q('.mgx-tags'),
      reticle: q('.mgx-reticle'), meter: q('.mgx-meter'), mGood: q('.mgx-meter-good'), mGreen: q('.mgx-meter-green'), mFill: q('.mgx-meter-fill'),
      mNeedle: q('.mgx-meter-needle'), mLabel: q('.mgx-meter-label'), timing: q('.mgx-timing'), lower: q('.mgx-lower'), call: q('.mgx-call'),
      hints: q('.mgx-hints'), flash: q('.mgx-flash'), card: q('.mgx-card'),
    };
    this.el.quit.onclick = () => { const a = mg.active; if (!a) return; if (a.phase === 'play') mg.pause(); else mg.cardAction('back'); };
    this.el.card.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) mg.cardAction(b.dataset.act); });
    this.lowerT = 0; this.callT = 0; this.cache = {};
  }

  set(key, el, html) { if (this.cache[key] !== html) { this.cache[key] = html; el.innerHTML = html; } }

  show(a) {
    const P = prompts(this.game);
    this.root.style.setProperty('--mc', a.info.color);
    this.el.icon.textContent = a.info.icon; this.el.title.textContent = a.info.title;
    this.el.quit.innerHTML = `${P.quit} QUIT`;
    this.cache = {};
    this.root.classList.remove('hidden');
    this.hideMeter(); this.el.reticle.classList.add('hidden'); this.el.timing.classList.add('hidden'); this.el.lower.classList.add('hidden');
    this.el.tags.innerHTML = ''; this.el.call.className = 'mgx-call';
  }
  hide() { this.root.classList.add('hidden'); this.hideCard(); this.el.tags.innerHTML = ''; }

  intro(a) {
    const P = prompts(this.game), it = a.game.intro(P);
    this.card(`<div class="mgx-card-in intro">
      <div class="mgx-card-icon">${a.info.icon}</div>
      <div class="mgx-card-title">${a.info.title}</div>
      <div class="mgx-card-sub">${it.sub}</div>
      <div class="mgx-steps">${it.steps.map(([k, t]) => `<div class="mgx-step"><span class="k">${k}</span><span>${t}</span></div>`).join('')}</div>
      <div class="mgx-card-goal">🏆 ${a.practice ? it.goal + ' · beat your best for coins!' : it.goal + ' for a RARE CHEST!'}</div>
      <div class="mgx-btns"><button class="mgx-btn go" data-act="go">${P.ok} ${it.go || "LET'S GO!"}</button><button class="mgx-btn" data-act="back">${P.quit} Back</button></div>
    </div>`);
  }

  pauseCard() {
    const P = prompts(this.game);
    this.card(`<div class="mgx-card-in small">
      <div class="mgx-card-title">PAUSED</div>
      <div class="mgx-card-sub">Quit this mini-game?</div>
      <div class="mgx-btns"><button class="mgx-btn go" data-act="go">${P.ok} Keep playing</button><button class="mgx-btn" data-act="back">${P.quit} Quit</button></div>
    </div>`);
  }

  result(a) {
    const P = prompts(this.game), r = a.res;
    const rewards = a.practice
      ? `<div class="mgx-reward">🪙 +${r.coinsWon} coins${r.newBest ? ' · <b>NEW BEST!</b>' : ` · Best: ${r.best}`}</div>`
      : r.win ? '<div class="mgx-reward">🎁 A <b>Rare Chest</b> + 150 gold are waiting!</div>' : '<div class="mgx-reward">No prize this time. Try again later!</div>';
    this.card(`<div class="mgx-card-in result ${r.win ? 'win' : 'lose'}">
      <div class="mgx-result">${r.win ? 'YOU WIN!' : r.title || 'NICE TRY!'}</div>
      <div class="mgx-card-sub">${r.sub || ''}</div>
      <div class="mgx-stats">${r.stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${rewards}
      <div class="mgx-btns">${a.practice
        ? `<button class="mgx-btn go" data-act="go">${P.ok} Play again</button><button class="mgx-btn" data-act="back">${P.quit} Exit</button>`
        : `<button class="mgx-btn go" data-act="go">${P.ok} Continue</button>`}</div>
    </div>`);
  }

  card(html) { this.el.card.innerHTML = html; this.el.card.classList.remove('hidden'); }
  hideCard() { this.el.card.classList.add('hidden'); this.el.card.innerHTML = ''; }

  call(text, cls = '', dur = 1.4) {
    const c = this.el.call;
    c.textContent = text;
    c.className = 'mgx-call';
    void c.offsetWidth;
    c.className = `mgx-call show${cls ? ` c-${cls}` : ''}`;
    c.style.animationDuration = `${dur}s`;
  }
  lower(title, sub = '', dur = 2.4) {
    this.el.lower.querySelector('b').innerHTML = title;
    this.el.lower.querySelector('span').innerHTML = sub;
    this.el.lower.classList.remove('hidden', 'show'); void this.el.lower.offsetWidth; this.el.lower.classList.add('show');
    this.lowerT = dur;
  }
  flash() { const f = this.el.flash; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  // m = { x, y (screen px), vertical, fill 0..1, green [a,b], good [a,b], needle, label, grade }
  meter(m) {
    const e = this.el, el = e.meter;
    el.classList.remove('hidden');
    el.classList.toggle('h', !m.vertical);
    el.dataset.grade = m.grade || '';
    el.style.left = `${m.x}px`; el.style.top = `${m.y}px`;
    const pos = (node, a, b) => { if (m.vertical) { node.style.bottom = `${a * 100}%`; node.style.height = `${(b - a) * 100}%`; node.style.left = node.style.width = ''; } else { node.style.left = `${a * 100}%`; node.style.width = `${(b - a) * 100}%`; node.style.bottom = node.style.height = ''; } };
    pos(e.mGood, ...(m.good || [0, 0])); pos(e.mGreen, ...(m.green || [0, 0])); pos(e.mFill, 0, clamp(m.fill, 0, 1));
    if (m.vertical) { e.mNeedle.style.bottom = `${clamp(m.needle ?? m.fill, 0, 1) * 100}%`; e.mNeedle.style.left = ''; }
    else { e.mNeedle.style.left = `${clamp(m.needle ?? m.fill, 0, 1) * 100}%`; e.mNeedle.style.bottom = ''; }
    this.set('mlabel', e.mLabel, m.label || '');
  }
  hideMeter() { this.el.meter.classList.add('hidden'); }

  timing(err, show = true) { // err: -1 (early) .. 1 (late)
    const t = this.el.timing;
    t.classList.toggle('hidden', !show);
    if (show) { t.querySelector('i').style.left = `${50 + clamp(err, -1, 1) * 48}%`; t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
  }

  reticle(x, y, show = true, cls = '') {
    const r = this.el.reticle;
    r.classList.toggle('hidden', !show);
    if (!show) return;
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    if (r.dataset.cls !== cls) { r.dataset.cls = cls; r.className = `mgx-reticle ${cls}`; }
  }

  tag(id, x, y, html, show = true) {
    let t = this.el.tags.querySelector(`[data-id="${id}"]`);
    if (!show) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement('div'); t.className = 'mgx-tag'; t.dataset.id = id; this.el.tags.appendChild(t); }
    if (t.dataset.h !== html) { t.dataset.h = html; t.innerHTML = html; }
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }

  update(dt, a) {
    if (this.lowerT > 0) { this.lowerT -= dt; if (this.lowerT <= 0) this.el.lower.classList.add('hidden'); }
    this.set('bug', this.el.bug, a.game.bug());
    const P = prompts(this.game);
    this.set('hints', this.el.hints, a.phase === 'play' ? (a.game.hints(P) || '') + `<span>${P.quit} Pause</span>` : '');
  }
}

// =====================================================================================
class Base {
  constructor(mg, a) {
    this.mg = mg; this.a = a; this.g = mg.game; this.z = a.zone;
    this.objs = []; this.npcs = [];
    this.cam = { eye: V(), look: V(), fov: 55, k: 5 };
    this.needRelease = true;
  }
  add(o) { this.g.scene.add(o); this.objs.push(o); return o; }
  npc(file, kit) { const n = new Npc(this.g, file, kit); this.npcs.push(n); return n; }
  dispose() { for (const o of this.objs) o.removeFromParent(); for (const n of this.npcs) n.dispose(); }
  // ignore a held button until it's let go once (so the button that started/resumed the game doesn't also swing/shoot)
  ready(c) { if (this.needRelease) { if (!c.action) this.needRelease = false; return false; } return true; }
  face(yaw) { const p = this.g.player; p.bodyYaw = p.yaw = yaw; p.pitch = 0; }
  yawTo(from, to) { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }
  playerVisual(sdt) { const p = this.g.player; p.updateVisual(sdt, this.g.cameraRig.cam.position); return p; }
  begin() {}
}

// =====================================================================================
// HOME RUN DERBY
// Batter = the player, a righty in the box on the +x side facing the plate. The pitcher throws from a mound 17 m
// out toward the plate (-z). Aim the yellow contact circle at where the ball will cross, and swing on time.
const SWING = 0.34, CONTACT = 0.12;
// body frame: +X = batter's left (toward the pitcher), +Y up, +Z forward (over the plate)
const BAT_KEYS = [
  { s: 0, G: [-0.14, 1.42, 0.1], d: [-0.3, 0.8, -0.5], tw: -0.3 },
  { s: 0.2, G: [-0.12, 1.3, 0.18], d: [-0.65, 0.3, -0.7], tw: -0.5 },
  { s: CONTACT / SWING, G: [0.04, 1.05, 0.42], d: [0.05, 0, 1], tw: 0.3 },
  { s: 0.62, G: [0.3, 1.18, 0.32], d: [0.95, 0.12, 0.05], tw: 0.75 },
  { s: 1, G: [0.24, 1.5, 0.04], d: [0.35, 0.5, -0.8], tw: 0.85 },
];
const PITCHES = {
  fastball: { name: 'FASTBALL', speed: 1, acc: [0, 2.5, 0], color: 0xffffff },
  changeup: { name: 'CHANGEUP', speed: 0.78, acc: [1.3, -2.5, 0], color: 0x9be7ff },
  curve: { name: 'CURVEBALL', speed: 0.72, acc: [-3.8, -6.5, 0], color: 0xff9be0 },
};
const PCI_R = 0.36; // how far (m) from the contact circle center you can still make contact

class HomeRun extends Base {
  setup() {
    const z = this.z, g = this.g, p = g.player;
    this.Y = z.y;
    this.home = z.home.clone();
    this.mound = (z.mound || this.home.clone().add(V(0, 0, 17))).clone();
    this.fence = z.wallDist || 62; this.fenceH = z.wallH || 3.2;
    this.zc = this.home.z + 0.3; // contact plane
    this.outs = 10; this.bonus = 0; this.hr = 0; this.n = 0; this.streak = 0; this.bestStreak = 0; this.longest = 0; this.swings = 0;
    this.batterPos = this.home.clone().add(V(0.95, 0, 0.2));
    p.setPosition(this.batterPos); p.grounded = true;
    this.face(Math.PI / 2); // facing -x, toward the plate
    this.bat = this.add(heldModel(PICKAXE));
    this.pitcher = this.npc('Ranger', 0xd8263a);
    this.pitcher.root.position.copy(this.mound).setY(this.Y + 0.25);
    this.pitcher.root.rotation.y = Math.PI; // face home (-z)
    // the ball, a little big so it's easy to see
    this.ball = this.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x555555, roughness: 0.4 })));
    this.ball.castShadow = true;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(0.9); this.ball.add(this.glow); this.glow.visible = false;
    // strike zone + contact circle (PCI)
    const zone = new THREE.BufferGeometry().setFromPoints([V(-0.22, 0.5, 0), V(0.22, 0.5, 0), V(0.22, 1.15, 0), V(-0.22, 1.15, 0), V(-0.22, 0.5, 0)]);
    this.zoneBox = this.add(new THREE.Line(zone, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false })));
    this.zoneBox.position.set(this.home.x, this.Y, this.zc); this.zoneBox.renderOrder = 5;
    this.pciMesh = this.add(new THREE.Group());
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false });
    this.pciRing = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 32), ringMat);
    this.pciDot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), ringMat);
    this.pciOuter = new THREE.Mesh(new THREE.RingGeometry(PCI_R - 0.012, PCI_R, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false }));
    for (const m of [this.pciRing, this.pciDot, this.pciOuter]) { m.renderOrder = 6; this.pciMesh.add(m); }
    this.pci = { u: 0, v: 0.85 };
    // landing marker
    this.landMark = this.add(new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 28), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, side: THREE.DoubleSide })));
    this.landMark.rotation.x = -Math.PI / 2; this.landMark.visible = false;
    this.state = 'idle'; this.stT = 0;
    this.swingT = -1; this.recoverT = 0; this.pT = 0;
    this.ballPos = V(); this.ballVel = V(); this.ball.visible = false;
  }

  intro(P) {
    return {
      sub: 'Smash pitches over the wall!',
      go: 'PLAY BALL!',
      steps: [
        [P.aim, 'Move the <b>yellow circle</b> to where the ball will cross the plate'],
        [P.act, '<b>Swing!</b> Time it as the ball reaches you'],
        ['⚾', 'Fastballs, changeups and curveballs. Watch the ball move!'],
        ['❌', '<b>10 outs.</b> Any swing that isn’t a homer is an out'],
        ['🚀', 'A 420 ft <b>MOONSHOT</b> gives you an extra out'],
      ],
      goal: `Hit ${HR_GOAL} home runs to win`,
    };
  }

  begin() { this.state = 'wait'; this.stT = 1.0; this.mg.ui.lower('BATTER UP!', `${this.outs} outs · ${HR_GOAL} homers to win`); }

  pickPitch() {
    const n = this.n;
    const r = Math.random();
    let type = 'fastball';
    if (n >= 3) type = r < 0.35 ? 'changeup' : 'fastball';
    if (n >= 6) type = r < 0.4 ? 'fastball' : r < 0.7 ? 'changeup' : 'curve';
    if (n >= 11) type = r < 0.34 ? 'fastball' : r < 0.6 ? 'changeup' : 'curve';
    const spreadU = Math.min(0.2, 0.04 + n * 0.014), spreadV = Math.min(0.25, 0.05 + n * 0.016);
    const fb = 26 + Math.min(n, 16) * 0.5;
    return { type, def: PITCHES[type], speed: fb * PITCHES[type].speed, tu: rand(-spreadU, spreadU), tv: 0.85 + rand(-spreadV, spreadV) };
  }

  release() {
    const pt = this.pitch, def = pt.def;
    const start = this.ballPos;
    const target = V(this.home.x + pt.tu, this.Y + pt.tv, this.zc);
    const T = start.distanceTo(target) / pt.speed;
    pt.a = V(def.acc[0], def.acc[1] - G, def.acc[2]);
    pt.p0 = start.clone();
    pt.v0 = target.clone().sub(start).addScaledVector(pt.a, -0.5 * T * T).divideScalar(T);
    pt.T = T; pt.t = 0;
    pt.cross = target;
    this.ball.visible = true;
    this.state = 'pitch';
    this.mg.ui.lower(`${def.name} · ${Math.round(pt.speed * MPH)} MPH`, `Pitch ${this.n}`, 1.6);
    audio.gun('throw', start);
  }

  pitchPos(t, out) { const pt = this.pitch; return out.copy(pt.p0).addScaledVector(pt.v0, t).addScaledVector(pt.a, 0.5 * t * t); }

  update(sdt, c) {
    const g = this.g;
    // move the contact circle: mouse points right at it, sticks/keys glide it
    if (this.state !== 'hit' && this.state !== 'after') {
      if (c.mouse) {
        const hit = this.mg.mouseOnPlane(c.mouse, _v.set(0, 0, -1), _v2.set(0, 0, this.zc));
        if (hit) { this.pci.u = hit.x - this.home.x; this.pci.v = hit.y - this.Y; }
      }
      const sp = 1.5 * sdt;
      this.pci.u -= (c.stick.x) * sp; // screen right = world -x from behind the plate
      this.pci.v += (c.stick.y) * sp;
      this.pci.u = clamp(this.pci.u, -0.5, 0.5); this.pci.v = clamp(this.pci.v, 0.3, 1.5);
    }
    // swing
    if (this.ready(c) && c.actionPressed && this.swingT < 0 && this.recoverT <= 0 && ['wait', 'windup', 'pitch'].includes(this.state)) {
      this.swingT = 0; this.swingPci = { ...this.pci };
      if (this.state === 'pitch') this.swung = true;
      audio.gun('bat', null, true);
    }
    if (this.swingT >= 0) {
      const before = this.swingT;
      this.swingT += sdt;
      if (before < CONTACT && this.swingT >= CONTACT) this.resolveSwing();
      if (this.swingT >= SWING) { this.swingT = -1; this.recoverT = 0.45; }
    } else if (this.recoverT > 0) this.recoverT -= sdt;

    if (this.state === 'wait') {
      this.stT -= sdt;
      if (this.stT <= 0) { this.state = 'windup'; this.wT = 0; this.n++; this.pitch = this.pickPitch(); this.swung = false; this.whiffed = false; }
      if (this.pT > 2.2) this.pT = 0;
    } else if (this.state === 'windup') {
      this.wT += sdt;
      if (this.wT >= 1.05) this.release();
    } else if (this.state === 'pitch') {
      const pt = this.pitch;
      pt.t += sdt;
      this.pitchPos(pt.t, this.ballPos);
      g.effects.burst(this.ballPos, { count: 1, color: pt.def.color, speed: 0, size: 0.09, life: 0.18, grav: 0, glow: true });
      if (this.ballPos.z < this.home.z - 1.2) {
        // into the catcher's glove
        sfx.glove();
        this.ball.visible = false;
        if (this.whiffed || this.swung) { this.mg.ui.timing(1); this.out(this.whiffed ? 'STRIKE!' : 'Too late!', 'bad'); }
        else if (!this.swung) {
          const inZone = Math.abs(pt.cross.x - this.home.x) < 0.25 && pt.cross.y - this.Y > 0.45 && pt.cross.y - this.Y < 1.2;
          this.mg.call(inZone ? 'Taken' : 'Ball', '', 0.9);
          this.next(0.6);
        }
      }
    } else if (this.state === 'hit') this.fly(sdt);
    else if (this.state === 'after') {
      this.stT -= sdt;
      if (this.stT <= 0) {
        this.landMark.visible = false; this.mg.ui.tag('dist', 0, 0, '', false);
        if (this.outs <= 0) return this.finishDerby();
        this.next(0.4); this.mg.cut = true;
      }
    }
    if (this.state === 'windup') this.pT = this.wT; else if (this.pT > 0) this.pT += sdt;
    // ball follows the pitcher's hand until it's thrown
    if (this.state === 'windup' || this.state === 'wait') {
      const w = this.pitcher.bones.WristR;
      if (w) { w.getWorldPosition(this.ballPos); this.ballPos.y -= 0.02; }
      this.ball.visible = this.state === 'windup';
    }
    this.ball.position.copy(this.ballPos);
    this.ball.rotation.x += sdt * 30;
    // a glowing comet once it's hit, so you can follow it into the sky
    this.glow.visible = this.state === 'hit' || (this.state === 'after' && this.landed);
    if (this.glow.visible) { this.glow.material.color.set(this.streak >= 3 ? 0xff9a3a : this.homer ? 0xffd34d : 0xffffff); this.glow.scale.setScalar(1.6 + Math.min(4, this.ballPos.distanceTo(this.home) * 0.04)); }
  }

  next(delay) { this.state = 'wait'; this.stT = delay; }

  resolveSwing() {
    this.swings++;
    const pt = this.pitch;
    if (this.state === 'wait' || this.state === 'windup') { this.mg.call('Too early!', 'bad', 0.9); sfx.whiff(); return; }
    if (this.state !== 'pitch' || !pt) return; // already past the plate: counted at the glove
    this.swung = true;
    const e = pt.t - pt.T; // + late, - early (seconds)
    const pci = this.swingPci;
    const bu = pt.cross.x - this.home.x, bv = pt.cross.y - this.Y;
    const du = bu - pci.u, dv = bv - pci.v, d = Math.hypot(du, dv);
    const fire = this.streak >= 3;
    const win = 0.11, reach = PCI_R * (fire ? 1.2 : 1);
    this.mg.ui.timing(e / win);
    if (Math.abs(e) > win || d > reach) {
      this.whiffed = true; sfx.whiff();
      this.mg.call(Math.abs(e) > win ? (e < 0 ? 'Way early!' : 'Too late!') : 'Swing and a miss!', 'bad', 1.0);
      return;
    }
    // contact!
    const qt = 1 - Math.abs(e) / win, qd = 1 - d / reach;
    const q = Math.pow(qt, 0.7) * Math.pow(qd, 0.5);
    const perfect = Math.abs(e) < 0.022 && d < 0.1;
    const ev = 18 + 24 * q + (perfect ? 3 : 0) + (fire ? 2.5 : 0) + rand(-1, 1);
    const la = (24 + (dv / reach) * 60 + rand(-3, 3)) * Math.PI / 180;
    const spray = (-e / win * 42 + du * 25 + rand(-4, 4)) * Math.PI / 180;
    this.pitchPos(pt.t, this.ballPos);
    this.ballVel.set(Math.sin(spray) * Math.cos(la), Math.sin(la), Math.cos(spray) * Math.cos(la)).multiplyScalar(ev);
    this.state = 'hit'; this.flyT = 0; this.homer = false; this.landed = false; this.wall = false; this.q = q; this.perfect = perfect;
    this.mg.hitstop(perfect ? 0.11 : 0.06);
    this.mg.shake(0.3 + q * 0.9);
    sfx.crack(0.5 + q * 0.7);
    this.g.effects.burst(this.ballPos, { count: 14 + Math.round(q * 20), color: 0xffffff, speed: 5 + q * 6, size: 0.12, life: 0.4, grav: 2, glow: true });
    if (perfect) { this.mg.call('PERFECT!', 'gold', 1.2); this.mg.ui.flash(); }
    else if (q > 0.65) this.mg.call('CRUSHED!', 'gold', 1.1);
    this.mg.cheer(0.3 + q * 0.6);
    this.mg.cut = false;
  }

  fly(sdt) {
    const b = this.ballPos, v = this.ballVel, g = this.g;
    this.flyT += sdt;
    const steps = 3, h = sdt / steps;
    for (let s = 0; s < steps; s++) {
      const prevR = Math.hypot(b.x - this.home.x, b.z - this.home.z);
      const speed = v.length();
      v.y -= G * h;
      v.addScaledVector(v, -0.004 * speed * h);
      b.addScaledVector(v, h);
      const r = Math.hypot(b.x - this.home.x, b.z - this.home.z);
      const ang = Math.atan2(b.x - this.home.x, b.z - this.home.z);
      const fair = Math.abs(ang) <= Math.PI / 4 + 0.01;
      // the outfield wall
      if (!this.homer && !this.wall && prevR < this.fence && r >= this.fence && fair) {
        if (b.y > this.Y + this.fenceH + 0.08) this.homeRun(b);
        else {
          this.wall = true;
          const n = _v.set(b.x - this.home.x, 0, b.z - this.home.z).normalize();
          const vn = v.dot(n);
          if (vn > 0) v.addScaledVector(n, -1.45 * vn);
          b.addScaledVector(n, -(r - this.fence + 0.1));
          audio.play('hitWood', { pos: b.clone(), vol: 0.8 }); this.mg.call('OFF THE WALL!', '', 1.1); this.mg.cheer(0.5);
        }
      }
      const gy = (r < this.fence ? this.Y : g.world.groundY(b.x, b.z)) + 0.075;
      if (b.y < gy) {
        b.y = gy;
        if (!this.landed) this.land(b, fair, r);
        if (v.y < -1.5) { v.y *= -0.35; v.x *= 0.6; v.z *= 0.6; audio.play('hitBody', { pos: b.clone(), vol: 0.3, rate: 1.6 }); }
        else { v.y = 0; v.x *= 0.96; v.z *= 0.96; }
      }
    }
    if (!this.landed) g.effects.burst(b, { count: 2, color: this.streak >= 3 ? 0xff7a1f : this.homer ? 0xffd34d : 0xffffff, speed: 0.3, size: this.streak >= 3 ? 0.55 : 0.35, life: 0.7, grav: 0, glow: true });
    if (this.flyT > 9 && !this.landed) this.land(b, true, Math.hypot(b.x - this.home.x, b.z - this.home.z));
  }

  homeRun(at) {
    this.homer = true;
    this.hr++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
    const g = this.g;
    this.mg.slow(0.3, 0.9);
    this.mg.call(this.streak >= 3 ? 'HOME RUN! 🔥' : 'HOME RUN!', 'gold', 1.8);
    this.mg.cheer(1.3);
    sfx.charge();
    audio.jingle('level', 0.5);
    g.input.rumble(0.8, 0.8, 300);
    const colors = [0xff3d7f, 0x3aa0ff, 0xffd34d, 0x58d63b, 0xb45cff];
    for (let i = 0; i < 5; i++) {
      const p = at.clone().add(V(rand(-14, 14), rand(10, 20), rand(0, 6)));
      setTimeout(() => { if (this.mg.active === this.a) { g.effects.burst(p, { count: 50, color: colors[i], speed: 9, size: 0.3, life: 1.3, grav: 3, glow: true }); audio.play('explode', { pos: p, vol: 0.25 }); } }, 150 + i * 220);
    }
    if (this.streak === 3) setTimeout(() => this.mg.active === this.a && this.mg.ui.lower('🔥 ON FIRE!', 'Bigger contact circle + harder hits!', 2.4), 900);
  }

  land(b, fair, r) {
    this.landed = true;
    const ft = Math.round(r * FT);
    this.landAt = b.clone(); this.landFt = ft;
    this.landMark.position.set(b.x, b.y + 0.04, b.z); this.landMark.visible = true;
    if (this.homer) {
      this.longest = Math.max(this.longest, ft);
      if (ft >= 420 && this.bonus < 3) { this.outs++; this.bonus++; this.mg.ui.lower(`🚀 MOONSHOT! ${ft} FT`, 'BONUS: +1 out!', 2.6); this.mg.cheer(1.5); }
      this.after(2.2);
    } else if (!fair) { this.out('FOUL BALL', 'bad'); }
    else {
      this.longest = Math.max(this.longest, ft);
      this.out(r > this.fence - 7 ? 'Warning track!' : r > 35 ? 'Caught in the outfield' : r > 12 ? 'Base hit, but it’s an out' : 'Grounder', '');
    }
  }

  out(text, cls) {
    this.outs = Math.max(0, this.outs - 1);
    this.streak = 0;
    this.mg.call(text, cls, 1.2);
    if (this.homer === false && this.state === 'hit') this.mg.crowd.aww();
    this.after(this.state === 'hit' ? 1.8 : 1.0);
  }

  after(t) { this.state = 'after'; this.stT = t; }

  finishDerby() {
    const win = this.hr >= HR_GOAL;
    this.state = 'done';
    this.mg.endGame({
      win, score: this.hr,
      title: this.hr > 0 ? 'NICE HITTING!' : 'NICE TRY!',
      sub: win ? `${this.hr} home runs! The crowd goes wild!` : `You needed ${HR_GOAL} home runs.`,
      stats: [['Home runs', this.hr], ['Longest hit', `${this.longest} ft`], ['Best streak', this.bestStreak], ['Pitches', this.n]],
      coins: this.hr * 20 + Math.floor(this.longest / 40),
    });
  }

  bug() {
    const outs = Array.from({ length: Math.max(10, this.outs) }, (_, i) => `<i class="mgx-dot ${i < this.outs ? 'on' : 'off'}"></i>`).join('');
    return `<div class="mgx-row"><div><div class="mgx-big">${this.hr}<small> / ${HR_GOAL} HR</small></div><div class="mgx-sub">Longest: ${this.longest} ft${this.streak >= 2 ? ` · 🔥 ${this.streak} in a row` : ''}</div></div></div>
      <div class="mgx-sub">OUTS LEFT</div><div class="mgx-dots">${outs}</div>`;
  }

  hints(P) { return `<span>${P.aim} Aim</span><span>${P.act} Swing</span>`; }

  animate(sdt) {
    const p = this.g.player, pt = this.pitcher;
    // ---- pitcher windup ----
    const w = this.pT || 0;
    const k1 = ease(w / 0.45), k2 = ease((w - 0.45) / 0.45), k3 = ease((w - 0.85) / 0.2), k4 = ease((w - 1.05) / 0.4), rest = ease((w - 1.6) / 0.5);
    const act = (w > 0 && w < 2.1) ? 1 - rest : 0;
    pt.root.position.copy(this.mound).setY(this.Y + 0.25).add(V(0, 0, -0.45 * k2 * act));
    const P = pt.update(sdt);
    if (act > 0) {
      P.w = act;
      P.rot('Abdomen', -0.25 * k1 + 0.55 * k3 + 0.2 * k4, 0.6 * k1 - 0.9 * k3, 0);
      P.leg(1, [0.05, -0.15 + 0.15 * k2, 1 - 0.8 * k2], [0, -1, 0.15], (k1 - k2 * 0.8) * act);
      const R = [-0.05, 1.2, 0.3], back = [-0.55, 1.75, -0.4], top = [-0.25, 1.9, 0.45], fol = [0.25, 0.9, 0.55];
      let r = R.map((v, i) => lerp(v, back[i], k2));
      r = r.map((v, i) => lerp(v, top[i], k3));
      r = r.map((v, i) => lerp(v, fol[i], k4));
      const L0 = [0.05, 1.2, 0.3], Lp = [0.4, 1.4, 0.6], Lf = [0.2, 1.1, 0.2];
      let l = L0.map((v, i) => lerp(v, Lp[i], k2)); l = l.map((v, i) => lerp(v, Lf[i], k4));
      P.reach(-1, P.point(r), [-0.6, -1, -0.3], act);
      P.reach(1, P.point(l), [0.6, -1, -0.2], act);
    } else { P.w = 1; P.reach(-1, P.point([-0.05, 1.15, 0.28])); P.reach(1, P.point([0.06, 1.15, 0.28])); }
    P.w = 1;
    // ---- batter ----
    this.face(Math.PI / 2);
    this.playerVisual(sdt);
    const Q = p.poser.begin();
    let s = 0, waggle = 0;
    if (this.swingT >= 0) s = this.swingT / SWING;
    else if (this.recoverT > 0) s = 1 + (1 - this.recoverT / 0.45); // 1..2 = back to stance
    else waggle = Math.sin(this.g.time * 3) * 0.05;
    let Gp, d, tw;
    if (s <= 1) {
      const keys = BAT_KEYS.map((k) => k);
      // swing at the height of the contact circle
      const pv = this.swingT >= 0 && this.swingPci ? this.swingPci.v : this.pci.v;
      keys[2] = { ...BAT_KEYS[2], G: [0.04, clamp(pv + 0.08, 0.55, 1.45), 0.42], d: [0.05, clamp((pv - 1.0) * 0.6, -0.4, 0.3), 1] };
      Gp = keyAt(keys, s, 'G'); d = keyAt(keys, s, 'd'); tw = keyAt(keys, s, 'tw');
    } else {
      const f = ease(s - 1), a = BAT_KEYS[4], b = BAT_KEYS[0];
      Gp = a.G.map((v, i) => lerp(v, b.G[i], f)); d = a.d.map((v, i) => lerp(v, b.d[i], f)); tw = lerp(a.tw, b.tw, f);
    }
    d[0] += waggle;
    Q.rot('Abdomen', 0.12, tw, 0);
    Q.rot('Neck', 0, 0.45 - tw * 0.3, 0); Q.rot('Head', 0, 0.55 - tw * 0.3, 0);
    const grip = Q.point(Gp, V());
    const dir = Q.dir(d, V()).normalize();
    const up = V(0, 1, 0).addScaledVector(dir, -dir.y);
    if (up.lengthSq() < 1e-4) up.set(1, 0, 0);
    _m4.lookAt(_zero, dir, up.normalize());
    this.bat.position.copy(grip);
    this.bat.quaternion.setFromRotationMatrix(_m4);
    Q.reach(1, grip.clone().addScaledVector(dir, -0.06), [0.6, -1, -0.3]); Q.wrist(1, 0.6);
    Q.reach(-1, grip.clone().addScaledVector(dir, 0.05), [-0.5, -1, -0.5]); Q.wrist(-1, 0.6);
    // contact circle + strike zone only while a pitch is coming
    const showAim = ['wait', 'windup', 'pitch'].includes(this.state) && this.a.phase === 'play';
    this.pciMesh.visible = this.zoneBox.visible = showAim;
    this.pciMesh.position.set(this.home.x + this.pci.u, this.Y + this.pci.v, this.zc);
    const fire = this.streak >= 3;
    this.pciOuter.scale.setScalar(fire ? 1.2 : 1);
    let over = false;
    if (this.state === 'pitch' && this.pitch) over = Math.hypot(this.pitch.cross.x - this.home.x - this.pci.u, this.pitch.cross.y - this.Y - this.pci.v) < 0.18;
    this.pciRing.material.color.set(fire ? 0xff7a1f : over ? 0x7dff5a : 0xffd34d);
    // distance tag on the landing spot
    if (this.landMark.visible && this.landAt) {
      const sc = this.mg.toScreen(_v.copy(this.landAt).add(V(0, 1.5, 0)));
      this.mg.ui.tag('dist', sc.x, sc.y, `${this.landFt} FT`, sc.ok);
      this.landMark.scale.setScalar(1 + Math.sin(this.g.time * 6) * 0.08);
    }
  }

  camera(dt, phase) {
    const c = this.cam, h = this.home;
    if (phase === 'intro') {
      const t = this.a.t;
      c.eye.set(h.x + Math.sin(t * 0.3) * 12, this.Y + 13 - t * 0.5, h.z - 15 + t * 0.8);
      c.look.set(h.x, this.Y, h.z + 32); c.fov = 55; c.k = 2;
      return;
    }
    if (this.state === 'hit' || (this.state === 'after' && this.landed)) {
      // ball cam: rise up behind the plate and follow the ball
      // chase cam: ride behind the ball as it flies (holds still once it lands)
      const b = this.state === 'hit' ? this.ballPos : this.landAt || this.ballPos;
      const flat = _v.set(b.x - h.x, 0, b.z - h.z);
      const r = flat.length(); flat.divideScalar(Math.max(r, 0.01));
      if (this.state === 'hit') {
        c.eye.copy(b).addScaledVector(flat, -Math.min(14, 4 + r * 0.4)).setY(Math.max(this.Y + 3, b.y + 2.5));
        c.look.copy(b).addScaledVector(flat, 3);
      }
      c.fov = this.homer ? 46 : 55; c.k = this.flyT < 0.4 ? 3 : 5; c.kl = 9;
      c.shadow = b;
      return;
    }
    c.shadow = null;
    // catcher cam: low behind the plate, pitcher in the middle, batter on the left
    c.eye.set(h.x - 0.35, this.Y + 1.95, h.z - 3.9);
    c.look.set(h.x + 0.1, this.Y + 1.2, h.z + 8);
    c.fov = 44; c.k = 6; c.kl = 6;
  }
}

// =====================================================================================
// HOOPS: 3-point shootout. 5 racks of 5 around the arc, last ball of each rack is a 2-point money ball.
// Hold to rise into the jump shot, release in the green for a perfect release.
const BR = 0.12, TUBE = 0.018;
class Hoops extends Base {
  setup() {
    const z = this.z, g = this.g, p = g.player;
    this.Y = z.y;
    this.hoop = z.hoops[1];
    this.rim = this.hoop.rim; this.sx = this.hoop.sx; this.R = this.hoop.rimR || 0.23;
    this.spots = HOOP_SPOTS.map((deg) => { const r = (deg * Math.PI) / 180, d = (z.arc || 7) + 0.4; return V(this.rim.x - this.sx * Math.cos(r) * d, this.Y, this.rim.z + Math.sin(r) * d); });
    this.names = ['LEFT CORNER', 'LEFT WING', 'TOP OF THE KEY', 'RIGHT WING', 'RIGHT CORNER'];
    // racks of balls next to each spot
    const ballGeo = new THREE.SphereGeometry(BR, 18, 14);
    this.racks = this.spots.map((s, ri) => {
      const toRim = V(this.rim.x - s.x, 0, this.rim.z - s.z).normalize();
      const side = V(-toRim.z, 0, toRim.x);
      const base = s.clone().addScaledVector(side, -1.0).addScaledVector(toRim, -0.4);
      const stand = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 1.4), new THREE.MeshStandardMaterial({ color: 0x333a44, metalness: 0.5, roughness: 0.5 })));
      stand.position.copy(base).add(V(0, 0.35, 0)); stand.rotation.y = Math.atan2(toRim.x, toRim.z);
      const balls = [];
      for (let i = 0; i < 5; i++) {
        const money = i === 4 || ri === 4;
        const m = this.add(new THREE.Mesh(ballGeo, money ? this.moneyMat() : this.ballMat()));
        m.position.copy(base).addScaledVector(toRim, (i - 2) * 0.27).add(V(0, 0.82, 0)); m.castShadow = true;
        balls.push({ mesh: m, money, result: null });
      }
      return balls;
    });
    this.spot = 0; this.ballIdx = 0;
    this.time = 60; this.score = 0; this.made = 0; this.shots = 0; this.streak = 0; this.bestStreak = 0; this.greens = 0; this.swishes = 0;
    this.flying = [];
    this.state = 'idle'; this.stT = 0; this.meter = 0; this.lastGrade = null; this.netAmp = 0;
    p.setPosition(this.spots[0]); p.grounded = true;
    this.face(this.yawTo(this.spots[0], this.rim));
    this.held = null;
    this.jump = 0;
  }

  ballMat() {
    if (!this._bm) { const m = projectileModel('basketball'); this._bm = m.material; }
    return this._bm;
  }
  moneyMat() {
    if (!this._mm) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d');
      ['#e8263a', '#ffffff', '#2f6bff', '#ffffff', '#e8263a', '#ffffff', '#2f6bff', '#ffffff'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 32, 0, 32, 128); });
      x.strokeStyle = '#111'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, 64); x.lineTo(256, 64); x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this._mm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
    }
    return this._mm;
  }

  intro(P) {
    return {
      sub: 'Shoot from 5 racks around the 3-point line before time runs out!',
      steps: [
        [P.act, '<b>HOLD</b> to jump, <b>LET GO</b> when the meter is in the <b style="color:#7dff5a">GREEN</b>'],
        ['🟢', 'Green = perfect swish. Close = it might rattle in (or out!)'],
        ['💰', '<b>Money balls</b> (red, white & blue) are worth 2. The last rack is ALL money balls'],
        ['🔥', '3 in a row = <b>ON FIRE</b>: bigger green + bonus points'],
        ['⏱️', '60 seconds. A shot in the air at the buzzer still counts!'],
      ],
      goal: `Score ${HOOPS_GOAL} points to win`,
    };
  }

  begin() { this.state = 'pickup'; this.stT = 0.3; this.lowerSpot(); }
  lowerSpot() { this.mg.ui.lower(`RACK ${this.spot + 1} · ${this.names[this.spot]}`, this.spot === 4 ? '💰 MONEY RACK: every ball is worth 2!' : 'Last ball is the 💰 money ball', 2.0); }

  get onFire() { return this.streak >= 3; }
  greenWidth(money) { return Math.max(0.05, 0.11 - this.spot * 0.009 - (money ? 0.012 : 0) + (this.onFire ? 0.03 : 0)); }
  fillTime() { return 0.6 - this.spot * 0.03; }

  update(sdt, c) {
    const g = this.g, p = g.player;
    const clock = this.time > 0;
    if (clock) {
      const before = Math.ceil(this.time);
      this.time = Math.max(0, this.time - sdt);
      if (Math.ceil(this.time) !== before && this.time <= 5 && this.time > 0) sfx.beep();
      if (this.time <= 0) { sfx.buzzer(); this.mg.call('BUZZER!', 'bad', 1.2); if (this.held) { this.held.mesh.visible = false; this.held = null; } this.state = 'over'; }
    }
    const spotPos = this.spots[this.spot];
    if (this.state === 'pickup') {
      this.stT -= sdt;
      if (this.stT <= 0) {
        const b = this.racks[this.spot][this.ballIdx];
        this.held = b; this.state = 'ready'; this.meter = 0;
        audio.play('pickupItem', { vol: 0.4 });
      }
    } else if (this.state === 'ready') {
      if (this.ready(c) && c.actionPressed) { this.state = 'rise'; this.meter = 0; this.riseT = 0; this.green = this.greenWidth(this.held.money); }
    } else if (this.state === 'rise') {
      this.riseT += sdt;
      this.meter = this.riseT / this.fillTime();
      if (c.actionReleased || this.meter >= 1.15) this.shoot();
    } else if (this.state === 'land') {
      this.stT -= sdt;
      if (this.stT <= 0) {
        this.ballIdx++;
        if (this.ballIdx >= 5) {
          if (this.spot >= 4) { this.state = 'over'; }
          else { this.state = 'move'; this.moveT = 0; this.from = spotPos.clone(); this.spot++; this.ballIdx = 0; this.lowerSpot(); }
        } else { this.state = 'pickup'; this.stT = 0.18; }
      }
    } else if (this.state === 'move') {
      this.moveT += sdt;
      const f = ease(this.moveT / 0.85), to = this.spots[this.spot];
      const pos = this.from.clone().lerp(to, f);
      p.vel.copy(to).sub(this.from).divideScalar(0.85).multiplyScalar(this.moveT < 0.85 ? 1 : 0);
      p.setPosition(pos);
      if (this.moveT >= 0.85) { p.vel.set(0, 0, 0); this.state = 'pickup'; this.stT = 0.1; }
    }
    // jump height follows the shot
    const target = this.state === 'rise' ? 0.45 * Math.sin(Math.min(1, this.riseT / 0.5) * Math.PI / 2) : 0;
    this.jump = this.state === 'rise' ? target : Math.max(0, this.jump - sdt * 2.6);
    if (this.state !== 'move') {
      p.setPosition(_v.copy(this.spots[this.spot]).setY(this.Y + this.jump));
      this.face(this.yawTo(this.spots[this.spot], this.rim));
    } else this.face(this.yawTo(p.pos, this.spots[this.spot]));
    p.grounded = this.jump < 0.01;

    this.updateBalls(sdt);
    if (this.state === 'over' && !this.flying.length) this.finishShootout();
  }

  shoot() {
    const g = this.g, b = this.held;
    const e = this.meter - 0.86;
    const hw = this.green / 2;
    const over = Math.abs(e) - hw;
    const grade = over <= 0 ? 'green' : over < 0.09 ? 'good' : 'bad';
    this.lastGrade = { grade, e, meter: this.meter, t: 0.8, green: this.green };
    this.held = null;
    this.state = 'land'; this.stT = 0.35;
    // where the ball is aimed: long/short by how early/late, a little sideways when it isn't perfect
    const from = b.mesh.position.clone();
    const toRim = V(this.rim.x - from.x, 0, this.rim.z - from.z);
    const dist = toRim.length(); toRim.normalize();
    const side = V(-toRim.z, 0, toRim.x);
    let along = rand(-0.015, 0.015), lat = rand(-0.012, 0.012);
    if (grade !== 'green') { along = Math.sign(e) * (over * 3.0 + 0.07); lat = rand(-1, 1) * (over * 1.4 + 0.02); }
    const target = this.rim.clone().addScaledVector(toRim, along).addScaledVector(side, lat);
    const th = (52 + (grade === 'bad' ? rand(-4, 4) : 0)) * Math.PI / 180;
    const d = Math.hypot(target.x - from.x, target.z - from.z), hgt = target.y - from.y;
    const v = Math.sqrt((G * d * d) / (2 * Math.cos(th) ** 2 * Math.max(0.1, d * Math.tan(th) - hgt)));
    const dir = V(target.x - from.x, 0, target.z - from.z).normalize();
    const vel = dir.multiplyScalar(v * Math.cos(th)); vel.y = v * Math.sin(th);
    this.flying.push({ rack: b, mesh: b.mesh, money: b.money, pos: from, vel, age: 0, rimHits: 0, board: false, scored: false, done: false, grade, slowed: false, fire: this.onFire, spinAxis: V(-toRim.z, 0, toRim.x) });
    this.shots++;
    audio.gun('throw', null, true);
    if (grade === 'green') { this.greens++; sfx.tone(1568, 0.18, { type: 'triangle', vol: 0.08 }); sfx.tone(2093, 0.25, { type: 'triangle', vol: 0.06, delay: 0.07 }); g.input.rumble(0.2, 0.4, 60); }
    void dist;
  }

  updateBalls(sdt) {
    const g = this.g, rim = this.rim, R = this.R, bd = this.hoop.board, sx = this.sx;
    for (const b of this.flying) {
      if (b.done) continue;
      b.age += sdt;
      const steps = 4, h = sdt / steps;
      for (let s = 0; s < steps; s++) {
        const prevY = b.pos.y;
        b.vel.y -= G * h;
        b.pos.addScaledVector(b.vel, h);
        // rim (a torus): push the ball off the closest point of the ring
        const dx = b.pos.x - rim.x, dz = b.pos.z - rim.z, rh = Math.hypot(dx, dz) || 1e-4;
        const cx = rim.x + (dx / rh) * R, cz = rim.z + (dz / rh) * R;
        const n = _v.set(b.pos.x - cx, b.pos.y - rim.y, b.pos.z - cz), nd = n.length();
        if (nd < BR + TUBE) {
          n.divideScalar(nd || 1);
          b.pos.set(cx, rim.y, cz).addScaledVector(n, BR + TUBE + 0.001);
          const vn = b.vel.dot(n);
          if (vn < 0) {
            b.vel.addScaledVector(n, -vn * 1.55);
            b.vel.multiplyScalar(0.9);
            if (-vn > 0.8) { b.rimHits++; audio.play('hitMetal', { pos: b.pos.clone(), vol: Math.min(0.7, -vn * 0.12), rate: 1.3 }); this.netAmp = Math.max(this.netAmp, 0.3); g.input.rumble(0.15, 0.3, 40); }
          }
        }
        // backboard (front face plane)
        if (Math.abs(b.pos.z - rim.z) < bd.hz + BR * 0.5 && b.pos.y > bd.y0 - BR && b.pos.y < bd.y1 + BR && sx * (b.pos.x + sx * BR - bd.x) > 0 && sx * (b.pos.x - bd.x) < 0.12) {
          b.pos.x = bd.x - sx * BR;
          if (sx * b.vel.x > 0) { b.vel.x *= -0.55; b.board = true; audio.play('hitWood', { pos: b.pos.clone(), vol: 0.5, rate: 1.4 }); }
        }
        // through the hoop!
        const rh2 = Math.hypot(b.pos.x - rim.x, b.pos.z - rim.z);
        if (!b.scored && prevY >= rim.y && b.pos.y < rim.y && rh2 < R - 0.02 && b.vel.y < 0) this.scored(b);
        // the net slows a made shot down
        if (b.scored && b.pos.y > rim.y - 0.45 && b.pos.y < rim.y && rh2 < R + 0.02) { b.vel.x *= 1 - 7 * h; b.vel.z *= 1 - 7 * h; b.vel.y = Math.max(b.vel.y, -3.2); }
        // floor
        if (b.pos.y < this.Y + BR) {
          b.pos.y = this.Y + BR;
          if (!b.scored && !b.missed) this.missed(b);
          if (b.vel.y < -1) { audio.play('hitBody', { pos: b.pos.clone(), vol: Math.min(0.5, -b.vel.y * 0.08), rate: 1.7 }); b.vel.y *= -0.62; }
          else b.vel.y = 0;
          b.vel.x *= 0.92; b.vel.z *= 0.92;
        }
      }
      // slow-mo as a perfect shot drops in
      if (b.grade === 'green' && !b.slowed && b.vel.y < 0 && b.pos.distanceTo(rim) < 1.3) { b.slowed = true; this.mg.slow(0.4, 0.4); }
      b.mesh.position.copy(b.pos);
      b.mesh.rotateOnWorldAxis(b.spinAxis, -sdt * 14);
      if (b.fire) g.effects.burst(b.pos, { count: 1, color: 0xff7a1f, end: 0xff2a00, speed: 0.3, size: 0.25, life: 0.35, grav: -2, glow: true });
      if (!b.scored && !b.missed && b.age > 3.2) this.missed(b);
      if (b.age > 4.5) { b.done = true; b.mesh.visible = false; }
    }
    this.flying = this.flying.filter((b) => !b.done);
  }

  scored(b) {
    b.scored = true;
    const g = this.g;
    let pts = b.money ? 2 : 1;
    if (b.fire) pts += 1;
    this.score += pts; this.made++;
    this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
    b.rack.result = true;
    const swish = !b.rimHits && !b.board;
    if (swish) this.swishes++;
    const word = swish ? (b.money ? 'MONEY! 💰' : 'SWISH!') : b.board ? 'OFF THE GLASS!' : b.rimHits > 1 ? 'RATTLED IN!' : 'BUCKET!';
    const buzzer = this.time <= 0;
    this.mg.call(buzzer ? 'BUZZER BEATER!' : `${word} +${pts}`, swish ? 'gold' : 'green', 1.2);
    if (swish) sfx.swish(); else audio.play('hitBody', { vol: 0.3, rate: 1.4 });
    this.netAmp = 1;
    this.mg.cheer(swish ? 0.8 + (b.money ? 0.4 : 0) : 0.5);
    this.mg.shake(0.15);
    g.effects.burst(this.rim.clone().add(V(0, -0.3, 0)), { count: swish ? 26 : 12, colors: b.money ? [0xe8263a, 0xffffff, 0x2f6bff] : [0xffd34d, 0xffffff], speed: 4, size: 0.12, life: 0.7, grav: 5, glow: true });
    if (b.money || buzzer) g.effects.confetti(this.rim.clone().add(V(0, 1, 0)), 40);
    if (this.streak === 3) this.mg.ui.lower('🔥 ON FIRE!', 'Bigger green window + every make is worth +1', 2.4);
  }

  missed(b) {
    b.missed = true; b.rack.result = false;
    this.streak = 0;
    this.mg.call(!b.rimHits && !b.board ? 'AIRBALL!' : b.rimHits ? 'IN AND OUT!' : 'BRICK!', 'bad', 1.0);
    this.mg.crowd.aww();
  }

  finishShootout() {
    if (this.state === 'done') return;
    this.state = 'done';
    const win = this.score >= HOOPS_GOAL;
    this.mg.endGame({
      win, score: this.score,
      title: this.score >= HOOPS_GOAL * 0.6 ? 'SO CLOSE!' : 'NICE TRY!',
      sub: win ? `${this.score} points! Splash!` : `You needed ${HOOPS_GOAL} points.`,
      stats: [['Points', this.score], ['Made', `${this.made} / ${this.shots}`], ['Greens', this.greens], ['Swishes', this.swishes], ['Best streak', this.bestStreak]],
      coins: this.score * 3 + this.swishes * 2,
    });
  }

  bug() {
    const t = Math.ceil(this.time);
    const racks = this.racks.map((r, ri) => `<div class="mgx-rack ${ri === this.spot ? 'cur' : ''}">${r.map((b) => `<i class="mgx-dot ${b.result === true ? 'on' : b.result === false ? 'off' : ''} ${b.money ? 'money' : ''}"></i>`).join('')}</div>`).join('');
    return `<div class="mgx-row"><div class="mgx-big">${this.score}<small> / ${HOOPS_GOAL}</small></div><div class="mgx-time ${t <= 10 ? 'low' : ''}">⏱️ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</div></div>
      <div class="mgx-racks">${racks}</div>${this.onFire ? '<div class="mgx-sub fire">🔥 ON FIRE</div>' : this.streak >= 2 ? `<div class="mgx-sub">${this.streak} in a row</div>` : ''}`;
  }

  hints(P) { return `<span>${P.act} Hold + release in the green</span>`; }

  animate(sdt) {
    const g = this.g, p = g.player;
    this.playerVisual(sdt);
    const Q = p.poser.begin();
    // ball position in the body frame: chest -> set point over the head -> gone
    if (this.held) {
      const k = this.state === 'rise' ? ease(this.meter / 0.8) : 0;
      if (this.state === 'rise') { Q.shiftBody(0, -0.12 * (1 - ease(this.riseT / 0.15)), 0); Q.legIK(1); Q.legIK(-1); }
      const local = [0.0, lerp(1.12, 2.05, k), lerp(0.36, 0.2, k)];
      const pos = Q.point(local, V());
      this.held.mesh.position.copy(pos);
      Q.reach(-1, Q.point([-0.06, local[1] - 0.09, local[2] - 0.1]), [-0.6, -1, -0.3]);
      Q.reach(1, Q.point([0.15, local[1] - 0.02, local[2] - 0.02]), [0.6, -1, -0.3]);
    } else if (this.state === 'land' || this.state === 'pickup') {
      // follow-through: shooting arm up and snapped toward the rim
      Q.reach(-1, Q.point([-0.05, 2.2, 0.45]), [-0.6, -1, -0.3]);
      Q.reach(1, Q.point([0.18, 1.85, 0.25]), [0.6, -1, -0.3]);
    }
    // net
    this.netAmp = damp(this.netAmp, 0, 4, sdt);
    if (this.netAmp > 0.002) {
      const t = g.time, rim = this.rim, A = this.netAmp;
      wobbleNet(this.hoop.net, (x, y, z, w) => {
        const k = -A * w * 0.4 * (0.5 + 0.5 * Math.sin(t * 28));
        return [(x - rim.x) * k, A * w * 0.1 * Math.sin(t * 22), (z - rim.z) * k];
      });
    } else if (this.netAmp !== 0) { this.netAmp = 0; resetNet(this.hoop.net); }
    // shot meter next to the shooter
    const lg = this.lastGrade;
    if (lg) lg.t -= sdt;
    if (this.a.phase === 'play' && (this.state === 'rise' || this.state === 'ready' || (lg && lg.t > 0))) {
      const sc = this.mg.toScreen(_v.copy(p.pos).add(V(0, 1.4, 0)));
      const showing = this.state === 'rise' ? this.meter : lg && lg.t > 0 && this.state !== 'ready' ? lg.meter : 0;
      const gw = this.state === 'rise' ? this.green : lg && this.state !== 'ready' ? lg.green : this.greenWidth(this.held && this.held.money);
      this.mg.ui.meter({
        vertical: true, x: clamp(sc.x + 70, 20, innerWidth - 60), y: clamp(sc.y - 90, 120, innerHeight - 290), fill: Math.min(1, showing / 1.05),
        green: [(0.86 - gw / 2) / 1.05, (0.86 + gw / 2) / 1.05], good: [(0.86 - gw / 2 - 0.09) / 1.05, Math.min(1, (0.86 + gw / 2 + 0.09) / 1.05)],
        grade: this.state === 'rise' || this.state === 'ready' ? '' : lg.grade,
        label: this.state === 'ready' ? '' : this.state === 'rise' ? '' : lg.grade === 'green' ? 'PERFECT' : lg.e < 0 ? (lg.grade === 'bad' ? 'VERY EARLY' : 'EARLY') : (lg.grade === 'bad' ? 'VERY LATE' : 'LATE'),
      });
    } else this.mg.ui.hideMeter();
  }

  camera(dt, phase) {
    const c = this.cam, rim = this.rim;
    if (phase === 'intro') {
      const t = this.a.t;
      c.eye.set(rim.x - this.sx * (16 - t * 0.8), this.Y + 7 - t * 0.2, rim.z + 10 - t * 1.2);
      c.look.set(rim.x, this.Y + 2.2, rim.z); c.fov = 55; c.k = 2;
      return;
    }
    const p = this.g.player;
    const base = this.state === 'move' ? p.pos : this.spots[this.spot];
    const to = V(rim.x - base.x, 0, rim.z - base.z).normalize();
    const side = V(-to.z, 0, to.x);
    c.eye.copy(base).addScaledVector(to, -4.4).addScaledVector(side, -1.3).add(V(0, 2.35, 0)); // wide of the hero's big head
    c.look.copy(base).lerp(rim, 0.72).add(V(0, 0.15, 0));
    c.fov = 42; c.k = this.state === 'move' ? 4 : 5; c.kl = 5;
    c.shadow = base;
  }

  dispose() {
    super.dispose();
    resetNet(this.hoop.net);
    for (const r of this.racks) for (const b of r) b.mesh.removeFromParent();
    this.mg.ui.hideMeter();
  }
}

// =====================================================================================
// PENALTY SHOOTOUT: you shoot, then you're the goalie. Best of 5, then sudden death.
const SOCCER_R = 0.11;
class Penalty extends Base {
  setup() {
    const z = this.z, g = this.g;
    const goal = this.goal = z.goal;
    this.Y = goal.y ?? z.y; this.W = goal.w || 3.66; this.H = goal.h || 2.44;
    this.dir = goal.dir;
    this.fwd = V(goal.dir, 0, 0);            // from the spot toward the goal
    this.right = V(0, 0, goal.dir);          // the kicker's right (screen right when shooting)
    this.gc = V(goal.x, this.Y, goal.z);     // goal mouth center on the ground
    this.spot = this.gc.clone().addScaledVector(this.fwd, -11);
    this.ball = this.add(projectileModel('soccer'));
    this.ball.scale.setScalar(SOCCER_R / 0.25);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(2.4); this.ball.add(this.glow); this.glow.visible = false;
    this.ballPos = V(); this.ballVel = V(); this.spin = V();
    this.keeper = this.npc('Barbarian', 0xffd34d);
    this.kicker = this.npc('Rogue', 0x2f6bff);
    this.you = []; this.cpu = []; this.round = 0;
    this.turn = 'you'; this.state = 'idle';
    this.aim = { u: 0, v: 1.2 }; this.curve = 0; this.power = 0;
    this.netAmp = 0; this.netAt = V();
    this.saves = 0; this.goals = 0; this.posts = 0;
    this.setupShot();
  }

  intro(P) {
    return {
      sub: 'Best of 5 kicks each, then sudden death!',
      steps: [
        [P.aim, 'Aim the target inside the goal'],
        [P.act, '<b>HOLD</b> for power, <b>LET GO</b> in the <b style="color:#7dff5a">GREEN</b>'],
        [P.lr, 'While charging, push left/right to <b>curve</b> it (fools the goalie!)'],
        [P.dive, 'In goal: <b>dive</b> left/right, or stay in the middle'],
        ['⏳', 'Wait for the kick! Dive too early and they’ll shoot the other way'],
      ],
      goal: 'Win the shootout',
    };
  }

  begin() { this.startTurn(); }

  // ---------- turn setup ----------
  setupShot() {
    const p = this.g.player;
    this.ballPos.copy(this.spot).setY(this.Y + SOCCER_R); this.ballVel.set(0, 0, 0); this.spin.set(0, 0, 0);
    this.ball.visible = true;
    this.result = null; this.saved = false; this.crossed = false;
    if (this.turn === 'you') {
      this.runFrom = this.spot.clone().addScaledVector(this.fwd, -2.3).addScaledVector(this.right, -0.9);
      p.setPosition(this.runFrom); this.face(this.yawTo(this.runFrom, this.gc.clone().addScaledVector(this.right, -0.6)));
      this.kicker.root.visible = false;
      this.keeper.root.visible = true;
      this.keeper.root.position.copy(this.gc).addScaledVector(this.fwd, -0.25);
      this.keeper.root.rotation.y = -this.dir * Math.PI / 2; // face the kicker
      this.keeper.tilt.rotation.set(0, 0, 0);
      this.keeper.play('Idle');
    } else {
      // the player is in goal
      const at = this.gc.clone().addScaledVector(this.fwd, -0.25);
      p.setPosition(at); this.face(this.yawTo(at, this.spot));
      this.keeper.root.visible = false;
      this.kicker.root.visible = true;
      this.kickFrom = this.spot.clone().addScaledVector(this.fwd, -2.8).addScaledVector(this.right, rand(-1.4, -0.6));
      this.kicker.root.position.copy(this.kickFrom);
      this.kicker.root.rotation.y = Math.atan2(this.spot.x - this.kickFrom.x, this.spot.z - this.kickFrom.z);
      this.kicker.tilt.rotation.set(0, 0, 0);
      this.kicker.play('Idle');
    }
    this.dive = null;
  }

  startTurn() {
    this.setupShot();
    const sd = this.round >= 5;
    const lab = sd ? `SUDDEN DEATH · ROUND ${this.round + 1}` : `ROUND ${this.round + 1} OF 5`;
    if (this.turn === 'you') {
      this.state = 'aim'; this.power = 0; this.curve = 0;
      this.mg.ui.lower('⚽ YOUR KICK', lab, 2.0);
      // the goalie gets sharper every round
      const k = this.kSkill = clamp(0.2 + this.round * 0.13 + (sd ? 0.1 : 0), 0, 0.9);
      this.guess = Math.random() < 0.3 + k * 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    } else {
      this.state = 'cpuRun'; this.runT = 0;
      this.mg.ui.lower('🧤 YOU’RE IN GOAL!', `${lab} · stop the shot!`, 2.0);
      const k = this.cSkill = clamp(0.3 + this.round * 0.1, 0, 0.92);
      this.cpuPlan = this.planCpuShot(k);
    }
    sfx.whistle();
    this.mg.cut = true;
  }

  planCpuShot(k) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const mid = Math.random() < 0.15;
    let u = mid ? rand(-0.6, 0.6) : side * rand(1.6, this.W - 0.35);
    let v = rand(0.2, this.H - 0.3);
    // less skilled kickers are wild: sometimes wide, over or off the post
    const err = (1 - k) * 0.9;
    u += rand(-err, err); v += rand(-err * 0.6, err * 0.6);
    return { u, v: Math.max(0.12, v), speed: 19 + k * 8 + rand(-1, 1), curve: Math.random() < 0.3 ? rand(-1, 1) * 4 : 0 };
  }

  // ---------- update ----------
  update(sdt, c) {
    const g = this.g, p = g.player;
    if (this.state === 'aim' || this.state === 'power') this.updateAim(sdt, c);
    if (this.state === 'aim') {
      if (this.ready(c) && c.actionPressed) { this.state = 'power'; this.powT = 0; }
    } else if (this.state === 'power') {
      this.powT += sdt;
      const ph = (this.powT / 0.95) % 2;
      this.power = ph > 1 ? 2 - ph : ph;
      this.curve = clamp(damp(this.curve, c.move.x, 6, sdt), -1, 1);
      if (c.actionReleased) { this.state = 'runup'; this.runT = 0; this.lockAim = { ...this.aim }; this.lockPower = this.power; }
    } else if (this.state === 'runup') {
      this.runT += sdt;
      const f = Math.min(1, this.runT / 0.5);
      const to = this.spot.clone().addScaledVector(this.fwd, -0.45).addScaledVector(this.right, -0.28);
      p.setPosition(this.runFrom.clone().lerp(to, f));
      p.vel.copy(to).sub(this.runFrom).divideScalar(0.5);
      if (this.runT > 0.3 && !this.kickAnim) { this.kickAnim = true; p.play('Kick_Right', 0.06, true); }
      if (f >= 1) { p.vel.set(0, 0, 0); this.kickAnim = false; this.playerKick(); }
    } else if (this.state === 'cpuRun') {
      this.runT += sdt;
      const k = this.kicker, f = Math.min(1, this.runT / 1.3);
      const to = this.spot.clone().addScaledVector(this.fwd, -0.45).addScaledVector(this.right, -0.25);
      k.root.position.copy(this.kickFrom).lerp(to, f);
      if (f < 1 && this.runT > 0.35) k.play('Run', 0.1);
      if (this.runT > 1.12 && !this.kickAnim) { this.kickAnim = true; k.play('Kick_Right', 0.06, true); }
      if (f >= 1) { this.kickAnim = false; this.cpuKick(); }
      this.keeperInput(c, false);
    } else if (this.state === 'flight') {
      if (this.turn === 'cpu') this.keeperInput(c, true);
      this.flight(sdt);
    } else if (this.state === 'after') {
      this.stT -= sdt;
      this.flight(sdt);
      if (this.stT <= 0) this.nextTurn();
    }
    if (this.turn === 'you') this.cpuKeeper(sdt);
    this.updateDive(sdt);
    this.ball.position.copy(this.ballPos);
    this.glow.visible = this.state === 'flight';
  }

  updateAim(sdt, c) {
    if (this.state === 'aim') {
      if (c.mouse) {
        const hit = this.mg.mouseOnPlane(c.mouse, _v.copy(this.fwd).negate(), this.gc);
        if (hit) { this.aim.u = (hit.z - this.gc.z) * this.dir; this.aim.v = hit.y - this.Y; }
      }
      this.aim.u += c.stick.x * 4 * sdt; this.aim.v += c.stick.y * 3 * sdt;
    }
    this.aim.u = clamp(this.aim.u, -this.W - 0.8, this.W + 0.8); this.aim.v = clamp(this.aim.v, 0.1, this.H + 0.9);
  }

  aimPoint(u, v, out = V()) { return out.copy(this.gc).addScaledVector(this.right, u).setY(this.Y + v); }

  // shoot from the spot so the ball arrives at (u, v) in time T, bending with a sideways force
  launch(u, v, speed, curveAcc) {
    const from = this.ballPos;
    const target = this.aimPoint(u, v);
    const T = from.distanceTo(target) / speed;
    this.acc = V(0, -G, 0).addScaledVector(this.right, curveAcc);
    this.ballVel.copy(target).sub(from).addScaledVector(this.acc, -0.5 * T * T).divideScalar(T);
    this.spin.copy(V(0, 1, 0)).multiplyScalar(-curveAcc * 3).add(this.right.clone().multiplyScalar(speed * 0.8));
    this.flyT = 0; this.T = T;
    this.state = 'flight';
    audio.gun('kick', null, true);
    this.g.effects.burst(from, { count: 10, color: 0xb9f5a0, speed: 3, size: 0.08, life: 0.4, grav: 6 });
  }

  playerKick() {
    const pw = this.lockPower, aim = this.lockAim;
    let { u, v } = aim;
    // power: green = exactly where you aimed, too much sails high, too little is weak and low
    const green = this.greenZone();
    let speed = 15 + pw * 14;
    if (pw > green[1]) { v += (pw - green[1]) * 9; u += rand(-1, 1) * (pw - green[1]) * 3; }
    else if (pw < green[0]) { const k = green[0] - pw; v -= k * 2.5; u += rand(-1, 1) * k * 2; speed -= k * 6; }
    else { this.mg.ui.flash(); }
    this.mg.shake(0.3);
    this.launch(u, Math.max(0.12, v), speed, -this.curve * 6);
    this.shotInfo = { u, v };
    // the keeper's reaction clock starts now
    this.kReact = lerp(0.34, 0.15, this.kSkill);
    this.kDove = false;
    if (this.guess) this.startKeeperDive(this.guess * rand(1.5, 2.6), rand(0.4, 1.6), true);
  }

  cpuKick() {
    const plan = this.cpuPlan;
    // dove early? a smart kicker goes the other way
    if (this.dive && Math.random() < this.cSkill) { plan.u = -Math.sign(this.dive.side || 1) * rand(1.6, this.W - 0.4); this.mg.call('Dove too early!', 'bad', 1.0); }
    this.launch(plan.u, plan.v, plan.speed, plan.curve);
    // the "matrix moment": slow-mo so you can react (less of it every round)
    this.mg.slow(lerp(0.4, 0.62, clamp(this.round / 6, 0, 1)), 0.6);
    this.mg.shake(0.2);
  }

  greenZone() { const sd = this.round >= 5; const w = Math.max(0.14, 0.26 - this.round * 0.02 - (sd ? 0.03 : 0)); return [0.62 - w / 2, 0.62 + w / 2]; }

  // CPU goalie: reads the ball after a reaction delay, then dives where it's headed (ignoring the curve!)
  cpuKeeper(sdt) {
    if (this.state !== 'flight' || this.kDove) return;
    this.kReact -= sdt;
    if (this.kReact > 0) return;
    this.kDove = true;
    if (this.dive) return; // already guessed
    const b = this.ballPos, v = this.ballVel;
    const tLine = Math.max(0.05, ((this.gc.x - b.x) * this.dir) / Math.max(1, v.x * this.dir));
    const pu = ((b.z + v.z * tLine) - this.gc.z) * this.dir;
    const pv = b.y + v.y * tLine - 0.5 * G * tLine * tLine - this.Y;
    if (Math.abs(pu) < 0.7 && Math.random() < 0.7) this.startKeeperDive(0, pv, false);
    else this.startKeeperDive(pu, pv, false);
  }

  // player goalie input: stick/keys flick to dive, or the action button (+ direction)
  keeperInput(c, flying) {
    if (this.dive) return;
    let side = null;
    const mx = c.move.x;
    if (Math.abs(mx) > 0.6 && Math.abs(this.prevMx || 0) <= 0.6) side = Math.sign(mx);
    else if (c.move.y > 0.6 && (this.prevMy || 0) <= 0.6) side = 0;
    else if (this.ready(c) && c.actionPressed) {
      if (!c.pad && Math.abs(c.mouseAt.x) > 0.2) side = Math.sign(c.mouseAt.x);
      else side = Math.abs(mx) > 0.35 ? Math.sign(mx) : 0;
    }
    this.prevMx = mx; this.prevMy = c.move.y;
    if (side === null) return;
    // screen right = the goalie's right = -right (we look out from behind the goal)
    const u = side * -1;
    const hv = this.state === 'flight' ? clamp(this.ballPos.y - this.Y + this.ballVel.y * 0.2, 0.3, 2.0) : 0.9;
    this.startKeeperDive(u * 2.4, hv, !flying);
  }

  // u: sideways target (in the kicker's frame, meters from the middle), v: height
  startKeeperDive(u, v, early) {
    const side = Math.abs(u) < 0.5 ? 0 : Math.sign(u);
    const reach = side === 0 ? 0 : clamp(Math.abs(u), 1.2, 2.7);
    this.dive = { side, reach, v: clamp(v, 0.3, 2.2), t: 0, early };
    if (this.turn === 'you') this.keeper.play('Idle_Neutral', 0.05);
  }

  updateDive(sdt) { if (this.dive) this.dive.t += sdt; }

  // world pose of the diving goalie: returns { base (feet), off (sideways move), lift, roll }
  divePose(d) {
    if (!d) return { off: 0, lift: 0, roll: 0, f: 0 };
    const f = ease(d.t / 0.42);
    if (d.side === 0) return { off: 0, lift: Math.sin(Math.min(1, d.t / 0.5) * Math.PI) * clamp(d.v - 1.4, 0, 0.7), roll: 0, f };
    const high = clamp((d.v - 0.6) / 1.4, 0, 1);
    return { off: d.side * d.reach * 0.8 * f, lift: Math.sin(Math.min(1, d.t / 0.6) * Math.PI) * (0.25 + high * 0.55), roll: d.side * f * (1.15 + (1 - high) * 0.3), f };
  }

  // capsule from the goalie's feet to fingertips, in world space
  keeperCapsule(a, b) {
    const d = this.dive, pose = this.divePose(d);
    const base = this.gc.clone().addScaledVector(this.fwd, -0.25).addScaledVector(this.right, pose.off).setY(this.Y + pose.lift);
    // lying over toward the dive side (in the kicker's frame +right)
    const upDir = V(0, Math.cos(pose.roll), 0).addScaledVector(this.right, Math.sin(pose.roll));
    a.copy(base).addScaledVector(upDir, 0.35);
    b.copy(base).addScaledVector(upDir, 2.25 + (d && d.side ? 0.25 : 0));
    return base;
  }

  flight(sdt) {
    if (this.state !== 'flight' && this.state !== 'after') return;
    const b = this.ballPos, v = this.ballVel, g = this.g;
    const steps = 4, h = sdt / steps;
    for (let s = 0; s < steps; s++) {
      const prevSide = (b.x - this.gc.x) * this.dir;
      if (this.state === 'flight' && !this.result) v.addScaledVector(this.acc, h);
      else v.y -= G * h;
      b.addScaledVector(v, h);
      const side = (b.x - this.gc.x) * this.dir;
      // posts and crossbar
      for (const pz of [-this.W, this.W]) {
        const px = this.gc.x, pzW = this.gc.z + pz;
        const dx = b.x - px, dz = b.z - pzW, dd = Math.hypot(dx, dz);
        if (dd < 0.06 + SOCCER_R && b.y < this.Y + this.H) {
          const n = V(dx / dd, 0, dz / dd); const vn = v.dot(n);
          if (vn < 0) { v.addScaledVector(n, -vn * 1.7); b.set(px + n.x * (0.06 + SOCCER_R), b.y, pzW + n.z * (0.06 + SOCCER_R)); this.doink(); }
        }
      }
      {
        const dx = b.x - this.gc.x, dy = b.y - (this.Y + this.H), dd = Math.hypot(dx, dy);
        if (dd < 0.06 + SOCCER_R && Math.abs(b.z - this.gc.z) < this.W) {
          const n = V(dx / dd, dy / dd, 0); const vn = v.dot(n);
          if (vn < 0) { v.addScaledVector(n, -vn * 1.7); b.set(this.gc.x + n.x * (0.06 + SOCCER_R), this.Y + this.H + n.y * (0.06 + SOCCER_R), b.z); this.doink(); }
        }
      }
      // goalie save
      if (!this.result && prevSide < 0) {
        const A = V(), B = V(), closest = V();
        this.keeperCapsule(A, B);
        if (segDist(b, A, B, closest) < 0.33 + SOCCER_R) this.save(closest);
      }
      // crossing the goal line
      if (!this.result && prevSide < 0 && side >= 0) {
        const inside = Math.abs(b.z - this.gc.z) < this.W - SOCCER_R * 0.5 && b.y < this.Y + this.H - SOCCER_R * 0.5;
        if (inside) this.goalScored(); else this.missed(b.y >= this.Y + this.H - SOCCER_R * 0.5 ? 'OVER THE BAR!' : 'WIDE!');
      }
      // the net catches it
      if (this.result === 'goal') {
        const t = clamp((b.y - this.Y) / this.H, 0, 1);
        const back = 2 - t;
        if (side > back - SOCCER_R) { this.netHit(b); v.multiplyScalar(0.12); b.x = this.gc.x + this.dir * (back - SOCCER_R); }
        if (Math.abs(b.z - this.gc.z) > this.W - SOCCER_R) { v.z *= -0.2; b.z = this.gc.z + Math.sign(b.z - this.gc.z) * (this.W - SOCCER_R); }
        if (b.y > this.Y + this.H - SOCCER_R) { v.y = -Math.abs(v.y) * 0.2; b.y = this.Y + this.H - SOCCER_R; }
      }
      // ground
      if (b.y < this.Y + SOCCER_R) {
        b.y = this.Y + SOCCER_R;
        if (v.y < -1) { v.y *= -0.55; audio.play('hitBody', { pos: b.clone(), vol: 0.25, rate: 1.4 }); } else v.y = 0;
        v.x *= 0.97; v.z *= 0.97;
      }
    }
    this.flyT += sdt;
    if (this.state === 'flight' && !this.result && this.flyT > 2.5) this.missed('WIDE!');
    this.ball.rotation.x += this.spin.z * sdt * 0.5; this.ball.rotation.y += this.spin.y * sdt * 0.3; this.ball.rotation.z += this.spin.x * sdt * 0.5;
    if (this.state === 'flight') g.effects.burst(b, { count: 1, color: 0xffffff, speed: 0, size: 0.1, life: 0.2, grav: 0, glow: true });
  }

  doink() { this.posts++; sfx.tone(1250, 0.5, { type: 'triangle', vol: 0.12, end: 1180 }); audio.play('hitMetal', { pos: this.ballPos.clone(), vol: 0.7, rate: 1.4 }); this.mg.call('DOINK! 🥅', 'bad', 1.0); this.mg.shake(0.3); }

  save(at) {
    this.result = 'save'; this.saved = true;
    const b = this.ballPos, v = this.ballVel;
    const n = b.clone().sub(at).normalize();
    v.reflect(n).multiplyScalar(0.4).addScaledVector(n, 3).addScaledVector(this.fwd, -3);
    audio.play('hitHeavy', { pos: b.clone(), vol: 0.8 }); sfx.glove();
    this.mg.shake(0.5); this.mg.hitstop(0.08);
    const mine = this.turn === 'cpu';
    if (mine) { this.saves++; this.mg.call('SAVED! 🧤', 'gold', 1.5); this.mg.cheer(1.2); this.mg.slow(0.35, 0.6); this.g.effects.burst(b.clone(), { count: 30, colors: [0xffd34d, 0xffffff], speed: 6, size: 0.15, life: 0.6, grav: 4, glow: true }); }
    else { this.mg.call('SAVED!', 'bad', 1.3); this.mg.crowd.aww(); }
    this.toAfter(1.8);
  }

  goalScored() {
    this.result = 'goal';
    const mine = this.turn === 'you';
    if (mine) {
      this.goals++;
      const top = this.ballPos.y - this.Y > this.H * 0.7 && Math.abs(this.ballPos.z - this.gc.z) > this.W - 1.2;
      this.mg.call(top ? 'TOP BINS! ⚽' : 'GOOOAL! ⚽', 'gold', 1.6); this.mg.cheer(1.4); this.mg.slow(0.35, 0.5);
      this.g.effects.confetti(this.ballPos.clone().add(V(0, 1, 0)), 60);
    } else { this.mg.call('They scored…', 'bad', 1.2); this.mg.crowd.aww(); }
    this.toAfter(2.0);
  }

  missed(word) {
    this.result = 'miss';
    if (this.turn === 'you') { this.mg.call(word, 'bad', 1.2); this.mg.crowd.aww(); }
    else { this.mg.call(`${word} 😅`, 'green', 1.2); this.mg.cheer(0.8); }
    this.toAfter(1.6);
  }

  netHit(b) {
    if (this.netAmp > 0.5) return;
    this.netAmp = 1; this.netAt.copy(b);
    audio.play('hitBody', { vol: 0.25, rate: 0.7 });
  }

  toAfter(t) { this.state = 'after'; this.stT = t; }

  nextTurn() {
    const scored = this.result === 'goal';
    if (this.turn === 'you') { this.you.push(scored); this.turn = 'cpu'; }
    else { this.cpu.push(scored); this.turn = 'you'; this.round++; }
    resetNet(this.goal.net); this.netAmp = 0;
    const res = this.decided();
    if (res) return this.finishShootout(res === 'you');
    if (this.round === 5 && this.turn === 'you' && this.you.length === 5) this.mg.ui.lower('⚡ SUDDEN DEATH!', 'Score and stop them to win!', 2.4);
    this.startTurn();
  }

  decided() {
    const y = this.you.filter(Boolean).length, c = this.cpu.filter(Boolean).length;
    const yr = this.you.length, cr = this.cpu.length;
    if (yr <= 5 && cr <= 5) {
      if (y + (5 - yr) < c) return 'cpu';
      if (c + (5 - cr) < y) return 'you';
      if (yr === 5 && cr === 5 && y !== c) return y > c ? 'you' : 'cpu';
      return null;
    }
    if (yr === cr && y !== c) return y > c ? 'you' : 'cpu';
    return null;
  }

  finishShootout(win) {
    this.state = 'done';
    const y = this.you.filter(Boolean).length, c = this.cpu.filter(Boolean).length;
    this.mg.endGame({
      win, score: this.goals,
      title: 'SO CLOSE!',
      sub: `Final score: YOU ${y} – ${c} CPU`,
      stats: [['Your goals', this.goals], ['Saves', this.saves], ['Rounds', this.round + (this.turn === 'cpu' ? 1 : 0)], ['Posts hit', this.posts]],
      coins: this.goals * 15 + this.saves * 15,
    });
  }

  bug() {
    const row = (arr, cur) => {
      const n = Math.max(5, arr.length + (cur ? 1 : 0));
      return Array.from({ length: n }, (_, i) => `<i class="mgx-dot ${i < arr.length ? (arr[i] ? 'on' : 'off') : i === arr.length && cur ? 'cur' : ''}"></i>`).join('');
    };
    const y = this.you.filter(Boolean).length, c = this.cpu.filter(Boolean).length;
    const sd = this.round >= 5 ? '<div class="mgx-sub fire">⚡ SUDDEN DEATH</div>' : '';
    return `<div class="mgx-so"><span>YOU</span><div class="mgx-dots">${row(this.you, this.turn === 'you')}</div><b>${y}</b></div>
      <div class="mgx-so"><span>CPU</span><div class="mgx-dots">${row(this.cpu, this.turn === 'cpu')}</div><b>${c}</b></div>${sd}`;
  }

  hints(P) {
    if (this.state === 'flight' || this.state === 'after' || this.state === 'runup') return '';
    if (this.turn === 'cpu') return `<span>${P.dive} Dive</span><span>${P.act} Dive (with direction)</span>`;
    if (this.state === 'power') return `<span>Let go of ${P.act} in the green</span><span>${P.lr} Curve</span>`;
    return `<span>${P.aim} Aim</span><span>${P.act} Hold for power</span>`;
  }

  animate(sdt) {
    const g = this.g, p = g.player;
    // ---- CPU goalie ----
    if (this.keeper.root.visible) {
      const K = this.keeper, pose = this.divePose(this.turn === 'you' ? this.dive : null);
      const sway = this.turn === 'you' && !this.dive && this.state !== 'after' ? Math.sin(g.time * 2.4) * 0.35 : 0;
      K.root.position.copy(this.gc).addScaledVector(this.fwd, -0.25).addScaledVector(this.right, pose.off + sway).setY(this.Y + pose.lift);
      // roll toward the dive side: our +right is the keeper's left (he faces us)
      K.tilt.rotation.z = -pose.roll;
      const P = K.update(sdt);
      this.keeperArms(P, pose);
    }
    // ---- CPU kicker ----
    if (this.kicker.root.visible) this.kicker.update(sdt);
    // ---- the player ----
    if (this.turn === 'you') {
      if (this.state === 'aim' || this.state === 'power') this.face(this.yawTo(p.pos, this.ballPos));
      else if (this.state === 'runup') this.face(this.yawTo(this.runFrom, this.spot.clone().addScaledVector(this.fwd, 0.4)));
      this.playerVisual(sdt);
    } else {
      this.face(this.yawTo(this.gc, this.spot));
      this.playerVisual(sdt);
      const pose = this.divePose(this.dive);
      // our goalie faces the kicker, so the kicker's +right is our left
      p.root.position.addScaledVector(this.right, pose.off).add(V(0, pose.lift, 0));
      p.root.rotateZ(-pose.roll);
      p.root.updateMatrixWorld(true);
      const P = p.poser.begin();
      this.keeperArms(P, pose);
    }
    // net bulge
    this.netAmp = damp(this.netAmp, 0, 3, sdt);
    if (this.netAmp > 0.003) {
      const A = this.netAmp, at = this.netAt, dir = this.dir, t = g.time;
      wobbleNet(this.goal.net, (x, y, z, w) => {
        const d2 = (y - at.y) ** 2 + (z - at.z) ** 2;
        const k = A * w * Math.exp(-d2 / 1.2) * (0.6 + 0.4 * Math.cos(t * 18));
        return [dir * k * 0.7, 0, 0];
      });
    }
    this.uiAim();
  }

  keeperArms(P, pose) {
    if (pose.f > 0.05 || (this.dive && this.dive.side === 0)) {
      P.reach(1, P.point([0.2, 2.05, 0.25]), [0.6, -0.2, -1]);
      P.reach(-1, P.point([-0.2, 2.05, 0.25]), [-0.6, -0.2, -1]);
    } else {
      // ready stance: knees bent, hands out
      P.shiftBody(0, -0.12, 0); P.legIK(1); P.legIK(-1);
      P.reach(1, P.point([0.5, 1.1, 0.35]), [0.6, -1, -0.3]);
      P.reach(-1, P.point([-0.5, 1.1, 0.35]), [-0.6, -1, -0.3]);
    }
  }

  uiAim() {
    const ui = this.mg.ui;
    if (this.a.phase !== 'play' || this.turn !== 'you' || !['aim', 'power', 'runup'].includes(this.state)) { ui.reticle(0, 0, false); ui.hideMeter(); return; }
    const aim = this.state === 'runup' ? this.lockAim : this.aim;
    const sc = this.mg.toScreen(this.aimPoint(aim.u, aim.v, _v));
    ui.reticle(sc.x, sc.y, true, this.state === 'aim' ? '' : 'locked');
    if (this.state === 'aim') { ui.hideMeter(); return; }
    const gz = this.greenZone();
    const pw = this.state === 'runup' ? this.lockPower : this.power;
    const c = this.curve;
    ui.meter({
      vertical: false, x: innerWidth / 2 - 180, y: innerHeight - 150, fill: pw, green: gz, good: [gz[0] - 0.1, gz[1] + 0.08],
      grade: this.state === 'runup' ? (pw >= gz[0] && pw <= gz[1] ? 'green' : pw > gz[1] ? 'bad' : 'good') : '',
      label: `POWER${Math.abs(c) > 0.15 ? ` · CURVE ${c < 0 ? '↶' : '↷'}` : ''}`,
    });
  }

  camera(dt, phase) {
    const c = this.cam;
    if (phase === 'intro') {
      const t = this.a.t;
      c.eye.copy(this.gc).addScaledVector(this.fwd, -18 + t * 0.6).addScaledVector(this.right, 14 - t * 1.2).add(V(0, 9 - t * 0.3, 0));
      c.look.copy(this.gc).add(V(0, 1.2, 0)); c.fov = 55; c.k = 2;
      return;
    }
    if (this.turn === 'you') {
      c.eye.copy(this.spot).addScaledVector(this.fwd, -5.4).add(V(0, 2.7, 0));
      c.look.copy(this.spot).addScaledVector(this.fwd, 7).add(V(0, 0.9, 0));
      c.fov = 42;
      if (this.state === 'after' && this.result === 'goal') c.fov = 36;
      c.k = 4; c.shadow = this.spot;
    } else {
      // behind the goal, looking out through the net at the kicker
      c.eye.copy(this.gc).addScaledVector(this.fwd, 3.0).add(V(0, 4.0, 0));
      c.look.copy(this.spot).addScaledVector(this.fwd, 2.5);
      c.fov = 58; c.k = 4; c.shadow = this.gc;
    }
  }

  dispose() {
    super.dispose();
    resetNet(this.goal.net);
    this.mg.ui.reticle(0, 0, false); this.mg.ui.hideMeter();
  }
}

const GAMES = { homerun: HomeRun, hoops: Hoops, penalty: Penalty };
