import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, Instancer } from '../engine/assets.js';
import { Rng } from '../engine/noise.js';
import { canvasTexture, clamp, smoothstep } from '../engine/utils.js';
import { Terrain, BIOMES, BIOME_KEYS, ISLAND_RADIUS, GrassField } from './terrain.js';
import { PROP_SETS, CITY_BUILDINGS, SKYSCRAPERS, SUBURB_HOUSES, allPropFiles } from './props.js';
import { HOUSE_STYLES, buildHouse } from './houses.js';
import { buildSportsVenues } from './venues.js';

// Named locations that show on the map. type decides what gets built there.
export const POIS = [
  { name: 'Downtown', x: 10, z: 0, r: 60, biome: 'city', type: 'downtown' },
  { name: 'Slam Dunk Square', x: -70, z: -70, r: 30, biome: 'city', type: 'basketball' },
  { name: 'Home Run Park', x: 85, z: 75, r: 50, biome: 'city', type: 'baseball' },
  { name: 'Goal Stadium', x: -85, z: 80, r: 50, biome: 'city', type: 'soccer' },
  { name: 'Suburbia', x: 110, z: -95, r: 45, biome: 'city', type: 'suburb' },
  { name: 'Ski Lodge', x: -110, z: -290, r: 35, biome: 'mountains', type: 'town', style: 'lodge', houses: 4 },
  { name: 'Frosty Summit', x: 20, z: -350, r: 22, biome: 'mountains', type: 'town', style: 'lodge', houses: 1 },
  { name: 'Sweet Tooth Town', x: 320, z: 40, r: 45, biome: 'candy', type: 'town', style: 'candy', houses: 6 },
  { name: 'Donut Hill', x: 380, z: -130, r: 25, biome: 'candy', type: 'landmark', landmark: 'donut' },
  { name: 'Temple Ruins', x: 40, z: 320, r: 40, biome: 'jungle', type: 'town', style: 'ruins', houses: 4 },
  { name: 'Palm Lagoon', x: 220, z: 330, r: 30, biome: 'jungle', type: 'town', style: 'hut', houses: 3 },
  { name: 'Creepy Crypts', x: -320, z: 40, r: 45, biome: 'haunted', type: 'town', style: 'spooky', houses: 4 },
  { name: 'Spooky Mansion', x: -300, z: -150, r: 25, biome: 'haunted', type: 'mansion' },
  { name: 'Gingerbread Grove', x: 260, z: 200, r: 25, biome: 'candy', type: 'town', style: 'candy', houses: 2 },
  { name: 'Lonely Farm', x: -220, z: 260, r: 25, biome: 'jungle', type: 'town', style: 'hut', houses: 2 },
];

const CHUNK = 200;          // instanced props are split into chunks so the camera (and the shadow camera) can cull them
const UP = new THREE.Vector3(0, 1, 0);
const FLAG_COLORS = { city: '#2f6bff', mountains: '#35c6ff', candy: '#ff4fb8', jungle: '#2fd15a', haunted: '#9b5cff' };

const _zero3 = new THREE.Vector3(0, 0, 0);

export class World {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = new Terrain(7);
    this.harvestables = [];
    this.lootSpots = [];   // { x, y, z, kind: 'floor'|'chest'|'ammo', poi }
    this.vendSpots = [];
    this.benchSpots = [];
    this.minigames = [];   // venue trigger zones
    this.blockers = [];    // { x, z, r } to avoid stacking props
    this.noGrass = [];     // { x, z, r } footprints of buildings and venues
    this.root = new THREE.Group();
    scene.add(this.root);
    this.lights = [];
    this.wind = { value: 0 };   // shared shader clock for swaying plants
    this.animated = [];         // { update(dt, time) } ambient effects
    this.camPos = new THREE.Vector3(0, 50, 0);
  }

  static assetList() {
    return [...allPropFiles(), 'props/Crate.glb', 'props/StreetLight.glb', 'props/ExplodingBarrel.glb', 'props/Sign.glb',
      'food/donut-sprinkles.glb', 'nature/k/statue_ring.glb', 'graveyard/crypt-large.glb', 'graveyard/iron-fence-border-gate.glb', 'graveyard/character-skeleton.glb'];
  }

  block(x, z, r) { this.blockers.push({ x, z, r }); }
  isBlocked(x, z, r) {
    for (const b of this.blockers) if (Math.hypot(b.x - x, b.z - z) < b.r + r) return true;
    return false;
  }

  async build(onStep = () => {}) {
    const t = this.terrain;
    for (const p of POIS) t.addFlatZone(p.x, p.z, p.r, p.biome === 'city' ? 6 : null);
    t.addFlatZone(0, 0, 182, 6);
    this.planPaths();
    onStep('Shaping the island');
    t.build(this.root);
    t.addCollider(this.physics);
    this.buildWater();
    this.buildRivers();
    this.buildBoundary();
    await assets.loadAll(World.assetList());
    this.fixMaterials();
    onStep('Building Sports City');
    this.buildCity();
    onStep('Building towns');
    for (const p of POIS) this.buildPOI(p);
    onStep('Planting trees');
    this.scatterProps();
    this.scatterLoot();
    for (const inst of this.instancers.values()) { inst.finalize(); for (const im of inst.meshes) im.frustumCulled = true; }
    onStep('Growing grass');
    this.buildGrass();
    this.buildAmbient();
    this.setupStaticCulling();
    // one physics step so raycasts (loot snapping, spawn checks) can see every collider right away
    this.physics.world.step();
  }

  // Kenney nature models come in as fully metallic, which renders black in the shade. They are painted plastic.
  // Their pastel teal/peach palette also clashes with our island, so repaint them in juicy cartoon colors.
  fixMaterials() {
    const repaint = {
      leafsGreen: '#45c44f', leafsDark: '#2e9a55', grass: '#5cbf47', dirt: '#a09a8e', woodBark: '#8a5a3a', woodBarkDark: '#6e4630',
      woodInner: '#e8c99a', stone: '#d6d0bb', stoneDark: '#aaa38c',
    };
    for (const f of World.assetList()) {
      const g = assets.get(f);
      if (!g) continue;
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.metalness > 0.5 && !m.metalnessMap) { m.metalness = 0; m.roughness = Math.max(0.6, m.roughness); }
          if (f.includes('nature/k/') && repaint[m.name] && !m.userData.repainted) { m.color.set(repaint[m.name]); m.userData.repainted = true; }
        }
      });
    }
  }

  // dirt trails from the city out to every named place, plus a few between neighbours
  planPaths() {
    const t = this.terrain;
    for (const p of POIS) {
      if (p.biome === 'city') continue;
      const d = Math.hypot(p.x, p.z), ux = p.x / d, uz = p.z / d;
      t.addPath(ux * 150, uz * 150, p.x - ux * p.r * 0.8, p.z - uz * p.r * 0.8);
    }
    const byName = Object.fromEntries(POIS.map((p) => [p.name, p]));
    for (const [a, b] of [['Ski Lodge', 'Frosty Summit'], ['Creepy Crypts', 'Spooky Mansion'], ['Sweet Tooth Town', 'Gingerbread Grove'],
      ['Temple Ruins', 'Palm Lagoon'], ['Lonely Farm', 'Temple Ruins'], ['Sweet Tooth Town', 'Donut Hill']]) {
      const A = byName[a], B = byName[b];
      const d = Math.hypot(B.x - A.x, B.z - A.z), ux = (B.x - A.x) / d, uz = (B.z - A.z) / d;
      t.addPath(A.x + ux * A.r * 0.8, A.z + uz * A.r * 0.8, B.x - ux * B.r * 0.8, B.z - uz * B.r * 0.8, 2);
    }
  }

  // ---------- water + edges ----------
  buildWater() {
    const t = this.terrain;
    const geo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = { uTime: { value: 0 }, uHeight: { value: t.heightTexture() }, uHRes: { value: t.res }, uMap: { value: t.size } };
    const mat = new THREE.MeshStandardMaterial({ color: 0x1fb6ff, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.9, envMapIntensity: 1.4 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.waterUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uTime; uniform sampler2D uHeight; uniform float uHRes; uniform float uMap; varying vec3 vWPos;
          float wHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float wNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x), mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x), f.y); }
          float wGround(vec2 xz){
            vec2 f = (xz + uMap * 0.5) / uMap * uHRes;
            if (f.x < 0.0 || f.y < 0.0 || f.x > uHRes - 1.0 || f.y > uHRes - 1.0) return -20.0;
            vec2 i = floor(f); vec2 t = f - i; ivec2 ii = ivec2(i);
            float a = texelFetch(uHeight, ii, 0).r, b = texelFetch(uHeight, ii + ivec2(1, 0), 0).r;
            float c = texelFetch(uHeight, ii + ivec2(0, 1), 0).r, d = texelFetch(uHeight, ii + ivec2(1, 1), 0).r;
            return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float depth = max(0.0, -wGround(vWPos.xz));
          float wn = wNoise(vWPos.xz * 0.12 + vec2(uTime * 0.25, uTime * 0.18)) * 0.6 + wNoise(vWPos.xz * 0.4 - vec2(uTime * 0.3, -uTime * 0.2)) * 0.4;
          vec3 shallow = vec3(0.18, 0.88, 0.86), mid = vec3(0.05, 0.62, 0.92), deep = vec3(0.02, 0.32, 0.72);
          vec3 wc = mix(shallow, mid, smoothstep(0.0, 4.0, depth));
          wc = mix(wc, deep, smoothstep(6.0, 16.0, depth));
          wc += (wn - 0.5) * 0.08;
          // shoreline foam: a solid lip plus bands that roll in toward the beach
          float band = sin(depth * 5.0 - uTime * 2.2 + wn * 4.0) * 0.5 + 0.5;
          float foam = smoothstep(0.35, 0.0, depth) + smoothstep(1.6, 0.2, depth) * smoothstep(0.62, 0.9, band) * 0.85;
          foam *= smoothstep(0.25, 0.55, wNoise(vWPos.xz * 0.9 + uTime * 0.4) + 0.25);
          diffuseColor.rgb = mix(wc, vec3(1.0), clamp(foam, 0.0, 1.0));
          diffuseColor.a = mix(0.55, 0.92, smoothstep(0.0, 2.5, depth)) + foam * 0.4;
          float sparkle = pow(max(0.0, sin(vWPos.x * 0.7 + uTime * 2.0 + wn * 3.0) * sin(vWPos.z * 0.6 - uTime * 1.7)), 30.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // rolling wave normals: the sky reflection and sun glints ripple instead of sitting flat
            vec2 wp = vWPos.xz; float e = 0.35;
            vec2 o1 = vec2(uTime * 0.35, uTime * 0.22), o2 = vec2(-uTime * 0.4, uTime * 0.3);
            float h0 = wNoise(wp * 0.18 + o1) * 0.6 + wNoise(wp * 0.55 + o2) * 0.4;
            float hx = wNoise((wp + vec2(e, 0.0)) * 0.18 + o1) * 0.6 + wNoise((wp + vec2(e, 0.0)) * 0.55 + o2) * 0.4;
            float hz = wNoise((wp + vec2(0.0, e)) * 0.18 + o1) * 0.6 + wNoise((wp + vec2(0.0, e)) * 0.55 + o2) * 0.4;
            float amp = 0.5 * (1.0 - smoothstep(80.0, 300.0, length(vViewPosition)));
            vec3 nW = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sparkle * 0.9;');
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0;
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    // remember where the camera is (grass, weather and culling follow it)
    this.water.onBeforeRender = (r, s, cam) => { this.camPos.copy(cam.position); };
    this.root.add(this.water);
  }

  // River ribbons that follow the carved channels: a creek with a waterfall, and the chocolate river
  buildRivers() {
    const t = this.terrain;
    this.riverUniforms = { uTime: this.waterUniforms.uTime };
    for (const rv of t.rivers) {
      const pos = [], uv = [], steep = [], idx = [];
      let prevS = null, rows = 0;
      for (let d = 0; d <= rv.len; d += 1) {
        const p = t.riverPoint(rv, d);
        const s = t.surfaceAt(rv, d) + 0.03;
        if (s < -0.6) break;
        const w = p.w * 1.12, nx = -p.dz, nz = p.dx;
        pos.push(p.x + nx * w, s, p.z + nz * w, p.x - nx * w, s, p.z - nz * w);
        uv.push(0, d, 1, d);
        const st = prevS === null ? 0 : clamp((prevS - s) / 1.2, 0, 1);
        steep.push(st, st);
        prevS = s;
        if (rows > 0) { const a = (rows - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        rows++;
      }
      // smooth the steepness so the white water fades in and out
      for (let k = 0; k < 3; k++) for (let i = 2; i < steep.length - 2; i += 2) { const v = (steep[i - 2] + steep[i] * 2 + steep[i + 2]) / 4; steep[i] = steep[i + 1] = Math.max(steep[i], v); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('aSteep', new THREE.Float32BufferAttribute(steep, 1));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const choc = rv.kind === 'chocolate';
      const mat = new THREE.MeshStandardMaterial({ color: choc ? 0x6b3518 : 0x2fc2e8, roughness: choc ? 0.18 : 0.08, transparent: !choc, opacity: 0.88, envMapIntensity: 1.2 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.riverUniforms.uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSteep; varying float vSteep; varying vec2 vRUv;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSteep = aSteep; vRUv = uv;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
            uniform float uTime; varying float vSteep; varying vec2 vRUv; float foamGlow = 0.0;
            float rHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
            float rNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rHash(i),rHash(i+vec2(1,0)),f.x), mix(rHash(i+vec2(0,1)),rHash(i+vec2(1,1)),f.x), f.y); }`)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(foamGlow);')
          .replace('#include <color_fragment>', `#include <color_fragment>
            {
              float speed = 1.4 + vSteep * 9.0;
              vec2 fuv = vec2(vRUv.x * 3.0, vRUv.y * 0.35 - uTime * speed * 0.35);
              float n = rNoise(fuv * vec2(2.0, 1.0)) * 0.6 + rNoise(fuv * vec2(5.0, 2.5) + 3.0) * 0.4;
              float edge = smoothstep(0.32, 0.0, min(vRUv.x, 1.0 - vRUv.x));
              ${choc
                ? `vec3 c = mix(vec3(0.06, 0.022, 0.008), vec3(0.15, 0.06, 0.022), n);
                   c += smoothstep(0.72, 0.88, n) * vec3(0.12, 0.06, 0.025);
                   c = mix(c, vec3(0.22, 0.1, 0.04), edge * 0.6);`
                : `vec3 c = mix(vec3(0.05, 0.55, 0.8), vec3(0.2, 0.85, 0.95), n);
                   // falling water: long vertical streaks rushing down
                   float fall = smoothstep(0.15, 0.7, vSteep);
                   float streak = rNoise(vec2(vRUv.x * 14.0, vRUv.y * 0.25 - uTime * 3.5)) * 0.6 + rNoise(vec2(vRUv.x * 30.0, vRUv.y * 0.5 - uTime * 5.0)) * 0.4;
                   float foam = clamp(edge * smoothstep(0.55, 0.8, n) + smoothstep(0.8, 0.95, n) * 0.5, 0.0, 1.0);
                   foam = mix(foam, 0.45 + 0.55 * smoothstep(0.3, 0.75, streak), fall);
                   c = mix(c, vec3(0.95, 0.99, 1.0), foam);
                   c = mix(c, c * vec3(0.8, 0.92, 1.0), fall * (1.0 - streak) * 0.6);
                   diffuseColor.a = mix(0.82, 1.0, foam);
                   foamGlow = foam * (0.04 + vSteep * 0.08);`}
              diffuseColor.rgb = c;
            }`);
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      // spray + mist where the water falls the farthest
      if (!choc) {
        let best = 0, bestD = 0;
        for (let d = 2; d < rv.len - 2; d += 1) { const drop = t.surfaceAt(rv, d - 2) - t.surfaceAt(rv, d + 2); if (drop > best) { best = drop; bestD = d; } }
        if (best > 4) {
          let foot = bestD;
          while (foot < rv.len - 1 && t.surfaceAt(rv, foot) - t.surfaceAt(rv, foot + 1) > 0.15) foot += 1;
          const p = t.riverPoint(rv, foot);
          this.addMist(new THREE.Vector3(p.x, t.surfaceAt(rv, foot), p.z), p.w);
          this.waterfall = { x: p.x, z: p.z, y: t.surfaceAt(rv, foot) };
        }
      }
    }
  }

  addMist(pos, w) {
    const N = 260;
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: this.waterUniforms.uTime, uOrigin: { value: pos }, uW: { value: w } },
      vertexShader: `uniform float uTime; uniform vec3 uOrigin; uniform float uW; attribute vec4 aSeed; varying float vA;
        void main(){
          float life = fract(uTime * (0.35 + aSeed.w * 0.3) + aSeed.x);
          vec3 p = uOrigin + vec3((aSeed.y - 0.5) * uW * 1.6, 0.2, (aSeed.z - 0.5) * uW * 1.2);
          p += vec3((aSeed.z - 0.5) * 4.0, 2.5 + aSeed.w * 4.0, (aSeed.y - 0.5) * 4.0) * life;
          p.y -= life * life * 2.0;
          vA = (1.0 - life) * smoothstep(0.0, 0.1, life);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (90.0 + aSeed.w * 120.0) * (0.4 + life) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), smoothstep(0.5, 0.0, d) * vA * 0.3); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.root.add(pts);
  }

  buildBoundary() {
    // invisible wall ring so nobody swims off the edge of the world
    const R = this.physics.R;
    const n = 48, rad = ISLAND_RADIUS + 70;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const seg = (2 * Math.PI * rad) / n;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      this.physics.fixed(R.ColliderDesc.cuboid(seg / 2 + 2, 200, 2), { kind: 'boundary' },
        Math.cos(a) * rad, 100, Math.sin(a) * rad, { x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  // ---------- instanced props ----------
  instancer(file, h, capacity, x = 0, z = 0, sway = 0) {
    this.instancers ??= new Map();
    const key = file + '@' + h + '#' + Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    if (!this.instancers.has(key)) {
      const inst = new Instancer(this.root, assets.model(file, { height: h }), capacity);
      if (sway) for (const im of inst.meshes) im.material = this.swayMaterial(im.material, sway);
      // tiny things don't need to cast shadows, and they disappear in the distance
      if (h < 1.6) for (const im of inst.meshes) im.castShadow = false;
      this.instancers.set(key, inst);
      let tris = 0;
      for (const im of inst.meshes) tris += (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3;
      const viewDist = h < 1.6 ? 150 : h < 4 ? 320 : tris > 2500 ? 520 : Infinity;
      this.chunks ??= [];
      this.chunks.push({ inst, h, cx: (Math.floor(x / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(z / CHUNK) + 0.5) * CHUNK, viewDist });
    }
    return this.instancers.get(key);
  }

  // Wind: bend instanced plants more the higher up the vertex is, each one on its own rhythm
  swayMaterial(mat, amount) {
    this.swayCache ??= new Map();
    const key = mat.uuid + amount;
    if (this.swayCache.has(key)) return this.swayCache.get(key);
    const m = mat.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = this.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            mat4 im = modelMatrix * instanceMatrix;
            vec3 wp0 = (im * vec4(transformed, 1.0)).xyz;
            float hgt = max(0.0, wp0.y - im[3].y);
            float ph = im[3].x * 0.13 + im[3].z * 0.17;
            float gust = sin(uWind * 0.7 + im[3].x * 0.02 + im[3].z * 0.015) * 0.5 + 0.7;
            float s = (sin(uWind * 1.5 + ph) + 0.35 * sin(uWind * 3.3 + ph * 1.7)) * gust * ${amount.toFixed(3)} * (hgt * 0.018 + hgt * hgt * 0.0022);
            vec3 off = vec3(s, 0.0, s * 0.55);
            off.y = -abs(s) * 0.15;
            transformed += inverse(mat3(im)) * off;
          }
          #endif`);
      // leaves glow a little when the sun shines through them, and their shaded side stays soft and green
      if (leaf) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 sunV = normalize((viewMatrix * vec4(0.4581, 0.8144, 0.3563, 0.0)).xyz);
            float back = pow(clamp(dot(-normalize(vViewPosition), sunV), 0.0, 1.0), 3.0);
            float wrap = clamp(dot(-normal, sunV) * 0.5 + 0.5, 0.0, 1.0);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.7) * (back * 0.4 + wrap * 0.05);
          }`);
      }
    };
    const leaf = /leaf|leaves|grass|flower/i.test(mat.name || '');
    m.customProgramCacheKey = () => 'sway' + amount + (leaf ? 'L' : '');
    this.swayCache.set(key, m);
    return m;
  }

  // convex hull points for a model (in the fitted model's space), cached per model+height
  hullPoints(file, h) {
    this.hulls ??= new Map();
    const key = file + '@' + h;
    if (this.hulls.has(key)) return this.hulls.get(key);
    const obj = assets.model(file, { height: h });
    obj.updateMatrixWorld(true);
    const pts = [];
    const v = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      const stride = Math.max(1, Math.floor(p.count / 400));
      for (let i = 0; i < p.count; i += stride) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
    });
    const arr = new Float32Array(pts);
    this.hulls.set(key, arr);
    return arr;
  }

  placeProp(def, x, z, rng, { scale = null, rotY = null, y = null, solidOnly = false, tilt = null } = {}) {
    const s = scale ?? rng.float(0.8, 1.2);
    const inst = this.instancer(def.file, def.h, (def.n || 20) + 30, x, z, def.sway || 0);
    const size = inst.size.clone().multiplyScalar(s);
    const t = this.terrain;
    // sit on the lowest ground under the footprint so nothing floats on slopes
    let gy = y;
    if (gy === null) {
      const r = def.col === 'trunk' ? 0.4 : clamp(Math.min(size.x, size.z) * 0.32, 0.2, 3);
      gy = t.heightAt(x, z);
      for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) gy = Math.min(gy, t.heightAt(x + ox, z + oz));
      gy -= 0.05 + (def.sink || 0) * size.y;
    }
    const q = new THREE.Quaternion().setFromAxisAngle(UP, rotY ?? rng.float(0, Math.PI * 2));
    // small rocks, logs and plants lean with the hillside; trees and buildings stay upright
    const lean = tilt ?? (def.col !== 'trunk' && size.y < 3.5 && !def.upright ? 0.7 : 0);
    if (lean > 0 && y === null) {
      const n = t.normalAt(x, z);
      const qt = new THREE.Quaternion().setFromUnitVectors(UP, n);
      q.premultiply(new THREE.Quaternion().slerp(qt, lean));
    }
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), q, new THREE.Vector3(s, s, s));
    const idx = inst.add(m);
    if (idx < 0) return null;
    let phys = null;
    const R = this.physics.R;
    const owner = def.mat ? { kind: 'harvest', mat: def.mat } : { kind: 'prop' };
    const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (def.col === 'trunk') {
      const r = clamp(Math.min(size.x, size.z) * 0.12, 0.25, 1.2);
      phys = this.physics.fixed(R.ColliderDesc.cylinder(size.y / 2, r), owner, x, gy + size.y / 2, z);
    } else if (def.col === 'box') {
      // convex hull of the real model, so you can't walk through corners or bump into air
      const base = this.hullPoints(def.file, def.h);
      const pts = new Float32Array(base.length);
      for (let i = 0; i < base.length; i++) pts[i] = base[i] * s;
      const desc = R.ColliderDesc.convexHull(pts);
      if (desc) phys = this.physics.fixed(desc, owner, x, gy, z, rot);
      else phys = this.physics.fixed(R.ColliderDesc.cuboid(size.x * 0.42, size.y / 2, size.z * 0.42), owner, x, gy + size.y / 2, z, rot);
    }
    if (def.glow) {
      // tiny emissive sphere for lanterns / pumpkins (bloom makes it glow)
      const glow = new THREE.Mesh(this.glowGeo ??= new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.glow).multiplyScalar(3) }));
      glow.scale.setScalar(s);
      glow.position.set(x, gy + size.y * 0.55, z);
      this.root.add(glow);
    }
    if (def.mat && phys) {
      const hv = { def, inst, idx, phys, hp: def.hp, maxHp: def.hp, x, y: gy, z, size, matrix: m, alive: true };
      owner.harvest = hv;
      this.harvestables.push(hv);
    }
    if (!solidOnly && def.col !== 'none') this.block(x, z, Math.max(size.x, size.z) * 0.4);
    return { idx, size };
  }

  scatterProps() {
    const rng = new Rng(1234);
    const t = this.terrain;
    for (const [biome, list] of Object.entries(PROP_SETS)) {
      for (const def of list) {
        let placed = 0, tries = 0;
        while (placed < def.n && tries < def.n * 25) {
          tries++;
          let x, z;
          if (biome === 'all') { const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * ISLAND_RADIUS; x = Math.cos(a) * r; z = Math.sin(a) * r; }
          else { const [cx, cz] = BIOMES[biome].center; const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 230; x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; }
          const b = t.biomeAt(x, z);
          if (biome !== 'all' && b !== biome) continue;
          if (def.notIn && def.notIn.includes(b)) continue;
          const y = t.heightAt(x, z);
          if (y < 2.4) continue;
          if (def.minY && y < def.minY) continue;
          if (b === 'city' && Math.hypot(x, z) < 175 && def.col !== 'none') { if (this.onRoad(x, z)) continue; }
          if (t.slopeAt(x, z) > (def.col === 'none' ? 0.3 : 0.22)) continue;
          // keep rivers and trails clear
          const rq = t.riverQuery(x, z);
          if (rq && rq.d < rq.w * 1.6 + 1) continue;
          if (def.col !== 'none' && t.pathDist(x, z) < 1.5) continue;
          const r = def.col === 'none' ? 0.3 : 2;
          if (def.col !== 'none' && this.isBlocked(x, z, r)) continue;
          if (def.col === 'none' && this.isBlockedHard(x, z)) continue;
          this.placeProp(def, x, z, rng);
          placed++;
        }
      }
    }
  }

  // inside a sports venue (court, stadium, ballpark) footprint?
  inVenue(x, z, pad = 0) {
    for (const p of POIS) if ((p.type === 'basketball' || p.type === 'soccer' || p.type === 'baseball') && Math.hypot(p.x - x, p.z - z) < p.r + pad) return true;
    return false;
  }

  isBlockedHard(x, z) {
    for (const p of POIS) if ((p.type === 'basketball' || p.type === 'soccer' || p.type === 'baseball') && Math.hypot(p.x - x, p.z - z) < p.r) return true;
    for (const b of this.noGrass) if (Math.hypot(b.x - x, b.z - z) < b.r) return true;
    return this.onRoad(x, z);
  }

  // ---------- city ----------
  onRoad(x, z) {
    if (Math.hypot(x, z) > 165) return false;
    const g = 48, w = 7;
    const mx = ((x % g) + g) % g, mz = ((z % g) + g) % g;
    return mx < w || mz < w;
  }

  buildCity() {
    const rng = new Rng(99);
    const Y = 6.02;
    // asphalt roads (grid) as one canvas-textured plane clipped to a disc
    const roadTex = canvasTexture(2048, 2048, (ctx, W, H) => {
      ctx.clearRect(0, 0, W, H);
      const px = W / 330, g = 48 * px, w = 7 * px;
      for (let k = -4; k <= 4; k++) {
        const o = W / 2 + k * g;
        for (const vertical of [true, false]) {
          ctx.fillStyle = '#3b3f47';
          if (vertical) ctx.fillRect(o, 0, w, H); else ctx.fillRect(0, o, W, w);
          ctx.fillStyle = '#9aa1ab';
          if (vertical) { ctx.fillRect(o - 3, 0, 3, H); ctx.fillRect(o + w, 0, 3, H); }
          else { ctx.fillRect(0, o - 3, W, 3); ctx.fillRect(0, o + w, W, 3); }
        }
      }
      // dashed center lines (skip the crossings), crosswalk stripes at every crossing
      for (let k = -4; k <= 4; k++) {
        const o = W / 2 + k * g;
        ctx.fillStyle = '#ffd34d';
        for (let s = 0; s < W; s += 32) {
          const crossing = ((s - W / 2) % g + g) % g;
          if (crossing < w + 10) continue;
          ctx.fillRect(o + w / 2 - 1.2, s, 2.4, 16); ctx.fillRect(s, o + w / 2 - 1.2, 16, 2.4);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let j = -4; j <= 4; j++) {
          const c = W / 2 + j * g;
          for (let s = 2; s < w - 2; s += 5) {
            ctx.fillRect(o + s, c - 9, 2.6, 7); ctx.fillRect(o + s, c + w + 2, 2.6, 7);
            ctx.fillRect(c - 9, o + s, 7, 2.6); ctx.fillRect(c + w + 2, o + s, 7, 2.6);
          }
        }
      }
      // asphalt grain
      for (let i = 0; i < 20000; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
      // fade out at the disc edge
      const grd = ctx.createRadialGradient(W / 2, H / 2, W * 0.46, W / 2, H / 2, W * 0.5);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    });
    const roads = new THREE.Mesh(new THREE.PlaneGeometry(330, 330), new THREE.MeshStandardMaterial({ map: roadTex, transparent: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
    roads.rotation.x = -Math.PI / 2;
    roads.position.set(0, Y, 0);
    roads.receiveShadow = true;
    this.root.add(roads);

    // city blocks between roads
    const g = 48;
    for (let bx = -4; bx < 4; bx++) for (let bz = -4; bz < 4; bz++) {
      const x0 = bx * g + 7, z0 = bz * g + 7, size = g - 7;
      const cx = x0 + size / 2, cz = z0 + size / 2;
      const d = Math.hypot(cx, cz);
      if (d > 150) continue;
      if (POIS.some((p) => p.biome === 'city' && p.type !== 'downtown' && Math.hypot(p.x - cx, p.z - cz) < p.r + 18)) continue;
      // each block: 2-4 buildings around its edges, with a little plaza
      const downtown = d < 70;
      const spots = [[x0 + 9, z0 + 9], [x0 + size - 9, z0 + 9], [x0 + 9, z0 + size - 9], [x0 + size - 9, z0 + size - 9]];
      for (const [x, z] of spots) {
        if (rng.chance(0.25)) {
          this.lootSpots.push({ x, y: Y + 0.2, z, kind: rng.chance(0.4) ? 'chest' : 'floor', poi: 'Downtown' });
          continue;
        }
        const file = downtown && rng.chance(0.7) ? rng.pick(SKYSCRAPERS) : rng.pick(CITY_BUILDINGS);
        const h = file.includes('sky') ? rng.float(32, 55) : rng.float(12, 20);
        // front door faces one of the two streets at this corner of the block
        const sx = x < cx ? -1 : 1, sz = z < cz ? -1 : 1;
        const rot = rng.chance(0.5) ? Math.atan2(sx, 0) : Math.atan2(0, sz);
        this.placeBuilding(file, x, z, h, rot, 14);
      }
      // loot in the middle of the block
      this.lootSpots.push({ x: cx, y: Y + 0.2, z: cz, kind: rng.chance(0.5) ? 'chest' : 'floor', poi: 'Downtown' });
      if (rng.chance(0.25)) this.vendSpots.push({ x: cx + 3, z: cz + 3 });
    }
    // street lights along the roads, arm over the street
    const light = { file: 'props/StreetLight.glb', h: 6, n: 60, mat: 'metal', hp: 150, col: 'trunk', upright: true };
    for (let k = -3; k <= 3; k++) for (let s = -3; s <= 3; s++) {
      const x = k * g + 8.5, z = s * g + 24;
      if (Math.hypot(x, z) < 150 && !this.isBlocked(x, z, 1) && !this.inVenue(x, z, 4)) this.placeProp(light, x, z, rng, { rotY: -Math.PI / 2, scale: 1, y: Y - 0.02 });
    }
    this.buildTrafficLights(Y);
  }

  // Merge every mesh of an object into one world-space triangle soup and give it an exact collider.
  addTrimesh(obj, owner) {
    obj.updateMatrixWorld(true);
    const verts = [], index = [];
    const v = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position, base = verts.length / 3;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); verts.push(v.x, v.y, v.z); }
      if (o.geometry.index) { const ia = o.geometry.index.array; for (let i = 0; i < ia.length; i++) index.push(base + ia[i]); }
      else for (let i = 0; i < p.count; i++) index.push(base + i);
    });
    if (!index.length) return null;
    return this.physics.fixed(this.physics.R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(index)), owner);
  }

  // highest real surface of an object straight down at x,z (roofs, ledges)
  surfaceOf(obj, x, z, top) {
    this.ray ??= new THREE.Raycaster();
    this.ray.set(new THREE.Vector3(x, top + 5, z), new THREE.Vector3(0, -1, 0));
    const hit = this.ray.intersectObject(obj, true)[0];
    return hit ? hit.point.y : null;
  }

  placeBuilding(file, x, z, h, rot, footprint) {
    const obj = assets.model(file, { height: h });
    const size = obj.userData.size;
    // keep footprint under the requested width
    const k = Math.min(1, footprint / Math.max(size.x, size.z));
    obj.scale.setScalar(k);
    const t = this.terrain;
    const sx = size.x * k, sz = size.z * k, sy = size.y * k;
    let y = t.heightAt(x, z);
    for (const [ox, oz] of [[sx / 2, sz / 2], [-sx / 2, sz / 2], [sx / 2, -sz / 2], [-sx / 2, -sz / 2]]) y = Math.min(y, t.heightAt(x + ox, z + oz));
    obj.position.set(x, y - 0.05, z);
    obj.rotation.y = rot;
    this.root.add(obj);
    this.addTrimesh(obj, { kind: 'building' });
    this.block(x, z, Math.max(sx, sz) * 0.6);
    this.noGrass.push({ x, z, r: Math.max(sx, sz) * 0.62 });
    // rooftop chest (reach it by building!) sits on the real roof
    if (Math.random() < 0.35) {
      const ry = this.surfaceOf(obj, x, z, y + sy);
      if (ry !== null && ry > y + 3) this.lootSpots.push({ x, y: ry + 0.1, z, kind: 'chest', poi: 'Rooftop' });
    }
    return obj;
  }

  // Blinking traffic lights at the downtown crossings (two directions take turns)
  buildTrafficLights(Y) {
    const g = 48, spots = [];
    for (let k = -3; k <= 3; k++) for (let s = -3; s <= 3; s++) {
      const x = k * g + 7.6, z = s * g + 7.6;
      if (Math.hypot(x, z) < 140 && !this.isBlocked(x, z, 0.6) && !this.inVenue(x, z, 4)) spots.push([x, z]);
    }
    const n = spots.length;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.5, metalness: 0.3 });
    const pole = new THREE.CylinderGeometry(0.1, 0.13, 4.6, 8).translate(0, 2.3, 0);
    const box = mergeGeometries([new THREE.BoxGeometry(0.42, 1.25, 0.42).translate(0, 4.1, 0), new THREE.BoxGeometry(0.15, 0.15, 0.6).translate(0, 4.6, 0)]);
    const poles = new THREE.InstancedMesh(mergeGeometries([pole, box]), poleMat, n);
    const lampGeo = new THREE.CircleGeometry(0.12, 12);
    const colors = [0xff2a2a, 0xffc21f, 0x2aff6a];
    this.trafficMats = [];
    const lamps = [];
    for (let gi = 0; gi < 2; gi++) for (let c = 0; c < 3; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: colors[c], emissiveIntensity: 0 });
      this.trafficMats.push(mat);
      lamps.push(new THREE.InstancedMesh(lampGeo, mat, n * 2));
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, Y, z); poles.setMatrixAt(i, m);
      this.physics.fixed(this.physics.R.ColliderDesc.cylinder(2.3, 0.15), { kind: 'prop' }, x, Y + 2.3, z);
      // group 0 faces north/south traffic, group 1 east/west
      for (let gi = 0; gi < 2; gi++) for (let f = 0; f < 2; f++) {
        const ang = gi * Math.PI / 2 + f * Math.PI;
        q.setFromAxisAngle(UP, ang);
        const fx = Math.sin(ang) * 0.22, fz = Math.cos(ang) * 0.22;
        for (let c = 0; c < 3; c++) { m.compose(new THREE.Vector3(x + fx, Y + 4.5 - c * 0.38, z + fz), q, new THREE.Vector3(1, 1, 1)); lamps[gi * 3 + c].setMatrixAt(i * 2 + f, m); }
      }
    });
    poles.castShadow = true;
    this.root.add(poles);
    for (const l of lamps) this.root.add(l);
  }

  // ---------- POIs ----------
  buildPOI(p) {
    const rng = new Rng(Math.floor(p.x * 31 + p.z * 17));
    if (p.type === 'basketball' || p.type === 'soccer' || p.type === 'baseball') {
      buildSportsVenues(this, p);
      this.block(p.x, p.z, p.r);
      this.noGrass.push({ x: p.x, z: p.z, r: p.r * 1.05 });
      return;
    }
    if (p.type === 'suburb') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, x = p.x + Math.cos(a) * 26, z = p.z + Math.sin(a) * 26;
        this.placeBuilding(rng.pick(SUBURB_HOUSES), x, z, 9, -a - Math.PI / 2, 13);
        this.lootSpots.push({ x: x - Math.cos(a) * 9, y: 6.2, z: z - Math.sin(a) * 9, kind: 'floor', poi: p.name });
      }
      this.lootSpots.push({ x: p.x, y: 6.2, z: p.z, kind: 'chest', poi: p.name });
      this.benchSpots.push({ x: p.x + 4, z: p.z });
      this.addFlag(p.x - 5, p.z - 5, FLAG_COLORS.city, p.name);
      return;
    }
    if (p.type === 'town') {
      const n = p.houses;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
        const r = n === 1 ? 0 : p.r * 0.55;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        // front door faces the middle of town (or the trail into town for a lone cabin)
        const face = n === 1 ? Math.atan2(-p.x, -p.z) : Math.atan2(p.x - x, p.z - z);
        const h = buildHouse(this, x, z, face, HOUSE_STYLES[p.style], rng, p.name);
        (this.houses ??= []).push({ x, z, rot: face, poi: p.name, ...h });
        this.block(x, z, h.radius);
        this.noGrass.push({ x, z, r: h.radius * 0.95 });
      }
      if (rng.chance(0.7)) this.vendSpots.push({ x: p.x + 3, z: p.z - 3 });
      this.benchSpots.push({ x: p.x - 3, z: p.z + 3 });
      this.lootSpots.push({ x: p.x, y: this.terrain.heightAt(p.x, p.z) + 0.2, z: p.z, kind: 'chest', poi: p.name });
      if (n > 1) this.addFlag(p.x + 4.5, p.z + 4.5, FLAG_COLORS[p.biome], p.name);
      return;
    }
    if (p.type === 'mansion') {
      const h = buildHouse(this, p.x, p.z, 0.3, { ...HOUSE_STYLES.spooky, w: 18, d: 14, floors: 3 }, rng, p.name);
      this.block(p.x, p.z, h.radius);
      this.noGrass.push({ x: p.x, z: p.z, r: h.radius * 0.95 });
      return;
    }
    if (p.type === 'landmark' && p.landmark === 'donut') {
      // a giant donut standing on its edge, resting on the hill with its hole facing the town trail
      const t = this.terrain;
      const D = 34;
      const d = assets.model('food/donut-sprinkles.glb', { size: D });
      const thick = d.userData.size.y;
      let y = Infinity;
      for (const o of [-6, 0, 6]) y = Math.min(y, t.heightAt(p.x + o, p.z));
      const yaw = Math.atan2(320 - p.x, 40 - p.z);
      const holder = new THREE.Group();
      holder.position.set(p.x, y + D / 2 - 0.6, p.z);
      holder.rotation.y = yaw;
      d.rotation.x = Math.PI / 2;
      d.position.z = -thick / 2;     // center the thickness on the stand
      holder.add(d);
      this.root.add(holder);
      this.addTrimesh(holder, { kind: 'building' });
      this.donut = holder;
      // a sprinkle-pink stand under the ring so it doesn't look like it is balancing
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 2.2, 20), new THREE.MeshStandardMaterial({ color: 0xffd1ec, roughness: 0.6 }));
      stand.position.set(p.x, y + 0.5, p.z);
      stand.castShadow = stand.receiveShadow = true;
      this.root.add(stand);
      this.physics.fixed(this.physics.R.ColliderDesc.cylinder(1.1, 5.2), { kind: 'building' }, p.x, y + 0.5, p.z);
      const top = this.surfaceOf(holder, p.x, p.z, y + D + 2) ?? y + D - 0.6;
      this.lootSpots.push({ x: p.x + Math.sin(yaw) * 9, y: t.heightAt(p.x + Math.sin(yaw) * 9, p.z + Math.cos(yaw) * 9) + 0.2, z: p.z + Math.cos(yaw) * 9, kind: 'chest', poi: p.name });
      this.lootSpots.push({ x: p.x, y: top + 0.1, z: p.z, kind: 'chest', poi: p.name + ' (top!)' });
      this.block(p.x, p.z, 18);
      this.noGrass.push({ x: p.x, z: p.z, r: 8 });
    }
  }

  scatterLoot() {
    // extra floor loot + ammo boxes across the whole island
    const rng = new Rng(777);
    const t = this.terrain;
    let made = 0;
    while (made < 140) {
      const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * (ISLAND_RADIUS - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = t.heightAt(x, z);
      if (y < 2 || this.isBlocked(x, z, 1.5) || t.slopeAt(x, z) > 0.3 || this.onRoad(x, z) || this.isBlockedHard(x, z)) continue;
      const rq = t.riverQuery(x, z);
      if (rq && rq.d < rq.w * 1.3) continue;
      this.lootSpots.push({ x, y: y + 0.2, z, kind: rng.chance(0.25) ? 'ammo' : rng.chance(0.15) ? 'chest' : 'floor', poi: 'wild' });
      made++;
    }
  }

  // ---------- grass ----------
  buildGrass() {
    const t = this.terrain;
    const N = 512, half = t.size / 2, cell = t.size / N;
    const data = new Uint8Array(N * N * 4);
    const c = new THREE.Color(), nrm = new THREE.Vector3();
    const DENS = { city: 0.62, mountains: 0.8, candy: 0, jungle: 1, haunted: 0.7 };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      const k = (j * N + i) * 4;
      if (Math.hypot(x, z) > ISLAND_RADIUS + 30) continue;
      const y = t.heightAt(x, z);
      if (y < 2.6) continue;
      const ny = t.normalAt(x, z, nrm).y;
      const w = t.biomeWeights(x, z);
      let dens = 0;
      for (const b of BIOME_KEYS) dens += DENS[b] * w[b];
      dens *= smoothstep(0.68, 0.82, ny) * smoothstep(2.6, 4, y);
      if (w.mountains > 0.2) dens *= 1 - smoothstep(34, 44, y);
      t.colorAt(x, y, z, ny, c);
      // blades are a touch brighter and more saturated than the ground they grow from
      c.offsetHSL(0, 0.08, 0.03);
      data[k] = clamp(c.r * 255, 0, 255); data[k + 1] = clamp(c.g * 255, 0, 255); data[k + 2] = clamp(c.b * 255, 0, 255);
      data[k + 3] = clamp(dens * 255, 0, 255);
    }
    const clear = (x, z, r, keep = 0) => {
      const i0 = Math.max(0, Math.floor((x - r + half) / cell)), i1 = Math.min(N - 1, Math.ceil((x + r + half) / cell));
      const j0 = Math.max(0, Math.floor((z - r + half) / cell)), j1 = Math.min(N - 1, Math.ceil((z + r + half) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * cell, pz = -half + (j + 0.5) * cell;
        if (Math.hypot(px - x, pz - z) < r) data[(j * N + i) * 4 + 3] *= keep;
      }
    };
    for (const b of this.noGrass) clear(b.x, b.z, b.r);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 4;
      if (!data[k + 3]) continue;
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      if (this.onRoad(x, z)) { data[k + 3] = 0; continue; }
      const pd = t.pathDist(x, z);
      if (pd < 1.2) { data[k + 3] *= clamp((pd + 0.3) / 1.5, 0, 1); continue; }
      const rq = t.riverQuery(x, z);
      if (rq && rq.d < rq.w * 1.25) data[k + 3] = 0;
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.grassMask = tex;
    this.grass = new GrassField(t, tex);
    this.root.add(this.grass.mesh);
  }

  // ---------- life: birds, butterflies, weather, fog, flags ----------
  buildAmbient() {
    this.buildBirds();
    this.buildButterflies();
    this.buildWeather();
    this.buildFogWisps();
  }

  buildBirds() {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, -1.4, 0, -0.2, 0, 0, -0.3, 0, 0, 0.5, 0, 0, -0.3, 1.4, 0, -0.2, 0, 0.05, 0.6, 0, 0.05, -0.5, 0, -0.15, 0], 3));
    wing.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = this.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
          transformed.y += sin(uWind * 11.0 + ph) * abs(position.x) * 0.7;
          #endif`);
    };
    const flocks = [];
    const n = 5, per = 8;
    const birds = new THREE.InstancedMesh(wing, mat, n * per);
    birds.frustumCulled = false;
    const centers = [[0, -330, 95], [330, 40, 70], [40, 330, 70], [-330, 40, 65], [0, 0, 110]];
    for (let f = 0; f < n; f++) flocks.push({ c: centers[f], r: 70 + f * 12, sp: 0.09 + f * 0.012, dir: f % 2 ? 1 : -1, offs: Array.from({ length: per }, (_, i) => [Math.sin(i * 2.1) * 6, Math.cos(i * 1.3) * 3, (i - per / 2) * 2.5]) });
    this.root.add(birds);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1.4, 1.4, 1.4), p = new THREE.Vector3();
    this.animated.push({
      update: (dt, time) => {
        let i = 0;
        for (const fl of flocks) {
          const a = time * fl.sp * fl.dir;
          const heading = a + (fl.dir > 0 ? 0 : Math.PI);
          q.setFromAxisAngle(UP, -heading);
          for (const o of fl.offs) {
            const r = fl.r + o[0];
            const aa = a + o[2] / fl.r;
            p.set(fl.c[0] + Math.cos(aa) * r, 0, fl.c[1] + Math.sin(aa) * r);
            // always fly well above the ground (mountain peaks are taller than the flock heights)
            p.y = Math.max(fl.c[2], this.terrain.heightAt(p.x, p.z) + 45) + o[1] + Math.sin(time * 0.7 + o[2]) * 1.5;
            // never let a bird sweep across the camera (a dark wing would cover the screen for a moment)
            const near = this.cam && p.distanceToSquared(this.cam.position) < 20 * 20;
            m.compose(p, q, near ? _zero3 : s);
            birds.setMatrixAt(i++, m);
          }
        }
        birds.instanceMatrix.needsUpdate = true;
      },
    });
  }

  buildButterflies() {
    const t = this.terrain, rng = new Rng(4242);
    const N = 260;
    const homes = [], cols = [];
    const palette = [[1, 0.55, 0.1], [0.3, 0.7, 1], [1, 0.95, 0.3], [1, 0.4, 0.8], [0.7, 0.45, 1]];
    let tries = 0;
    while (homes.length < N * 3 && tries++ < 20000) {
      const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * ISLAND_RADIUS;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const b = t.biomeAt(x, z);
      if (b === 'haunted' || b === 'mountains' || this.onRoad(x, z)) continue;
      const y = t.heightAt(x, z);
      if (y < 3) continue;
      // little groups of 3-5
      const k = rng.int(3, 5);
      for (let i = 0; i < k && homes.length < N * 3; i++) {
        const hx = x + rng.float(-3, 3), hz = z + rng.float(-3, 3);
        homes.push(hx, t.heightAt(hx, hz) + rng.float(0.6, 1.6), hz);
        const c = rng.pick(palette); cols.push(...c);
      }
    }
    const count = homes.length / 3;
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.22, 0, 0.16, -0.2, 0, -0.14, 0, 0, -0.08, 0.2, 0, -0.14, 0.22, 0, 0.16], 3));
    wing.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
    const geo = new THREE.InstancedBufferGeometry().copy(wing);
    geo.instanceCount = count;
    geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(homes), 3));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(cols), 3));
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: this.wind },
      vertexShader: `uniform float uTime; attribute vec3 aHome; attribute vec3 aCol; varying vec3 vCol; varying float vFog;
        void main(){
          float s = aHome.x * 0.37 + aHome.z * 0.73;
          float t = uTime * 0.6 + s;
          vec3 p = aHome + vec3(sin(t) * 2.2 + sin(t * 2.3) * 0.6, sin(t * 3.1) * 0.35 + sin(t * 1.3) * 0.3, cos(t * 0.8) * 2.2);
          float flap = sin(uTime * 22.0 + s * 10.0);
          vec3 lp = position;
          lp.y += abs(lp.x) * flap * 1.4; lp.x *= 0.55 + 0.45 * abs(flap);
          float yaw = t + 1.57;
          lp.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * lp.xz;
          vCol = aCol;
          vec4 mv = viewMatrix * vec4(p + lp * 1.3, 1.0);
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vCol; varying float vFog; void main(){ if (vFog > 140.0) discard; gl_FragColor = vec4(vCol, 1.0); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  // Particles around the camera: snow in the mountains, sparkles in candyland, pollen in the jungle/city, ghostly motes in the haunted forest
  buildWeather() {
    const N = 2400;
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.weatherU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMix: { value: new THREE.Vector4() } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.weatherU,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec4 uMix; attribute vec4 aSeed; varying vec3 vCol; varying float vA;
        void main(){
          // 4 kinds share the cloud: x=snow, y=candy sparkles, z=pollen, w=haunted motes
          float kind = floor(aSeed.w * 4.0);
          float amt = kind < 0.5 ? uMix.x : kind < 1.5 ? uMix.y : kind < 2.5 ? uMix.z : uMix.w;
          float on = step(fract(aSeed.w * 4.0), amt);
          vec3 box = vec3(70.0, 36.0, 70.0);
          vec3 p = aSeed.xyz * box;
          float t = uTime;
          if (kind < 0.5) { p.y -= t * (2.0 + aSeed.x * 1.5); p.x += sin(t * 0.8 + aSeed.y * 9.0) * 1.5 + t * 1.2; vCol = vec3(1.0); }
          else if (kind < 1.5) { p += vec3(sin(t * 0.3 + aSeed.z * 6.0), sin(t * 0.5 + aSeed.x * 6.0) * 0.6, cos(t * 0.4 + aSeed.y * 6.0)) * 2.0; vCol = mix(vec3(1.0, 0.5, 0.9), vec3(0.5, 1.0, 0.95), step(0.5, aSeed.z)); }
          else if (kind < 2.5) { p += vec3(t * 0.6, sin(t * 0.7 + aSeed.z * 6.0) * 0.8, sin(t * 0.4 + aSeed.y * 5.0) * 1.5); vCol = vec3(1.0, 0.95, 0.6); }
          else { p += vec3(sin(t * 0.2 + aSeed.z * 6.0) * 4.0, sin(t * 0.3 + aSeed.x * 5.0) * 1.0, t * 0.5); vCol = vec3(0.75, 0.55, 1.0); }
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float tw = kind > 0.5 && kind < 1.5 ? pow(abs(sin(t * 3.0 + aSeed.x * 20.0)), 6.0) : 1.0;
          vA = on * tw * smoothstep(34.0, 10.0, -mv.z) * smoothstep(1.5, 5.0, -mv.z) * (kind < 0.5 ? 0.55 : kind < 1.5 ? 0.9 : kind < 2.5 ? 0.3 : 0.35);
          float size = kind < 0.5 ? 0.16 : kind < 1.5 ? 0.22 : kind < 2.5 ? 0.08 : 0.35;
          gl_PointSize = min(on * size * 900.0 / max(1.0, -mv.z), 40.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vCol; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (vA < 0.01) discard; gl_FragColor = vec4(vCol * vA * smoothstep(0.5, 0.1, d), 1.0); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.root.add(pts);
    this.animated.push({
      update: (dt, time) => {
        const c = this.camPos;
        const w = this.terrain.biomeWeights(c.x, c.z);
        const y = this.terrain.heightAt(c.x, c.z);
        const near = smoothstep(120, 40, c.y - y);   // only near the ground, not while skydiving
        this.weatherU.uTime.value = time;
        this.weatherU.uCam.value.copy(c);
        const target = new THREE.Vector4(smoothstep(0.35, 0.8, w.mountains) * near, smoothstep(0.3, 0.8, w.candy) * near, (w.jungle * 0.8 + w.city * 0.3) * near, smoothstep(0.3, 0.8, w.haunted) * near);
        this.weatherU.uMix.value.lerp(target, Math.min(1, dt * 2));
      },
    });
  }

  // Big soft fog puffs that drift low through the haunted forest
  buildFogWisps() {
    const t = this.terrain, rng = new Rng(666);
    const pts = [];
    let tries = 0;
    while (pts.length < 140 * 4 && tries++ < 5000) {
      const [cx, cz] = BIOMES.haunted.center;
      const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 200;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (t.biomeAt(x, z) !== 'haunted') continue;
      const y = t.heightAt(x, z);
      if (y < 2) continue;
      pts.push(x, y + rng.float(0.8, 2.5), z, rng.float(9, 18));
    }
    const count = pts.length / 4;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry().copy(plane);
    geo.instanceCount = count;
    geo.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(pts), 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: this.wind },
      vertexShader: `uniform float uTime; attribute vec4 aP; varying vec2 vUv; varying float vA;
        void main(){
          vec3 c = aP.xyz + vec3(sin(uTime * 0.07 + aP.x) * 6.0, sin(uTime * 0.3 + aP.z) * 0.4, cos(uTime * 0.06 + aP.z) * 6.0);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * vec2(aP.w, aP.w * 0.45);
          vUv = uv;
          vA = smoothstep(4.0, 14.0, -mv.z) * (1.0 - smoothstep(180.0, 320.0, -mv.z)) * (0.55 + 0.45 * sin(uTime * 0.25 + aP.x));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec2 vUv; varying float vA;
        void main(){ vec2 d = vUv - 0.5; float a = smoothstep(0.5, 0.0, length(d)) ; gl_FragColor = vec4(vec3(0.72, 0.64, 0.88), a * a * vA * 0.42); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.root.add(mesh);
  }

  // A waving banner on a pole marks each town
  addFlag(x, z, color, label) {
    const t = this.terrain;
    const y = t.heightAt(x, z) - 0.1;
    const poleH = 9;
    const pole = new THREE.Mesh(this.flagPoleGeo ??= new THREE.CylinderGeometry(0.09, 0.12, poleH, 8).translate(0, poleH / 2, 0), this.flagPoleMat ??= new THREE.MeshStandardMaterial({ color: 0xe8e8ee, metalness: 0.5, roughness: 0.35 }));
    pole.position.set(x, y, z);
    pole.castShadow = true;
    this.root.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(x, y + poleH + 0.1, z);
    this.root.add(knob);
    this.physics.fixed(this.physics.R.ColliderDesc.cylinder(poleH / 2, 0.14), { kind: 'prop' }, x, y + poleH / 2, z);
    const tex = canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(0, h * 0.72, w, h * 0.1);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SPORTNITE', w / 2, h * 0.36);
      ctx.font = 'bold 18px sans-serif'; ctx.fillText(label.toUpperCase(), w / 2, h * 0.58);
    });
    const geo = new THREE.PlaneGeometry(3.6, 2.2, 16, 6).translate(1.8, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = this.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = position.x / 3.6;
          transformed.z += sin(position.x * 1.9 - uWind * 6.0) * 0.32 * k + sin(position.y * 2.0 - uWind * 4.0) * 0.08 * k;
          transformed.y -= k * k * 0.25;`);
    };
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(x + 0.1, y + poleH - 1.3, z);
    flag.rotation.y = Math.random() * Math.PI * 2;
    flag.castShadow = true;
    this.root.add(flag);
  }

  // ---------- harvesting ----------
  damageHarvestable(hv, amount) {
    if (!hv.alive) return 0;
    hv.hp -= amount;
    // wobble feedback
    hv.wobble = 0.25;
    if (hv.hp <= 0) {
      hv.alive = false;
      hv.dying = 0.45; // shrink + topple away instead of vanishing
      hv.fallDir = Math.random() * Math.PI * 2;
      this.physics.remove(hv.phys);
      return -1;
    }
    return 1;
  }

  update(dt, time) {
    if (this.waterUniforms) this.waterUniforms.uTime.value = time;
    this.wind.value = time;
    if (this.grass) this.grass.uniforms.uTime.value = time;
    for (const hv of this.harvestables) {
      if (hv.dying > 0) {
        hv.dying = Math.max(0, hv.dying - dt);
        const k = 1 - hv.dying / 0.45;
        const tilt = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(hv.fallDir), 0, Math.sin(hv.fallDir)), k * k * 1.2);
        const sc = new THREE.Matrix4().makeScale(1 - k * 0.9, 1 - k * 0.9, 1 - k * 0.9);
        const pos = new THREE.Vector3().setFromMatrixPosition(hv.matrix);
        const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y - k * 0.4, pos.z).multiply(tilt).multiply(sc)
          .multiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z)).multiply(hv.matrix);
        hv.inst.setMatrix(hv.idx, m);
        if (hv.dying === 0) hv.inst.hide(hv.idx);
        continue;
      }
      if (!hv.wobble || !hv.alive) continue;
      hv.wobble = Math.max(0, hv.wobble - dt);
      const k = hv.wobble * 0.25;
      const m = hv.matrix.clone().multiply(new THREE.Matrix4().makeScale(1 + Math.sin(hv.wobble * 60) * k, 1 - k * 0.5, 1 + Math.cos(hv.wobble * 55) * k));
      hv.inst.setMatrix(hv.idx, m);
      if (hv.wobble === 0) hv.inst.setMatrix(hv.idx, hv.matrix);
    }
    // traffic lights: 9 second cycle, the two directions take turns
    if (this.trafficMats) {
      const ph = time % 9;
      for (let gi = 0; gi < 2; gi++) {
        const p = (ph + gi * 4.5) % 9;
        const state = p < 3.6 ? 2 : p < 4.5 ? 1 : 0;
        for (let c = 0; c < 3; c++) this.trafficMats[gi * 3 + c].emissiveIntensity = c === state ? 3 : 0.05;
      }
    }
    for (const a of this.animated) a.update(dt, time);
    this.updateStaticCulling(dt);
    // mid-size props (bushes, rocks, crates) only cast shadows on High graphics
    if (this.chunks && this.propShadows !== this.propShadowsApplied) {
      this.propShadowsApplied = this.propShadows;
      for (const ch of this.chunks) if (ch.h >= 1.6 && ch.h < 4) for (const im of ch.inst.meshes) im.castShadow = this.propShadows !== false;
    }
    // distance culling for prop chunks (a few times a second is plenty)
    this.cullT = (this.cullT ?? 0) - dt;
    if (this.chunks && this.cullT <= 0) {
      this.cullT = 0.2;
      const c = this.camPos;
      for (const ch of this.chunks) {
        const d = Math.hypot(ch.cx - c.x, ch.cz - c.z) - CHUNK * 0.71;
        const vis = d < Math.min(ch.viewDist, 900) * (this.drawScale ?? 1) + Math.max(0, c.y - 40) * 0.5;
        if (ch.vis !== vis) { ch.vis = vis; for (const im of ch.inst.meshes) im.visible = vis; }
      }
    }
  }

  groundY(x, z) { return this.terrain.heightAt(x, z); }

  // Draw distance for everything static that isn't an instanced prop (buildings, houses, venues, fences, signs...).
  // Bigger things stay visible farther away; lower graphics levels shrink every distance (drawScale).
  // Uses layers instead of .visible so it never fights other code that shows/hides things.
  setupStaticCulling() {
    const skip = new Set();
    for (const inst of this.instancers.values()) for (const im of inst.meshes) skip.add(im);
    const box = new THREE.Box3(), sphere = new THREE.Sphere();
    this.statics = [];
    const consider = (o) => {
      if (skip.has(o) || o.isLight || o.isPoints || o.isLine || o.isSprite || o === this.terrain.mesh || o.name === 'grass' || o.name === 'terrain') return;
      let meshes = 0; o.traverse((m) => { if (m.isMesh) meshes++; });
      if (!meshes) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      box.getBoundingSphere(sphere);
      if (sphere.radius > 300) return; // sky, water, the whole island: always drawn
      this.statics.push({ obj: o, x: sphere.center.x, z: sphere.center.z, r: sphere.radius, dist: 140 + sphere.radius * 45, vis: true });
    };
    for (const o of [...this.scene.children]) if (o !== this.root) consider(o);
    for (const o of [...this.root.children]) consider(o);
    this.staticT = 0;
  }

  updateStaticCulling(dt) {
    if (!this.statics) return;
    this.staticT -= dt;
    if (this.staticT > 0) return;
    this.staticT = 0.25;
    const c = this.camPos, k = this.drawScale ?? 1, lift = Math.max(0, c.y - 40) * 0.5;
    for (const st of this.statics) {
      const d = Math.hypot(st.x - c.x, st.z - c.z) - st.r;
      const vis = d < st.dist * k + lift;
      if (vis === st.vis) continue;
      st.vis = vis;
      st.obj.traverse((m) => { if (vis) m.layers.enable(0); else m.layers.disable(0); });
    }
  }
}
