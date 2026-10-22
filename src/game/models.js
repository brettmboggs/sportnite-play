import * as THREE from 'three';
import { addRim, addRimTo } from '../engine/stylize.js';
import { assets } from '../engine/assets.js';
import { RARITIES } from './weapons/data.js';

// Procedural models for weapons and projectiles that don't have a downloaded model.
const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; return m;
}

// All held models point their "barrel" along -Z with the grip at the origin.
const PROC = {
  bat() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.95, 12), M(0xc8894a, { roughness: 0.4 }), 0, 0, -0.42, Math.PI / 2));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), M(0x222222), 0, 0, 0.12, Math.PI / 2));
    g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), M(0x222222), 0, 0, 0.22));
    return g;
  },
  bow() {
    // grip at the origin, limbs curving back toward the archer, string behind
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 16; i++) { const y = -0.55 + i * (1.1 / 16); const k = y / 0.55; pts.push(new THREE.Vector3(0, y, 0.2 * k * k - 0.02 * Math.cos(k * Math.PI / 2))); }
    const limb = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.024, 6);
    g.add(mesh(limb, M(0x7a4bd6, { emissive: 0x3a1a8a, emissiveIntensity: 0.5 })));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), M(0x2a1a10)));
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.1, 4), M(0xffffff), 0, 0, 0.2));
    return g;
  },
  sword() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 0.25), M(0x333333), 0, 0, 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), M(0xaaaaaa, { metalness: 0.8 }), 0, 0, -0.08));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40e0ff).multiplyScalar(3) }), 0, 0, -0.6, Math.PI / 2));
    return g;
  },
  hammer() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), M(0x8b5a2b), 0, 0, -0.35, Math.PI / 2));
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 16), M(0xff3d7f, { roughness: 0.3 }), 0, 0, -0.82));
    return g;
  },
  boomerang() {
    const g = new THREE.Group();
    const mat = M(0xffb627, { emissive: 0x663300, emissiveIntensity: 0.3 });
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.04, 0.1), mat, 0.2, 0, 0, 0, 0.5));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.04, 0.1), mat, -0.2, 0, 0, 0, -0.5));
    return g;
  },
  basketball() {
    const tex = ballTexture('#ff7a1f', '#1a1a1a', 'basket');
    return mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  },
  soccer() {
    const tex = ballTexture('#ffffff', '#111111', 'soccer');
    return mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  },
  golf() { return mesh(new THREE.SphereGeometry(0.06, 10, 8), M(0xffffff, { roughness: 0.3 })); },
  blackhole() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    g.add(mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb45cff).multiplyScalar(3) }), 0, 0, 0, Math.PI / 2));
    return g;
  },
  rocket() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 10), M(0xdddddd), 0, 0, 0, Math.PI / 2));
    g.add(mesh(new THREE.ConeGeometry(0.08, 0.2, 10), M(0xff3b3b), 0, 0, -0.4, -Math.PI / 2));
    return g;
  },
  grenade() { return mesh(new THREE.SphereGeometry(0.12, 10, 8), M(0x3a5a2a)); },
  arrow() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), M(0x8b5a2b), 0, 0, 0, Math.PI / 2));
    g.add(mesh(new THREE.ConeGeometry(0.03, 0.1, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb45cff).multiplyScalar(2) }), 0, 0, -0.45, -Math.PI / 2));
    return g;
  },
  bubble() {
    return mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.35, roughness: 0, iridescence: 1, iridescenceIOR: 1.6 }));
  },
  chicken() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.28, 12, 10), M(0xffffff), 0, 0, 0));
    g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), M(0xffffff), 0, 0.22, -0.22));
    g.add(mesh(new THREE.ConeGeometry(0.06, 0.14, 6), M(0xffa500), 0, 0.2, -0.42, -Math.PI / 2));
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.12, 0.14), M(0xff2020), 0, 0.4, -0.22));
    g.add(mesh(new THREE.SphereGeometry(0.03, 6, 6), M(0x000000), 0.09, 0.27, -0.33));
    g.add(mesh(new THREE.SphereGeometry(0.03, 6, 6), M(0x000000), -0.09, 0.27, -0.33));
    return g;
  },
  paint() { return mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3dc8, roughness: 0.2 })); },
};

function ballTexture(base, line, kind) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = line; ctx.lineWidth = 5;
  if (kind === 'basket') {
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 64); ctx.stroke();
    for (const x of [64, 192]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(128, 64, 50, 64, 0, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = line;
    for (let i = 0; i < 12; i++) { const x = (i % 6) * 46 + (i > 5 ? 23 : 0), y = i > 5 ? 90 : 35; ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); } ctx.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Per-folder tweaks so downloaded guns point down -Z with the sights up.
// Checked side-on in a test scene: Quaternius guns point along -X, Kenney blasters already point along -Z.
const GUN_FIX = {
  guns: { rotY: -Math.PI / 2 },
  blaster: { rotY: 0 },
};

const heldCache = new Map();
export function heldModel(def) {
  const key = def.model.file || def.model.proc;
  let base = heldCache.get(key);
  if (!base) {
    if (def.model.proc) base = PROC[def.model.proc]();
    else {
      const raw = assets.model(def.model.file, { size: def.model.size, center: true, ground: false });
      const folder = def.model.file.split('/')[0];
      const fix = GUN_FIX[folder] || {};
      const inner = new THREE.Group(); inner.add(raw);
      raw.rotation.y = fix.rotY || 0;
      // center vertically on its bbox
      const b = new THREE.Box3().setFromObject(inner);
      const c = b.getCenter(new THREE.Vector3());
      raw.position.sub(c);
      // move so the back third (the grip) sits at the origin
      const sz = b.getSize(new THREE.Vector3());
      raw.position.z -= sz.z * 0.15;
      base = inner;
    }
    // how far the muzzle/tip sticks out in front of the grip (used for hand placement and muzzle flashes)
    const bb = new THREE.Box3().setFromObject(base);
    base.userData.front = Math.max(0.05, -bb.min.z); base.userData.len = bb.max.z - bb.min.z;
    addRimTo(base, 0.8);
    heldCache.set(key, base);
  }
  return base.clone(true);
}

export function projectileModel(kind) {
  return PROC[kind] ? PROC[kind]() : PROC.grenade();
}

// Add a rarity glow: emissive rim on the materials (cloned so shared models aren't affected)
export function applyRarityLook(obj, rarity, time = 0) {
  if (rarity < 3) return obj;
  const col = new THREE.Color(RARITIES[rarity].glow);
  obj.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
      o.material = o.material.clone();
      o.material.emissive = col.clone();
      o.material.emissiveIntensity = rarity >= 5 ? 0.6 : 0.25;
      if (rarity === 4) { o.material.metalness = 0.8; o.material.roughness = 0.25; o.material.color.lerp(new THREE.Color(0xffd34d), 0.6); }
      if (rarity === 6) o.userData.cosmic = true;
      addRim(o.material, 0.8);
    }
  });
  void time;
  return obj;
}

export function updateCosmic(obj, t) {
  obj.traverse((o) => { if (o.userData.cosmic) o.material.emissive.setHSL((t * 0.3 + o.id * 0.01) % 1, 1, 0.5); });
}
