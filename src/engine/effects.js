import * as THREE from 'three';
import { rand } from './utils.js';

// All combat/skill VFX. Everything is pooled: two GPU particle layers (soft + additive glow),
// instanced debris/shell/shard chunks, and small pools of tracer, flash, ring, decal and light meshes.
const _c0 = new THREE.Color(), _c1 = new THREE.Color();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {};
function textures() {
  if (TEX.star) return TEX;
  TEX.star = canvasTex(128, (g, s) => { // muzzle flash star
    g.translate(s / 2, s / 2); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
      const gr = g.createLinearGradient(0, 0, s / 2, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -5); g.lineTo(s / 2 * (0.6 + Math.random() * 0.4), 0); g.lineTo(0, 5); g.fill();
    }
    const r = g.createRadialGradient(0, 0, 0, 0, 0, s / 4); r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.4, 'rgba(255,200,90,0.8)'); r.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = r; g.beginPath(); g.arc(0, 0, s / 4, 0, Math.PI * 2); g.fill();
  });
  TEX.flame = canvasTex(64, (g, s) => { // side flash: teardrop pointing +y
    const r = g.createRadialGradient(s / 2, s * 0.85, 1, s / 2, s * 0.6, s / 2); r.addColorStop(0, 'rgba(255,250,220,1)'); r.addColorStop(0.35, 'rgba(255,190,80,0.9)'); r.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = r; g.beginPath(); g.moveTo(s / 2, 0); g.quadraticCurveTo(s, s * 0.8, s / 2, s); g.quadraticCurveTo(0, s * 0.8, s / 2, 0); g.fill();
  });
  TEX.ring = canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.75, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const blob = (g, s, n, col) => {
    g.fillStyle = col; g.beginPath(); g.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = s * (0.18 + Math.random() * 0.24), r = s * (0.03 + Math.random() * 0.09); g.beginPath(); g.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, r, 0, Math.PI * 2); g.fill(); }
  };
  TEX.splat = canvasTex(128, (g, s) => blob(g, s, 14, '#ffffff'));
  TEX.hole = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(10,8,6,1)'); r.addColorStop(0.25, 'rgba(25,20,15,0.95)'); r.addColorStop(0.45, 'rgba(60,50,40,0.45)'); r.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  TEX.scorch = canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(15,10,8,0.95)'); r.addColorStop(0.55, 'rgba(30,22,16,0.7)'); r.addColorStop(1, 'rgba(30,22,16,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, d = s * (0.32 + Math.random() * 0.2); g.beginPath(); g.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * 0.06, 0, Math.PI * 2); g.fill(); }
  });
  return TEX;
}

// ---------- GPU particle layer ----------
class Layer {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.additive = additive;
    const f = (k) => new Float32Array(max * k);
    this.pos = f(3); this.vel = f(3); this.c0 = f(3); this.c1 = f(3); this.col = f(3);
    this.size = f(1); this.alpha = f(1); this.life = f(1); this.maxLife = f(1); this.grav = f(1); this.drag = f(1); this.grow = f(1);
    const geo = new THREE.BufferGeometry();
    const attr = (name, arr, k) => geo.setAttribute(name, new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage));
    attr('position', this.pos, 3); attr('color', this.col, 3); attr('size', this.size, 1); attr('alpha', this.alpha, 1);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: innerHeight / 2 } },
      vertexShader: `
        attribute float size; attribute float alpha; varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main(){ vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = min(size * uScale / -mv.z, 360.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive ? `
        varying vec3 vColor; varying float vAlpha;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
          float a = pow(1.0 - r, 1.7) * vAlpha; gl_FragColor = vec4(vColor * (1.0 + pow(1.0 - r, 6.0) * 1.5) * a, a); }` : `
        varying vec3 vColor; varying float vAlpha;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
          float a = smoothstep(1.0, 0.25, r) * vAlpha; gl_FragColor = vec4(vColor * (0.85 + 0.15 * (1.0 - r)), a); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, c0, c1, size, life, grav, drag, grow) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max), i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.col[i3] = c0.r; this.col[i3 + 1] = c0.g; this.col[i3 + 2] = c0.b;
    this.size[i] = size; this.alpha[i] = 1; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    let w = 0;
    const P = this.pos, V = this.vel, C0 = this.c0, C1 = this.c1, C = this.col;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3, w3 = w * 3;
      const d = Math.exp(-this.drag[i] * dt);
      const vx = V[i3] * d, vy = V[i3 + 1] * d - this.grav[i] * dt, vz = V[i3 + 2] * d;
      P[w3] = P[i3] + vx * dt; P[w3 + 1] = P[i3 + 1] + vy * dt; P[w3 + 2] = P[i3 + 2] + vz * dt;
      V[w3] = vx; V[w3 + 1] = vy; V[w3 + 2] = vz;
      const a = life / this.maxLife[i];
      for (let k = 0; k < 3; k++) { const s0 = C0[i3 + k], s1 = C1[i3 + k]; C0[w3 + k] = s0; C1[w3 + k] = s1; C[w3 + k] = s1 + (s0 - s1) * a; }
      this.size[w] = this.size[i] + this.grow[i] * dt;
      this.maxLife[w] = this.maxLife[i]; this.grav[w] = this.grav[i]; this.drag[w] = this.drag[i]; this.grow[w] = this.grow[i];
      this.life[w] = life;
      this.alpha[w] = this.additive ? Math.min(1, a * 1.6) : Math.min(1, a * 2.2, (1 - a) * 12 + 0.25);
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    if (w) for (const name of ['position', 'color', 'size', 'alpha']) { const at = this.geo.attributes[name]; at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, w * at.itemSize); }
  }
}

// ---------- instanced physical chunks (debris, shells, shards, digital cubes) ----------
class Chunks {
  constructor(scene, geo, mat, max) {
    this.max = max; this.n = 0;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    const f = (k) => new Float32Array(max * k);
    this.p = f(3); this.v = f(3); this.r = f(3); this.av = f(3); this.sc = f(3); this.col = f(3);
    this.life = f(1); this.maxLife = f(1); this.grav = f(1); this.bounce = f(1); this.floor = f(1); this.drag = f(1);
  }
  spawn(x, y, z, vx, vy, vz, color, sx, sy, sz, life, { grav = 18, bounce = 0.35, floor = NaN, spin = 12, drag = 0.2 } = {}) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max), i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.r[i3] = rand(0, 6); this.r[i3 + 1] = rand(0, 6); this.r[i3 + 2] = rand(0, 6);
    this.av[i3] = rand(-spin, spin); this.av[i3 + 1] = rand(-spin, spin); this.av[i3 + 2] = rand(-spin, spin);
    this.sc[i3] = sx; this.sc[i3 + 1] = sy; this.sc[i3 + 2] = sz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.bounce[i] = bounce; this.floor[i] = floor; this.drag[i] = drag;
  }
  update(dt, groundY) {
    let w = 0;
    const P = this.p, V = this.v, R = this.r, AV = this.av, S = this.sc, C = this.col;
    const im = this.mesh.instanceMatrix.array, ic = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3, w3 = w * 3;
      const d = Math.exp(-this.drag[i] * dt);
      let vx = V[i3] * d, vy = V[i3 + 1] * d - this.grav[i] * dt, vz = V[i3 + 2] * d;
      let x = P[i3] + vx * dt, y = P[i3 + 1] + vy * dt, z = P[i3 + 2] + vz * dt;
      let ax = AV[i3], ay = AV[i3 + 1], az = AV[i3 + 2];
      let fl = this.floor[i];
      if (fl !== fl && groundY) fl = groundY(x, z); // NaN: follow the terrain
      const rest = S[i3 + 1] * 0.5;
      if (fl === fl && y < fl + rest && vy < 0) {
        y = fl + rest; vy = -vy * this.bounce[i];
        vx *= 0.55; vz *= 0.55; ax *= 0.5; ay *= 0.5; az *= 0.5;
        if (Math.abs(vy) < 0.6) { vy = 0; ax *= 0.2; az *= 0.2; }
      }
      P[w3] = x; P[w3 + 1] = y; P[w3 + 2] = z; V[w3] = vx; V[w3 + 1] = vy; V[w3 + 2] = vz;
      AV[w3] = ax; AV[w3 + 1] = ay; AV[w3 + 2] = az;
      R[w3] = R[i3] + ax * dt; R[w3 + 1] = R[i3 + 1] + ay * dt; R[w3 + 2] = R[i3 + 2] + az * dt;
      for (let k = 0; k < 3; k++) { S[w3 + k] = S[i3 + k]; C[w3 + k] = C[i3 + k]; ic[w3 + k] = C[i3 + k]; }
      this.maxLife[w] = this.maxLife[i]; this.grav[w] = this.grav[i]; this.bounce[w] = this.bounce[i]; this.floor[w] = this.floor[i]; this.drag[w] = this.drag[i];
      this.life[w] = life;
      const k = Math.min(1, life / Math.min(0.4, this.maxLife[w] * 0.5));
      _e.set(R[w3], R[w3 + 1], R[w3 + 2]); _q.setFromEuler(_e);
      _v.set(x, y, z); _s.set(S[w3] * k, S[w3 + 1] * k, S[w3 + 2] * k);
      _m.compose(_v, _q, _s); _m.toArray(im, w * 16);
      w++;
    }
    this.n = w;
    this.mesh.count = w;
    if (w) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

const TRACER_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const TRACER_FS = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uStyle; uniform float uLen; varying vec2 vUv;
  void main(){
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float core = pow(across, 6.0); float glow = pow(across, 1.6);
    float a = glow;
    if (uStyle < 0.5) a *= smoothstep(0.0, 0.85, vUv.y);                       // streak: bright head, fading tail
    else if (uStyle < 1.5) a *= 0.65 + 0.35 * sin(vUv.y * uLen * 3.0 - uTime * 40.0); // beam: energy pulses
    vec3 col = uColor * (0.6 + glow) + vec3(1.0) * core * 1.4;
    gl_FragColor = vec4(col * a * uOpacity, a * uOpacity);
  }`;
const SHELL_FS = `
  uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uColor * (f * 1.6 + 0.12) * uOpacity, 1.0); }`;
const SHELL_VS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const COLUMN_FS = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec2 vUv;
  void main(){ float a = pow(1.0 - vUv.y, 1.3) * (0.7 + 0.3 * sin(vUv.y * 30.0 - uTime * 12.0)) * smoothstep(0.0, 0.08, vUv.y);
    gl_FragColor = vec4(uColor * a * uOpacity, a * uOpacity); }`;

// a fixed-size pool of meshes; each has its own material so it can fade on its own
class MeshPool {
  constructor(scene, size, make) { this.items = []; for (let i = 0; i < size; i++) { const m = make(i); m.visible = false; m.userData.t = 0; m.frustumCulled = false; scene.add(m); this.items.push(m); } this.next = 0; }
  get() {
    for (let k = 0; k < this.items.length; k++) { const m = this.items[(this.next + k) % this.items.length]; if (!m.visible) { this.next = (this.next + k + 1) % this.items.length; return m; } }
    const m = this.items[this.next]; this.next = (this.next + 1) % this.items.length; return m; // steal the oldest-ish
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cam = null;      // set by Combat: used for LOD and tracer width
    this.groundY = null;  // set by Combat: terrain height for bouncing chunks
    const T = textures();
    this.soft = new Layer(scene, 6000, false);
    this.glow = new Layer(scene, 5000, true);
    addEventListener('resize', () => { this.soft.mat.uniforms.uScale.value = this.glow.mat.uniforms.uScale.value = innerHeight / 2; });

    // chunks
    this.debris = new Chunks(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 500);
    this.shells = new Chunks(scene, new THREE.CylinderGeometry(0.5, 0.5, 1, 7).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ metalness: 0.85, roughness: 0.3 }), 160);
    this.cubes = new Chunks(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), 400);
    const shard = new THREE.BufferGeometry();
    shard.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.6, 0, -0.45, -0.4, 0.06, 0.5, -0.35, -0.06, 0, 0.6, 0, 0.5, -0.35, -0.06, -0.45, -0.4, 0.06], 3));
    shard.computeVertexNormals();
    this.shards = new Chunks(scene, shard, new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), 300);

    // tracers / beams / ropes: two crossed quads along +Z [0..1]
    const tg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    const tg2 = tg.clone().rotateZ(Math.PI / 2);
    const tracerGeo = new THREE.BufferGeometry();
    { const a = tg.attributes, b = tg2.attributes; tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute([...a.position.array, ...b.position.array], 3)); tracerGeo.setAttribute('uv', new THREE.Float32BufferAttribute([...a.uv.array, ...b.uv.array], 2)); tracerGeo.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]); }
    this.tracers = new MeshPool(scene, 140, () => new THREE.Mesh(tracerGeo, new THREE.ShaderMaterial({
      vertexShader: TRACER_VS, fragmentShader: TRACER_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uTime: { value: 0 }, uStyle: { value: 0 }, uLen: { value: 1 } },
    })));
    for (const m of this.tracers.items) { m.renderOrder = 7; m.userData.from = new THREE.Vector3(); m.userData.dir = new THREE.Vector3(); }

    // muzzle flashes: star sprite + forward flame quads
    const flameGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.muzzles = new MeshPool(scene, 24, () => {
      const g = new THREE.Group();
      const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      const fm = new THREE.MeshBasicMaterial({ map: T.flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false });
      const f1 = new THREE.Mesh(flameGeo, fm), f2 = new THREE.Mesh(flameGeo, fm); f2.rotation.z = Math.PI / 2;
      const flame = new THREE.Group(); flame.add(f1, f2);
      g.add(star, flame); g.userData.star = star; g.userData.flame = flame; g.userData.fm = fm;
      g.traverse((o) => { o.frustumCulled = false; o.renderOrder = 8; });
      return g;
    });

    // explosion balls, shock rings, shock spheres, light columns
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    this.flashes = new MeshPool(scene, 16, () => new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.shocks = new MeshPool(scene, 10, () => new THREE.Mesh(sphere, new THREE.ShaderMaterial({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } } })));
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    this.rings = new MeshPool(scene, 20, () => new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: T.ring, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
    const colGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.columns = new MeshPool(scene, 8, () => new THREE.Mesh(colGeo, new THREE.ShaderMaterial({ vertexShader: TRACER_VS, fragmentShader: COLUMN_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uTime: { value: 0 } } })));

    // decals: bullet holes, paint, scorch marks, cartoon blood
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = new MeshPool(scene, 160, () => new THREE.Mesh(decalGeo, new THREE.MeshStandardMaterial({ map: T.splat, transparent: true, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
    for (const m of this.decals.items) m.renderOrder = 1;

    this.lights = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffaa55, 0, 18, 2); l.userData = { t: 0, life: 1, i: 0 }; scene.add(l); this.lights.push(l); }
  }

  // distance from camera (LOD)
  camDist(p) { return this.cam ? this.cam.position.distanceTo(p) : 0; }

  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 9.8, drag = 0.5, grow = 0) {
    this.soft.spawn(x, y, z, vx, vy, vz, color, color, size, life, grav, drag, grow);
  }

  // generic burst. glow:true = additive (fire, sparks, energy). end = color at end of life.
  burst(p, { count = 12, color = 0xffffff, colors = null, end = null, speed = 6, size = 0.2, life = 0.6, grav = 9.8, drag = 1, up = 0, spread = 1, dir = null, grow = 0, glow = false, jitter = 0 }) {
    const layer = glow ? this.glow : this.soft;
    if (end !== null) _c1.set(end);
    for (let k = 0; k < count; k++) {
      _c0.set(colors ? colors[k % colors.length] : color);
      if (end === null) _c1.copy(_c0);
      let vx = rand(-1, 1) * spread, vy = rand(-1, 1) * spread + up, vz = rand(-1, 1) * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * rand(0.4, 1);
      const x = jitter ? p.x + rand(-jitter, jitter) : p.x, y = jitter ? p.y + rand(-jitter, jitter) : p.y, z = jitter ? p.z + rand(-jitter, jitter) : p.z;
      layer.spawn(x, y, z, vx * s, vy * s, vz * s, _c0, _c1, size * rand(0.6, 1.3), life * rand(0.6, 1.2), grav, drag, grow);
    }
  }

  // throw instanced chunks. kind: debris | shells | cubes | shards
  chunks(kind, p, { count = 6, color = 0x888888, colors = null, speed = 5, size = 0.12, flat = 1, life = 2, dir = null, up = 0.6, spread = 1, grav = 18, bounce = 0.35, floor = NaN, spin = 12, drag = 0.2, bright = 1 }) {
    const sys = this[kind];
    for (let k = 0; k < count; k++) {
      _c0.set(colors ? colors[k % colors.length] : color).multiplyScalar(bright);
      let vx = rand(-1, 1) * spread, vy = rand(-0.2, 1) * spread + up, vz = rand(-1, 1) * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * rand(0.5, 1), sz = size * rand(0.6, 1.4);
      sys.spawn(p.x, p.y, p.z, vx * s, vy * s, vz * s, _c0, sz, sz * flat, sz * rand(0.7, 1.2), life * rand(0.7, 1.2), { grav, bounce, floor, spin, drag });
    }
  }

  // ---------- muzzle / tracers ----------
  muzzleFlash(p, dir, { size = 1, color = 0xffc070, light = true } = {}) {
    const g = this.muzzles.get();
    g.visible = true; g.position.copy(p);
    _v.copy(p).add(dir); g.lookAt(_v); // flame quads point along +Z (the shot direction)
    const s = size * rand(0.85, 1.2);
    g.userData.star.scale.setScalar(0.55 * s);
    g.userData.star.material.rotation = rand(0, Math.PI * 2);
    g.userData.star.material.color.set(color).multiplyScalar(1.6);
    g.userData.fm.color.set(color).multiplyScalar(1.6);
    g.userData.flame.scale.set(0.32 * s, 0.32 * s, 0.85 * s * rand(0.8, 1.2));
    g.userData.flame.rotation.z = rand(0, Math.PI);
    g.userData.t = g.userData.life = 0.055;
    this.glow.spawn(p.x, p.y, p.z, dir.x * 2, dir.y * 2 + 0.5, dir.z * 2, _c0.set(0x888888), _c1.set(0x222222), 0.25 * size, 0.35, -1, 2, 1.2);
    if (light) this.light(p, color, 4 * size, 0.06, 9);
  }

  // style: 0 streak (travels), 1 beam (pulses, full length), 2 solid line
  tracer(from, to, color = 0xfff2b0, width = 1, life = 0.07, { style = null, speed = 0 } = {}) {
    const m = this.tracers.get();
    const len = from.distanceTo(to);
    if (len < 0.05) return m;
    const u = m.userData;
    u.from.copy(from); u.dir.copy(to).sub(from).divideScalar(len);
    u.len = len; u.w = 0.07 * width; u.speed = speed;
    u.streak = Math.min(len, Math.max(4, len * 0.3));
    u.t = u.life = speed ? len / speed + 0.06 : life;
    u.age = 0;
    const mu = m.material.uniforms;
    mu.uColor.value.set(color); mu.uOpacity.value = 1; mu.uStyle.value = style ?? (speed ? 0 : 2); mu.uLen.value = len;
    m.visible = true;
    this.placeTracer(m, 0, len);
    return m;
  }
  placeTracer(m, a, b) {
    const u = m.userData;
    m.position.copy(u.from).addScaledVector(u.dir, a);
    _v.copy(m.position).add(u.dir); m.lookAt(_v);
    let w = u.w;
    if (this.cam) { _v2.copy(u.from).addScaledVector(u.dir, (a + b) / 2); w = Math.max(w, this.cam.position.distanceTo(_v2) * 0.0022 * (u.w / 0.07)); }
    m.scale.set(w, w, Math.max(0.01, b - a));
  }
  // bullet tracer that visibly travels (Fortnite-style streak)
  bullet(from, to, color = 0xfff2b0, width = 1) { return this.tracer(from, to, color, width, 0, { speed: 520, style: 0 }); }
  // a trail segment behind a projectile
  trail(from, to, color, width = 1, life = 0.18) { return this.tracer(from, to, color, width, life, { style: 0 }); }

  beam(from, to, color, jag = 0, width = 3) {
    if (!jag) { this.tracer(from, to, color, width, 0.07, { style: 1 }); return; }
    this.bolt(from, to, color, jag, width * 0.8, 0.14);
  }
  // jagged lightning bolt with a couple of forks
  bolt(from, to, color = 0xfff35a, jag = 0.4, width = 2, life = 0.14) {
    const len = from.distanceTo(to);
    const segs = Math.max(4, Math.min(14, Math.round(len / 1.5)));
    const prev = from.clone(), cur = new THREE.Vector3();
    for (let i = 1; i <= segs; i++) {
      cur.copy(from).lerp(to, i / segs);
      if (i < segs) cur.set(cur.x + rand(-jag, jag), cur.y + rand(-jag, jag), cur.z + rand(-jag, jag));
      this.tracer(prev, cur, color, width, life);
      if (i < segs - 1 && Math.random() < 0.25) { // fork
        const f = cur.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(jag * 3));
        this.tracer(cur, f, color, width * 0.5, life * 0.8);
      }
      prev.copy(cur);
    }
    this.glow.spawn(to.x, to.y, to.z, 0, 0, 0, _c0.set(color), _c1.set(color), 0.9, 0.12, 0, 0, 2);
  }

  // ---------- flashes / rings / columns ----------
  flash(p, r, color, life) {
    const m = this.flashes.get();
    m.visible = true; m.position.copy(p); m.scale.setScalar(r * 0.3);
    m.material.color.set(color).multiplyScalar(2.5); m.material.opacity = 1;
    Object.assign(m.userData, { t: life, life, r });
    return m;
  }
  shock(p, r, color = 0xffffff, life = 0.35) {
    const m = this.shocks.get();
    m.visible = true; m.position.copy(p); m.scale.setScalar(0.1);
    m.material.uniforms.uColor.value.set(color); m.material.uniforms.uOpacity.value = 1;
    Object.assign(m.userData, { t: life, life, r });
  }
  ring(p, r, color, life, normal = null) {
    const m = this.rings.get();
    m.visible = true; m.position.copy(p);
    if (normal) { m.quaternion.setFromUnitVectors(Z, normal); m.position.addScaledVector(normal, 0.05); }
    else { m.quaternion.setFromUnitVectors(Z, UP); m.position.y += 0.15; }
    m.material.color.set(color).multiplyScalar(1.8); m.material.opacity = 1;
    m.scale.setScalar(0.01);
    Object.assign(m.userData, { t: life, life, r });
  }
  column(p, r, h, color, life) {
    const m = this.columns.get();
    m.visible = true; m.position.copy(p); m.scale.set(r, h, r);
    m.material.uniforms.uColor.value.set(color); m.material.uniforms.uOpacity.value = 1;
    Object.assign(m.userData, { t: life, life, r, h });
  }
  light(p, color, intensity, life, dist = 18) {
    // nearby events get lights first; far ones skip them
    if (this.cam && this.camDist(p) > 120) return;
    let l = this.lights[0];
    for (const x of this.lights) { if (x.userData.t <= 0) { l = x; break; } if (x.userData.t < l.userData.t) l = x; }
    l.position.copy(p); l.color.set(color); l.intensity = intensity; l.distance = dist;
    l.userData.t = life; l.userData.life = life; l.userData.i = intensity;
  }

  // ---------- decals ----------
  decal(p, normal, { kind = 'splat', color = 0xffffff, r = 0.8, life = 20, opacity = 1 } = {}) {
    const T = textures();
    const m = this.decals.get();
    m.visible = true;
    m.material.map = T[kind] || T.splat; m.material.color.set(color);
    m.material.opacity = opacity; m.userData.op = opacity;
    m.material.roughness = kind === 'splat' ? 0.25 : 0.95;
    m.position.copy(p).addScaledVector(normal, 0.02 + Math.random() * 0.01);
    m.quaternion.setFromUnitVectors(Z, normal);
    m.rotateZ(rand(0, Math.PI * 2));
    m.scale.setScalar(r * rand(0.8, 1.2));
    m.userData.t = m.userData.life = life;
  }
  splat(p, normal, color, r = 0.8) { this.decal(p, normal, { kind: 'splat', color, r: r * 1.6 }); }
  hole(p, normal, r = 0.12) { this.decal(p, normal, { kind: 'hole', color: 0xffffff, r, life: 12, opacity: 0.9 }); }
  scorch(p, normal, r) { this.decal(p, normal, { kind: 'scorch', color: 0xffffff, r, life: 25, opacity: 0.9 }); }

  // ---------- presets ----------
  blood(p, dir) {
    _v.set(0, 0, 0); if (dir) _v.copy(dir).multiplyScalar(0.6);
    this.burst(p, { count: 16, color: 0xd0001c, end: 0x6a0010, speed: 5, size: 0.14, life: 0.55, grav: 14, dir: _v, up: 0.4 });
    this.burst(p, { count: 5, color: 0xa00016, speed: 1.5, size: 0.35, life: 0.35, grav: 4, grow: 0.6 });
  }
  // non-gore hit pop: white/yellow sparkle (health) or blue (shield)
  hitSpark(p, shield = false, head = false) {
    const cols = shield ? [0x5ecbff, 0xbff0ff, 0xffffff] : head ? [0xffe14d, 0xffffff, 0xffb627] : [0xffffff, 0xffd34d];
    this.burst(p, { count: head ? 14 : 8, colors: cols, speed: head ? 6 : 4, size: 0.12, life: 0.28, grav: 6, glow: true, drag: 3 });
    this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, _c0.set(cols[0]), _c1.set(cols[0]), head ? 1.1 : 0.7, 0.09, 0, 0, 3);
  }
  shieldHit(p) {
    this.burst(p, { count: 10, colors: [0x5ecbff, 0xbff0ff, 0xffffff], speed: 5, size: 0.14, life: 0.35, grav: 0, glow: true, drag: 3 });
    this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, _c0.set(0x5ecbff), _c1.set(0x1a5aff), 0.9, 0.12, 0, 0, 4);
  }
  // shield popped: blue glass shards + ring
  shieldBreak(p) {
    this.chunks('shards', p, { count: 26, colors: [0x5ecbff, 0x9fe8ff, 0xffffff, 0x3a7bff], bright: 2.2, speed: 7, size: 0.22, life: 0.9, up: 0.4, grav: 10, bounce: 0.2, spin: 18 });
    this.burst(p, { count: 24, colors: [0x5ecbff, 0xffffff], speed: 7, size: 0.16, life: 0.45, grav: 2, glow: true, drag: 3 });
    this.shock(p, 1.8, 0x5ecbff, 0.3);
    this.light(p, 0x5ecbff, 5, 0.25, 10);
  }
  sparks(p, normal, color = 0xffd27a) {
    _v.set(0, 0, 0); if (normal) _v.set(normal.x, normal.y, normal.z);
    this.burst(p, { count: 8, colors: [color, 0xffffff, 0xff9a3a], speed: 9, size: 0.07, life: 0.3, grav: 14, dir: _v, glow: true, drag: 1.5 });
    this.burst(p, { count: 2, color: 0x999999, speed: 0.8, size: 0.4, life: 0.6, grav: -1, grow: 0.8 });
  }
  dust(p, color = 0xd8c8a8, count = 10) { this.burst(p, { count, color, speed: 2.5, size: 0.5, life: 0.9, grav: -0.5, drag: 2, grow: 1.2, up: 0.3 }); }
  chips(p, mat, normal = null) {
    const col = mat === 'wood' ? 0x9b6a3f : mat === 'brick' ? 0xa8a29a : 0xc8d0d8;
    _v.set(0, 0, 0); if (normal) _v.set(normal.x, normal.y, normal.z).multiplyScalar(0.8);
    this.chunks('debris', p, { count: 6, colors: mat === 'wood' ? [col, 0xc89a62, 0x7a4f2a] : [col, 0x8a8580], speed: 5, size: mat === 'wood' ? 0.09 : 0.08, flat: mat === 'wood' ? 0.35 : 0.8, life: 1.4, dir: _v, up: 0.5, floor: p.y - 2.5 });
    if (mat === 'metal') this.sparks(p, normal);
    else this.burst(p, { count: 4, color: mat === 'wood' ? 0xc8a070 : 0xb8b0a8, speed: 1.5, size: 0.4, life: 0.6, grav: -0.3, drag: 2, grow: 1, dir: _v });
  }

  // surface-aware bullet impact. surf: dirt | grass | sand | snow | candy | wood | stone | metal | glass | build-wood | build-brick | build-metal
  impact(p, normal, surf = 'stone', { color = null, heavy = 1, hole = true, near = true } = {}) {
    _v2.set(0, 1, 0); if (normal) _v2.set(normal.x, normal.y, normal.z);
    const n = _v2.clone();
    const floorY = n.y > 0.6 ? p.y : p.y - 2.5;
    const m = surf.startsWith('build-') ? surf.slice(6) : surf;
    if (m === 'metal') {
      this.burst(p, { count: Math.round(10 * heavy), colors: [0xffffff, 0xffe08a, 0xff9a3a], speed: 11, size: 0.06, life: 0.35, grav: 16, dir: n, glow: true, drag: 1 });
      this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, _c0.set(0xffd27a), _c1.set(0xff7a1a), 0.5 * heavy, 0.07, 0, 0, 2);
      this.burst(p, { count: 2, color: 0xaaaaaa, speed: 1, size: 0.3, life: 0.5, grav: -0.5, drag: 2, grow: 0.8, dir: n });
    } else if (m === 'wood') {
      this.chunks('debris', p, { count: Math.round(5 * heavy), colors: [0x9b6a3f, 0xc89a62, 0x7a4f2a], speed: 5, size: 0.09, flat: 0.3, life: 1.4, dir: n, up: 0.4, floor: floorY });
      this.burst(p, { count: 4, color: 0xc8a070, speed: 2, size: 0.3, life: 0.5, grav: -0.3, drag: 2.5, grow: 0.8, dir: n });
    } else if (m === 'stone' || m === 'brick') {
      this.chunks('debris', p, { count: Math.round(4 * heavy), colors: [0x9a958e, 0x77726c, 0xb5aea5], speed: 5, size: 0.07, flat: 0.8, life: 1.2, dir: n, up: 0.4, floor: floorY });
      this.burst(p, { count: 6, color: 0xc0b8ad, speed: 2.2, size: 0.4, life: 0.7, grav: -0.3, drag: 2.5, grow: 1, dir: n });
      this.burst(p, { count: 3, colors: [0xffe08a, 0xffffff], speed: 7, size: 0.05, life: 0.18, grav: 10, dir: n, glow: true });
    } else if (m === 'glass') {
      this.chunks('shards', p, { count: 6, colors: [0xcff4ff, 0xffffff], bright: 1.2, speed: 4, size: 0.1, life: 0.8, dir: n, grav: 14, floor: floorY });
    } else { // ground: puff in the ground's color + clods
      const col = color ?? (m === 'sand' ? 0xe6d29a : m === 'snow' ? 0xf4f8ff : m === 'candy' ? 0xffb3e0 : 0x8a6a45);
      _c0.set(col); const dustCol = _c0.clone().lerp(_c1.set(0xd8c8a8), m === 'snow' || m === 'sand' ? 0 : 0.45).getHex();
      this.burst(p, { count: Math.round(7 * heavy), color: dustCol, speed: 3, size: 0.45, life: 0.9, grav: 0.6, drag: 2.5, grow: 1.3, dir: n, up: 0.6 });
      this.burst(p, { count: Math.round(5 * heavy), color: col, speed: 5, size: 0.08, life: 0.5, grav: 16, dir: n, up: 1 });
      if (near) this.chunks('debris', p, { count: 2, color: col, speed: 3.5, size: 0.06, life: 0.8, dir: n, up: 0.8, floor: p.y });
      return;
    }
    if (hole && near) this.hole(p, n, m === 'wood' ? 0.13 : 0.11);
  }

  confetti(p, count = 60) {
    this.burst(p, { count, colors: [0xff3d7f, 0x3aa0ff, 0xffd34d, 0x58d63b, 0xb45cff, 0xffffff], speed: 9, size: 0.18, life: 2, grav: 4, drag: 1.5, up: 1.2 });
  }
  feathers(p) { this.burst(p, { count: 34, colors: [0xffffff, 0xfff4e0], speed: 6, size: 0.24, life: 2.2, grav: 1.0, drag: 2.2, up: 0.5 }); }
  paint(p, color) {
    this.burst(p, { count: 18, color, speed: 6, size: 0.18, life: 0.55, grav: 14, up: 0.6 });
    this.chunks('debris', p, { count: 5, color, speed: 4, size: 0.07, life: 0.7, up: 0.8, floor: p.y - 2 });
  }
  storm(p) { this.burst(p, { count: 1, color: 0xb45cff, speed: 2, size: 0.5, life: 1, grav: -1, glow: true }); }
  elementHit(p, el) {
    const map = { fire: [0xff7a1a, 0xffd34d], ice: [0x9fe8ff, 0xffffff], lightning: [0xfff35a, 0xffffff], poison: [0x7dff5a, 0x2a8a1a], explosive: [0xffb05a, 0xff5a1a] };
    const cols = map[el] || [0xffffff];
    this.burst(p, { count: 9, colors: cols, end: el === 'fire' ? 0x551100 : null, speed: 3, size: 0.22, life: 0.5, grav: el === 'fire' ? -3 : 4, glow: el !== 'poison' });
    if (el === 'ice') this.chunks('shards', p, { count: 4, colors: [0x9fe8ff, 0xffffff], bright: 1.4, speed: 3, size: 0.1, life: 0.6, grav: 10, floor: p.y - 2 });
    if (el === 'lightning') this.bolt(p, new THREE.Vector3(p.x + rand(-1.5, 1.5), p.y + rand(0, 1.5), p.z + rand(-1.5, 1.5)), 0xfff35a, 0.3, 1.2, 0.08);
  }

  // big boom: flash ball, fireball, shockwave, smoke, sparks, debris, scorch
  explosion(p, radius = 5, color = 0xff8a2a) {
    const R = radius;
    this.flash(p, R * 0.9, 0xfff0c0, 0.16);
    this.flash(p, R * 0.6, color, 0.35);
    this.shock(p, R * 1.5, 0xffd8a8, 0.32);
    this.ring(p, R * 1.6, 0xffd8a8, 0.45);
    this.burst(p, { count: 34, colors: [0xffffff, 0xffe28a, color, 0xff5a1a], end: 0x401004, speed: R * 2.4, size: R * 0.28, life: 0.7, grav: -2, drag: 4, grow: R * 0.25, glow: true, jitter: R * 0.15 });
    this.burst(p, { count: 26, colors: [0xffe08a, 0xffffff, 0xffa040], speed: R * 4.5, size: 0.1, life: 0.9, grav: 14, drag: 0.8, up: 0.5, glow: true });
    this.burst(p, { count: 22, colors: [0x4a4440, 0x5a5550, 0x3a3532], end: 0x8a8580, speed: R * 1.1, size: R * 0.32, life: 2.6, grav: -1.4, drag: 1.6, grow: R * 0.22, up: 0.5, jitter: R * 0.2 });
    this.chunks('debris', p, { count: Math.round(8 + R * 2), colors: [0x3a2a1a, 0x5a4a3a, 0x2a2420, 0x6a6058], speed: R * 2.2, size: 0.18, life: 2.6, up: 1.1, grav: 20, bounce: 0.3 });
    this.light(p, color, 14, 0.4, R * 5);
    if (this.groundY) {
      const gy = this.groundY(p.x, p.z);
      if (p.y - gy < R * 0.6) this.scorch(_v.set(p.x, gy + 0.03, p.z), UP, R * 0.8);
    }
  }

  // Fortnite-ish "digitize": glowing cubes rising + a light column
  elimBeam(p, color = 0x5ecbff) {
    this.column(_v.set(p.x, p.y - 0.9, p.z), 0.75, 14, color, 1.2);
    this.ring(_v.set(p.x, p.y - 0.85, p.z), 2.2, color, 0.6);
    this.chunks('cubes', p, { count: 30, colors: [color, 0xffffff, color], bright: 1.8, speed: 1.6, size: 0.11, life: 1.6, up: 1.5, grav: -3, bounce: 0, spin: 4, drag: 1.2, spread: 0.8 });
    this.burst(p, { count: 24, colors: [color, 0xffffff], speed: 2, size: 0.18, life: 1.2, grav: -4, drag: 1.5, glow: true, jitter: 0.4 });
  }

  update(dt) {
    this.time += dt;
    this.soft.update(dt); this.glow.update(dt);
    const gy = this.groundY;
    this.debris.update(dt, gy); this.shells.update(dt, gy); this.cubes.update(dt, gy); this.shards.update(dt, gy);

    for (const m of this.tracers.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt; u.age += dt;
      if (u.t <= 0) { m.visible = false; continue; }
      m.material.uniforms.uTime.value = this.time;
      if (u.speed) { // moving streak
        const head = Math.min(u.len, u.age * u.speed), tail = Math.max(0, head - u.streak);
        if (tail >= u.len - 0.01) { m.visible = false; continue; }
        if (head >= u.len) m.material.uniforms.uOpacity.value = Math.max(0, u.t / 0.06);
        this.placeTracer(m, tail, head);
      } else m.material.uniforms.uOpacity.value = Math.min(1, (u.t / u.life) * 1.5);
    }
    for (const g of this.muzzles.items) {
      if (!g.visible) continue;
      g.userData.t -= dt;
      if (g.userData.t <= 0) { g.visible = false; continue; }
      const k = g.userData.t / g.userData.life;
      g.userData.star.material.opacity = k; g.userData.fm.opacity = k;
    }
    for (const m of this.flashes.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt; if (u.t <= 0) { m.visible = false; continue; }
      const k = u.t / u.life;
      m.scale.setScalar(u.r * (0.3 + 0.9 * Math.sqrt(1 - k))); m.material.opacity = k * k;
    }
    for (const m of this.shocks.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt; if (u.t <= 0) { m.visible = false; continue; }
      const k = u.t / u.life;
      m.scale.setScalar(u.r * (1 - k * k)); m.material.uniforms.uOpacity.value = k;
    }
    for (const m of this.rings.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt; if (u.t <= 0) { m.visible = false; continue; }
      const k = u.t / u.life;
      m.scale.setScalar(u.r * (1 - k * k * k) * 0.5 + 0.01); m.material.opacity = k;
    }
    for (const m of this.columns.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt; if (u.t <= 0) { m.visible = false; continue; }
      const k = u.t / u.life;
      m.material.uniforms.uTime.value = this.time; m.material.uniforms.uOpacity.value = Math.min(1, k * 2) * Math.min(1, (1 - k) * 8);
      m.scale.set(u.r * (0.4 + 0.6 * k), u.h * (1.15 - k * 0.15), u.r * (0.4 + 0.6 * k));
    }
    for (const m of this.decals.items) {
      if (!m.visible) continue;
      const u = m.userData; u.t -= dt;
      if (u.t <= 0) { m.visible = false; continue; }
      if (u.t < 3) m.material.opacity = u.op * u.t / 3;
    }
    for (const l of this.lights) {
      const u = l.userData;
      if (u.t > 0) { u.t -= dt; l.intensity = u.i * Math.max(0, u.t / u.life); } else l.intensity = 0;
    }
  }
}
