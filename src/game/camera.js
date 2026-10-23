import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../engine/utils.js';

// Over-the-right-shoulder third person camera (Fortnite style) with sphere-cast collision,
// ADS zoom, sprint FOV, a landing dip, smoothed stairs and screen shake.
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _dir = new THREE.Vector3(), _des = new THREE.Vector3(), _look = new THREE.Vector3();
const ROT0 = { x: 0, y: 0, z: 0, w: 1 };

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.cam = game.renderer.camera;
    this.yaw = 0; this.pitch = -0.1;
    this.distance = 3.0;
    this.curDist = 3.0;
    this.shoulder = 0.82; // the KayKit heroes have big heads: sit far enough right that it never covers the crosshair
    this.ads = 0;
    this.shakeAmt = 0;
    this.fovBase = 78;
    this.padAdsSens = 0.6;
    this.kick = 0;
    this.pos = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.pivotY = null;
    this.dip = 0; this.dipV = 0;
    this.sky = 0;
    this.mode = 'player'; // player | free | spectate | lobby
  }

  addLook(dx, dy) {
    let sens = 1;
    if (this.ads > 0.5) sens = this.game.input && this.game.input.usingPad ? (this.scoped ? this.padAdsSens * 0.55 : this.padAdsSens) : (this.scoped ? 0.35 : 0.65);
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.35, 1.35);
  }

  shake(amount) { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }

  forward(out = new THREE.Vector3()) {
    return this.cam.getWorldDirection(out);
  }

  // how far the camera can go from `from` along `dir` before touching the world (sphere cast, ray fallback)
  clearance(from, dir, len, ch) {
    const ph = this.game.physics, R = ph.R;
    const pred = (col) => { const o = ph.owners.get(col.handle); return !o || (o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'boundary' && o.kind !== 'loot' && !(o.kind === 'vehicle' && o.vehicle === ch.vehicle)); };
    try {
      if (!this.ball) this.ball = new R.Ball(0.22);
      const hit = ph.world.castShape(from, ROT0, dir, this.ball, 0, len, false, undefined, undefined, ch.collider, undefined, pred);
      if (hit) return Math.max(0.25, (hit.time_of_impact ?? hit.timeOfImpact ?? hit.toi ?? len) - 0.05);
      return len;
    } catch (e) {
      const hit = ph.raycast(from, dir, len + 0.3, ch.collider, undefined, pred);
      return hit ? Math.max(0.3, hit.dist - 0.3) : len;
    }
  }

  update(dt, target, { aiming = false, scope = 0, skydive = false, sprint = false, dead = false } = {}) {
    const ch = target;
    // never let a bad number stick in the camera's angles or distance (it would blank the screen for good)
    if (!Number.isFinite(this.yaw + this.pitch + this.curDist + this.kick)) {
      console.warn('[sportnite] camera angles went NaN, resetting', { yaw: this.yaw, pitch: this.pitch, dist: this.curDist });
      if (!Number.isFinite(this.yaw)) this.yaw = 0;
      if (!Number.isFinite(this.pitch)) this.pitch = 0;
      if (!Number.isFinite(this.curDist)) this.curDist = 3.3;
      if (!Number.isFinite(this.kick)) this.kick = 0;
    }
    if (ch.vehicle && !dead) { this.vehicleCam(dt, ch.vehicle, ch); return; }
    this.ads = damp(this.ads, aiming ? 1 : 0, 14, dt);
    this.scoped = aiming && scope > 0;
    this.sky = damp(this.sky, skydive ? 1 : 0, 3, dt);
    // recoil recovery
    if (ch.recoilKick) { this.pitch = clamp(this.pitch + ch.recoilKick, -1.35, 1.35); this.kick += ch.recoilKick; ch.recoilKick = 0; }
    const rec = this.kick * Math.min(1, dt * 8);
    this.kick -= rec; this.pitch -= rec * 0.7;

    const s = ch.scale || 1;
    const crouch = ch.crouching || ch.slideT > 0;
    let dist = 3.3 - this.ads * 1.4 + this.sky * 3.6 + (dead ? 3 : 0);
    if (crouch) dist -= 0.15;
    if (this.scoped) dist = 0.4;
    dist *= Math.sqrt(s);
    const shoulder = this.shoulder * (1 - this.sky) * (1 + this.ads * 0.1) * s;
    // landing dip: a quick springy nod when you hit the ground hard
    if (ch.landImpact > 4 && ch.landImpact !== this.lastImpact && ch === this.game.player) this.dipV -= Math.min(ch.landImpact, 30) * 0.045;
    this.lastImpact = ch.landImpact;
    this.dipV += (-90 * this.dip - 12 * this.dipV) * Math.min(dt, 0.05); this.dip = clamp(this.dip + this.dipV * Math.min(dt, 0.05), -0.35, 0.2);
    // pivot height eases on stairs/crouch so the view never jitters, but snaps when far off (teleports, falls)
    const eye = (crouch ? 1.2 : 1.58) * s + this.sky * 0.6;
    const want = ch.pos.y + eye;
    if (this.pivotY === null || Math.abs(want - this.pivotY) > 2.5 || this.scoped) this.pivotY = want;
    else this.pivotY = damp(this.pivotY, want, ch.grounded ? 16 : 30, dt);
    const pivot = this.pivot.set(ch.pos.x, this.pivotY + this.dip, ch.pos.z);

    const fwd = _fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // the shoulder offset is checked first so walls on the right don't put the camera inside them
    const sideClear = shoulder > 0.01 ? this.clearance(pivot, right, shoulder, ch) : 0;
    const side = Math.min(shoulder, sideClear);
    const desired = _des.copy(pivot).addScaledVector(right, side).addScaledVector(fwd, -dist);
    const base = _look.copy(pivot).addScaledVector(right, side);
    const dir = _dir.subVectors(desired, base);
    const len = dir.length();
    dir.normalize();
    const d = this.clearance(base, dir, len, ch);
    // pull in instantly, ease back out
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 5, dt);
    this.pos.copy(base).addScaledVector(dir, this.curDist);
    // keep above terrain / water
    // keep above terrain, the sea and rivers (river water sits above the carved riverbed)
    this.pos.y = Math.max(this.pos.y, this.floorAt(this.pos.x, this.pos.z) + 0.4);

    this.cam.position.copy(this.pos);
    this.cam.lookAt(_look.copy(this.pos).add(fwd));
    if (this.shakeAmt > 0) {
      const a = this.shakeAmt * 0.04;
      this.cam.rotation.x += (Math.random() - 0.5) * a;
      this.cam.rotation.y += (Math.random() - 0.5) * a;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    let fov = this.fovBase - this.ads * 16;
    if (this.scoped) fov = this.fovBase / scope;
    if (sprint) fov += 6;
    fov += this.sky * 10;
    // diving: extra FOV rush with speed
    if (skydive && ch.vel) fov += clamp((-ch.vel.y - 26) / 16, 0, 1) * 8;
    this.cam.fov = damp(this.cam.fov, fov, 10, dt);
    this.cam.updateProjectionMatrix();
    this.distance = this.curDist;
  }

  // Vehicle chase camera: farther back and smoothed, swings back behind you when you stop looking around,
  // speed widens the view and boost punches the FOV.
  vehicleCam(dt, v, ch) {
    const inp = this.game.input, d = v.def;
    const looking = Math.abs(inp.look.x) + Math.abs(inp.look.y) > 0.0004;
    this.vLookT = looking ? 0 : (this.vLookT ?? 9) + dt;
    this.ads = 0; this.scoped = false; this.sky = 0; this.kick = 0; ch.recoilKick = 0;
    const speed = Math.hypot(v.vel.x, v.vel.z);
    if (this.vLookT > 1.0 && (speed > 2 || this.vLookT > 3)) {
      // follow where it's heading (backing up keeps looking past the nose)
      let head = v.yaw;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      if (speed > 4 && (v.vel.x * fx + v.vel.z * fz) > 0) head = Math.atan2(-v.vel.x, -v.vel.z);
      this.yaw = dampAngle(this.yaw, head, d.fly ? 1.6 : 2.6, dt);
      this.pitch = damp(this.pitch, d.fly ? -0.32 : -0.2, 2, dt);
    }
    const k = clamp(speed / d.maxSpeed, 0, 1.5);
    const dist = d.cam.dist + k * 1.6;
    const want = v.pos.y + d.cam.height + (v.def.hover || 0);
    const fresh = this.game.time - (this.vLastT ?? -9) > 0.25;
    this.vLastT = this.game.time;
    if (fresh || this.vPivotY === undefined || Math.abs(want - this.vPivotY) > 6) this.vPivotY = want;
    else this.vPivotY = damp(this.vPivotY, want, 10, dt);
    this.pivotY = null; // on foot again: snap
    const pivot = this.pivot.set(v.pos.x, this.vPivotY, v.pos.z);
    const fwd = _fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const dir = _dir.copy(fwd).negate();
    const d2 = this.clearance(pivot, dir, dist, ch);
    this.curDist = d2 < this.curDist ? d2 : damp(this.curDist, d2, 4, dt);
    this.pos.copy(pivot).addScaledVector(dir, this.curDist);
    this.pos.y = Math.max(this.pos.y, this.floorAt(this.pos.x, this.pos.z) + 0.5);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(_look.copy(this.pos).add(fwd));
    if (v.boosting && speed > d.maxSpeed * 0.9) this.shakeAmt = Math.max(this.shakeAmt, 0.12);
    if (this.shakeAmt > 0) {
      const a = this.shakeAmt * 0.04;
      this.cam.rotation.x += (Math.random() - 0.5) * a;
      this.cam.rotation.y += (Math.random() - 0.5) * a;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    const fov = this.fovBase + 4 + Math.min(k, 1.3) * 9 + (v.boosting ? 9 : 0);
    this.cam.fov = damp(this.cam.fov, fov, v.boosting ? 8 : 4, dt);
    this.cam.updateProjectionMatrix();
    this.distance = this.curDist;
  }

  // Free-orbiting camera for lobby / spectating
  orbit(dt, center, radius, height, speed = 0.15) {
    this.orbitT = (this.orbitT || 0) + dt * speed;
    this.cam.position.set(center.x + Math.cos(this.orbitT) * radius, center.y + height, center.z + Math.sin(this.orbitT) * radius);
    this.cam.lookAt(center);
  }

  // lowest the camera may go here: the ground, the sea surface, or a river's surface
  floorAt(x, z) {
    const w = this.game.world;
    const river = w.terrain.riverSurface ? w.terrain.riverSurface(x, z) : null;
    return Math.max(w.groundY(x, z), 0, river ?? -Infinity);
  }
}
