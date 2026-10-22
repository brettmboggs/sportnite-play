import { STARTER_SKINS, SKINS, migrateSkins } from '../game/skins.js';

const KEY = 'sportnite-save-v1';

export const DEFAULT_SETTINGS = {
  sensitivity: 1, padSensitivity: 1, invertY: false, fov: 80, quality: 'auto', autoLevel: 'medium',
  master: 0.8, sfx: 1, music: 0.4, blood: true, autoSprint: true, aimAssist: 1,
  bots: 35, difficulty: 'coach', showFps: false,
  // controller (read by game.applySettings → input)
  padDeadzone: 0.12, padLookX: 1, padLookY: 1, padAdsSens: 0.6, vibration: true,
  // HUD
  hudScale: 1, damageNumbers: true,
};

function defaults() {
  return {
    name: 'Player', skin: STARTER_SKINS[0], emote: 'Wave', glider: 'classic', wrap: null,
    owned: { skins: [...STARTER_SKINS], emotes: ['Wave', 'Punch'], gliders: ['classic'], wraps: [] },
    coins: 500, xp: 0, level: 1, claimed: [],
    stats: { matches: 0, wins: 0, kills: 0, top10: 0, bossKills: 0, damage: 0 },
    skill: 0.45, history: [],
    trophies: [], cheats: [],
    settings: { ...DEFAULT_SETTINGS },
    shopSeed: 0,
  };
}

export class Save {
  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { ...defaults(), ...d, owned: { ...defaults().owned, ...(d.owned || {}) }, stats: { ...defaults().stats, ...(d.stats || {}) }, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
      }
    } catch { /* private window etc. — play without saving */ }
    // v2: sprint is on by default now (like Fortnite); switch older saves over once
    if (!this.data.settings.v2) { this.data.settings.autoSprint = true; this.data.settings.v2 = true; }
    // v3: the heroes changed (KayKit); old outfits turn into new ones so nobody loses their collection
    if (!this.data.settings.v3) {
      const m = migrateSkins(this.data.owned.skins, this.data.skin);
      this.data.owned.skins = m.owned; this.data.skin = m.equipped;
      this.data.settings.v3 = true;
    }
    // v4: graphics default to Auto now (it picks the best quality the computer can run smoothly)
    if (!this.data.settings.v4) {
      if (this.data.settings.quality === 'high') this.data.settings.quality = 'auto';
      this.data.settings.v4 = true;
    }
    // drop unknown skins (in case of updates)
    const ids = new Set(SKINS.map((s) => s.id));
    this.data.owned.skins = this.data.owned.skins.filter((s) => ids.has(s));
    if (!ids.has(this.data.skin)) this.data.skin = STARTER_SKINS[0];
  }

  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  reset() { this.data = defaults(); this.write(); }
}
