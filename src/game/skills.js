import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { rand } from '../engine/utils.js';
import { makeWeapon } from './items.js';
import { projectileModel } from './models.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

// energy shell (shield bubble): fresnel rim + hex-ish grid + hit ripples
const BUBBLE_VS = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const BUBBLE_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uHit; uniform vec3 uHitPos; uniform float uR;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
    vec3 q = vP / uR * 7.0;
    float h = max(max(abs(sin(q.x + q.y * 0.5)), abs(sin(q.y - q.z * 0.5))), abs(sin(q.z + q.x * 0.5)));
    float grid = smoothstep(0.985, 1.0, h) * (0.5 + 0.5 * sin(uTime * 3.0 + vP.y * 2.0));
    float d = distance(vP, uHitPos) / uR;
    float ripple = smoothstep(0.12, 0.0, abs(d - (1.0 - uHit) * 1.2)) * uHit;
    float scan = smoothstep(0.04, 0.0, abs(fract(vP.y / uR * 0.5 - uTime * 0.35) - 0.5)) * 0.25;
    float a = (0.06 + f * 0.75 + grid * 0.35 + ripple * 1.5 + scan) * uAlpha;
    gl_FragColor = vec4(uColor * (1.0 + ripple * 2.0 + f) * a, a);
  }`;
// healing zone floor: soft fill + rings rolling outward
const HEAL_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
  void main(){ float r = length(vUv - 0.5) * 2.0; if (r > 1.0) discard;
    float rings = smoothstep(0.08, 0.0, abs(fract(r * 2.5 - uTime * 0.8) - 0.5) - 0.38);
    float edge = smoothstep(0.88, 0.97, r) * smoothstep(1.0, 0.97, r);
    float a = (0.12 + rings * 0.35 * (1.0 - r * 0.5) + edge * 1.2) * uAlpha;
    gl_FragColor = vec4(uColor * (1.0 + edge) * a, a); }`;
const WALL_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
  void main(){ float a = pow(1.0 - vUv.y, 2.0) * (0.55 + 0.25 * sin(vUv.x * 60.0 + uTime * 4.0)) * uAlpha;
    gl_FragColor = vec4(uColor * a, a); }`;
const UV_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const addMat = (vs, fs, color) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uHit: { value: 0 }, uHitPos: { value: new THREE.Vector3() }, uR: { value: 1 } } });
const elastic = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -9 * k) * Math.cos(k * 14));

function disposeTree(o) {
  o.removeFromParent();
  o.traverse((m) => { if (m.isMesh && !m.userData.shared) { m.geometry.dispose(); m.material.dispose(); } });
}

// Active skills (found as loot) and kill-streak ultimates.
export class Skills {
  constructor(game) {
    this.game = game;
    this.objects = []; // turrets, decoys, healing zones, bubbles, short-lived fx
    this.ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.hookGeo = new THREE.ConeGeometry(0.12, 0.3, 8).rotateX(-Math.PI / 2);
    this.jetLightT = 0;
  }

  // a short-lived animated effect driven by update(dt)
  fx(t, update, end = null) { this.objects.push({ kind: 'fx', t, life: t, update, end }); }

  tick(ch, dt) {
    for (const s of ch.inv.skills) if (s && s.cooldownLeft > 0) {
      s.cooldownLeft -= dt;
      if (s.cooldownLeft <= 0 && s.def.charges && s.charges < s.def.charges) { s.charges++; if (s.charges < s.def.charges) s.cooldownLeft = s.def.cooldown; }
    }
  }

  use(ch, slot, aimOrigin, aimDir) {
    const s = ch.inv.skills[slot];
    if (!s || s.def.passive || !ch.alive) return false;
    if (s.id === 'jetpack') return false; // hold-to-fly, handled in movement
    if (s.def.charges) { if (s.charges <= 0) return false; }
    else if (s.cooldownLeft > 0) return false;
    const g = this.game;
    const fwd = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
    switch (s.id) {
      case 'dash': this.dash(ch, fwd.lengthSq() ? fwd : new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw))); break;
      case 'grapple': {
        // start the ray at the player so nothing behind them gets grabbed
        const o = aimOrigin.clone();
        if (ch.isPlayer) o.addScaledVector(aimDir, Math.max(0, ch.head.sub(aimOrigin).dot(aimDir) - 0.3));
        const hit = g.combat.ray(o, aimDir, 70, ch);
        if (!hit) return false;
        this.grapple(ch, v3(hit.point), hit.normal ? v3(hit.normal) : UP.clone());
        break;
      }
      case 'shield': this.spawnBubble(ch); break;
      case 'invisible':
        ch.status.invisible = s.def.duration;
        g.effects.burst(ch.center, { count: 30, colors: [0xb0c8ff, 0xffffff], speed: 3, size: 0.2, life: 0.6, grav: -1, glow: true, jitter: 0.5 });
        g.effects.shock(ch.center, 2.2, 0x9fb8ff, 0.3);
        audio.play('forceField', { pos: ch.pos });
        break;
      case 'heal': this.spawnHealZone(ch); break;
      case 'turret': this.spawnTurret(ch); break;
      case 'airstrike': {
        const hit = g.combat.ray(aimOrigin, aimDir, 300, ch);
        const at = hit ? v3(hit.point) : aimOrigin.clone().addScaledVector(aimDir, 120);
        this.airstrike(ch, at, 6, 4.5, 110);
        break;
      }
      case 'slowmo':
        g.slowmo = { t: s.def.duration, owner: ch };
        g.effects.shock(ch.center, 26, 0xb45cff, 0.7);
        g.effects.ring(ch.pos, 30, 0xb45cff, 0.8);
        audio.play('phaser', { vol: 1, rate: 0.5 });
        break;
      case 'decoy': {
        this.spawnDecoy(ch);
        g.effects.column(ch.pos, 0.8, 4, 0xb45cff, 0.5);
        g.effects.ring(ch.pos, 2.5, 0xb45cff, 0.4);
        break;
      }
      case 'slam':
        if (ch.grounded) return false;
        ch.vel.set(0, -45, 0); ch.slamming = true; ch.noFallDamage = true;
        g.effects.shock(ch.center, 1.8, 0xffb05a, 0.2);
        audio.play('phaser', { pos: ch.pos, vol: 0.7, rate: 0.6 });
        break;
      default: return false;
    }
    if (s.def.charges) { s.charges--; if (s.cooldownLeft <= 0) s.cooldownLeft = s.def.cooldown; }
    else s.cooldownLeft = s.def.cooldown;
    g.events.emit('skill', ch, s);
    return true;
  }

  dash(ch, dir) {
    const g = this.game;
    ch.vel.addScaledVector(dir, 24);
    ch.vel.y = Math.max(ch.vel.y, 2);
    g.effects.ring(ch.center, 2.4, 0x9fe8ff, 0.3, dir.clone().negate());
    g.effects.burst(ch.center, { count: 24, colors: [0x9fe8ff, 0xffffff], speed: 4, size: 0.22, life: 0.4, grav: 0, glow: true, dir: dir.clone().multiplyScalar(-1.2), drag: 3 });
    audio.play('phaser', { pos: ch.pos, vol: 0.8 });
    const last = ch.center;
    this.fx(0.32, () => {
      const c = ch.center;
      // speed lines at shoulder, hip and feet height + sparkle wake
      for (const h of [-0.7, 0, 0.6]) g.effects.trail(_a.set(last.x, last.y + h, last.z), _b.set(c.x, c.y + h, c.z), 0x9fe8ff, h ? 1.4 : 2.6, 0.28);
      g.effects.burst(c, { count: 3, colors: [0x9fe8ff, 0xffffff], speed: 0.8, size: 0.25, life: 0.35, grav: 0, glow: true, jitter: 0.5 });
      last.copy(c);
    });
  }

  grapple(ch, target, normal) {
    const g = this.game;
    const rope = new THREE.Mesh(this.ropeGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f6ff).multiplyScalar(1.6), toneMapped: false }));
    rope.frustumCulled = false;
    const hook = new THREE.Mesh(this.hookGeo, new THREE.MeshStandardMaterial({ color: 0xffb627, metalness: 0.8, roughness: 0.3, emissive: 0x663300 }));
    g.scene.add(rope, hook);
    audio.play('laser', { pos: ch.pos, vol: 0.6, rate: 0.7 });
    const from = new THREE.Vector3(), hp = new THREE.Vector3();
    const flyT = Math.min(0.18, ch.center.distanceTo(target) / 260);
    let age = 0, latched = false;
    const o = { kind: 'fx', t: 1.4, life: 1.4 };
    o.update = (dt) => {
      age += dt;
      if (ch.heldObj && ch.heldObj.visible) from.copy(ch.heldObj.position); else from.copy(ch.center);
      const k = Math.min(1, age / flyT);
      hp.copy(from).lerp(target, k);
      if (k >= 1 && !latched) {
        latched = true;
        g.effects.impact(target, normal, 'metal', { hole: false });
        g.effects.ring(target, 1.2, 0xd8f6ff, 0.25, normal);
        audio.play('hitMetal', { pos: target, vol: 0.4, rate: 1.5 });
        ch.grounded = false;
      }
      // rope: wavy while flying, taut once latched
      const len = from.distanceTo(hp);
      rope.position.copy(from); rope.lookAt(hp);
      rope.scale.set(1, 1, Math.max(0.01, len));
      if (!latched) rope.rotateZ(Math.sin(age * 60) * 0.3);
      hook.position.copy(hp); hook.lookAt(_a.copy(hp).add(_b.copy(hp).sub(from)));
      if (latched) {
        // reel in: steady pull toward the hook, released near it
        const to = _a.copy(target).sub(ch.center); const d = to.length();
        if (d < 2.2 || !ch.alive) { o.t = 0; ch.vel.y = Math.max(ch.vel.y, 7); return; }
        ch.vel.copy(to.multiplyScalar(34 / d)); ch.vel.y += 3;
        if (Math.random() < 0.5) g.effects.burst(ch.center, { count: 1, color: 0xd8f6ff, speed: 0.3, size: 0.2, life: 0.3, grav: 0, glow: true });
      }
    };
    o.end = () => { rope.removeFromParent(); rope.material.dispose(); hook.removeFromParent(); hook.material.dispose(); };
    this.objects.push(o);
  }

  landed(ch) {
    if (!ch.slamming) return;
    ch.slamming = false;
    const g = this.game;
    const p = ch.pos.clone().add(new THREE.Vector3(0, 0.3, 0));
    g.combat.explode(p, 6, 60, ch, { buildDmg: 120, color: 0xffb05a });
    // ground crack: dust ring + flying rocks
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.effects.burst(_a.set(p.x + Math.cos(a) * 1.2, p.y, p.z + Math.sin(a) * 1.2), { count: 1, color: 0xc8b89a, speed: 9, size: 1.2, life: 1, grav: -0.5, drag: 3, grow: 1.5, dir: _b.set(Math.cos(a), 0.1, Math.sin(a)), spread: 0.1 });
    }
    g.effects.ring(p, 9, 0xffd8a8, 0.5);
  }

  spawnBubble(ch) {
    const g = this.game;
    const r = 3.6;
    const mat = addMat(BUBBLE_VS, BUBBLE_FS, 0x5ecbff);
    mat.uniforms.uR.value = r;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
    mesh.position.copy(ch.pos); mesh.scale.setScalar(0.01); mesh.renderOrder = 4;
    g.scene.add(mesh);
    const b = { kind: 'bubble', mesh, pos: ch.pos.clone(), r, t: 6, life: 6, hp: 400, alive: true, owner: ch, age: 0, hitT: 0, hitPos: null };
    ch.shieldBubble = b;
    // anyone inside is protected from outside shots (handled in combat.damage)
    for (const c of g.chars) if (c.alive && c.pos.distanceTo(b.pos) < r) c.shieldBubble = b;
    this.objects.push(b);
    g.effects.shock(ch.pos, r, 0x5ecbff, 0.35);
    g.effects.ring(ch.pos, r * 1.3, 0x5ecbff, 0.4);
    audio.play('forceField', { pos: ch.pos, vol: 1 });
  }

  spawnHealZone(ch) {
    const g = this.game;
    const R = 4;
    const root = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2), addMat(UV_VS, HEAL_FS, 0x7dff5a));
    floor.position.y = 0.08;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.2, 48, 1, true).translate(0, 1.1, 0), addMat(UV_VS, WALL_FS, 0x7dff5a));
    root.add(floor, wall);
    root.position.copy(ch.pos);
    root.traverse((m) => { m.renderOrder = 4; });
    g.scene.add(root);
    this.objects.push({ kind: 'heal', mesh: root, mats: [floor.material, wall.material], pos: ch.pos.clone(), t: 8, life: 8, acc: 0, pacc: 0, R });
    g.effects.ring(ch.pos, R * 1.2, 0x7dff5a, 0.5);
    audio.play('powerUp', { pos: ch.pos });
  }

  spawnTurret(ch) {
    const g = this.game;
    const root = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.7, roughness: 0.35 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xff3d7f, roughness: 0.4, emissive: 0x330010 });
    // tripod legs + post
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), metal);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.35, 0.35, Math.sin(a) * 0.35); leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      root.add(leg);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 10), metal); post.position.y = 0.55; root.add(post);
    const head = new THREE.Group(); head.position.y = 1.0; head.rotation.order = 'YXZ';
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.6), pink));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40e0ff).multiplyScalar(2), toneMapped: false }));
    visor.position.set(0, 0.06, -0.31); head.add(visor);
    const barrel = new THREE.Group(); barrel.position.z = -0.3; head.add(barrel);
    for (const x of [-0.11, 0.11]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), metal); b.rotation.x = Math.PI / 2; b.position.set(x, -0.04, -0.35); barrel.add(b); }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(3), toneMapped: false }));
    beacon.position.y = 0.24; head.add(beacon);
    root.add(head);
    root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    const fwd = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw));
    root.position.copy(ch.pos).addScaledVector(fwd, 1.5);
    root.position.y = Math.max(ch.pos.y, g.world.groundY(root.position.x, root.position.z));
    root.rotation.y = ch.yaw;
    root.scale.setScalar(0.01);
    g.scene.add(root);
    g.effects.dust(root.position, 0xd8c8a8, 10);
    audio.play('build', { pos: root.position, vol: 0.8 });
    this.objects.push({ kind: 'turret', mesh: root, head, barrel, beacon, pos: root.position, owner: ch, t: 15, life: 15, cd: 0.5, age: 0, kick: 0, side: 0, weapon: makeWeapon('smg', 2, { perks: [], element: null }) });
  }

  spawnDecoy(ch) {
    // a fake character that runs forward; bots will target it
    const g = this.game;
    const d = g.spawnDecoy(ch);
    this.objects.push({ kind: 'decoy', char: d, t: 8, owner: ch });
  }

  // a rocket that falls from the sky onto `p` (airstrike) — or a meteor
  skyDrop(ch, p, { delay = 0, radius = 4.5, dmg = 110, buildDmg = 400, meteor = false } = {}) {
    const g = this.game, c = g.combat;
    c.later(delay, () => {
      const start = p.clone().add(meteor ? new THREE.Vector3(30, 120, 10) : new THREE.Vector3(rand(-8, 8), 70, rand(-8, 8)));
      const mesh = meteor ? new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(2.5), toneMapped: false })) : projectileModel('rocket');
      if (!meteor) mesh.scale.setScalar(2.2);
      mesh.position.copy(start); g.scene.add(mesh);
      const dir = p.clone().sub(start).normalize();
      if (!meteor) mesh.lookAt(_a.copy(start).sub(dir)); // rocket nose is -Z
      const T = meteor ? 0.7 : 0.55;
      const prev = start.clone();
      this.fx(T, (dt, o) => {
        const k = 1 - Math.max(0, o.t) / T;
        mesh.position.lerpVectors(start, p, k * k * 0.3 + k * 0.7);
        if (meteor) mesh.rotation.x += dt * 6;
        const pos = mesh.position;
        g.effects.burst(pos, { count: meteor ? 3 : 2, colors: meteor ? [0xff6a1a, 0xffd34d] : [0xffe08a, 0xff8a2a], end: 0x401004, speed: 1, size: meteor ? 1.4 : 0.7, life: 0.35, grav: 0, glow: true });
        g.effects.burst(pos, { count: 2, colors: [0x777777, 0x999999], speed: 0.5, size: meteor ? 2 : 1.1, life: 1.6, grav: -0.5, drag: 1, grow: 1.5 });
        g.effects.trail(prev, pos, meteor ? 0xff8a2a : 0xffd8a8, meteor ? 6 : 3, 0.4);
        prev.copy(pos);
      }, () => {
        disposeTree(mesh);
        if (!this.clearing) c.explode(p, radius, dmg, ch, { buildDmg, element: meteor ? 'fire' : null });
      });
    });
  }

  airstrike(ch, at, count, radius, dmg) {
    const g = this.game;
    audio.play('thruster', { pos: at, range: 300, vol: 1 });
    // target marker: red beam + pulsing rings while the jets line up
    g.effects.column(at, 1.2, 40, 0xff3b3b, 1.4);
    for (let i = 0; i < 3; i++) g.combat.later(i * 0.3, () => g.effects.ring(at, 8, 0xff3b3b, 0.6));
    for (let i = 0; i < count; i++) {
      const p = at.clone().add(new THREE.Vector3(rand(-6, 6), 0, rand(-6, 6)));
      if (g.world) p.y = Math.max(at.y, g.world.groundY(p.x, p.z));
      this.skyDrop(ch, p, { delay: 0.6 + i * 0.26, radius, dmg, buildDmg: 400 });
    }
  }

  // ---------- ultimates ----------
  ultimate(ch, id, aimOrigin, aimDir) {
    const g = this.game;
    if (id === 'megashield') {
      ch.health = ch.maxHealth; ch.shield = ch.maxShield; ch.overshield = 100;
      g.effects.burst(ch.center, { count: 60, colors: [0x5ecbff, 0xffffff], speed: 6, size: 0.3, life: 1, up: 0.5, glow: true });
      g.effects.shock(ch.center, 3, 0x5ecbff, 0.5);
      g.effects.column(ch.pos, 1, 8, 0x5ecbff, 0.8);
      audio.play('forceField', { pos: ch.pos, vol: 1.2 });
    } else if (id === 'meteor') {
      const hit = g.combat.ray(aimOrigin, aimDir, 400, ch);
      const at = hit ? v3(hit.point) : aimOrigin.clone().addScaledVector(aimDir, 150);
      g.effects.column(at, 3, 60, 0xff6a1a, 1.5);
      for (let i = 0; i < 10; i++) {
        const p = at.clone().add(new THREE.Vector3(rand(-14, 14), 0, rand(-14, 14)));
        p.y = g.world.groundY(p.x, p.z);
        this.skyDrop(ch, p, { delay: i * 0.3, radius: 7, dmg: 120, buildDmg: 600, meteor: true });
      }
      audio.play('thruster', { vol: 1 });
    } else if (id === 'mvp') {
      ch.mvpT = 12; ch.scale = 2.2; ch.infiniteAmmo = true;
      ch.health = ch.maxHealth; ch.shield = ch.maxShield;
      g.effects.confetti(ch.center, 120);
      g.effects.column(ch.pos, 2, 20, 0xffd34d, 1.2);
      g.effects.ring(ch.pos, 8, 0xffd34d, 0.6);
      audio.jingle('unlock', 0.5);
    }
    g.events.emit('ultimate', ch, id);
  }

  update(dt) {
    const g = this.game;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.t -= dt;
      if (o.kind === 'fx') o.update(dt, o);
      else if (o.kind === 'bubble') this.updateBubble(o, dt);
      else if (o.kind === 'heal') this.updateHeal(o, dt);
      else if (o.kind === 'turret') this.updateTurret(o, dt);
      else if (o.kind === 'decoy') { if (o.t <= 0 && o.char) g.removeDecoy(o.char); }
      if (o.t <= 0) {
        if (o.end) o.end(o);
        if (o.mesh) disposeTree(o.mesh);
        if (o.kind === 'bubble') { o.alive = false; for (const c of g.chars) if (c.shieldBubble === o) c.shieldBubble = null; }
        if (o.kind === 'turret') { g.effects.burst(o.pos, { count: 16, colors: [0xff3d7f, 0xffffff], speed: 4, size: 0.2, life: 0.5, glow: true }); g.effects.dust(o.pos, 0xcccccc, 8); }
        this.objects.splice(i, 1);
      }
    }
    for (const c of g.chars) {
      if (c.mvpT > 0) { c.mvpT -= dt; if (c.mvpT <= 0) { c.scale = 1; c.infiniteAmmo = false; } if (Math.random() < 0.3) g.effects.burst(c.center, { count: 1, colors: [0xffd34d, 0xffffff], speed: 1, size: 0.3, life: 0.6, grav: -2, glow: true, jitter: 0.8 }); }
      if (!c.alive) continue;
      if (c.jetting) this.jetFlames(c, dt);
      if (c.slamming) {
        g.effects.burst(c.center, { count: 2, colors: [0xffb05a, 0xffffff], speed: 0.5, size: 0.4, life: 0.25, grav: 0, glow: true, jitter: 0.4 });
        if (c.grounded) this.landed(c); // 'land' only fires after gliding, so check here too
      }
      if (g.slowmo && c !== g.slowmo.owner && Math.random() < 0.08) g.effects.burst(c.center, { count: 1, color: 0xb45cff, speed: 0.2, size: 0.35, life: 0.8, grav: 0, glow: true, jitter: 0.6 });
    }
    if (g.slowmo) { g.slowmo.t -= dt; if (g.slowmo.t <= 0) { g.effects.shock(g.slowmo.owner.center, 8, 0xb45cff, 0.3); g.slowmo = null; } }
  }

  jetFlames(c, dt) {
    const g = this.game, e = g.effects;
    const s = c.scale || 1;
    const bx = Math.sin(c.yaw) * 0.28 * s, bz = Math.cos(c.yaw) * 0.28 * s; // behind the back
    const rx = Math.cos(c.yaw) * 0.16 * s, rz = -Math.sin(c.yaw) * 0.16 * s;
    for (const side of [-1, 1]) {
      _a.set(c.pos.x + bx + rx * side, c.pos.y + 1.0 * s, c.pos.z + bz + rz * side);
      e.burst(_a, { count: 2, colors: [0xffffff, 0xffe08a, 0xff9a3a], end: 0x6a1004, speed: 7, size: 0.28 * s, life: 0.2, grav: 0, drag: 2, glow: true, dir: _b.set(c.vel.x * 0.1, -1.6 + c.vel.y * 0.05, c.vel.z * 0.1), spread: 0.18 });
      if (Math.random() < 0.4) e.burst(_a, { count: 1, color: 0x9a9a9a, end: 0xcccccc, speed: 3, size: 0.4, life: 0.8, grav: -0.5, drag: 2, grow: 1.2, dir: _b.set(0, -1, 0), spread: 0.3 });
    }
    if (c.isPlayer) { this.jetLightT -= dt; if (this.jetLightT <= 0) { this.jetLightT = 0.05; e.light(_a.set(c.pos.x + bx, c.pos.y + 0.6, c.pos.z + bz), 0xff9a3a, rand(2, 3.5), 0.06, 7); } }
  }

  updateBubble(o, dt) {
    const g = this.game, u = o.mesh.material.uniforms;
    o.age += dt;
    u.uTime.value = g.time;
    o.mesh.scale.setScalar(Math.max(0.01, elastic(Math.min(1, o.age / 0.45))));
    u.uAlpha.value = Math.min(1, o.age * 4) * Math.min(1, Math.max(0, o.t) / 0.4);
    if (o.hitT > 0) {
      o.hitT = Math.max(0, o.hitT - dt * 2.2);
      if (o.hitPos) { u.uHitPos.value.copy(o.hitPos).sub(o.pos); o.hitPos = null; }
    }
    u.uHit.value = o.hitT;
    if (o.hp <= 0 && o.t > 0) {
      o.t = 0;
      g.effects.chunks('shards', _a.copy(o.pos).setY(o.pos.y + 1.5), { count: 40, colors: [0x5ecbff, 0x9fe8ff, 0xffffff], bright: 2, speed: 7, size: 0.3, life: 1, up: 0.5, grav: 9, bounce: 0.2, spread: 1.2 });
      g.effects.shock(o.pos, o.r * 1.3, 0x5ecbff, 0.3);
      audio.play('glass', { pos: o.pos, vol: 1, rate: 0.8 });
    }
  }

  updateHeal(o, dt) {
    const g = this.game;
    o.acc += dt; o.pacc += dt;
    const a = Math.min(1, (o.life - o.t) * 3) * Math.min(1, Math.max(0, o.t) / 0.6);
    for (const m of o.mats) { m.uniforms.uTime.value = g.time; m.uniforms.uAlpha.value = a; }
    if (o.pacc > 0.06) { // rising green motes
      o.pacc = 0;
      const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * o.R;
      g.effects.burst(_a.set(o.pos.x + Math.cos(ang) * r, o.pos.y + 0.2, o.pos.z + Math.sin(ang) * r), { count: 1, colors: [0x7dff5a, 0xd8ffc8], speed: 0.4, size: 0.22, life: 1.4, grav: -2.2, drag: 0.5, glow: true });
    }
    if (o.acc > 0.5) {
      o.acc = 0;
      for (const c of g.chars) if (c.alive && c.pos.distanceTo(o.pos) < o.R && c.health < c.maxHealth) {
        c.health = Math.min(c.maxHealth, c.health + 5);
        g.effects.burst(c.center, { count: 5, colors: [0x7dff5a, 0xffffff], speed: 1, size: 0.25, life: 0.7, grav: -3, glow: true, jitter: 0.4 });
        g.effects.ring(c.pos, 1.4, 0x7dff5a, 0.4);
      }
    }
  }

  updateTurret(o, dt) {
    const g = this.game;
    o.age += dt; o.cd -= dt;
    o.mesh.scale.setScalar(Math.max(0.01, elastic(Math.min(1, o.age / 0.5))));
    o.beacon.visible = Math.sin(g.time * 8) > 0;
    o.kick = Math.max(0, o.kick - dt * 12);
    o.barrel.position.z = -0.3 + o.kick * 0.08;
    if (o.age < 0.5) return;
    let best = null, bd = 35;
    for (const c of g.chars) { if (!c.alive || c === o.owner || c.status.invisible > 0 || c.isDecoy && c.decoyOwner === o.owner) continue; const d = c.pos.distanceTo(o.pos); if (d < bd) { bd = d; best = c; } }
    if (!best) { o.head.rotation.y += dt * 1.2; return; } // idle scan
    const bc = best.center;
    // turn toward the target smoothly (head lives in the root's local space)
    _a.copy(bc).sub(o.pos);
    const want = Math.atan2(-_a.x, -_a.z) - o.mesh.rotation.y;
    let dy = want - o.head.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    o.head.rotation.y += dy * Math.min(1, dt * 12);
    o.head.rotation.x = Math.atan2(_a.y - 1, Math.hypot(_a.x, _a.z)) * 0.8;
    if (o.cd > 0 || Math.abs(dy) > 0.3) return;
    o.cd = 0.15; o.kick = 1; o.side ^= 1;
    const from = o.pos.clone().add(new THREE.Vector3(0, 1, 0));
    const dir = bc.sub(from).normalize();
    dir.x += rand(-0.04, 0.04); dir.y += rand(-0.04, 0.04); dir.normalize();
    const hit = g.combat.ray(from, dir, 40, o.owner);
    const end = hit ? v3(hit.point) : from.clone().addScaledVector(dir, 40);
    const muzzle = from.clone().addScaledVector(dir, 1.0).add(_b.set(Math.cos(o.mesh.rotation.y + o.head.rotation.y), 0, -Math.sin(o.mesh.rotation.y + o.head.rotation.y)).multiplyScalar(o.side ? 0.11 : -0.11));
    g.effects.muzzleFlash(muzzle, dir, { size: 0.8, color: 0xff7aa8, light: g.effects.camDist(muzzle) < 50 });
    g.effects.bullet(muzzle, end, 0xff7aa8, 1);
    audio.gun('smg', from);
    if (hit && hit.owner && hit.owner.kind === 'char' && hit.owner.char !== o.owner) g.combat.damage(hit.owner.char, 9, { source: o.owner, point: end, dir });
    else if (hit && hit.owner && hit.owner.kind === 'build') { g.building.damagePiece(hit.owner.piece, 9, o.owner); g.effects.impact(end, hit.normal, 'build-' + hit.owner.piece.mat, { hole: false }); }
    else if (hit) { const s = g.combat.surfaceOf(hit, end); g.effects.impact(end, hit.normal, s.surf, { color: s.color }); }
  }

  clear() {
    this.clearing = true;
    for (const o of this.objects) { if (o.end) o.end(o); if (o.mesh) disposeTree(o.mesh); }
    this.clearing = false;
    this.objects = [];
  }
}
