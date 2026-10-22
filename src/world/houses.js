import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../engine/utils.js';

// Enterable houses built from boxes, so every town has interiors to loot and fight in.

const texCache = new Map();
function tex(key, draw) {
  if (!texCache.has(key)) texCache.set(key, canvasTexture(256, 256, draw, true));
  return texCache.get(key);
}

const planks = (base, line) => (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) {
    ctx.fillStyle = line; ctx.fillRect(0, y, w, 3);
    for (let x = (y / 32) % 2 ? 0 : 64; x < w; x += 128) ctx.fillRect(x, y, 3, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, y + 4, w, 6);
  }
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; ctx.fillRect(Math.random() * w, Math.random() * h, 20, 1); }
};
const stones = (base, line) => (ctx, w, h) => {
  ctx.fillStyle = line; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 42) for (let x = (y / 42) % 2 ? -32 : 0; x < w; x += 64) {
    const v = 0.85 + Math.random() * 0.2;
    ctx.fillStyle = base; ctx.globalAlpha = v; ctx.fillRect(x + 3, y + 3, 58, 36); ctx.globalAlpha = 1;
  }
};
const stripes = (a, b) => (ctx, w, h) => {
  ctx.fillStyle = a; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = b;
  for (let x = -h; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 32 + h, h); ctx.lineTo(x + h, h); ctx.fill(); }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = ['#fff', '#ff5', '#5ff', '#f5f'][i % 4]; ctx.fillRect(Math.random() * w, Math.random() * h, 6, 3); }
};
const thatch = (ctx, w, h) => {
  ctx.fillStyle = '#c9a24a'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { ctx.strokeStyle = `rgba(${120 + Math.random() * 80},${90 + Math.random() * 50},30,0.5)`; const x = Math.random() * w, y = Math.random() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 18); ctx.stroke(); }
};
const shingles = (base) => (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 24) for (let x = (y / 24) % 2 ? -16 : 0; x < w; x += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + 20, 32, 4); ctx.fillRect(x, y, 2, 24);
  }
};

export const HOUSE_STYLES = {
  lodge:  { fabric: 0xc0392b, wood: 0x7a4a26, wall: () => tex('logs', planks('#9b6a3f', '#5e3b1f')), roof: () => tex('snowroof', shingles('#eef6ff')), floor: () => tex('floorwood', planks('#b9874f', '#7a5228')), w: 12, d: 10, floors: 2, pitched: true, trim: 0x5e3b1f },
  candy:  { fabric: 0xff7ac8, wood: 0xf6c99a, wall: () => tex('candywall', stripes('#ffd1ec', '#ff7ac8')), roof: () => tex('mintroof', shingles('#7cf2c4')), floor: () => tex('floorwood2', planks('#f6c99a', '#c48a52')), w: 11, d: 9, floors: 2, pitched: true, trim: 0xffffff },
  ruins:  { fabric: 0x8f8a70, wood: 0x6f6a58, wall: () => tex('ruinstone', stones('#b8b29a', '#6f6a58')), roof: () => tex('ruinstone', stones('#b8b29a', '#6f6a58')), floor: () => tex('ruinfloor', stones('#a49d84', '#5d5948')), w: 12, d: 12, floors: 1, ruined: true, trim: 0x6f6a58 },
  hut:    { fabric: 0x6fa84a, wood: 0x8c6f2f, wall: () => tex('bamboo', planks('#d9b871', '#8c6f2f')), roof: () => tex('thatch', thatch), floor: () => tex('floorwood', planks('#b9874f', '#7a5228')), w: 9, d: 8, floors: 1, pitched: true, trim: 0x8c6f2f },
  spooky: { fabric: 0x6a3d8f, wood: 0x3a2f2a, wall: () => tex('spookywall', planks('#4d4458', '#2a2433')), roof: () => tex('spookyroof', shingles('#3a2f47')), floor: () => tex('spookyfloor', planks('#5a4a3a', '#2e241a')), w: 12, d: 10, floors: 2, pitched: true, trim: 0x9b5cff, windowGlow: 0xb36bff },
};

// Box geometry with UVs scaled to world size so textures tile evenly
function box(w, h, d, x, y, z, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * faces[f][0] / tile, uv.getY(i) * faces[f][1] / tile);
  }
  g.translate(x, y, z);
  return g;
}

export function buildHouse(world, x, z, rot, style, rng, poiName) {
  const R = world.physics.R;
  const W = style.w, D = style.d, H = 3.6, T = 0.3;
  const WIN_SILL = 0.75, WIN_HEAD = 0.55;
  const floors = style.floors;
  // flatten ground a bit: sample 5 points and use the max so the floor never sinks
  let gy = -Infinity, low = Infinity;
  for (const [ox, oz] of [[0, 0], [W / 2, D / 2], [-W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2], [0, D / 2 + 1], [0, -D / 2], [W / 2, 0], [-W / 2, 0]]) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const h = world.terrain.heightAt(x + ox * c + oz * s, z - ox * s + oz * c);
    gy = Math.max(gy, h); low = Math.min(low, h);
  }
  const group = new THREE.Group();
  group.position.set(x, gy, z);
  group.rotation.y = rot;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const body = world.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, gy, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  const owner = { kind: 'building' };
  const addCol = (hx, hy, hz, cx, cy, cz, rotQ = null) => {
    const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
    if (rotQ) d.setRotation(rotQ);
    const c = world.physics.world.createCollider(d, body);
    world.physics.owners.set(c.handle, owner);
  };

  const wallGeos = [], floorGeos = [], roofGeos = [], trimGeos = [], winGeos = [];
  const woodGeos = [], fabricGeos = [], glowGeos = [], whiteGeos = [];
  const wallBox = (w, h, d, cx, cy, cz) => { wallGeos.push(box(w, h, d, cx, cy, cz)); addCol(w / 2, h / 2, d / 2, cx, cy, cz); };
  const solid = (list, w, h, d, cx, cy, cz) => { list.push(box(w, h, d, cx, cy, cz, 1)); addCol(w / 2, h / 2, d / 2, cx, cy, cz); };
  const deco = (list, w, h, d, cx, cy, cz) => list.push(box(w, h, d, cx, cy, cz, 1));
  const holeW = 2.6, holeD = Math.min(5.5, D - 3);

  // Furniture: living room downstairs, bedrooms and a library upstairs, rubble in the ruins
  function furnish(f, y0) {
    const yb = y0 + (f === 0 ? 0 : 0.15);
    if (style.ruined) {
      for (let k = 0; k < 3; k++) {
        const s = rng.float(0.6, 1.2);
        solid(wallGeos, s, s * 0.7, s * 1.1, rng.float(-W / 2 + 3.5, W / 2 - 3), yb + s * 0.35, rng.float(-1, D / 2 - 2.5));
      }
      solid(wallGeos, 1.6, 0.9, 1.0, 0, yb + 0.45, -D / 2 + 1.0); // stone altar
      return;
    }
    const living = f === 0, single = floors === 1;
    if (living) {
      // table with chairs
      const tx = W / 4 - 0.3, tz = -0.2;
      deco(woodGeos, 1.7, 0.1, 1.0, tx, yb + 0.78, tz);
      for (const [lx, lz] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]]) deco(woodGeos, 0.1, 0.75, 0.1, tx + lx, yb + 0.37, tz + lz);
      addCol(0.85, 0.42, 0.5, tx, yb + 0.42, tz);
      for (const sx of [-1, 1]) {
        const cx = tx + sx * 1.25;
        deco(fabricGeos, 0.5, 0.08, 0.5, cx, yb + 0.48, tz);
        deco(woodGeos, 0.08, 0.6, 0.5, cx + sx * 0.22, yb + 0.8, tz);
        for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) deco(woodGeos, 0.06, 0.45, 0.06, cx + lx, yb + 0.22, tz + lz);
        addCol(0.26, 0.5, 0.26, cx, yb + 0.5, tz);
      }
      // rug + floor lamp
      deco(fabricGeos, 2.8, 0.03, 2.0, -0.6, yb + 0.01, D / 2 - 3);
      deco(woodGeos, 0.08, 1.6, 0.08, -W / 2 + 0.6, yb + 0.8, D / 2 - 0.6);
      deco(glowGeos, 0.45, 0.4, 0.45, -W / 2 + 0.6, yb + 1.7, D / 2 - 0.6);
      if (single) {
        // one-room hut: a bed in the back left
        solid(woodGeos, 1.4, 0.4, 2.0, -W / 2 + 1.05, yb + 0.2, -D / 2 + 1.3);
        deco(fabricGeos, 1.3, 0.14, 1.5, -W / 2 + 1.05, yb + 0.45, -D / 2 + 1.55);
        deco(whiteGeos, 1.0, 0.16, 0.45, -W / 2 + 1.05, yb + 0.48, -D / 2 + 0.55);
      } else {
        // couch along the front wall, bookshelf on the left wall
        const cx = W / 2 - 1.6, cz = D / 2 - 0.75;
        solid(fabricGeos, 2.2, 0.45, 0.85, cx, yb + 0.22, cz);
        deco(fabricGeos, 2.2, 0.55, 0.2, cx, yb + 0.72, cz + 0.33);
        for (const sx of [-1, 1]) deco(fabricGeos, 0.2, 0.3, 0.85, cx + sx * 1.0, yb + 0.6, cz);
        solid(woodGeos, 0.4, 2.0, 1.4, -W / 2 + 0.36, yb + 1.0, D / 2 - 1.7);
        for (let k = 0; k < 3; k++) deco(fabricGeos, 0.3, 0.32, 1.2, -W / 2 + 0.42, yb + 0.45 + k * 0.6, D / 2 - 1.7);
      }
      return;
    }
    if (f % 2 === 1) {
      // bedroom: bed against the right wall, wardrobe on the back wall, desk at the front
      const bx = W / 2 - 1.05, bz = D / 2 - 1.4;
      solid(woodGeos, 1.5, 0.45, 2.2, bx, yb + 0.22, bz);
      deco(woodGeos, 1.5, 0.9, 0.1, bx, yb + 0.45, bz + 1.1);
      deco(fabricGeos, 1.45, 0.16, 1.6, bx, yb + 0.5, bz - 0.25);
      deco(whiteGeos, 1.1, 0.18, 0.45, bx, yb + 0.55, bz + 0.75);
      solid(woodGeos, 1.4, 2.1, 0.6, 0.4, yb + 1.05, -D / 2 + 0.45);
      solid(woodGeos, 1.2, 0.08, 0.6, -0.6, yb + 0.76, D / 2 - 0.5);
      deco(glowGeos, 0.2, 0.3, 0.2, -0.9, yb + 0.95, D / 2 - 0.5);
    } else {
      // library: two shelves and a reading table
      for (const oz of [0.6, 0.6 + 1.5]) {
        solid(woodGeos, 0.4, 2.0, 1.4, W / 2 - 0.36, yb + 1.0, oz);
        for (let k = 0; k < 3; k++) deco(fabricGeos, 0.3, 0.32, 1.2, W / 2 - 0.42, yb + 0.45 + k * 0.6, oz);
      }
      solid(woodGeos, 1.4, 0.8, 0.8, -0.5, yb + 0.4, 1.4);
      deco(glowGeos, 0.2, 0.3, 0.2, -0.5, yb + 0.95, 1.4);
    }
  }

  // foundation: reaches down into the hillside so the low side never floats
  const fd = gy - low + 0.8;
  floorGeos.push(box(W + 0.6, fd, D + 0.6, 0, 0.2 - fd / 2, 0));
  addCol((W + 0.6) / 2, fd / 2, (D + 0.6) / 2, 0, 0.2 - fd / 2, 0);
  // front steps down to the ground when the house sits up on a slope
  for (let k = 1; k * 0.3 < gy - low + 0.1 && k < 10; k++) {
    const top = 0.2 - k * 0.3, bottom = low - gy - 0.3, hh = top - bottom;
    floorGeos.push(box(2.4, hh, 0.5, 0, top - hh / 2, D / 2 + 0.3 + k * 0.5, 1));
    addCol(1.2, hh / 2, 0.25, 0, top - hh / 2, D / 2 + 0.3 + k * 0.5);
  }

  for (let f = 0; f < floors; f++) {
    const y0 = 0.2 + f * H;
    const ruinedCut = style.ruined ? rng.float(0.4, 1) : 1;
    // back wall (+z is front door side after rotation; local -z is back)
    wallBox(W, H * (style.ruined ? rng.float(0.5, 1) : 1), T, 0, y0 + H / 2 * (style.ruined ? ruinedCut : 1), -D / 2);
    // side walls with a window gap
    for (const sx of [-1, 1]) {
      const wl = (D - 2) / 2;
      wallBox(T, H, wl, sx * W / 2, y0 + H / 2, -D / 2 + wl / 2 + 0.0);
      wallBox(T, H, wl, sx * W / 2, y0 + H / 2, D / 2 - wl / 2);
      // windows are big enough to jump through (2.3 m opening, the player is 1.8 m)
      wallBox(T, WIN_SILL, 2, sx * W / 2, y0 + WIN_SILL / 2, 0); // sill
      wallBox(T, WIN_HEAD, 2, sx * W / 2, y0 + H - WIN_HEAD / 2, 0); // header
      if (style.windowGlow) winGeos.push(box(0.05, 0.08, 2.0, sx * (W / 2 + 0.16), y0 + H - WIN_HEAD - 0.04, 0));
    }
    // front wall: door on ground floor, window above
    const gap = f === 0 ? 2.0 : 2.0;
    const side = (W - gap) / 2;
    wallBox(side, H, T, -W / 2 + side / 2, y0 + H / 2, D / 2);
    wallBox(side, H, T, W / 2 - side / 2, y0 + H / 2, D / 2);
    if (f === 0) wallBox(gap, H - 2.7, T, 0, y0 + 2.7 + (H - 2.7) / 2, D / 2);
    else { wallBox(gap, WIN_SILL, T, 0, y0 + WIN_SILL / 2, D / 2); wallBox(gap, WIN_HEAD, T, 0, y0 + H - WIN_HEAD / 2, D / 2); }
    // trim boards at the corners
    for (const [cx, cz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) trimGeos.push(box(0.45, H, 0.45, cx, y0 + H / 2, cz, 1));

    // upper floor slab with a stairwell hole in the back-left corner, plus the ramp to it
    if (f < floors - 1) {
      const yTop = y0 + H;
      floorGeos.push(box(W - holeW, 0.3, D, holeW / 2, yTop, 0));
      addCol((W - holeW) / 2, 0.15, D / 2, holeW / 2, yTop, 0);
      floorGeos.push(box(holeW, 0.3, D - holeD, -W / 2 + holeW / 2, yTop, holeD / 2));
      addCol(holeW / 2, 0.15, (D - holeD) / 2, -W / 2 + holeW / 2, yTop, holeD / 2);
      // stairs: visual steps + one sloped collider
      const steps = 12;
      for (let s = 0; s < steps; s++) {
        const sz = -D / 2 + 0.3 + (s + 0.5) * (holeD - 0.3) / steps;
        floorGeos.push(box(holeW - 0.4, 0.25, (holeD - 0.3) / steps, -W / 2 + holeW / 2 + 0.1, y0 + (s + 1) * (H / steps) - 0.12, sz, 1));
      }
      const len = Math.hypot(holeD - 0.3, H);
      const ang = Math.atan2(H, holeD - 0.3);
      const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang);
      addCol((holeW - 0.4) / 2, 0.1, len / 2, -W / 2 + holeW / 2 + 0.1, y0 + H / 2, -D / 2 + 0.3 + (holeD - 0.3) / 2, { x: rq.x, y: rq.y, z: rq.z, w: rq.w });
    }
    // railing around the stairwell so nobody falls down it (the top end stays open)
    if (f > 0) {
      deco(woodGeos, 0.08, 1.0, holeD, -W / 2 + holeW, y0 + 0.5, -D / 2 + holeD / 2);
      for (let k = 0; k <= 4; k++) deco(woodGeos, 0.1, 1.0, 0.1, -W / 2 + holeW, y0 + 0.5, -D / 2 + 0.2 + k * (holeD - 0.4) / 4);
      addCol(0.06, 0.55, holeD / 2, -W / 2 + holeW, y0 + 0.55, -D / 2 + holeD / 2);
    }
    // door frame, open door, porch light
    if (f === 0) {
      for (const sx of [-1, 1]) trimGeos.push(box(0.16, 2.75, T + 0.12, sx * 1.04, y0 + 1.37, D / 2, 1));
      trimGeos.push(box(2.24, 0.18, T + 0.12, 0, y0 + 2.76, D / 2, 1));
      const open = 1.75; // radians the door has swung outward
      const hx = 1.0, hz = D / 2 + T / 2 + 0.04;
      const dg = box(1.9, 2.55, 0.08, -0.95, 0, 0, 1);
      dg.rotateY(open); dg.translate(hx, y0 + 1.3, hz);
      woodGeos.push(dg);
      const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), open);
      addCol(0.95, 1.27, 0.04, hx - Math.cos(open) * 0.95, y0 + 1.3, hz + Math.sin(open) * 0.95, { x: dq.x, y: dq.y, z: dq.z, w: dq.w });
      deco(glowGeos, 0.22, 0.3, 0.12, 1.6, y0 + 2.4, D / 2 + T / 2 + 0.06);
      deco(floorGeos, 2.4, 0.18, 0.9, 0, -0.05, D / 2 + 0.6); // doorstep
    }
    // window frames + shutters on the side walls
    if (!style.ruined) for (const sx of [-1, 1]) {
      const wx = sx * (W / 2 + 0.02);
      const wTop = H - WIN_HEAD, wMid = (WIN_SILL + wTop) / 2, wH = wTop - WIN_SILL;
      for (const oz of [-1.05, 1.05]) trimGeos.push(box(T + 0.14, wH + 0.1, 0.14, wx, y0 + wMid, oz, 1));
      trimGeos.push(box(T + 0.14, 0.14, 2.24, wx, y0 + wTop, 0, 1));
      trimGeos.push(box(T + 0.2, 0.14, 2.3, wx, y0 + WIN_SILL, 0, 1));
      for (const oz of [-1.55, 1.55]) deco(woodGeos, 0.06, wH - 0.1, 0.85, sx * (W / 2 + T / 2 + 0.05), y0 + wMid, oz);
      if (f === 0) { deco(woodGeos, 0.35, 0.28, 2.0, sx * (W / 2 + 0.3), y0 + WIN_SILL - 0.14, 0); deco(fabricGeos, 0.3, 0.12, 1.9, sx * (W / 2 + 0.3), y0 + WIN_SILL + 0.05, 0); }
    }
    furnish(f, y0);
    // loot: chest in a back corner (clear of the furniture), floor loot in an open spot
    const lp = new THREE.Vector3(W / 2 - 1.3, y0 + 0.1, -D / 2 + 1.2).applyQuaternion(q);
    world.lootSpots.push({ x: x + lp.x, y: gy + lp.y, z: z + lp.z, kind: rng.chance(0.75) ? 'chest' : 'floor', poi: poiName, rot });
    const mp = new THREE.Vector3(f === 0 ? -0.9 : 0.2, y0 + 0.1, f === 0 ? D / 2 - 3 : 0.6).applyQuaternion(q);
    world.lootSpots.push({ x: x + mp.x, y: gy + mp.y, z: z + mp.z, kind: 'floor', poi: poiName });
  }

  // roof
  const topY = 0.2 + floors * H;
  if (!style.ruined) {
    floorGeos.push(box(W, 0.3, D, 0, topY, 0));
    addCol(W / 2, 0.15, D / 2, 0, topY, 0);
    if (style.pitched) {
      const rh = 3.2, over = 0.8;
      const half = D / 2 + over;
      const slope = Math.hypot(half, rh);
      const ang = Math.atan2(rh, half);
      for (const sgn of [-1, 1]) {
        const g = box(W + over * 2, 0.35, slope, 0, 0, 0);
        g.rotateX(-sgn * ang);
        g.translate(0, topY + rh / 2 + 0.15, sgn * -half / 2);
        roofGeos.push(g);
        const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -sgn * ang);
        addCol((W + over * 2) / 2, 0.18, slope / 2, 0, topY + rh / 2 + 0.15, sgn * -half / 2, { x: rq.x, y: rq.y, z: rq.z, w: rq.w });
      }
      // chimney poking through the back half of the roof
      if (!style.ruined && style !== HOUSE_STYLES.hut) {
        const chx = W / 2 - 1.6, chz = -D / 4;
        const chH = rh + 1.6;
        trimGeos.push(box(0.9, chH, 0.9, chx, topY + chH / 2, chz, 1));
        trimGeos.push(box(1.1, 0.2, 1.1, chx, topY + chH, chz, 1));
        addCol(0.45, chH / 2, 0.45, chx, topY + chH / 2, chz);
      }
      // gable triangles
      const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rh)]);
      for (const sx of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false });
        g.rotateY(Math.PI / 2);
        g.translate(sx * W / 2 - T / 2, topY + 0.15, 0);
        wallGeos.push(g);
      }
    } else {
      for (const [w, d, cx, cz] of [[W, T, 0, -D / 2], [W, T, 0, D / 2], [T, D, -W / 2, 0], [T, D, W / 2, 0]]) wallBox(w, 0.9, d, cx, topY + 0.6, cz);
    }
  }

  const mk = (geos, map, extra = {}) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...extra }));
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  };
  mk(wallGeos, style.wall());
  mk(floorGeos, style.floor());
  mk(roofGeos, style.roof());
  mk(trimGeos, null, { color: style.trim });
  if (winGeos.length) mk(winGeos, null, { color: 0x000000, emissive: style.windowGlow, emissiveIntensity: 2.2 });
  mk(woodGeos, null, { color: style.wood });
  mk(fabricGeos, null, { color: style.fabric, roughness: 0.95 });
  mk(whiteGeos, null, { color: 0xf4f1ea, roughness: 0.95 });
  mk(glowGeos, null, { color: 0xfff2c4, emissive: 0xffd27a, emissiveIntensity: 1.6 });
  world.root.add(group);
  return { radius: Math.max(W, D) * 0.75, topY: gy + topY };
}
