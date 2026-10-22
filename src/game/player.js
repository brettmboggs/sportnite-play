import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { MAT_ORDER, PIECES } from './building.js';
import { ULTIMATES } from './weapons/data.js';

// Turns input into actions for the player's character.
export class PlayerController {
  constructor(game, ch) {
    this.game = game;
    this.ch = ch;
    this.buildMode = false;
    this.piece = 'wall';
    this.matIdx = 0;
    this.interactT = 0;
    this.prompt = null;
    this.lastSel = -1;
    this.ultReady = []; // ultimate ids available
    this.footT = 0;
  }

  update(dt) {
    const g = this.game, inp = g.input, ch = this.ch, cam = g.cameraRig;
    if (!ch.alive) { this.ghostOff(); return; }
    cam.addLook(inp.look.x, inp.look.y);
    if (inp.usingPad && !this.buildMode) this.aimAssist(dt);
    ch.yaw = cam.yaw;
    ch.pitch = cam.pitch;
    // riding a vehicle: it gets the controls (steer, boost, hop, hop off)
    if (ch.vehicle && g.vehicles) { g.vehicles.drive(this, dt, inp); if (inp.pressed('map')) g.hud.toggleMap(); return; }

    // ---- mode toggles ----
    if (inp.pressed('build') && ch.state === 'ground') this.setBuild(!this.buildMode);
    for (const [i, p] of PIECES.entries()) if (inp.pressed(p)) { this.setBuild(true); this.piece = PIECES[i]; }
    if (this.buildMode) {
      for (let i = 0; i < 4; i++) if (inp.pressed('slot' + (i + 1))) this.piece = PIECES[i];
      if (inp.pressed('reload')) { this.matIdx = (this.matIdx + 1) % 3; audio.ui('click'); }
      if (inp.pressed('pickaxe') || inp.pressed('slot5')) this.setBuild(false);
    } else {
      for (let i = 0; i < 5; i++) if (inp.pressed('slot' + (i + 1))) this.select(i);
      if (inp.pressed('pickaxe')) this.select(-1);
      if (inp.pressed('swapNext')) this.cycle(1);
      if (inp.pressed('swapPrev')) this.cycle(-1);
    }
    if (inp.pressed('emote') && ch.grounded) { ch.emoting = !ch.emoting; ch.emoteAnim = g.save.data.emote || 'Wave'; if (ch.emoting) g.events.emit('emote', ch); }
    if (ch.emoting && (inp.move.x || inp.move.y || inp.down('fire'))) ch.emoting = false;

    // ---- movement ----
    const intent = {
      mx: inp.move.x, my: inp.move.y,
      sprint: inp.down('sprint') || g.settings.autoSprint,
      jump: inp.pressed('jump'), jumpHeld: inp.down('jump'),
      crouch: inp.down('crouch'), crouchPressed: inp.pressed('crouch'),
      aim: inp.down('aim') && !this.buildMode,
    };
    if (ch.useT > 0 && ch.useItem && ch.useItem.def.use > 1) { intent.sprint = false; intent.mx *= 0.5; intent.my *= 0.5; }
    ch.aiming = intent.aim && ch.state === 'ground';
    ch.move(dt, intent);
    this.footsteps(dt);

    // ---- skills / ultimate ----
    const origin = cam.cam.position.clone();
    const dir = cam.forward(new THREE.Vector3());
    if (inp.pressed('skill1')) g.skills.use(ch, 0, origin, dir);
    if (inp.pressed('skill2')) g.skills.use(ch, 1, origin, dir);
    if (inp.pressed('ultimate') && this.ultReady.length) {
      const id = this.ultReady.shift();
      g.skills.ultimate(ch, id, origin, dir);
    }

    // ---- interact first, so □ (reload + interact on a controller) grabs loot instead of reloading ----
    this.updateInteract(dt, inp, dir);
    if (this.prompt && this.prompt.target) inp.consume('reload');

    // ---- building or shooting ----
    inp.editing = !!g.building.edit;
    if (g.building.editUpdate(this, inp, origin, dir)) { ch.firing = false; this.ghostOff(); } // edit mode (G / hold ◯) owns the input
    else if (this.buildMode) {
      ch.firing = false;
      const spec = g.building.target(ch, this.piece, dir);
      const mat = MAT_ORDER[this.matIdx];
      const ok = g.building.canPlace(spec) && (ch.inv.mats[mat] >= 10 || g.cheats.infiniteMats);
      g.building.showGhost(spec, ok);
      // turbo build: holding fire keeps placing as the target changes
      if (inp.down('fire') && ok) {
        if (g.building.place(ch, spec, mat)) inp.rumble(0.1, 0.2, 30);
      }
      if (inp.pressed('fire') && !ok && ch.inv.mats[mat] < 10) { audio.ui('error'); g.hud.toast(`Not enough ${mat}!`); }
    } else {
      this.ghostOff();
      const held = ch.heldItem();
      if (held && held.type === 'consumable') this.useConsumable(dt, held, inp);
      else {
        ch.useT = 0;
        if (inp.pressed('reload') && held && held.type === 'weapon') g.combat.startReload(ch, held);
        g.combat.updateWeapon(ch, dt, { origin, dir, firing: inp.down('fire'), firePressed: inp.pressed('fire'), isPlayer: true });
      }
    }

    if (inp.pressed('map')) g.hud.toggleMap();
  }

  aimAssist(dt) {
    // gentle pull toward the nearest enemy near the crosshair (controller only)
    const g = this.game, cam = g.cameraRig;
    if (!this.ch.aiming) return;
    const fwd = cam.forward(new THREE.Vector3());
    let best = null, bestDot = 0.985;
    for (const c of g.chars) {
      if (c === this.ch || !c.alive || c.status.invisible > 0) continue;
      const to = c.center.sub(cam.cam.position);
      const d = to.length();
      if (d > 80) continue;
      const dot = to.normalize().dot(fwd);
      if (dot > bestDot) { bestDot = dot; best = c; }
    }
    if (!best) return;
    const to = best.center.sub(cam.cam.position).normalize();
    const yaw = Math.atan2(-to.x, -to.z), pitch = Math.asin(to.y);
    let dy = yaw - cam.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    const k = Math.min(1, dt * 4) * (this.game.settings.aimAssist ?? 1);
    cam.yaw += dy * k * 0.5; cam.pitch += (pitch - cam.pitch) * k * 0.3;
  }

  setBuild(on) {
    if (on === this.buildMode) return;
    this.buildMode = on;
    this.game.input.buildMode = on;
    this.ch.emoting = false;
    if (on) { this.lastSel = this.ch.inv.sel; this.ch.inv.sel = -1; }
    else { this.ch.inv.sel = this.lastSel; this.ghostOff(); }
    audio.ui('select');
    this.game.events.emit('inventory', this.ch);
  }

  ghostOff() { this.game.building.showGhost(null); }

  select(i) {
    const ch = this.ch;
    if (ch.inv.sel === i) return;
    ch.inv.sel = i;
    ch.reloadT = 0; ch.chargeT = 0; ch.spin = 0; ch.useT = 0; ch.burstLeft = 0;
    ch.fireCooldown = Math.max(ch.fireCooldown, 0.15);
    audio.ui('click');
    this.game.events.emit('inventory', ch);
  }

  cycle(d) {
    const slots = [-1, 0, 1, 2, 3, 4];
    let idx = slots.indexOf(this.ch.inv.sel);
    for (let k = 0; k < 6; k++) {
      idx = (idx + d + 6) % 6;
      const s = slots[idx];
      if (s === -1 || this.ch.inv.slots[s]) { this.select(s); return; }
    }
  }

  useConsumable(dt, item, inp) {
    const ch = this.ch, g = this.game, def = item.def;
    ch.firing = false;
    if (inp.down('fire')) {
      // can't use a heal when already full
      if (!ch.useItem) {
        const fullHp = def.heal && !def.shield && ch.health >= (def.maxHeal || 100);
        const fullSh = def.shield && !def.heal && ch.shield >= (def.maxShield || 100);
        if (fullHp || fullSh) { if (inp.pressed('fire')) { g.hud.toast(fullHp ? 'Health is full' : 'Shield is full'); audio.ui('error'); } return; }
        ch.useItem = item; ch.useT = 0;
      }
      ch.useT += dt;
      if (ch.useT >= def.use) {
        this.applyConsumable(ch, item);
        ch.useT = 0; ch.useItem = null;
      }
    } else { ch.useT = 0; ch.useItem = null; }
  }

  applyConsumable(ch, item) {
    if (applyConsumable(this.game, ch, item)) this.cycle(1);
  }

  updateInteract(dt, inp, look) {
    const g = this.game, ch = this.ch;
    const near = ch.state === 'ground' ? g.loot.nearestInteract(ch, look) : null;
    this.prompt = null;
    if (near && near.it !== this.interactTarget) this.interactT = 0;
    this.interactTarget = near && near.it;
    if (near) {
      if (near.type === 'item') {
        const it = near.it.item;
        this.prompt = { verb: 'Pick up', name: it.name, rarity: it.rarity, count: it.count, target: near.it };
        if (inp.pressed('interact')) g.loot.pickup(ch, near.it);
      } else if (near.type === 'chest') {
        const hold = near.it.supply ? 0.8 : 0.35;
        this.prompt = { verb: 'Hold to open', name: near.it.supply ? 'Supply Drop' : near.it.ammoBox ? 'Ammo Box' : near.it.rare ? 'Rare Chest' : 'Chest', progress: this.interactT / hold, target: near.it };
        if (inp.down('interact')) { this.interactT += dt; if (this.interactT >= hold) { g.loot.openChest(ch, near.it, ch); this.interactT = 0; inp.rumble(0.4, 0.4, 120); } }
        else this.interactT = 0;
      } else if (near.type === 'machine') {
        const m = near.it;
        if (m.kind === 'vend') this.prompt = m.sold ? { verb: '', name: 'Sold out' } : { verb: `Buy for ${m.price} gold:`, name: m.item.name, rarity: m.item.rarity };
        else this.prompt = { verb: 'Upgrade held weapon', name: 'Upgrade Bench' };
        this.prompt.target = m;
        if (inp.pressed('interact')) g.hud.toast(g.loot.useMachine(ch, m));
      }
    } else this.interactT = 0;
    // vehicles: hop on a board, cart or copter
    const veh = !near && g.vehicles ? g.vehicles.nearest(ch) : null;
    if (veh) {
      this.prompt = { verb: veh.def.verb, name: veh.def.name, target: veh };
      if (inp.pressed('interact')) g.vehicles.enter(ch, veh, this);
    }
    // mini-game zones
    const mg = g.minigames && g.minigames.zoneAt(ch.pos);
    if (mg && !near) {
      this.prompt = mg.done ? { verb: '', name: `${mg.name} complete!` } : { verb: 'Play', name: mg.name };
      if (inp.pressed('interact') && !mg.done) g.minigames.start(mg);
    }
  }

  footsteps(dt) {
    const ch = this.ch;
    if (!ch.grounded || ch.state !== 'ground') return;
    const sp = Math.hypot(ch.vel.x, ch.vel.z);
    if (sp < 1.5 || ch.crouching) return;
    this.footT -= dt * sp;
    if (this.footT <= 0) {
      this.footT = 2.4;
      const b = this.game.world.terrain.biomeAt(ch.pos.x, ch.pos.z);
      const onBuild = ch.pos.y > this.game.world.groundY(ch.pos.x, ch.pos.z) + 0.6;
      audio.play(onBuild ? 'footWood' : b === 'city' ? 'footHard' : b === 'mountains' && ch.pos.y > 35 ? 'footSnow' : 'footGrass', { vol: 0.25 });
    }
  }

  onKill() {
    const ch = this.ch;
    for (const u of ULTIMATES) if (ch.streak === u.streak) { this.ultReady.push(u.id); this.game.hud.bigMessage(`${u.icon} ${u.name} READY!`, this.game.input.usingPad ? 'Press D-pad ▲' : 'Press U'); audio.jingle('unlock', 0.5); }
  }
}

// Shared by the player and bots. Returns true when the stack ran out.
export function applyConsumable(g, ch, item) {
  const def = item.def;
  if (def.heal) ch.health = Math.max(ch.health, Math.min(def.maxHeal || 100, ch.health + def.heal));
  if (def.shield) ch.shield = Math.max(ch.shield, Math.min(def.maxShield || 100, ch.shield + def.shield));
  if (def.speedBoost) ch.status.speedBoost = def.speedBoost;
  if (def.place) g.placePad(ch, def.place);
  g.effects.burst(ch.center, { count: 16, color: def.color, speed: 2, size: 0.2, life: 0.7, grav: -1 });
  audio.play(def.shield ? 'powerUp' : 'confirm', { pos: ch.pos, vol: 0.7 });
  item.count--;
  let empty = false;
  if (item.count <= 0) { const i = ch.inv.slots.indexOf(item); if (i >= 0) ch.inv.slots[i] = null; empty = true; }
  g.events.emit('inventory', ch);
  return empty;
}
