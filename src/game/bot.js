import * as THREE from 'three';
import { rand, clamp, lerp, angleDiff } from '../engine/utils.js';
import { AMMO } from './weapons/data.js';
import { applyConsumable } from './player.js';

export const BOT_NAMES = [
  'xX_Dunker_Xx', 'GoalieGuy', 'SlamJamSam', 'TurboTaco', 'NoScopeNate', 'BuildBot3000', 'PizzaPanda', 'SneakyPete',
  'HomeRunHero', 'CrankKing', 'LlamaLover', 'RampRusher', 'MVP_Mia', 'ZapZoe', 'CaptainCone', 'BoxFighterBo',
  'DropShotDan', 'PixelPaige', 'SpicyNugget', 'FrostyFrank', 'CandyCrusher', 'GhostGamer', 'JungleJax', 'PeakPrince',
  'BubbleBella', 'ChickenChamp', 'GolfGod', 'HoopDreams', 'KickflipKai', 'LuckyLuna', 'ShieldyShay', 'TurtleTim',
  'WallWizard', 'SniperSkye', 'MeteorMo', 'TacoTuesday', 'BigBrainBen', 'QuickScopeQ', 'StormChaser', 'NinjaNoodle',
  'DinoDash', 'RocketRick', 'BananaBlast', 'SpeedySue', 'CrispyChris', 'MegaMax', 'TinyTina', 'BeastModeBri',
  'CoachCarter', 'SlimeTime', 'GG_EZ', 'PotatoAim', 'Clutch_Cam', 'SweatySam',
];

// Everything that makes a Rookie feel different from an All-Star lives here.
export function skillProfile(s) {
  s = clamp(s, 0, 1);
  return {
    s,
    aimError: 0.02 + 0.07 * (1 - s) ** 2,   // how far off the aim wanders (radians-ish)
    reaction: lerp(0.95, 0.2, s),     // seconds before the first shot after spotting someone
    turn: lerp(3.2, 12, s),           // how fast the crosshair catches up with a moving target
    sight: lerp(65, 165, s),
    build: s > 0.3 ? (s - 0.3) * 1.45 : 0,
    strafe: lerp(0.25, 1, s),
    jumpy: s > 0.5 ? (s - 0.5) * 1.6 : 0,
    crouchSpam: s > 0.45 ? (s - 0.45) * 1.8 : 0,
    heal: lerp(0.3, 1, s),
    headshot: s * 0.35,
    burst: lerp(0.45, 1.6, s),
    peek: s > 0.4,
    matGoal: s < 0.3 ? 0 : Math.round(lerp(60, 260, s)),
    tier: s < 0.33 ? 'Rookie' : s < 0.66 ? 'Pro' : 'All-Star',
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const BOSS_POIS = ['Goal Stadium', 'Sweet Tooth Town', 'Creepy Crypts'];

export class BotBrain {
  constructor(game, ch, skill) {
    this.game = game;
    this.ch = ch;
    this.p = skillProfile(skill);
    this.state = 'bus';
    this.target = null;      // enemy character
    this.goal = null;        // Vector3 move goal
    this.goalItem = null;    // loot object
    this.thinkT = rand(0, 0.5);
    this.scanT = rand(0, 0.5);
    this.seeT = 0;           // time we've had eyes on target
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.stuckT = 0; this.stuckCount = 0; this.lastPos = new THREE.Vector3(); this.moveWant = 0;
    this.fireHold = 0; this.firePause = 0;
    this.buildCd = 0;
    this.aimOffset = new THREE.Vector3();
    this.aimPt = null; this.wobbleT = 0;
    this.landing = null;
    this.jumpAt = rand(0.08, 0.85); // fraction of the blimp path when we jump (replanned once we pick a landing spot)
    this.healT = 0;
    this.lastSeenPos = null;
    this.wander = null;
    this.los = { clear: true, piece: null, point: null }; this.losT = 0;
    this.ignoreT = 0;        // after breaking off a fight, don't re-engage straight away
    this.peekT = 0; this.peekPhase = 0;
    this.rampT = 0;
    this.farm = null; this.farmT = 0;
    this.skip = new Set(); // loot we couldn't reach
    this.intent = { mx: 0, my: 0, sprint: false, jump: false, jumpHeld: false, crouch: false, crouchPressed: false, aim: false };
  }

  update(dt) {
    const ch = this.ch, g = this.game;
    if (!ch.alive) return;
    const it = this.intent;
    it.jump = false; it.crouchPressed = false; it.mx = 0; it.my = 0; it.aim = false; it.sprint = false; it.jumpHeld = false;

    if (ch.state === 'bus') { this.planDrop(); return; }
    if (ch.state === 'skydive' || ch.state === 'glide') { this.steerDrop(dt); ch.move(dt, it); return; }
    if (this.state === 'bus') { this.state = 'loot'; this.thinkT = 0; this.landedAt = g.time; }

    // bots far from the player think less often (keeps 50 bots cheap)
    const far = g.player && g.player.alive && g.player.pos.distanceToSquared(ch.pos) > 180 * 180 && !this.target;
    this.thinkT -= dt; this.scanT -= dt; this.buildCd -= dt; this.ignoreT -= dt;
    if (this.scanT <= 0) { this.scanT = (far ? 0.8 : 0.3) + rand(0, 0.25); this.scan(); }
    if (this.thinkT <= 0) { this.thinkT = (far ? 1.1 : 0.5) + rand(0, 0.4); this.think(); }

    let aimDir = null;
    this.wantFire = false;
    if (this.target && this.target.alive) aimDir = this.fight(dt);
    else { this.target = null; aimDir = this.travel(dt); }

    // skills: use dash/shield/etc sometimes when fighting
    if (this.target && Math.random() < dt * 0.15 * this.p.s) {
      for (let i = 0; i < 2; i++) if (ch.inv.skills[i] && !ch.inv.skills[i].def.passive) { g.skills.use(ch, i, ch.head, aimDir || ch.aimDir()); break; }
    }

    if (this.state === 'heal') it.crouch = true;
    ch.move(dt, it);
    this.unstick(dt);

    // weapon handling
    const w = ch.heldItem();
    if (w && w.type === 'weapon') {
      const firing = this.wantFire && (this.target || this.state === 'farm');
      const dir = aimDir || ch.aimDir();
      g.combat.updateWeapon(ch, dt, { origin: ch.head.addScaledVector(dir, 0.5), dir, firing: !!firing, firePressed: !!firing, isPlayer: false });
      if (!this.target && w.mag && w.ammoInMag < w.mag * 0.5) g.combat.startReload(ch, w);
    } else ch.firing = false;
  }

  armed() {
    const inv = this.ch.inv;
    return inv.slots.some((s) => s && s.type === 'weapon' && s.def.mode !== 'throw' && (s.def.ammo == null || inv.ammo[s.def.ammo] + s.ammoInMag > 0 || this.ch.infiniteAmmo));
  }

  // roll once in a while whether we feel like taking on this bot
  wantsFight(c) {
    const g = this.game;
    this.mood ??= new Map();
    let m = this.mood.get(c);
    if (!m || g.time > m.until) {
      const weak = c.health + c.shield < 60 ? 0.25 : 0;
      m = { yes: Math.random() < lerp(0.2, 0.55, this.p.s) + weak, until: g.time + rand(6, 12) };
      this.mood.set(c, m);
    }
    return m.yes;
  }

  // how far away we're willing to pick a fight, based on our best gun
  engageRange() {
    let r = 12;
    for (const s of this.ch.inv.slots) {
      if (!s || s.type !== 'weapon' || s.def.mode === 'throw') continue;
      const c = s.def.cls;
      r = Math.max(r, c === 'Sniper' || c === 'Bow' || c === 'Sports' ? 200 : c === 'Rifle' || c === 'Heavy' || c === 'Wacky' ? 90 : c === 'SMG' || c === 'Pistol' ? 45 : c === 'Shotgun' ? 25 : 15);
    }
    return Math.min(r, this.p.sight);
  }

  hp() { return this.ch.health + this.ch.shield + (this.ch.overshield || 0); }

  // ---------- perception ----------
  scan() {
    const g = this.game, ch = this.ch;
    const armed = this.armed();
    const fwd = ch.aimDir();
    const attackerRecent = ch.lastDamagedBy && g.time - ch.lastHitTime < 4 ? ch.lastDamagedBy : null;
    // don't let the whole lobby gang up on the player
    let hunters = 0;
    if (g.player) for (const c of g.chars) if (c.brain && c !== ch && c.alive && c.brain.target === g.player) hunters++;
    const huntCap = g.match && g.match.opts.difficulty === 'easy' ? 1 : this.p.s < 0.33 ? 2 : 3;
    let best = null, bestScore = Infinity, seen = false;
    for (const c of g.chars) {
      if (c === ch || !c.alive || c.state !== 'ground') continue;
      if (c.status.invisible > 0 && c.pos.distanceTo(ch.pos) > 6) continue;
      const d = c.pos.distanceTo(ch.pos);
      const attacker = c === attackerRecent;
      if (d > (armed ? this.p.sight : 7)) continue;
      if (!armed && !attacker) continue;          // no gun: only swing back at whoever hit us
      if (this.home && d > 20 && !attacker) continue; // bosses defend their turf
      if (this.ignoreT > 0 && !attacker && d > 12) continue;
      if (c.isBoss && !attacker && (this.p.s < 0.7 || d > 30)) continue; // leave the bosses alone unless we're good
      // fresh off the drop: grab loot first unless someone is right on top of us
      if (!attacker && d > 25 && g.time - (this.landedAt || 0) < 40) continue;
      // don't start fights our guns can't reach
      if (!attacker && d > this.engageRange()) continue;
      // bots don't jump every other bot on sight (keeps the lobby alive for the player to find)
      if (!attacker && c.brain && c !== this.target && d > 10 && !this.wantsFight(c)) continue;
      if (c === g.player && !attacker && c !== this.target && hunters >= huntCap && d > 15) continue;
      const to = tmp.copy(c.center).sub(ch.center).normalize();
      const inView = to.dot(fwd) > -0.2 || d < 12 || attacker;
      if (!inView) continue;
      // prefer whoever shot us, then weak (already fighting) targets, then the nearest
      const weak = c.health + c.shield < 60 ? 15 * this.p.s : 0;
      const score = d - (attacker ? 60 : 0) - weak + (c.isDecoy ? -10 : 0) - (c === this.target ? 10 : 0);
      if (score >= bestScore) continue;
      if (!this.losTo(c).clear) continue;
      best = c; bestScore = score; seen = true;
    }
    // healing: only stop for someone who is shooting at us or very close
    if (best && this.state === 'heal') {
      if (best === attackerRecent || best.pos.distanceTo(ch.pos) < 20) this.state = 'roam';
      else best = null;
    }
    // keep fighting someone who ducked behind a build for a moment
    if (!best && this.target && this.target.alive && this.lastSeenT && g.time - this.lastSeenT < (this.cover && !this.cover.dead ? 4 : 2.5) && this.target.pos.distanceTo(ch.pos) < this.p.sight) best = this.target;
    if (best !== this.target) {
      this.seeT = 0;
      this.aimPt = null;
      this.losT = 0;
      this.newAimOffset();
      if (best) this.pickWeapon(best);
    }
    if (best && seen) { this.lastSeenPos = best.pos.clone(); this.lastSeenT = g.time; }
    else if (!best && this.target && this.target.alive && this.lastSeenPos) {
      // lost sight: chase last seen spot for a bit
      this.goal = this.lastSeenPos; this.goalItem = null; this.state = 'hunt';
    }
    this.target = best;
  }

  // Line of sight from our eyes to their body. Reports the build piece in the way, if any.
  losTo(c) {
    const g = this.game, from = this.ch.head, to = c.center;
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    const hit = g.combat.ray(from, dir, d, this.ch);
    if (!hit || (hit.owner && hit.owner.kind === 'char' && hit.owner.char === c)) return { clear: true, piece: null, point: null };
    const piece = hit.owner && hit.owner.kind === 'build' ? hit.owner.piece : null;
    return { clear: false, piece, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), dist: hit.dist };
  }

  newAimOffset() {
    this.aimOffset.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1));
    if (this.aimOffset.lengthSq() > 1) this.aimOffset.normalize();
    this.wobbleT = rand(0.3, 0.7);
  }

  // ---------- decisions ----------
  think() {
    const g = this.game, ch = this.ch, inv = ch.inv;
    if (!this.target) this.pickWeapon(null);
    const storm = this.stormPressure();
    if (this.target) {
      // the storm is eating us and the fight isn't close: run for the zone
      if (storm === 'urgent' && (this.target.pos.distanceTo(ch.pos) > 20 || ch.health < 50)) {
        this.target = null; this.ignoreT = 3;
        this.goal = g.storm.safePointFor(ch.pos); this.goalItem = null; this.state = 'rotate';
      }
      return;
    }
    if (this.state === 'heal' || this.state === 'box') return;
    if (this.home) { // bosses guard their area
      const a = Math.random() * Math.PI * 2;
      this.goal = this.home.clone().add(new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8));
      this.goalItem = null; this.state = 'home';
      return;
    }
    if (storm) { this.goal = g.storm.safePointFor(ch.pos); this.goalItem = null; this.farm = null; this.state = 'rotate'; return; }
    // heal up when safe
    if ((ch.health < 75 || ch.shield < 50) && this.tryHeal()) return;
    const armed = this.armed();
    // keep chopping if we're farming
    if (this.state === 'farm' && this.farm && this.farm.alive && inv.mats.wood < this.p.matGoal && this.farmT < 14) return;
    if (this.state === 'hunt' && this.goal && this.goal.distanceTo(ch.pos) > 3 && g.time - (this.lastSeenT || 0) < 8) return;
    // third-party: run toward a fight we can hear
    if (armed && this.hp() > 120 && Math.random() < this.p.s * 0.6) {
      const f = this.findFight();
      if (f) { this.goal = f; this.goalItem = null; this.state = 'thirdparty'; return; }
    }
    if (this.state === 'thirdparty' && this.goal && this.goal.distanceTo(ch.pos) > 12) return;
    // looting
    const want = !armed || inv.slots.filter(Boolean).length < 4 || ch.shield < 50;
    if (want || Math.random() < 0.4) {
      const li = this.findLoot(armed ? 45 : 90);
      if (li) { this.goalItem = li; this.goal = li.pos; this.state = 'loot'; return; }
    }
    // farm materials for building
    if (armed && inv.mats.wood < this.p.matGoal * 0.6) {
      const hv = this.findHarvest(armed ? 35 : 20);
      if (hv) { this.farm = hv; this.farmT = 0; this.goal = new THREE.Vector3(hv.x, hv.y, hv.z); this.goalItem = null; this.state = 'farm'; return; }
    }
    // roam toward the safe zone / a random point
    if (!this.wander || ch.pos.distanceTo(this.wander) < 6) {
      const c = g.storm ? g.storm.next || g.storm.current : { x: 0, z: 0, r: 300 };
      const a = rand(0, Math.PI * 2), r = rand(0, Math.min(c.r || 200, 300) * 0.7);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!this.nearBoss(x, z)) this.wander = new THREE.Vector3(x, g.world.groundY(x, z), z);
      else this.wander = null;
    }
    this.goal = this.wander; this.goalItem = null; this.state = 'roam';
  }

  // boss turf is dangerous for everyone but the best bots
  nearBoss(x, z) {
    if (this.p.s >= 0.7) return false;
    const m = this.game.match;
    for (const b of (m && m.bosses) || []) if (b.alive && b.brain && b.brain.home && Math.hypot(b.brain.home.x - x, b.brain.home.z - z) < 55) return true;
    return false;
  }

  // 'urgent' = outside the storm now, 'soon' = time to rotate, null = fine
  stormPressure() {
    const st = this.game.storm, ch = this.ch;
    if (!st || st.phase < 0) return null;
    if (st.distanceOutside(ch.pos) > -4) return 'urgent';
    if (!st.next) return null;
    const out = st.distanceOutside(ch.pos, true);
    if (out < -10) return null;
    const travel = (out + 25) / 6.5; // seconds to run comfortably inside
    const timeLeft = st.timer + (st.shrinking ? 0 : 25);
    // All-Stars rotate early; Rookies cut it close (and sometimes take storm damage)
    return timeLeft < travel * (0.8 + 1.6 * this.p.s) + 12 * this.p.s ? 'soon' : null;
  }

  findFight() {
    const g = this.game, ch = this.ch;
    const range = 70 + this.p.s * 50;
    let best = null, bd = range;
    for (const c of g.chars) {
      if (c === ch || !c.alive || c.isBoss || c.isDecoy || c.state !== 'ground') continue;
      if (g.time - c.lastHitTime > 3 || !c.lastDamagedBy || c.lastDamagedBy === ch) continue;
      const d = c.pos.distanceTo(ch.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? best.pos.clone() : null;
  }

  findHarvest(range) {
    const hs = this.game.world.harvestables;
    if (!hs || !hs.length) return null;
    const ch = this.ch;
    let best = null, bd = range * range;
    // sample instead of scanning thousands of props
    for (let i = 0; i < 80; i++) {
      const hv = hs[Math.floor(Math.random() * hs.length)];
      if (!hv.alive || hv.def.mat !== 'wood') continue;
      const dx = hv.x - ch.pos.x, dz = hv.z - ch.pos.z, d = dx * dx + dz * dz;
      if (d < bd && Math.abs(hv.y - ch.pos.y) < 3) { bd = d; best = hv; }
    }
    return best;
  }

  findLoot(range) {
    const g = this.game, ch = this.ch;
    let best = null, bd = range;
    const canClimb = this.p.build > 0.2 && ch.inv.mats.wood >= 40;
    for (const it of g.loot.items) {
      if (it.auto || it.vel || this.skip.has(it) || this.nearBoss(it.pos.x, it.pos.z)) continue;
      if (it.pos.y - ch.pos.y > 3 && !canClimb) continue;
      const d = it.pos.distanceTo(ch.pos);
      if (d >= bd) continue;
      if (it.item.type === 'weapon' && !this.wantsWeapon(it.item)) continue;
      if (it.item.type !== 'weapon' && !this.armed()) continue;
      if (it.item.type === 'consumable' && ch.inv.slots.filter(Boolean).length >= 5) continue;
      best = it; bd = d;
    }
    for (const c of g.loot.chests) {
      if (c.opened || c.falling || this.skip.has(c) || this.nearBoss(c.pos.x, c.pos.z)) continue;
      if (c.pos.y - ch.pos.y > 3 && !canClimb) continue;
      const d = c.pos.distanceTo(ch.pos) * (c.supply ? 0.5 : 1);
      if (d < bd) { best = c; bd = d; }
    }
    return best;
  }

  // a real loadout: a shotgun for close, an AR/SMG for mid, something for long range, plus heals
  wantsWeapon(w) {
    const slots = this.ch.inv.slots;
    if (w.def.mode === 'throw') return slots.some((s) => !s);
    const guns = slots.filter((s) => s && s.type === 'weapon' && s.def.mode !== 'throw');
    const same = guns.find((s) => s.def.cls === w.def.cls);
    if (same) return w.rarity > same.rarity;
    if (slots.some((s) => !s)) return true;
    const worst = guns.sort((a, b) => a.rarity - b.rarity)[0];
    return !!worst && (w.rarity > worst.rarity || (['Shotgun', 'Rifle', 'SMG'].includes(w.def.cls) && !['Shotgun', 'Rifle', 'SMG'].includes(worst.def.cls)));
  }

  tryHeal() {
    const ch = this.ch;
    const idx = ch.inv.slots.findIndex((s) => s && s.type === 'consumable' && ((s.def.shield && ch.shield < (s.def.maxShield || 100)) || (s.def.heal && ch.health < (s.def.maxHeal || 100))));
    if (idx < 0) return false;
    ch.inv.sel = idx;
    this.state = 'heal';
    this.healT = ch.inv.slots[idx].def.use * lerp(1.4, 1, this.p.heal);
    return true;
  }

  pickWeapon(target = this.target) {
    const ch = this.ch, inv = ch.inv;
    if (this.state === 'heal' || this.state === 'farm' && !target) return;
    const d = target ? target.pos.distanceTo(ch.pos) : 40;
    let best = -1, bestScore = -Infinity;
    inv.slots.forEach((s, i) => {
      if (!s || s.type !== 'weapon' || s.def.mode === 'throw') return;
      if (s.def.ammo && inv.ammo[s.def.ammo] + s.ammoInMag <= 0 && !ch.infiniteAmmo) return;
      const cls = s.def.cls;
      let score = s.rarity * 2;
      if (d < 9) score += cls === 'Shotgun' ? 12 : cls === 'SMG' ? 8 : cls === 'Melee' ? 6 : cls === 'Pistol' ? 5 : 3;
      else if (d < 18) score += cls === 'SMG' ? 9 : cls === 'Rifle' ? 8 : cls === 'Shotgun' ? 6 : cls === 'Wacky' ? 6 : 4;
      else if (d < 55) score += cls === 'Rifle' ? 10 : cls === 'SMG' ? 6 : cls === 'Wacky' ? 6 : cls === 'Heavy' ? 6 : cls === 'Shotgun' ? 0 : 4;
      else score += cls === 'Sniper' ? 12 : cls === 'Bow' ? 8 : cls === 'Sports' ? 7 : cls === 'Rifle' ? 7 : cls === 'Explosive' ? 3 : 0;
      if (cls === 'Explosive' && d < 8) score -= 20;
      if (s.def.mag && s.ammoInMag <= 0) score -= 3; // prefer a loaded gun mid-fight
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best !== inv.sel) { inv.sel = best; ch.fireCooldown = Math.max(ch.fireCooldown, lerp(0.45, 0.2, this.p.s)); ch.reloadT = 0; }
  }

  // ---------- movement ----------
  travel(dt) {
    const ch = this.ch, g = this.game;
    const it = this.intent;
    if (this.state === 'heal') {
      const s = ch.heldItem();
      if (!s || s.type !== 'consumable') { this.state = 'roam'; return null; }
      this.healT -= dt;
      if (this.healT <= 0) {
        applyConsumable(g, ch, s);
        this.state = 'roam'; this.thinkT = 0;
        if (ch.health < 75 || ch.shield < 50) this.tryHeal();
        if (this.state !== 'heal') this.pickWeapon(null);
      }
      return null;
    }
    if (this.state === 'farm') return this.doFarm(dt);
    if (!this.goal) return null;
    const to = new THREE.Vector3(this.goal.x - ch.pos.x, 0, this.goal.z - ch.pos.z);
    const d = to.length();
    if (this.goalItem) {
      const reach = this.goalItem.item ? 1.8 : 2.2;
      if (d < reach && Math.abs(this.goal.y - ch.pos.y) < 3) {
        if (this.goalItem.item) { if (g.loot.items.includes(this.goalItem)) g.loot.pickup(ch, this.goalItem); }
        else if (!this.goalItem.opened) g.loot.openChest(ch, this.goalItem, ch);
        this.goalItem = null; this.thinkT = 0.1; return null;
      }
      if ((this.goalItem.item && !g.loot.items.includes(this.goalItem)) || this.goalItem.opened) { this.goalItem = null; this.thinkT = 0; }
    }
    if (d < 6 && this.goal.y < ch.pos.y - 3.5 && ch.grounded) {
      // it's right below us (we're on a roof): forget it and walk off the edge
      if (this.goalItem) this.skip.add(this.goalItem);
      this.goalItem = null; this.getDown(); return null;
    }
    if (d < 1.5) { if (this.state === 'hunt' || this.state === 'thirdparty') this.thinkT = 0; return null; }
    // progress watchdog: if we stop getting closer, that goal is unreachable (inside a locked house, up a cliff...)
    if (this.trackGoal !== this.goal) { this.trackGoal = this.goal; this.bestD = d; this.progressT = 0; }
    if (d < this.bestD - 0.5) { this.bestD = d; this.progressT = 0; }
    else if ((this.progressT += dt) > 4) {
      if (this.goalItem) { this.skip.add(this.goalItem); this.goalItem = null; }
      if (this.state === 'roam') this.wander = null;
      this.goal = null; this.progressT = 0; this.thinkT = 0;
      if (this.state !== 'rotate') this.state = 'roam';
      return null;
    }
    this.faceToward(this.steer(to, dt), dt, 6);
    it.my = 1;
    it.sprint = (d > 10 || this.state === 'rotate') && ch.stamina > 25;
    this.moveWant = 1;
    // the goal is up high (rooftop chest): build ramps toward it
    if (this.goal.y > ch.pos.y + 3.5 && d < 9 && this.p.build > 0.2 && this.buildCd <= 0 && ch.inv.mats.wood >= 10) {
      this.buildCd = 0.4;
      g.building.place(ch, g.building.target(ch, 'ramp', new THREE.Vector3(to.x, 0.5, to.z).normalize()), 'wood');
    }
    return null;
  }

  // stuck up on a roof: find the nearest edge with a drop and head that way
  getDown() {
    const g = this.game, ch = this.ch;
    let best = null;
    for (const r of [5, 9, 14]) {
      for (let k = 0; k < 8 && !best; k++) {
        const a = (k / 8) * Math.PI * 2 + r;
        const x = ch.pos.x + Math.cos(a) * r, z = ch.pos.z + Math.sin(a) * r;
        const hit = g.physics.raycast({ x, y: ch.pos.y + 1, z }, { x: 0, y: -1, z: 0 }, 40, ch.collider);
        const y = hit ? hit.point.y : g.world.groundY(x, z);
        if (y < ch.pos.y - 2.5) best = new THREE.Vector3(ch.pos.x + Math.cos(a) * (r + 3), y, ch.pos.z + Math.sin(a) * (r + 3));
      }
      if (best) break;
    }
    this.wander = best || new THREE.Vector3(ch.pos.x + rand(-15, 15), ch.pos.y, ch.pos.z + rand(-15, 15));
    this.goal = this.wander; this.state = 'roam'; this.thinkT = 2.5;
  }

  doFarm(dt) {
    const ch = this.ch, it = this.intent, hv = this.farm;
    this.farmT += dt;
    if (!hv || !hv.alive || this.farmT > 14 || ch.inv.mats.wood >= this.p.matGoal) { this.farm = null; this.state = 'roam'; this.thinkT = 0; this.pickWeapon(null); return null; }
    const to = new THREE.Vector3(hv.x - ch.pos.x, 0, hv.z - ch.pos.z);
    const d = to.length();
    const reach = 1.6 + Math.min(hv.size.x, hv.size.z) * 0.12;
    if (d > reach) {
      this.faceToward(this.steer(to, dt), dt, 6);
      it.my = 1; it.sprint = d > 10 && ch.stamina > 40; this.moveWant = 1;
      return null;
    }
    // swing the bat
    if (ch.inv.sel !== -1) { ch.inv.sel = -1; ch.fireCooldown = Math.max(ch.fireCooldown, 0.2); }
    this.faceToward(to, dt, 10);
    this.wantFire = true;
    return new THREE.Vector3(to.x, (hv.y + 1.0 - ch.head.y) , to.z).normalize();
  }

  // Look a few meters ahead; if a wall is in the way, pick a clear direction around it.
  steer(to, dt) {
    this.detourT = (this.detourT || 0) - dt;
    if (this.detourT > 0 && this.detour) return this.detour;
    this.steerT = (this.steerT || 0) - dt;
    if (this.steerT > 0) return this.lastSteer || to;
    this.steerT = 0.25;
    const ch = this.ch, g = this.game;
    const dir = to.clone().setY(0).normalize();
    const pred = (c) => { const o = g.physics.owners.get(c.handle); return !o || (o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'loot'); };
    const ray = (h, v, dist) => !!g.physics.raycast({ x: ch.pos.x, y: ch.pos.y + h, z: ch.pos.z }, v, dist, ch.collider, undefined, pred);
    const blocked = (v, dist) => {
      if (ray(1.3, v, dist)) return 'high';
      if (ray(0.45, v, dist)) return 'low';
      return false;
    };
    const b = blocked(dir, 3);
    if (!b) { this.lastSteer = to; return to; }
    if (b === 'low') { this.intent.jump = true; this.lastSteer = to; return to; }
    const side = this.strafeDir;
    for (const a of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) {
      const v = dir.clone().applyAxisAngle(UP, a * side);
      if (!blocked(v, 4)) { this.detour = v; this.detourT = 0.5 + Math.abs(a) * 0.35; return v; }
    }
    this.detour = dir.clone().negate(); this.detourT = 0.8;
    return this.detour;
  }

  faceToward(dir, dt, speed) {
    const yaw = Math.atan2(-dir.x, -dir.z);
    this.ch.yaw += angleDiff(this.ch.yaw, yaw) * Math.min(1, dt * speed);
  }

  // Stuck on a wall or prop? jump, then side-step, then build a ramp over it, then give up on that goal.
  unstick(dt) {
    const ch = this.ch, it = this.intent, g = this.game;
    this.stuckT += dt;
    if (this.stuckT < 0.9) return;
    const moved = Math.hypot(ch.pos.x - this.lastPos.x, ch.pos.z - this.lastPos.z);
    const wanted = this.moveWant > 0.5;
    this.lastPos.copy(ch.pos);
    this.stuckT = 0; this.moveWant = 0;
    if (!wanted || moved > 0.9) { this.stuckCount = 0; return; }
    this.stuckCount++;
    it.jump = true;
    if (this.stuckCount === 2) {
      this.strafeDir = -this.strafeDir;
      this.detour = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw)).applyAxisAngle(UP, this.strafeDir * Math.PI / 2);
      this.detourT = 1.2;
    } else if (this.stuckCount === 3 && this.p.build > 0 && ch.inv.mats.wood >= 10 && !this.target) {
      g.building.place(ch, g.building.target(ch, 'ramp', new THREE.Vector3(-Math.sin(ch.yaw), 0.3, -Math.cos(ch.yaw))), 'wood');
    } else if (this.stuckCount >= 4) {
      this.ch.yaw += rand(-2.5, 2.5); this.wander = null; this.goalItem = null; this.farm = null;
      if (this.state !== 'rotate') this.state = 'roam';
      this.detour = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw)); this.detourT = 1.5;
      this.thinkT = 1.5; this.stuckCount = 0;
    }
  }

  // ---------- fighting ----------
  fight(dt) {
    const ch = this.ch, g = this.game, t = this.target, it = this.intent, p = this.p;
    this.seeT += dt;
    const toT = t.center.sub(ch.head);
    const dist = toT.length();
    // quick line-of-sight check so we never shoot through walls
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.12 + rand(0, 0.06);
      this.los = this.losTo(t);
      if (this.los.clear) { this.lastSeenPos = t.pos.clone(); this.lastSeenT = g.time; }
    }
    const w = ch.heldItem();

    // ---- aim: a crosshair that chases the target (and lags behind strafing), with a wobble that shrinks as we track
    const want = t.center;
    if (this.aimHead === undefined || Math.random() < dt * 0.8) this.aimHead = Math.random() < p.headshot;
    if (this.aimHead) want.y += 0.55;
    if (w && w.def && w.def.proj) want.addScaledVector(t.vel, dist / w.def.proj.speed);
    if (!this.aimPt) this.aimPt = ch.head.addScaledVector(ch.aimDir(), dist);
    this.aimPt.lerp(want, 1 - Math.exp(-dt * p.turn));
    this.wobbleT -= dt;
    if (this.wobbleT <= 0) this.newAimOffset();
    const track = clamp(this.seeT / 2.2, 0, 1);
    const err = p.aimError * (1.5 - lerp(0.4, 0.9, p.s) * track) * (t.sprinting ? 1.3 : 1) * (t.crouching ? 1.15 : 1) * (dist > 60 ? 1.2 : 1) * (t.brain ? 1.7 : 1); // sloppier vs other bots so the lobby lasts
    const aimPoint = this.aimPt.clone().addScaledVector(this.aimOffset, err * dist);
    let shootPiece = false;
    if (!this.los.clear && this.los.piece && !this.los.piece.dead && this.los.piece.owner !== ch && p.s > 0.25 && dist < 60 && this.los.dist < dist) {
      // they're behind a build: shoot the build down (Fortnite "pressure")
      aimPoint.copy(this.los.point);
      shootPiece = true;
    }
    const aimDir = aimPoint.sub(ch.head).normalize();
    ch.yaw += angleDiff(ch.yaw, Math.atan2(-aimDir.x, -aimDir.z)) * Math.min(1, dt * lerp(6, 16, p.s));
    ch.pitch = Math.asin(clamp(aimDir.y, -1, 1));

    // ---- fire in bursts after reacting, only with a clear shot
    this.wantFire = false;
    if (this.seeT > p.reaction && (this.los.clear || shootPiece)) {
      if (this.firePause > 0) this.firePause -= dt;
      else {
        this.fireHold += dt;
        this.wantFire = true;
        if (this.fireHold > p.burst * rand(0.5, 1.2)) { this.fireHold = 0; this.firePause = rand(0.15, 0.6) * (1.3 - p.s); }
      }
    }

    // ---- movement: keep a good range for our weapon, strafe, crouch-spam, jump
    const melee = !w || !w.def || w.def.mode === 'melee';
    const cls = w && w.def ? w.def.cls : 'Melee';
    const weak = t.health + t.shield < 70 && this.hp() > 90;
    let pref = melee ? 1.2 : cls === 'Shotgun' ? 4 : cls === 'Sniper' ? 70 : cls === 'SMG' ? 12 : cls === 'Bow' ? 35 : 25;
    if (weak && p.s > 0.35) pref = Math.min(pref, 6); // push the weak one
    if (melee && dist > 3.5) this.wantFire = false;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(0.3, 1.4) * lerp(1.4, 0.7, p.s); }
    it.mx = melee ? 0 : this.strafeDir * p.strafe;
    it.my = melee ? (dist > 1.4 ? 1 : 0) : dist > pref + 6 ? 1 : dist < pref - 4 ? -0.7 : 0;
    if (melee || (weak && dist > pref + 4)) it.sprint = dist > 4 && ch.stamina > 20;
    it.aim = dist > 15 && !melee && cls !== 'Shotgun' && cls !== 'SMG';
    if (p.jumpy && Math.random() < dt * p.jumpy * (g.time - ch.lastHitTime < 1 ? 2.5 : 1)) it.jump = true;
    if (p.crouchSpam && this.wantFire && dist > 6 && Math.random() < dt * p.crouchSpam * 5) it.crouch = !it.crouch;
    else if (!this.wantFire) it.crouch = false;
    if (Math.abs(it.mx) + Math.abs(it.my) > 0.3) this.moveWant = 1;

    // ---- peeking from cover: All-Stars edit a window, Pros step out to the side, then duck back in
    const ownBlock = !this.los.clear && this.los.piece && this.los.piece.owner === ch && this.los.dist < 4;
    this.peekT -= dt;
    if (this.window && (this.window.dead || this.window.pos.distanceTo(ch.pos) > 6)) this.window = null;
    if (this.window && this.peekT <= 0) { g.building.setMask(this.window, 0); this.window = null; this.peekT = rand(0.8, 1.6); }
    if (ownBlock && p.s > 0.6 && !this.window && this.peekT <= 0 && this.los.piece.type === 'wall') {
      const tile = g.building.tileNear(this.los.piece, this.los.point);
      const mask = (1 << tile) | (tile >= 3 && tile < 6 && Math.random() < 0.4 ? 1 << (tile - 3) : 0); // window, sometimes a door
      if (g.building.setMask(this.los.piece, mask)) { this.window = this.los.piece; this.peekT = rand(0.9, 1.8); this.losT = 0; }
    } else if (ownBlock && this.los.piece.type === 'ramp' && p.s > 0.4 && this.rampT <= 0) {
      this.rampT = 0.7; // our own ramp is in the way: climb it and shoot from the top
    } else if (ownBlock && p.s > 0.4 && this.los.piece.type === 'wall' && this.peekT <= 0 && this.buildCd <= 0 && this.matsFor(10)) {
      // classic wall + ramp: build a ramp behind the wall and peek over the top
      const look = t.pos.clone().sub(ch.pos).setY(0).normalize();
      if (g.building.place(ch, g.building.target(ch, 'ramp', look.setY(0.2).normalize(), { own: true }), this.matsFor(10))) this.rampT = 0.8;
      this.buildCd = 1; this.peekT = rand(1, 2);
    } else if (ownBlock && p.peek && !this.window) {
      if (this.peekPhase === 0 && this.peekT <= 0) { this.peekPhase = 1; this.peekSide = Math.random() < 0.5 ? -1 : 1; this.peekT = 1.4; }
      if (this.peekPhase === 1) { it.mx = this.peekSide; it.my = 0; it.aim = false; it.crouch = false; this.moveWant = 1; }
      if (this.peekPhase === 2) { it.mx = -this.peekSide; it.my = 0; it.aim = false; }
    }
    if (this.peekPhase === 1 && (this.los.clear || this.peekT <= 0)) { this.peekPhase = this.los.clear ? 3 : 2; this.peekT = this.los.clear ? rand(0.6, 1.2) * lerp(1, 1.6, p.s) : 0.5; }
    else if (this.peekPhase === 3 && this.peekT <= 0) { this.peekPhase = 2; this.peekT = rand(0.4, 0.7); }
    else if (this.peekPhase === 2) { it.mx = -this.peekSide; it.my = 0; it.aim = false; if (this.peekT <= 0) { this.peekPhase = 0; this.peekT = rand(0.5, 1.1); } }
    // ---- no line of sight (and not our own cover): move to where we last saw them
    if (!this.los.clear && !shootPiece && (!ownBlock || !p.peek) && this.peekPhase === 0 && !this.window) {
      if (this.lastSeenPos) {
        const to = new THREE.Vector3(this.lastSeenPos.x - ch.pos.x, 0, this.lastSeenPos.z - ch.pos.z);
        if (to.length() > 2) {
          // walk around while keeping the gun pointed at them (strafe toward their last spot)
          const local = to.normalize();
          const fwd = new THREE.Vector3(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
          it.my = local.dot(fwd); it.mx = local.dot(right); it.sprint = false; this.moveWant = 1;
        }
      }
    }
    if (this.rampT > 0) { this.rampT -= dt; it.my = 1; it.mx = 0; it.sprint = true; } // run up our ramp for high ground

    // ---- build when getting shot
    const recentlyHit = g.time - ch.lastHitTime < 0.6 && ch.lastDamagedBy === t;
    if (recentlyHit && this.buildCd <= 0 && Math.random() < p.build) this.buildFight(t);

    // ---- low health: box up and heal, or break off
    if (this.hp() < 45 && Math.random() < dt * (0.4 + p.s)) {
      const hasHeal = ch.inv.slots.some((s) => s && s.type === 'consumable' && (s.def.heal || s.def.shield));
      if (hasHeal) {
        if (p.build > 0.3 && this.matsFor(40)) this.boxUp(this.matsFor(40));
        this.target = null; this.ignoreT = 3; this.tryHeal();
      }
    }
    // throw a grenade sometimes
    if (Math.random() < dt * 0.08 && dist > 8 && dist < 30 && this.los.clear) {
      const gi = ch.inv.slots.findIndex((s) => s && s.def && s.def.mode === 'throw');
      if (gi >= 0) { const prev = ch.inv.sel; ch.inv.sel = gi; g.combat.shoot(ch, ch.inv.slots[gi], { origin: ch.head, dir: aimDir.clone().setY(aimDir.y + 0.15).normalize(), isPlayer: false }); ch.inv.sel = prev; }
    }
    // switch weapons when the range changes a lot, or the gun runs dry
    this.rangeT = (this.rangeT || 0) - dt;
    if (this.rangeT <= 0) { this.rangeT = lerp(1.4, 0.5, p.s); this.pickWeapon(t); }
    if (w && w.type === 'weapon' && w.mag && w.ammoInMag <= 0 && w.def.ammo && ch.inv.ammo[w.def.ammo] <= 0) this.pickWeapon(t);
    return aimDir;
  }

  matsFor(n) {
    const m = this.ch.inv.mats;
    return m.brick >= n ? 'brick' : m.wood >= n ? 'wood' : m.metal >= n ? 'metal' : null;
  }

  // Fortnite reflexes: wall between us, sometimes a ramp behind it for high ground
  buildFight(t) {
    const g = this.game, ch = this.ch, p = this.p;
    const mat = this.matsFor(10);
    if (!mat) return;
    const look = t.pos.clone().sub(ch.pos).setY(0).normalize();
    const wall = g.building.place(ch, g.building.target(ch, 'wall', look), mat);
    if (wall) this.cover = wall;
    if (this.matsFor(10) && Math.random() < p.build * 0.6) {
      const ramp = g.building.place(ch, g.building.target(ch, 'ramp', look.clone().setY(0.2).normalize(), { own: true }), this.matsFor(10));
      if (ramp && p.s > 0.55) this.rampT = 0.9;
    }
    this.buildCd = lerp(2.4, 0.45, p.s);
  }

  boxUp(mat) {
    const g = this.game, ch = this.ch;
    for (const [x, z] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (ch.inv.mats[mat] < 10) break;
      const pc = g.building.place(ch, g.building.target(ch, 'wall', new THREE.Vector3(x, 0, z)), mat);
      if (pc && !this.cover) this.cover = pc;
    }
    if (ch.inv.mats[mat] >= 10) g.building.place(ch, g.building.target(ch, 'cone', new THREE.Vector3(0.3, 0.9, 0.3).normalize()), mat);
    this.buildCd = 1.2;
  }

  // ---------- dropping from the blimp ----------
  planDrop() {
    if (this.landing) return;
    const m = this.game.match;
    this.landing = this.chooseLanding();
    if (!m || !m.busStart || !m.busEnd) return;
    // jump near the point of the blimp's path that is closest to where we want to land
    const s = m.busStart, e = m.busEnd;
    const ex = e.x - s.x, ez = e.z - s.z, len2 = ex * ex + ez * ez || 1;
    const t = ((this.landing.x - s.x) * ex + (this.landing.z - s.z) * ez) / len2;
    this.jumpAt = clamp(t - rand(0.0, 0.04), 0.03, 0.97);
  }

  chooseLanding() {
    const g = this.game, w = g.world, m = g.match;
    const pois = w.pois || [];
    const s = m && m.busStart, e = m && m.busEnd;
    // how far a point is from the blimp's path (only spots we can glide to)
    const pathDist = (x, z) => {
      if (!s) return 0;
      const ex = e.x - s.x, ez = e.z - s.z, len2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - s.x) * ex + (z - s.z) * ez) / len2, 0, 1);
      return Math.hypot(s.x + ex * t - x, s.z + ez * t - z);
    };
    if (m && !m.botDrops) m.botDrops = {};
    const counts = m ? m.botDrops : {};
    if (Math.random() < 0.65 && pois.length) {
      // spread out: popular spots get less attractive, boss towns are scary
      let total = 0;
      const ws = pois.map((p) => {
        const reach = pathDist(p.x, p.z) < 250 ? 1 : 0.08;
        const wgt = reach * (BOSS_POIS.includes(p.name) ? (this.p.s > 0.5 ? 0.12 : 0) : 1) * (p.name === 'Downtown' ? 1.6 : 1) / (1 + (counts[p.name] || 0) * 0.7);
        total += wgt; return wgt;
      });
      let r = Math.random() * total, pick = pois[0];
      for (let i = 0; i < pois.length; i++) { r -= ws[i]; if (r <= 0) { pick = pois[i]; break; } }
      counts[pick.name] = (counts[pick.name] || 0) + 1;
      const a = rand(0, Math.PI * 2), rr = rand(0, pick.r * 0.8);
      return this.openGround(pick.x + Math.cos(a) * rr, pick.z + Math.sin(a) * rr);
    }
    // the rest land in the wild near a loot spot close to the path
    let best = null;
    for (let i = 0; i < 12; i++) {
      const sp = w.lootSpots[Math.floor(Math.random() * w.lootSpots.length)];
      if (!sp) break;
      if (!best || pathDist(sp.x, sp.z) < pathDist(best.x, best.z)) best = sp;
      if (pathDist(sp.x, sp.z) < 200) { best = sp; break; }
    }
    return best ? this.openGround(best.x, best.z) : this.openGround(rand(-150, 150), rand(-150, 150));
  }

  // nudge a landing spot off rooftops onto open ground (no getting stuck on top of a house)
  openGround(x, z) {
    const g = this.game, w = g.world;
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2), r = i ? 4 + i * 3 : 0;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const gy = w.groundY(px, pz);
      if (gy < 0.5) continue; // water
      const hit = g.physics.raycast({ x: px, y: gy + 60, z: pz }, { x: 0, y: -1, z: 0 }, 70);
      if (!hit || hit.point.y < gy + 1) return new THREE.Vector3(px, gy, pz);
    }
    return new THREE.Vector3(x, w.groundY(x, z), z);
  }

  steerDrop(dt) {
    const ch = this.ch;
    if (!this.landing) this.landing = this.chooseLanding();
    const to = new THREE.Vector3(this.landing.x - ch.pos.x, 0, this.landing.z - ch.pos.z);
    const d = to.length();
    this.faceToward(to, dt, 3);
    const height = ch.pos.y - this.game.world.groundY(ch.pos.x, ch.pos.z);
    // dive hard toward the spot, ease off when we're over it
    this.intent.my = d > 25 ? 1 : d > 4 ? 0.6 : 0;
    if (ch.state === 'skydive' && d < 40 && height < 90) this.intent.jump = true;
  }
}

export function giveStarterAmmo(ch) {
  for (const k of Object.keys(AMMO)) ch.inv.ammo[k] = 0;
}
