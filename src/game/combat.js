import * as THREE from 'three';
import { rand } from '../engine/utils.js';
import { audio } from '../engine/audio.js';
import { ELEMENTS, RARITIES } from './weapons/data.js';
import { projectileModel } from './models.js';

const tmp = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const PAINT_COLORS = [0xff3dc8, 0x3aa0ff, 0xffd34d, 0x58d63b, 0xb45cff, 0xff7a1a];
// ejected shells: [length, diameter, color]
const CASINGS = { light: [0.045, 0.022, 0xd9a93f], medium: [0.065, 0.026, 0xd9a93f], heavy: [0.1, 0.034, 0xc8963a], shell: [0.085, 0.045, 0xd8322a] };
const ELIM_COLOR = 0x5ecbff;
const BH_END = new THREE.Color(0x3a0a8a);
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.zones = [];    // poison clouds, black holes
    this.timers = [];   // delayed actions (pause-safe, cleared per match)
    this.dissolves = []; // eliminated characters beaming out
    this.stuckArrows = [];
    // harvest weak point marker (Fortnite blue circle)
    const wm = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ad0ff).multiplyScalar(2.2), transparent: true, depthWrite: false, toneMapped: false });
    wm.add(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 28), ringMat));
    wm.add(new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), ringMat));
    wm.visible = false; wm.renderOrder = 9;
    game.scene.add(wm);
    this.weakMarker = wm; this.weak = null;
    // shared bits added to projectiles (never disposed)
    this.shared = {
      flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      flameGeo: new THREE.ConeGeometry(0.09, 0.5, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      blink: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(4), toneMapped: false }),
      blinkGeo: new THREE.SphereGeometry(0.045, 8, 6),
    };
  }

  later(sec, fn) { this.timers.push({ t: sec, fn, match: this.game.match }); }

  // ---------- aiming helpers ----------
  // where the barrel is (models point down -Z; length ~ model size)
  muzzlePos(ch, w, out = new THREE.Vector3()) {
    if (ch.heldObj && ch.heldObj.visible) {
      const len = (w && w.def.model && w.def.model.size ? w.def.model.size * 0.55 : 0.45) * ch.scale;
      return out.copy(ch.heldObj.position).addScaledVector(ch.aimDir(_c), len);
    }
    return ch.muzzle(out);
  }
  // camera rays start at the player's shoulder plane so nothing behind the player gets hit
  aimStart(ch, aim, out = new THREE.Vector3()) {
    out.copy(aim.origin);
    if (aim.isPlayer) {
      const head = ch.head;
      const t = Math.max(0, head.sub(aim.origin).dot(aim.dir) - 0.25);
      out.addScaledVector(aim.dir, t);
    }
    return out;
  }
  // current cone (radians) for this character + weapon, without first-shot bonus. HUD can read ch.spreadNow.
  spreadFor(ch, w) {
    const def = w.def;
    let s = ch.aiming ? w.adsSpread : w.spread;
    const sp = Math.hypot(ch.vel.x, ch.vel.z);
    let m = 1;
    if (!ch.grounded) m *= 1.8;
    else { if (ch.sprinting) m *= 1.5; m *= 1 + Math.min(1, sp / 7) * 0.4; if (ch.crouching) m *= 0.75; }
    if (!(def.pellets > 1)) m *= 1 + (ch.bloom || 0);
    return s * m;
  }
  firstShotReady(ch, w) {
    const def = w.def;
    if (def.pellets > 1 || def.mode === 'beam' || !ch.grounded) return false;
    if (Math.hypot(ch.vel.x, ch.vel.z) > 3.5) return false;
    return this.game.time - (ch.lastShotT || -9) > Math.max(0.3, 1.25 / w.rate);
  }
  // random direction inside a cone of radius `s` (uniform disk)
  coneDir(dir, s, out, angle = null, radius = null) {
    out.copy(dir);
    if (s <= 0) return out;
    _a.crossVectors(dir, UP); if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0); _a.normalize();
    _b.crossVectors(_a, dir).normalize();
    const th = angle ?? Math.random() * Math.PI * 2, r = s * (radius ?? Math.sqrt(Math.random()));
    return out.addScaledVector(_a, Math.cos(th) * r).addScaledVector(_b, Math.sin(th) * r).normalize();
  }
  falloffMul(def, d) {
    if (!def.falloff || d <= def.falloff) return 1;
    const end = def.falloffEnd ?? def.range, min = def.falloffMin ?? 0.25;
    return Math.max(min, 1 - (1 - min) * (d - def.falloff) / Math.max(1, end - def.falloff));
  }

  // Called every frame for each armed character.
  // aim: { origin: Vector3 (ray start), dir: Vector3 (normalized), firing, firePressed, isPlayer }
  updateWeapon(ch, dt, aim) {
    const w = ch.heldItem();
    const g = this.game;
    ch.fireCooldown -= dt;
    if (ch.bloom > 0 && g.time > (ch.bloomHold || 0)) ch.bloom = Math.max(0, ch.bloom - dt * 3.2);
    if (!w || w.type !== 'weapon' || !ch.alive) { ch.firing = false; return; }
    const def = w.def;
    ch.spreadNow = this.spreadFor(ch, w);
    ch.firstShot = this.firstShotReady(ch, w);
    // reloading
    if (ch.reloadT > 0) {
      ch.reloadT -= dt;
      if (def.shellReload) {
        // shotguns load one shell at a time and can fire mid-reload
        const per = w.reload / Math.max(1, w.mag);
        ch.shellT = (ch.shellT || 0) + dt;
        while (ch.shellT >= per && w.ammoInMag < w.mag) {
          ch.shellT -= per;
          if (!this.loadRounds(ch, w, 1)) { ch.reloadT = 0; break; }
          if (ch.isPlayer) audio.shellIn(ch.pos, true);
        }
        if (w.ammoInMag >= w.mag) ch.reloadT = 0;
      } else if (ch.reloadT <= 0) this.finishReload(ch, w);
      ch.firing = false;
      if (ch.reloadT > 0 || !def.shellReload) {
        if (!(def.mode === 'pump' && aim.firePressed && w.ammoInMag > 0)) return;
        ch.reloadT = 0; // shotgun can interrupt reload
      }
    }
    if (ch.useT > 0 || ch.emoting || ch.state !== 'ground' && def.mode !== 'melee') { ch.firing = false; return; }
    if (ch.status.frozen > 0 || ch.status.bubble > 0) { ch.firing = false; return; }

    if (def.mode === 'charge') {
      if (aim.firing && ch.fireCooldown <= 0) { ch.chargeT = Math.min(def.charge, ch.chargeT + dt); ch.firing = true; return; }
      if (!aim.firing && ch.chargeT > 0) {
        const k = 0.35 + 0.65 * (ch.chargeT / def.charge);
        ch.chargeT = 0;
        this.shoot(ch, w, aim, k);
        ch.fireCooldown = 1 / w.rate;
      }
      ch.firing = false;
      return;
    }

    if (def.mode === 'auto' && def.spinup) {
      ch.spin = aim.firing ? Math.min(def.spinup, ch.spin + dt) : Math.max(0, ch.spin - dt * 2);
      if (ch.spin < def.spinup) { ch.firing = aim.firing; return; }
    }

    let wants = false;
    if (def.mode === 'auto' || def.mode === 'beam') wants = aim.firing;
    else if (def.mode === 'burst') { if (aim.firePressed && ch.burstLeft <= 0 && ch.fireCooldown <= 0) ch.burstLeft = def.burst; wants = ch.burstLeft > 0; }
    else if (def.mode === 'melee') wants = aim.firing; // hold to keep swinging, like the pickaxe
    else wants = aim.firePressed || (!aim.isPlayer && aim.firing);
    ch.firing = aim.firing;
    if (!wants) return;
    if (ch.fireCooldown > 0) return;

    if (def.mode !== 'melee' && def.mode !== 'throw' && w.mag > 0 && w.ammoInMag <= 0 && !ch.infiniteAmmo) {
      if (!this.startReload(ch, w)) { if (aim.isPlayer && aim.firePressed) audio.gun('empty', ch.pos, true); }
      return;
    }
    if (def.mode === 'burst') {
      ch.burstLeft--;
      ch.fireCooldown = ch.burstLeft > 0 ? 0.075 : 1 / w.rate;
    } else ch.fireCooldown = 1 / w.rate;
    if (def.mode !== 'melee' && def.mode !== 'throw' && w.mag > 0 && !ch.infiniteAmmo) w.ammoInMag--;
    this.shoot(ch, w, aim, 1);
    if (w.mag > 0 && w.ammoInMag <= 0 && !ch.infiniteAmmo) this.startReload(ch, w);
  }

  startReload(ch, w) {
    const def = w.def;
    if (!def.mag || w.ammoInMag >= w.mag || ch.reloadT > 0) return false;
    if (def.ammo && ch.inv.ammo[def.ammo] <= 0 && !ch.infiniteAmmo) return false;
    ch.reloadT = def.shellReload ? (w.reload / w.mag) * (w.mag - w.ammoInMag) : w.reload;
    ch.shellT = 0;
    ch.burstLeft = 0;
    if (!def.shellReload) audio.reload(def.cls, ch.pos, ch.isPlayer, ch.reloadT);
    this.game.events.emit('reload', ch);
    return true;
  }

  loadRounds(ch, w, n) {
    const def = w.def;
    const need = Math.min(n, w.mag - w.ammoInMag);
    if (need <= 0) return false;
    if (!def.ammo || ch.infiniteAmmo) { w.ammoInMag += need; return true; }
    const take = Math.min(need, ch.inv.ammo[def.ammo]);
    if (take <= 0) return false;
    ch.inv.ammo[def.ammo] -= take;
    w.ammoInMag += take;
    return true;
  }

  finishReload(ch, w) { this.loadRounds(ch, w, w.mag); }

  shoot(ch, w, aim, charge = 1) {
    const g = this.game, def = w.def;
    const isP = ch.isPlayer;
    g.events.emit('shot', ch, w);
    if (def.mode === 'melee') return this.melee(ch, w, aim);
    if (def.mode === 'throw') return this.throwItem(ch, w, aim);
    audio.gun(def.sound, ch.pos, isP);
    const muzzle = this.muzzlePos(ch, w, new THREE.Vector3());
    const camD = g.effects.camDist(muzzle);
    const elCol = w.element ? ELEMENTS[w.element].color : null;
    if (def.mode !== 'beam') g.effects.muzzleFlash(muzzle, aim.dir, { size: (def.flash ?? 1) * ch.scale, color: elCol ?? (def.beamColor || 0xffc070), light: camD < 70 });
    else g.effects.burst(muzzle, { count: 2, color: def.beamColor, speed: 1.5, size: 0.25, life: 0.15, grav: 0, glow: true });
    if (def.casing && camD < 45) this.ejectCasing(ch, def.casing, def.mode === 'pump' || def.mode === 'bolt' ? 0.3 : 0);
    // recoil (camera only follows the player) + bloom
    if (isP) {
      const k = (ch.aiming ? 0.7 : 1) * (ch.crouching ? 0.8 : 1);
      ch.recoilKick = (ch.recoilKick || 0) + (def.recoil || 0) * k;
      if (g.cameraRig) g.cameraRig.yaw += rand(-1, 1) * (def.recoil || 0) * 0.3 * k;
      g.input.rumble(0.2 + (def.recoil || 0) * 4, 0.3, 60);
    }
    const first = this.firstShotReady(ch, w);
    const spread = this.spreadFor(ch, w) * (first ? (ch.aiming ? 0 : 0.5) : 1);
    if (!(def.pellets > 1)) { ch.bloom = Math.min(2.5, (ch.bloom || 0) + (def.bloom ?? 0.1)); ch.bloomHold = g.time + 1 / w.rate + 0.06; }
    ch.lastShotT = g.time;

    const start = this.aimStart(ch, aim, new THREE.Vector3());
    // projectiles leave the barrel, so aim them at whatever is under the crosshair
    let projAim = aim.dir;
    if (def.proj && aim.isPlayer) {
      const h = this.ray(start, aim.dir, 600, ch);
      const target = h ? v3(h.point) : start.clone().addScaledVector(aim.dir, 600);
      projAim = target.sub(muzzle).normalize();
    }
    const pellets = def.pellets || 1;
    const rot = Math.random() * Math.PI * 2;
    for (let i = 0; i < pellets; i++) {
      const dir = new THREE.Vector3();
      const base = def.proj ? projAim : aim.dir;
      if (pellets > 1) {
        // shotgun: a fixed-ish ring pattern so pellets cover the crosshair circle
        if (i === 0) this.coneDir(base, spread, dir, 0, 0.1 * Math.random());
        else this.coneDir(base, spread, dir, rot + (i / (pellets - 1)) * Math.PI * 2 + rand(-0.25, 0.25), (i % 2 ? 0.5 : 0.95) * rand(0.85, 1.08));
      } else this.coneDir(base, spread, dir);
      if (def.proj) this.spawnProjectile(ch, w, muzzle.clone(), dir, charge);
      else if (def.mode === 'beam') this.beam(ch, w, start, dir, muzzle);
      else this.hitscan(ch, w, start, dir, muzzle, pellets, i, aim.isPlayer);
    }
  }

  ejectCasing(ch, kind, delay = 0) {
    const c = CASINGS[kind]; if (!c) return;
    const eject = () => {
      if (!ch.alive || !ch.heldObj) return;
      const e = this.game.effects;
      const yaw = ch.yaw;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const p = ch.heldObj.position;
      const s = rand(1.8, 3.2);
      _col.set(c[2]);
      e.shells.spawn(p.x + rx * 0.08, p.y + 0.06, p.z + rz * 0.08, rx * s + ch.vel.x, rand(2.2, 3.6) + ch.vel.y * 0.5, rz * s + ch.vel.z, _col, c[0], c[1], c[1], 2.5,
        { grav: 16, bounce: 0.4, floor: ch.grounded ? ch.pos.y : NaN, spin: 22, drag: 0.1 });
    };
    if (delay) this.later(delay, eject); else eject();
  }

  ray(from, dir, maxDist, ch) {
    return this.game.physics.raycast(from, dir, maxDist, ch ? ch.collider : null, undefined, (col) => {
      const o = this.game.physics.owners.get(col.handle);
      if (!o) return true;
      if (o.kind === 'char') return o.char !== ch && o.char.alive;
      if (o.kind === 'trigger' || o.kind === 'boundary') return false;
      return true;
    });
  }

  hitscan(ch, w, origin, dir, muzzle, pellets, idx = 0, isPlayer = false) {
    const def = w.def, g = this.game;
    const range = def.range || 200;
    let hit = this.ray(origin, dir, range, ch);
    let end = hit ? v3(hit.point) : origin.clone().addScaledVector(dir, range);
    // the barrel can be blocked even if the crosshair is clear (corners, walls right in front)
    if (isPlayer) {
      const to = _a.copy(end).sub(muzzle); const L = to.length();
      if (L > 0.3) {
        to.divideScalar(L);
        const h2 = this.ray(muzzle, to, L - 0.05, ch);
        if (h2 && (!hit || h2.collider !== hit.collider || h2.dist < L - 0.4)) { hit = h2; end = v3(h2.point); }
      }
    }
    const color = w.element ? ELEMENTS[w.element].color : def.beamColor || 0xffe9a0;
    if (def.element === 'lightning' || (w.element === 'lightning' && def.cls === 'Wacky')) {
      g.effects.bolt(muzzle, end, 0xfff35a, 0.35, 2.4, 0.14);
      g.effects.light(end, 0xfff35a, 5, 0.12, 12);
    } else if (pellets === 1 || idx % 2 === 0) g.effects.bullet(muzzle, end, color, pellets > 1 ? 0.7 : def.cls === 'Sniper' ? 1.6 : 1);
    if (!ch.isPlayer) audio.nearMiss(origin, end, ch, def, hit);
    if (!hit) return;
    // piercing perk: punch through one build piece
    if (w.perks.includes('piercing') && hit.owner && hit.owner.kind === 'build') {
      g.building.damagePiece(hit.owner.piece, w.dmg * (def.buildMult || 1), ch);
      g.effects.impact(end, hit.normal, 'build-' + hit.owner.piece.mat, { hole: false });
      const from = end.clone().addScaledVector(dir, 0.6);
      const h2 = this.ray(from, dir, Math.max(1, range - hit.dist), ch);
      if (!h2) return;
      hit = h2; end = v3(h2.point);
    }
    const d = ch.head.distanceTo(end);
    const dmg = w.dmg * this.falloffMul(def, d);
    this.applyHit(ch, w, hit, dmg, dir);
    // bouncy perk / golf ricochet
    if ((w.perks.includes('bouncy') || def.ricochet) && hit.owner && hit.owner.kind !== 'char' && hit.normal) {
      const n = v3(hit.normal);
      const rdir = dir.clone().reflect(n);
      const from = end.clone().addScaledVector(n, 0.05);
      const h2 = this.ray(from, rdir, 60, ch);
      const e2 = h2 ? v3(h2.point) : from.clone().addScaledVector(rdir, 60);
      g.effects.bullet(from, e2, color, 1);
      if (h2) this.applyHit(ch, w, h2, dmg * 0.7, rdir);
    }
  }

  beam(ch, w, origin, dir, muzzle) {
    const def = w.def, g = this.game;
    const hit = this.ray(origin, dir, def.range, ch);
    const end = hit ? v3(hit.point) : origin.clone().addScaledVector(dir, def.range);
    g.effects.beam(muzzle, end, def.beamColor || 0xffffff, 0, 3.2);
    g.effects.tracer(muzzle, end, 0xffffff, 0.9, 0.06);
    g.effects.burst(end, { count: 3, colors: [def.beamColor, 0xffffff], speed: 2.5, size: 0.22, life: 0.35, grav: 0, glow: true, drag: 2 });
    if (def.element === 'ice' && hit && Math.random() < 0.3) g.effects.chunks('shards', end, { count: 2, colors: [0x9fe8ff, 0xffffff], bright: 1.4, speed: 3, size: 0.08, life: 0.5, grav: 10, floor: end.y - 1 });
    if (hit) this.applyHit(ch, w, hit, w.dmg, dir, { quiet: true });
  }

  // what kind of surface a ray hit, for impact effects + sounds
  surfaceOf(hit, p) {
    const o = hit.owner;
    if (!o) return { surf: 'stone' };
    if (o.kind === 'terrain') {
      const t = this.game.world.terrain;
      const ny = hit.normal ? hit.normal.y : 1;
      t.colorAt(p.x, p.y, p.z, ny, _col);
      const surf = p.y < 1.2 ? 'sand' : _col.r + _col.g + _col.b > 2.6 ? 'snow' : 'dirt';
      return { surf, color: _col.getHex() };
    }
    if (o.kind === 'build') return { surf: 'build-' + o.piece.mat };
    if (o.kind === 'harvest') return { surf: o.mat === 'brick' ? 'stone' : o.mat || 'wood' };
    if (o.kind === 'prop' || o.kind === 'vehicle') return { surf: 'metal' };
    if (o.kind === 'chest' || o.kind === 'ammo') return { surf: 'wood' };
    return { surf: 'stone' };
  }

  applyHit(ch, w, hit, dmg, dir, { quiet = false } = {}) {
    const g = this.game, o = hit.owner;
    const p = v3(hit.point);
    const def = w.def;
    if (w.perks.includes('lucky') && Math.random() < 0.1) dmg *= 2;
    if (o && o.kind === 'char') {
      const t = o.char;
      const head = p.y > t.pos.y + (t.crouching ? 1.05 : 1.42) * t.scale;
      const amount = dmg * (head ? w.hs : 1);
      this.damage(t, amount, { source: ch, weapon: w, headshot: head, point: p, dir });
      if (w.element) this.applyElement(t, w.element, ch, p, amount);
      if (def.knockback) t.vel.addScaledVector(dir, def.knockback).setY(Math.max(t.vel.y, 5));
      if (def.bubbleTrap && Math.random() < 0.25) { t.status.bubble = 1.6; g.effects.burst(p, { count: 12, colors: [0xaee8ff, 0xffffff], speed: 2, size: 0.4, life: 0.6, grav: -2, glow: true }); }
    } else this.hitWorld(ch, w, hit, p, dmg, quiet);
    if (w.perks.includes('explosive')) this.explode(p, 2.2, dmg * 0.35, ch, { buildDmg: 30, small: true });
  }

  hitWorld(ch, w, hit, p, dmg, quiet) {
    const g = this.game, o = hit.owner, def = w.def;
    const cd = g.effects.camDist(p), near = cd < 60;
    if (cd > 170) quiet = true; // too far to see: skip the particles
    if (o && o.kind === 'build') {
      g.building.damagePiece(o.piece, dmg * (def.buildMult || 1), ch);
      if (!quiet) g.effects.impact(p, hit.normal, 'build-' + o.piece.mat, { near, heavy: def.pellets > 1 ? 0.5 : 1 });
      if (!quiet || cd < 60) audio.play(o.piece.mat === 'metal' ? 'hitMetal' : o.piece.mat === 'brick' ? 'hitStone' : 'hitWood', { pos: p, range: 40, vol: def.pellets > 1 ? 0.15 : 0.35 });
      if (w.element) this.applyElementWorld(w.element, p, ch, dmg);
    } else {
      if (o && o.kind === 'vehicle' && g.vehicles) g.vehicles.hit(o.vehicle, dmg * (def.buildMult || 1), ch, p);
      const s = this.surfaceOf(hit, p);
      if (def.paint) g.effects.splat(p, v3(hit.normal || UP), PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)]);
      else if (!quiet) g.effects.impact(p, hit.normal, s.surf, { color: s.color, near, heavy: def.pellets > 1 ? 0.45 : def.cls === 'Sniper' ? 2 : 1 });
      if (!quiet && ch.isPlayer && near && Math.random() < (def.pellets > 1 ? 0.15 : 0.5)) audio.play(s.surf === 'metal' ? 'hitMetal' : s.surf === 'wood' ? 'hitWood' : 'hitStone', { pos: p, range: 30, vol: 0.12, rate: rand(1.1, 1.4) });
      if (w.element) this.applyElementWorld(w.element, p, ch, dmg);
    }
  }

  // ---------- melee ----------
  melee(ch, w, aim) {
    const g = this.game, def = w.def;
    ch.swingT = 0.3;
    ch.playOnce('Sword_Slash');
    audio.gun(def.sound || 'bat', ch.pos, ch.isPlayer);
    const reach = def.reach || 2.5;
    const start = this.aimStart(ch, aim, new THREE.Vector3());
    const hit = this.ray(start, aim.dir, reach + 0.6, ch);
    // characters: crosshair first, then a forgiving cone in front of us
    const fwd = aim.dir.clone(); fwd.y *= 0.5; fwd.normalize();
    let hitChar = hit && hit.owner && hit.owner.kind === 'char' ? hit.owner.char : null;
    if (!hitChar) {
      let best = hit ? hit.dist + 0.3 : Infinity;
      const cc = ch.center;
      for (const t of g.chars) {
        if (t === ch || !t.alive) continue;
        tmp.copy(t.center).sub(cc);
        const d = tmp.length();
        if (d > reach + 0.6 || d > best) continue;
        if (tmp.normalize().dot(fwd) < 0.55) continue;
        best = d; hitChar = t;
      }
    }
    if (def.lunge && hitChar) ch.vel.addScaledVector(fwd, def.lunge);
    if (hitChar) {
      const pt = hit && hit.owner && hit.owner.char === hitChar ? v3(hit.point) : hitChar.center;
      this.damage(hitChar, w.dmg, { source: ch, weapon: w, headshot: false, point: pt, dir: fwd });
      if (w.element) this.applyElement(hitChar, w.element, ch, pt, w.dmg);
      if (def.knockback) { hitChar.vel.addScaledVector(fwd, def.knockback); hitChar.vel.y = 8; g.effects.ring(pt, 2.2, 0xffffff, 0.25, fwd.clone().negate()); }
      g.effects.burst(pt, { count: 10, colors: [0xffffff, 0xffd34d], speed: 6, size: 0.12, life: 0.25, grav: 4, glow: true, dir: fwd });
      audio.play('hitHeavy', { pos: hitChar.pos, vol: 0.8 });
      return;
    }
    if (!hit) return;
    const p = v3(hit.point);
    const n = v3(hit.normal || UP);
    if (hit.owner && hit.owner.kind === 'harvest' && hit.owner.harvest && def.harvest) {
      const hv = hit.owner.harvest;
      // weak point: hit the blue circle for double damage
      const wp = this.weak;
      const crit = !!(wp && wp.hv === hv && wp.pos.distanceTo(p) < 0.75);
      const r = g.world.damageHarvestable(hv, def.harvest * (crit ? 2 : 1));
      const mat = hv.def.mat;
      const gain = r < 0 ? 22 : crit ? 14 : 8;
      ch.inv.mats[mat] = Math.min(999, ch.inv.mats[mat] + gain);
      g.effects.impact(p, n, mat === 'brick' ? 'stone' : mat, { hole: false, heavy: 1.6 });
      audio.play(mat === 'metal' ? 'hitMetal' : mat === 'brick' ? 'hitStone' : 'hitWood', { pos: p, vol: 0.8 });
      if (crit) {
        g.effects.burst(p, { count: 18, colors: [0x3ad0ff, 0xffffff], speed: 6, size: 0.14, life: 0.35, grav: 2, glow: true, drag: 3, dir: n });
        g.effects.ring(p, 1.4, 0x3ad0ff, 0.25, n);
        audio.play('ding', { pos: p, vol: 0.35, rate: 1.7 });
        g.events.emit('weakpoint', ch, hv);
      }
      g.events.emit('harvest', ch, mat, gain, p);
      if (r < 0) {
        g.effects.dust(p, 0xbba57a, 20);
        g.effects.chunks('debris', p, { count: 14, colors: mat === 'wood' ? [0x9b6a3f, 0x6a4a2a, 0x3f7a2a] : [0x8a8580, 0x6a6560], speed: 6, size: 0.22, life: 2.2, up: 1, floor: ch.pos.y });
        g.events.emit('propDestroyed', ch, hv);
        if (this.weak && this.weak.hv === hv) this.weak = null;
      } else if (ch.isPlayer) this.moveWeakPoint(hv, p, n, crit || !wp || wp.hv !== hv, hit.collider);
    } else if (hit.owner && hit.owner.kind === 'build') {
      g.building.damagePiece(hit.owner.piece, def.harvest ? 50 : w.dmg * 2, ch);
      g.effects.impact(p, n, 'build-' + hit.owner.piece.mat, { hole: false, heavy: 1.5 });
      audio.play(hit.owner.piece.mat === 'metal' ? 'hitMetal' : hit.owner.piece.mat === 'brick' ? 'hitStone' : 'hitWood', { pos: p, vol: 0.7 });
    } else {
      if (hit.owner && hit.owner.kind === 'vehicle' && g.vehicles) g.vehicles.hit(hit.owner.vehicle, w.dmg * 2, ch, p);
      const s = this.surfaceOf(hit, p);
      g.effects.impact(p, n, s.surf, { color: s.color, hole: false, heavy: 1.2 });
      g.effects.sparks(p, n);
      audio.play('hitStone', { pos: p, vol: 0.5 });
    }
  }

  // pick a new weak point on the same object, a short step from the last hit
  moveWeakPoint(hv, p, n, move, collider) {
    if (!move && this.weak) { this.weak.t = 6; return; }
    const tan = _a.crossVectors(n, Math.abs(n.y) > 0.9 ? _b.set(1, 0, 0) : UP).normalize();
    const bit = _b.crossVectors(n, tan).normalize();
    for (let k = 0; k < 6; k++) {
      const ang = Math.random() * Math.PI * 2, r = rand(0.5, 1.1);
      const cand = _c.copy(p).addScaledVector(tan, Math.cos(ang) * r).addScaledVector(bit, Math.sin(ang) * r);
      if (cand.y < hv.y + 0.3) continue;
      const from = cand.clone().addScaledVector(n, 1.2);
      const h = this.game.physics.raycast(from, n.clone().negate(), 2.5, null);
      if (h && h.collider === collider) { this.weak = { hv, pos: v3(h.point), normal: v3(h.normal || n), t: 6 }; return; }
    }
    this.weak = { hv, pos: p.clone(), normal: n.clone(), t: 6 };
  }

  updateWeakMarker(dt) {
    const wm = this.weakMarker, wp = this.weak, pl = this.game.player;
    if (wp) wp.t -= dt;
    if (!wp || wp.t <= 0 || !wp.hv.alive || !pl || !pl.alive || pl.pos.distanceTo(wp.pos) > 8) { wm.visible = false; if (wp && (wp.t <= 0 || !wp.hv.alive)) this.weak = null; return; }
    wm.visible = true;
    wm.position.copy(wp.pos).addScaledVector(wp.normal, 0.06);
    wm.quaternion.setFromUnitVectors(_a.set(0, 0, 1), wp.normal);
    wm.scale.setScalar(1 + Math.sin(this.game.time * 9) * 0.12);
  }

  // ---------- throwables ----------
  throwItem(ch, w, aim) {
    audio.gun('throw', ch.pos, ch.isPlayer);
    ch.playOnce('Punch_Right');
    const dir = aim.dir.clone(); dir.y += 0.18; dir.normalize();
    this.spawnProjectile(ch, w, ch.head.addScaledVector(dir, 0.6), dir, 1);
    w.count--;
    if (w.count <= 0) {
      const i = ch.inv.slots.indexOf(w);
      if (i >= 0) ch.inv.slots[i] = null;
      this.game.events.emit('inventory', ch);
    }
  }

  // ---------- projectiles ----------
  spawnProjectile(ch, w, pos, dir, charge = 1) {
    const def = w.def, pd = def.proj, S = this.shared;
    const mesh = projectileModel(pd.model || 'grenade');
    if (pd.model === 'paint') { mesh.material.color.set(PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)]); mesh.material.emissive = mesh.material.color.clone().multiplyScalar(0.25); }
    let fx = null;
    if (pd.model === 'rocket') { fx = new THREE.Mesh(S.flameGeo, S.flame); fx.userData.shared = true; mesh.add(fx); }
    else if (pd.model === 'grenade' || (pd.fuse && pd.model !== 'chicken' && pd.model !== 'blackhole')) { fx = new THREE.Mesh(S.blinkGeo, S.blink); fx.userData.shared = true; fx.position.y = pd.model === 'grenade' ? 0.12 : pd.size || 0.2; mesh.add(fx); }
    if (ch.scale > 1) mesh.scale.setScalar(ch.scale * 0.7);
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const p = {
      ch, w, def, pd, mesh, fx, pos: pos.clone(), last: pos.clone(), vel: dir.clone().multiplyScalar(pd.speed * (0.4 + 0.6 * charge)),
      age: 0, bounces: 0, charge, returning: false, hitSet: new Set(), dmgMul: charge, spinAxis: new THREE.Vector3(),
    };
    if (pd.model === 'rocket') this.game.effects.burst(pos, { count: 10, colors: [0xdddddd, 0xbbbbbb], speed: 3, size: 0.6, life: 1, grav: -0.5, drag: 3, grow: 1.5, dir: dir.clone().multiplyScalar(-0.6) });
    this.projectiles.push(p);
  }

  projectileFx(p, dt) {
    const e = this.game.effects, pd = p.pd, pos = p.pos, m = pd.model;
    const far = e.camDist(pos) > 160;
    if (m === 'rocket' || pd.smoke) {
      if (!far) {
        _a.copy(p.vel).normalize();
        const tail = _b.copy(pos).addScaledVector(_a, -0.45);
        e.burst(tail, { count: 2, colors: [0xd8d8d8, 0xbfbfbf], end: 0x9a9a9a, speed: 0.6, size: 0.45, life: 1.3, grav: -0.6, drag: 1.5, grow: 1.6 });
        e.burst(tail, { count: 2, colors: [0xffe08a, 0xff8a2a], end: 0x401004, speed: 1.5, size: 0.35, life: 0.18, grav: 0, glow: true, dir: _a.multiplyScalar(-1.5) });
      }
      if (p.fx) p.fx.scale.set(1, 1, rand(0.7, 1.4));
    }
    if (pd.tracer) e.trail(p.last, pos, pd.tracer === true ? 0xffffff : pd.tracer, m === 'arrow' ? 0.8 : 1.3, 0.22);
    if (p.fx && m !== 'rocket' && pd.fuse) { // fuse blink speeds up
      const k = p.age / pd.fuse;
      p.fx.visible = Math.sin(p.age * (8 + k * k * 50)) > 0;
    }
    if (m === 'grenade' && !far && Math.random() < 0.5) e.burst(pos, { count: 1, color: 0xcccccc, speed: 0.2, size: 0.18, life: 0.4, grav: -0.3, grow: 0.4 });
    if (m === 'bubble') { const s = 1 + Math.sin(p.age * 18) * 0.08; p.mesh.scale.set(s, 2 - s, s); }
    if (m === 'paint' && Math.random() < 0.4) e.burst(pos, { count: 1, color: p.mesh.material.color, speed: 0.3, size: 0.1, life: 0.4, grav: 12 });
    if (m === 'chicken' && Math.random() < 0.15) e.burst(pos, { count: 1, color: 0xffffff, speed: 1, size: 0.18, life: 1.2, grav: 1, drag: 2 });
    if (m === 'boomerang' && !far) e.burst(pos, { count: 1, colors: [0xffd34d, 0xff9a3a], speed: 0.2, size: 0.3, life: 0.25, grav: 0, glow: true });
    if (m === 'blackhole') e.burst(pos, { count: 1, colors: [0xb45cff, 0x5a1aff], speed: 0.5, size: 0.25, life: 0.4, grav: 0, glow: true });
  }

  updateProjectiles(dt) {
    const g = this.game;
    if (!g.effects.cam && g.cameraRig) g.effects.cam = g.cameraRig.cam;
    if (!g.effects.groundY && g.world) g.effects.groundY = (x, z) => g.world.groundY(x, z);
    if (this.lastMatch !== g.match) { this.lastMatch = g.match; this.reset(); }
    this.updateTimers(dt);
    this.updateDissolves(dt);
    this.updateWeakMarker(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      const pd = p.pd;
      p.last.copy(p.pos);
      if (pd.returnAfter && !p.returning && p.age > pd.returnAfter) p.returning = true;
      if (p.returning) {
        const to = p.ch.center.sub(p.pos);
        if (to.length() < 1.2 || p.age > 4 || !p.ch.alive) { this.removeProjectile(i); continue; }
        p.vel.lerp(to.normalize().multiplyScalar(pd.speed), Math.min(1, dt * 6));
      } else p.vel.y -= (pd.gravity || 0) * dt;
      const step = _n.copy(p.vel).multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const hit = len > 0 ? this.ray(p.pos, dir, len + (pd.size || 0.1), p.ch) : null;
      if (hit) {
        const hp = v3(hit.point);
        const isChar = hit.owner && hit.owner.kind === 'char';
        if (pd.pierce) {
          // boomerang: hits everyone once, passes through
          if (isChar && !p.hitSet.has(hit.owner.char)) {
            p.hitSet.add(hit.owner.char);
            this.applyHit(p.ch, p.w, hit, p.w.dmg, dir);
          } else if (!isChar) { p.returning = true; p.vel.multiplyScalar(-0.5); g.effects.sparks(hp, hit.normal, 0xffd34d); audio.play('hitWood', { pos: hp, vol: 0.4, rate: 1.4 }); }
          p.pos.add(step);
        } else if (pd.bounce && !(isChar && pd.explodeOnHit) && !(pd.bouncesToExplode && p.bounces >= pd.bouncesToExplode - 1 && !isChar) && !isChar) {
          const n = v3(hit.normal);
          p.pos.copy(hp).addScaledVector(n, (pd.size || 0.1) + 0.02);
          const vin = p.vel.length();
          p.vel.reflect(n).multiplyScalar(pd.bounce);
          p.bounces++;
          if (vin > 3) {
            if (pd.model === 'basketball' || pd.model === 'soccer') audio.play('hitBody', { pos: p.pos, vol: 0.6, rate: 1.4 });
            else audio.play('hitMetal', { pos: p.pos, vol: 0.18, rate: 1.6 });
            g.effects.dust(hp, 0xd8c8a8, 3);
          }
          if (pd.bouncesToExplode && p.bounces >= pd.bouncesToExplode) { this.detonate(p, p.pos.clone()); this.removeProjectile(i); continue; }
          if (p.vel.length() < 1.5) p.vel.set(0, 0, 0);
        } else {
          if (p.w.def.splash) this.detonate(p, hp.addScaledVector(dir, -0.2));
          else {
            this.applyHit(p.ch, p.w, hit, p.w.dmg * p.dmgMul, dir);
            if (pd.model === 'paint') { g.effects.paint(hp, p.mesh.material.color); if (hit.normal) g.effects.splat(hp, v3(hit.normal), p.mesh.material.color.getHex(), 1.1); }
            if (pd.model === 'bubble') { audio.play('glass', { pos: hp, vol: 0.4 }); g.effects.burst(hp, { count: 12, colors: [0xaee8ff, 0xffffff], speed: 3, size: 0.12, life: 0.4, grav: 2, glow: true }); g.effects.ring(hp, 1, 0xaee8ff, 0.25, hit.normal ? v3(hit.normal) : null); }
            if (pd.model === 'arrow' && !isChar) { this.projectiles.splice(i, 1); this.stickArrow(p, hp, dir); continue; }
          }
          this.removeProjectile(i);
          continue;
        }
      } else p.pos.add(step);
      p.mesh.position.copy(p.pos);
      if (p.vel.lengthSq() > 0.01) {
        const m = pd.model;
        if (m === 'boomerang' || m === 'blackhole') p.mesh.rotation.y += dt * 22;
        else if (m === 'basketball' || m === 'soccer' || m === 'golf' || m === 'grenade') {
          p.spinAxis.crossVectors(UP, p.vel).normalize();
          if (p.spinAxis.lengthSq() > 0.5) p.mesh.rotateOnWorldAxis(p.spinAxis, (p.vel.length() / Math.max(0.1, pd.size || 0.2)) * dt * 0.5);
        } else if (m === 'chicken') { p.mesh.lookAt(_a.copy(p.pos).sub(p.vel)); p.mesh.rotateZ(Math.sin(p.age * 25) * 0.4); }
        else if (m !== 'bubble' && m !== 'paint') p.mesh.lookAt(_a.copy(p.pos).sub(p.vel)); // models point -Z forward
      }
      this.projectileFx(p, dt);
      if (pd.fuse && p.age > pd.fuse) { this.detonate(p, p.pos.clone()); this.removeProjectile(i); continue; }
      if (p.age > 8 || p.pos.y < -20) this.removeProjectile(i);
    }
    // black hole pull zones etc.
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t -= dt;
      z.update && z.update(dt, z);
      if (z.t <= 0) { z.end && z.end(z); if (z.mesh) this.disposeMesh(z.mesh); this.zones.splice(i, 1); }
    }
  }

  updateTimers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t > 0) continue;
      this.timers.splice(i, 1);
      if (t.match === this.game.match) t.fn();
    }
  }

  stickArrow(p, hp, dir) {
    // tip buried a little into the surface (tip is 0.45 in front of the center)
    p.mesh.position.copy(hp).addScaledVector(dir, 0.12 - 0.45);
    p.mesh.lookAt(_a.copy(p.mesh.position).sub(dir));
    this.game.effects.burst(hp, { count: 5, color: 0xc8a070, speed: 2, size: 0.12, life: 0.4, grav: 8 });
    audio.play('hitWood', { pos: hp, vol: 0.4, rate: 1.5 });
    this.stuckArrows.push(p.mesh);
    if (this.stuckArrows.length > 24) this.disposeMesh(this.stuckArrows.shift());
    const m = p.mesh;
    this.later(8, () => { const i = this.stuckArrows.indexOf(m); if (i >= 0) { this.stuckArrows.splice(i, 1); this.disposeMesh(m); } });
  }

  disposeMesh(m) {
    m.removeFromParent();
    m.traverse((o) => {
      if (!o.isMesh || o.userData.shared) return;
      o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    });
  }

  removeProjectile(i) {
    const p = this.projectiles[i];
    this.disposeMesh(p.mesh);
    this.projectiles.splice(i, 1);
  }

  detonate(p, pos) {
    const def = p.w.def;
    if (def.pull) return this.blackHole(pos, p);
    if (p.pd.model === 'chicken') { this.game.effects.feathers(pos); audio.gun('chicken', pos); }
    if (p.pd.model === 'basketball') this.game.effects.confetti(pos, 30);
    this.explode(pos, def.splash || 4, p.w.dmg, p.ch, { buildDmg: def.buildDmg || 150, element: p.w.element || def.element, weapon: p.w });
  }

  blackHole(pos, p) {
    const g = this.game;
    const mesh = projectileModel('blackhole'); mesh.scale.setScalar(4); mesh.position.copy(pos); g.scene.add(mesh);
    audio.play('forceField', { pos, vol: 1, rate: 0.5 });
    g.effects.shock(pos, 8, 0xb45cff, 0.4);
    const sw = new THREE.Vector3();
    this.zones.push({
      t: 2.2, mesh,
      update: (dt, z) => {
        mesh.rotation.y += dt * 8; mesh.scale.setScalar(4 + Math.sin(z.t * 20) * 0.4);
        // swirl: particles spawn on a ring and spiral inward
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * Math.PI * 2, r = rand(4, 8);
          sw.set(pos.x + Math.cos(a) * r, pos.y + rand(-1.5, 2.5), pos.z + Math.sin(a) * r);
          g.effects.glow.spawn(sw.x, sw.y, sw.z, (-Math.cos(a) * 1.2 - Math.sin(a) * 2) * r, (pos.y - sw.y) * 2, (-Math.sin(a) * 1.2 + Math.cos(a) * 2) * r,
            _col.set(0xd08cff), BH_END, 0.3, 0.45, 0, 2.5, -0.3);
        }
        for (const c of g.chars) {
          if (!c.alive) continue;
          const d = c.center.sub(pos); const l = d.length();
          if (l < 12) c.vel.addScaledVector(d.normalize(), -26 * dt * (1 - l / 12) * 3);
        }
      },
      end: () => this.explode(pos, p.w.def.splash, p.w.dmg, p.ch, { buildDmg: p.w.def.buildDmg, weapon: p.w, element: null, color: 0xb45cff }),
    });
  }

  explode(pos, radius, dmg, source, { buildDmg = 150, element = null, small = false, weapon = null, color = null } = {}) {
    const g = this.game;
    if (small) {
      g.effects.flash(pos, 1.6, 0xffc070, 0.12);
      g.effects.burst(pos, { count: 14, colors: [0xffffff, 0xffd34d, 0xff7a1a], end: 0x401004, speed: 5, size: 0.35, life: 0.35, grav: 0, drag: 4, glow: true });
      g.effects.burst(pos, { count: 4, color: 0x666666, speed: 1.5, size: 0.5, life: 0.8, grav: -1, drag: 2, grow: 1 });
      audio.play('hitHeavy', { pos, vol: 0.6 });
    } else {
      g.effects.explosion(pos, radius, color ?? (element ? ELEMENTS[element].color : 0xff8a2a));
      audio.explosion(pos); g.shake(pos, radius);
    }
    for (const c of g.chars) {
      if (!c.alive) continue;
      const d = c.center.distanceTo(pos);
      if (d > radius) continue;
      // blocked by walls?
      const dir = c.center.sub(pos).normalize();
      const block = g.physics.raycast(pos, dir, d, null, undefined, (col) => { const o = g.physics.owners.get(col.handle); return o && (o.kind === 'build' || o.kind === 'building'); });
      if (block && block.dist < d - 0.5) continue;
      const k = 1 - (d / radius) * 0.6;
      this.damage(c, dmg * k, { source, weapon, headshot: false, point: c.center, dir, explosive: true });
      if (element) this.applyElement(c, element, source, c.center, dmg * k);
      if (!small) { c.vel.addScaledVector(dir, 10 * k); c.vel.y += 6 * k; }
    }
    g.building.damageRadius(pos, radius, buildDmg, source);
    if (g.vehicles) g.vehicles.damageRadius(pos, radius, Math.max(dmg, buildDmg * 0.6), source);
    for (const hv of g.world.harvestables) {
      if (!hv.alive) continue;
      if (Math.hypot(hv.x - pos.x, hv.z - pos.z) < radius && Math.abs(hv.y - pos.y) < radius + hv.size.y) g.world.damageHarvestable(hv, buildDmg * 0.5);
    }
    if (element) this.applyElementWorld(element, pos, source, dmg, radius);
  }

  // ---------- damage ----------
  damage(t, amount, { source = null, weapon = null, headshot = false, point = null, dir = null, kind = null, ignoreShield = false, explosive = false } = {}) {
    const g = this.game;
    if (!t.alive || t.invulnerable) return 0;
    if (g.cheats && t.isPlayer && g.cheats.god) return 0;
    if (t.shieldBubble && t.shieldBubble.alive && source && !explosive) {
      const sb = t.shieldBubble;
      if (source.center.distanceTo(sb.pos) > sb.r) { sb.hp -= amount; sb.hitT = 1; if (point) sb.hitPos = point.clone(); g.effects.shieldHit(point || t.center); return 0; }
    }
    // bot-vs-bot fights are softer so matches last ~8-10 minutes (the player still takes full damage)
    if (source && source.brain && t.brain && !t.isBoss && !source.isBoss) amount *= 0.3;
    // difficulty: bots hit the player softer on easy/normal
    if (source && source.brain && t.isPlayer) amount *= g.botDamageMul ?? 1;
    amount = Math.max(1, Math.round(amount));
    const hadShield = !ignoreShield && t.shield > 0;
    let shieldDmg = 0, healthDmg = 0;
    let left = amount;
    if (t.overshield > 0 && !ignoreShield) { const k = Math.min(t.overshield, left); t.overshield -= k; left -= k; shieldDmg += k; }
    if (t.shield > 0 && !ignoreShield) { const k = Math.min(t.shield, left); t.shield -= k; left -= k; shieldDmg += k; }
    healthDmg = Math.min(t.health, left);
    t.health -= healthDmg;
    t.flashT = 0.12;
    t.lastHitTime = g.time;
    if (source && source !== t) { t.lastDamagedBy = source; source.damageDealt += amount; }
    const p = point || t.center;
    const shieldBreak = hadShield && t.shield <= 0;
    if (healthDmg > 0) { if (g.settings.blood) g.effects.blood(p, dir); else g.effects.hitSpark(p, false, headshot); }
    else if (shieldDmg > 0) { g.effects.shieldHit(p); if (headshot) g.effects.hitSpark(p, true, true); }
    if (shieldBreak) {
      g.effects.shieldBreak(t.center);
      audio.play('glass', { pos: t.center, range: 50, vol: 0.7, rate: 1.2 });
      g.events.emit('shieldBreak', t, source);
    }
    audio.play(shieldDmg > healthDmg ? 'hitShieldWorld' : 'hitBody', { pos: p, range: 50, vol: 0.5 });
    if (source && weapon && weapon.perks && weapon.perks.includes('vampire') && source.alive) source.health = Math.min(source.maxHealth, source.health + amount * 0.15);
    g.events.emit('damage', { target: t, source, amount, headshot, shieldDmg, healthDmg, point: p, weapon, shieldBreak });
    if (t.health <= 0) this.kill(t, source, weapon, headshot, kind);
    else if (healthDmg > 15 && Math.random() < 0.5 && t.state === 'ground') t.playOnce(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2');
    return amount;
  }

  heal(t, hp = 0, sh = 0, maxHp = 100, maxSh = 100) {
    if (hp) t.health = Math.min(Math.max(t.health, maxHp), Math.min(maxHp, t.health + hp)) > t.health ? Math.min(maxHp, t.health + hp) : t.health;
    if (sh) t.shield = Math.min(maxSh, t.shield + sh) > t.shield ? Math.min(maxSh, t.shield + sh) : t.shield;
  }

  kill(t, source, weapon, headshot, kind) {
    const g = this.game;
    t.alive = false;
    t.health = 0;
    t.vel.set(0, 0, 0);
    t.playOnce('Death');
    t.anim.onceUntil = Infinity;
    t.collider.setEnabled(false);
    t.slideT = 0; t.emoting = false;
    const killer = source && source !== t ? source : t.lastDamagedBy && t.lastDamagedBy !== t && g.time - t.lastHitTime < 10 ? t.lastDamagedBy : null;
    if (killer) { killer.kills++; killer.streak++; }
    g.events.emit('elim', { victim: t, killer, weapon, headshot, kind });
    g.loot.dropInventory(t);
    if (t.heldObj) t.heldObj.visible = false;
    // knock-out pop, then the body digitizes and beams up (Fortnite style)
    g.effects.burst(t.center, { count: 18, colors: [0xffffff, ELIM_COLOR], speed: 6, size: 0.16, life: 0.4, grav: 3, glow: true, drag: 3 });
    if (g.settings.blood && g.world) {
      const gy = g.world.groundY(t.pos.x, t.pos.z);
      if (Math.abs(gy - t.pos.y) < 0.6) g.effects.decal(new THREE.Vector3(t.pos.x, gy + 0.03, t.pos.z), UP, { kind: 'splat', color: 0x8a0012, r: 1.4, life: 15 });
    }
    this.dissolves.push({ ch: t, t: 0, started: false, match: g.match, scale0: t.scale, mats: null });
  }

  updateDissolves(dt) {
    const g = this.game;
    for (let i = this.dissolves.length - 1; i >= 0; i--) {
      const d = this.dissolves[i], t = d.ch;
      d.t += dt;
      const gone = d.match !== g.match || !g.chars.includes(t) || t.alive;
      if (!gone && d.t < 0.9) continue;
      if (!gone && !d.started) {
        d.started = true;
        d.mats = t.materials.filter((m) => m.emissive).map((m) => [m, m.emissive.clone()]);
        g.effects.elimBeam(t.center, ELIM_COLOR);
        audio.play('phaser', { pos: t.pos, range: 60, vol: 0.5, rate: 1.4 });
      }
      const k = Math.min(1, (d.t - 0.9) / 1.0);
      if (!gone && k < 1) {
        _col.set(ELIM_COLOR).multiplyScalar(2.5 * k);
        for (const [m, base] of d.mats) m.emissive.copy(base).lerp(_col, Math.min(1, k * 1.5));
        t.pos.y += dt * 2.2 * k;
        t.scale = d.scale0 * (1 - 0.35 * k * k);
        if (Math.random() < 0.7) g.effects.chunks('cubes', _a.set(t.pos.x + rand(-0.4, 0.4), t.pos.y + rand(0.2, 1.6) * t.scale, t.pos.z + rand(-0.4, 0.4)), { count: 2, colors: [ELIM_COLOR, 0xffffff], bright: 1.8, speed: 1, size: 0.09, life: 1, up: 2, grav: -4, bounce: 0, spin: 5, drag: 1 });
        continue;
      }
      // done (or interrupted): hide and restore
      if (d.mats) for (const [m, base] of d.mats) m.emissive.copy(base);
      t.scale = d.scale0;
      if (!t.alive && g.chars.includes(t)) { t.setVisible(false); if (d.started) g.effects.burst(t.center, { count: 20, colors: [ELIM_COLOR, 0xffffff], speed: 4, size: 0.2, life: 0.5, grav: -2, glow: true }); }
      this.dissolves.splice(i, 1);
    }
  }

  // ---------- elements ----------
  applyElement(t, el, src, p, dmg) {
    const st = t.status;
    this.game.effects.elementHit(p, el);
    if (el === 'fire') { st.burn = 3; st.burnSrc = src; }
    if (el === 'ice') { st.slow = Math.min(4, st.slow + 1); st.slowT = 2.5; if (st.slow >= 4 && st.frozen <= 0) { st.frozen = 1.2; st.slow = 0; this.game.events.emit('frozen', t); this.game.effects.chunks('shards', t.center, { count: 12, colors: [0x9fe8ff, 0xffffff], bright: 1.5, speed: 3, size: 0.15, life: 0.8, grav: 10, floor: t.pos.y }); audio.play('glass', { pos: t.pos, vol: 0.5, rate: 0.8 }); } }
    if (el === 'poison') { st.poison = 4; st.poisonSrc = src; }
    if (el === 'lightning') this.chainLightning(t, src, dmg * 0.5, p);
    if (el === 'explosive') this.explode(p, 2.5, dmg * 0.3, src, { buildDmg: 40, small: true });
  }

  applyElementWorld(el, p, src, dmg, radius = 2.5) {
    if (el === 'poison') this.poisonCloud(p, src, radius);
    else if (el === 'fire') this.game.effects.burst(p, { count: 12, colors: [0xff7a1a, 0xffd34d], end: 0x551100, speed: 2, size: 0.45, life: 0.9, grav: -3, glow: true });
    else if (el === 'explosive') this.explode(p, 2.5, dmg * 0.3, src, { buildDmg: 40, small: true });
    else this.game.effects.elementHit(p, el);
  }

  chainLightning(from, src, dmg, p) {
    const g = this.game;
    let count = 0;
    const fc = from.center;
    for (const c of g.chars) {
      if (c === from || c === src || !c.alive || count >= 2) continue;
      const cc = c.center;
      if (cc.distanceTo(fc) < 9) {
        g.effects.bolt(fc, cc, 0xfff35a, 0.45, 2, 0.18);
        g.effects.light(cc, 0xfff35a, 4, 0.12, 10);
        this.damage(c, dmg, { source: src, point: cc });
        count++;
      }
    }
    void p;
  }

  poisonCloud(p, src, radius = 3) {
    const g = this.game;
    const at = p.clone();
    this.zones.push({ t: 4, acc: 0, pacc: 0, update: (dt, z) => {
      z.acc += dt; z.pacc += dt;
      if (z.pacc > 0.08) { // rolling green gas
        z.pacc = 0;
        g.effects.burst(_a.set(at.x + rand(-radius, radius) * 0.7, at.y + rand(-0.3, 0.8), at.z + rand(-radius, radius) * 0.7), { count: 1, colors: [0x7dff5a, 0x4acb3a, 0x9aff7a], end: 0x2a6a1a, speed: 0.4, size: radius * 0.7, life: 1.4 * Math.min(1, z.t), grav: -0.3, drag: 1, grow: 0.6 });
      }
      if (z.acc > 0.5) {
        z.acc = 0;
        for (const c of g.chars) if (c.alive && c.center.distanceTo(at) < radius) this.damage(c, 4, { source: src, ignoreShield: true, point: c.center });
        g.effects.burst(at, { count: 3, color: 0xb0ff8a, speed: 1, size: 0.12, life: 1, grav: -1.5, glow: true, jitter: radius * 0.5 });
      }
    } });
  }

  updateStatus(c, dt) {
    const st = c.status;
    st.acc = (st.acc || 0) + dt;
    const tick = st.acc >= 0.5;
    if (tick) st.acc = 0;
    if (st.burn > 0) { st.burn -= dt; if (tick) this.damage(c, 4, { source: st.burnSrc, point: c.center }); if (Math.random() < 0.5) this.game.effects.burst(c.center, { count: 1, colors: [0xff7a1a, 0xffd34d], end: 0x551100, speed: 1, size: 0.35, life: 0.5, grav: -4, glow: true, jitter: 0.35 }); }
    if (st.poison > 0) { st.poison -= dt; if (tick) this.damage(c, 3, { source: st.poisonSrc, point: c.center, ignoreShield: true }); if (Math.random() < 0.25) this.game.effects.burst(c.head, { count: 1, color: 0x7dff5a, speed: 0.5, size: 0.25, life: 0.7, grav: -1, jitter: 0.3 }); }
    if (st.slowT > 0) { st.slowT -= dt; if (st.slowT <= 0) st.slow = 0; if (Math.random() < 0.15) this.game.effects.burst(c.center, { count: 1, color: 0xbff0ff, speed: 0.3, size: 0.12, life: 0.6, grav: 1, glow: true, jitter: 0.4 }); }
    if (st.frozen > 0) { st.frozen -= dt; for (const m of c.materials) m.emissive.setRGB(0.2, 0.4, 0.6); if (st.frozen <= 0) for (const m of c.materials) m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0)); }
    if (st.bubble > 0) { st.bubble -= dt; c.vel.y = 1.2; }
    if (st.speedBoost > 0) st.speedBoost -= dt;
    if (st.invisible > 0) st.invisible -= dt;
  }

  // drop everything when a new match starts
  reset() {
    for (const m of this.stuckArrows) this.disposeMesh(m);
    this.stuckArrows = []; this.timers = []; this.dissolves = []; this.weak = null; this.weakMarker.visible = false;
  }
}

export function rarityName(r) { return RARITIES[r].name; }
