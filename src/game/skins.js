import * as THREE from 'three';
import { addRim } from '../engine/stylize.js';

// Hero outfits. The heroes are the KayKit Adventurers (Kay Lousberg, CC0). Every hero comes in
// 9 versions made in code by repainting its color atlas: Original, Team Red, Team Blue, Frost,
// Midnight, Neon, Golden, Inferno and Cosmic. The rarer the version, the shinier it looks.

export const HEROES = [
  { model: 'Ranger', name: 'Arrow Archie', base: 0 },
  { model: 'Rogue', name: 'Ruby Rush', base: 0 },
  { model: 'Barbarian', name: 'Bear Hug Bruno', base: 0 },
  { model: 'Knight', name: 'Sir Dunk-a-Lot', base: 1 },
  { model: 'Rogue_Hooded', name: 'Shadow Hood', base: 2 },
  { model: 'Mage', name: 'Wizard Swish', base: 3 },
];

const VARIANTS = [
  { key: 'og', label: '', rarity: null },
  { key: 'red', label: 'Team Red ', rarity: 1, effect: 'red' },
  { key: 'blue', label: 'Team Blue ', rarity: 1, effect: 'blue' },
  { key: 'frost', label: 'Frost ', rarity: 2, effect: 'frost' },
  { key: 'shadow', label: 'Midnight ', rarity: 2, effect: 'shadow' },
  { key: 'neon', label: 'Neon ', rarity: 3, effect: 'neon' },
  { key: 'gold', label: 'Golden ', rarity: 4, effect: 'gold' },
  { key: 'inferno', label: 'Inferno ', rarity: 5, effect: 'inferno' },
  { key: 'cosmic', label: 'Cosmic ', rarity: 6, effect: 'cosmic' },
];

export const SKINS = [];
for (const h of HEROES) {
  for (const v of VARIANTS) {
    const rarity = v.rarity ?? h.base;
    SKINS.push({ id: `${h.model}:${v.key}`, model: h.model, name: v.label + h.name, rarity, effect: v.effect || null, hue: (h.name.length * 0.13) % 1 });
  }
}
export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const STARTER_SKINS = ['Ranger:og', 'Rogue:og', 'Barbarian:og', 'Knight:og'];

export const BOSS_SKINS = {
  mascot: { id: 'boss:mascot', model: 'Barbarian', name: 'THE MASCOT', rarity: 5, effect: 'mascot', prop: 'foamFinger' },
  candyKing: { id: 'boss:candy', model: 'Knight', name: 'THE CANDY KING', rarity: 5, effect: 'candy', prop: 'crown' },
  headlessCoach: { id: 'boss:coach', model: 'Rogue_Hooded', name: 'THE HEADLESS COACH', rarity: 5, effect: 'ghost', headless: true, prop: 'ghostFire' },
};

// ---------- save-data migration: the old (Quaternius) heroes map onto the new ones ----------
const LEGACY_HERO = {
  m_Casual_Hoodie: 'Ranger', m_Casual_2: 'Ranger', m_Adventurer: 'Ranger', m_Farmer: 'Barbarian', m_Worker: 'Barbarian',
  m_Beach: 'Rogue', m_Punk: 'Rogue_Hooded', m_Suit: 'Rogue_Hooded', m_Swat: 'Knight', m_King: 'Knight', m_Spacesuit: 'Mage',
  w_Casual: 'Rogue', w_Worker: 'Barbarian', w_Formal: 'Mage', w_Punk: 'Rogue_Hooded', w_Adventurer: 'Rogue', w_Suit: 'Rogue',
  w_Soldier: 'Knight', w_Medieval: 'Knight', w_SciFi: 'Mage', w_Witch: 'Mage',
};
// if two old outfits land on the same new one, the second becomes the next version up, so nobody's
// collection shrinks
const FALLBACK_KEYS = ['og', 'red', 'blue', 'frost', 'shadow', 'neon'];

// Returns { owned, equipped } with every old skin id turned into a new one.
export function migrateSkins(owned, equipped) {
  const out = new Set();
  const map = (id) => {
    if (SKIN_BY_ID[id]) { out.add(id); return id; }
    const [old, key] = String(id).split(':');
    const hero = LEGACY_HERO[old];
    if (!hero) return null;
    const want = SKIN_BY_ID[`${hero}:${key}`] ? key : 'og';
    const order = [want, ...FALLBACK_KEYS.filter((k) => k !== want)];
    for (const k of order) {
      const nid = `${hero}:${k}`;
      if (SKIN_BY_ID[nid] && !out.has(nid)) { out.add(nid); return nid; }
    }
    return `${hero}:${want}`;
  };
  const eq = map(equipped);
  for (const id of owned || []) if (id !== equipped) map(id);
  for (const s of STARTER_SKINS) out.add(s);
  return { owned: [...out].filter((id) => SKIN_BY_ID[id]), equipped: eq && SKIN_BY_ID[eq] ? eq : STARTER_SKINS[0] };
}

// ---------- materials ----------
// Clone every mesh's material (so outfits never leak between heroes) and remember which body part it is.
export function prepHero(object) {
  const materials = [];
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.userData.part = (o.name || '').replace(/^.*_/, ''); // Knight_ArmLeft -> ArmLeft
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    materials.push(o.material);
  });
  return materials;
}

// ---- repainting the color atlas ----
// KayKit heroes use one small gradient atlas; the top-left cell is always skin, so skin (and the black of
// the eyes) stays put while everything else is repainted.
const texCache = new Map();
const _c = new THREE.Color(), _hsl = {};
const lum = (r, g, b) => 0.3 * r + 0.55 * g + 0.15 * b;
const mix = (a, b, t) => a + (b - a) * t;

const PAINT = {
  red: (r, g, b) => { const L = lum(r, g, b); return [0.12 + 0.95 * L, 0.03 + 0.25 * L * L, 0.05 + 0.25 * L * L]; },
  blue: (r, g, b) => { const L = lum(r, g, b); return [0.03 + 0.25 * L * L, 0.12 + 0.5 * L, 0.3 + 0.75 * L]; },
  frost: (r, g, b) => { const L = lum(r, g, b); return [mix(0.45, 0.95, L), mix(0.7, 1, L), mix(0.9, 1, L)]; },
  shadow: (r, g, b) => { const L = lum(r, g, b), k = Math.pow(L, 2.2); return [mix(0.05, 0.1, k), mix(0.05, 0.9, k), mix(0.12, 1, k)]; },
  neon: (r, g, b, hue) => { _c.setRGB(r, g, b).getHSL(_hsl); _c.setHSL((_hsl.h + hue + 0.5) % 1, 0.95, Math.max(0.4, Math.min(0.65, _hsl.l + 0.12))); return [_c.r, _c.g, _c.b]; },
  gold: (r, g, b) => { const L = lum(r, g, b); return [Math.min(1, 0.35 + 0.9 * L), Math.min(1, 0.22 + 0.7 * L), 0.05 + 0.25 * L]; },
  inferno: (r, g, b) => { const L = lum(r, g, b), k = L * L; return [mix(0.18, 1, Math.min(1, L * 1.3)), mix(0.02, 0.55, k), mix(0.01, 0.08, k)]; },
  cosmic: (r, g, b) => { const L = lum(r, g, b); return [0.05 + 0.25 * L, 0.03 + 0.12 * L, 0.15 + 0.45 * L]; },
  mascot: (r, g, b) => { const L = lum(r, g, b); return [Math.min(1, 0.55 + 0.6 * L), Math.min(1, 0.4 + 0.5 * L), 0.02 + 0.1 * L]; },
  candy: (r, g, b) => { const L = lum(r, g, b), s = (Math.sin(L * 18) + 1) * 0.5; return [mix(1, 0.55, s * 0.4), mix(0.45, 0.85, s) * (0.6 + 0.5 * L), mix(0.75, 0.95, s)]; },
  kit: (r, g, b, hue, kit) => { const L = lum(r, g, b); return [kit.r * (0.25 + 0.95 * L), kit.g * (0.25 + 0.95 * L), kit.b * (0.25 + 0.95 * L)]; },
  ghost: (r, g, b) => { const L = lum(r, g, b); return [0.1 + 0.3 * L, 0.06 + 0.12 * L, 0.2 + 0.5 * L]; },
};
// which parts get repainted (team colors are a jersey: shirt, sleeves and cape only)
const JERSEY = /^(Body|ArmLeft|ArmRight|Cape)$/;
const JERSEY_FX = new Set(['red', 'blue', 'kit']);

function paintedTexture(src, key, effect, hue, kit) {
  const ck = key + ':' + effect + (kit ? ':' + kit.getHexString() : '');
  if (texCache.has(ck)) return texCache.get(ck);
  const img = src.image;
  const N = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N), p = d.data;
  // skin tones from the top-left cell (one per row of the gradient)
  const cell = N / 8, skin = [];
  for (let y = 0; y < cell * 2; y += 2) { const i = (y * N + Math.floor(cell / 2)) * 4; skin.push([p[i], p[i + 1], p[i + 2]]); }
  const fn = PAINT[effect];
  if (kit) kit = kit.getRGB({}, THREE.SRGBColorSpace); // the atlas pixels are sRGB
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    if (r + g + b < 40) continue; // eyes, brows
    let isSkin = false;
    for (const s of skin) if (Math.abs(s[0] - r) + Math.abs(s[1] - g) + Math.abs(s[2] - b) < 30) { isSkin = true; break; }
    if (isSkin) continue;
    const o = fn(r / 255, g / 255, b / 255, hue, kit);
    p[i] = Math.max(0, Math.min(255, o[0] * 255)); p[i + 1] = Math.max(0, Math.min(255, o[1] * 255)); p[i + 2] = Math.max(0, Math.min(255, o[2] * 255));
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = src.flipY; t.colorSpace = src.colorSpace; t.wrapS = src.wrapS; t.wrapT = src.wrapT;
  t.anisotropy = 4;
  texCache.set(ck, t);
  return t;
}

const EMISSIVE = { neon: 0.45, inferno: 0.7, cosmic: 0.8, ghost: 0.6, mascot: 0.15, candy: 0.12 };

export function applySkin(char, skin) {
  const effect = skin.effect;
  for (const m of char.materials) {
    if (!m.isMeshStandardMaterial) continue;
    m.emissive = m.emissive || new THREE.Color();
    m.roughness = 0.62; m.metalness = 0;
    addRim(m);
    const part = m.userData.part || '';
    const repaint = effect && m.map && PAINT[effect] && (JERSEY_FX.has(effect) ? JERSEY.test(part) : true);
    if (repaint) {
      m.map = paintedTexture(m.map, skin.model, effect, skin.hue || 0, skin.kit !== undefined ? new THREE.Color(skin.kit) : null);
      if (EMISSIVE[effect]) { m.emissiveMap = m.map; m.emissive.setRGB(1, 1, 1).multiplyScalar(EMISSIVE[effect]); }
      if (effect === 'gold') { m.metalness = 0.85; m.roughness = 0.25; }
      if (effect === 'frost') { m.roughness = 0.3; m.metalness = 0.15; }
      if (effect === 'neon') m.roughness = 0.35;
      if (effect === 'cosmic') { m.userData.cosmic = true; m.roughness = 0.2; m.metalness = 0.5; }
      m.needsUpdate = true;
    }
    m.userData.baseEmissive = m.emissive.clone();
  }
  if (skin.headless && char.headBone) char.headBone.scale.setScalar(0.001);
  if (skin.prop && char.bones) addBossProp(char, skin.prop);
  char.cosmicMats = char.materials.filter((m) => m.userData.cosmic);
}

// little extras for the bosses, stuck to their bones
function addBossProp(char, prop) {
  const b = char.bones;
  const glow = (c, k = 1) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.3, metalness: 0.4 });
  if (prop === 'crown' && b.head) {
    const crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.22, 16, 1, true), glow(0xff5fc8, 0.35));
    band.material.side = THREE.DoubleSide; crown.add(band);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 6), glow(0xffd34d, 0.4));
      spike.position.set(Math.sin(a) * 0.43, 0.22, Math.cos(a) * 0.43); crown.add(spike);
      const gum = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glow([0x5fe1ff, 0x7dff6a, 0xffffff][i % 3], 0.6));
      gum.position.set(Math.sin(a) * 0.43, 0.38, Math.cos(a) * 0.43); crown.add(gum);
    }
    crown.position.set(0, 1.2, 0); // on top of the helmet, in the rig's own units
    b.head.add(crown);
  } else if (prop === 'foamFinger' && b.handslotl) {
    const f = new THREE.Group(), m = glow(0xff2f6b, 0.25);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.18), m); f.add(hand);
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.12), m); finger.position.set(0.08, 0.45, 0); f.add(finger);
    f.position.set(0, 0.1, 0);
    b.handslotl.add(f);
  } else if (prop === 'ghostFire' && b.chest) {
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb36bff).multiplyScalar(2.5), transparent: true, opacity: 0.75 }));
    fire.scale.set(1, 1.5, 1);
    fire.position.set(0, 0.42, 0);
    fire.userData.ghostFire = true;
    b.chest.add(fire);
    char.ghostFire = fire;
  }
}

export function animateSkin(char, t) {
  if (char.ghostFire) { const k = 1 + Math.sin(t * 9) * 0.12; char.ghostFire.scale.set(k, 1.5 + Math.sin(t * 13) * 0.25, k); }
  if (!char.cosmicMats || !char.cosmicMats.length) return;
  for (let i = 0; i < char.cosmicMats.length; i++) char.cosmicMats[i].emissive.setHSL((t * 0.25 + i * 0.12) % 1, 1, 0.45);
}
