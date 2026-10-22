import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { audio } from '../engine/audio.js';
import { clamp, damp } from '../engine/utils.js';
import { POIS } from '../world/world.js';
import { ISLAND_RADIUS } from '../world/terrain.js';
import { VehicleHud } from '../ui/vehicleHud.js';

// Rideable vehicles: the Sport Board (hoverboard), the Golf Cart and the Sport Copter.
// Arcade physics of our own (no Rapier dynamic bodies): four ground probes (raycasts) give the
// ground height + slope, a shape-cast of the body handles walls/ramps, and a kinematic collider
// follows the vehicle so nobody can walk through it.
//
// The rider keeps state 'ground' (so the storm, bullets and everything else still work) and gets
// `ch.vehicle` set; character.js / player.js / camera.js have tiny hooks that check it.

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = { x: 0, y: -1, z: 0 };
const WATER = 0;
const STEP = 1 / 60;
const PROBE_UP = 0.9;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _tf = new THREE.Vector3(), _tr = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const IDLE = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false, jumpHeld: false, up: false, down: false, honk: false });

// wheels: [right, forward] offsets of the four ground probes, FL FR BL BR
export const VEHICLES = {
  board: {
    id: 'board', name: 'Sport Board', icon: '🛹', verb: 'Hop on', count: 16, hp: 220,
    maxSpeed: 18, boostSpeed: 28, reverse: 6, accel: 16, brake: 34, coast: 2.5, turn: 2.8, grip: 7, gravity: 24, ollie: 8.5,
    wheels: [[-0.18, 0.55], [0.18, 0.55], [-0.18, -0.55], [0.18, -0.55]], hover: 0.42,
    cast: [0.26, 0.2, 0.62], castY: 0.62, col: [0.3, 0.16, 0.72], colY: 0.42,
    seat: [0, 0.5, 0], stand: true, cam: { dist: 5.4, height: 2.0 }, interactR: 2.4, floats: true,
    sound: 'boardHum', color: [0x18e0ff, 0xff4fd8, 0x9dff3a, 0xffb627],
  },
  cart: {
    id: 'cart', name: 'Golf Cart', icon: '🛺', verb: 'Drive', count: 14, hp: 420,
    maxSpeed: 21, boostSpeed: 30, reverse: 7, accel: 11, brake: 26, coast: 2, turn: 1.95, grip: 9, gravity: 25,
    wheels: [[-0.62, 0.85], [0.62, 0.85], [-0.62, -0.85], [0.62, -0.85]], hover: 0,
    cast: [0.6, 0.38, 1.12], castY: 0.8, col: [0.68, 0.5, 1.25], colY: 0.72,
    seat: [0, 0.02, 0.22], stand: false, cam: { dist: 7.4, height: 2.6 }, interactR: 3.0, floats: true,
    sound: 'cartMotor', color: [0x2fbf5a, 0x2f8cff, 0xff4a4a, 0xffd34d],
  },
  copter: {
    id: 'copter', name: 'Sport Copter', icon: '🚁', verb: 'Fly', count: 10, hp: 480,
    maxSpeed: 24, boostSpeed: 34, climb: 10, turn: 1.7, gravity: 25, fly: true, fuelMax: 100, fuelRate: 1.1, maxAlt: 80, ceiling: 175,
    wheels: [[-0.62, 0.8], [0.62, 0.8], [-0.62, -0.8], [0.62, -0.8]], hover: 0,
    cast: [0.8, 0.6, 1.25], castY: 1.05, col: [0.82, 0.6, 1.3], colY: 0.8,
    seat: [0, -0.12, 0.05], stand: false, cam: { dist: 10, height: 3.3 }, interactR: 3.6, floats: true,
    sound: 'copterRotor', color: [0xff7a1a, 0x2f8cff, 0xff4fd8, 0x2fbf5a],
  },
};

// ---------- shared textures ----------
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.shadowColor = '#fff'; g.shadowBlur = 14;
  g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Vehicle {
  constructor(sys, def, pos, yaw, colorIdx) {
    this.sys = sys; this.game = sys.game; this.def = def; this.type = def.id;
    this.pos = pos.clone(); this.vel = new THREE.Vector3();
    this.yaw = yaw; this.yawRate = 0; this.steerVis = 0;
    this.n = UP.clone(); this.nT = UP.clone(); this.quat = new THREE.Quaternion();
    this.hp = def.hp; this.alive = true;
    this.boost = 100; this.fuel = def.fuelMax || 0; this.boosting = false;
    this.rider = null; this.ctl = null;
    this.awake = false; this.grounded = true; this.airT = 0; this.restT = 0; this.jumpT = 0;
    this.groundH = pos.y; this.groundCount = 4;
    this.pitchVis = 0; this.rollVis = 0; this.susp = 0; this.suspV = 0;
    this.trickYaw = 0; this.spun = 0; this.flipT = 0; this.flips = 0;
    this.drifting = false; this.driftCharge = 0; this.driftDir = 0;
    this.rotorSpd = 0; this.rotorAng = 0; this.wheelAng = 0;
    this.fxT = 0; this.lastAttacker = null; this.runCd = new Map();
    this.color = def.color[colorIdx % def.color.length];
    this.mesh = sys.buildModel(this);
    this.game.scene.add(this.mesh);
    this.updateQuat(1);
    this.buildPhysics();
    this.syncMesh(0);
  }

  // ---------- physics body (kinematic, follows the vehicle) ----------
  buildPhysics() {
    const ph = this.game.physics, R = ph.R, [hx, hy, hz] = this.def.col;
    const c = this.colCenter(_a);
    this.body = ph.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z).setRotation(this.quat));
    this.col = ph.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), this.body);
    ph.owners.set(this.col.handle, { kind: 'vehicle', vehicle: this });
  }
  removePhysics() {
    if (!this.body) return;
    const ph = this.game.physics;
    ph.owners.delete(this.col.handle);
    ph.world.removeRigidBody(this.body);
    this.body = null; this.col = null;
  }
  colCenter(out) { return out.set(0, this.def.colY, 0).applyQuaternion(this.quat).add(this.pos); }
  syncBody() {
    if (!this.body) return;
    const c = this.colCenter(_a);
    this.body.setNextKinematicTranslation(c);
    this.body.setNextKinematicRotation(this.quat);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  // ---------- ground probes ----------
  probe() {
    const d = this.def, ph = this.game.physics, sys = this.sys;
    this.forward(_f); _r.set(-_f.z, 0, _f.x);
    const hs = this._hs || (this._hs = [0, 0, 0, 0]);
    const top = this.pos.y + PROBE_UP;
    let sum = 0, cnt = 0;
    const exclude = this.rider ? this.rider.collider : null;
    for (let i = 0; i < 4; i++) {
      const [wx, wz] = d.wheels[i];
      const x = this.pos.x + _r.x * wx + _f.x * wz, z = this.pos.z + _r.z * wx + _f.z * wz;
      const hit = ph.raycast({ x, y: top, z }, DOWN, PROBE_UP + 4, exclude, undefined, sys.pred);
      let y = -Infinity;
      if (hit && hit.dist > 0.02) y = hit.point.y; // a ray that starts inside something is a wall, not ground
      if (d.floats && (y === -Infinity || y < WATER) && this.game.world.groundY(x, z) < WATER + 0.2) y = Math.max(y, WATER - (this.type === 'cart' ? 0.3 : 0));
      hs[i] = y;
      if (y > -Infinity) { sum += y; cnt++; }
    }
    this.groundCount = cnt;
    this.groundH = cnt ? sum / cnt : -Infinity;
    if (cnt === 4 && Math.max(...hs) - Math.min(...hs) < 1.6) {
      const L = d.wheels[0][1] - d.wheels[2][1], W = d.wheels[1][0] - d.wheels[0][0];
      const front = (hs[0] + hs[1]) / 2, back = (hs[2] + hs[3]) / 2, left = (hs[0] + hs[2]) / 2, right = (hs[1] + hs[3]) / 2;
      _tf.copy(_f).multiplyScalar(L).setY(front - back);
      _tr.copy(_r).multiplyScalar(W).setY(right - left);
      this.nT.crossVectors(_tr, _tf).normalize();
      if (this.nT.y < 0.45) this.nT.copy(UP);
      // the center of a tilted plane: max with the highest wheel so the body never sinks into a bump
      this.groundH = Math.max(this.groundH, Math.max(...hs) - 0.25);
    } else this.nT.copy(UP);
    this.inWater = this.groundH <= WATER + 0.01 && this.game.world.groundY(this.pos.x, this.pos.z) < WATER - 0.4;
  }

  // ---------- one physics sub-step ----------
  step(h) {
    this.sys.cur = this;
    const c = this.ctl || IDLE;
    this.probe();
    if (this.def.fly) this.flySim(h, c); else this.driveSim(h, c);
    if (this.ctl) this.ctl.jump = false; // edges only count once per frame
    this.yaw += this.yawRate * h;
    const y0 = this.pos.y, want = this.vel.y * h;
    this.move(h);
    // resting on something the wheel rays missed (a rock edge, a prop): we "fall" but don't move down.
    // Treat it as ground so falling speed can't pile up and fling the vehicle when it slips off.
    if (!this.def.fly && !this.grounded && want < -0.02 && this.pos.y - y0 > want * 0.25) {
      this.restT = 0.15;
      this.vel.y = Math.max(this.vel.y, -1);
    } else if (this.restT > 0) this.restT -= h;
    this.updateQuat(h);
  }

  driveSim(h, c) {
    const d = this.def;
    const gap = this.pos.y - this.groundH;
    this.jumpT -= h;
    const snap = this.grounded && this.jumpT <= 0 && gap < 0.4 && this.vel.y < 3.5;
    const wasGrounded = this.grounded;
    this.grounded = (this.groundH > -Infinity && (gap <= 0.04 || snap)) || this.restT > 0;
    if (this.restT > 0 && gap > 0.04) this.groundH = this.pos.y; // sitting on the thing that caught us
    this.forward(_f); _r.set(-_f.z, 0, _f.x);
    this.boosting = false;
    if (this.grounded) {
      if (!wasGrounded && this.airT > 0.2) this.onLand(-this.vel.y);
      this.airT = 0;
      this.pos.y = this.groundH;
      const n = this.n.lerp(this.nT, 1 - Math.exp(-14 * h)).normalize();
      const vn0 = this.vel.dot(n);
      if (vn0 < 0) this.vel.addScaledVector(n, -vn0);
      _tf.copy(_f).addScaledVector(n, -_f.dot(n)).normalize();
      _tr.copy(_r).addScaledVector(n, -_r.dot(n)).normalize();
      let vf = this.vel.dot(_tf), vr = this.vel.dot(_tr);
      const vn = this.vel.dot(n);
      const thr = c.throttle;
      this.boosting = c.boost && thr > 0.1 && this.boost > 1;
      let top = this.boosting ? d.boostSpeed : d.maxSpeed;
      if (this.inWater) top = Math.min(top, this.type === 'board' ? d.maxSpeed : 6);
      let target = 0, rate = d.coast;
      if (thr > 0.05) { if (vf < -0.5) rate = d.brake; else { target = top * thr; rate = d.accel * (this.boosting ? 1.9 : 1); } }
      else if (thr < -0.05) { if (vf > 0.5) rate = d.brake; else { target = d.reverse * thr; rate = d.accel * 0.6; } }
      if (vf > top + 0.5) rate = Math.max(rate, 6); // bleed off extra speed from downhills/boosts gently
      vf += clamp(target - vf, -rate * h, rate * h);
      // gravity pulls along the slope, but a parked cart doesn't creep down gentle hills
      let gF = -d.gravity * _tf.y;
      const gR = -d.gravity * _tr.y;
      // arcade engine power: hills up to ~45 degrees are climbable, cliffs are not
      if (n.y > 0.7 && Math.abs(thr) > 0.05 && Math.sign(gF) === -Math.sign(thr)) gF *= 0.3;
      if (!(Math.abs(thr) < 0.05 && Math.abs(vf) < 1.5 && n.y > 0.8)) vf += gF * h;
      vr += gR * h * 0.5;
      // steep downhills can't snowball into a runaway: never more than a bit over boost speed
      vf = clamp(vf, -d.boostSpeed * 1.15, d.boostSpeed * 1.15);
      const grip = this.drifting ? d.grip * 0.22 : this.type === 'cart' && Math.abs(vf) > 14 && Math.abs(c.steer) > 0.8 ? d.grip * 0.55 : d.grip;
      vr = damp(vr, 0, grip, h);
      this.vel.copy(_tf).multiplyScalar(vf).addScaledVector(_tr, vr).addScaledVector(n, vn);
      // steering (reverse steers backwards, like a real car)
      const sp = clamp(Math.abs(vf) / 3.5, 0, 1);
      let turn = d.turn * sp * (1 - 0.35 * clamp(Math.abs(vf) / d.boostSpeed, 0, 1)) * (vf < -0.3 ? -1 : 1);
      let steer = c.steer;
      if (this.drifting) { turn *= 1.4; steer = clamp(steer * 0.7 + this.driftDir * 0.55, -1.3, 1.3); }
      this.yawRate = damp(this.yawRate, -steer * turn, 12, h);
      this.steerVis = damp(this.steerVis, c.steer, 10, h);
      // jumps: board ollie / cart hop into a drift
      if (c.jump && this.type === 'board') this.ollie(n);
      if (this.type === 'cart') this.driftUpdate(h, c, vf, n);
      this.trickYaw = damp(this.trickYaw, 0, 18, h);
    } else {
      this.airT += h;
      this.vel.y -= d.gravity * h;
      // a little air drag, and no rocket launches off slopes or rocks
      this.vel.x *= 1 - 0.25 * h; this.vel.z *= 1 - 0.25 * h;
      if (this.vel.y > 13) this.vel.y = 13;
      this.n.lerp(UP, 1 - Math.exp(-2 * h)).normalize();
      if (this.type === 'board') {
        // air tricks: steer spins the board, jump again kickflips it
        const spin = -c.steer * 8.5 * h;
        this.trickYaw += spin; this.spun += Math.abs(spin);
        this.yawRate = damp(this.yawRate, -c.steer * 0.6, 4, h);
        if (c.jump && this.flipT <= 0 && this.airT > 0.06) { this.flipT = 0.42; this.flips++; audio.synth('boardPop', { pos: this.pos, vol: 0.6, rate: 1.3 }); }
      } else this.yawRate = damp(this.yawRate, 0, 2, h);
      if (this.drifting && this.airT > 0.6) this.drifting = false;
    }
    if (this.flipT > 0) this.flipT -= h;
    // boost meter
    if (this.boosting) {
      if (!this.wasBoosting) { audio.synth('boostBurst', { pos: this.pos, vol: this.isPlayerRider ? 0.7 : 0.5 }); this.game.input.rumble(0.3, 0.5, 120); }
      this.boost = Math.max(0, this.boost - 28 * h);
    } else this.boost = Math.min(100, this.boost + 13 * h);
    this.wasBoosting = this.boosting;
  }

  ollie(n) {
    this.vel.addScaledVector(n, this.def.ollie); this.vel.y += 1.2;
    this.jumpT = 0.25; this.restT = 0; this.grounded = false; this.airT = 0.001; this.spun = 0; this.flips = 0;
    this.suspV -= 3;
    audio.synth('boardPop', { pos: this.pos, vol: 0.8 });
    this.game.effects.burst(this.pos, { count: 10, colors: [this.color, 0xffffff], speed: 3, size: 0.18, life: 0.35, grav: 2, glow: true });
  }

  driftUpdate(h, c, vf, n) {
    if (c.jump && Math.abs(vf) > 5 && !this.drifting) {
      // Mario-Kart hop: a little bounce, then hold to drift and charge a mini-turbo
      this.vel.addScaledVector(n, 3.4); this.jumpT = 0.15; this.restT = 0; this.grounded = false;
      this.drifting = true; this.driftCharge = 0; this.driftDir = Math.sign(c.steer) || 0; this.suspV -= 2;
      audio.synth('boardPop', { pos: this.pos, vol: 0.5, rate: 0.7 });
    }
    if (!this.drifting) return;
    if (!this.driftDir && Math.abs(c.steer) > 0.3) this.driftDir = Math.sign(c.steer);
    this.driftCharge += h * (0.5 + Math.abs(c.steer)) * (this.driftDir ? 1 : 0);
    if (!c.jumpHeld || Math.abs(vf) < 4) {
      this.drifting = false;
      if (this.driftCharge > 0.8) {
        const big = this.driftCharge > 2;
        this.vel.addScaledVector(_tf, big ? 10 : 6);
        this.game.effects.burst(this.pos, { count: big ? 26 : 16, colors: big ? [0xff4fd8, 0xffd34d] : [0x48b6ff, 0xffffff], speed: 6, size: 0.25, life: 0.4, grav: 0, glow: true, dir: _tf.clone().negate() });
        audio.synth('boostBurst', { pos: this.pos, vol: 0.6 });
        if (this.isPlayerRider) { this.sys.hud.trick(big ? 'SUPER MINI-TURBO!' : 'MINI-TURBO!'); this.game.cameraRig.shake(0.2); }
      }
      this.driftCharge = 0;
    }
  }

  flySim(h, c) {
    const d = this.def, g = this.game;
    const powered = !!this.rider && this.fuel > 0;
    let vyT = 0;
    if (!this.rider) vyT = -6;
    else if (!powered) vyT = -4.5; // out of fuel: autorotate down gently
    else vyT = c.up ? d.climb : c.down ? -d.climb : 0;
    const terrain = Math.max(g.world.groundY(this.pos.x, this.pos.z), WATER);
    const maxY = Math.min(terrain + d.maxAlt, d.ceiling);
    if (vyT > 0 && this.pos.y > maxY - 6) vyT *= clamp((maxY - this.pos.y) / 6, 0, 1);
    if (this.pos.y > maxY) vyT = Math.min(vyT, -3);
    const gap = this.pos.y - this.groundH;
    const wasGrounded = this.grounded;
    this.grounded = this.groundH > -Infinity && gap <= 0.05 && vyT <= 0.01;
    this.vel.y = damp(this.vel.y, vyT, 2.4, h);
    this.forward(_f);
    this.boosting = false;
    if (this.grounded) {
      if (!wasGrounded && this.airT > 0.3) this.onLand(-this.vel.y);
      this.airT = 0;
      this.pos.y = this.groundH; this.vel.y = Math.max(0, this.vel.y);
      this.n.lerp(this.nT, 1 - Math.exp(-10 * h)).normalize();
      // taxi slowly on the ground
      const t = powered ? c.throttle * 3 : 0;
      this.vel.x = damp(this.vel.x, _f.x * t, 5, h); this.vel.z = damp(this.vel.z, _f.z * t, 5, h);
      this.yawRate = damp(this.yawRate, powered ? -c.steer * 1.2 : 0, 6, h);
      this.fuel = Math.min(d.fuelMax, this.fuel + 4 * h);
    } else {
      this.airT += h;
      this.n.lerp(UP, 1 - Math.exp(-4 * h)).normalize();
      this.boosting = powered && c.boost && c.throttle > 0.1;
      const top = this.boosting ? d.boostSpeed : d.maxSpeed;
      const thr = powered ? c.throttle : 0;
      this.vel.x = damp(this.vel.x, _f.x * thr * top, 1.3, h);
      this.vel.z = damp(this.vel.z, _f.z * thr * top, 1.3, h);
      this.yawRate = damp(this.yawRate, powered ? -c.steer * d.turn : 0, 4, h);
      if (powered) this.fuel = Math.max(0, this.fuel - h * d.fuelRate * (this.boosting ? 1.8 : 1));
      if (powered && this.fuel <= 0 && this.isPlayerRider) this.sys.hud.trick('OUT OF FUEL!', 'Gliding down safely…');
    }
    // never fly off the island: a soft push back toward the middle
    const r = Math.hypot(this.pos.x, this.pos.z), lim = ISLAND_RADIUS + 30;
    if (r > lim) { const k = (r - lim) * 1.5 * h; this.vel.x -= (this.pos.x / r) * k * 4; this.vel.z -= (this.pos.z / r) * k * 4; }
    this.rotorSpd = damp(this.rotorSpd, this.rider ? (powered ? (this.grounded && !c.up ? 0.55 : 1) : 0.7) : this.grounded ? 0 : 0.6, 1.5, h);
    if (this.boosting && !this.wasBoosting) audio.synth('boostBurst', { pos: this.pos, vol: 0.5 });
    this.wasBoosting = this.boosting;
  }

  onLand(impact) {
    const g = this.game;
    this.suspV -= Math.min(impact, 25) * 0.25;
    if (impact > 4) {
      audio.play('land', { pos: this.pos, vol: clamp(impact / 16, 0.3, 1) });
      g.effects.burst(this.pos, { count: Math.min(24, 6 + impact), colors: this.type === 'board' ? [this.color, 0xffffff] : [0xd8c8a8, 0xbfae8a], speed: 4, size: this.type === 'board' ? 0.18 : 0.4, life: 0.5, grav: this.type === 'board' ? 2 : -0.5, glow: this.type === 'board', up: 0.4 });
      if (this.isPlayerRider) { g.cameraRig.shake(clamp(impact / 40, 0.05, 0.4)); g.input.rumble(0.4, 0.4, 120); }
    }
    if (this.type === 'board' && this.isPlayerRider) {
      // name the trick
      const spins = Math.round(this.spun / Math.PI) * 180;
      const parts = [];
      if (this.flips) parts.push(this.flips > 1 ? `${this.flips}x KICKFLIP` : 'KICKFLIP');
      if (spins >= 180) parts.push(`${spins}`);
      if (this.airT > 1.4) parts.push('BIG AIR');
      if (parts.length) {
        this.sys.hud.trick(parts.join(' + ') + '!', spins >= 720 ? 'INSANE!' : spins >= 360 ? 'Sick!' : 'Nice!');
        this.boost = Math.min(100, this.boost + 15 + spins / 18 + this.flips * 10);
        audio.play('powerUp', { vol: 0.35 });
        g.effects.burst(this.pos, { count: 20, colors: [0xffd34d, 0xff4fd8, 0x18e0ff], speed: 5, size: 0.2, life: 0.5, grav: 3, glow: true, up: 1 });
      }
    }
    this.spun = 0; this.flips = 0; this.trickYaw = Math.round(this.trickYaw / (Math.PI * 2)) * Math.PI * 2;
  }

  // ---------- move with collisions (shape-cast the body, slide along walls, climb ramps) ----------
  move(h) {
    const g = this.game, ph = g.physics, sys = this.sys;
    const delta = _d.copy(this.vel).multiplyScalar(h);
    const shape = sys.castShapes[this.type];
    const exclude = this.rider ? this.rider.collider : null;
    for (let it = 0; it < 3; it++) {
      if (delta.lengthSq() < 1e-10) break;
      const center = _a.set(0, this.def.castY, 0).applyQuaternion(this.quat).add(this.pos);
      let hit = null;
      try { hit = ph.world.castShape(center, this.quat, delta, shape, 0, 1, false, undefined, undefined, exclude || undefined, undefined, sys.pred); } catch { hit = null; }
      if (!hit) { this.pos.add(delta); break; }
      const toi = hit.time_of_impact ?? hit.timeOfImpact ?? hit.toi ?? 1;
      const nv = hit.normal1 || { x: 0, y: 1, z: 0 };
      _n.set(nv.x, nv.y, nv.z);
      if (_n.dot(delta) > 0 && hit.normal2) _n.set(-hit.normal2.x, -hit.normal2.y, -hit.normal2.z);
      if (_n.lengthSq() < 0.5) { this.pos.add(delta); break; }
      _n.normalize();
      // touching something floor-like is the ground probes' job (ramps, slopes, curbs)
      if (toi < 1e-3 && _n.y > 0.6) { this.pos.add(delta); break; }
      this.pos.addScaledVector(delta, Math.max(0, toi - 0.02));
      const vn = this.vel.dot(_n);
      if (vn < 0) {
        const wall = _n.y < 0.6;
        // slide along walls and ride up slanted rocks, but never bounce off with extra energy or get flung up
        this.vel.addScaledVector(_n, -vn);
        if (wall) {
          if (this.vel.y > 7) this.vel.y = 7;
          if (-vn > 8) this.crash(-vn);
        }
      }
      delta.multiplyScalar(1 - toi);
      delta.addScaledVector(_n, -Math.min(0, delta.dot(_n)));
    }
    // safety net: no physics hiccup may ever fling a vehicle faster than it could drive
    const cap = this.def.boostSpeed * 1.35, sp2 = this.vel.lengthSq();
    if (sp2 > cap * cap) this.vel.multiplyScalar(cap / Math.sqrt(sp2));
    // safety nets: never under the terrain, never below the sea floor
    const gy = g.world.groundY(this.pos.x, this.pos.z);
    if (this.pos.y < gy - 0.2) { this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; }
  }

  crash(impact) {
    const g = this.game;
    audio.play('hitMetal', { pos: this.pos, vol: clamp(impact / 20, 0.4, 1) });
    g.effects.burst(this.pos.clone().setY(this.pos.y + 0.6), { count: 12, colors: [0xffd27a, 0xffffff], speed: 5, size: 0.12, life: 0.35, grav: 8, glow: true });
    this.suspV -= 2;
    if (this.isPlayerRider) { g.cameraRig.shake(clamp(impact / 30, 0.15, 0.6)); g.input.rumble(0.7, 0.5, 160); }
    if (impact > 14) this.damage((impact - 14) * (this.type === 'board' ? 2.5 : 4), null);
  }

  // ---------- orientation ----------
  updateQuat(h) {
    const n = this.n;
    this.forward(_f);
    _tf.copy(_f).addScaledVector(n, -_f.dot(n)).normalize();
    _tr.crossVectors(_tf, n).normalize();
    _m.makeBasis(_tr, n, _b.copy(_tf).negate());
    this.quat.setFromRotationMatrix(_m);
    // visual lean / pitch for juice
    const sp = this.speed;
    let pitchT = 0, rollT = 0;
    if (this.type === 'board') { rollT = clamp(this.yawRate * sp * 0.035, -0.45, 0.45); pitchT = this.grounded ? 0 : clamp(this.vel.y * 0.02, -0.25, 0.25); }
    else if (this.type === 'cart') { rollT = clamp(-this.yawRate * sp * 0.012, -0.12, 0.12); pitchT = (this.ctl ? this.ctl.throttle : 0) * 0.04 * (this.grounded ? 1 : 0); }
    else {
      const fwdSpd = this.vel.x * _f.x + this.vel.z * _f.z;
      pitchT = this.grounded ? 0 : -clamp(fwdSpd / this.def.maxSpeed, -1, 1.4) * 0.22;
      rollT = this.grounded ? 0 : clamp(this.yawRate * 0.3, -0.35, 0.35);
    }
    const k = 1 - Math.exp(-8 * h);
    this.pitchVis += (pitchT - this.pitchVis) * k;
    this.rollVis += (rollT - this.rollVis) * k;
    // springy suspension bob (visual only)
    this.suspV += (-120 * this.susp - 9 * this.suspV) * h;
    this.susp = clamp(this.susp + this.suspV * h, -0.25, 0.2);
  }

  // where the mesh is drawn this frame
  syncMesh(dt) {
    const m = this.mesh, u = m.userData, t = this.game.time;
    const parked = !this.rider && !this.awake;
    let lift = this.def.hover + this.susp;
    if (this.type === 'board') lift += parked ? 0.12 + Math.sin(t * 2.2 + this.pos.x) * 0.08 : Math.sin(t * 6) * 0.025;
    m.position.copy(this.pos).addScaledVector(this.n, lift);
    _e.set(this.pitchVis, this.trickYaw, this.rollVis, 'YXZ');
    m.quaternion.copy(this.quat).multiply(_q.setFromEuler(_e));
    const vf = this.vel.dot(this.forward(_f));
    if (u.wheels) {
      this.wheelAng += (vf / 0.3) * dt;
      for (const w of u.wheels) w.rotation.x = -this.wheelAng;
      for (const s of u.steer) s.rotation.y = -this.steerVis * 0.45;
    }
    if (u.deck) u.deck.rotation.z = this.flipT > 0 ? (1 - this.flipT / 0.42) * Math.PI * 2 : 0;
    if (u.rotor) {
      this.rotorAng += this.rotorSpd * 38 * dt;
      u.rotor.rotation.y = this.rotorAng; u.tailRotor.rotation.x = this.rotorAng * 1.6;
      u.blur.material.opacity = clamp((this.rotorSpd - 0.4) * 0.5, 0, 0.28);
    }
    if (u.glow) {
      const k = parked ? 0.55 + Math.sin(t * 3) * 0.25 : 0.6 + clamp(this.speed / 20, 0, 1) * 0.4 + (this.boosting ? 0.4 : 0);
      u.glow.material.opacity = k;
      u.glow.scale.setScalar(this.boosting ? 1.25 : 1);
    }
    if (u.beacon) {
      u.beacon.visible = parked && this.alive;
      if (u.beacon.visible) {
        u.beacon.position.set(this.pos.x, this.pos.y + 0.06, this.pos.z);
        u.beacon.rotation.z = t * 0.8;
        u.beacon.material.opacity = 0.45 + Math.sin(t * 3) * 0.2;
        u.beacon.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
      }
    }
    if (u.beams) u.beams.visible = !!this.rider;
    if (u.lights) for (const l of u.lights) l.material.color.setHex(this.rider ? 0xfff6c0 : 0x9a947a);
  }

  // ---------- damage ----------
  damage(amount, source) {
    if (!this.alive || amount <= 0) return;
    if (source) this.lastAttacker = source;
    this.hp -= amount;
    this.hitFlash = 0.1;
    if (this.isPlayerRider) this.sys.hud.flash();
    if (this.hp <= 0) this.explode();
  }

  explode() {
    if (!this.alive) return;
    const g = this.game, p = this.pos.clone().setY(this.pos.y + 0.8);
    this.alive = false;
    const rider = this.rider;
    if (rider) this.sys.exit(rider, { blast: true });
    g.effects.explosion(p, 4.5, 0xff8a2a);
    audio.explosion(p);
    g.shake(p, 5);
    g.effects.chunks('debris', p, { count: 16, colors: [this.color, 0xffffff, 0x333333], speed: 9, size: 0.3, life: 3, floor: this.pos.y });
    // hurt people standing next to it, but never the driver who just got kicked out
    for (const c of g.chars) {
      if (!c.alive || c === rider) continue;
      const dd = c.center.distanceTo(p);
      if (dd > 6) continue;
      const dir = c.center.sub(p).normalize();
      g.combat.damage(c, 45 * (1 - (dd / 6) * 0.6), { source: this.lastAttacker, explosive: true, point: c.center, dir });
      c.vel.addScaledVector(dir, 8); c.vel.y += 5;
    }
    this.stopSound(0.2);
    this.removePhysics();
    this.mesh.removeFromParent();
    if (this.mesh.userData.beacon) this.mesh.userData.beacon.removeFromParent();
    this.sys.list.splice(this.sys.list.indexOf(this), 1);
  }

  stopSound(fade = 0.4) { if (this.loop) { this.loop.stop(fade); this.loop = null; } }

  // ---------- rider placement + pose (called from character.js hooks) ----------
  get isPlayerRider() { return !!this.rider && this.rider === this.game.player; }

  placeRider(ch) {
    const d = this.def, m = this.mesh;
    _a.set(d.seat[0], d.stand ? 0.06 : d.seat[1], d.seat[2]); // feet on the deck, or hips on the seat
    _a.applyQuaternion(m.quaternion).add(m.position);
    ch.root.position.copy(_a);
    _q2.setFromAxisAngle(UP, d.stand ? Math.PI / 2 : Math.PI);
    ch.root.quaternion.copy(m.quaternion).multiply(_q2);
    ch.root.scale.setScalar(ch.scale);
    const b = ch.bodyFrame; b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1); b.position.set(0, 0, 0);
    ch.bodyYaw = this.yaw;
  }

  poseRider(P, t) {
    if (this.def.stand) {
      // sideways surf stance: knees bent, arms out for balance, looking down the board
      const air = this.grounded ? 0 : 1;
      const crouch = 0.14 + air * 0.12 + (this.boosting ? 0.06 : 0) + clamp(-this.susp, 0, 0.15);
      const k = crouch * 2.2; // deeper crouch = knees further forward
      P.shiftBody(0, -crouch, 0);
      P.leg(1, [0.3, -1, 0.15 + k], [0.12, -1, -0.1 - k * 0.6]);
      P.leg(-1, [0.3, -1, 0.15 + k], [0.12, -1, -0.1 - k * 0.6]);
      const wob = Math.sin(t * 3.1) * 0.08 + this.rollVis * 0.6;
      P.rot('Abdomen', 0.12 + air * 0.15, 0.25, wob * 0.5);
      P.rot('Neck', 0, 0.45, 0); P.rot('Head', 0, 0.45, 0);
      P.arm(1, [0.9, -0.45 + wob, 0.25], [0.7, -0.15 + wob, 0.6]);
      P.arm(-1, [0.9, -0.55 - wob, -0.2], [0.6, -0.5 - wob, 0.3]);
    } else {
      // seated: thighs forward, shins down, hands on the wheel / stick
      P.leg(1, [0.12, -0.06, 1], [0.03, -1, 0.25]);
      P.leg(-1, [0.12, -0.06, 1], [0.03, -1, 0.25]);
      const steer = this.steerVis * 0.08;
      if (this.type === 'cart') {
        P.reach(1, P.point([0.17, 1.12 + steer, 0.42]).clone());
        P.reach(-1, P.point([-0.17, 1.12 - steer, 0.42]).clone());
      } else {
        P.reach(1, P.point([0.14, 0.92, 0.38]).clone());
        P.reach(-1, P.point([-0.14, 0.92, 0.38]).clone());
      }
      P.rot('Head', -0.05, -steer * 4, 0);
    }
  }
}

export class Vehicles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.cur = null;
    this.hud = new VehicleHud(game);
    const ph = game.physics, R = ph.R;
    this.castShapes = {};
    for (const [id, d] of Object.entries(VEHICLES)) this.castShapes[id] = new R.Cuboid(d.cast[0], d.cast[1], d.cast[2]);
    // what counts as solid for wheels and bodies
    this.pred = (col) => {
      if (col.isSensor && col.isSensor()) return false;
      const o = ph.owners.get(col.handle);
      if (!o) return true;
      const k = o.kind;
      if (k === 'char' || k === 'trigger' || k === 'loot' || k === 'item' || k === 'bubble' || k === 'water') return false;
      if (k === 'vehicle' && o.vehicle === this.cur) return false;
      return true;
    };
    this.tex = { glow: glowTexture(), ring: ringTexture() };
    this.mats = {
      dark: new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.7 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.5 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.8, roughness: 0.25 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.8 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }),
    };
  }

  // ---------- spawning ----------
  populate() {
    this.clear();
    this.wrapMap();
    const g = this.game, t = g.world.terrain;
    const cands = [];
    for (const poi of POIS) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        for (const rr of [poi.r + 6, poi.r + 13, poi.r * 0.6]) cands.push({ x: poi.x + Math.cos(a) * rr, z: poi.z + Math.sin(a) * rr, poi: poi.name });
      }
    }
    // city: parking spots beside the roads
    for (let k = -3; k <= 3; k++) for (let j = -3; j <= 3; j++) {
      const r = k * 48 + 3.5, s = j * 48 + 24;
      cands.push({ x: r + 5.5, z: s, poi: 'road', yaw: 0 }, { x: s, z: r + 5.5, poi: 'road', yaw: Math.PI / 2 });
    }
    // a few out in the wild for the long trips
    for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, rr = 60 + Math.random() * (ISLAND_RADIUS - 110); cands.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, poi: 'wild' }); }
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const perPoi = new Map();
    let ci = 0;
    for (const def of Object.values(VEHICLES)) {
      let made = 0;
      for (let tries = 0; tries < cands.length && made < def.count; tries++) {
        const cd = cands[(ci++) % cands.length];
        if (cd.used) continue;
        if ((perPoi.get(cd.poi) || 0) >= (cd.poi === 'road' || cd.poi === 'wild' ? 99 : 3)) continue;
        if (this.list.some((v) => Math.hypot(v.pos.x - cd.x, v.pos.z - cd.z) < (def.fly || v.def.fly ? 24 : 14))) continue;
        const y = this.spotY(cd.x, cd.z, def);
        if (y === null) continue;
        cd.used = true;
        perPoi.set(cd.poi, (perPoi.get(cd.poi) || 0) + 1);
        const yaw = cd.yaw ?? Math.random() * Math.PI * 2;
        this.list.push(new Vehicle(this, def, new THREE.Vector3(cd.x, y, cd.z), yaw, made));
        made++;
      }
    }
    void t;
  }

  // ground height if this is a good open spot for a vehicle (dry, flat, outdoors, nothing in the way)
  spotY(x, z, def) {
    const g = this.game, w = g.world, t = w.terrain, ph = g.physics, R = ph.R;
    if (Math.hypot(x, z) > ISLAND_RADIUS - 35) return null;
    const h = t.heightAt(x, z);
    if (h < 1.2) return null;
    if (t.normalAt(x, z).y < 0.94) return null;
    if (w.inVenue && w.inVenue(x, z, 4)) return null;
    const hit = ph.raycast({ x, y: h + 60, z }, DOWN, 80, null, undefined, (col) => !(col.isSensor && col.isSensor()));
    if (!hit || !hit.owner || hit.owner.kind !== 'terrain' || Math.abs(hit.point.y - h) > 0.5) return null; // roofs, trees, porches
    const big = def.fly ? [2.6, 1.6, 2.6] : [def.col[0] + 0.7, 1.1, def.col[2] + 0.7];
    let blocked = false;
    try {
      ph.world.intersectionsWithShape({ x, y: h + 0.45 + big[1], z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Cuboid(big[0], big[1], big[2]), () => { blocked = true; return false; }, undefined, undefined, undefined, undefined, (col) => {
        const o = ph.owners.get(col.handle);
        return !(col.isSensor && col.isSensor()) && !(o && (o.kind === 'terrain' || o.kind === 'char'));
      });
    } catch { /* query failed: treat as open */ }
    if (blocked) return null;
    // loot spots stay clear so chests aren't hidden behind carts
    for (const s of w.lootSpots) if (Math.abs(s.x - x) < 4 && Math.abs(s.z - z) < 4) return null;
    return hit.point.y;
  }

  clear() {
    for (const v of this.list) {
      if (v.rider) this.exit(v.rider, { quiet: true });
      v.stopSound(0.1);
      v.removePhysics();
      v.mesh.removeFromParent();
      if (v.mesh.userData.beacon) v.mesh.userData.beacon.removeFromParent();
    }
    this.list = [];
    this.hud.hide();
  }

  // ---------- riding ----------
  nearest(ch) {
    if (ch.vehicle || ch.state !== 'ground' || !ch.alive) return null;
    let best = null, bd = Infinity;
    for (const v of this.list) {
      if (!v.alive || v.rider) continue;
      const d = Math.hypot(v.pos.x - ch.pos.x, v.pos.z - ch.pos.z);
      if (d > v.def.interactR || Math.abs(v.pos.y - ch.pos.y) > 2.5) continue;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(ch, v, pc = null) {
    if (!v || !v.alive || v.rider || ch.vehicle) return;
    if (pc) { pc.setBuild(false); pc.ghostOff(); pc.prompt = null; }
    ch.vehicle = v; v.rider = ch; v.awake = true; v.restT = 0;
    v.ctl = { ...IDLE };
    ch.emoting = false; ch.aiming = false; ch.firing = false; ch.slideT = 0; ch.crouching = false;
    ch.useT = 0; ch.useItem = null; ch.reloadT = 0; ch.vel.set(0, 0, 0); ch.visY = undefined;
    const g = this.game;
    if (ch === g.player) {
      v.loop = audio.loop(v.def.sound, { vol: 0 });
      this.hud.show(v);
      g.cameraRig.vLookT = 99;
      g.input.rumble(0.3, 0.3, 100);
    } else v.loop = audio.loop(v.def.sound, { pos: v.pos, range: 60, ref: 6, vol: 0 });
    audio.play('pickupWeapon', { pos: v.pos, vol: 0.8 });
    if (v.type !== 'copter') audio.synth('boardPop', { pos: v.pos, vol: 0.4, rate: 0.8 });
    g.effects.burst(v.pos.clone().setY(v.pos.y + 0.4), { count: 18, colors: [v.color, 0xffffff], speed: 4, size: 0.2, life: 0.45, grav: 1, glow: true });
    g.events.emit('vehicleEnter', ch, v);
  }

  exit(ch, { blast = false, quiet = false } = {}) {
    const v = ch.vehicle;
    if (!v) return;
    ch.vehicle = null; v.rider = null; v.ctl = null; v.awake = true; v.restT = 0; v.drifting = false;
    v.stopSound(0.4);
    const g = this.game;
    if (ch === g.player) this.hud.hide();
    if (quiet) return;
    // find a free spot beside it: left, right, behind, in front, then on top
    const ph = g.physics, R = ph.R;
    v.forward(_f); _r.set(-_f.z, 0, _f.x);
    const w = v.def.col[0] + 0.75, l = v.def.col[2] + 0.75;
    const opts = [[-w, 0], [w, 0], [0, -l], [0, l], [-w, -l], [w, -l]];
    const cap = this._cap || (this._cap = new R.Capsule(0.5, 0.36));
    let spot = null;
    for (const [sx, sz] of opts) {
      const x = v.pos.x + _r.x * sx + _f.x * sz, z = v.pos.z + _r.z * sx + _f.z * sz;
      let y = v.pos.y + 0.1;
      const down = ph.raycast({ x, y: y + 1.5, z }, DOWN, 4, ch.collider, undefined, this.pred);
      if (down && down.point.y > y - 1.5) y = down.point.y + 0.05;
      let blocked = false;
      try {
        ph.world.intersectionsWithShape({ x, y: y + 0.92, z }, { x: 0, y: 0, z: 0, w: 1 }, cap, () => { blocked = true; return false; }, undefined, undefined, ch.collider, undefined, (col) => {
          const o = ph.owners.get(col.handle);
          return !(col.isSensor && col.isSensor()) && !(o && (o.kind === 'char' || o.kind === 'trigger'));
        });
      } catch { /* ignore */ }
      if (!blocked) { spot = new THREE.Vector3(x, y, z); break; }
    }
    if (!spot) spot = v.pos.clone().setY(v.pos.y + v.def.col[1] * 2 + v.def.colY + 0.3);
    ch.setPosition(spot);
    ch.visY = undefined;
    ch.vel.copy(v.vel).multiplyScalar(0.4);
    ch.vel.y = Math.max(ch.vel.y, blast ? 10 : 2.5);
    if (blast) ch.vel.addScaledVector(_r, 4);
    ch.grounded = false; ch.bodyYaw = v.yaw; ch.yaw = g.cameraRig.yaw;
    const height = spot.y - Math.max(g.world.groundY(spot.x, spot.z), WATER);
    if (height > 25) { ch.state = 'skydive'; ch.vel.y = Math.min(ch.vel.y, 0); }
    else if (height > 1.5 || blast) ch.noFallDamage = true;
    ch.bodyFrame.rotation.set(0, 0, 0);
    audio.play('land', { pos: spot, vol: 0.4 });
    g.events.emit('vehicleExit', ch, v);
  }

  // player input while riding (called from PlayerController.update)
  drive(pc, dt, inp) {
    const ch = pc.ch, v = ch.vehicle;
    if (!v) return;
    const c = v.ctl || (v.ctl = { ...IDLE });
    c.throttle = inp.move.y; c.steer = inp.move.x;
    c.boost = inp.down('sprint');
    c.jump = c.jump || inp.pressed('jump'); c.jumpHeld = inp.down('jump');
    c.up = inp.down('jump') || (v.def.fly && inp.down('fire'));
    c.down = inp.down('crouch') || (v.def.fly && inp.down('aim'));
    ch.firing = false; ch.aiming = false; pc.ghostOff();
    if (inp.pressed('fire') && !v.def.fly) { audio.synth('honk', { pos: v.pos, vol: 0.9 }); this.game.events.emit('honk', ch, v); }
    pc.prompt = { verb: 'Hop off', name: v.def.name, target: v };
    if (inp.pressed('interact')) { inp.consume('reload'); this.exit(ch); pc.prompt = null; }
  }

  // explosions push vehicles around and hurt them
  damageRadius(pos, radius, dmg, source) {
    for (const v of [...this.list]) {
      if (!v.alive) continue;
      const c = _c.set(0, v.def.colY, 0).add(v.pos);
      const d = c.distanceTo(pos);
      if (d > radius + 1.5) continue;
      const k = 1 - clamp(d / (radius + 1.5), 0, 1) * 0.6;
      const dir = _a.subVectors(c, pos).normalize();
      v.vel.addScaledVector(dir, 7 * k); v.vel.y += 6 * k;
      v.grounded = false; v.jumpT = 0.2; v.awake = true; v.restT = 0;
      v.damage(dmg * k, source);
    }
  }

  // bullets that hit a vehicle (called from combat.hitWorld)
  hit(v, dmg, source, point) {
    if (!v || !v.alive) return;
    v.damage(dmg, source);
    if (point) this.game.effects.burst(point, { count: 5, colors: [0xffd27a, 0xffffff], speed: 4, size: 0.08, life: 0.25, grav: 9, glow: true });
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.game;
    if (!this.list.length || dt <= 0) return;
    const cam = g.cameraRig.cam.position;
    const steps = Math.max(1, Math.ceil(dt / STEP - 0.01)), h = dt / steps;
    for (const v of [...this.list]) {
      if (!v.alive) continue;
      const ch = v.rider;
      if (ch && (!ch.alive || !g.chars.includes(ch))) { this.exit(ch, { quiet: !ch.alive }); continue; }
      if (v.awake || ch) {
        for (let i = 0; i < steps; i++) v.step(h);
        if (!ch && v.grounded && v.speed < 0.3 && Math.abs(v.vel.y) < 0.5) {
          v.restT += dt;
          if (v.restT > 1) { v.awake = false; v.vel.set(0, 0, 0); v.yawRate = 0; v.boosting = false; }
        } else v.restT = 0;
        v.syncBody();
      } else v.updateQuat(dt); // keeps the suspension spring settling
      if (v.pos.y < -30) { v.explode(); continue; }
      const far = v.pos.distanceToSquared(cam) > 320 * 320;
      v.mesh.visible = !far;
      if (v.mesh.userData.beacon) v.mesh.userData.beacon.visible = !far && !ch && !v.awake;
      if (far) continue;
      v.syncMesh(dt);
      if (ch) {
        // the rider's hit capsule rides along
        _a.set(v.def.seat[0], v.def.stand ? 0.06 : v.def.seat[1], v.def.seat[2]).applyQuaternion(v.quat).add(v.pos).addScaledVector(v.n, v.def.hover);
        ch.setPosition(_a);
        ch.vel.copy(v.vel); ch.grounded = true; ch.swimming = false; ch.slideT = 0; ch.landImpact = 0;
        this.runOver(v, ch);
        this.sound(v);
        if (ch === g.player) this.hud.update(v);
      }
      this.fx(v, dt);
    }
  }

  sound(v) {
    if (!v.loop) return;
    const sp = v.speed, d = v.def;
    if (v.type === 'copter') {
      v.loop.setRate(0.7 + v.rotorSpd * 0.45 + (v.boosting ? 0.15 : 0) + clamp(v.vel.y / 30, -0.05, 0.1));
      v.loop.setVolume(0.15 + v.rotorSpd * 0.45);
    } else {
      const k = clamp(sp / d.boostSpeed, 0, 1);
      v.loop.setRate((v.type === 'board' ? 0.8 : 0.65) + k * (v.type === 'board' ? 0.9 : 1.1) + (v.boosting ? 0.15 : 0) + (v.grounded ? 0 : 0.12));
      v.loop.setVolume((v.type === 'board' ? 0.18 : 0.25) + k * 0.4);
    }
    if (!v.isPlayerRider) v.loop.setPosition(v.pos);
  }

  runOver(v, ch) {
    const sp = v.speed;
    if (v.type === 'copter' || sp < 6) return;
    const g = this.game, t = g.time;
    v.forward(_f);
    _b.copy(v.pos).addScaledVector(_f, v.type === 'cart' ? 0.9 : 0.4);
    for (const c of g.chars) {
      if (c === ch || !c.alive || c.state !== 'ground') continue;
      if (Math.abs(c.pos.y - v.pos.y) > 1.6) continue;
      if (Math.hypot(c.pos.x - _b.x, c.pos.z - _b.z) > (v.type === 'cart' ? 1.5 : 0.9)) continue;
      if ((v.runCd.get(c) || 0) > t) continue;
      v.runCd.set(c, t + 0.8);
      const dmg = v.type === 'cart' ? clamp(sp * 2.2, 15, 60) : 8;
      _a.copy(v.vel).setY(0).normalize();
      g.combat.damage(c, dmg, { source: ch, point: c.center, dir: _a.clone(), kind: 'vehicle' });
      c.vel.addScaledVector(_a, sp * 0.6); c.vel.y = 7; c.grounded = false;
      audio.play('hitHeavy', { pos: c.pos, vol: 0.8 });
      v.suspV -= 1.5;
      if (ch === g.player) g.cameraRig.shake(0.25);
    }
  }

  fx(v, dt) {
    const g = this.game, e = g.effects;
    v.fxT -= dt;
    if (v.fxT > 0) return;
    v.fxT = 0.03;
    const sp = v.speed;
    v.forward(_f); _r.set(-_f.z, 0, _f.x);
    if (v.type === 'board' && (v.rider || v.awake) && sp > 1.5) {
      // neon glow trail from the tail
      _a.copy(v.pos).addScaledVector(_f, -0.7).addScaledVector(v.n, v.def.hover);
      e.burst(_a, { count: v.boosting ? 3 : 1, colors: v.boosting ? [0xffd34d, 0xff7a1a] : [v.color, 0xffffff], end: v.color, speed: 0.6, size: v.boosting ? 0.4 : 0.28, life: 0.45, grav: 0, drag: 3, glow: true });
    }
    if (v.type === 'cart' && v.grounded && v.rider) {
      for (const s of [-1, 1]) {
        _a.copy(v.pos).addScaledVector(_f, -0.85).addScaledVector(_r, s * 0.62).setY(v.pos.y + 0.1);
        if (v.drifting && v.driftCharge > 0.2) e.burst(_a, { count: 2, colors: v.driftCharge > 2 ? [0xff4fd8, 0xffd34d] : v.driftCharge > 0.8 ? [0x48b6ff, 0xffffff] : [0xffd27a], speed: 3, size: 0.12, life: 0.25, grav: 6, glow: true, up: 0.6 });
        else if (sp > 9 && Math.random() < 0.5) e.burst(_a, { count: 1, color: v.inWater ? 0xffffff : 0xcab99a, speed: 1, size: 0.5, life: 0.6, grav: -0.4, drag: 2, grow: 1.5 });
      }
      if (v.boosting) { _a.copy(v.pos).addScaledVector(_f, -1.3).setY(v.pos.y + 0.45); e.burst(_a, { count: 2, colors: [0xffd34d, 0xff7a1a], end: 0x401004, speed: 2, size: 0.3, life: 0.25, grav: -2, glow: true, dir: _f.clone().multiplyScalar(-1.5) }); }
    }
    if (v.type === 'copter' && v.rotorSpd > 0.5) {
      const gy = Math.max(g.world.groundY(v.pos.x, v.pos.z), WATER);
      const hgt = v.pos.y - gy;
      if (hgt < 12 && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        _a.set(v.pos.x + Math.cos(a) * 1.5, gy + 0.2, v.pos.z + Math.sin(a) * 1.5);
        _b.set(Math.cos(a) * 2, 0.1, Math.sin(a) * 2);
        e.burst(_a, { count: 2, color: gy <= WATER + 0.1 ? 0xe8f6ff : 0xd8c8a8, speed: 3 * (1 - hgt / 12), size: 0.5, life: 0.7, grav: -0.3, drag: 1.5, dir: _b, grow: 1.2 });
      }
    }
    // damaged: smoke, then fire
    const k = v.hp / v.def.hp;
    if (k < 0.45 && Math.random() < 0.5) {
      _a.copy(v.pos).addScaledVector(v.n, v.def.colY + 0.4);
      e.burst(_a, { count: 1, color: k < 0.2 ? 0x222222 : 0x777777, speed: 0.8, size: 0.5, life: 1, grav: -2, drag: 1, grow: 1.5 });
      if (k < 0.2) e.burst(_a, { count: 1, colors: [0xffd34d, 0xff7a1a], speed: 0.6, size: 0.35, life: 0.35, grav: -3, glow: true });
    }
  }

  // ---------- minimap icons (wraps the HUD's map drawing without touching hud.js) ----------
  wrapMap() {
    const hud = this.game.hud;
    if (!hud || hud.__vehWrapped || typeof hud.drawMap !== 'function') return;
    const orig = hud.drawMap.bind(hud);
    hud.drawMap = (ctx, size, mini) => {
      orig(ctx, size, mini);
      try { this.drawMap(ctx, size, mini); } catch { /* never break the map */ }
    };
    hud.__vehWrapped = true;
  }

  drawMap(ctx, size, mini) {
    const g = this.game, p = g.player;
    if (!p || !this.list.length) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (mini) {
      const s = size / 280, yaw = g.cameraRig.yaw;
      ctx.beginPath(); ctx.roundRect(0, 0, size, size, 10); ctx.clip();
      ctx.translate(size / 2, size / 2); ctx.rotate(yaw);
      ctx.font = '13px serif';
      for (const v of this.list) {
        if (v.rider === p) continue;
        const x = (v.pos.x - p.pos.x) * s, y = (v.pos.z - p.pos.z) * s;
        if (Math.abs(x) > size / 1.4 || Math.abs(y) > size / 1.4) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-yaw);
        ctx.fillStyle = 'rgba(18,8,46,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(v.def.icon, 0, 1); ctx.restore();
      }
    } else {
      const s = size / 1100;
      ctx.font = '14px serif';
      for (const v of this.list) {
        if (v.rider === p) continue;
        const x = (v.pos.x + 550) * s, y = (v.pos.z + 550) * s;
        ctx.fillStyle = 'rgba(18,8,46,0.5)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(v.def.icon, x, y + 1);
      }
    }
    ctx.restore();
  }

  // ---------- models (all built from shapes in code) ----------
  buildModel(v) {
    const root = new THREE.Group();
    const u = root.userData;
    const paint = new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.4, metalness: 0.15 });
    const M = this.mats;
    const box = (w, h, d, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const cyl = (rt, rb, h, mat, x, y, z, parent = root, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const glowMat = (color, opacity = 0.7) => new THREE.MeshBasicMaterial({ map: this.tex.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    if (v.type === 'board') {
      const deck = new THREE.Group(); root.add(deck); u.deck = deck;
      const shape = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.95, 4, 14), paint);
      shape.rotation.x = Math.PI / 2; shape.scale.set(1, 1, 0.18); shape.castShadow = true; deck.add(shape);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 1.25), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      stripe.position.y = 0.05; deck.add(stripe);
      for (const z of [-0.42, 0.42]) {
        const pod = cyl(0.13, 0.17, 0.12, M.chrome, 0, -0.08, z, deck);
        const core = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: v.color, toneMapped: false }));
        core.rotation.x = Math.PI / 2; core.position.y = -0.065; pod.add(core);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3), glowMat(v.color));
      glow.rotation.x = -Math.PI / 2; glow.position.y = -0.3; glow.renderOrder = 2; root.add(glow); u.glow = glow;
      // pick-me-up ring on the ground while parked
      const beacon = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: this.tex.ring, color: v.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      beacon.rotation.x = -Math.PI / 2; beacon.renderOrder = 2; this.game.scene.add(beacon); u.beacon = beacon;
    } else if (v.type === 'cart') {
      box(1.3, 0.3, 2.35, M.white, 0, 0.5, 0);
      box(1.22, 0.45, 0.6, paint, 0, 0.82, -0.85);              // hood
      box(1.3, 0.12, 2.0, paint, 0, 0.7, 0.15);                  // floor trim
      box(1.1, 0.16, 0.55, M.seat, 0, 0.86, 0.2);                // seat
      box(1.1, 0.55, 0.12, M.seat, 0, 1.15, 0.5);                // seat back
      box(1.36, 0.08, 1.75, paint, 0, 2.02, 0.12);               // roof
      for (const [x, z] of [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.85], [0.6, 0.85]]) cyl(0.035, 0.035, 1.3, M.chrome, x, 1.35, z);
      box(1.2, 0.5, 0.06, M.glass, 0, 1.3, -0.52);                // windshield
      // steering wheel
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), M.dark);
      sw.position.set(0, 1.12, -0.3); sw.rotation.x = -1.0; root.add(sw);
      cyl(0.02, 0.02, 0.35, M.dark, 0, 0.98, -0.42).rotation.x = -0.6;
      // golf bag on the back with clubs
      const bag = cyl(0.17, 0.15, 0.7, new THREE.MeshStandardMaterial({ color: 0xff4a4a, roughness: 0.7 }), 0.3, 1.0, 1.05);
      bag.rotation.x = 0.25;
      for (const dx of [-0.06, 0.05]) cyl(0.015, 0.015, 0.5, M.chrome, dx, 0.5, 0.03, bag);
      // wheels
      u.wheels = []; u.steer = [];
      const tire = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 16).rotateZ(Math.PI / 2);
      for (const [x, z] of [[-0.62, -0.85], [0.62, -0.85], [-0.62, 0.85], [0.62, 0.85]]) {
        const pivot = new THREE.Group(); pivot.position.set(x, 0.3, z); root.add(pivot);
        const wheel = new THREE.Group(); pivot.add(wheel);
        const t = new THREE.Mesh(tire, M.dark); t.castShadow = true; wheel.add(t);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8).rotateZ(Math.PI / 2), M.white); wheel.add(hub);
        u.wheels.push(wheel);
        if (z < 0) u.steer.push(pivot);
      }
      // headlights + soft beams when someone is driving
      u.lights = [];
      const beams = new THREE.Group(); root.add(beams); u.beams = beams;
      for (const x of [-0.4, 0.4]) {
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), new THREE.MeshBasicMaterial({ color: 0xfff6c0, toneMapped: false }));
        l.position.set(x, 0.85, -1.156); l.rotation.y = Math.PI; root.add(l); u.lights.push(l);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 16, 1, true).translate(0, -2.5, 0).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(x, 0.85, -1.2); beams.add(beam);
      }
      // racing number on the hood
      const num = new THREE.Mesh(new THREE.CircleGeometry(0.17, 18), M.white); num.position.set(0, 1.051, -0.85); num.rotation.x = -Math.PI / 2; root.add(num);
    } else {
      // Sport Copter: open cockpit bubble, tail boom, big rotor
      const tub = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), paint);
      tub.scale.set(0.95, 0.85, 1.3); tub.position.set(0, 1.05, 0); tub.castShadow = true; root.add(tub);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), M.glass);
      nose.scale.set(0.95, 0.85, 1.3); nose.position.set(0, 1.05, 0); root.add(nose);
      box(1.5, 0.08, 0.12, M.white, 0, 1.06, 0); // rim stripe
      const boom = cyl(0.16, 0.08, 2.6, paint, 0, 1.2, 2.2); boom.rotation.x = Math.PI / 2;
      box(0.06, 0.7, 0.45, M.white, 0, 1.55, 3.4);  // fin
      box(0.9, 0.06, 0.35, M.white, 0, 1.25, 3.25); // stabilizer
      const tr = new THREE.Group(); tr.position.set(0.1, 1.55, 3.45); root.add(tr); u.tailRotor = tr;
      box(0.03, 0.75, 0.1, M.dark, 0, 0, 0, tr);
      const mast = cyl(0.07, 0.07, 0.6, M.chrome, 0, 2.0, 0.15);
      void mast;
      const rotor = new THREE.Group(); rotor.position.set(0, 2.3, 0.15); root.add(rotor); u.rotor = rotor;
      cyl(0.16, 0.16, 0.12, M.dark, 0, 0, 0, rotor);
      box(4.6, 0.04, 0.26, M.dark, 0, 0.04, 0, rotor);
      box(0.26, 0.04, 4.6, M.dark, 0, 0.04, 0, rotor);
      const blur = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), new THREE.MeshBasicMaterial({ color: 0x222831, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      blur.rotation.x = -Math.PI / 2; blur.position.set(0, 2.36, 0.15); root.add(blur); u.blur = blur;
      // skids
      for (const x of [-0.65, 0.65]) {
        const skid = cyl(0.05, 0.05, 2.2, M.chrome, x, 0.06, 0); skid.rotation.x = Math.PI / 2;
        for (const z of [-0.5, 0.5]) { const s = cyl(0.035, 0.035, 0.55, M.chrome, x * 0.85, 0.32, z); s.rotation.z = x > 0 ? 0.25 : -0.25; }
      }
      box(0.9, 0.12, 0.5, M.seat, 0, 0.62, 0.2);   // seat
      box(0.9, 0.5, 0.1, M.seat, 0, 0.9, 0.48);    // seat back
      cyl(0.03, 0.03, 0.45, M.dark, 0, 0.72, -0.22).rotation.x = -0.4; // control stick
    }
    this.mergeStatic(root, new Set([u.glow, u.blur, ...(u.lights || [])]));
    return root;
  }

  // 40 vehicles x ~25 parts is a lot of draw calls: bake the parts that never move into one mesh per material
  mergeStatic(root, keep) {
    const byMat = new Map();
    for (const o of [...root.children]) {
      if (!o.isMesh || keep.has(o) || o.children.length) continue;
      o.updateMatrix();
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrix);
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!geo.attributes.uv) continue;
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push([o, geo]);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const merged = mergeGeometries(list.map((e) => e[1]), false);
      if (!merged) continue;
      for (const [o] of list) { o.removeFromParent(); o.geometry.dispose(); }
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true; m.receiveShadow = false;
      root.add(m);
    }
  }
}
