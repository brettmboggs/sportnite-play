import * as THREE from 'three';
import { rand, pick, canvasTexture } from '../engine/utils.js';
import { audio } from '../engine/audio.js';
import { ISLAND_RADIUS } from '../world/terrain.js';
import { Character } from './character.js';
import { BotBrain, BOT_NAMES } from './bot.js';
import { SKINS, SKIN_BY_ID, BOSS_SKINS } from './skins.js';
import { makeWeapon, makeConsumable, randomWeapon } from './items.js';
import { Storm } from './storm.js';
import { POIS } from '../world/world.js';

const BUS_ALT = 230;

const CHALLENGES = [
  { id: 'elims', text: 'Get 2 eliminations', goal: 2, time: 90, xp: 800, event: 'elim' },
  { id: 'chests', text: 'Open 3 chests', goal: 3, time: 75, xp: 500, event: 'chest' },
  { id: 'damage', text: 'Deal 300 damage', goal: 300, time: 60, xp: 600, event: 'damage' },
  { id: 'build', text: 'Build 25 pieces', goal: 25, time: 40, xp: 400, event: 'build' },
  { id: 'harvest', text: 'Harvest 120 materials', goal: 120, time: 50, xp: 400, event: 'harvest' },
  { id: 'headshot', text: 'Land 3 headshots', goal: 3, time: 75, xp: 700, event: 'headshot' },
  { id: 'upgrade', text: 'Upgrade a weapon', goal: 1, time: 120, xp: 600, event: 'upgrade' },
];

export class Match {
  constructor(game, opts) {
    this.game = game;
    this.opts = opts; // { bots, difficulty, skill }
    this.time = 0;
    this.phase = 'bus';
    this.over = false;
    this.placement = 0;
    this.stats = { kills: 0, damage: 0, chests: 0, built: 0, harvested: 0, headshots: 0, xp: 0, coins: 0, survived: 0, bossKills: 0 };
    this.challenge = null; this.challengeCd = 45;
    this.supplyT = 100;
    this.bosses = [];
  }

  start() {
    const g = this.game;
    this.makeBlimp();
    this.storm = new Storm(g, 1);
    g.storm = this.storm;
    // player
    const playerSkin = SKIN_BY_ID[g.save.data.skin] || SKINS[0];
    const player = new Character(g, { name: g.save.data.name || 'You', skin: playerSkin, isPlayer: true, pos: this.blimp.position });
    g.addChar(player);
    g.setPlayer(player);
    // bots
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const skills = g.director.botSkills(this.opts.bots, this.opts.difficulty);
    for (let i = 0; i < this.opts.bots; i++) {
      const skin = this.botSkin();
      const bot = new Character(g, { name: names[i % names.length] + (i >= names.length ? i : ''), skin, pos: this.blimp.position });
      bot.brain = new BotBrain(g, bot, skills[i]);
      g.addChar(bot);
    }
    for (const c of g.chars) { c.state = 'bus'; c.setVisible(false); c.collider.setEnabled(false); }
    this.spawnBosses();
    audio.startMusic('battle');
    g.events.emit('matchStart', this);
  }

  botSkin() {
    // mostly common outfits, sometimes rare ones (like real lobbies)
    const r = Math.random();
    const pool = SKINS.filter((s) => (r < 0.55 ? s.rarity <= 1 : r < 0.85 ? s.rarity <= 3 : r < 0.97 ? s.rarity <= 4 : true));
    return pick(pool);
  }

  // ---------- the blimp ----------
  makeBlimp() {
    const g = this.game;
    const root = new THREE.Group();
    // texture: v runs along the blimp's length, u wraps around it
    const tex = canvasTexture(512, 1024, (ctx, w, h) => {
      const gr = ctx.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#7b2cff'); gr.addColorStop(0.5, '#ff2c9c'); gr.addColorStop(1, '#7b2cff');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd34d';
      for (const u of [-0.25, 0.25, 0.75]) { ctx.fillRect(w * (u + 0.25) - 64, 0, 6, h); ctx.fillRect(w * (u + 0.25) + 58, 0, 6, h); }
      ctx.font = 'bold 92px "Luckiest Guy", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 10; ctx.strokeStyle = '#2a0a4a'; ctx.fillStyle = '#fff';
      for (const [u, rot] of [[0, -Math.PI / 2], [1, -Math.PI / 2], [0.5, Math.PI / 2]]) {
        ctx.save(); ctx.translate(w * u, h / 2); ctx.rotate(rot); ctx.strokeText('SPORTNITE', 0, 0); ctx.fillText('SPORTNITE', 0, 0); ctx.restore();
      }
    });
    const geo = new THREE.SphereGeometry(1, 48, 32);
    geo.rotateX(Math.PI / 2); // poles along z = the long axis
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
    body.scale.set(9, 9, 32);
    body.castShadow = true;
    const finMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 7), finMat);
      fin.position.z = 27; fin.rotation.z = (i * Math.PI) / 2;
      fin.position.x = Math.sin((i * Math.PI) / 2) * 6; fin.position.y = Math.cos((i * Math.PI) / 2) * 6;
      root.add(fin);
    }
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 12), new THREE.MeshStandardMaterial({ color: 0x2a2f45, metalness: 0.5, roughness: 0.4 }));
    gondola.position.y = -10;
    const windows = new THREE.Mesh(new THREE.BoxGeometry(5.1, 1, 10), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x48b6ff, emissiveIntensity: 1.5 }));
    windows.position.y = -9.8;
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    prop.position.z = 33;
    root.add(body, gondola, windows, prop);
    this.prop = prop;
    // flight path across the island
    const a = rand(0, Math.PI * 2);
    const off = rand(-120, 120);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.busStart = side.clone().multiplyScalar(off).addScaledVector(dir, -(ISLAND_RADIUS + 80)).setY(BUS_ALT);
    this.busEnd = side.clone().multiplyScalar(off).addScaledVector(dir, ISLAND_RADIUS + 80).setY(BUS_ALT);
    this.busDir = dir;
    this.busT = 0;
    this.busDur = (ISLAND_RADIUS * 2 + 160) / 32;
    root.position.copy(this.busStart);
    root.lookAt(this.busStart.clone().sub(dir));
    g.scene.add(root);
    this.blimp = root;
    // dotted path line for the map
    this.busPath = { from: this.busStart.clone(), to: this.busEnd.clone() };
  }

  jump(ch) {
    if (ch.state !== 'bus') return;
    ch.state = 'skydive';
    ch.setVisible(true);
    ch.collider.setEnabled(true);
    const p = this.blimp.position.clone().add(new THREE.Vector3(rand(-3, 3), -14, rand(-3, 3)));
    ch.setPosition(p);
    ch.vel.set(this.busDir.x * 10, -5, this.busDir.z * 10);
    ch.yaw = Math.atan2(-this.busDir.x, -this.busDir.z);
    if (ch.isPlayer) { audio.play('thruster', { vol: 0.7 }); this.game.events.emit('playerJumped', ch); }
  }

  // ---------- bosses ----------
  spawnBosses() {
    const g = this.game;
    const defs = [
      { skin: BOSS_SKINS.mascot, poi: 'Goal Stadium', weapon: ['minigun', 5], hp: 900 },
      { skin: BOSS_SKINS.candyKing, poi: 'Sweet Tooth Town', weapon: ['chicken', 5], hp: 900 },
      { skin: BOSS_SKINS.headlessCoach, poi: 'Creepy Crypts', weapon: ['lightningGun', 5], hp: 900 },
    ];
    for (const d of defs) {
      const poi = POIS.find((p) => p.name === d.poi);
      if (!poi) continue;
      const y = g.world.groundY(poi.x, poi.z);
      const boss = new Character(g, { name: d.skin.name, skin: d.skin, pos: new THREE.Vector3(poi.x + 4, y + 1, poi.z + 4) });
      boss.isBoss = true;
      boss.scale = 2.0;
      boss.maxHealth = boss.health = d.hp; boss.maxShield = boss.shield = 300;
      boss.inv.slots[0] = makeWeapon(d.weapon[0], d.weapon[1]);
      boss.inv.slots[1] = makeWeapon('shotgun', 4);
      boss.inv.sel = 0;
      boss.inv.ammo = { light: 999, medium: 999, heavy: 999, shells: 999, rockets: 999 };
      boss.inv.gold = 400;
      boss.brain = new BotBrain(g, boss, 0.75);
      boss.brain.home = new THREE.Vector3(poi.x, y, poi.z);
      boss.brain.p.sight = 32;
      boss.brain.p.build = 0;
      boss.state = 'ground';
      boss.collider.setEnabled(true);
      g.addChar(boss);
      this.bosses.push(boss);
    }
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.game;
    this.time += dt;
    if (this.phase === 'bus') {
      this.busT += dt / this.busDur;
      this.blimp.position.lerpVectors(this.busStart, this.busEnd, Math.min(1, this.busT));
      this.prop.rotation.z += dt * 20;
      for (const c of g.chars) {
        if (c.state !== 'bus') continue;
        if (c.isPlayer) { c.pos.copy(this.blimp.position); c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z }); }
        else if (this.busT >= c.brain.jumpAt) this.jump(c);
        else c.setPosition(this.blimp.position);
      }
      if (this.busT >= 1) {
        for (const c of g.chars) if (c.state === 'bus') this.jump(c);
        this.phase = 'play';
        this.blimp.visible = false;
      }
      if (this.busT > 0.12 && !g.chars.some((c) => c.state === 'bus')) this.phase = 'play';
    } else if (this.blimp.visible) {
      this.busT += dt / this.busDur;
      this.blimp.position.lerpVectors(this.busStart, this.busEnd, Math.min(1, this.busT));
      if (this.busT >= 1.05) this.blimp.visible = false;
    }
    if (this.over) return;
    this.storm.update(dt);
    // storm damage
    this.stormAcc = (this.stormAcc || 0) + dt;
    if (this.stormAcc >= 1) {
      this.stormAcc = 0;
      for (const c of g.chars) if (c.alive && c.state === 'ground' && !c.isDecoy && this.storm.distanceOutside(c.pos) > 0) g.combat.damage(c, this.storm.dps, { kind: 'storm', ignoreShield: true });
    }
    // supply drops
    if (this.phase === 'play') {
      this.supplyT -= dt;
      if (this.supplyT <= 0) {
        this.supplyT = rand(55, 80);
        const c = this.storm.next || this.storm.current;
        const a = rand(0, Math.PI * 2), r = rand(0, c.r * 0.7);
        g.loot.spawnSupplyDrop(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r);
      }
      this.updateChallenge(dt);
    }
    // bosses stay near home unless chasing
    for (const b of this.bosses) {
      if (!b.alive || !b.brain.home) continue;
      if (!b.brain.target && b.pos.distanceTo(b.brain.home) > 25) { b.brain.goal = b.brain.home; b.brain.goalItem = null; b.brain.state = 'home'; }
    }
    this.checkEnd();
  }

  alive() { return this.game.chars.filter((c) => c.alive && !c.isBoss && !c.isDecoy); }

  checkEnd() {
    const g = this.game;
    const alive = this.alive();
    if (!g.player.alive && !this.over) this.finish(false, alive.length + 1);
    else if (alive.length === 1 && alive[0] === g.player && !this.over) this.finish(true, 1);
  }

  finish(won, placement) {
    if (this.over) return;
    this.over = true;
    this.won = won;
    this.placement = placement;
    const s = this.stats;
    s.survived = this.time;
    s.xp += s.kills * 120 + Math.round(this.time * 2) + (won ? 2000 : placement <= 5 ? 600 : placement <= 10 ? 300 : 0) + s.chests * 25 + s.bossKills * 500;
    s.coins = s.kills * 15 + (won ? 300 : placement <= 10 ? 100 : 20) + s.bossKills * 100;
    this.game.events.emit('matchOver', this);
  }

  // ---------- timed bonus challenges ----------
  updateChallenge(dt) {
    const ch = this.challenge;
    if (ch) {
      ch.left -= dt;
      if (ch.progress >= ch.goal) {
        this.stats.xp += ch.xp;
        this.game.hud.bigMessage('⏱️ BONUS COMPLETE!', `+${ch.xp} XP`);
        audio.jingle('level', 0.5);
        this.challenge = null; this.challengeCd = rand(25, 45);
      } else if (ch.left <= 0) { this.challenge = null; this.challengeCd = rand(20, 35); this.game.hud.toast('Bonus challenge missed!'); }
    } else {
      this.challengeCd -= dt;
      if (this.challengeCd <= 0 && this.game.player.alive && this.game.player.state === 'ground') {
        const c = pick(CHALLENGES);
        this.challenge = { ...c, progress: 0, left: c.time };
        this.game.hud.toast(`⏱️ BONUS: ${c.text} in ${c.time}s!`);
        audio.ui('confirm');
      }
    }
  }

  track(event, amount = 1) {
    if (this.challenge && this.challenge.event === event) this.challenge.progress += amount;
  }

  dispose() {
    this.blimp.removeFromParent();
    this.storm.dispose();
  }
}

export { randomWeapon, makeConsumable };
