import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, clamp, rand } from '../engine/utils.js';
import { audio } from '../engine/audio.js';
import { GROUP, groups } from '../engine/physics.js';

// Fortnite-sized grid: a tile is 5 m wide and 3.8 m tall (about two heroes tall), so ramps climb at 37 degrees.
// The grid is world-aligned left/right, but each structure picks its own height offset so the first piece sits
// flush with the ground you are standing on (no half-buried walls on hills).
export const CELL = 5, H = 3.8, THICK = 0.26;
const RAMP_LEN = Math.hypot(CELL, H), RAMP_ANGLE = Math.atan2(H, CELL);
const CONE_H = H * 0.45;
export const MATS = {
  // hp = max health, start = fraction of hp when placed, time = seconds to finish building
  wood:  { hp: 150, start: 0.3, time: 2.0, color: '#c08a4f', dust: 0xc8a070, name: 'Wood' },
  brick: { hp: 300, start: 0.25, time: 3.2, color: '#c46a4a', dust: 0xc9b8a6, name: 'Brick' },
  metal: { hp: 500, start: 0.2, time: 4.5, color: '#9aa7b4', dust: 0xc6ced8, name: 'Metal' },
};
export const MAT_ORDER = ['wood', 'brick', 'metal'];
export const PIECES = ['wall', 'floor', 'ramp', 'cone'];
const COST = 10;
const MAX_CHUNKS = 320;          // per material
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 0:-z 1:+x 2:+z 3:-x
const SLOT = { wall: 'w', floor: 'f', ramp: 's', cone: 's' }; // ramps and cones share a tile slot
const mod = (a, n) => ((a % n) + n) % n;

// ---------- textures (drawn in code) ----------
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function drawWood(ctx, w, h) {
  const r = seeded(7);
  const planks = 6, ph = h / planks;
  const tones = ['#c48c54', '#b57d46', '#cb9862', '#ae7640', '#bf8750'];
  for (let i = 0; i < planks; i++) {
    const y = i * ph;
    ctx.fillStyle = tones[Math.floor(r() * tones.length)]; ctx.fillRect(0, y, w, ph);
    // wood grain
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = `rgba(${r() < 0.5 ? '90,52,22' : '230,180,120'},${0.12 + r() * 0.16})`;
      ctx.lineWidth = 1 + r() * 2;
      const gy = y + 4 + r() * (ph - 8);
      ctx.beginPath(); ctx.moveTo(0, gy);
      ctx.bezierCurveTo(w * 0.3, gy + (r() - 0.5) * 10, w * 0.6, gy + (r() - 0.5) * 10, w, gy + (r() - 0.5) * 6);
      ctx.stroke();
    }
    // a knot or two
    for (let k = 0; k < 2; k++) {
      if (r() < 0.4) continue;
      const kx = 60 + r() * (w - 120), ky = y + ph * (0.3 + r() * 0.4);
      ctx.fillStyle = 'rgba(80,45,18,0.55)'; ctx.beginPath(); ctx.ellipse(kx, ky, 9, 5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(80,45,18,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(kx, ky, 15, 8, 0, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,225,170,0.35)'; ctx.fillRect(0, y, w, 3);       // top highlight
    ctx.fillStyle = '#4e2f14'; ctx.fillRect(0, y + ph - 4, w, 4);             // gap between planks
  }
  // frame + middle batten
  ctx.fillStyle = '#7a4a22';
  ctx.fillRect(0, 0, w, 26); ctx.fillRect(0, h - 26, w, 26); ctx.fillRect(0, 0, 26, h); ctx.fillRect(w - 26, 0, 26, h);
  ctx.fillRect(w / 2 - 14, 0, 28, h);
  ctx.fillStyle = 'rgba(255,215,160,0.3)';
  ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, 0, 4, h); ctx.fillRect(w / 2 - 14, 0, 4, h);
  ctx.fillStyle = 'rgba(40,20,5,0.45)'; ctx.fillRect(26, 26, w - 52, 4); ctx.fillRect(26, 26, 4, h - 52);
  // nails
  for (let i = 0; i < planks; i++) for (const x of [13, w / 2 - 6, w / 2 + 6, w - 13]) {
    const y = i * ph + ph / 2;
    ctx.fillStyle = '#2e2218'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.5, 0, 7); ctx.fill();
  }
}

function drawBrick(ctx, w, h) {
  const r = seeded(11);
  ctx.fillStyle = '#cdbfae'; ctx.fillRect(0, 0, w, h);
  const rows = 8, bh = h / rows, bw = w / 4;
  const tones = [[196, 106, 74], [184, 94, 64], [207, 116, 82], [170, 86, 60], [214, 130, 92]];
  for (let row = 0; row < rows; row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
      const [cr, cg, cb] = tones[Math.floor(r() * tones.length)];
      const y = row * bh;
      const gr = ctx.createLinearGradient(x, y, x + bw, y + bh);
      gr.addColorStop(0, `rgb(${cr + 22},${cg + 18},${cb + 14})`); gr.addColorStop(1, `rgb(${cr - 18},${cg - 14},${cb - 10})`);
      ctx.fillStyle = gr; ctx.fillRect(x + 4, y + 4, bw - 8, bh - 8);
      ctx.fillStyle = 'rgba(255,240,220,0.25)'; ctx.fillRect(x + 4, y + 4, bw - 8, 3);
      ctx.fillStyle = 'rgba(60,20,10,0.25)'; ctx.fillRect(x + 4, y + bh - 7, bw - 8, 3);
      for (let k = 0; k < 10; k++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,230,210' : '70,30,15'},0.25)`; ctx.fillRect(x + 6 + r() * (bw - 14), y + 6 + r() * (bh - 14), 2, 2); }
    }
  }
  // stone frame
  ctx.strokeStyle = '#8b8076'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4);
}

function drawMetal(ctx, w, h) {
  const r = seeded(23);
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#c2ccd6'); g.addColorStop(1, '#8794a2');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // corrugated ridges
  for (let x = 0; x < w; x += 32) {
    const s = ctx.createLinearGradient(x, 0, x + 32, 0);
    s.addColorStop(0, 'rgba(255,255,255,0.22)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(20,30,45,0.25)');
    ctx.fillStyle = s; ctx.fillRect(x, 0, 32, h);
  }
  // scratches
  for (let k = 0; k < 26; k++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + r() * 0.15})`; ctx.lineWidth = 1;
    const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 16); ctx.stroke();
  }
  // middle bar with hazard stripes
  const by = h / 2 - 22;
  ctx.fillStyle = '#ffc93c'; ctx.fillRect(0, by, w, 44);
  ctx.fillStyle = '#2b2f36';
  for (let x = -44; x < w + 44; x += 44) { ctx.beginPath(); ctx.moveTo(x, by + 44); ctx.lineTo(x + 22, by); ctx.lineTo(x + 44, by); ctx.lineTo(x + 22, by + 44); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, by + 42, w, 4);
  // frame and rivets
  ctx.strokeStyle = '#59646f'; ctx.lineWidth = 22; ctx.strokeRect(11, 11, w - 22, h - 22);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4);
  for (let t = 24; t < w; t += 58) for (const [x, y] of [[t, 11], [t, h - 11], [11, t], [w - 11, t]]) {
    ctx.fillStyle = '#3e4750'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2, 0, 7); ctx.fill();
  }
}

// cracks get worse with each damage level (the same cracks keep growing)
function drawCracks(ctx, w, h, level, seed) {
  for (let lv = 1; lv <= level; lv++) {
    const r = seeded(seed * 31 + lv * 977);
    const n = lv === 3 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      let x = w * (0.15 + r() * 0.7), y = h * (0.15 + r() * 0.7);
      let a = r() * Math.PI * 2;
      const pts = [[x, y]];
      const len = 6 + Math.floor(r() * 6) + lv * 2;
      for (let k = 0; k < len; k++) { a += (r() - 0.5) * 1.1; x += Math.cos(a) * 16; y += Math.sin(a) * 16; pts.push([x, y]); }
      for (const [col, wd, ox] of [['rgba(255,255,255,0.28)', 2, 1.5], ['rgba(25,15,8,0.9)', 2.5 + lv * 0.6, 0]]) {
        ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + ox, py + ox) : ctx.moveTo(px + ox, py + ox)));
        ctx.stroke();
      }
      // a couple of side branches
      for (let b = 0; b < 2; b++) {
        const [bx, by] = pts[1 + Math.floor(r() * (pts.length - 2))];
        let ba = a + (r() < 0.5 ? 1 : -1) * (0.8 + r()), cx = bx, cy = by;
        ctx.strokeStyle = 'rgba(25,15,8,0.8)'; ctx.lineWidth = 1.5 + lv * 0.4; ctx.beginPath(); ctx.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) { ba += (r() - 0.5) * 0.9; cx += Math.cos(ba) * 12; cy += Math.sin(ba) * 12; ctx.lineTo(cx, cy); }
        ctx.stroke();
      }
    }
    if (lv === 3) { // chunks knocked out
      for (let k = 0; k < 4; k++) {
        const x = w * (0.2 + r() * 0.6), y = h * (0.2 + r() * 0.6), s = 10 + r() * 14;
        ctx.fillStyle = 'rgba(20,12,6,0.75)'; ctx.beginPath();
        for (let q = 0; q < 6; q++) { const aa = (q / 6) * Math.PI * 2; const rr = s * (0.6 + r() * 0.5); q ? ctx.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr) : ctx.moveTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr); }
        ctx.fill();
      }
    }
  }
}

const DRAW = { wood: drawWood, brick: drawBrick, metal: drawMetal };

export class Building {
  constructor(game) {
    this.game = game;
    this.pieces = new Map(); // key -> piece
    this.cells = new Map();  // spatial hash 'cx,cz' -> Set(piece)
    this.active = new Set(); // pieces that are animating (building / just hit)
    this.pending = [];       // unsupported pieces waiting to collapse: { t, piece }
    this.edit = null;
    const r = game.renderer && game.renderer.renderer;
    if (r) r.localClippingEnabled = true; // build-up fill animation uses a clipping plane
    this.makeTextures();
    this.geos = this.makeGeometries();
    this.edgeGeos = {};
    this.wallEditGeos = new Map();
    this.makeGhost();
    this.makeChunks();
    this.makeEditOverlay();
  }

  makeTextures() {
    this.tex = {};
    this.materials = {};
    this.frameMats = {};
    for (const m of MAT_ORDER) {
      const base = document.createElement('canvas');
      base.width = base.height = 512;
      DRAW[m](base.getContext('2d'), 512, 512);
      this.tex[m] = [0, 1, 2, 3].map((lv) => canvasTexture(512, 512, (ctx, w, h) => { ctx.drawImage(base, 0, 0); drawCracks(ctx, w, h, lv, MAT_ORDER.indexOf(m) + 1); }));
      this.materials[m] = new THREE.MeshStandardMaterial({
        map: this.tex[m][0], bumpMap: this.tex[m][0], bumpScale: m === 'metal' ? 0.6 : 1.2,
        roughness: m === 'metal' ? 0.38 : m === 'brick' ? 0.9 : 0.8, metalness: m === 'metal' ? 0.55 : 0,
      });
      // the see-through "blueprint" shown while a piece is still building
      this.frameMats[m] = new THREE.MeshStandardMaterial({
        map: this.tex[m][0], transparent: true, opacity: 0.32, depthWrite: false, emissive: 0x2f8cff, emissiveIntensity: 0.8,
        polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
      });
    }
  }

  makeGeometries() {
    const wall = new THREE.BoxGeometry(CELL, H, THICK);
    const floor = new THREE.BoxGeometry(CELL, THICK, CELL); floor.translate(0, -THICK / 2, 0); // top surface = level height
    // ramp: top surface runs exactly from the bottom edge (+z, y=-H/2) to the top edge (-z, y=+H/2)
    const ramp = new THREE.BoxGeometry(CELL, THICK, RAMP_LEN); ramp.translate(0, -THICK / 2, 0); ramp.rotateX(RAMP_ANGLE);
    const cone = new THREE.ConeGeometry(CELL / Math.SQRT2, CONE_H, 4, 1, false, Math.PI / 4);
    cone.translate(0, CONE_H / 2, 0);
    return { wall, floor, ramp, cone };
  }

  edgesFor(geo, type) {
    const k = type + (geo.userData.mask || '');
    if (!this.edgeGeos[k]) this.edgeGeos[k] = new THREE.EdgesGeometry(geo, 30);
    return this.edgeGeos[k];
  }

  // a wall with some of its 3x3 tiles cut out (edit mode). Bit i = tile (col i%3, row i/3 from the bottom) removed.
  wallGeo(mask) {
    if (!mask) return this.geos.wall;
    if (this.wallEditGeos.has(mask)) return this.wallEditGeos.get(mask);
    const parts = [];
    const tw = CELL / 3, th = H / 3;
    for (let i = 0; i < 9; i++) {
      if (mask & (1 << i)) continue;
      const col = i % 3, row = Math.floor(i / 3);
      const g = new THREE.BoxGeometry(tw, th, THICK);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 3, (row + uv.getY(k)) / 3);
      g.translate(-CELL / 2 + tw * (col + 0.5), -H / 2 + th * (row + 0.5), 0);
      parts.push(g);
    }
    const geo = mergeGeometries(parts, false);
    geo.userData.mask = mask;
    for (const p of parts) p.dispose();
    this.wallEditGeos.set(mask, geo);
    return geo;
  }

  makeGhost() {
    const bp = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo((w * i) / 3, 0); ctx.lineTo((w * i) / 3, h); ctx.moveTo(0, (h * i) / 3); ctx.lineTo(w, (h * i) / 3); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
    });
    const ghostMat = (color) => new THREE.MeshBasicMaterial({ map: bp, color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.ghostMat = ghostMat(0x3aa8ff);
    this.ghostBad = ghostMat(0xff3b3b);
    this.ghostTaken = ghostMat(0xbfe4ff);
    this.ghost = new THREE.Mesh(this.geos.wall, this.ghostMat);
    this.ghost.renderOrder = 5;
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this.ghostEdges = new THREE.LineSegments(this.edgesFor(this.geos.wall, 'wall'), this.ghostEdgeMat);
    this.ghostEdges.renderOrder = 6;
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    this.ghostType = 'wall';
    this.game.scene.add(this.ghost);
  }

  // ---------- spatial index ----------
  cellKey(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }
  index(p) {
    const k = this.cellKey(p.pos.x, p.pos.z);
    p.cell = k;
    if (!this.cells.has(k)) this.cells.set(k, new Set());
    this.cells.get(k).add(p);
  }
  unindex(p) { const s = this.cells.get(p.cell); if (s) { s.delete(p); if (!s.size) this.cells.delete(p.cell); } }
  near(pos, r) {
    const out = [];
    if (!this.pieces.size) return out;
    const n = Math.ceil(r / CELL) + 1;
    const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    for (let x = cx - n; x <= cx + n; x++) for (let z = cz - n; z <= cz + n; z++) {
      const s = this.cells.get(`${x},${z}`);
      if (s) for (const p of s) out.push(p);
    }
    return out;
  }
  nearestPiece(pos, rh, rv) {
    let best = null, bd = Infinity;
    for (const p of this.near(pos, rh)) {
      const c = p.center;
      const dy = Math.abs(c.y - pos.y);
      if (dy > rv) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d > rh) continue;
      if (d + dy * 0.5 < bd) { bd = d + dy * 0.5; best = p; }
    }
    return best;
  }

  // ---------- placement math ----------
  // Where would a piece of this type go if this character placed it now, looking along `look`?
  // returns a spec { type, ix, iy, iz, dir, off, key, pos, rotY, aabb, ... }
  target(ch, type, look, opts = {}) {
    const g = this.game, p = ch.pos;
    const horiz = new THREE.Vector3(look.x, 0, look.z);
    if (horiz.lengthSq() < 1e-4) horiz.set(-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw));
    horiz.normalize();
    const dir = Math.abs(horiz.x) > Math.abs(horiz.z) ? (horiz.x > 0 ? 1 : 3) : (horiz.z > 0 ? 2 : 0);
    const dv = DIRS[dir];
    const pitch = Math.asin(clamp(look.y, -1, 1));
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    const feet = p.y;
    const groundHere = g.world.groundY(p.x, p.z);
    const footY = ch.grounded || feet - groundHere < 0.3 ? feet : groundHere;
    // which tile?
    let ix = cx, iz = cz, up = 0;
    if (type === 'floor') {
      if (pitch > 0.6) up = 1;
      else if (pitch > -0.55) { ix += dv[0]; iz += dv[1]; }
    } else if (type === 'ramp') {
      // in front of us, or under us when we're still in the back half of our tile (it lifts us up, like Fortnite)
      if (!opts.own) { const ahead = p.clone().addScaledVector(horiz, CELL * 0.5); ix = Math.floor(ahead.x / CELL); iz = Math.floor(ahead.z / CELL); }
    } else if (type === 'cone') {
      if (pitch > 0.3) up = 1;
      else if (pitch > -0.45) { ix += dv[0]; iz += dv[1]; }
    } else if (pitch > 0.55) up = 1;
    // which height grid? join the structure we are standing in, otherwise start a new one at our feet
    const anchor = this.nearestPiece(new THREE.Vector3(p.x, feet + 0.9, p.z), CELL * 1.6, H * 1.6);
    let off;
    if (anchor) off = anchor.off;
    else {
      let base = footY;
      if (type === 'wall' || type === 'cone') {
        // sink into slopes so the wall never floats above the low side of the hill
        const s = this.footprint(type, ix, iz, dir);
        for (const [x, z] of s) base = Math.min(base, g.world.groundY(x, z));
        base = Math.max(base, footY - 1.2);
      }
      off = mod(base, H);
    }
    off = Math.round(off * 20) / 20; if (off >= H - 0.025) off = 0;
    const level = (y) => Math.floor((y - off) / H + 1e-4);
    let iy;
    if (type === 'wall') {
      iy = level(feet + 0.6) + up;
      if (pitch < -0.8 && feet - groundHere > 1.5) iy -= 1; // looking down from up high: wall below you
    } else if (type === 'ramp') {
      // ramp rushing: standing on a ramp, the next one continues the slope from its top edge
      iy = level(feet + 0.35);
      const lv = iy;
      for (const k of [lv, lv - 1]) {
        const r = this.pieces.get(this.spec('ramp', cx, k, cz, 0, off).key);
        if (!r || r.type !== 'ramp') continue;
        const rd = DIRS[r.dir];
        if (ix === cx && iz === cz) iy = k;                                  // still on this ramp's tile
        else if (ix === cx + rd[0] && iz === cz + rd[1]) iy = k + 1;        // the tile it climbs into
        else iy = k;
        break;
      }
    } else iy = level(feet + 0.35) + up;
    return this.spec(type, ix, iy, iz, dir, off);
  }

  // ground sample points under a piece's bottom edge
  footprint(type, ix, iz, dir) {
    const x0 = ix * CELL, z0 = iz * CELL;
    if (type === 'wall') {
      const [ax, az, bx, bz] = dir === 0 ? [x0, z0, x0 + CELL, z0] : dir === 2 ? [x0, z0 + CELL, x0 + CELL, z0 + CELL] : dir === 1 ? [x0 + CELL, z0, x0 + CELL, z0 + CELL] : [x0, z0, x0, z0 + CELL];
      return [[ax, az], [(ax + bx) / 2, (az + bz) / 2], [bx, bz]];
    }
    return [[x0 + CELL / 2, z0 + CELL / 2], [x0 + 0.3, z0 + 0.3], [x0 + CELL - 0.3, z0 + 0.3], [x0 + 0.3, z0 + CELL - 0.3], [x0 + CELL - 0.3, z0 + CELL - 0.3]];
  }

  spec(type, ix, iy, iz, dir, off = 0) {
    const x0 = ix * CELL, z0 = iz * CELL, y0 = off + iy * H;
    const ok = Math.round(off * 20);
    const pos = new THREE.Vector3(), aabb = new THREE.Box3();
    let key, rotY = 0, axis = null;
    if (type === 'wall') {
      // walls live on cell edges; normalise to a canonical edge key
      let ex = ix, ez = iz;
      if (dir === 0) axis = 'x';
      else if (dir === 2) { axis = 'x'; ez = iz + 1; }
      else if (dir === 1) { axis = 'z'; ex = ix + 1; }
      else axis = 'z';
      key = `w${axis}:${ex},${iy},${ez}@${ok}`;
      if (axis === 'x') {
        pos.set(ex * CELL + CELL / 2, y0 + H / 2, ez * CELL);
        aabb.min.set(ex * CELL, y0, ez * CELL - THICK / 2); aabb.max.set(ex * CELL + CELL, y0 + H, ez * CELL + THICK / 2);
      } else {
        pos.set(ex * CELL, y0 + H / 2, ez * CELL + CELL / 2); rotY = Math.PI / 2;
        aabb.min.set(ex * CELL - THICK / 2, y0, ez * CELL); aabb.max.set(ex * CELL + THICK / 2, y0 + H, ez * CELL + CELL);
      }
    } else if (type === 'floor') {
      key = `f:${ix},${iy},${iz}@${ok}`; pos.set(x0 + CELL / 2, y0, z0 + CELL / 2);
      aabb.min.set(x0, y0 - THICK, z0); aabb.max.set(x0 + CELL, y0, z0 + CELL);
    } else if (type === 'ramp') {
      key = `s:${ix},${iy},${iz}@${ok}`; pos.set(x0 + CELL / 2, y0 + H / 2, z0 + CELL / 2);
      rotY = [0, -Math.PI / 2, Math.PI, Math.PI / 2][dir];
      aabb.min.set(x0, y0 - THICK, z0); aabb.max.set(x0 + CELL, y0 + H, z0 + CELL);
    } else {
      key = `s:${ix},${iy},${iz}@${ok}`; pos.set(x0 + CELL / 2, y0, z0 + CELL / 2);
      aabb.min.set(x0, y0, z0); aabb.max.set(x0 + CELL, y0 + CONE_H, z0 + CELL);
    }
    return { type, ix, iy, iz, dir, off, y0, axis, key, slot: SLOT[type], pos, rotY, aabb };
  }

  canPlace(spec) {
    if (!spec || this.pieces.has(spec.key)) return false;
    // don't overlap a piece from a neighbouring structure that uses a slightly different height grid
    for (const o of this.near(spec.pos, CELL)) {
      if (o.slot !== spec.slot || (o.axis && o.axis !== spec.axis)) continue;
      if (o.pos.distanceToSquared(spec.pos) < 1.2) return false;
    }
    const w = this.game.world;
    const b = spec.aabb;
    // fully buried under the terrain
    let buried = true;
    for (const [x, z] of this.footprint(spec.type, spec.ix, spec.iz, spec.dir)) if (b.max.y > w.groundY(x, z) - 0.1) { buried = false; break; }
    if (buried) return false;
    // like Fortnite: a new piece must touch the ground, the world, or another piece
    return this.isGrounded(spec) || this.hasSupport(spec);
  }

  isGrounded(spec) {
    const w = this.game.world, b = spec.aabb;
    for (const [x, z] of this.footprint(spec.type, spec.ix, spec.iz, spec.dir)) if (b.min.y <= w.groundY(x, z) + 0.3) return true;
    // resting on a house, rock or other solid world object
    const c = spec.pos;
    const ph = this.game.physics;
    const hit = ph.raycast({ x: c.x, y: b.min.y + 0.35, z: c.z }, { x: 0, y: -1, z: 0 }, 0.9, null, undefined, (col) => {
      const o = ph.owners.get(col.handle);
      return !o || (o.kind !== 'build' && o.kind !== 'char' && o.kind !== 'trigger' && o.kind !== 'loot');
    });
    return !!hit;
  }

  touches(a, b) {
    const e = 0.15;
    return a.min.x <= b.max.x + e && a.max.x >= b.min.x - e && a.min.y <= b.max.y + e && a.max.y >= b.min.y - e && a.min.z <= b.max.z + e && a.max.z >= b.min.z - e;
  }

  hasSupport(spec) {
    for (const o of this.near(spec.pos, CELL * 1.5)) if (!o.dead && !o.collapsing && this.touches(o.aabb, spec.aabb)) return true;
    return false;
  }

  neighbors(p) {
    const out = [];
    for (const o of this.near(p.pos, CELL * 1.5)) if (o !== p && !o.dead && this.touches(o.aabb, p.aabb)) out.push(o);
    return out;
  }

  // ---------- placing ----------
  place(ch, spec, mat) {
    if (!this.canPlace(spec)) return null;
    if (!this.game.cheats?.infiniteMats || !ch.isPlayer) {
      if (ch.inv.mats[mat] < COST) return null;
      ch.inv.mats[mat] -= COST;
    }
    const m = MATS[mat];
    const material = this.materials[mat].clone();
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    material.clippingPlanes = [clip];
    material.clipShadows = true;
    const mesh = new THREE.Mesh(this.geos[spec.type], material);
    mesh.position.copy(spec.pos);
    mesh.rotation.y = spec.rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    const frame = new THREE.Mesh(this.geos[spec.type], this.frameMats[mat]);
    frame.renderOrder = 2;
    mesh.add(frame);
    this.game.scene.add(mesh);
    const center = spec.aabb.getCenter(new THREE.Vector3());
    const piece = {
      key: spec.key, type: spec.type, mat, mesh, frame, material, clip, body: null, cols: [], col: null,
      hp: m.hp * m.start, maxHp: m.hp, dmg: 0, crack: 0, buildT: 0, buildTime: m.time,
      pos: spec.pos.clone(), center, aabb: spec.aabb.clone(), off: spec.off, slot: spec.slot, axis: spec.axis,
      dir: spec.dir, owner: ch, spec, mask: 0, hitT: 0, flash: 0,
    };
    // the fill sweeps up from the bottom (or across a floor, away from the builder)
    if (spec.type === 'floor') {
      const d = DIRS[spec.dir];
      piece.sweep = { n: new THREE.Vector3(d[0], 0, d[1]), from: d[0] * center.x + d[1] * center.z - CELL / 2, len: CELL };
    } else piece.sweep = { n: new THREE.Vector3(0, 1, 0), from: spec.aabb.min.y, len: spec.aabb.max.y - spec.aabb.min.y };
    this.setClip(piece, 0);
    piece.grounded = this.isGrounded(spec);
    this.makeColliders(piece);
    this.pieces.set(spec.key, piece);
    this.index(piece);
    this.active.add(piece);
    this.resolveChars(piece);
    audio.build(mat, spec.pos);
    this.game.events.emit('build', ch, piece);
    return piece;
  }

  setClip(p, k) {
    const s = p.sweep;
    // keep points where dot(n, x) <= from + k * len
    p.clip.normal.copy(s.n).negate();
    p.clip.constant = s.from + Math.max(0.02, k) * s.len;
  }

  makeColliders(piece) {
    const ph = this.game.physics, R = ph.R;
    if (piece.body) { for (const c of piece.cols) ph.owners.delete(c.handle); ph.world.removeRigidBody(piece.body); }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, piece.spec.rotY, 0));
    const p = piece.pos;
    const body = ph.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const descs = [];
    if (piece.type === 'wall') {
      if (!piece.mask) descs.push(R.ColliderDesc.cuboid(CELL / 2, H / 2, THICK / 2));
      else {
        // one box per run of solid tiles in each row
        const tw = CELL / 3, th = H / 3;
        for (let row = 0; row < 3; row++) {
          let col = 0;
          while (col < 3) {
            if (piece.mask & (1 << (row * 3 + col))) { col++; continue; }
            let end = col; while (end + 1 < 3 && !(piece.mask & (1 << (row * 3 + end + 1)))) end++;
            const n = end - col + 1;
            descs.push(R.ColliderDesc.cuboid((tw * n) / 2, th / 2, THICK / 2).setTranslation(-CELL / 2 + tw * (col + n / 2), -H / 2 + th * (row + 0.5), 0));
            col = end + 1;
          }
        }
      }
    } else if (piece.type === 'floor') descs.push(R.ColliderDesc.cuboid(CELL / 2, THICK / 2, CELL / 2).setTranslation(0, -THICK / 2, 0));
    else if (piece.type === 'ramp') {
      const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), RAMP_ANGLE);
      descs.push(R.ColliderDesc.cuboid(CELL / 2, THICK / 2, RAMP_LEN / 2)
        .setTranslation(0, -Math.cos(RAMP_ANGLE) * THICK / 2, -Math.sin(RAMP_ANGLE) * THICK / 2)
        .setRotation({ x: rq.x, y: rq.y, z: rq.z, w: rq.w }));
    } else {
      const s = CELL / 2;
      descs.push(R.ColliderDesc.convexHull(new Float32Array([-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s, 0, CONE_H, 0])));
    }
    piece.body = body;
    piece.cols = descs.map((d) => {
      d.setCollisionGroups(groups(GROUP.BUILD, 0xffff));
      const c = ph.world.createCollider(d, body);
      ph.owners.set(c.handle, { kind: 'build', piece });
      return c;
    });
    piece.col = piece.cols[0];
  }

  // Building on top of someone pops them up onto the piece (Fortnite style); walls push them out to the nearest side.
  resolveChars(piece) {
    const b = piece.aabb;
    for (const c of this.game.chars) {
      if (!c.alive || c.state !== 'ground' || !c.collider) continue;
      const p = c.pos;
      if (p.x < b.min.x - 0.5 || p.x > b.max.x + 0.5 || p.z < b.min.z - 0.5 || p.z > b.max.z + 0.5) continue;
      if (p.y > b.max.y + 0.1 || p.y + 1.8 < b.min.y) continue;
      if (piece.type === 'wall') {
        const n = piece.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const d = n.x * (p.x - piece.pos.x) + n.z * (p.z - piece.pos.z);
        const need = 0.42 + THICK / 2;
        if (Math.abs(d) >= need) continue;
        // only if we are actually inside the wall's span (and an edited hole doesn't make room)
        const along = piece.axis === 'x' ? p.x - b.min.x : p.z - b.min.z;
        if (along < -0.3 || along > CELL + 0.3) continue;
        const side = Math.sign(d) || 1;
        c.setPosition(p.clone().addScaledVector(n, side * need - d));
        continue;
      }
      const top = this.surfaceAt(piece, p.x, p.z);
      if (top == null) continue;
      if (p.y < top + 0.05 && p.y > top - 1.9) {
        c.setPosition(new THREE.Vector3(p.x, top + 0.06, p.z));
        c.vel.y = Math.max(c.vel.y, 0);
      }
    }
  }

  // height of a piece's walkable top surface at (x, z), or null when outside it
  surfaceAt(piece, x, z) {
    const b = piece.aabb;
    if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) return null;
    const y0 = piece.spec.y0;
    if (piece.type === 'floor') return y0;
    const lx = x - (b.min.x + CELL / 2), lz = z - (b.min.z + CELL / 2);
    if (piece.type === 'ramp') {
      const d = DIRS[piece.dir];
      const u = clamp((d[0] * lx + d[1] * lz) / CELL + 0.5, 0, 1); // 0 at the low edge, 1 at the top
      return y0 + u * H;
    }
    if (piece.type === 'cone') return y0 + CONE_H * Math.max(0, 1 - Math.max(Math.abs(lx), Math.abs(lz)) / (CELL / 2));
    return null;
  }

  // ---------- damage ----------
  damagePiece(piece, amount, src) {
    if (!piece || piece.dead) return;
    piece.hp -= amount;
    piece.dmg += amount;
    piece.hitT = 0.16;
    piece.flash = 1;
    piece.lastSrc = src;
    this.active.add(piece);
    const frac = piece.dmg / piece.maxHp;
    const lvl = frac > 0.66 ? 3 : frac > 0.4 ? 2 : frac > 0.15 ? 1 : 0;
    if (lvl !== piece.crack) { piece.crack = lvl; piece.material.map = this.tex[piece.mat][lvl]; piece.material.bumpMap = piece.material.map; }
    if (piece.hp <= 0) this.destroyPiece(piece, { src });
  }

  damageRadius(pos, r, amount, src) {
    for (const p of this.near(pos, r + CELL)) {
      if (p.dead) continue;
      const d = p.aabb.distanceToPoint(pos);
      if (d < r + 0.5) this.damagePiece(p, amount * (1 - 0.5 * clamp(d / (r + 0.5), 0, 1)), src);
    }
  }

  destroyPiece(piece, opts = {}) {
    if (piece.dead) return;
    // second argument used to be a boolean "cascade"
    if (typeof opts === 'boolean') opts = { collapse: !opts };
    const nbrs = opts.collapse ? null : this.neighbors(piece);
    piece.dead = true;
    if (this.edit && this.edit.piece === piece) this.endEdit(false);
    this.spawnChunks(piece, opts.src, !!opts.collapse);
    this.removePiece(piece);
    const c = piece.center;
    this.game.effects.dust(c, MATS[piece.mat].dust, piece.type === 'floor' ? 8 : 14);
    this.game.effects.chips(c, piece.mat);
    const snd = piece.mat === 'metal' ? 'hitMetal' : piece.mat === 'brick' ? 'hitStone' : 'hitWood';
    audio.play(snd, { pos: c, vol: opts.collapse ? 0.6 : 1, rate: rand(0.7, 0.85) });
    if (!opts.collapse) setTimeout(() => audio.play(snd, { pos: c, vol: 0.5, rate: rand(0.55, 0.7) }), 70);
    this.game.events.emit('buildDestroyed', piece, opts.src);
    if (nbrs && nbrs.length) this.collapseCheck(nbrs);
  }

  removePiece(piece) {
    const ph = this.game.physics;
    this.pieces.delete(piece.key);
    this.unindex(piece);
    this.active.delete(piece);
    for (const c of piece.cols) ph.owners.delete(c.handle);
    if (piece.body) ph.world.removeRigidBody(piece.body);
    piece.mesh.removeFromParent();
    piece.material.dispose();
  }

  // After a piece breaks, everything that is no longer connected to the ground collapses in a ripple.
  collapseCheck(seeds) {
    const done = new Set();
    for (const s of seeds) {
      if (s.dead || s.collapsing || done.has(s)) continue;
      const depth = new Map([[s, 0]]);
      const queue = [s];
      let supported = false;
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        if (p.grounded) { supported = true; break; }
        for (const n of this.neighbors(p)) if (!depth.has(n) && !n.collapsing) { depth.set(n, depth.get(p) + 1); queue.push(n); }
      }
      for (const p of depth.keys()) done.add(p);
      if (supported) continue;
      for (const [p, d] of depth) { p.collapsing = true; this.pending.push({ t: 0.08 + d * 0.07 + Math.random() * 0.04, piece: p }); }
    }
  }

  // full re-check of every structure (kept for callers that changed the world under builds)
  checkSupport() {
    const list = [...this.pieces.values()].filter((p) => !p.collapsing);
    for (const p of list) p.grounded = this.isGrounded(p.spec);
    this.collapseCheck(list);
  }

  // ---------- shatter chunks ----------
  makeChunks() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.chunks = {};
    this.chunkMeshes = {};
    this.dummy = new THREE.Object3D();
    for (const m of MAT_ORDER) {
      const t = this.tex[m][1].clone();
      t.repeat.set(0.22, 0.22); t.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: t, roughness: m === 'metal' ? 0.4 : 0.85, metalness: m === 'metal' ? 0.5 : 0 });
      const im = new THREE.InstancedMesh(geo, mat, MAX_CHUNKS);
      im.count = 0; im.frustumCulled = false; im.castShadow = true;
      this.game.scene.add(im);
      this.chunkMeshes[m] = im;
      this.chunks[m] = [];
    }
  }

  spawnChunks(piece, src, collapse) {
    const list = this.chunks[piece.mat];
    const n = piece.type === 'floor' ? 10 : piece.type === 'cone' ? 8 : 14;
    const mesh = piece.mesh;
    mesh.position.copy(piece.pos);
    mesh.updateMatrixWorld(true);
    const away = new THREE.Vector3();
    if (src && src.pos) away.copy(piece.center).sub(src.pos).setY(0).normalize();
    const w = this.game.world;
    for (let i = 0; i < n; i++) {
      const local = new THREE.Vector3();
      if (piece.type === 'wall') local.set(rand(-CELL / 2, CELL / 2), rand(-H / 2, H / 2), 0);
      else if (piece.type === 'floor') local.set(rand(-CELL / 2, CELL / 2), -THICK / 2, rand(-CELL / 2, CELL / 2));
      else if (piece.type === 'ramp') { const u = rand(-0.5, 0.5); local.set(rand(-CELL / 2, CELL / 2), u * H, -u * CELL); }
      else local.set(rand(-1.5, 1.5), rand(0, CONE_H * 0.6), rand(-1.5, 1.5));
      const pos = mesh.localToWorld(local);
      const vel = collapse
        ? new THREE.Vector3(rand(-1.5, 1.5), rand(-1, 1.5), rand(-1.5, 1.5))
        : new THREE.Vector3(rand(-2.5, 2.5), rand(1.5, 5), rand(-2.5, 2.5)).addScaledVector(away, rand(3, 7));
      const s = rand(0.35, 0.85);
      const size = new THREE.Vector3(s, s * rand(0.5, 1), THICK * rand(0.8, 1.3));
      const fx = pos.x + vel.x * 0.5, fz = pos.z + vel.z * 0.5;
      const c = {
        pos, vel, size, life: rand(1.6, 2.6), floor: w.groundY(fx, fz),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
      };
      if (list.length >= MAX_CHUNKS) list.shift();
      list.push(c);
    }
  }

  updateChunks(dt) {
    const d = this.dummy;
    for (const m of MAT_ORDER) {
      const list = this.chunks[m], im = this.chunkMeshes[m];
      if (!list.length && !im.count) continue;
      let j = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        c.life -= dt;
        if (c.life <= 0) continue;
        c.vel.y -= 22 * dt;
        c.pos.addScaledVector(c.vel, dt);
        const half = c.size.y * 0.5;
        if (c.pos.y < c.floor + half) {
          c.pos.y = c.floor + half;
          if (c.vel.y < -1.5) { c.vel.y *= -0.3; c.vel.x *= 0.6; c.vel.z *= 0.6; c.spin.multiplyScalar(0.5); }
          else { c.vel.set(c.vel.x * 0.85, 0, c.vel.z * 0.85); c.spin.multiplyScalar(0.8); }
        }
        c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
        const fade = Math.min(1, c.life / 0.5);
        d.position.copy(c.pos); d.rotation.copy(c.rot); d.scale.copy(c.size).multiplyScalar(fade);
        d.updateMatrix();
        im.setMatrixAt(j, d.matrix);
        list[j++] = c;
      }
      list.length = j;
      im.count = j;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- ghost ----------
  showGhost(spec, ok) {
    if (!spec || this.edit) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    if (this.ghostType !== spec.type) {
      this.ghostType = spec.type;
      this.ghost.geometry = this.geos[spec.type];
      this.ghostEdges.geometry = this.edgesFor(this.geos[spec.type], spec.type);
    }
    const taken = this.pieces.has(spec.key);
    this.ghost.material = taken ? this.ghostTaken : ok ? this.ghostMat : this.ghostBad;
    this.ghostEdgeMat.color.setHex(taken ? 0xffffff : ok ? 0xbfe8ff : 0xffb0b0);
    this.ghost.position.copy(spec.pos);
    this.ghost.rotation.y = spec.rotY;
  }

  // ---------- edit mode (walls): cut windows and doors ----------
  makeEditOverlay() {
    this.editGroup = new THREE.Group();
    this.editTiles = [];
    const tw = CELL / 3, th = H / 3;
    const geo = new THREE.PlaneGeometry(tw * 0.92, th * 0.92);
    const edges = new THREE.EdgesGeometry(geo);
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(-CELL / 2 + tw * ((i % 3) + 0.5), -H / 2 + th * (Math.floor(i / 3) + 0.5), 0);
      m.renderOrder = 7;
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xdff4ff, transparent: true, depthWrite: false, toneMapped: false }));
      line.renderOrder = 8;
      m.add(line);
      this.editGroup.add(m);
      this.editTiles.push(m);
    }
    this.editGroup.visible = false;
    this.game.scene.add(this.editGroup);
  }

  // Called by the player controller every frame. Returns true while edit mode is using the input.
  editUpdate(ctl, inp, origin, dir) {
    const g = this.game, ch = ctl.ch;
    if (!this.edit) {
      if (!inp.pressed('edit') || ch.state !== 'ground' || !ch.alive) return false;
      const piece = this.pickPiece(origin, dir, 8 + (g.cameraRig ? g.cameraRig.distance : 0), ch);
      if (!piece) { audio.ui('error'); return false; }
      if (piece.type !== 'wall') { g.hud.toast('Only walls can be edited'); audio.ui('error'); return false; }
      if (piece.owner !== ch) { g.hud.toast("You can only edit your own builds"); audio.ui('error'); return false; }
      this.edit = { piece, mask: piece.mask, paint: null, hover: -1 };
      piece.mesh.visible = false;
      this.ghost.visible = false;
      this.editGroup.visible = true;
      this.editGroup.position.copy(piece.pos);
      this.editGroup.rotation.y = piece.spec.rotY;
      if (!this.editHintShown) { this.editHintShown = true; g.hud.toast(g.input.usingPad ? 'EDIT: hold R2 over tiles to cut a door or window. ◯ to confirm, L2 to reset' : 'EDIT: click tiles to cut a door or window. G to confirm, right-click to reset'); }
      audio.ui('select');
      this.paintEdit();
      return true;
    }
    const e = this.edit, piece = e.piece;
    if (piece.dead || !ch.alive || ch.pos.distanceTo(piece.center) > 10) { this.endEdit(false); return false; }
    if (inp.pressed('build') || inp.pressed('pickaxe')) { this.endEdit(false); return true; }
    if (inp.pressed('edit')) { this.endEdit(true); return true; }
    if (inp.pressed('aim')) { e.mask = 0; audio.ui('click'); }
    const tile = this.editTileAt(piece, origin, dir);
    e.hover = tile;
    if (inp.pressed('fire') && tile >= 0) e.paint = e.mask & (1 << tile) ? 'fill' : 'cut';
    if (!inp.down('fire')) e.paint = null;
    if (e.paint && tile >= 0) {
      const bit = 1 << tile;
      const next = e.paint === 'cut' ? e.mask | bit : e.mask & ~bit;
      if (next !== e.mask && next !== 511) { e.mask = next; audio.ui('click'); }
    }
    this.paintEdit();
    return true;
  }

  paintEdit() {
    const e = this.edit;
    for (let i = 0; i < 9; i++) {
      const t = this.editTiles[i];
      const cut = e.mask & (1 << i);
      const hov = e.hover === i;
      t.material.color.setHex(cut ? 0xffffff : 0x3aa8ff);
      t.material.opacity = cut ? (hov ? 0.22 : 0.08) : hov ? 0.75 : 0.45;
    }
  }

  endEdit(confirm) {
    const e = this.edit;
    if (!e) return;
    this.edit = null;
    this.editGroup.visible = false;
    const piece = e.piece;
    if (piece.dead) return;
    piece.mesh.visible = true;
    if (confirm && e.mask !== piece.mask) this.setMask(piece, e.mask);
    else audio.ui('click');
  }

  // cut tiles out of a wall (also used by bots to open a window / door in their box)
  setMask(piece, mask) {
    if (!piece || piece.dead || piece.type !== 'wall' || mask === piece.mask || mask === 511) return false;
    piece.mask = mask;
    piece.mesh.geometry = this.wallGeo(mask);
    if (piece.frame) piece.frame.geometry = piece.mesh.geometry;
    this.makeColliders(piece);
    audio.play('build', { pos: piece.pos, range: 40, vol: 0.6, rate: 1.25 });
    this.game.events.emit('buildEdit', piece.owner, piece);
    return true;
  }

  pickPiece(origin, dir, maxDist, ch) {
    const hit = this.game.physics.raycast(origin, dir, maxDist, ch && ch.collider, undefined, (c) => {
      const o = this.game.physics.owners.get(c.handle); return !o || o.kind !== 'char';
    });
    return hit && hit.owner && hit.owner.kind === 'build' ? hit.owner.piece : null;
  }

  // which of a wall's 3x3 tiles is nearest to a world point (bots use it to cut a window at head height)
  tileNear(piece, point) {
    piece.mesh.updateMatrixWorld(true);
    const l = piece.mesh.worldToLocal(point.clone());
    const col = clamp(Math.floor((l.x + CELL / 2) / (CELL / 3)), 0, 2), row = clamp(Math.floor((l.y + H / 2) / (H / 3)), 0, 2);
    return row * 3 + col;
  }

  editTileAt(piece, origin, dir) {
    // intersect the camera ray with the wall's middle plane, in the wall's local space
    const n = piece.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const denom = n.dot(dir);
    if (Math.abs(denom) < 1e-4) return -1;
    const t = n.dot(new THREE.Vector3().subVectors(piece.pos, origin)) / denom;
    if (t < 0 || t > 30) return -1;
    const p = origin.clone().addScaledVector(dir, t);
    this.editGroup.updateMatrixWorld(true);
    const local = this.editGroup.worldToLocal(p);
    const col = Math.floor((local.x + CELL / 2) / (CELL / 3)), row = Math.floor((local.y + H / 2) / (H / 3));
    if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
    return row * 3 + col;
  }

  // ---------- per frame ----------
  update(dt) {
    // ripple collapse of unsupported pieces
    if (this.pending.length) {
      for (const job of this.pending) job.t -= dt;
      const ready = this.pending.filter((j) => j.t <= 0);
      if (ready.length) {
        this.pending = this.pending.filter((j) => j.t > 0);
        for (const j of ready) this.destroyPiece(j.piece, { collapse: true });
      }
    }
    for (const p of this.active) {
      let busy = false;
      const mat = p.material;
      let glow = 0, glowColor = 0x3a8cff;
      if (p.buildT < p.buildTime) {
        busy = true;
        p.buildT += dt;
        const k = Math.min(1, p.buildT / p.buildTime);
        p.hp = Math.min(p.maxHp - p.dmg, p.hp + (p.maxHp * (1 - MATS[p.mat].start)) * dt / p.buildTime);
        this.setClip(p, k);
        glow = 0.45 * (1 - k);
        // quick pop-in
        const s = Math.min(1, p.buildT / 0.14);
        p.mesh.scale.setScalar(0.92 + 0.08 * (1 + 2.2 * (s - 1) ** 3 + 1.2 * (s - 1) ** 2));
        if (k >= 1) {
          p.mesh.scale.setScalar(1);
          mat.clippingPlanes = null; mat.needsUpdate = true;
          if (p.frame) { p.mesh.remove(p.frame); p.frame = null; }
        }
      }
      if (p.flash > 0) {
        busy = true;
        p.flash = Math.max(0, p.flash - dt * 7);
        if (p.flash * 0.5 > glow) { glow = p.flash * 0.5; glowColor = 0xffffff; }
      }
      mat.emissive.setHex(glowColor);
      mat.emissiveIntensity = glow;
      if (p.hitT > 0) {
        busy = true;
        p.hitT -= dt;
        const a = p.hitT > 0 ? 0.06 * (p.hitT / 0.16) : 0;
        p.mesh.position.set(p.pos.x + rand(-a, a), p.pos.y + rand(-a, a) * 0.5, p.pos.z + rand(-a, a));
      }
      if (!busy) { p.mesh.position.copy(p.pos); this.active.delete(p); }
    }
    this.updateChunks(dt);
    const t = this.game.time || 0;
    this.ghostMat.opacity = 0.5 + Math.sin(t * 6) * 0.1;
    if (this.edit) {
      const pulse = 0.5 + Math.sin(t * 8) * 0.5;
      for (const tile of this.editTiles) tile.children[0].material.opacity = 0.6 + pulse * 0.4;
    }
  }

  clear() {
    if (this.edit) { this.edit = null; this.editGroup.visible = false; }
    // the physics world lives across matches, so the colliders must go too (no invisible walls next match)
    for (const p of [...this.pieces.values()]) { p.dead = true; this.removePiece(p); }
    this.pieces.clear();
    this.cells.clear();
    this.active.clear();
    this.pending = [];
    for (const m of MAT_ORDER) { this.chunks[m].length = 0; this.chunkMeshes[m].count = 0; }
    this.ghost.visible = false;
  }
}
