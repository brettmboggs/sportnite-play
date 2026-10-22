import { WEAPONS, RARITIES, PERK_KEYS, ELEMENT_KEYS, CONSUMABLES, SKILLS, SKILL_KEYS, weaponLootTable } from './weapons/data.js';
import { Rng } from '../engine/noise.js';

let uid = 1;
const rng = new Rng(Date.now() & 0xffff);

export function makeWeapon(id, rarity, opts = {}) {
  const def = WEAPONS[id];
  rarity = Math.max(def.minR ?? 0, Math.min(def.maxR ?? 6, rarity));
  const R = RARITIES[rarity];
  const perks = opts.perks ? [...opts.perks] : [];
  if (!opts.perks) {
    const pool = PERK_KEYS.filter((p) => !(def.mode === 'melee' && ['bigmag', 'quickhands', 'bouncy', 'steady', 'piercing'].includes(p)) && !(def.mode === 'throw'));
    while (perks.length < R.perks && pool.length && def.mode !== 'throw') {
      const p = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
      perks.push(p);
    }
  }
  let element = opts.element ?? def.element ?? null;
  if (!element && def.mode !== 'throw' && rng.chance(R.element)) element = rng.pick(ELEMENT_KEYS);
  const w = { type: 'weapon', uid: uid++, id, def, rarity, perks, element };
  computeStats(w);
  w.ammoInMag = w.mag;
  w.count = def.stack ? Math.max(1, Math.min(def.stack, opts.count ?? (1 + Math.floor(rng.next() * 3)))) : 1;
  return w;
}

export function computeStats(w) {
  const def = w.def, R = RARITIES[w.rarity];
  const has = (p) => w.perks.includes(p);
  w.dmg = def.dmg * R.dmg;
  w.rate = def.rate * (has('rapid') ? 1.2 : 1);
  w.mag = Math.round((def.mag || 0) * (has('bigmag') ? 1.5 : 1));
  w.reload = def.reload * R.reload * (has('quickhands') ? 0.7 : 1);
  w.spread = (def.spread || 0) * (has('steady') ? 0.6 : 1) * (1 - w.rarity * 0.04);
  w.adsSpread = (def.adsSpread || 0) * (has('steady') ? 0.6 : 1);
  w.hs = (def.hs || 1) * (has('headhunter') ? 1.5 : 1);
  w.name = def.name;
  return w;
}

export function upgradeWeapon(w) {
  if (w.rarity >= (w.def.maxR ?? 6)) return false;
  w.rarity++;
  const R = RARITIES[w.rarity];
  while (w.perks.length < R.perks && w.def.mode !== 'throw') {
    const pool = PERK_KEYS.filter((p) => !w.perks.includes(p));
    w.perks.push(rng.pick(pool));
  }
  if (!w.element && w.rarity >= 5 && w.def.mode !== 'throw') w.element = rng.pick(ELEMENT_KEYS);
  computeStats(w);
  w.ammoInMag = w.mag;
  return true;
}

export function makeConsumable(id, count = null) {
  const def = CONSUMABLES[id];
  return { type: 'consumable', uid: uid++, id, def, rarity: def.rarity, count: count ?? (def.stack > 3 ? 2 + Math.floor(rng.next() * 3) : 1), name: def.name };
}

export function makeSkill(id) {
  const def = SKILLS[id];
  return { type: 'skill', uid: uid++, id, def, rarity: 3, name: def.name, charges: def.charges ?? 1, cooldownLeft: 0, fuel: def.fuel ?? 0 };
}

// Roll a rarity. luck shifts odds upward (chests > floor, supply drops >> chests)
let luckBonus = 0;
export function setLuckBonus(v) { luckBonus = v; }

export function rollRarity(luck = 0, r = rng) {
  luck += luckBonus;
  const base = [38, 30, 18, 9, 4, 0.8, 0.15];
  const w = base.map((b, i) => [i, b * Math.pow(1 + luck, i)]);
  return r.weighted(w);
}

export function randomWeapon(luck = 0, r = rng) {
  const id = r.weighted(weaponLootTable());
  return makeWeapon(id, rollRarity(luck, r));
}

// A real gun (no throwables or melee), at least minR rarity. Used so every chest has something to shoot.
export function randomGun(luck = 0, r = rng, minR = 0) {
  const table = weaponLootTable().filter(([id]) => WEAPONS[id].mode !== 'throw' && WEAPONS[id].mode !== 'melee' && WEAPONS[id].ammo);
  const id = r.weighted(table);
  return makeWeapon(id, Math.max(minR, rollRarity(luck, r)));
}

export function randomThrowable(r = rng) {
  const table = weaponLootTable().filter(([id]) => WEAPONS[id].mode === 'throw');
  return makeWeapon(r.weighted(table), rollRarity(0.3, r));
}

export function randomConsumable(r = rng) {
  const id = r.weighted(Object.entries(CONSUMABLES).map(([k, v]) => [k, v.weight]));
  return makeConsumable(id);
}

export function randomSkill(r = rng) { return makeSkill(r.pick(SKILL_KEYS)); }

export function rarityColor(r) { return RARITIES[r].color === 'rainbow' ? '#ffffff' : RARITIES[r].color; }
