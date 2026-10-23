import * as THREE from 'three';
import { Renderer } from '../engine/renderer.js';
import { AutoQuality, QUALITY_LEVELS } from '../engine/autoquality.js';
import { rimUniforms } from '../engine/stylize.js';
import { physics } from '../engine/physics.js';
import { Input } from '../engine/input.js';
import { Effects } from '../engine/effects.js';
import { audio } from '../engine/audio.js';
import { assets, HERO_FILES } from '../engine/assets.js';
import { rand } from '../engine/utils.js';
import { World, POIS } from '../world/world.js';
import { BIOMES } from '../world/terrain.js';
import { Combat } from './combat.js';
import { Building } from './building.js';
import { Loot } from './loot.js';
import { Skills } from './skills.js';
import { CameraRig } from './camera.js';
import { PlayerController } from './player.js';
import { Match } from './match.js';
import { Director } from './director.js';
import { Character } from './character.js';
import { animateSkin, SKIN_BY_ID } from './skins.js';
import { WEAPONS } from './weapons/data.js';
import { makeWeapon, setLuckBonus } from './items.js';
import { Save } from '../meta/save.js';
import { addXp } from '../meta/progression.js';
import { Hud } from '../ui/hud.js';
import { Menu } from '../ui/menu.js';
import { Lobby } from '../ui/lobby.js';
import { Minigames } from './minigames.js';
import { Secrets } from './secrets.js';
import { Glider } from './glider.js';
import { Vehicles } from './vehicles.js';

class Events {
  constructor() { this.map = new Map(); }
  on(e, fn) { if (!this.map.has(e)) this.map.set(e, []); this.map.get(e).push(fn); return () => this.off(e, fn); }
  off(e, fn) { const l = this.map.get(e); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  emit(e, ...a) { const l = this.map.get(e); if (l) for (const fn of [...l]) fn(...a); }
}

export class Game {
  constructor() {
    this.events = new Events();
    this.chars = [];
    this.time = 0;
    this.state = 'loading';
    this.cheats = {};
    this.pads = [];
  }

  async init(onProgress) {
    this.save = new Save();
    this.settings = this.save.data.settings;
    this.renderer = new Renderer(document.getElementById('game'));
    this.scene = this.renderer.scene;
    this.input = new Input(this.renderer.dom);
    onProgress(0.05, 'Starting physics');
    await physics.init();
    this.physics = physics;
    this.kcc = physics.world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.enableAutostep(0.55, 0.25, false);
    this.kcc.enableSnapToGround(0.5);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc.setCharacterMass(1);

    onProgress(0.1, 'Loading heroes');
    assets.onProgress = (d, t) => onProgress(0.1 + 0.6 * (d / Math.max(t, 1)), 'Loading 3D models');
    const heroLoad = assets.loadAll(HERO_FILES);
    const weaponFiles = [...new Set(Object.values(WEAPONS).map((w) => w.model.file).filter(Boolean))];
    await Promise.all([heroLoad, assets.loadAll(weaponFiles)]);
    this.world = new World(this.scene, physics);
    this.world.pois = POIS;
    this.world.cam = this.renderer.camera;
    await this.world.build((msg) => onProgress(0.75, msg));
    onProgress(0.9, 'Getting the crowd ready');
    this.effects = new Effects(this.scene);
    this.combat = new Combat(this);
    this.building = new Building(this);
    this.loot = new Loot(this);
    this.skills = new Skills(this);
    this.cameraRig = new CameraRig(this);
    this.director = new Director(this.save);
    this.minigames = new Minigames(this);
    this.secrets = new Secrets(this);
    this.glider = new Glider(this);
    this.vehicles = new Vehicles(this);
    this.hud = new Hud(this);
    // A weak or overheated graphics chip can crash ("context lost") and leave a white or black screen for good.
    // Step the graphics down one level and reload, so the game comes back by itself.
    this.renderer.dom.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[sportnite] graphics chip crashed (WebGL context lost) on', this.renderer.quality);
      const s = this.settings, i = QUALITY_LEVELS.indexOf(this.renderer.quality);
      if (s.quality === 'auto') s.autoLevel = QUALITY_LEVELS[Math.max(0, i - 1)];
      this.save.write();
      const msg = document.createElement('div');
      msg.textContent = '⚙️ Graphics hiccup! Turning graphics down and restarting...';
      msg.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#12082e;color:#fff;font:24px sans-serif;z-index:99999';
      document.body.appendChild(msg);
      setTimeout(() => location.reload(), 2000);
    });
    this.lobby = new Lobby(this);
    this.menu = new Menu(this);
    this.applySettings();
    this.wireEvents();
    this.input.onPadChange = (name) => {
      if (name) { this.hud.toast(`🎮 ${name} connected!`); this.input.rumble(0.3, 0.3, 150); }
      else this.hud.toast('🎮 Controller disconnected');
    };
    this.input.checkPad();
    this.input.onPauseRequest = () => { if (this.state === 'match' && !this.minigames.active) this.menu.showPause(); };
    onProgress(1, 'Ready!');
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.padSensitivity = s.padSensitivity;
    this.input.padLookX = s.padLookX ?? 1;
    this.input.padLookY = s.padLookY ?? 1;
    this.input.padDeadzone = s.padDeadzone ?? 0.12;
    this.input.vibration = s.vibration ?? true;
    this.cameraRig.padAdsSens = s.padAdsSens ?? 0.6;
    this.input.invertY = s.invertY;
    this.cameraRig.fovBase = s.fov;
    if (s.quality === 'auto') {
      this.autoQuality ??= new AutoQuality(s.autoLevel);
      if (this.renderer.quality !== this.autoQuality.level) this.renderer.setQuality(this.autoQuality.level);
    } else {
      this.autoQuality = null;
      this.renderer.setQuality(s.quality);
    }
    audio.volume = { master: s.master, sfx: s.sfx, music: s.music };
    audio.applyVolume();
    this.save.write();
  }

  // ---------- characters ----------
  addChar(c) { this.chars.push(c); }
  setPlayer(c) { this.player = c; this.playerCtl = new PlayerController(this, c); this.cameraRig.yaw = 0; }

  spawnDecoy(owner) {
    const d = new Character(this, { name: owner.name, skin: owner.skin, pos: owner.pos.clone() });
    d.isDecoy = true; d.state = 'ground';
    d.health = 50; d.yaw = owner.yaw;
    d.inv.slots[0] = owner.heldItem() && owner.heldItem().type === 'weapon' && owner.heldItem().id !== 'bat' ? makeWeapon(owner.heldItem().id, owner.heldItem().rarity) : null;
    d.inv.sel = d.inv.slots[0] ? 0 : -1;
    d.decoyDir = new THREE.Vector3(-Math.sin(owner.yaw), 0, -Math.cos(owner.yaw));
    this.addChar(d);
    return d;
  }
  removeDecoy(d) {
    if (!this.chars.includes(d)) return;
    this.effects.burst(d.center, { count: 30, color: 0xb45cff, speed: 4, size: 0.3, life: 0.6 });
    d.destroy();
    this.chars.splice(this.chars.indexOf(d), 1);
  }

  placePad(ch, kind) {
    const fwd = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw));
    const p = ch.pos.clone().addScaledVector(fwd, 2.5);
    p.y = this.loot.surfaceY(p);
    const color = kind === 'launchpad' ? 0xffb627 : 0x7dff5a;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.25, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    mesh.position.copy(p).add(new THREE.Vector3(0, 0.12, 0));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.position.y = 0.5; mesh.add(arrow);
    this.scene.add(mesh);
    this.pads.push({ kind, mesh, pos: p, cd: new Map() });
  }

  updatePads(dt) {
    for (const pad of this.pads) {
      pad.mesh.children[0].position.y = 0.5 + Math.sin(this.time * 4) * 0.15;
      for (const c of this.chars) {
        if (!c.alive || c.state !== 'ground') continue;
        if (Math.hypot(c.pos.x - pad.pos.x, c.pos.z - pad.pos.z) < 1.3 && Math.abs(c.pos.y - pad.pos.y) < 1) {
          if ((pad.cd.get(c) || 0) > this.time) continue;
          pad.cd.set(c, this.time + 1);
          if (pad.kind === 'launchpad') { c.vel.y = 60; c.state = 'skydive'; c.grounded = false; }
          else { c.vel.y = 21; c.grounded = false; c.noFallDamage = true; }
          audio.play('phaser', { pos: c.pos, vol: 0.9 });
          this.effects.burst(pad.pos, { count: 20, color: 0xffffff, speed: 5, size: 0.2, life: 0.5, up: 2 });
        }
      }
    }
    void dt;
  }

  shake(pos, radius = 4) {
    if (!this.player) return;
    const d = this.player.pos.distanceTo(pos);
    if (d < radius * 6) { this.cameraRig.shake(Math.max(0, 1 - d / (radius * 6)) * 0.8); this.input.rumble(0.8, 0.6, 200); }
  }

  // ---------- events → stats/UI ----------
  wireEvents() {
    const ev = this.events;
    ev.on('damage', (e) => {
      if (e.source === this.player && e.target !== this.player) {
        audio.hitmarker(e.headshot, { shield: e.shieldDmg > 0, broke: e.shieldDmg > 0 && e.target.shield <= 0 && e.target.overshield <= 0 });
        if (this.match) { this.match.stats.damage += e.amount; this.match.track('damage', e.amount); if (e.headshot) { this.match.stats.headshots++; this.match.track('headshot'); } }
      }
      if (e.target === this.player) { this.hud.damaged(e.source, e.amount); this.input.rumble(0.5, 0.3, 100); }
    });
    ev.on('elim', (e) => {
      this.hud.killfeed(e);
      if (e.victim.isDecoy) return;
      if (e.killer === this.player) {
        if (this.match) { this.match.stats.kills++; this.match.track('elim'); if (e.victim.isBoss) { this.match.stats.bossKills++; this.save.data.stats.bossKills++; } }
        this.hud.elimBanner(e.victim, e.headshot);
        this.playerCtl.onKill();
        audio.elim(e.headshot);
      }
      if (e.victim.isBoss) this.bossDefeated(e.victim);
      if (e.victim === this.player) { this.playerCtl.ghostOff(); this.player.streak = 0; }
      if (e.killer && e.killer.isPlayer === false && e.killer.streak) { /* bots also get streak ultimates occasionally */ if (e.killer.streak === 5 && e.killer.brain) this.skills.ultimate(e.killer, 'megashield'); }
      if (this.match) this.hud.updateAlive(this.match.alive().length);
    });
    ev.on('chestOpened', (ch) => { if (ch === this.player && this.match) { this.match.stats.chests++; this.match.track('chest'); } });
    ev.on('build', (ch) => { if (ch === this.player && this.match) { this.match.stats.built++; this.match.track('build'); } });
    ev.on('harvest', (ch, mat, n) => { if (ch === this.player && this.match) { this.match.stats.harvested += n; this.match.track('harvest', n); this.hud.harvestPop(mat, n); } });
    ev.on('upgrade', (ch) => { if (ch === this.player && this.match) this.match.track('upgrade'); });
    ev.on('land', (ch) => { this.skills.landed(ch); if (ch === this.player) audio.play('land', { vol: 0.6 }); });
    ev.on('glide', (ch) => this.glider.open(ch));
    ev.on('supplyDrop', () => { this.hud.toast('🎁 A Supply Drop is falling! Look for the blue beam!'); });
    ev.on('matchOver', (m) => this.onMatchOver(m));
    ev.on('playerJumped', () => this.hud.toast(this.input.usingPad ? 'Press ✕ to open your glider early. Push the left stick forward to dive!' : 'Press SPACE to open your glider early. Hold W to dive!'));
  }

  bossDefeated(boss) {
    const p = boss.pos.clone().add(new THREE.Vector3(0, 1, 0));
    const ids = ['minigun', 'chicken', 'lightningGun', 'golfSniper', 'rocket', 'sword'];
    const w = makeWeapon(ids[Math.floor(Math.random() * ids.length)], Math.random() < 0.15 ? 6 : 5);
    this.loot.dropItem(w, p, new THREE.Vector3(0, 6, 0));
    this.effects.confetti(boss.center, 150);
    this.hud.bigMessage(`👑 ${boss.name} DEFEATED!`, 'A Mythic weapon dropped!');
  }

  // ---------- match lifecycle ----------
  // Potato graphics also means fewer bots: their brains and bodies are a big part of the work on a slow laptop
  matchBots() {
    return this.renderer.quality === 'potato' ? Math.min(this.settings.bots, 20) : this.settings.bots;
  }

  startMatch(opts = {}) {
    audio.init();
    this.clearMatch();
    this.renderer.renderPass.scene = this.scene;
    this.lobby.hide();
    this.state = 'match';
    const o = { bots: this.matchBots(), difficulty: this.settings.difficulty, ...opts };
    this.autoQuality?.reset();
    this.match = new Match(this, o);
    this.botDamageMul = this.director.damageMul(o.difficulty);
    setLuckBonus(this.cheats.rainbowLoot ? 4 : 0);
    this.loot.populate();
    this.vehicles.populate();
    this.secrets.spawnTrophies();
    this.match.start();
    this.hud.show();
    this.hud.updateAlive(this.match.alive().length);
    this.input.wantLock = true;
    this.input.requestLock();
    this.input.enabled = true;
    if (this.secrets.goldenBlimp()) this.hud.bigMessage('✨ GOLDEN BLIMP! ✨', 'Every chest is a rare chest this match!');
    this.cameraRig.yaw = Math.atan2(-this.match.busDir.x, -this.match.busDir.z);
    this.warmup();
    const diff = { easy: '🟢 EASY', normal: '🟡 NORMAL', hard: '🟠 HARD', insane: '🔥 INSANE' }[o.difficulty] || `🧠 COACH (${Math.round(this.director.rating * 100)}/100)`;
    this.hud.toast(`Difficulty: ${diff}`);
  }

  // Build every shader up front (hidden characters, gliders, loot) so nothing stutters the first time it
  // appears, like jumping out of the blimp. Runs in the background while the blimp flies.
  warmup() {
    const shown = [];
    const extra = new THREE.Group();
    for (const id of ['classic', 'ocean', 'jungle', 'candy', 'ghost']) { try { extra.add(this.glider.make(id)); } catch { /* unknown glider */ } }
    this.scene.add(extra);
    this.scene.traverse((o) => { if (!o.visible) { o.visible = true; shown.push(o); } });
    const r = this.renderer.renderer, cam = this.renderer.camera;
    // the programs are created inside this call; the GPU finishes linking them in the background, so
    // everything can be hidden again right away (no frame is drawn in between)
    if (r.compileAsync) r.compileAsync(this.scene, cam).catch(() => {});
    else r.compile(this.scene, cam);
    // draw everything once into a tiny offscreen target so every model and texture is uploaded to the GPU now
    const culled = [];
    this.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.warmTarget);
    r.render(this.scene, cam);
    r.setRenderTarget(prev);
    for (const o of culled) o.frustumCulled = true;
    for (const o of shown) o.visible = false;
    extra.removeFromParent();
  }

  // Same as startMatch, but shows a quick "get ready" screen while the match loads, so the lobby
  // doesn't just freeze for a second after pressing Play.
  startMatchWithLoader(opts = {}) {
    let el = document.getElementById('match-loader');
    if (!el) {
      el = document.createElement('div');
      el.id = 'match-loader';
      el.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(circle at 50% 40%,#7b2cff,#2a0a4a);color:#fff;font-family:"Luckiest Guy",sans-serif;transition:opacity .35s;pointer-events:none';
      el.innerHTML = '<div style="font-size:64px;letter-spacing:2px;text-shadow:0 6px 0 #1a0630">GET READY!</div><div style="font-size:22px;opacity:.85">Boarding the Sportnite Blimp...</div>';
      document.body.appendChild(el);
    }
    el.style.opacity = '1';
    // two frames so the screen actually shows before the heavy work starts
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.startMatch(opts);
      setTimeout(() => { el.style.opacity = '0'; }, 250);
    }));
  }

  // Mini-game practice from the menu: just you at the venue
  startPractice(type) {
    audio.init();
    this.clearMatch();
    this.renderer.renderPass.scene = this.scene;
    this.lobby.hide();
    this.state = 'match';
    const zone = this.world.minigames.find((z) => z.type === type);
    const skin = SKIN_BY_ID[this.save.data.skin];
    const p = new Character(this, { name: this.save.data.name, skin, isPlayer: true, pos: new THREE.Vector3(zone.x, zone.y + 0.1, zone.z) });
    p.state = 'ground';
    this.addChar(p);
    this.setPlayer(p);
    this.hud.show();
    this.input.wantLock = true;
    this.input.requestLock();
    this.input.enabled = true;
    this.renderer.camera.fov = 70;
    this.minigames.start(zone, true);
    audio.startMusic('lobby');
  }

  clearMatch() {
    for (const c of this.chars) c.destroy();
    this.chars = [];
    this.player = null; this.playerCtl = null;
    this.building.clear();
    this.loot.clear();
    this.skills.clear();
    this.glider.clear();
    this.vehicles.clear();
    for (const p of this.combat.projectiles) p.mesh.removeFromParent();
    this.combat.projectiles = [];
    for (const z of this.combat.zones) if (z.mesh) z.mesh.removeFromParent();
    this.combat.zones = [];
    for (const pad of this.pads) pad.mesh.removeFromParent();
    this.pads = [];
    this.secrets.clear();
    if (this.match) this.match.dispose();
    this.match = null;
    this.storm = null;
    this.slowmo = null;
  }

  onMatchOver(m) {
    const d = this.save.data;
    d.stats.matches++;
    d.stats.kills += m.stats.kills;
    d.stats.damage += Math.round(m.stats.damage);
    if (m.won) d.stats.wins++;
    if (m.placement <= 10) d.stats.top10++;
    const cheated = Object.values(this.cheats).some(Boolean);
    const unlocks = cheated ? [] : addXp(this.save, m.stats.xp);
    if (!cheated) d.coins += m.stats.coins;
    const delta = cheated ? 0 : this.director.record(m);
    this.save.write();
    audio.stopMusic();
    if (m.won) { audio.jingle('win', 0.8); audio.startMusic('victory'); this.player.emoting = true; this.player.emoteAnim = d.emote; }
    else audio.stinger('defeat');
    setTimeout(() => this.hud.results(m, unlocks, delta, cheated), m.won ? 2500 : 1800);
  }

  returnToLobby() {
    this.input.wantLock = false;
    this.input.releaseLock();
    this.clearMatch();
    this.minigames.stop(true);
    this.state = 'lobby';
    this.hud.hide();
    this.lobby.show();
    this.menu.showMain();
    audio.startMusic('lobby');
  }

  // ---------- main loop ----------
  start() {
    this.state = 'lobby';
    this.lobby.show();
    this.menu.showMain();
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      this.rawDt = (now - last) / 1000; // real frame time (auto graphics measures with this)
      let dt = Math.min(0.05, this.rawDt);
      last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  frame(dt) {
    if (!(dt >= 0)) dt = 0; // the very first frame can come out slightly negative
    this.healLighting();
    this.input.update(dt);
    this.time += dt;
    if (this.state === 'lobby') {
      this.renderer.resetGrade();
      this.lobby.update(dt);
      this.renderer.render(dt);
      return;
    }
    if (this.state === 'paused') { this.renderer.render(0); return; }
    if (this.minigames.active) {
      if (this.player && this.player.model) this.player.model.visible = true; // mini-game cameras frame the player on purpose
      this.minigames.update(dt);
      this.updateWorld(dt);
      this.renderer.render(dt);
      this.hud.update(dt);
      return;
    }
    this.updateMatch(dt);
    this.renderer.render(dt);
    this.updateAutoQuality();
  }

  updateAutoQuality() {
    if (!this.autoQuality || this.state !== 'match') return;
    const level = this.autoQuality.update(this.rawDt);
    if (!level) return;
    this.renderer.setQuality(level);
    this.settings.autoLevel = level; // next time the game starts at the level that worked
    this.save.write();
    this.hud.toast(`⚙️ Graphics auto-set to ${level[0].toUpperCase() + level.slice(1)} to keep it smooth`);
  }

  updateWorld(dt) {
    this.world.drawScale = this.renderer.drawScale;
    this.world.update(dt, this.time);
    this.effects.update(dt);
    this.building.update(dt);
    this.loot.update(dt, this.time);
    this.combat.updateProjectiles(dt);
    this.skills.update(dt);
    this.updatePads(dt);
    this.glider.update(dt);
    this.vehicles.update(dt);
    this.secrets.update(dt);
    this.physics.step(dt);
    for (const crowd of this.world.crowds || []) this.animateCrowd(crowd);
  }

  animateCrowd(crowd) {
    const m = new THREE.Matrix4();
    const hype = this.minigames.active ? 1 : 0.4;
    for (let i = 0; i < crowd.base.length; i += 1) {
      m.copy(crowd.base[i]);
      m.elements[13] += Math.max(0, Math.sin(this.time * 6 + i * 1.7)) * 0.25 * hype;
      crowd.mesh.setMatrixAt(i, m);
    }
    crowd.mesh.instanceMatrix.needsUpdate = true;
  }

  updateMatch(dt) {
    const m = this.match, p = this.player;
    if (!m || !p) return;
    m.update(dt);
    // player
    if (m.phase === 'bus' && p.state === 'bus') {
      this.cameraRig.addLook(this.input.look.x, this.input.look.y);
      const cam = this.cameraRig.cam;
      const yaw = this.cameraRig.yaw + 0.9;
      const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      cam.position.copy(m.blimp.position).addScaledVector(back, -110).add(new THREE.Vector3(0, 25 - this.cameraRig.pitch * 50, 0));
      cam.lookAt(m.blimp.position);
      if (this.input.pressed('jump')) m.jump(p);
    } else if (!m.over || p.alive) {
      this.playerCtl.update(dt);
    }
    // bots (slow-mo affects everyone but its owner)
    for (const c of this.chars) {
      if (c === p) continue;
      const cdt = this.slowmo && this.slowmo.owner !== c ? dt * 0.35 : dt;
      if (c.brain) c.brain.update(cdt);
      else if (c.isDecoy && c.alive) c.move(cdt, { mx: 0, my: 1, sprint: true, jump: Math.random() < 0.01 });
      if (c.isDecoy && c.decoyDir) c.yaw = Math.atan2(-c.decoyDir.x, -c.decoyDir.z);
    }
    for (const c of this.chars) {
      if (!c.alive) continue;
      this.combat.updateStatus(c, dt);
      this.skills.tick(c, dt);
    }
    this.updateWorld(this.slowmo && this.slowmo.owner === p ? dt : dt);
    // camera
    const camPos = this.cameraRig.cam.position;
    if (p.state !== 'bus') {
      if (p.alive) {
        const held = p.heldItem();
        const scope = p.aiming && held && held.def && held.def.scope ? held.def.scope : 0;
        this.cameraRig.update(dt, p, { aiming: p.aiming, scope, skydive: p.state === 'skydive' || p.state === 'glide', sprint: p.sprinting });
      } else {
        // spectate whoever got us (or just orbit our body)
        const t = this.spectateTarget();
        this.cameraRig.update(dt, t, { dead: true });
      }
    }
    for (const c of this.chars) {
      c.updateVisual(dt, camPos);
      animateSkin(c, this.time);
      if (c.status.invisible > 0) for (const mat of c.materials) { mat.transparent = true; mat.opacity = c === p ? 0.35 : 0.06; }
      else if (c.materials[0] && c.materials[0].transparent) for (const mat of c.materials) { mat.transparent = false; mat.opacity = 1; }
      // hide far-away characters behind fog to save GPU
      if (c.alive && c.state !== 'bus') c.root.visible = c.pos.distanceToSquared(camPos) < (700 * this.renderer.viewScale) ** 2;
      // an enemy pressed right up against the camera would cover the whole screen: hide them for that moment
      if (c !== p && c.model) c.model.visible = camPos.distanceTo(c.center) > 1.1 * (c.scale || 1);
    }
    // like Fortnite: when the camera gets squeezed up against your own character (boxed in by builds, back to a
    // wall), fade your body out so it never fills the screen
    if (p.model) {
      const k = p.scale || 1;
      const d = Math.min(camPos.distanceTo(p.head), camPos.distanceTo(p.center) * 1.25) / k;
      let a = p.alive && p.state === 'ground' ? Math.min(1, Math.max(0, (d - 0.85) / 0.75)) : 1;
      if (p.status.invisible > 0) a = Math.min(a, 0.35);
      p.model.visible = a > 0.05;
      for (const mat of p.materials) {
        if (a < 0.999) { mat.transparent = true; mat.opacity = a; mat.depthWrite = a > 0.6; }
        else if (mat.transparent) { mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; }
      }
      if (a < 0.6 && p.heldObj) p.heldObj.visible = false;
    }
    // shadows + audio listener follow the camera target
    this.renderer.followShadow(p.alive ? p.pos : camPos);
    audio.setListener(camPos, this.cameraRig.forward(new THREE.Vector3()));
    audio.update(dt, this);
    // storm screen tint
    const out = m.storm && m.storm.phase >= 0 && p.alive && p.state === 'ground' ? m.storm.distanceOutside(p.pos) : -999;
    this.renderer.vignette.uniforms.uStorm.value = out > 0 ? 1 : Math.max(0, 1 + out / 8) * 0.3;
    this.renderer.vignette.uniforms.uDamage.value = Math.max(0, this.renderer.vignette.uniforms.uDamage.value - dt * 2);
    this.renderer.vignette.uniforms.uFreeze.value = p.status.frozen > 0 ? 0.8 : p.status.slow > 0 ? 0.3 : 0;
    this.biomeLighting(dt);
    this.hud.update(dt);
  }

  spectateTarget() {
    const k = this.player.lastDamagedBy;
    if (k && k.alive) return k;
    const alive = this.chars.find((c) => c.alive && !c.isBoss);
    return alive || this.player;
  }

  // The sky, fog and light colours below ease toward their targets every frame, so a single NaN (from a broken
  // camera or physics glitch) would stick forever and turn the whole picture white or black, even in the lobby.
  // Remember the good starting values and put them back if anything ever goes bad.
  healLighting() {
    const r = this.renderer, vu = r.vignette.uniforms, fog = this.scene.fog;
    const vals = () => [fog.color.r, fog.color.g, fog.color.b, fog.near, fog.far, r.sun.intensity, r.hemi.intensity,
      r.hemi.color.r, r.hemi.groundColor.r, r.skyUniforms.top.value.r, r.skyUniforms.horizon.value.r,
      vu.uSat.value, vu.uContrast.value, vu.uStorm.value, vu.uDamage.value, vu.uFreeze.value,
      r.renderer.toneMappingExposure, rimUniforms.uRimStrength.value, rimUniforms.uRimColor.value.r];
    if (!this.goodLight) {
      this.goodLight = {
        fog: fog.color.clone(), near: fog.near, far: fog.far, sun: r.sun.intensity, hemi: r.hemi.intensity,
        hc: r.hemi.color.clone(), hg: r.hemi.groundColor.clone(), top: r.skyUniforms.top.value.clone(),
        hor: r.skyUniforms.horizon.value.clone(), rim: rimUniforms.uRimStrength.value, rimC: rimUniforms.uRimColor.value.clone(),
      };
    }
    if (Number.isFinite(vals().reduce((a, b) => a + b, 0))) return;
    console.warn('[sportnite] lighting went NaN, restoring it', { cam: this.cameraRig.cam.position.toArray(), player: this.player?.pos?.toArray(), state: this.state });
    const L = this.goodLight;
    fog.color.copy(L.fog); fog.near = L.near; fog.far = L.far;
    r.sun.intensity = L.sun; r.hemi.intensity = L.hemi; r.hemi.color.copy(L.hc); r.hemi.groundColor.copy(L.hg);
    r.skyUniforms.top.value.copy(L.top); r.skyUniforms.horizon.value.copy(L.hor);
    rimUniforms.uRimStrength.value = L.rim; rimUniforms.uRimColor.value.copy(L.rimC);
    vu.uStorm.value = 0; vu.uDamage.value = 0; vu.uFreeze.value = 0;
    r.resetGrade();
  }

  // blend sky/fog colors per biome: spooky purple fog in the haunted forest, pink sky in candyland
  biomeLighting(dt) {
    const cp = this.cameraRig.cam.position;
    if (!Number.isFinite(cp.x + cp.y + cp.z)) return; // a broken camera would poison every colour below
    const b = this.world.terrain.biomeWeights(this.cameraRig.cam.position.x, this.cameraRig.cam.position.z);
    const mix = (key, a) => {
      const out = new THREE.Color(0, 0, 0);
      for (const [k, w] of Object.entries(b)) out.add(new THREE.Color(a[k]).multiplyScalar(w));
      return out;
    };
    const fog = mix('fog', { city: 0xcfe8ff, mountains: 0xe6f2ff, candy: 0xffd6f0, jungle: 0xc8f0d0, haunted: 0x6a5a8a });
    const top = mix('top', { city: 0x2f8cff, mountains: 0x4a9cff, candy: 0xff7ac8, jungle: 0x2fa0ff, haunted: 0x2a1a4a });
    const hor = mix('hor', { city: 0xbfe6ff, mountains: 0xe0f0ff, candy: 0xffd1ec, jungle: 0xc8f5ff, haunted: 0x7a5a9a });
    const k = Math.min(1, dt * 1.5);
    this.scene.fog.color.lerp(fog, k);
    this.renderer.skyUniforms.top.value.lerp(top, k);
    this.renderer.skyUniforms.horizon.value.lerp(hor, k);
    const haunted = b.haunted;
    const view = this.renderer.viewScale; // lower graphics = fog closes in, so less of the island gets drawn
    this.scene.fog.near += ((250 - haunted * 200) * view - this.scene.fog.near) * k;
    this.scene.fog.far += ((1400 - haunted * 1000) * view - this.scene.fog.far) * k;
    this.renderer.sun.intensity += ((2.6 - haunted * 1.6) - this.renderer.sun.intensity) * k;
    this.renderer.hemi.intensity += ((1.25 - haunted * 0.6) - this.renderer.hemi.intensity) * k;
    // the cool fill light takes on each biome's colours (pink bounce in candyland, purple gloom in the haunted forest)
    this.renderer.hemi.color.lerp(mix('hs', { city: 0xbfe3ff, mountains: 0xd2e8ff, candy: 0xffe2f4, jungle: 0xc4ecff, haunted: 0x9c86d0 }), k);
    this.renderer.hemi.groundColor.lerp(mix('hg', { city: 0x5a7d3a, mountains: 0x76828f, candy: 0xa88a98, jungle: 0x4f8a3a, haunted: 0x3c3254 }), k);
    // colour grade per biome: punchy city and jungle, sweet-but-not-washed-out candy, snow that doesn't blow out
    const num = (a) => { let v = 0; for (const [kk, w] of Object.entries(b)) v += (a[kk] ?? a.city) * w; return v; };
    const vu = this.renderer.vignette.uniforms;
    vu.uSat.value += (num({ city: 1.14, mountains: 1.1, candy: 1.12, jungle: 1.16, haunted: 1.06 }) - vu.uSat.value) * k;
    vu.uContrast.value += (num({ city: 1.06, mountains: 1.04, candy: 1.08, jungle: 1.07, haunted: 1.1 }) - vu.uContrast.value) * k;
    const r = this.renderer.renderer;
    r.toneMappingExposure += (num({ city: 1.08, mountains: 0.94, candy: 0.98, jungle: 1.1, haunted: 1.05 }) - r.toneMappingExposure) * k;
    // character rim light: a cool sky rim, purple and stronger in the dark haunted forest so players stay readable
    rimUniforms.uRimStrength.value += (num({ city: 0.5, mountains: 0.4, candy: 0.5, jungle: 0.5, haunted: 0.9 }) - rimUniforms.uRimStrength.value) * k;
    rimUniforms.uRimColor.value.lerp(mix('rim', { city: 0xe4f1ff, mountains: 0xe8f4ff, candy: 0xfff0fa, jungle: 0xe8fff0, haunted: 0xc8a8ff }), k);
  }
}

export { BIOMES, rand };
