import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { assets } from '../engine/assets.js';
import { POIS } from '../world/world.js';
import { grant } from '../meta/progression.js';
import { makeWeapon } from './items.js';

// Cheat codes, hidden trophies, the golden blimp, and the dancing skeleton.
export const CHEATS = {
  GODMODE: { key: 'god', desc: 'You can\'t take damage' },
  MOONJUMP: { key: 'moonJump', desc: 'Low gravity, no fall damage' },
  TURBO: { key: 'turbo', desc: 'Run super fast' },
  INFINITEMATS: { key: 'infiniteMats', desc: 'Build without materials' },
  RICHKID: { key: 'richMode', desc: 'Free weapon upgrades' },
  BIGHEAD: { key: 'bigHead', desc: 'Everyone has giant heads' },
  RAINBOW: { key: 'rainbowLoot', desc: 'All loot is way rarer' },
  GOLDENBLIMP: { key: 'goldenBlimp', desc: 'Golden blimp every match' },
  CHICKENRAIN: { key: 'chickenRain', desc: 'It rains chickens' },
};
export const ONE_TIME_CODES = {
  SPORTNITE: { coins: 1000, desc: '+1000 coins (once)' },
  SLAMDUNK: { skin: 'Knight:neon', desc: 'Unlocks Neon Sir Dunk-a-Lot' },
};

export class Secrets {
  constructor(game) {
    this.game = game;
    this.trophies = [];
    this.skeleton = null;
    this.chickenT = 5;
  }

  // returns message string
  enterCode(raw) {
    const code = raw.trim().toUpperCase().replace(/\s+/g, '');
    const d = this.game.save.data;
    if (CHEATS[code]) {
      const k = CHEATS[code].key;
      this.game.cheats[k] = !this.game.cheats[k];
      audio.ui('confirm');
      return `${code}: ${this.game.cheats[k] ? 'ON' : 'OFF'} (${CHEATS[code].desc}). Cheats turn off XP for that match.`;
    }
    if (ONE_TIME_CODES[code]) {
      if (d.cheats.includes(code)) return 'You already used that code!';
      const c = ONE_TIME_CODES[code];
      if (c.coins) d.coins += c.coins;
      if (c.skin) grant(this.game.save, { type: 'skin', id: c.skin });
      d.cheats.push(code);
      this.game.save.write();
      audio.jingle('unlock', 0.6);
      return `Code accepted! ${c.desc}`;
    }
    audio.ui('error');
    return 'Nope, that\'s not a code. Keep guessing!';
  }

  trophySpots() {
    const g = this.game, w = g.world;
    const at = (name, dx = 0, dy = 0, dz = 0) => { const p = POIS.find((q) => q.name === name); return new THREE.Vector3(p.x + dx, w.groundY(p.x + dx, p.z + dz) + dy, p.z + dz); };
    return [
      { id: 'donut', pos: at('Donut Hill', 0, 33.5, 0) },               // on top of the giant donut
      { id: 'summit', pos: at('Frosty Summit', 0, 12.0, 0) },            // on the summit lodge roof
      { id: 'mansion', pos: at('Spooky Mansion', 4, 8.2, -3) },          // top floor of the mansion
      { id: 'stadium', pos: at('Goal Stadium', 0, 19.6, -33.4) },        // on top of the big screen
      { id: 'lagoon', pos: at('Palm Lagoon', 30, 0.8, 40) },             // hidden on the beach
    ];
  }

  spawnTrophies() {
    const found = this.game.save.data.trophies;
    for (const s of this.trophySpots()) {
      if (found.includes(s.id)) continue;
      const cup = new THREE.Group();
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 1, roughness: 0.2, emissive: 0x553300 });
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.15, 0.45, 16, 1, true), gold); bowl.position.y = 0.65;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3), gold); stem.position.y = 0.3;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), gold); base.position.y = 0.08;
      for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 12), gold); h.position.set(sx * 0.38, 0.7, 0); h.rotation.y = Math.PI / 2; cup.add(h); }
      cup.add(bowl, stem, base);
      const glow = new THREE.Sprite(this.game.loot.glowMat(0xffc93c)); glow.position.y = 0.6; glow.scale.setScalar(3); cup.add(glow);
      cup.position.copy(s.pos);
      this.game.scene.add(cup);
      this.trophies.push({ id: s.id, mesh: cup });
    }
    // dancing skeleton in the graveyard: emote next to it for a surprise
    const crypt = POIS.find((p) => p.name === 'Creepy Crypts');
    if (assets.get('graveyard/character-skeleton.glb')) {
      const sk = assets.model('graveyard/character-skeleton.glb', { height: 2 });
      const x = crypt.x - 18, z = crypt.z + 16;
      sk.position.set(x, this.game.world.groundY(x, z), z);
      this.game.scene.add(sk);
      this.skeleton = { mesh: sk, used: false, base: sk.position.clone() };
    }
  }

  goldenBlimp() {
    const g = this.game;
    if (!(g.cheats.goldenBlimp || Math.random() < 0.04)) return false;
    g.match.blimp.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(0xffc93c), 0.7); o.material.metalness = 0.8; o.material.roughness = 0.25; } });
    for (const c of g.loot.chests) if (!c.ammoBox && !c.supply) { c.rare = true; if (c.glow) c.glow.material = g.loot.glowMat(0xffb627); }
    return true;
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (let i = this.trophies.length - 1; i >= 0; i--) {
      const t = this.trophies[i];
      t.mesh.rotation.y += dt * 1.5;
      if (p && p.alive && p.pos.distanceTo(t.mesh.position) < 1.8) {
        const d = g.save.data;
        d.trophies.push(t.id);
        t.mesh.removeFromParent();
        this.trophies.splice(i, 1);
        g.effects.confetti(p.center, 80);
        audio.jingle('unlock', 0.7);
        const n = d.trophies.length;
        if (n >= 5) {
          grant(g.save, { type: 'skin', id: 'Rogue_Hooded:cosmic' });
          g.hud.bigMessage('🏆 ALL 5 TROPHIES FOUND! 🏆', 'You unlocked COSMIC ASTRO ANDY!');
        } else g.hud.bigMessage(`🏆 SECRET TROPHY ${n}/5`, 'Find them all for a secret Cosmic skin!');
        g.save.write();
      }
    }
    if (this.skeleton) {
      const s = this.skeleton;
      s.mesh.rotation.y += dt * 3;
      s.mesh.position.y = s.base.y + Math.abs(Math.sin(g.time * 6)) * 0.4;
      if (!s.used && p && p.alive && p.emoting && p.pos.distanceTo(s.base) < 6) {
        s.used = true;
        g.hud.bigMessage('💀 DANCE BATTLE WON! 💀', 'The skeleton gives you a gift...');
        g.loot.dropItem(makeWeapon('sword', 5), s.base.clone().add(new THREE.Vector3(0, 1, 2)), new THREE.Vector3(0, 6, 3));
        g.effects.confetti(s.base, 100);
        audio.jingle('win', 0.5);
      }
    }
    if (g.cheats.chickenRain && g.match && p) {
      this.chickenT -= dt;
      if (this.chickenT <= 0) {
        this.chickenT = 0.6;
        const w = makeWeapon('chicken', 3);
        w.dmg = 0;
        const pos = p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 50, (Math.random() - 0.5) * 60));
        g.combat.spawnProjectile(p, w, pos, new THREE.Vector3(0, -1, 0), 0.3);
      }
    }
    if (g.cheats.bigHead && g.match) for (const c of g.chars) if (c.headBone && !c.isPlayer && !c.skin.headless) c.headBone.scale.setScalar(2.4);
  }

  clear() {
    for (const t of this.trophies) t.mesh.removeFromParent();
    this.trophies = [];
    if (this.skeleton) { this.skeleton.mesh.removeFromParent(); this.skeleton = null; }
  }
}
