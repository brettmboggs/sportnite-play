import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../engine/utils.js';
import { GROUP, groups } from '../engine/physics.js';
import { PICKAXE } from './weapons/data.js';
import { heldModel, applyRarityLook } from './models.js';
import { applySkin } from './skins.js';
import { applyDance, Poser, POSES, kayY } from './dances.js';
import { buildHero, ClipOverlay } from './heroRig.js';
import { EMOTES } from '../meta/progression.js';
import { BAR_Y, BAR_Z } from './glider.js';

const RADIUS = 0.38, HALF = 0.52; // capsule: total height = 2*(HALF+RADIUS) = 1.8
export const CHAR_HEIGHT = 1.8;
export const EYE = 1.6;

// Fortnite-ish feel: ~1.25 m jump, snappy ground accel, some air control, fall damage past ~10 m
const SWIM_Y = -1.25; // feet height while swimming (water surface is y = 0)
const GRAVITY = 25;
const RUN = 6.2, SPRINT = 8.6, CROUCH = 3.0, ADS = 3.6;
const JUMP_V = 8.6;       // ~1.5 m jump
const FALL_GRAVITY = 1.35; // falling is snappier than rising, so jumps don't feel floaty
const COYOTE = 0.12, JUMP_BUFFER = 0.15; // forgiving jump timing around edges and landings
const FALL_SAFE = 22.5; // landing speed (m/s) before fall damage kicks in (~10 m drop)

// how fast (m/s) the feet travel in each KayKit clip at timeScale 1, measured from the foot bones
const STRIDE = { Running_A: 2.9, Running_B: 3.15, Running_HoldingRifle: 3.15, Running_HoldingBow: 3.15, Running_Strafe_Left: 2.9, Running_Strafe_Right: 2.9, Walking_Backwards: 1.4, Walking_A: 1.2, Sneaking: 0.9 };
const MAX_TS = { Walking_A: 1.9, Sneaking: 3.2, Walking_Backwards: 3.6 };
// melee swing keyframes in the body frame: s = progress, G = hand, d = tip direction
const MELEE_KEYS = [
  { s: 0, G: [-0.2, 1.2, 0.2], d: [-0.12, 0.8, -0.55] }, // resting on the right shoulder
  { s: 0.22, G: [-0.3, 1.45, 0.08], d: [-0.45, 0.75, -0.45] }, // wind up
  { s: 0.5, G: [-0.05, 1.2, 0.5], d: [0.05, 0.05, 1] }, // smack, straight ahead
  { s: 0.75, G: [0.22, 1.0, 0.36], d: [0.8, -0.45, 0.35] }, // follow through to the left
  { s: 1, G: [-0.2, 1.2, 0.2], d: [-0.12, 0.8, -0.55] },
];
const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3(), _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion(), _zero = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1);
const _q6 = new THREE.Quaternion(), _p6 = new THREE.Vector3();
// held items point their tip/barrel along local -Z. KayKit hand slots hold guns with the barrel along +X and
// melee weapons with the shaft along +Y; these turn an item into the slot's frame.
const SLOT_GUN = new THREE.Quaternion().setFromAxisAngle(_yAxis, -Math.PI / 2);
const SLOT_MELEE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)));

let nextId = 1;

export class Character {
  constructor(game, { name, skin, isPlayer = false, pos }) {
    this.game = game;
    this.id = nextId++;
    this.name = name;
    this.isPlayer = isPlayer;
    this.skin = skin;
    this.alive = true;
    this.health = 100; this.maxHealth = 100;
    this.shield = 0; this.maxShield = 100;
    this.overshield = 0;
    this.stamina = 100; this.staminaLock = false; this.staminaDelay = 0;
    this.pos = new THREE.Vector3().copy(pos);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.bodyYaw = 0;
    this.grounded = false;
    this.state = 'ground'; // ground | bus | skydive | glide
    this.crouching = false;
    this.slideT = 0;
    this.aiming = false;
    this.firing = false;
    this.mantleT = 0;
    this.scale = 1;
    this.kills = 0; this.streak = 0;
    this.damageDealt = 0;
    this.status = { burn: 0, burnSrc: null, slow: 0, frozen: 0, poison: 0, poisonSrc: null, bubble: 0, speedBoost: 0, invisible: 0, shocked: 0 };
    this.inv = {
      slots: [null, null, null, null, null],
      sel: -1, // -1 = pickaxe
      ammo: { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 },
      mats: { wood: 0, brick: 0, metal: 0 },
      skills: [null, null],
      gold: 0,
    };
    this.pickaxe = { type: 'weapon', id: 'bat', def: PICKAXE, rarity: 0, perks: [], element: null, dmg: PICKAXE.dmg, rate: PICKAXE.rate, mag: 0, ammoInMag: 0, name: PICKAXE.name };
    this.fireCooldown = 0; this.reloadT = 0; this.useT = 0; this.useItem = null; this.chargeT = 0; this.spin = 0; this.burstLeft = 0;
    this.lastDamagedBy = null; this.lastHitTime = -99;
    this.jumpsLeft = 1;
    this.anim = { current: null };

    this.buildModel();
    this.buildPhysics();
  }

  // ---------- visuals ----------
  buildModel() {
    // KayKit hero (heroRig.js): 1.8 m tall, feet at the origin, facing +Z
    const h = buildHero(this.skin.model);
    const fitted = h.frame;
    this.root = new THREE.Group();
    this.root.add(fitted);
    this.bodyFrame = fitted; // inner frame: tilted for skydiving, squashed on landing
    fitted.rotation.order = 'ZXY';
    this.model = h.object;
    this.materials = h.materials;
    this.bones = h.bones;
    this.handBone = h.handBone;
    this.headBone = h.headBone;
    applySkin(this, this.skin);
    this.poser = new Poser(fitted, this.bones);
    this.poseW = { skydive: 0, dive: 0, glide: 0, air: 0, slide: 0, crouch: 0, mantle: 0 };
    this.mixer = h.mixer;
    this.actions = h.actions;
    this.overlay = new ClipOverlay(this.bones, h.animations);
    this.ovl = null; // one-shot upper-body clip (swing, throw, flinch)
    this.ovArms = 0; // how much a clip overlay owns the arms this frame (hands leave the weapon IK)
    this.grip = [];
    this.play('Idle');
    this.game.scene.add(this.root);
    this.heldObj = null;
    this.heldKey = null;
    this.root.position.copy(this.pos);
  }

  play(name, fade = 0.15, once = false) {
    const a = this.actions[name];
    if (!a || (this.anim.current === name && !once)) return;
    const prev = this.actions[this.anim.current];
    if (prev && prev !== a) prev.fadeOut(fade);
    a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.anim.current = name;
    if (once) this.anim.onceUntil = this.game.time + a.getClip().duration * 0.9;
  }

  playOnce(name, fade = 0.08) {
    // swings, throws and flinches play on the upper body only, so the legs never freeze mid-run
    if (name === 'Sword_Slash') { this.ovl = { name: 'Melee_1H_Attack_Slice_Horizontal', t: 0.72, speed: 1.9, w: 1 }; return; }
    if (name === 'Punch_Right' || name === 'Throw') { this.ovl = { name: 'Throw', t: 0.25, speed: 2.2, w: 1 }; return; }
    if (/^HitRecieve/.test(name)) {
      if (Math.hypot(this.vel.x, this.vel.z) > 1 || this.state !== 'ground') { if (!this.ovl) this.ovl = { name: name === 'HitRecieve' ? 'Hit_A' : 'Hit_B', t: 0, speed: 1.6, w: 0.6 }; return; }
    }
    this.play(name, fade, true);
  }

  // advance and apply the one-shot overlay + the state-driven ones (reload, drinking). Returns how much the
  // overlay owns the arms (0..1)
  applyOverlays(dt, P, item, gun) {
    let arms = 0;
    const o = this.ovl;
    if (o) {
      o.t += dt * o.speed; o.e = (o.e || 0) + dt;
      const dur = this.overlay.duration(o.name);
      if (!dur || o.t >= dur) this.ovl = null;
      else {
        const w = o.w * Math.min(1, o.e * 14, (dur - o.t) * 6);
        this.overlay.apply(P, o.name, o.t, w);
        if (o.w >= 1) arms = Math.max(arms, w);
      }
    }
    if (!this.ovl && item) {
      if (gun && this.reloadT > 0 && item.reload) {
        // reload: the real KayKit reload clip; the gun rides in the right hand for it
        const small = (item.def.model.size || 0.5) < 0.45;
        const name = small ? 'Ranged_1H_Reload' : 'Ranged_2H_Reload';
        const k = clamp(1 - this.reloadT / item.reload, 0, 1);
        const w = Math.min(1, k * 10, (1 - k) * 10);
        this.overlay.apply(P, name, k * this.overlay.duration(name), w);
        arms = Math.max(arms, w);
      } else if (item.type === 'consumable' && this.useT > 0) {
        const dur = this.overlay.duration('Use_Item') || 1;
        const w = Math.min(1, this.useT * 6);
        this.overlay.apply(P, 'Use_Item', 0.35 + (this.useT * 0.8) % (dur * 0.5), w);
        arms = Math.max(arms, w);
      }
    }
    return arms;
  }

  updateHeld() {
    const item = this.heldItem();
    const key = item ? (item.uid ?? item.id) + ':' + item.rarity : 'none';
    if (key === this.heldKey) return;
    this.heldKey = key;
    if (this.heldObj) { this.heldObj.removeFromParent(); this.heldObj = null; }
    if (!item) return;
    let obj = null;
    if (item.type === 'weapon') obj = heldModel(item.def);
    else if (item.type === 'consumable') {
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), new THREE.MeshStandardMaterial({ color: item.def.color, emissive: item.def.color, emissiveIntensity: 0.3 }));
    }
    if (!obj) return;
    applyRarityLook(obj, item.rarity);
    this.heldObj = obj;
    this.game.scene.add(obj);
  }

  heldItem() {
    if (this.inv.sel < 0) return this.pickaxe;
    return this.inv.slots[this.inv.sel];
  }

  // ---------- physics ----------
  buildPhysics() {
    const R = this.game.physics.R;
    const body = this.game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + HALF + RADIUS, this.pos.z));
    const desc = R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(GROUP.CHAR, 0xffff));
    this.collider = this.game.physics.world.createCollider(desc, body);
    this.body = body;
    this.game.physics.owners.set(this.collider.handle, { kind: 'char', char: this });
  }

  setPosition(p) {
    this.pos.copy(p);
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z });
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.9 * this.scale, this.pos.z); }
  get head() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.62 * this.scale, this.pos.z); }

  aimDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // intent: { mx, my (local move -1..1), sprint, jump, jumpHeld, crouch, aim }
  move(dt, intent) {
    const g = this.game;
    const st = this.status;
    if (!this.alive) return;
    if (this.state === 'bus') return;
    let speedMul = 1;
    if (st.slow > 0) speedMul *= 1 - Math.min(0.6, st.slow * 0.15);
    if (st.frozen > 0) speedMul = 0;
    if (st.speedBoost > 0) speedMul *= 1.35;
    if (st.bubble > 0) speedMul = 0.15;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, intent.my).addScaledVector(right, intent.mx);
    if (wish.lengthSq() > 1) wish.normalize();

    if (this.state === 'skydive' || this.state === 'glide') {
      this.airMove(dt, intent, wish);
      return;
    }

    // stamina + sprint
    const moving = wish.lengthSq() > 0.01;
    // sprint never runs out (like current Fortnite); shooting, aiming or crouching drops back to a run
    const sprinting = intent.sprint && moving && intent.my > 0.3 && wish.length() > 0.8 && !intent.aim && !this.crouching && !this.firing;
    this.stamina = 100;
    this.sprinting = sprinting;

    // slide: crouch while sprinting
    if (intent.crouchPressed && this.grounded && (this.sprinting || Math.hypot(this.vel.x, this.vel.z) > 7) && this.slideT <= 0) {
      this.slideT = 0.9;
      this.slideDir = this.vel.clone().setY(0).normalize();
      this.slideSpeed = Math.max(Math.hypot(this.vel.x, this.vel.z), SPRINT) * 1.3;
      g.events.emit('slide', this);
    }
    // let go of crouch to stand up out of a slide early
    if (this.slideT > 0 && this.slideT < 0.65 && intent.crouch === false && !intent.crouchPressed && this.isPlayer) this.slideT = Math.min(this.slideT, 0.05);
    this.crouching = intent.crouch && this.slideT <= 0;

    let speed = intent.aim ? ADS : this.crouching ? CROUCH : sprinting ? SPRINT : RUN;
    if (this.isPlayer && this.game.cheats.turbo) speed *= 1.6;
    speed *= speedMul;
    const target = wish.multiplyScalar(speed);
    if (this.slideT > 0) {
      this.slideT -= dt;
      // fast at first, easing down toward a crouch-walk; steer a little with the stick
      const k = Math.max(0, this.slideT / 0.9);
      const s = (this.slideSpeed || 11) * (0.35 + 0.65 * k * k);
      if (wish.lengthSq() > 0.01) this.slideDir.lerp(_pv.copy(wish).normalize(), Math.min(1, dt * 1.5)).normalize();
      target.copy(this.slideDir).multiplyScalar(s * speedMul);
    }
    // quick to start and stop on the ground, still steerable in the air
    const stopping = wish.lengthSq() < 0.01;
    const accel = this.grounded ? (stopping ? 16 : 22) : 7;
    this.vel.x = damp(this.vel.x, target.x, accel, dt);
    this.vel.z = damp(this.vel.z, target.z, accel, dt);

    // jump / double jump
    const hasDouble = this.inv.skills.some((s) => s && s.id === 'doubleJump');
    if (this.grounded) { this.jumpsLeft = hasDouble ? 2 : 1; this.coyoteT = 0; } else this.coyoteT = (this.coyoteT || 0) + dt;
    // buffer a jump pressed just before landing, and allow one just after running off an edge
    if (intent.jump) this.jumpBuf = JUMP_BUFFER; else this.jumpBuf = Math.max(0, (this.jumpBuf || 0) - dt);
    const canGroundJump = this.grounded || (this.coyoteT < COYOTE && this.vel.y <= 0.5 && this.jumpsLeft >= (hasDouble ? 2 : 1));
    if (this.jumpBuf > 0 && st.frozen <= 0) {
      if (canGroundJump) { this.jumpBuf = 0; this.vel.y = JUMP_V; this.grounded = false; this.jumpsLeft--; this.slideT = 0; this.coyoteT = COYOTE; this.sqv = (this.sqv || 0) + 2.2; g.events.emit('jump', this); }
      else if (intent.jump && this.jumpsLeft > 0 && hasDouble) { this.jumpBuf = 0; this.vel.y = JUMP_V * 0.95; this.jumpsLeft = 0; this.sqv = (this.sqv || 0) + 2; g.events.emit('doublejump', this); }
    }
    // jetpack
    const jet = this.inv.skills.find((s) => s && s.id === 'jetpack');
    this.jetting = false;
    if (jet && intent.jumpHeld && !this.grounded && jet.fuel > 0 && this.vel.y < 6) {
      this.vel.y += 40 * dt; jet.fuel = Math.max(0, jet.fuel - dt); this.jetting = true;
    } else if (jet && this.grounded) jet.fuel = Math.min(jet.def.fuel, jet.fuel + dt * 0.8);

    this.vel.y -= GRAVITY * dt * (st.bubble > 0 ? -0.1 : 1) * (this.game.cheats.moonJump ? 0.35 : 1) * (this.vel.y < 0 && !this.grounded ? FALL_GRAVITY : 1);
    if (st.bubble > 0) this.vel.y = Math.min(this.vel.y, 1.2);

    // mantle: jumping into a ledge that is chest-high
    if (this.vaultT > 0) {
      // hop up over the sill, then carry through the opening
      this.vaultT -= dt;
      const up = this.vaultT > 0.16;
      this.vel.set(this.vaultDir.x * (up ? 2.5 : 6), up ? 6.5 : 0.5, this.vaultDir.z * (up ? 2.5 : 6));
    } else if (this.mantleT > 0) {
      this.mantleT -= dt;
      this.vel.set(fwd.x * 2, 7, fwd.z * 2);
    } else if (!this.grounded && intent.my > 0.5 && this.vel.y < 6 && this.vel.y > -8) {
      this.tryMantle(fwd);
    }
    this.applyMovement(dt);
  }

  tryMantle(fwd) {
    const p = this.game.physics;
    const dir = { x: fwd.x, y: 0, z: fwd.z };
    // vault: something knee-high in front (a window sill, a fence, a crate) with open space above it
    const knee = p.raycast({ x: this.pos.x, y: this.pos.y + 0.45, z: this.pos.z }, dir, 0.85, this.collider);
    if (knee && knee.owner?.kind !== 'char') {
      const chestClear = !p.raycast({ x: this.pos.x, y: this.pos.y + 1.25, z: this.pos.z }, dir, 1.4, this.collider);
      const headClear = !p.raycast({ x: this.pos.x, y: this.pos.y + 1.95, z: this.pos.z }, dir, 1.4, this.collider);
      if (chestClear && headClear) { this.vaultT = 0.32; this.vaultDir = { x: fwd.x, z: fwd.z }; this.game.events.emit('mantle', this); return; }
    }
    const chest = { x: this.pos.x, y: this.pos.y + 1.1, z: this.pos.z };
    const hit = p.raycast(chest, dir, 0.9, this.collider);
    if (!hit) return;
    const above = { x: this.pos.x, y: this.pos.y + 2.4, z: this.pos.z };
    const clear = p.raycast(above, { x: fwd.x, y: 0, z: fwd.z }, 1.3, this.collider);
    if (clear) return;
    this.mantleT = 0.28;
    this.game.events.emit('mantle', this);
  }

  airMove(dt, intent, wish) {
    const groundY = this.game.world.groundY(this.pos.x, this.pos.z);
    const height = this.pos.y - Math.max(groundY, 0);
    if (this.state === 'skydive') {
      const dive = intent.my > 0.5;
      this.diving = dive;
      const fall = dive ? 42 : 26;
      this.vel.y = damp(this.vel.y, -fall, 2, dt);
      const hs = dive ? 22 : 15;
      this.vel.x = damp(this.vel.x, wish.x * hs, 2.5, dt);
      this.vel.z = damp(this.vel.z, wish.z * hs, 2.5, dt);
      if (height < 55 || (intent.jump && height < 200)) { this.state = 'glide'; this.game.events.emit('glide', this); }
    } else {
      this.diving = false;
      this.vel.y = damp(this.vel.y, intent.my > 0.5 ? -9 : -6.5, 3, dt);
      this.vel.x = damp(this.vel.x, wish.x * 15, 2, dt);
      this.vel.z = damp(this.vel.z, wish.z * 15, 2, dt);
    }
    this.applyMovement(dt);
    if (this.grounded) { this.state = 'ground'; this.game.events.emit('land', this); }
  }

  applyMovement(dt) {
    const g = this.game, ctrl = g.kcc;
    // a NaN speed (from some bad math elsewhere) would send the body, and the camera following it, into nowhere
    if (!Number.isFinite(this.vel.x + this.vel.y + this.vel.z)) {
      console.warn('[sportnite] NaN velocity on', this.name, this.state, this.vel.toArray());
      this.vel.set(0, 0, 0);
    }
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z) && this.goodPos) this.setPosition(this.goodPos);
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    ctrl.computeColliderMovement(this.collider, desired, undefined, undefined, (col) => {
      const o = g.physics.owners.get(col.handle);
      return !(o && o.kind === 'char' && (o.char === this || !o.char.alive)) && !(o && o.kind === 'trigger');
    });
    const m = ctrl.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = ctrl.computedGrounded();
    // hit ceiling / landed
    if (this.grounded && this.vel.y < 0) {
      if (!wasGrounded) this.landImpact = -this.vel.y; // read by the visuals and camera for a landing squash/dip
      if (!wasGrounded && this.vel.y < -FALL_SAFE && this.state === 'ground') this.fallDamage(this.vel.y);
      else if (!wasGrounded) this.noFallDamage = false;
      this.vel.y = -1;
    }
    if (!this.grounded && desired.y > 0 && m.y < desired.y * 0.5) this.vel.y = Math.min(this.vel.y, 0);
    const t = this.body.translation();
    const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    if (!Number.isFinite(nx + ny + nz)) { if (this.goodPos) this.setPosition(this.goodPos); return; }
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.set(nx, ny - HALF - RADIUS, nz);
    (this.goodPos ??= new THREE.Vector3()).copy(this.pos);
    // safety: never fall through the terrain
    const gy = g.world.groundY(this.pos.x, this.pos.z);
    if (this.pos.y < gy - 1.5) { this.pos.y = gy + 0.1; this.body.setNextKinematicTranslation({ x: nx, y: this.pos.y + HALF + RADIUS, z: nz }); this.vel.y = 0; }
    // deep water: float with the head above the surface instead of walking on the sea floor
    this.swimming = this.pos.y < SWIM_Y + 0.05 && gy < SWIM_Y;
    if (this.pos.y < SWIM_Y) {
      this.pos.y = SWIM_Y; this.vel.y = Math.max(this.vel.y, 0); this.grounded = true;
      this.body.setNextKinematicTranslation({ x: nx, y: SWIM_Y + HALF + RADIUS, z: nz });
    }
  }

  fallDamage(vy) {
    if (this.noFallDamage || this.game.cheats.moonJump) { this.noFallDamage = false; return; }
    const dmg = Math.min(100, (Math.abs(vy) - FALL_SAFE) * 5.5);
    if (dmg > 3) this.game.combat.damage(this, dmg, { source: null, kind: 'fall', ignoreShield: true });
  }

  // ---------- per-frame visual update ----------
  updateVisual(dt, camPos) {
    if (!this.root.visible && this.alive) return;
    const distSq = camPos ? this.pos.distanceToSquared(camPos) : 0;
    const g = this.game, t = g.time;
    // smooth out small vertical pops (stairs, autostep) so the body never jitters
    if (this.visY === undefined || !this.grounded || Math.abs(this.pos.y - this.visY) > 0.8) this.visY = this.pos.y;
    else this.visY = damp(this.visY, this.pos.y, 22, dt);
    this.root.position.set(this.pos.x, this.visY, this.pos.z);
    this.airT = this.grounded ? 0 : (this.airT || 0) + dt;

    const item = this.heldItem(), def = item && item.def;
    const weapon = item && item.type === 'weapon';
    const gun = !!(weapon && def.mode !== 'melee' && def.mode !== 'throw');
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const moving = hspeed > 0.6;
    const pc = g.playerCtl, building = this.isPlayer && pc && pc.ch === this && pc.buildMode;
    // Fortnite facing: guns/aiming/building face the crosshair; pickaxe & items turn the body to where you run
    const faceAim = this.state !== 'ground' || gun || this.aiming || this.firing || this.swingT > 0 || building;
    let targetYaw = this.bodyYaw;
    if (!this.alive || this.emoting) targetYaw = this.bodyYaw;
    else if (this.slideT > 0 && this.slideDir) targetYaw = Math.atan2(-this.slideDir.x, -this.slideDir.z);
    else if (faceAim) targetYaw = this.yaw - (gun && this.state === 'ground' ? (moving ? 0.2 : 0.42) * (1 - (this.adsT || 0) * 0.5) : 0); // bladed stance: gun shows past the right side
    else if (moving) targetYaw = Math.atan2(-this.vel.x, -this.vel.z);
    const prevYaw = this.bodyYaw;
    if (this.alive) this.bodyYaw = dampAngle(this.bodyYaw, targetYaw, faceAim ? 18 : 11, dt);
    const turnRate = dt > 0 ? Math.atan2(Math.sin(this.bodyYaw - prevYaw), Math.cos(this.bodyYaw - prevYaw)) / dt : 0;
    this.root.rotation.set(0, this.bodyYaw + Math.PI, 0);
    this.root.scale.setScalar(this.scale);

    // ---- pose weights (blend procedural poses in and out) ----
    const W = this.poseW, sky = this.state === 'skydive', glide = this.state === 'glide';
    const tg = {
      skydive: sky && !this.diving, dive: sky && this.diving, glide,
      air: this.alive && this.state === 'ground' && !this.grounded && this.airT > 0.12 && this.mantleT <= 0 && this.slideT <= 0 && !this.emoting,
      slide: this.slideT > 0, crouch: this.crouching && this.grounded && this.slideT <= 0, mantle: this.mantleT > 0,
    };
    for (const k in W) W[k] = damp(W[k], this.alive && tg[k] ? 1 : 0, k === 'air' ? 9 : k === 'crouch' || k === 'slide' ? 14 : 6, dt);

    // ---- whole-body tilt, bank and squash/stretch on the inner frame ----
    const body = this.bodyFrame;
    const tilt = W.skydive * 1.35 + W.dive * 2.05 + W.glide * 0.12;
    let bank = 0;
    if (sky || glide) {
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      bank = -clamp((this.vel.x * r.x + this.vel.z * r.z) / 16, -1, 1) * (sky ? 0.5 : 0.3);
    } else if (this.grounded && moving) bank = clamp(-turnRate * hspeed * 0.012, -0.22, 0.22);
    this.bank = damp(this.bank || 0, bank, 6, dt);
    this.tilt = damp(this.tilt || 0, tilt, 5, dt);
    // landing squash / jump stretch spring
    if (this.landImpact) { this.sqv = (this.sqv || 0) - Math.min(this.landImpact, 30) * 0.09; this.landImpact = 0; }
    this.sq = this.sq || 0; this.sqv = this.sqv || 0;
    this.sqv += (-170 * this.sq - 13 * this.sqv) * Math.min(dt, 0.05); this.sq = clamp(this.sq + this.sqv * Math.min(dt, 0.05), -0.25, 0.2);
    body.rotation.set(this.tilt, 0, this.bank);
    body.scale.set(1 - this.sq * 0.5, 1 + this.sq, 1 - this.sq * 0.5);
    // rotate around the belly, not the feet
    _pv.set(0, 0.95, 0); _pv2.copy(_pv).applyQuaternion(body.quaternion);
    body.position.copy(_pv).sub(_pv2);
    if (this.vehicle) this.vehicle.placeRider(this); // riding: sit/stand on the vehicle (vehicles.js)

    if (this.alive) this.pickAnimation(moving, gun, hspeed);

    // ---- held item: where it sits in the body frame this frame ----
    this.updateHeld();
    const near = distSq < 60 * 60;
    const hold = this.heldObj && this.alive ? this.computeHold(dt, item, gun) : null;

    // animation LOD: far characters animate less often
    this.animAcc = (this.animAcc || 0) + dt;
    const step = distSq > 150 * 150 ? 0.2 : distSq > 60 * 60 ? 0.066 : 0;
    if (this.animAcc >= step) {
      this.poser.restore(); // undo last frame's procedural tweaks so they never pile up
      this.mixer.update(this.animAcc); this.animAcc = 0;
      if (distSq < 150 * 150) this.procedural(dt, t, near ? hold : null, gun);
    }
    if (this.heldObj) {
      const vis = this.root.visible && this.alive && this.state === 'ground' && !this.emoting && !this.hideHeld && !this.vehicle;
      this.heldObj.visible = vis;
      if (vis && hold) {
        body.updateWorldMatrix(true, false);
        const fresh = this._palmT === g.time;
        if (hold.attach && fresh) this.heldObj.position.copy(this._palm);
        else this.heldObj.position.set(hold.G.x, this.poser.kay ? kayY(hold.G.y) : hold.G.y, hold.G.z).applyMatrix4(body.matrixWorld);
        _m4.lookAt(_zero, hold.dir, hold.up);
        this.heldObj.quaternion.setFromRotationMatrix(_m4);
        if (hold.roll) this.heldObj.quaternion.multiply(_q4.setFromAxisAngle(_zAxis, hold.roll));
        this.heldObj.quaternion.premultiply(body.getWorldQuaternion(_q5));
        // a clip that owns the arms (reload, swing, throw, drink) carries the item in the right hand slot
        if (this.ovArms > 0.01 && fresh) {
          _q6.copy(this._slotQ).multiply(gun ? SLOT_GUN : SLOT_MELEE);
          this.heldObj.position.lerp(this._palm, this.ovArms);
          this.heldObj.quaternion.slerp(_q6, this.ovArms);
        }
        this.heldObj.scale.setScalar(this.scale);
      }
    }
    if (this.swingT > 0) this.swingT -= dt;
    // hit flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.12);
      for (const m of this.materials) {
        const b = m.userData.baseEmissive;
        m.emissive.setRGB((b ? b.r : 0) + k * 0.8, (b ? b.g : 0) + k * 0.8, (b ? b.b : 0) + k * 0.8);
      }
    }
  }

  // Where the held item goes, in the body frame (+Z forward, +X left, meters from the feet).
  // Returns { G: grip point, dir: barrel/tip direction, up, R: right wrist target, L: left wrist target | null }
  computeHold(dt, item, gun) {
    const H = this.hold || (this.hold = { G: new THREE.Vector3(), dir: new THREE.Vector3(), up: new THREE.Vector3(), R: new THREE.Vector3(), L: new THREE.Vector3(), useL: false, roll: 0 });
    const def = item.def, W = this.poseW;
    const a = this.aimDir(_h1).applyAxisAngle(_yAxis, -(this.bodyYaw + Math.PI));
    if (this.state !== 'ground') a.set(0, 0, 1);
    const kay = this.poser.kay;
    const drop = -(kay ? 0.14 : 0.32) * W.crouch - (kay ? 0.3 : 0.5) * W.slide; // shoulders go down when crouching/sliding
    this.adsT = damp(this.adsT || 0, this.aiming ? 1 : 0, 14, dt);
    this.sprintT = damp(this.sprintT || 0, this.sprinting && !this.firing && !this.aiming ? 1 : 0, 9, dt);
    // detect a new shot (cooldown jumped up) for a little recoil kick
    if (this.fireCooldown > (this._fc || 0) + 0.02) this.gunKick = 1;
    this._fc = this.fireCooldown;
    this.gunKick = damp(this.gunKick || 0, 0, 12, dt);
    H.roll = 0; H.useL = false; H.attach = !gun;
    if (!this._palm) this._palm = new THREE.Vector3();
    if (item.type === 'weapon' && gun) {
      // ready stance: gun at the right of the chest, pointing at the crosshair; ADS pulls it up to the eye
      const small = (def.model.size || 0.5) < 0.45;
      H.dir.copy(a);
      H.up.set(0, 1, 0).addScaledVector(H.dir, -H.dir.y).normalize();
      // (the rig's arms are short, so the gun sits close to the chest so both hands reach it)
      _h2.set(-0.15 + 0.08 * this.adsT, (this.poser.kay ? 1.22 : 1.33) + 0.12 * this.adsT + drop, 0.0);
      H.G.copy(_h2).addScaledVector(H.dir, small ? 0.27 : 0.17).addScaledVector(H.up, -0.08 + 0.04 * this.adsT);
      // launchers ride up on the shoulder
      if (/Rocket/.test(def.model.file || '')) H.G.addScaledVector(H.up, 0.17).add(_h3.set(-0.03, 0, -0.05));
      // sprinting: gun swung low across the body
      if (this.sprintT > 0.01) {
        _h3.set(0.5, -0.35, 0.8).normalize();
        H.dir.lerp(_h3, this.sprintT).normalize();
        H.G.lerp(_h2.set(-0.1, 1.1 + drop, 0.26), this.sprintT);
        H.up.set(0, 1, 0).addScaledVector(H.dir, -H.dir.y).normalize();
      }
      // recoil: kick back and up
      if (this.gunKick > 0.01) { H.G.addScaledVector(H.dir, -0.07 * this.gunKick); H.dir.addScaledVector(H.up, 0.18 * this.gunKick).normalize(); }
      // reload: tip the gun and pump the off hand to the mag
      const rl = this.reloadT > 0 && item.reload ? 1 - this.reloadT / item.reload : -1;
      if (rl >= 0) H.roll = Math.sin(Math.min(1, rl * 1.2) * Math.PI) * 0.7;
      const front = this.heldObj.userData.front || 0.3;
      H.R.copy(H.G).addScaledVector(H.dir, -0.05).addScaledVector(H.up, -0.03);
      H.useL = true;
      if (small) H.L.copy(H.G).addScaledVector(H.dir, -0.02).addScaledVector(H.up, -0.08).add(_h3.set(0.05, 0, 0));
      else H.L.copy(H.G).addScaledVector(H.dir, Math.min(0.11, front * 0.3)).addScaledVector(H.up, -0.03).add(_h3.set(0.04, 0, 0));
      if (rl >= 0) H.L.copy(H.G).addScaledVector(H.up, -0.18 - 0.05 * Math.sin(rl * 18)).addScaledVector(H.dir, 0.05);
    } else if (item.type === 'weapon' && def.mode === 'melee') {
      // bat on the shoulder; swing = wind-up, smash across the front, follow-through
      const s = this.swingT > 0 ? clamp(1 - this.swingT / 0.3, 0, 1) : -1;
      if (s < 0) { MELEE_KEYS[0].G.forEach((v, i) => H.G.setComponent(i, v)); H.dir.set(...MELEE_KEYS[0].d); }
      else {
        let i = 0; while (i < MELEE_KEYS.length - 2 && s > MELEE_KEYS[i + 1].s) i++;
        const k0 = MELEE_KEYS[i], k1 = MELEE_KEYS[i + 1];
        const f = clamp((s - k0.s) / (k1.s - k0.s), 0, 1), e = f * f * (3 - 2 * f);
        H.G.set(...k0.G).lerp(_h3.set(...k1.G), e);
        H.dir.set(...k0.d).lerp(_h3.set(...k1.d), e);
      }
      // idle breathing / running bob
      H.G.y += drop + Math.sin(this.game.time * 2) * 0.01;
      H.dir.normalize();
      H.up.set(0, 1, 0).addScaledVector(H.dir, -H.dir.y);
      if (H.up.lengthSq() < 1e-4) H.up.set(0, 0, 1);
      H.up.normalize();
      H.R.copy(H.G).addScaledVector(H.dir, -0.04).addScaledVector(H.up, -0.03);
      H.useL = true; H.L.copy(H.G).addScaledVector(H.dir, -0.14).addScaledVector(H.up, -0.03);
    } else {
      // grenades, balls, potions: held in the right hand; drinking lifts it to the mouth
      const using = this.useT > 0;
      H.G.set(-0.22, 1.2 + drop, 0.28);
      H.dir.set(0, 0.3, 1).normalize();
      if (using) { H.G.set(-0.06, 1.5 + drop + Math.sin(this.useT * 9) * 0.015, 0.16); H.dir.set(0.2, 0.9, 0.4).normalize(); }
      else if (this.firing || this.chargeT > 0) { H.G.set(-0.3, 1.62 + drop, -0.12); H.dir.set(0, 0.6, 0.8).normalize(); }
      H.up.set(0, 1, 0).addScaledVector(H.dir, -H.dir.y).normalize();
      H.R.copy(H.G).addScaledVector(H.up, -0.04).addScaledVector(H.dir, -0.06);
    }
    return H;
  }

  // procedural layer on top of the playing clip: poses, aim bend, hands on the weapon
  procedural(dt, t, hold, gun) {
    const P = this.poser.begin(), W = this.poseW;
    if (!this.alive) return;
    if (this.vehicle) { P.w = 1; this.vehicle.poseRider(P, t + this.id); return; }
    if (this.emoting && this.emoteAnim && this.emoteAnim.startsWith('dance:')) {
      this.danceT = (this.danceT || 0) + dt; applyDance(P, this.emoteAnim, this.danceT); return;
    }
    this.danceT = 0;
    const fallK = clamp(-this.vel.y / 10, 0, 1);
    // (KayKit has real crouch clips, so the procedural crouch is only for the old rig)
    for (const k in W) if (W[k] > 0.01 && !(k === 'crouch' && P.kay)) { P.w = W[k]; POSES[k](P, t + this.id, fallK); }
    P.w = 1;
    if (this.state !== 'ground' && W.glide > 0.01 && this.game.glider) {
      // hands up on the glider bar
      const gl = this.game.glider.active.get(this);
      const lift = gl ? gl.userData.open || 0 : 1;
      const bp = P.kay ? P.rawPoint : P.point, by = P.kay ? BAR_Y : 2.12, bz = P.kay ? -BAR_Z : 0.08;
      P.reach(1, bp.call(P, [0.24, by, bz]), [0.6, -0.6, -0.3], W.glide * lift);
      P.reach(-1, bp.call(P, [-0.24, by, bz]), [-0.6, -0.6, -0.3], W.glide * lift);
    }
    this.ovArms = 0;
    if (this.state !== 'ground' || this.emoting) { this.ovl = null; return; }
    const item = this.heldItem();
    this.ovArms = this.applyOverlays(dt, P, item, gun);
    // flinch when hit
    if (this.flashT > 0) P.rot('Abdomen', -this.flashT * 2.5, 0, 0);
    // bend the upper body toward the crosshair; head looks where you look
    const pitch = clamp(this.pitch, -1.1, 1.1);
    const dyaw = clamp(Math.atan2(Math.sin(this.yaw - this.bodyYaw), Math.cos(this.yaw - this.bodyYaw)), -1.2, 1.2);
    if (gun || this.aiming) { P.rot('Abdomen', -pitch * 0.25, 0, 0); P.rot('Torso', -pitch * 0.25, 0, 0); P.rot('Chest', -pitch * 0.2, 0, 0); }
    else P.rot('Torso', -pitch * 0.15, dyaw * 0.2, 0);
    // (KayKit's big head is one bone, so it gets just the head's share and doesn't nod so hard)
    if (!P.kay) P.rot('Neck', -pitch * 0.15, dyaw * 0.25, 0);
    P.rot('Head', -pitch * 0.15, dyaw * (P.kay ? 0.4 : 0.25), 0);
    // melee swing twists the torso
    if (this.swingT > 0) { const s = 1 - this.swingT / 0.3; P.rot('Abdomen', 0.15 * Math.sin(s * Math.PI), -0.6 * Math.sin(s * Math.PI * 1.2 - 0.6), 0); }
    if (!hold || this.hideHeld) return;
    // hands on the weapon (two-bone IK), unless a clip overlay is moving the arms
    const k = (1 - Math.max(W.slide * 0.3, 0)) * (1 - this.ovArms);
    P.reach(-1, P.point(hold.R.toArray()), [-0.5, -1, -0.5], k); P.wrist(-1, (hold.attach ? 0.4 : 0.8) * k);
    if (hold.useL) { P.reach(1, P.point(hold.L.toArray()), [0.6, -1, -0.3], k); P.wrist(1, 0.6 * k); }
    // curl the fingers around the grip
    for (const [b, q, side] of this.grip) if (side === 'R' || hold.useL) { P.save(b); b.quaternion.slerp(q, k); }
    // melee weapons and items sit in the actual palm (a little past the wrist along the forearm)
    if (hold.attach || this.ovArms > 0.01) {
      const slot = this.bones.HandSlotR;
      if (slot) {
        slot.updateWorldMatrix(true, false);
        slot.getWorldPosition(this._palm);
        slot.getWorldQuaternion(this._slotQ || (this._slotQ = new THREE.Quaternion()));
        this._palmT = this.game.time;
      } else {
        const w = this.bones.WristR, e = this.bones.LowerArmR;
        if (w && e) { w.getWorldPosition(this._palm); e.getWorldPosition(_h1); this._palm.addScaledVector(_h1.subVectors(this._palm, _h1).normalize(), 0.07 * this.scale); this._palmT = this.game.time; }
      }
    }
  }

  pickAnimation(moving, gun, hspeed) {
    if (this.vehicle) { this.play(this.vehicle.def.stand ? 'Idle_A' : 'Sit_Chair_Idle', 0.2); return; }
    if (this.anim.onceUntil && this.game.time < this.anim.onceUntil) return;
    this.anim.onceUntil = 0;
    let ts = 1;
    const item = this.heldItem(), def = item && item.def;
    const bow = gun && /bow/i.test(item.id + ' ' + (def.model.file || ''));
    if (this.emoting) {
      const e = this.emoteAnim || 'Wave';
      const em = EMOTES.find((x) => x.id === e);
      this.play(e.startsWith('dance:') ? 'Idle_A' : (em && em.anim) || e);
    } else if (this.state === 'skydive' || this.state === 'glide') this.play('Jump_Idle', 0.3);
    else if (this.slideT > 0) this.play('Crouching', 0.1);
    else if (this.mantleT > 0 || this.vaultT > 0) this.play('Jump_Idle', 0.1);
    else if (!this.grounded && this.airT > 0.12) this.play('Jump_Idle', 0.2);
    else if (!moving) {
      if (this.crouching) this.play('Crouching', 0.2);
      else if (gun) this.play(bow ? 'Ranged_Bow_Idle' : 'Idle_B', 0.2);
      else this.play(def && def.mode === 'melee' && this.isPlayer ? 'Idle_B' : 'Idle_A', 0.25);
    } else {
      // direction relative to where the body faces
      const fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
      const vf = this.vel.x * fx + this.vel.z * fz, vr = this.vel.x * -fz + this.vel.z * fx;
      let name = gun ? (bow ? 'Running_HoldingBow' : 'Running_HoldingRifle') : 'Running_A';
      if (this.crouching) name = 'Sneaking';
      else if (hspeed < 3.2) name = vf < -0.5 ? 'Walking_Backwards' : 'Walking_A';
      else if (Math.abs(vr) > Math.abs(vf) * 1.2) name = vr > 0 ? 'Running_Strafe_Right' : 'Running_Strafe_Left';
      else if (vf < -0.5) name = 'Walking_Backwards';
      this.play(name, 0.18);
      // match the leg cycle to the real speed so feet don't skate
      ts = clamp(hspeed / STRIDE[name], 0.6, MAX_TS[name] || 2.8);
    }
    const a = this.actions[this.anim.current];
    if (a && !this.anim.onceUntil) a.timeScale = ts;
  }

  muzzle(out = new THREE.Vector3()) {
    if (this.heldObj && this.heldObj.visible) {
      out.copy(this.heldObj.position).addScaledVector(this.aimDir(), (this.heldObj.userData.front || 0.45) * this.scale);
      return out;
    }
    return out.copy(this.head);
  }

  setVisible(v) { this.root.visible = v; if (this.heldObj) this.heldObj.visible = v; }

  destroy() {
    this.game.scene.remove(this.root);
    if (this.heldObj) this.heldObj.removeFromParent();
    this.game.physics.owners.delete(this.collider.handle);
    this.game.physics.world.removeRigidBody(this.body);
  }
}
