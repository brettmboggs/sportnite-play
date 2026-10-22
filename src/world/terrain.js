import * as THREE from 'three';
import { makeNoise2D, fbm } from '../engine/noise.js';
import { clamp, smoothstep, lerp } from '../engine/utils.js';

export const MAP_SIZE = 1200;     // world units covered by terrain (-600..600)
export const ISLAND_RADIUS = 470; // where land ends
export const WATER_LEVEL = 0;
const RES = 400;                  // grid cells per side (3 m cells)

export const BIOMES = {
  city:      { name: 'Sports City',    center: [0, 0],      color: '#7c8a99' },
  mountains: { name: 'Frosty Peaks',   center: [0, -330],   color: '#e8f2ff' },
  candy:     { name: 'Candyland',      center: [330, 40],   color: '#ff8fd8' },
  jungle:    { name: 'Jungle Ruins',   center: [40, 330],   color: '#2fb84a' },
  haunted:   { name: 'Haunted Hollow', center: [-330, 40],  color: '#5b3d7a' },
};
export const BIOME_KEYS = Object.keys(BIOMES);

// Big cliff-sided plateau in the jungle: the creek pours off its edge as a waterfall.
export const MESAS = [{ x: 88, z: 396, r: 24, h: 17 }];

// Rivers carved into the ground. pts = [x, z, width]. The water surface always runs downhill.
export const RIVERS = [
  {
    name: 'Waterfall Creek', kind: 'water', depth: 1.6,
    pts: [[86, 404, 4], [88, 384, 4.2], [91, 368, 4.5], [95, 352, 9], [104, 344, 8], [128, 350, 4.5], [160, 366, 4.6], [196, 398, 5], [228, 428, 5.2], [256, 462, 6], [276, 500, 7]],
  },
  {
    name: 'Chocolate River', kind: 'chocolate', depth: 1.4,
    pts: [[236, -40, 8], [252, -52, 5], [282, -64, 4.6], [314, -54, 4.8], [344, -40, 5], [376, -46, 5], [410, -30, 5.4], [444, -14, 6], [482, 2, 7], [520, 8, 8]],
  },
];

// Ground colors per biome. a/b are blended with smooth noise; rock shows on steep slopes.
const PAL = {
  city:      { a: '#5cbf47', b: '#7fd255', rock: '#9a9183', path: '#c9b07a' },
  mountains: { a: '#5aa846', b: '#7cbf55', rock: '#8e98a3', path: '#d8d2c2', snow: '#e8f0fa' },
  candy:     { a: '#ff9dd2', b: '#8fe6c4', c: '#c2a6ff', rock: '#8a5233', path: '#f2cf98' },
  jungle:    { a: '#2a9a3c', b: '#4cbc45', rock: '#8c8a76', path: '#a8844f' },
  haunted:   { a: '#4b5c3b', b: '#3c4733', c: '#4d3d5c', rock: '#4c4a58', path: '#5e4a3c' },
};
const COL = {};
for (const [k, p] of Object.entries(PAL)) { COL[k] = {}; for (const [n, v] of Object.entries(p)) COL[k][n] = new THREE.Color(v); }
const SAND = new THREE.Color('#f2dfa4'), WET_SAND = new THREE.Color('#d6c08a');
const RIVER_BED = { water: new THREE.Color('#6f8f5a'), chocolate: new THREE.Color('#5a3018') };

export class Terrain {
  constructor(seed = 7) {
    this.noise = makeNoise2D(seed);
    this.noise2 = makeNoise2D(seed + 11);
    this.noise3 = makeNoise2D(seed + 23);
    this.res = RES;
    this.size = MAP_SIZE;
    this.cell = MAP_SIZE / RES;
    this.flatZones = []; // {x,z,r,h} areas flattened for POIs
    this.paths = [];     // dirt trails: { pts: [[x,z]...], w, box }
    this.rivers = [];    // prepared RIVERS with a surface height profile
    this.carve = false;
  }

  addFlatZone(x, z, r, h = null) { this.flatZones.push({ x, z, r, h }); }

  // A winding dirt trail between two points (drawn into the ground colors, keeps grass off)
  addPath(x0, z0, x1, z1, w = 2.4) {
    const pts = [];
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 14));
    const px = -(z1 - z0), pz = x1 - x0, pl = Math.hypot(px, pz) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wob = (i === 0 || i === n) ? 0 : this.noise3(x0 * 0.01 + t * 2.3, z0 * 0.01) * 10;
      pts.push([lerp(x0, x1, t) + (px / pl) * wob, lerp(z0, z1, t) + (pz / pl) * wob]);
    }
    this.paths.push({ pts, w, box: bbox(pts, w + 2) });
  }

  // Biome weights at a point (soft voronoi with warped coordinates)
  biomeWeights(x, z) {
    const wx = x + this.noise2(x * 0.004, z * 0.004) * 70;
    const wz = z + this.noise2(x * 0.004 + 50, z * 0.004 + 50) * 70;
    const w = {}; let total = 0;
    for (const k of BIOME_KEYS) {
      const [cx, cz] = BIOMES[k].center;
      let d = Math.hypot(wx - cx, wz - cz);
      if (k === 'city') d *= 1.25;
      const v = Math.exp(-d * d / (2 * 140 * 140)) + 1e-6;
      w[k] = Math.pow(v, 3);
      total += w[k];
    }
    for (const k of BIOME_KEYS) w[k] /= total;
    return w;
  }

  biomeAt(x, z) {
    const w = this.biomeWeights(x, z);
    let best = 'city', bw = -1;
    for (const k of BIOME_KEYS) if (w[k] > bw) { bw = w[k]; best = k; }
    return best;
  }

  islandMask(x, z) {
    const r = Math.hypot(x, z);
    const n = this.noise3(x * 0.006, z * 0.006) * 45 + this.noise3(x * 0.02, z * 0.02) * 12;
    return smoothstep(ISLAND_RADIUS + 25, ISLAND_RADIUS - 45, r + n);
  }

  rawHeight(x, z) {
    const w = this.biomeWeights(x, z);
    const n = this.noise;
    const hills = fbm(n, x * 0.006, z * 0.006, 4) * 0.5 + 0.5;
    const detail = fbm(n, x * 0.03, z * 0.03, 2);
    let h = 0;
    // City: flat plateau
    h += w.city * (6 + detail * 0.3);
    // Mountains: big ridged peaks centered on the biome, with stylized terraced cliffs
    if (w.mountains > 0.001) {
      const [cx, cz] = BIOMES.mountains.center;
      const d = Math.hypot(x - cx, z - cz);
      const ridge = 1 - Math.abs(fbm(this.noise2, x * 0.008, z * 0.008, 4));
      const peak = Math.max(0, 1 - d / 210);
      let m = 12 + ridge * ridge * 55 * (0.3 + peak) + peak * peak * 70 + hills * 10;
      // terraces: flat shelves joined by short steep rock steps
      const step = 9, f = m / step, fl = Math.floor(f), fr = f - fl;
      const terr = (fl + smoothstep(0.62, 0.92, fr)) * step;
      m = lerp(m, terr, 0.55 * smoothstep(20, 40, m));
      h += w.mountains * m;
    }
    h += w.candy * (7 + hills * 16 + Math.sin(x * 0.03) * Math.cos(z * 0.025) * 3);
    h += w.jungle * (5 + hills * 22 + detail * 2.5);
    h += w.haunted * (5 + hills * 9 + detail * 1.5);
    // plateaus (cliff edges wobble with noise so they look natural)
    for (const ms of MESAS) {
      const d = Math.hypot(x - ms.x, z - ms.z) + this.noise3(x * 0.08, z * 0.08) * 3;
      if (d < ms.r + 10) {
        ms.base ??= this.rawHeightNoMesa(ms.x, ms.z);
        const top = ms.base + ms.h + detail * 0.6;
        h = lerp(h, Math.max(h, top), smoothstep(ms.r + 7, ms.r - 1, d));
      }
    }
    return h;
  }

  rawHeightNoMesa(x, z) {
    const keep = MESAS.splice(0);
    const h = this.rawHeight(x, z);
    MESAS.push(...keep);
    return h;
  }

  computeHeight(x, z) {
    let h = this.rawHeight(x, z);
    for (const f of this.flatZones) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r * 1.6) {
        const target = f.h ?? f.hCache ?? (f.hCache = this.rawHeight(f.x, f.z));
        h = lerp(h, target, smoothstep(f.r * 1.6, f.r, d));
      }
    }
    if (this.carve) h = this.carveRivers(x, z, h);
    const m = this.islandMask(x, z);
    return lerp(-14, h, m);
  }

  // ---------- rivers ----------
  prepareRivers() {
    this.rivers = RIVERS.map((def) => {
      const pts = def.pts;
      const segs = [];
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az, aw] = pts[i], [bx, bz, bw] = pts[i + 1];
        const l = Math.hypot(bx - ax, bz - az);
        segs.push({ ax, az, bx, bz, aw, bw, l, t0: len });
        len += l;
      }
      const rv = { ...def, segs, len, box: bbox(pts, 60) };
      // surface profile: follow the ground along the middle, never flowing uphill
      const step = 1;
      rv.step = step;
      rv.surf = new Float32Array(Math.ceil(len / step) + 2);
      let run = Infinity;
      for (let i = 0; i < rv.surf.length; i++) {
        const p = this.riverPoint(rv, i * step);
        const g = this.computeHeight(p.x, p.z);
        run = Math.min(run, g - 0.35);
        rv.surf[i] = run;
      }
      return rv;
    });
  }

  riverPoint(rv, t) {
    for (const s of rv.segs) {
      if (t <= s.t0 + s.l || s === rv.segs[rv.segs.length - 1]) {
        const u = clamp((t - s.t0) / s.l, 0, 1);
        return { x: lerp(s.ax, s.bx, u), z: lerp(s.az, s.bz, u), w: lerp(s.aw, s.bw, u), dx: (s.bx - s.ax) / s.l, dz: (s.bz - s.az) / s.l };
      }
    }
    return null;
  }

  surfaceAt(rv, t) {
    const f = clamp(t / rv.step, 0, rv.surf.length - 1.001), i = Math.floor(f);
    return lerp(rv.surf[i], rv.surf[i + 1], f - i);
  }

  // nearest point on a river: { rv, d (meters from the middle), t (along), w (half width) }
  riverQuery(x, z) {
    let best = null;
    for (const rv of this.rivers) {
      const b = rv.box;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      for (const s of rv.segs) {
        const vx = s.bx - s.ax, vz = s.bz - s.az;
        const u = clamp(((x - s.ax) * vx + (z - s.az) * vz) / (s.l * s.l), 0, 1);
        const d = Math.hypot(x - (s.ax + vx * u), z - (s.az + vz * u));
        if (!best || d < best.d) best = { rv, d, t: s.t0 + u * s.l, w: lerp(s.aw, s.bw, u) };
      }
    }
    return best;
  }

  carveRivers(x, z, h) {
    const q = this.riverQuery(x, z);
    if (!q || q.d > q.w + 50) return h;
    const s = this.surfaceAt(q.rv, q.t);
    const k = q.d / q.w;
    if (k < 1) return s - q.rv.depth * (1 - k * k);
    // valley sides: where the hills are higher than the water, slope down to it instead of a sheer cut
    const out = q.d - q.w;
    let g = Math.min(h, s + 0.35 + out * 0.5 + out * out * 0.004);
    // banks: lift low ground so the water never spills
    g = lerp(Math.max(g, s + 0.35), g, smoothstep(0, q.w * 0.9, out));
    return g;
  }

  pathDist(x, z) {
    let best = Infinity;
    for (const p of this.paths) {
      const b = p.box;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        const u = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
        best = Math.min(best, Math.hypot(x - ax - vx * u, z - az - vz * u) - p.w);
      }
    }
    return best;
  }

  build(scene) {
    this.prepareRivers();
    this.carve = true;
    const n = this.res + 1;
    this.heights = new Float32Array(n * n);
    const half = this.size / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + i * this.cell, z = -half + j * this.cell;
      this.heights[j * n + i] = this.computeHeight(x, z);
    }
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res, this.res);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const i = Math.round((x + half) / this.cell), j = Math.round((z + half) / this.cell);
      pos.setY(v, this.heights[j * n + i]);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const H = this.heights;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      this.colorAt(x, y, z, nrm.getY(v), c);
      // cheap ambient occlusion: valleys and creases are a bit darker
      const i = Math.round((x + half) / this.cell), j = Math.round((z + half) / this.cell);
      let avg = 0, cnt = 0;
      for (const [di, dj] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
        const ii = clamp(i + di, 0, n - 1), jj = clamp(j + dj, 0, n - 1);
        avg += H[jj * n + ii]; cnt++;
      }
      const ao = 1 - clamp((avg / cnt - y) / 6, 0, 0.28);
      colors[v * 3] = c.r * ao; colors[v * 3 + 1] = c.g * ao; colors[v * 3 + 2] = c.b * ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // how 'candy' each vertex is, for the sprinkles painted on Candyland's ground
    const candy = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) candy[v] = pos.getY(v) > 2.5 ? smoothstep(0.35, 0.75, this.biomeWeights(pos.getX(v), pos.getZ(v)).candy) : 0;
    geo.setAttribute('aCandy', new THREE.BufferAttribute(candy, 1));

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTPos; varying vec3 vTNrm; attribute float aCandy; varying float vCandy;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTNrm = normal; vCandy = aCandy;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTPos; varying vec3 vTNrm; varying float vCandy;
          float tHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float tNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // fine painted bumps up close (dirt paths, snow, sand) so the ground isn't perfectly smooth plastic
            vec2 q = vTPos.xz * 0.7;
            float b0 = tNoise(q), bx = tNoise(q + vec2(0.2, 0.0)), bz = tNoise(q + vec2(0.0, 0.2));
            float bf = 1.0 - smoothstep(20.0, 60.0, length(vViewPosition));
            vec3 bump = vec3(-(bx - b0), 0.0, -(bz - b0)) * 1.4 * bf;
            normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float n1 = tNoise(vTPos.xz * 0.09);
            float n2 = tNoise(vTPos.xz * 0.43 + 7.0);
            float n3 = tNoise(vTPos.xz * 2.1 + 3.0);
            float steep = 1.0 - clamp(normalize(vTNrm).y, 0.0, 1.0);
            float flatK = 1.0 - smoothstep(0.22, 0.4, steep);
            diffuseColor.rgb *= 0.9 + n1 * 0.14 + (n2 - 0.5) * 0.1 + (n3 - 0.5) * 0.08 * flatK;
            // painted rock layers on cliffs
            float strata = sin(vTPos.y * 1.3 + n1 * 9.0 + n2 * 4.0) * 0.5 + 0.5;
            diffuseColor.rgb *= mix(1.0, 0.9 + 0.14 * strata * (0.5 + n2), smoothstep(0.35, 0.6, steep));
            // candyland sprinkles
            if (vCandy > 0.02) {
              vec2 cp = vTPos.xz * 1.4; vec2 ci = floor(cp); vec2 cf = fract(cp) - 0.5;
              float ang = tHash(ci) * 6.2831;
              vec2 d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * cf;
              float spr = step(abs(d.x), 0.2) * step(abs(d.y), 0.05) * step(0.5, tHash(ci + 7.0));
              float k = tHash(ci + 3.0);
              vec3 sc = k < 0.2 ? vec3(1.0, 0.25, 0.5) : k < 0.4 ? vec3(1.0, 0.85, 0.2) : k < 0.6 ? vec3(0.3, 0.6, 1.0) : k < 0.8 ? vec3(1.0) : vec3(0.35, 0.9, 0.45);
              diffuseColor.rgb = mix(diffuseColor.rgb, sc, spr * vCandy * flatK * smoothstep(70.0, 25.0, length(vViewPosition)));
            }
          }`);
    };
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);
    this.geometry = geo;
    return this.mesh;
  }

  colorAt(x, y, z, ny, out) {
    const w = this.biomeWeights(x, z);
    const n1 = this.noise(x * 0.02, z * 0.02) * 0.5 + 0.5;
    const n2 = this.noise2(x * 0.011, z * 0.011) * 0.5 + 0.5;
    const n3 = this.noise3(x * 0.05, z * 0.05) * 0.5 + 0.5;
    const rock = smoothstep(0.84, 0.64, ny);
    const tmp = this.tmpC ??= new THREE.Color();
    out.setRGB(0, 0, 0);
    const add = (col, wt) => { out.r += col.r * wt; out.g += col.g * wt; out.b += col.b * wt; };
    const soft = (a, b, t) => tmp.copy(a).lerp(b, smoothstep(0.3, 0.7, t));
    // city lawns
    add(soft(COL.city.a, COL.city.b, n1).lerp(COL.city.rock, rock), w.city);
    // mountains: meadow -> rock -> snow
    if (w.mountains > 0.001) {
      const snow = smoothstep(34, 50, y + n3 * 10) * smoothstep(0.45, 0.7, ny);
      soft(COL.mountains.a, COL.mountains.b, n1).lerp(COL.mountains.rock, clamp(rock + smoothstep(26, 44, y) * 0.55, 0, 1)).lerp(COL.mountains.snow, snow);
      add(tmp, w.mountains);
    }
    if (w.candy > 0.001) { // soft swirls of pink, mint and lavender; cookie cliffs
      const s = Math.sin((x - z) * 0.018 + n2 * 5) * 0.5 + 0.5;
      soft(COL.candy.a, COL.candy.b, s).lerp(COL.candy.c, smoothstep(0.6, 0.85, n1) * 0.7).lerp(COL.candy.rock, rock);
      add(tmp, w.candy);
    }
    add(soft(COL.jungle.a, COL.jungle.b, n1 * 0.7 + n3 * 0.3).lerp(COL.jungle.rock, rock), w.jungle);
    if (w.haunted > 0.001) {
      soft(COL.haunted.a, COL.haunted.b, n1).lerp(COL.haunted.c, smoothstep(0.55, 0.8, n2) * 0.6).lerp(COL.haunted.rock, rock);
      add(tmp, w.haunted);
    }
    // dirt trails
    if (this.paths.length) {
      const pd = this.pathDist(x, z);
      if (pd < 1.5) {
        tmp.setRGB(0, 0, 0);
        for (const k of BIOME_KEYS) { tmp.r += COL[k].path.r * w[k]; tmp.g += COL[k].path.g * w[k]; tmp.b += COL[k].path.b * w[k]; }
        out.lerp(tmp, smoothstep(1.5, -0.5, pd) * (1 - rock) * 0.85);
      }
    }
    // river beds
    if (this.rivers.length) {
      const q = this.riverQuery(x, z);
      if (q && q.d < q.w * 1.3) out.lerp(RIVER_BED[q.rv.kind], smoothstep(1.3, 0.8, q.d / q.w));
    }
    // beach sand near water
    const sand = smoothstep(3.4, 1.2, y + (n3 - 0.5) * 1.2);
    out.lerp(SAND, sand);
    if (y < -0.3) out.lerp(WET_SAND, 0.6);
    return out;
  }

  // bilinear height from the grid (matches the rendered mesh)
  heightAt(x, z) {
    const half = this.size / 2, n = this.res + 1;
    const fx = clamp((x + half) / this.cell, 0, this.res - 0.0001);
    const fz = clamp((z + half) / this.cell, 0, this.res - 0.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    // match PlaneGeometry triangulation: (a=i,j) (b=i,j+1) (c=i+1,j+1) (d=i+1,j); tris a-b-d and b-c-d
    const ha = h[j * n + i], hb = h[(j + 1) * n + i], hc = h[(j + 1) * n + i + 1], hd = h[j * n + i + 1];
    if (tx + tz <= 1) return ha + (hd - ha) * tx + (hb - ha) * tz;
    return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }

  // Water surface height of a river at this point, or null when not in a river.
  riverSurface(x, z) {
    const q = this.riverQuery(x, z);
    if (!q || q.d > q.w) return null;
    return this.surfaceAt(q.rv, q.t);
  }

  addCollider(physics) {
    const pos = this.geometry.attributes.position.array;
    const idx = this.geometry.index.array;
    const desc = physics.R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx));
    desc.setFriction(0.8);
    return physics.fixed(desc, { kind: 'terrain', material: 'ground' });
  }

  // Height grid as a float texture for GPU effects (grass, water foam)
  heightTexture() {
    if (this.hTex) return this.hTex;
    const n = this.res + 1;
    this.hTex = new THREE.DataTexture(this.heights, n, n, THREE.RedFormat, THREE.FloatType);
    this.hTex.minFilter = this.hTex.magFilter = THREE.NearestFilter;
    this.hTex.needsUpdate = true;
    return this.hTex;
  }
}

function bbox(pts, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

// ---------- GPU grass ----------
// One instanced blade mesh that follows the camera. Each blade sits on a fixed world lattice point, so it
// never swims as you move. Heights come from the terrain texture; color + density from a painted mask.
const GRASS_GLSL_COMMON = `
  uniform sampler2D uHeight; uniform float uHRes; uniform float uMap;
  float gHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float groundH(vec2 xz){
    vec2 f = (xz + uMap * 0.5) / uMap * uHRes;
    vec2 i = floor(f); vec2 t = f - i;
    ivec2 ii = ivec2(clamp(i, vec2(0.0), vec2(uHRes - 1.0)));
    float a = texelFetch(uHeight, ii, 0).r, b = texelFetch(uHeight, ii + ivec2(1, 0), 0).r;
    float c = texelFetch(uHeight, ii + ivec2(0, 1), 0).r, d = texelFetch(uHeight, ii + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }`;

export class GrassField {
  constructor(terrain, maskTex, { radius = 52, spacing = 0.36 } = {}) {
    this.n = Math.ceil((radius * 2) / spacing);
    const blade = new THREE.BufferGeometry();
    // 5-vertex tapered blade, x in [-0.5,0.5], y in [0,1]
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.32, 0.5, 0, 0.32, 0.5, 0, 0, 1, 0], 3));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    const geo = new THREE.InstancedBufferGeometry().copy(blade);
    geo.instanceCount = this.n * this.n;
    this.uniforms = {
      uHeight: { value: terrain.heightTexture() }, uHRes: { value: terrain.res }, uMap: { value: terrain.size },
      uMask: { value: maskTex }, uCam: { value: new THREE.Vector3() }, uTime: { value: 0 },
      uN: { value: this.n }, uSpacing: { value: spacing }, uRadius: { value: radius },
      uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
      uFogColor: { value: new THREE.Color() }, uFogNear: { value: 200 }, uFogFar: { value: 1400 },
      uShadowMap: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide,
      vertexShader: GRASS_GLSL_COMMON + `
        uniform sampler2D uMask; uniform vec3 uCam; uniform float uTime; uniform float uN; uniform float uSpacing; uniform float uRadius;
        uniform highp sampler2DShadow uShadowMap; uniform mat4 uShadowMatrix; uniform float uShadowOn;
        varying vec3 vCol; varying float vY; varying float vFog; varying float vFlower; varying float vShadow; varying float vVar;
        float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          float id = float(gl_InstanceID);
          float ix = mod(id, uN), iz = floor(id / uN);
          vec2 cell = floor(uCam.xz / uSpacing) - floor(uN * 0.5) + vec2(ix, iz);
          vec2 r2 = vec2(gHash(cell), gHash(cell + 17.3));
          vec2 wp = (cell + r2) * uSpacing;
          float dist = length(wp - uCam.xz);
          float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, dist);
          vec4 m = texture2D(uMask, (wp + uMap * 0.5) / uMap);
          float keep = step(gHash(cell * 1.37 + 3.1), m.a * (0.35 + 0.65 * fade));
          float hgt = (0.22 + 0.4 * m.a) * (0.7 + 0.6 * gHash(cell + 5.7)) * keep * smoothstep(0.0, 0.25, fade);
          if (hgt < 0.02) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float flower = step(0.976, gHash(cell + 9.1)) * step(0.45, m.a);
          float ang = gHash(cell + 2.2) * 6.2831;
          vec2 dir = vec2(cos(ang), sin(ang));
          float wdt = 0.09 * (0.8 + 0.4 * r2.x);
          float y = position.y;
          // flowers: a thin stem with a wide diamond-shaped blossom on top
          if (flower > 0.5) { wdt *= 1.5; hgt *= 1.15; }
          // wind: big slow gusts rolling across the island plus a quick flutter
          float gust = sin(dot(wp, vec2(0.07, 0.05)) - uTime * 1.6) * 0.5 + 0.5;
          float flut = sin(uTime * 4.0 + r2.x * 6.28 + wp.x * 0.6) * 0.15;
          vec2 bend = (vec2(0.75, 0.45) * (gust * 0.55 + 0.12) + dir.yx * flut) * y * y * hgt;
          vec3 p = vec3(wp.x + dir.x * position.x * wdt + bend.x, groundH(wp) - 0.04 + y * hgt * (1.0 - 0.25 * gust * y), wp.y + dir.y * position.x * wdt + bend.y);
          vCol = m.rgb; vY = y; vFlower = flower * (1.0 + 0.999 * gHash(cell + 4.4));
          // big soft colour patches across the meadow (some yellower, some bluer) + per-blade jitter
          vVar = gNoise(wp * 0.045) * 0.75 + gNoise(wp * 0.21 + 5.0) * 0.25 + (r2.y - 0.5) * 0.18;
          // sun shadows on the blades (sampled once per vertex from the sun's shadow map)
          vShadow = 1.0;
          if (uShadowOn > 0.5) {
            vec4 sc = uShadowMatrix * vec4(p, 1.0);
            sc.xyz /= sc.w;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0)
              vShadow = textureLod(uShadowMap, vec3(sc.xy, sc.z - 0.0008), 0.0);
          }
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
        varying vec3 vCol; varying float vY; varying float vFog; varying float vFlower; varying float vShadow; varying float vVar;
        void main(){
          vec3 base = vCol * mix(vec3(0.86, 0.97, 1.08), vec3(1.1, 1.02, 0.7), clamp(vVar, 0.0, 1.0));
          vec3 c = mix(base * 0.4, base * 1.08, smoothstep(0.0, 1.0, vY));
          // sun-kissed, slightly yellow tips
          c = mix(c, c * vec3(1.12, 1.08, 0.72) + vec3(0.03, 0.03, 0.0), smoothstep(0.55, 1.0, vY) * 0.5);
          if (vFlower > 0.5 && vY > 0.62) {
            float pick = fract(vFlower);
            c = pick < 0.33 ? vec3(1.0, 0.82, 0.15) : pick < 0.66 ? vec3(1.0, 0.35, 0.6) : vec3(0.95, 0.95, 1.0);
            c *= 0.75 + 0.35 * vY;
          }
          // blades in shadow take the cool sky colour, like the ground under them
          c *= mix(vec3(0.5, 0.58, 0.78), vec3(1.0), vShadow);
          c = mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vFog));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'grass';
    this.spacing = spacing;
    this.maxN = this.n;
    this.mesh.onBeforeRender = (r, scene, camera) => {
      const want = { potato: 0, low: 26, medium: 40 }[r.sportniteQuality] ?? radius;
      if (want !== this.uniforms.uRadius.value) this.setRadius(want);
      this.uniforms.uCam.value.copy(camera.position);
      // borrow the sun's shadow map so blades darken in the shade of trees, buildings and players
      const sun = this.sun ??= scene.children.find((o) => o.isDirectionalLight && o.castShadow);
      const sm = sun && sun.castShadow && r.shadowMap.enabled && sun.shadow.map && sun.shadow.map.depthTexture;
      this.uniforms.uShadowOn.value = sm ? 1 : 0;
      if (sm) { this.uniforms.uShadowMap.value = sm; this.uniforms.uShadowMatrix.value.copy(sun.shadow.matrix); }
      if (scene.fog) { this.uniforms.uFogColor.value.copy(scene.fog.color); this.uniforms.uFogNear.value = scene.fog.near; this.uniforms.uFogFar.value = scene.fog.far; }
    };
  }

  setRadius(radius) {
    this.n = Math.min(this.maxN, Math.ceil((radius * 2) / this.spacing));
    this.uniforms.uN.value = this.n;
    this.uniforms.uRadius.value = radius;
    this.mesh.geometry.instanceCount = this.n * this.n;
  }
}
