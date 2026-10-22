import * as THREE from 'three';
import { Rng } from '../engine/noise.js';
import { audio } from '../engine/audio.js';
import { rand, canvasTexture } from '../engine/utils.js';
import { RARITIES, AMMO, CONSUMABLES } from './weapons/data.js';
import { heldModel, applyRarityLook } from './models.js';
import { consumableModel, ammoModel, matsModel, goldModel, chestModel, ammoBoxModel } from './lootModels.js';
import { randomWeapon, randomGun, randomThrowable, randomConsumable, randomSkill, makeWeapon, upgradeWeapon, rollRarity } from './items.js';

const UPGRADE_COST = [100, 200, 300, 450, 700, 1000];
export { UPGRADE_COST };

const PICK_RANGE = 3.0;   // how far away you can grab floor loot
const MAGNET = 3.2;       // ammo / mats / gold fly to you inside this range
const CHEST_FADE = 6;     // seconds an opened chest stays before sinking away
const UP = new THREE.Vector3(0, 1, 0);
const CULL_ITEM = 140, CULL_CHEST = 220; // loot farther than this from the camera isn't drawn
const noShadow = (o) => o.traverse((m) => { if (m.isMesh) m.castShadow = false; });

const emojiTex = new Map();
function emojiSprite(emoji, size = 0.6) {
  if (!emojiTex.has(emoji)) emojiTex.set(emoji, canvasTexture(128, 128, (ctx) => { ctx.font = '96px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji, 64, 70); }));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex.get(emoji), depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

export class Loot {
  constructor(game) {
    this.game = game;
    this.items = [];   // ground pickups
    this.chests = [];
    this.machines = []; // vending + benches
    this.rng = new Rng((Math.random() * 1e9) | 0);
    this.beamGeo = new THREE.CylinderGeometry(0.05, 0.28, 1, 12, 1, true).translate(0, 0.5, 0);
    this.ringGeo = new THREE.RingGeometry(0.34, 0.46, 32).rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(0.5, 32).rotateX(-Math.PI / 2);
    // beams fade out toward the top, the ground glow fades toward its edge
    this.beamFade = canvasTexture(4, 64, (ctx, w, h) => { const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); });
    this.discFade = canvasTexture(64, 64, (ctx, w, h) => { const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); });
    this.tmp = new THREE.Vector3();
  }

  // ---------- spawning ----------
  populate() {
    const w = this.game.world, r = this.rng;
    const used = [];
    for (const s of w.lootSpots) {
      // skip spots that landed on top of each other
      if (used.some((u) => Math.abs(u.x - s.x) < 1.6 && Math.abs(u.z - s.z) < 1.6 && Math.abs(u.y - s.y) < 2)) continue;
      used.push(s);
      const p = this.groundAt(s.x, s.y, s.z);
      if (!p) continue;
      if (s.kind === 'chest') { if (r.chance(0.82)) this.spawnChest(p, r.chance(0.08), s.rot, p.normal); }
      else if (s.kind === 'ammo' || r.chance(0.22)) this.spawnAmmoBox(p, s.rot, p.normal);
      else if (r.chance(0.8)) this.spawnFloorLoot(p);
    }
    for (const v of w.vendSpots) this.spawnMachine('vend', v.x, v.z, v.rot);
    for (const b of w.benchSpots) this.spawnMachine('bench', b.x, b.z, b.rot);
  }

  // The real surface under a loot spot (roof, floor, ground), or null when it's in the water.
  groundAt(x, y, z) {
    const ph = this.game.physics;
    const hit = ph.raycast({ x, y: y + 1.0, z }, { x: 0, y: -1, z: 0 }, 10, null, undefined, (c) => {
      const o = ph.owners.get(c.handle); return !o || (o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'boundary');
    });
    const p = new THREE.Vector3(x, hit ? hit.point.y : this.game.world.groundY(x, z), z);
    if (p.y < 0.5) return null;
    p.normal = hit ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : UP.clone();
    return p;
  }

  spawnFloorLoot(pos) {
    const r = this.rng;
    const roll = r.next();
    // a little cluster, like Fortnite floor loot: the weapon plus its ammo beside it
    const side = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(0.9);
    if (roll < 0.55) { const wpn = randomWeapon(0, r); this.dropItem(wpn, pos); if (wpn.def.ammo) this.dropAmmo(wpn.def.ammo, AMMO[wpn.def.ammo].pickup, this.snap(pos.clone().add(side))); }
    else if (roll < 0.85) this.dropItem(randomConsumable(r), pos);
    else if (roll < 0.93) this.dropItem(randomSkill(r), pos);
    else { const t = r.pick(Object.keys(AMMO)); this.dropAmmo(t, AMMO[t].pickup * 2, pos); }
  }

  snap(p) { p.y = this.surfaceY(p); return p; }

  // Floor pickups share this shell: a model that bobs, a rarity glow disc, a light beam.
  makePickup(root, model, color, rarity, beam = true) {
    const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color, alphaMap: this.discFade, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    disc.position.y = 0.03; root.add(disc);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.04; root.add(ring);
    let b = null;
    if (beam) {
      b = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, alphaMap: this.beamFade, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      b.scale.set(1, 1.0 + rarity * 0.45, 1);
      root.add(b);
    }
    root.add(model);
    return { disc, ring, beam: b };
  }

  dropItem(item, pos, vel = null) {
    const g = this.game;
    const root = new THREE.Group();
    root.position.copy(pos);
    let model, hover = 0.45;
    if (item.type === 'weapon') {
      // weapons lie on their side, floating just off the floor
      const gun = heldModel(item.def); gun.scale.multiplyScalar(1.35); applyRarityLook(gun, item.rarity);
      model = new THREE.Group(); model.add(gun);
      gun.rotation.set(0, Math.PI / 2, 0);
    } else if (item.type === 'consumable') {
      model = new THREE.Group();
      const c = consumableModel(item.id, item.def.color); c.scale.setScalar(1.6); model.add(c);
      hover = 0.3;
    } else if (item.type === 'skill') {
      model = new THREE.Group();
      model.add(emojiSprite(item.def.icon, 0.65));
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xc89cff, emissive: 0x6a2ad6, emissiveIntensity: 0.6, transparent: true, opacity: 0.45, roughness: 0.1, clearcoat: 1 }));
      model.add(orb);
      hover = 0.75;
    } else model = new THREE.Group();
    model.position.y = hover;
    const color = item.rarity === 6 ? 0xffffff : RARITIES[item.rarity].glow;
    const fx = this.makePickup(root, model, color, item.rarity);
    noShadow(root);
    g.scene.add(root);
    const it = { item, root, model, ...fx, hover, pos: root.position, vel: vel ? vel.clone() : null, t: rand(0, 6), kind: 'item', spawnT: g.time };
    if (it.vel) it.model.rotation.z = rand(-1, 1);
    this.items.push(it);
    return it;
  }

  dropSmall(kind, model, pos, vel, extra) {
    const root = new THREE.Group(); root.position.copy(pos);
    model.position.y = 0.05;
    root.add(model);
    noShadow(root);
    this.game.scene.add(root);
    const it = { kind, root, model, pos: root.position, vel: vel ? vel.clone() : null, t: rand(0, 6), auto: true, spawnT: this.game.time, ...extra };
    this.items.push(it);
    return it;
  }

  dropAmmo(type, amount, pos, vel = null) {
    const m = ammoModel(type, AMMO[type].color); m.scale.setScalar(1.4);
    return this.dropSmall('ammo', m, pos, vel, { ammo: type, amount });
  }

  dropMats(mat, amount, pos, vel = null) {
    const m = matsModel(mat); m.scale.setScalar(1.3);
    return this.dropSmall('mats', m, pos, vel, { mat, amount });
  }

  dropGold(amount, pos, vel = null) {
    const m = goldModel(); m.scale.setScalar(1.5);
    return this.dropSmall('gold', m, pos, vel, { gold: amount });
  }

  glowMat(color) {
    this.glowMats ??= new Map();
    if (!this.glowMats.has(color)) {
      const tex = canvasTexture(64, 64, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
      this.glowMats.set(color, new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    }
    return this.glowMats.get(color);
  }

  // stand a container on the surface: face rot, lean a little with the slope, and give it a collider
  placeContainer(root, pos, rot, normal, half) {
    root.position.copy(pos);
    root.position.y -= 0.03;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, (rot ?? this.rng.float(0, Math.PI * 2)) + rand(-0.15, 0.15));
    const n = normal && normal.y > 0.75 ? normal : UP;
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, n.clone().lerp(UP, 0.35).normalize());
    root.quaternion.copy(tilt).multiply(yawQ);
    const ph = this.game.physics;
    const q = root.quaternion;
    const center = new THREE.Vector3(0, half.y, 0).applyQuaternion(q).add(root.position);
    return ph.fixed(ph.R.ColliderDesc.cuboid(half.x, half.y, half.z), { kind: 'container' }, center.x, center.y, center.z, { x: q.x, y: q.y, z: q.z, w: q.w });
  }

  spawnAmmoBox(pos, rot, normal) {
    const { root, lid } = ammoBoxModel();
    const phys = this.placeContainer(root, pos, rot, normal, { x: 0.5, y: 0.25, z: 0.28 });
    this.game.scene.add(root);
    this.chests.push({ root, pos: root.position, opened: false, ammoBox: true, lid, rare: false, phys, t: 0 });
  }

  spawnChest(pos, rare = false, rot, normal) {
    const { root, lid, inner } = chestModel(rare);
    const phys = this.placeContainer(root, pos, rot, normal, { x: 0.55, y: 0.45, z: 0.36 });
    // soft additive glow (much cheaper than a real light) plus a few sparkles that orbit it
    const glow = new THREE.Sprite(this.glowMat(rare ? 0xffb627 : 0xffe08a));
    glow.position.y = 0.6; glow.scale.setScalar(2.6); root.add(glow);
    const sparkles = new THREE.Group();
    for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(this.glowMat(0xfff3b0)); s.scale.setScalar(0.18); s.userData.a = (i / 6) * Math.PI * 2; s.userData.h = rand(0.3, 1.1); sparkles.add(s); }
    root.add(sparkles);
    inner.visible = false;
    this.game.scene.add(root);
    const c = { root, pos: root.position, opened: false, lid, inner, rare, shownRare: rare, glow, sparkles, phys, t: rand(0, 6) };
    this.chests.push(c);
    return c;
  }

  spawnMachine(kind, x, z, rot = null) {
    const y = this.game.world.groundY(x, z);
    const root = new THREE.Group(); root.position.set(x, y, z);
    root.rotation.y = rot ?? this.rng.float(0, Math.PI * 2);
    const q = root.quaternion;
    const R = this.game.physics.R;
    if (kind === 'vend') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.35, metalness: 0.5 }));
      body.position.y = 1.2; body.castShadow = true;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      screen.position.set(0, 1.45, 0.51);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.12, 1.04), new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.8, roughness: 0.25 }));
      trim.position.y = 2.36;
      root.add(body, screen, trim);
      const rarity = Math.min(6, 2 + Math.floor(this.rng.next() * 3) + (this.rng.chance(0.05) ? 2 : 0));
      const item = randomWeapon(0, this.rng); item.rarity = Math.max(item.def.minR, Math.min(item.def.maxR, rarity));
      const w = makeWeapon(item.id, item.rarity);
      const price = [50, 100, 200, 400, 600, 900, 1500][w.rarity];
      const preview = heldModel(w.def); applyRarityLook(preview, w.rarity); preview.scale.multiplyScalar(1.4);
      preview.position.set(0, 2.95, 0); root.add(preview);
      const col = w.rarity === 6 ? 0xffffff : RARITIES[w.rarity].glow;
      screen.material.color.set(col);
      const glow = new THREE.Sprite(this.glowMat(col)); glow.position.set(0, 2.95, 0); glow.scale.setScalar(2.2); root.add(glow);
      this.machines.push({ kind, root, pos: root.position, item: w, price, preview, sold: false, phys: this.game.physics.fixed(R.ColliderDesc.cuboid(0.7, 1.2, 0.5), { kind: 'prop' }, x, y + 1.2, z, { x: q.x, y: q.y, z: q.z, w: q.w }) });
    } else {
      const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 1.1), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }));
      top.position.y = 1; top.castShadow = true; root.add(top);
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.45, 0.45]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshStandardMaterial({ color: 0x5e3b1f })); leg.position.set(sx, 0.5, sz); leg.castShadow = true; root.add(leg); }
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.8, roughness: 0.3 }));
      anvil.position.set(0.3, 1.25, 0); anvil.castShadow = true; root.add(anvil);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb627).multiplyScalar(2) }));
      glow.rotation.x = Math.PI / 2; glow.position.y = 1.6; root.add(glow);
      this.machines.push({ kind, root, pos: root.position, glow, phys: this.game.physics.fixed(R.ColliderDesc.cuboid(1, 0.6, 0.55), { kind: 'prop' }, x, y + 0.6, z, { x: q.x, y: q.y, z: q.z, w: q.w }) });
    }
    this.game.scene.add(root);
  }

  // ---------- chests & drops ----------
  openChest(ch, c, by = null) {
    if (c.opened) return;
    c.opened = true;
    c.openT = 0;
    const g = this.game;
    audio.chestOpen(c.pos);
    if (by && by.isPlayer) audio.jingle('chest', 0.35);
    if (c.glow) c.glow.visible = false;
    if (c.sparkles) c.sparkles.visible = false;
    if (c.inner) c.inner.visible = true;
    const top = c.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    g.effects.burst(top, { count: 40, colors: [0xffd34d, 0xffffff, 0xffb627], speed: 5, size: 0.16, life: 0.9, grav: 4, up: 2 });
    // loot pops out in a fan in front of whoever opened it, like Fortnite
    const facing = ch ? new THREE.Vector3(c.pos.x - ch.pos.x, 0, c.pos.z - ch.pos.z) : new THREE.Vector3(1, 0, 0);
    if (facing.lengthSq() < 0.01) facing.set(1, 0, 0);
    facing.normalize().negate();
    let k = 0;
    const out = () => {
      const a = (k++ - 2) * 0.45 + rand(-0.12, 0.12);
      const d = facing.clone().applyAxisAngle(UP, a).multiplyScalar(rand(2.2, 3.2));
      return new THREE.Vector3(d.x, rand(5, 6.5), d.z);
    };
    const p = c.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    if (c.ammoBox) {
      // the ammo you need most (for the held weapon) plus two random stacks
      const held = ch && ch.heldItem && ch.heldItem();
      const types = [held && held.def && held.def.ammo ? held.def.ammo : this.rng.pick(Object.keys(AMMO)), this.rng.pick(Object.keys(AMMO)), this.rng.pick(Object.keys(AMMO))];
      for (const t of types) this.dropAmmo(t, AMMO[t].pickup * 2, p, out());
      return;
    }
    // every chest: a guaranteed gun + its ammo, a heal/shield, materials and gold, plus random extras.
    // rare chests and supply drops roll better rarities and give more.
    const tier = c.supply ? 2 : c.rare ? 1 : 0;
    const luck = [0.35, 1.2, 3][tier];
    const gun = randomGun(luck, this.rng, [0, 2, 3][tier]);
    this.dropItem(gun, p, out());
    this.dropAmmo(gun.def.ammo, AMMO[gun.def.ammo].pickup * 2, p, out());
    this.dropItem(randomConsumable(this.rng), p, out());
    const extra = () => { const roll = this.rng.next(); return roll < 0.35 ? randomThrowable(this.rng) : roll < 0.6 ? randomSkill(this.rng) : roll < 0.85 ? randomConsumable(this.rng) : randomGun(luck, this.rng, tier); };
    this.dropItem(extra(), p, out());
    if (tier >= 1) { const g2 = randomGun(luck, this.rng, tier + 1); this.dropItem(g2, p, out()); this.dropAmmo(g2.def.ammo, AMMO[g2.def.ammo].pickup * 2, p, out()); }
    if (tier >= 2) { this.dropItem(randomSkill(this.rng), p, out()); this.dropItem(randomConsumable(this.rng), p, out()); }
    this.dropMats(this.rng.pick(['wood', 'wood', 'brick', 'metal']), 30, p, out());
    this.dropGold([this.rng.int(20, 45), 80, 150][tier], p, out());
    g.events.emit('chestOpened', ch, c);
  }

  spawnSupplyDrop(x, z) {
    const g = this.game;
    const gy = g.world.groundY(x, z);
    const root = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x2f6bff, emissive: 0x0a2a8a, emissiveIntensity: 0.4, roughness: 0.4 }));
    crate.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.25, 1.65), new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.8, roughness: 0.3 }));
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.45, 1.65), band.material);
    root.add(crate, band, band2);
    // a big basketball balloon
    const balloon = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 16), new THREE.MeshStandardMaterial({ color: 0xff7a1f, roughness: 0.6 }));
    ball.position.y = 6;
    const lines = new THREE.Mesh(new THREE.TorusGeometry(1.81, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: 0x111111 })); lines.position.y = 6; lines.rotation.y = Math.PI / 2;
    const lines2 = lines.clone(); lines2.rotation.set(Math.PI / 2, 0, 0);
    for (const sx of [-0.7, 0.7]) { const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4.5), new THREE.MeshBasicMaterial({ color: 0xffffff })); rope.position.set(sx, 3, 0); rope.rotation.z = -sx * 0.15; balloon.add(rope); }
    balloon.add(ball, lines, lines2);
    root.add(balloon);
    root.position.set(x, gy + 160, z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 400, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x48b6ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(x, gy + 200, z);
    g.scene.add(root, beam);
    const c = { root, pos: root.position, opened: false, supply: true, falling: true, groundY: gy, beam, balloon, crate: [crate, band, band2], t: 0 };
    this.chests.push(c);
    g.events.emit('supplyDrop', c);
    return c;
  }

  // ---------- vending / bench ----------
  useMachine(ch, m) {
    const g = this.game;
    if (m.kind === 'vend') {
      if (m.sold) return 'Sold out';
      if (ch.inv.gold < m.price) { if (ch.isPlayer) audio.ui('error'); return `Need ${m.price} gold`; }
      ch.inv.gold -= m.price;
      m.sold = true; m.preview.visible = false;
      const front = new THREE.Vector3(0, 0.2, 1.3).applyQuaternion(m.root.quaternion).add(m.pos);
      this.dropItem(m.item, this.snap(front));
      audio.play('powerUp', { pos: m.pos });
      return 'Bought!';
    }
    const w = ch.heldItem();
    if (!w || w.type !== 'weapon' || w.id === 'bat' || w.def.mode === 'throw') return 'Hold a weapon to upgrade';
    if (w.rarity >= (w.def.maxR ?? 6)) return 'Max rarity!';
    const cost = UPGRADE_COST[w.rarity];
    if (ch.inv.gold < cost && !(g.cheats && g.cheats.richMode && ch.isPlayer)) { if (ch.isPlayer) audio.ui('error'); return `Need ${cost} gold`; }
    if (!(g.cheats && g.cheats.richMode && ch.isPlayer)) ch.inv.gold -= cost;
    upgradeWeapon(w);
    ch.heldKey = null;
    audio.play('powerUp', { pos: m.pos, vol: 1 });
    g.effects.burst(m.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 40, colors: [RARITIES[w.rarity].glow, 0xffffff], speed: 5, size: 0.2, life: 0.9, up: 1 });
    g.events.emit('upgrade', ch, w);
    return `Upgraded to ${RARITIES[w.rarity].name}!`;
  }

  // ---------- picking up ----------
  pickup(ch, it) {
    const g = this.game, inv = ch.inv;
    if (it.kind === 'ammo') { inv.ammo[it.ammo] = Math.min(AMMO[it.ammo].max, inv.ammo[it.ammo] + it.amount); }
    else if (it.kind === 'mats') { inv.mats[it.mat] = Math.min(999, inv.mats[it.mat] + it.amount); }
    else if (it.kind === 'gold') { inv.gold += it.gold; }
    else {
      const item = it.item;
      if (item.type === 'skill') {
        let slot = inv.skills.findIndex((s) => !s);
        if (slot < 0) { slot = 0; this.dropItem(inv.skills[0], this.dropSpot(ch)); }
        inv.skills[slot] = item;
      } else {
        // stack throwables/consumables
        const same = inv.slots.find((s) => s && s.id === item.id && (s.type === 'consumable' || s.def.stack) && s.count < (s.def.stack || 1));
        if (same) {
          const room = (same.def.stack || 1) - same.count;
          const k = Math.min(room, item.count);
          same.count += k; item.count -= k;
          if (item.count > 0) { g.events.emit('inventory', ch); return false; }
        } else {
          let slot = inv.slots.findIndex((s) => !s);
          if (slot < 0) {
            // full: swap with the held slot (holding the pickaxe swaps the first slot)
            slot = inv.sel >= 0 ? inv.sel : 0;
            const old = inv.slots[slot];
            this.dropItem(old, this.dropSpot(ch), new THREE.Vector3(0, 3, 0));
          }
          inv.slots[slot] = item;
          // a new gun comes with spare ammo, so you're never holding a gun you can't reload
          if (item.type === 'weapon' && item.def.ammo && item.mag && !item.ammoGiven) {
            item.ammoGiven = true;
            const t = item.def.ammo;
            if (inv.ammo[t] < item.mag * 2) inv.ammo[t] = Math.min(AMMO[t].max, inv.ammo[t] + item.mag * 2);
          }
          if (ch.isPlayer && inv.sel < 0 && item.type === 'weapon') inv.sel = slot;
          if (!ch.isPlayer && inv.sel < 0 && item.type === 'weapon') inv.sel = slot;
        }
      }
    }
    this.removeItem(it);
    if (ch.isPlayer) {
      audio.pickup(it);
      if (it.kind === 'item') { g.input.rumble(0.15, 0.3, 40); g.effects.burst(it.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), { count: 10, color: it.item.rarity === 6 ? 0xffffff : RARITIES[it.item.rarity].glow, speed: 2, size: 0.12, life: 0.4, up: 1 }); }
    }
    g.events.emit('pickup', ch, it);
    g.events.emit('inventory', ch);
    return true;
  }

  // a free spot just in front of the character to drop a swapped item
  dropSpot(ch) {
    const fwd = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw));
    return ch.pos.clone().addScaledVector(fwd, 1).add(new THREE.Vector3(0, 0.6, 0));
  }

  removeItem(it) {
    it.root.removeFromParent();
    const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1);
  }

  dropInventory(ch) {
    const p = ch.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    let k = 0;
    const out = () => { const a = k++ * 2.39996; const r = rand(1.5, 3); return new THREE.Vector3(Math.cos(a) * r, rand(4, 6), Math.sin(a) * r); };
    for (const s of ch.inv.slots) if (s) this.dropItem(s, p, out());
    for (const s of ch.inv.skills) if (s) this.dropItem(s, p, out());
    for (const [t, n] of Object.entries(ch.inv.ammo)) if (n > 0) this.dropAmmo(t, n, p, out());
    for (const [m, n] of Object.entries(ch.inv.mats)) if (n > 0) this.dropMats(m, n, p, out());
    if (ch.inv.gold > 0) this.dropGold(ch.inv.gold, p, out());
    ch.inv.slots = [null, null, null, null, null];
    ch.inv.skills = [null, null];
    ch.inv.gold = 0;
  }

  // Closest interactable for a character. With a look direction (the player), the thing nearest the
  // crosshair wins, so in a pile of loot you get what you're looking at.
  nearestInteract(ch, look = null) {
    let best = null, bestScore = Infinity;
    const c = ch.pos;
    const fx = look ? look.x : 0, fz = look ? look.z : 0, fl = Math.hypot(fx, fz) || 1;
    const consider = (type, it, p, range) => {
      const dx = p.x - c.x, dz = p.z - c.z, dy = p.y - c.y;
      if (dy < -1.6 || dy > 2.2) return;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      let score = d;
      if (look && d > 0.4) score += (1 - (dx * fx + dz * fz) / (d * fl)) * 2.2; // 0 when dead ahead, up to 4.4 behind
      if (score < bestScore) { bestScore = score; best = { type, it }; }
    };
    for (const it of this.items) if (!it.auto && !it.vel) consider('item', it, it.pos, PICK_RANGE);
    for (const ct of this.chests) if (!ct.opened && !ct.falling) consider('chest', ct, ct.pos, PICK_RANGE + 0.3);
    for (const m of this.machines) consider('machine', m, m.pos, PICK_RANGE + 0.6);
    return best;
  }

  update(dt, time) {
    const g = this.game;
    for (const it of this.items) {
      it.t += dt;
      if (it.vel) {
        // arc through the air, then bounce once and settle
        it.vel.y -= 20 * dt;
        // don't fly through walls: bounce off anything solid in the way (houses, builds, props)
        const hx = it.vel.x * dt, hz = it.vel.z * dt, hl = Math.hypot(hx, hz);
        if (hl > 1e-4) {
          const ph = g.physics;
          const wall = ph.raycast({ x: it.pos.x, y: it.pos.y + 0.35, z: it.pos.z }, { x: hx / hl, y: 0, z: hz / hl }, hl + 0.35, null, undefined, (c) => {
            const o = ph.owners.get(c.handle); return !o || (o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'container' && o.kind !== 'boundary');
          });
          if (wall) { it.vel.x *= -0.25; it.vel.z *= -0.25; }
        }
        it.pos.addScaledVector(it.vel, dt);
        const gy = this.surfaceY(it.pos);
        if (it.pos.y <= gy) {
          it.pos.y = gy;
          if (it.vel.y < -4 && !it.bounced) { it.bounced = true; it.vel.set(it.vel.x * 0.35, -it.vel.y * 0.3, it.vel.z * 0.35); }
          else it.vel = null;
        }
        if (it.model) it.model.rotation.x += dt * 6;
      } else if (it.model && it.model.rotation.x) it.model.rotation.x = 0;
      if (it.kind === 'item') {
        it.model.rotation.y += dt * 0.9;
        it.model.position.y = it.hover + Math.sin(it.t * 2.2) * 0.07;
        if (it.model.rotation.z) it.model.rotation.z *= Math.max(0, 1 - dt * 4);
        if (it.beam) it.beam.material.opacity = (0.12 + it.item.rarity * 0.035) * (0.8 + Math.sin(it.t * 3) * 0.2);
        it.ring.scale.setScalar(1 + Math.sin(it.t * 3) * 0.06);
        if (it.item.rarity === 6) { it.ring.material.color.setHSL((time * 0.3) % 1, 1, 0.6); if (it.beam) it.beam.material.color.setHSL((time * 0.3 + 0.2) % 1, 1, 0.6); }
      } else if (!it.vel && !it.homing) {
        it.model.rotation.y += dt * 0.6;
      }
    }
    // ammo / mats / gold: magnet toward anyone close, then collect
    for (const ch of g.chars) {
      if (!ch.alive || ch.state !== 'ground') continue;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (!it.auto || (it.vel && !it.homing) || g.time - it.spawnT < 0.6) continue;
        const dx = ch.pos.x - it.pos.x, dz = ch.pos.z - it.pos.z, dy = ch.pos.y + 0.6 - it.pos.y;
        if (Math.abs(dy) > 2.2) continue;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) { this.pickup(ch, it); continue; }
        if (d < MAGNET && (!it.homing || it.homing === ch)) {
          it.homing = ch;
          const sp = Math.min(d, (6 + (MAGNET - d) * 6) * dt);
          it.pos.x += (dx / d) * sp; it.pos.z += (dz / d) * sp; it.pos.y += dy * Math.min(1, dt * 8);
          it.vel = null;
        } else if (it.homing === ch) it.homing = null;
      }
    }
    this.cull();
    for (const c of this.chests) this.updateChest(c, dt, time);
    if (this.chests.some((c) => c.gone)) this.chests = this.chests.filter((c) => !c.gone);
    for (const m of this.machines) { if (m.preview) { m.preview.rotation.y += dt; m.preview.position.y = 2.95 + Math.sin(time * 2) * 0.08; } if (m.glow) m.glow.rotation.z += dt * 2; }
  }

  // hide far-away loot (it's tiny on screen anyway) to save draw calls; checked a few times a second
  cull() {
    this.cullT = (this.cullT || 0) - 1;
    if (this.cullT > 0) return;
    this.cullT = 8;
    const cam = this.game.cameraRig.cam.position;
    for (const it of this.items) it.root.visible = it.pos.distanceToSquared(cam) < CULL_ITEM * CULL_ITEM;
    for (const c of this.chests) if (!c.supply) c.root.visible = c.pos.distanceToSquared(cam) < CULL_CHEST * CULL_CHEST;
    for (const m of this.machines) m.root.visible = m.pos.distanceToSquared(cam) < CULL_CHEST * CULL_CHEST;
  }

  updateChest(c, dt, time) {
    const g = this.game;
    c.t = (c.t || 0) + dt;
    if (c.falling) {
      c.pos.y -= 9 * dt;
      c.root.rotation.y += dt * 0.3;
      c.root.rotation.z = Math.sin(c.t * 1.3) * 0.06;
      if (c.pos.y <= c.groundY + 0.7) {
        c.pos.y = c.groundY + 0.7; c.falling = false; c.root.rotation.z = 0;
        c.balloon.visible = false;
        g.effects.dust(c.pos, 0xddddcc, 30);
        audio.play('hitHeavy', { pos: c.pos, vol: 1 });
        c.phys = g.physics.fixed(g.physics.R.ColliderDesc.cuboid(0.8, 0.7, 0.8), { kind: 'prop' }, c.pos.x, c.pos.y, c.pos.z);
        // keep pos at floor level for interaction, shift the crate model up to match
        c.pos.y -= 0.7;
        for (const m of c.crate) m.position.y += 0.7;
        c.squash = 0.35;
      }
    }
    if (c.squash > 0) { c.squash = Math.max(0, c.squash - dt); const k = Math.sin(c.squash * 18) * c.squash * 0.5; c.root.scale.set(1 + k, 1 - k, 1 + k); }
    if (c.rare && !c.shownRare && !c.opened && !c.ammoBox && !c.supply) this.makeRare(c);
    if (!c.opened) {
      if (c.glow) c.glow.scale.setScalar(2.4 + Math.sin(time * 4) * 0.4);
      if (c.sparkles) {
        c.sparkles.children.forEach((s) => {
          const a = s.userData.a + time * 1.2;
          s.position.set(Math.cos(a) * 0.75, s.userData.h + Math.sin(time * 3 + s.userData.a) * 0.15, Math.sin(a) * 0.55);
          s.material.opacity = 0.5 + Math.sin(time * 5 + s.userData.a * 3) * 0.5;
        });
      }
      // the lid rattles a little, like it's humming with loot
      if (c.lid && !c.ammoBox) c.lid.rotation.x = -Math.max(0, Math.sin(time * 9 + c.t)) * 0.035;
      return;
    }
    // opened: spring the lid open, then sink away after a while
    c.openT += dt;
    if (c.lid) {
      const target = c.ammoBox ? -1.7 : -1.95;
      const k = Math.min(1, c.openT / 0.35);
      c.lid.rotation.x = target * (1 - Math.cos(k * Math.PI) * 0.5 - 0.5) + Math.sin(Math.min(c.openT, 1) * 16) * 0.12 * Math.max(0, 1 - c.openT * 1.5);
    }
    if (c.inner) c.inner.material.opacity = Math.max(0, 1 - c.openT * 0.4);
    if (c.beam) { c.beam.removeFromParent(); c.beam = null; }
    if (c.openT > CHEST_FADE) {
      if (c.phys) { g.physics.remove(c.phys); c.phys = null; }
      c.root.position.y -= dt * 0.8;
      if (c.openT > CHEST_FADE + 1.5) { c.root.removeFromParent(); c.gone = true; }
    }
  }

  // the Golden Blimp secret flips chests to rare after they spawned
  makeRare(c) {
    const { root, lid, inner } = chestModel(true);
    root.position.copy(c.root.position); root.quaternion.copy(c.root.quaternion);
    if (c.glow) root.add(c.glow);
    if (c.sparkles) root.add(c.sparkles);
    inner.visible = false;
    c.root.removeFromParent();
    this.game.scene.add(root);
    c.root = root; c.pos = root.position; c.lid = lid; c.inner = inner; c.shownRare = true;
  }

  surfaceY(p) {
    const hit = this.game.physics.raycast({ x: p.x, y: p.y + 1.5, z: p.z }, { x: 0, y: -1, z: 0 }, 60, null, undefined, (c) => {
      const o = this.game.physics.owners.get(c.handle); return !o || (o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'boundary' && o.kind !== 'container');
    });
    return hit ? hit.point.y + 0.02 : this.game.world.groundY(p.x, p.z);
  }

  clear() {
    for (const it of this.items) it.root.removeFromParent();
    for (const c of this.chests) { c.root.removeFromParent(); if (c.beam) c.beam.removeFromParent(); if (c.phys) this.game.physics.remove(c.phys); }
    for (const m of this.machines) { m.root.removeFromParent(); if (m.phys) this.game.physics.remove(m.phys); }
    this.items = []; this.chests = []; this.machines = [];
  }
}

export { rollRarity, CONSUMABLES };
