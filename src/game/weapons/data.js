// All weapon, rarity, perk and element definitions. Tweak numbers here to balance the game.

export const RARITIES = [
  { id: 0, name: 'Common',    color: '#b9c0c8', glow: 0xb9c0c8, dmg: 1.00, reload: 1.00, perks: 0, element: 0.0 },
  { id: 1, name: 'Uncommon',  color: '#58d63b', glow: 0x58d63b, dmg: 1.06, reload: 0.95, perks: 0, element: 0.0 },
  { id: 2, name: 'Rare',      color: '#3aa0ff', glow: 0x3aa0ff, dmg: 1.12, reload: 0.90, perks: 0, element: 0.10 },
  { id: 3, name: 'Epic',      color: '#b45cff', glow: 0xb45cff, dmg: 1.19, reload: 0.85, perks: 1, element: 0.25 },
  { id: 4, name: 'Legendary', color: '#ffb627', glow: 0xffb627, dmg: 1.26, reload: 0.80, perks: 1, element: 0.40 },
  { id: 5, name: 'Mythic',    color: '#ff3b3b', glow: 0xff3b3b, dmg: 1.36, reload: 0.72, perks: 2, element: 1.0 },
  { id: 6, name: 'Cosmic',    color: 'rainbow', glow: 0xffffff, dmg: 1.50, reload: 0.60, perks: 3, element: 1.0 },
];
export const RARITY_COUNT = RARITIES.length;

export const AMMO = {
  light:  { name: 'Light Ammo',  color: '#9fd5ff', max: 999, pickup: 48 },
  medium: { name: 'Medium Ammo', color: '#ffe066', max: 999, pickup: 40 },
  heavy:  { name: 'Heavy Ammo',  color: '#ff9a52', max: 999, pickup: 12 },
  shells: { name: 'Shells',      color: '#ff6b6b', max: 999, pickup: 15 },
  rockets:{ name: 'Rockets',     color: '#9bff6b', max: 99,  pickup: 4 },
};

export const ELEMENTS = {
  fire:      { name: 'Fire',      color: '#ff7a1a', icon: '🔥' },
  ice:       { name: 'Ice',       color: '#7fdcff', icon: '❄️' },
  lightning: { name: 'Lightning', color: '#fff35a', icon: '⚡' },
  poison:    { name: 'Poison',    color: '#7dff5a', icon: '☠️' },
  explosive: { name: 'Explosive', color: '#ffb05a', icon: '💥' },
};
export const ELEMENT_KEYS = Object.keys(ELEMENTS);

export const PERKS = {
  rapid:      { name: 'Rapid Fire',  desc: '+20% fire rate' },
  bigmag:     { name: 'Big Mag',     desc: '+50% magazine' },
  quickhands: { name: 'Quick Hands', desc: '-30% reload time' },
  vampire:    { name: 'Vampire',     desc: 'Heal 15% of damage dealt' },
  bouncy:     { name: 'Bouncy',      desc: 'Shots ricochet once' },
  explosive:  { name: 'Boom Rounds', desc: 'Hits make tiny explosions' },
  headhunter: { name: 'Headhunter',  desc: '+50% headshot damage' },
  steady:     { name: 'Steady Aim',  desc: '-40% spread' },
  lucky:      { name: 'Lucky',       desc: '10% chance for double damage' },
  piercing:   { name: 'Piercing',    desc: 'Shots go through builds' },
};
export const PERK_KEYS = Object.keys(PERKS);

// mode: auto | semi | burst | pump | bolt | charge | beam | throw | melee
// spread/adsSpread: cone radius in radians. bloom: extra spread per shot (x base, recovers fast).
// falloff..falloffEnd: damage drops linearly to falloffMin. casing: shell ejected (light|medium|heavy|shell). flash: muzzle flash size.
// proj: projectile settings (null = instant hitscan)
// model: { file, size, rot:[x,y,z], pos:[x,y,z] } — rot/pos tune how it sits in the hand
export const WEAPONS = {
  pistol: {
    name: 'Pistol', cls: 'Pistol', mode: 'semi', dmg: 24, hs: 2, rate: 6.75, mag: 16, reload: 1.4, ammo: 'light',
    spread: 0.022, adsSpread: 0.008, bloom: 0.35, range: 120, falloff: 25, falloffEnd: 80, falloffMin: 0.65, recoil: 0.014, casing: 'light', flash: 0.7, sound: 'pistol', model: { file: 'guns/Pistol.glb', size: 0.32 }, minR: 0, maxR: 4, weight: 12,
  },
  revolver: {
    name: 'Hand Cannon', cls: 'Pistol', mode: 'semi', dmg: 60, hs: 2, rate: 1.4, mag: 7, reload: 2.0, ammo: 'medium',
    spread: 0.03, adsSpread: 0.004, bloom: 0.6, range: 150, falloff: 40, falloffEnd: 120, falloffMin: 0.7, recoil: 0.055, casing: 'medium', flash: 1.2, sound: 'revolver', model: { file: 'guns/Revolver.glb', size: 0.38 }, minR: 1, maxR: 5, weight: 6,
  },
  smg: {
    name: 'SMG', cls: 'SMG', mode: 'auto', dmg: 15, hs: 1.75, rate: 12, mag: 30, reload: 2.2, ammo: 'light',
    spread: 0.034, adsSpread: 0.02, bloom: 0.06, range: 80, falloff: 18, falloffEnd: 60, falloffMin: 0.6, recoil: 0.007, casing: 'light', flash: 0.75, sound: 'smg', model: { file: 'guns/SMG.glb', size: 0.5 }, minR: 0, maxR: 5, weight: 11,
  },
  ar: {
    name: 'Assault Rifle', cls: 'Rifle', mode: 'auto', dmg: 31, hs: 1.5, rate: 5.5, mag: 30, reload: 2.3, ammo: 'medium',
    spread: 0.03, adsSpread: 0.006, bloom: 0.16, range: 220, falloff: 50, falloffEnd: 160, falloffMin: 0.75, recoil: 0.011, casing: 'medium', flash: 1, sound: 'ar', model: { file: 'guns/AK.glb', size: 0.8 }, minR: 0, maxR: 6, weight: 14,
  },
  burst: {
    name: 'Burst Rifle', cls: 'Rifle', mode: 'burst', burst: 3, dmg: 27, hs: 1.5, rate: 2.6, mag: 30, reload: 2.4, ammo: 'medium',
    spread: 0.026, adsSpread: 0.004, bloom: 0.12, range: 220, falloff: 50, falloffEnd: 160, falloffMin: 0.75, recoil: 0.01, casing: 'medium', flash: 0.95, sound: 'ar', model: { file: 'blaster/blaster-d.glb', size: 0.75 }, minR: 1, maxR: 5, weight: 8,
  },
  shotgun: {
    name: 'Pump Shotgun', cls: 'Shotgun', mode: 'pump', pellets: 10, dmg: 9.5, hs: 1.75, rate: 0.75, mag: 5, reload: 4.0, shellReload: true, ammo: 'shells',
    spread: 0.085, adsSpread: 0.065, range: 45, falloff: 7, falloffEnd: 30, falloffMin: 0.25, recoil: 0.065, casing: 'shell', flash: 1.6, sound: 'shotgun', model: { file: 'guns/Shotgun.glb', size: 0.85 }, minR: 0, maxR: 6, weight: 13,
  },
  sniper: {
    name: 'Sniper Rifle', cls: 'Sniper', mode: 'bolt', dmg: 105, hs: 2.5, rate: 0.55, mag: 1, reload: 2.6, ammo: 'heavy', scope: 3.5,
    spread: 0.08, adsSpread: 0.0, range: 600, recoil: 0.09, casing: 'heavy', flash: 1.5, sound: 'sniper', proj: { speed: 380, gravity: 9, size: 0.08, tracer: 0xfff2b0 },
    model: { file: 'guns/Sniper.glb', size: 1.0 }, minR: 1, maxR: 6, weight: 7,
  },
  minigun: {
    name: 'Minigun', cls: 'Heavy', mode: 'auto', spinup: 0.6, dmg: 17, hs: 1.5, rate: 15, mag: 150, reload: 4.5, ammo: 'medium',
    spread: 0.045, adsSpread: 0.032, bloom: 0.02, range: 120, falloff: 30, falloffEnd: 100, falloffMin: 0.6, recoil: 0.004, casing: 'medium', flash: 1.1, sound: 'minigun', model: { file: 'blaster/blaster-h.glb', size: 0.9 }, minR: 2, maxR: 6, weight: 4,
  },
  rocket: {
    name: 'Rocket Launcher', cls: 'Explosive', mode: 'semi', dmg: 110, hs: 1, rate: 0.6, mag: 1, reload: 2.8, ammo: 'rockets', splash: 5.5, buildDmg: 400,
    spread: 0.01, adsSpread: 0.0, range: 400, recoil: 0.08, flash: 1.8, sound: 'rocket', proj: { speed: 60, gravity: 0, size: 0.2, model: 'rocket', smoke: true },
    model: { file: 'guns/RocketLauncher.glb', size: 1.1 }, minR: 2, maxR: 6, weight: 4,
  },
  grenadeLauncher: {
    name: 'Grenade Launcher', cls: 'Explosive', mode: 'semi', dmg: 85, hs: 1, rate: 1.5, mag: 6, reload: 3.2, ammo: 'rockets', splash: 4.5, buildDmg: 300,
    spread: 0.015, adsSpread: 0.0, range: 200, recoil: 0.05, flash: 1.3, sound: 'launcher', proj: { speed: 38, gravity: 20, size: 0.16, bounce: 0.5, fuse: 1.6, model: 'grenade' },
    model: { file: 'guns/GrenadeLauncher.glb', size: 0.9 }, minR: 2, maxR: 6, weight: 4,
  },
  bow: {
    name: 'Storm Bow', cls: 'Bow', mode: 'charge', charge: 0.9, dmg: 80, hs: 2, rate: 1.4, mag: 1, reload: 0.4, ammo: null,
    spread: 0.0, adsSpread: 0.0, range: 300, recoil: 0.01, sound: 'bow', proj: { speed: 95, gravity: 12, size: 0.05, model: 'arrow', tracer: 0xc89cff },
    model: { proc: 'bow', size: 1.0 }, minR: 1, maxR: 6, weight: 5,
  },
  crossbow: {
    name: 'Crossbow', cls: 'Bow', mode: 'semi', dmg: 62, hs: 2, rate: 1.1, mag: 1, reload: 1.1, ammo: null,
    spread: 0.004, adsSpread: 0.0, range: 260, recoil: 0.02, sound: 'bow', proj: { speed: 120, gravity: 8, size: 0.05, model: 'arrow', tracer: 0xc89cff },
    model: { file: 'blaster/blaster-c.glb', size: 0.7 }, minR: 1, maxR: 5, weight: 5,
  },
  sword: {
    name: 'Laser Sword', cls: 'Melee', mode: 'melee', dmg: 48, hs: 1, rate: 2.2, mag: 0, reload: 0, ammo: null, reach: 3.2, lunge: 9,
    spread: 0, adsSpread: 0, range: 3.2, recoil: 0, sound: 'sword', model: { proc: 'sword', size: 1.3 }, minR: 2, maxR: 6, weight: 4,
  },
  hammer: {
    name: 'Bonk Hammer', cls: 'Melee', mode: 'melee', dmg: 65, hs: 1, rate: 1.1, mag: 0, reload: 0, ammo: null, reach: 3.0, knockback: 16,
    spread: 0, adsSpread: 0, range: 3.0, recoil: 0, sound: 'bonk', model: { proc: 'hammer', size: 1.3 }, minR: 1, maxR: 6, weight: 4,
  },

  // ---- wacky weapons ----
  freezeRay: {
    name: 'Freeze Ray', cls: 'Wacky', mode: 'beam', dmg: 9, hs: 1, rate: 12, mag: 60, reload: 2.4, ammo: 'light', element: 'ice',
    spread: 0.0, adsSpread: 0.0, range: 40, recoil: 0, sound: 'beam', model: { file: 'blaster/blaster-e.glb', size: 0.7 }, minR: 2, maxR: 6, weight: 4, beamColor: 0x9fe8ff,
  },
  lightningGun: {
    name: 'Lightning Gun', cls: 'Wacky', mode: 'semi', dmg: 30, hs: 1.5, rate: 3, mag: 12, reload: 2.2, ammo: 'medium', element: 'lightning',
    spread: 0.01, adsSpread: 0.0, bloom: 0.2, range: 90, recoil: 0.02, sound: 'zap', model: { file: 'blaster/blaster-k.glb', size: 0.75 }, minR: 2, maxR: 6, weight: 4, beamColor: 0xfff35a,
  },
  bubble: {
    name: 'Bubble Blaster', cls: 'Wacky', mode: 'auto', dmg: 12, hs: 1, rate: 5, mag: 25, reload: 2.0, ammo: 'light', bubbleTrap: true,
    spread: 0.04, adsSpread: 0.02, range: 60, recoil: 0.005, sound: 'bubble', proj: { speed: 26, gravity: -1, size: 0.35, model: 'bubble' },
    model: { file: 'blaster/blaster-m.glb', size: 0.7 }, minR: 1, maxR: 6, weight: 4,
  },
  boomerang: {
    name: 'Boomerang', cls: 'Wacky', mode: 'semi', dmg: 45, hs: 1.5, rate: 1.2, mag: 1, reload: 0.1, ammo: null, returns: true,
    spread: 0, adsSpread: 0, range: 50, recoil: 0, sound: 'whoosh', proj: { speed: 34, gravity: 0, size: 0.4, model: 'boomerang', returnAfter: 0.7, pierce: true },
    model: { proc: 'boomerang', size: 0.7 }, minR: 1, maxR: 6, weight: 4,
  },
  chicken: {
    name: 'Chicken Launcher', cls: 'Wacky', mode: 'semi', dmg: 75, hs: 1, rate: 1.0, mag: 4, reload: 2.6, ammo: 'rockets', splash: 4.5, buildDmg: 250,
    spread: 0.02, adsSpread: 0.0, range: 200, recoil: 0.05, sound: 'chicken', proj: { speed: 32, gravity: 12, size: 0.35, model: 'chicken', bounce: 0.3, fuse: 2.5, explodeOnHit: true },
    model: { file: 'blaster/blaster-r.glb', size: 0.9 }, minR: 3, maxR: 6, weight: 3,
  },
  paint: {
    name: 'Paint Cannon', cls: 'Wacky', mode: 'auto', pellets: 3, dmg: 12, hs: 1.5, rate: 3.5, mag: 20, reload: 2.2, ammo: 'shells', paint: true,
    spread: 0.05, adsSpread: 0.03, range: 70, recoil: 0.02, sound: 'splat', proj: { speed: 55, gravity: 9, size: 0.18, model: 'paint' },
    model: { file: 'blaster/blaster-q.glb', size: 0.8 }, minR: 1, maxR: 6, weight: 4,
  },

  // ---- sports weapons ----
  golfSniper: {
    name: 'Golf Ball Sniper', cls: 'Sports', mode: 'bolt', dmg: 95, hs: 2.4, rate: 0.7, mag: 3, reload: 2.4, ammo: 'heavy', scope: 3, ricochet: true,
    spread: 0.06, adsSpread: 0.0, range: 500, recoil: 0.08, sound: 'golf', proj: { speed: 300, gravity: 7, size: 0.12, model: 'golf', tracer: 0xffffff },
    model: { file: 'blaster/blaster-l.glb', size: 1.0 }, minR: 2, maxR: 6, weight: 4,
  },
  soccerCannon: {
    name: 'Soccer Cannon', cls: 'Sports', mode: 'semi', dmg: 50, hs: 1, rate: 1.2, mag: 3, reload: 2.5, ammo: 'rockets', knockback: 22, buildDmg: 200,
    spread: 0.01, adsSpread: 0.0, range: 200, recoil: 0.06, sound: 'kick', proj: { speed: 40, gravity: 10, size: 0.5, model: 'soccer', bounce: 0.7, fuse: 3 },
    model: { file: 'blaster/blaster-g.glb', size: 0.9 }, minR: 2, maxR: 6, weight: 3,
  },

  // ---- throwables (stack in a slot) ----
  grenade: {
    name: 'Grenade', cls: 'Throwable', mode: 'throw', stack: 6, dmg: 100, splash: 5, buildDmg: 300, rate: 1.2, ammo: null, range: 0,
    proj: { speed: 26, gravity: 20, size: 0.18, model: 'grenade', bounce: 0.4, fuse: 2.2 }, model: { file: 'guns/Grenade.glb', size: 0.22 }, minR: 1, maxR: 3, weight: 7,
  },
  fireGrenade: {
    name: 'Fire Grenade', cls: 'Throwable', mode: 'throw', stack: 6, dmg: 60, splash: 5, element: 'fire', rate: 1.2, ammo: null, range: 0,
    proj: { speed: 26, gravity: 20, size: 0.18, model: 'grenade', bounce: 0.3, fuse: 1.8 }, model: { file: 'guns/FireGrenade.glb', size: 0.22 }, minR: 2, maxR: 4, weight: 4,
  },
  slamDunk: {
    name: 'Slam Dunk', cls: 'Throwable', mode: 'throw', stack: 4, dmg: 90, splash: 5, buildDmg: 300, rate: 1.2, ammo: null, range: 0,
    proj: { speed: 24, gravity: 18, size: 0.3, model: 'basketball', bounce: 0.8, fuse: 3.0, bouncesToExplode: 3 }, model: { proc: 'basketball', size: 0.3 }, minR: 2, maxR: 5, weight: 4,
  },
  blackHole: {
    name: 'Black Hole', cls: 'Throwable', mode: 'throw', stack: 2, dmg: 70, splash: 7, pull: true, buildDmg: 500, rate: 1.2, ammo: null, range: 0,
    proj: { speed: 22, gravity: 16, size: 0.25, model: 'blackhole', bounce: 0.1, fuse: 1.2 }, model: { proc: 'blackhole', size: 0.3 }, minR: 3, maxR: 6, weight: 2,
  },
};

// The baseball bat is the harvesting tool everyone always has.
export const PICKAXE = {
  id: 'bat', name: 'Slugger Bat', cls: 'Pickaxe', mode: 'melee', dmg: 20, harvest: 34, rate: 1.9, reach: 2.6, ammo: null,
  sound: 'bat', model: { proc: 'bat', size: 1.0 },
};

export const CONSUMABLES = {
  bandage:      { name: 'Bandages',       icon: '🩹', stack: 15, use: 3.0, heal: 15, maxHeal: 75, color: '#ffffff', weight: 10, rarity: 0 },
  medkit:       { name: 'Med Kit',        icon: '➕', stack: 3, use: 8.0, heal: 100, maxHeal: 100, color: '#ff4d4d', weight: 4, rarity: 1 },
  smallShield:  { name: 'Mini Shield',    icon: '🧪', stack: 6, use: 1.5, shield: 25, maxShield: 50, color: '#3aa0ff', weight: 9, rarity: 1 },
  bigShield:    { name: 'Big Shield',     icon: '🛡️', stack: 3, use: 4.0, shield: 50, maxShield: 100, color: '#3aa0ff', weight: 5, rarity: 2 },
  sportsDrink:  { name: 'Sports Drink',   icon: '🥤', stack: 4, use: 1.0, heal: 25, shield: 25, maxHeal: 100, maxShield: 100, speedBoost: 6, color: '#7dff5a', weight: 4, rarity: 3 },
  launchPad:    { name: 'Launch Pad',     icon: '🚀', stack: 1, use: 0.5, place: 'launchpad', color: '#ffb627', weight: 3, rarity: 3 },
  bouncePad:    { name: 'Bounce Pad',     icon: '🟢', stack: 3, use: 0.3, place: 'bouncepad', color: '#7dff5a', weight: 3, rarity: 2 },
};

export const SKILLS = {
  dash:       { name: 'Dash',          icon: '💨', cooldown: 4,  charges: 3, desc: 'Zoom forward' },
  doubleJump: { name: 'Double Jump',   icon: '🦘', cooldown: 0,  passive: true, desc: 'Jump again in mid-air' },
  jetpack:    { name: 'Jetpack',       icon: '🚀', cooldown: 0,  fuel: 6, desc: 'Hold to fly' },
  grapple:    { name: 'Grapple Hook',  icon: '🪝', cooldown: 6,  charges: 5, desc: 'Zip to where you aim' },
  shield:     { name: 'Shield Bubble', icon: '🫧', cooldown: 25, duration: 6, desc: 'Bubble that blocks bullets' },
  invisible:  { name: 'Invisibility',  icon: '👻', cooldown: 30, duration: 6, desc: 'Turn invisible' },
  heal:       { name: 'Healing Zone',  icon: '💚', cooldown: 30, duration: 8, desc: 'Heal everyone inside' },
  turret:     { name: 'Turret',        icon: '🔫', cooldown: 35, duration: 15, desc: 'Auto-turret that shoots enemies' },
  airstrike:  { name: 'Airstrike',     icon: '✈️', cooldown: 45, desc: 'Call rockets where you aim' },
  slowmo:     { name: 'Slow-Mo',       icon: '⏳', cooldown: 40, duration: 4, desc: 'Slow down time around you' },
  wallrun:    { name: 'Wall-Run',      icon: '🧗', cooldown: 0, passive: true, desc: 'Run along walls' },
  decoy:      { name: 'Decoy Clone',   icon: '👯', cooldown: 20, duration: 8, desc: 'Send a fake you to trick enemies' },
  slam:       { name: 'Ground Slam',   icon: '💥', cooldown: 15, desc: 'Smash down from the air' },
};
export const SKILL_KEYS = Object.keys(SKILLS);

export const ULTIMATES = [
  { streak: 3, id: 'megashield', name: 'MEGA SHIELD', icon: '🛡️', desc: 'Full health and shield + overshield' },
  { streak: 5, id: 'meteor', name: 'METEOR STRIKE', icon: '☄️', desc: 'Rain meteors where you aim' },
  { streak: 8, id: 'mvp', name: 'MVP MODE', icon: '🏆', desc: 'Giant size + infinite ammo for 12s' },
];

// weighted list for random floor loot
export function weaponLootTable() {
  return Object.entries(WEAPONS).map(([id, w]) => [id, w.weight]);
}
