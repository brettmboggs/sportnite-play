import { SKINS } from '../game/skins.js';
import { Rng } from '../engine/noise.js';

// XP needed to go from level L to L+1
export const xpForLevel = (L) => 800 + L * 60;

export const EMOTES = [
  { id: 'Wave', name: 'Wave', rarity: 0 },
  { id: 'Punch', name: 'Shadow Box', rarity: 0, anim: 'Punch_Right' },
  { id: 'Kick', name: 'Karate Kick', rarity: 1, anim: 'Kick_Right' },
  { id: 'dance:floss', name: 'The Floss', rarity: 2 },
  { id: 'dance:disco', name: 'Disco Fever', rarity: 2 },
  { id: 'dance:robot', name: 'The Robot', rarity: 3 },
  { id: 'dance:chicken', name: 'Chicken Dance', rarity: 3 },
  { id: 'dance:dab', name: 'Victory Dab', rarity: 4 },
  { id: 'dance:spin', name: 'MVP Spin', rarity: 5 },
  { id: 'dance:worm', name: 'Noodle Arms', rarity: 4 },
  { id: 'Cheer', name: 'Hype Cheer', rarity: 1, anim: 'Cheering' },
  { id: 'Chill', name: 'Sit Back', rarity: 2, anim: 'Sit_Floor_Idle' },
  { id: 'Taunt', name: 'Bring It On', rarity: 3, anim: 'Skeletons_Taunt' },
  { id: 'PushUps', name: 'Push-Up Pro', rarity: 3, anim: 'Push_Ups' },
];

export const GLIDERS = [
  { id: 'classic', name: 'Classic Kite', rarity: 0, colors: ['#ff3d7f', '#ffd34d'] },
  { id: 'ocean', name: 'Ocean Breeze', rarity: 1, colors: ['#3aa0ff', '#7fdcff'] },
  { id: 'jungle', name: 'Jungle Leaf', rarity: 1, colors: ['#2fb84a', '#a8f5d4'] },
  { id: 'candy', name: 'Candy Wing', rarity: 2, colors: ['#ff8fd8', '#ffffff'] },
  { id: 'ghost', name: 'Ghost Sail', rarity: 3, colors: ['#5b3d7a', '#b36bff'] },
  { id: 'golden', name: 'Golden Trophy', rarity: 4, colors: ['#ffc93c', '#fff1a8'] },
  { id: 'inferno', name: 'Inferno Wings', rarity: 5, colors: ['#ff3b3b', '#ff9a1a'] },
  { id: 'cosmic', name: 'Cosmic Comet', rarity: 6, colors: ['rainbow', 'rainbow'] },
];

export const WRAPS = [
  { id: 'camo', name: 'Jungle Camo', rarity: 1, color: '#3f6b2a' },
  { id: 'bubblegum', name: 'Bubblegum', rarity: 2, color: '#ff8fd8' },
  { id: 'ice', name: 'Ice Cold', rarity: 3, color: '#9fe8ff' },
  { id: 'gold', name: 'Solid Gold', rarity: 4, color: '#ffc93c' },
  { id: 'lava', name: 'Lava Flow', rarity: 5, color: '#ff3b1a' },
  { id: 'galaxy', name: 'Galaxy', rarity: 6, color: 'rainbow' },
];

// 100-tier free reward track (deterministic so everyone gets the same track)
export const REWARD_TRACK = (() => {
  const rng = new Rng(2026);
  const skinPool = SKINS.filter((s) => !s.id.endsWith(':og') || s.rarity >= 1).sort((a, b) => a.rarity - b.rarity);
  const track = [];
  let si = 0;
  for (let t = 1; t <= 100; t++) {
    let r;
    if (t === 100) r = { type: 'skin', id: 'Mage:cosmic' };
    else if (t === 50) r = { type: 'skin', id: 'Knight:gold' };
    else if (t % 10 === 0) r = { type: 'skin', id: skinPool[Math.min(skinPool.length - 1, Math.floor((t / 100) * skinPool.length))].id };
    else if (t % 5 === 0) r = { type: 'coins', amount: 300 };
    else if (t % 7 === 0) r = { type: 'emote', id: EMOTES[2 + (si++ % (EMOTES.length - 2))].id };
    else if (t % 6 === 0) r = { type: 'glider', id: GLIDERS[1 + (t % (GLIDERS.length - 2))].id };
    else if (t % 4 === 0) r = { type: 'wrap', id: WRAPS[t % WRAPS.length].id };
    else if (t % 3 === 0) r = { type: 'skin', id: skinPool[Math.floor(rng.next() * Math.min(skinPool.length, 20 + t))].id };
    else r = { type: 'coins', amount: 100 };
    track.push(r);
  }
  return track;
})();

export const PRICES = [300, 500, 800, 1200, 1500, 2000, 2800];

// The item shop rotates every day
export function shopToday() {
  const day = Math.floor(Date.now() / 86400000);
  const rng = new Rng(day * 7 + 3);
  const pool = SKINS.filter((s) => s.rarity >= 1);
  const items = [];
  const used = new Set();
  while (items.length < 6) {
    const s = pool[Math.floor(rng.next() * pool.length)];
    if (used.has(s.id)) continue;
    used.add(s.id);
    items.push({ type: 'skin', id: s.id, price: PRICES[s.rarity] });
  }
  const e = EMOTES[2 + Math.floor(rng.next() * (EMOTES.length - 2))];
  items.push({ type: 'emote', id: e.id, price: PRICES[e.rarity] });
  const gl = GLIDERS[1 + Math.floor(rng.next() * (GLIDERS.length - 1))];
  items.push({ type: 'glider', id: gl.id, price: PRICES[gl.rarity] });
  return items;
}

export function grant(save, reward) {
  const d = save.data;
  if (reward.type === 'coins') d.coins += reward.amount;
  else if (reward.type === 'skin' && !d.owned.skins.includes(reward.id)) d.owned.skins.push(reward.id);
  else if (reward.type === 'emote' && !d.owned.emotes.includes(reward.id)) d.owned.emotes.push(reward.id);
  else if (reward.type === 'glider' && !d.owned.gliders.includes(reward.id)) d.owned.gliders.push(reward.id);
  else if (reward.type === 'wrap' && !d.owned.wraps.includes(reward.id)) d.owned.wraps.push(reward.id);
}

// Award match XP; returns list of { level, reward } unlocked
export function addXp(save, xp) {
  const d = save.data;
  d.xp += xp;
  const unlocked = [];
  while (d.xp >= xpForLevel(d.level)) {
    d.xp -= xpForLevel(d.level);
    d.level++;
    const reward = REWARD_TRACK[d.level - 2];
    if (reward && !d.claimed.includes(d.level - 1)) { grant(save, reward); d.claimed.push(d.level - 1); unlocked.push({ level: d.level, reward }); }
  }
  save.write();
  return unlocked;
}
