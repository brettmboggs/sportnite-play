import * as THREE from 'three';
import { canvasTexture } from '../engine/utils.js';

// Procedural 3D models for everything you can find on the floor: potions, med kits, ammo, materials,
// gold and chests. Each builder returns a fresh Group with its base sitting at y = 0.
const geoCache = new Map();
const matCache = new Map();
const G = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
const M = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };
const std = (color, o = {}) => M(`std:${color}:${JSON.stringify(o)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...o }));
const glowy = (color, k = 2) => M(`glow:${color}:${k}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false }));
const glass = (color) => M(`glass:${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, transmission: 0.6, thickness: 0.2, transparent: true, opacity: 0.75, clearcoat: 1 }));

function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
}

function labelTex(text, bg, fg = '#fff') {
  return M(`label:${text}:${bg}`, () => {
    const t = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  });
}

// ---------- consumables ----------
const CONSUMABLE = {
  // small blue potion with a cork, like a mini shield
  smallShield() {
    const g = new THREE.Group();
    add(g, G('flask', () => new THREE.SphereGeometry(0.14, 16, 12)), glass(0x7cc8ff), 0, 0.14);
    add(g, G('flaskLiquid', () => new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65)), glowy(0x2f8bff, 1.6), 0, 0.14);
    add(g, G('neck', () => new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10)), glass(0x7cc8ff), 0, 0.31);
    add(g, G('cork', () => new THREE.CylinderGeometry(0.05, 0.045, 0.06, 10)), std(0xb07a45), 0, 0.38);
    return g;
  },
  // the big shield jug
  bigShield() {
    const g = new THREE.Group();
    add(g, G('jug', () => new THREE.CylinderGeometry(0.17, 0.2, 0.4, 16)), glass(0x7cc8ff), 0, 0.2);
    add(g, G('jugLiquid', () => new THREE.CylinderGeometry(0.15, 0.18, 0.3, 14)), glowy(0x2f8bff, 1.6), 0, 0.17);
    add(g, G('jugNeck', () => new THREE.CylinderGeometry(0.07, 0.12, 0.12, 12)), glass(0x7cc8ff), 0, 0.46);
    add(g, G('jugCap', () => new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12)), std(0xe8eef5, { metalness: 0.6 }), 0, 0.55);
    add(g, G('jugBand', () => new THREE.TorusGeometry(0.2, 0.018, 6, 24)), std(0xe8eef5, { metalness: 0.6 }), 0, 0.3, 0, Math.PI / 2);
    return g;
  },
  bandage() {
    const g = new THREE.Group();
    const roll = G('roll', () => new THREE.CylinderGeometry(0.09, 0.09, 0.12, 16));
    add(g, roll, std(0xf4efe6, { roughness: 0.9 }), -0.08, 0.09, 0, Math.PI / 2, 0, 0);
    add(g, roll, std(0xf4efe6, { roughness: 0.9 }), 0.08, 0.09, 0.03, Math.PI / 2, 0.4, 0);
    add(g, G('tape', () => new THREE.BoxGeometry(0.06, 0.005, 0.25)), std(0xe0d6c4, { roughness: 0.9 }), 0.03, 0.005, 0.12);
    return g;
  },
  medkit() {
    const g = new THREE.Group();
    add(g, G('kit', () => new THREE.BoxGeometry(0.45, 0.24, 0.3)), std(0xf5f5f5, { roughness: 0.35 }), 0, 0.12);
    add(g, G('kitBand', () => new THREE.BoxGeometry(0.46, 0.04, 0.31)), std(0xd92b2b), 0, 0.2);
    const cross = std(0xe22b2b, { emissive: 0x550000 });
    add(g, G('crossA', () => new THREE.BoxGeometry(0.16, 0.05, 0.012)), cross, 0, 0.12, 0.152);
    add(g, G('crossB', () => new THREE.BoxGeometry(0.05, 0.16, 0.012)), cross, 0, 0.12, 0.152);
    add(g, G('handle', () => new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI)), std(0x333333), 0, 0.24, 0);
    return g;
  },
  sportsDrink() {
    const g = new THREE.Group();
    add(g, G('bottle', () => new THREE.CylinderGeometry(0.08, 0.08, 0.32, 14)), glass(0xb8ff9a), 0, 0.16);
    add(g, G('bottleLiquid', () => new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12)), glowy(0x5dff3a, 1.4), 0, 0.15);
    add(g, G('bottleLabel', () => new THREE.CylinderGeometry(0.083, 0.083, 0.12, 14, 1, true)), labelTex('⚡', '#ff7a1f'), 0, 0.16);
    add(g, G('bottleCap', () => new THREE.CylinderGeometry(0.04, 0.05, 0.08, 12)), std(0xff7a1f), 0, 0.36);
    return g;
  },
  launchPad() {
    const g = new THREE.Group();
    add(g, G('lpBase', () => new THREE.BoxGeometry(0.5, 0.12, 0.5)), std(0x30343c, { metalness: 0.5 }), 0, 0.06);
    add(g, G('lpTop', () => new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20)), glowy(0xffb627, 1.5), 0, 0.14);
    add(g, G('lpArrow', () => new THREE.ConeGeometry(0.08, 0.14, 4)), std(0xffffff), 0, 0.24);
    return g;
  },
  bouncePad() {
    const g = new THREE.Group();
    add(g, G('bpBase', () => new THREE.CylinderGeometry(0.26, 0.28, 0.1, 20)), std(0x2b2f3a), 0, 0.05);
    add(g, G('bpTop', () => new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20)), glowy(0x7dff5a, 1.4), 0, 0.12);
    add(g, G('bpSpring', () => new THREE.TorusGeometry(0.12, 0.02, 6, 16)), std(0xcccccc, { metalness: 0.9, roughness: 0.2 }), 0, 0.17, 0, Math.PI / 2);
    return g;
  },
};

export function consumableModel(id, color) {
  if (CONSUMABLE[id]) return CONSUMABLE[id]();
  const g = new THREE.Group();
  add(g, G('genericBottle', () => new THREE.CylinderGeometry(0.1, 0.1, 0.3, 12)), glass(0xffffff), 0, 0.15);
  add(g, G('genericLiquid', () => new THREE.CylinderGeometry(0.085, 0.085, 0.22, 12)), glowy(color || 0xffffff, 1.4), 0, 0.13);
  return g;
}

// ---------- ammo ----------
// Fortnite-ish ammo: little colored boxes with a bullet icon on top, each type a different shape.
export function ammoModel(type, color) {
  const g = new THREE.Group();
  const body = std(new THREE.Color(color).multiplyScalar(0.55).getHex(), { roughness: 0.5 });
  const trim = std(color, { emissive: color, emissiveIntensity: 0.35 });
  if (type === 'shells') {
    for (let i = 0; i < 4; i++) {
      add(g, G('shell', () => new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10)), std(0xd83a3a, { roughness: 0.4 }), -0.15 + i * 0.1, 0.045, 0, Math.PI / 2, 0, Math.PI / 2);
      add(g, G('shellBrass', () => new THREE.CylinderGeometry(0.047, 0.047, 0.05, 10)), std(0xd8b25a, { metalness: 0.9, roughness: 0.25 }), -0.15 + i * 0.1, 0.045, 0.1, Math.PI / 2, 0, 0);
    }
  } else if (type === 'rockets') {
    add(g, G('rocketBody', () => new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12)), std(0x9aa0a8, { metalness: 0.4 }), 0, 0.07, 0, 0, 0, Math.PI / 2);
    add(g, G('rocketTip', () => new THREE.ConeGeometry(0.07, 0.16, 12)), trim, 0.3, 0.07, 0, 0, 0, -Math.PI / 2);
    add(g, G('rocketFin', () => new THREE.BoxGeometry(0.1, 0.2, 0.015)), body, -0.2, 0.07, 0);
    add(g, G('rocketFin', () => new THREE.BoxGeometry(0.1, 0.2, 0.015)), body, -0.2, 0.07, 0, Math.PI / 2);
  } else {
    const w = type === 'heavy' ? 0.42 : type === 'medium' ? 0.36 : 0.3;
    add(g, G('ammoBox' + w, () => new THREE.BoxGeometry(w, 0.16, 0.22)), body, 0, 0.08);
    add(g, G('ammoLid' + w, () => new THREE.BoxGeometry(w + 0.02, 0.04, 0.24)), trim, 0, 0.18);
    // bullets peeking out of the top
    const n = type === 'heavy' ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.06 + i * ((w - 0.12) / Math.max(1, n - 1));
      add(g, G('bullet' + type, () => new THREE.CylinderGeometry(type === 'heavy' ? 0.025 : 0.018, type === 'heavy' ? 0.025 : 0.018, 0.12, 8)), std(0xd8b25a, { metalness: 0.9, roughness: 0.25 }), x, 0.23, 0);
      add(g, G('bulletTip' + type, () => new THREE.ConeGeometry(type === 'heavy' ? 0.025 : 0.018, 0.04, 8)), std(0xb06a3a, { metalness: 0.8, roughness: 0.3 }), x, 0.31, 0);
    }
  }
  return g;
}

// ---------- materials ----------
export function matsModel(mat) {
  const g = new THREE.Group();
  if (mat === 'wood') {
    const plank = G('plank', () => new THREE.BoxGeometry(0.5, 0.07, 0.14));
    const wood = std(0xc08a4f, { roughness: 0.8 }), dark = std(0x8a5a2b, { roughness: 0.8 });
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) add(g, plank, (i + k) % 2 ? wood : dark, 0, 0.035 + i * 0.07, (k - 0.5) * 0.15, 0, i % 2 ? 0.08 : -0.06, 0);
  } else if (mat === 'brick') {
    const brick = G('brick', () => new THREE.BoxGeometry(0.22, 0.1, 0.11));
    const red = std(0xb5523a, { roughness: 0.9 }), red2 = std(0x9c4430, { roughness: 0.9 });
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) add(g, brick, (i + k) % 2 ? red : red2, (k - 0.5) * 0.23 + (i % 2) * 0.05, 0.05 + i * 0.1, 0);
  } else {
    const sheet = G('sheet', () => new THREE.BoxGeometry(0.45, 0.035, 0.3));
    const steel = std(0xa9b4c0, { metalness: 0.85, roughness: 0.3 }), steel2 = std(0x7d8894, { metalness: 0.85, roughness: 0.35 });
    for (let i = 0; i < 4; i++) add(g, sheet, i % 2 ? steel : steel2, 0, 0.02 + i * 0.04, 0, 0, i * 0.12, 0);
  }
  return g;
}

export function goldModel() {
  const g = new THREE.Group();
  const coin = G('coin', () => new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20));
  const gold = std(0xffc93c, { metalness: 0.9, roughness: 0.2, emissive: 0x664400 });
  add(g, coin, gold, 0, 0.02, 0);
  add(g, coin, gold, 0.06, 0.06, 0.04, 0.2, 0, 0.1);
  add(g, coin, gold, -0.04, 0.1, -0.02, -0.15, 0, 0.1);
  return g;
}

// ---------- chests ----------
let chestTex = null;
function chestTextures() {
  if (chestTex) return chestTex;
  const wood = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9a6531'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      ctx.fillStyle = y % 64 ? '#8a5828' : '#a36d38'; ctx.fillRect(0, y, w, 30);
      ctx.fillStyle = '#5e3a18'; ctx.fillRect(0, y + 30, w, 2);
      for (let i = 0; i < 6; i++) { ctx.strokeStyle = 'rgba(70,40,15,0.35)'; ctx.beginPath(); const yy = y + 4 + Math.random() * 22; ctx.moveTo(0, yy); ctx.bezierCurveTo(w * 0.3, yy + 3, w * 0.6, yy - 3, w, yy + 1); ctx.stroke(); }
    }
  });
  chestTex = { wood };
  return chestTex;
}

// Returns { root, lid } where lid is a pivot at the hinge (rotate .x negative to open).
export function chestModel(rare = false) {
  const t = chestTextures();
  const g = new THREE.Group();
  const wood = M('chestWood' + rare, () => new THREE.MeshStandardMaterial({ map: t.wood, roughness: 0.65, color: rare ? 0xffe0a0 : 0xffffff }));
  const goldM = M('chestGold' + rare, () => new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.95, roughness: 0.22, emissive: rare ? 0xffa000 : 0x6a4400, emissiveIntensity: rare ? 0.6 : 0.35 }));
  const W = 1.1, D = 0.7, H = 0.55;
  add(g, G('chestBody', () => new THREE.BoxGeometry(W, H, D)), wood, 0, H / 2).userData.mainShadow = true;
  // golden corner posts and bands
  const post = G('chestPost', () => new THREE.BoxGeometry(0.08, H + 0.02, 0.08));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, post, goldM, sx * (W / 2 - 0.03), H / 2, sz * (D / 2 - 0.03));
  add(g, G('chestBase', () => new THREE.BoxGeometry(W + 0.04, 0.06, D + 0.04)), goldM, 0, 0.03);
  add(g, G('chestRim', () => new THREE.BoxGeometry(W + 0.03, 0.05, D + 0.03)), goldM, 0, H - 0.02);
  // lid: a rounded top that hinges at the back edge
  const lid = new THREE.Group(); lid.position.set(0, H, -D / 2);
  add(lid, G('chestDome', () => new THREE.CylinderGeometry(D / 2, D / 2, W, 20, 1, false, 0, Math.PI)), wood, 0, 0, D / 2, 0, 0, Math.PI / 2);
  for (const sx of [-0.35, 0, 0.35]) add(lid, G('chestStrap', () => new THREE.CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, 0.07, 20, 1, false, 0, Math.PI)), goldM, sx, 0, D / 2, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) add(lid, G('chestCap', () => new THREE.CircleGeometry(D / 2 + 0.016, 20, 0, Math.PI)), goldM, sx * (W / 2 + 0.001), 0, D / 2, 0, sx * Math.PI / 2, 0);
  // keyhole plate on the front
  add(lid, G('chestLock', () => new THREE.BoxGeometry(0.18, 0.22, 0.06)), goldM, 0, -0.02, D + 0.02);
  add(lid, G('chestHole', () => new THREE.CylinderGeometry(0.025, 0.025, 0.07, 8)), std(0x1a1208), 0, 0.0, D + 0.03, Math.PI / 2);
  g.add(lid);
  // inner glow that shows when the lid opens
  const inner = add(g, G('chestInner', () => new THREE.PlaneGeometry(W - 0.1, D - 0.1)), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd36a).multiplyScalar(2.2), toneMapped: false, transparent: true }), 0, H - 0.04, 0, -Math.PI / 2);
  inner.castShadow = false;
  // only the body casts a shadow: 17 shadow casters per chest adds up fast
  g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = !!o.userData.mainShadow; } });
  return { root: g, lid, inner };
}

// Ammo box: a green military crate with a hinged lid.
export function ammoBoxModel() {
  const g = new THREE.Group();
  const green = std(0x56703f, { roughness: 0.7 }), dark = std(0x3a4f2a, { roughness: 0.7 }), metal = std(0x9aa0a8, { metalness: 0.8, roughness: 0.3 });
  add(g, G('abBody', () => new THREE.BoxGeometry(1.0, 0.45, 0.55)), green, 0, 0.225);
  for (const sx of [-0.38, 0.38]) add(g, G('abRib', () => new THREE.BoxGeometry(0.06, 0.46, 0.57)), dark, sx, 0.23, 0);
  add(g, G('abLabel', () => new THREE.PlaneGeometry(0.4, 0.18)), labelTex('AMMO', '#2b3a1f', '#ffe066'), 0, 0.24, 0.277);
  const lid = new THREE.Group(); lid.position.set(0, 0.45, -0.275);
  add(lid, G('abLid', () => new THREE.BoxGeometry(1.02, 0.07, 0.57)), dark, 0, 0.035, 0.275);
  add(lid, G('abHandle', () => new THREE.BoxGeometry(0.3, 0.03, 0.05)), metal, 0, 0.085, 0.275);
  g.add(lid);
  return { root: g, lid };
}
