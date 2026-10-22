import * as THREE from 'three';
import { rand } from '../engine/utils.js';
import { ISLAND_RADIUS } from '../world/terrain.js';

// Phase list: wait = time before the circle starts closing, shrink = time it takes, dps = damage outside
const PHASES = [
  { wait: 70, shrink: 50, frac: 0.55, dps: 1 },
  { wait: 50, shrink: 40, frac: 0.5, dps: 2 },
  { wait: 40, shrink: 35, frac: 0.5, dps: 5 },
  { wait: 30, shrink: 30, frac: 0.45, dps: 8 },
  { wait: 25, shrink: 25, frac: 0.4, dps: 10 },
  { wait: 20, shrink: 25, frac: 0.0, dps: 12 },
];

export class Storm {
  constructor(game, speed = 1) {
    this.game = game;
    this.speed = speed;
    this.current = { x: 0, z: 0, r: ISLAND_RADIUS + 120 };
    this.from = { ...this.current };
    this.next = null;
    this.phase = -1;
    this.timer = 30 / speed; // first circle appears after landing time
    this.shrinking = false;
    this.dps = 1;
    this.build();
  }

  build() {
    // the wall: a tall open cylinder, scaled to the circle each frame
    const geo = new THREE.CylinderGeometry(1, 1, 900, 128, 1, true).translate(0, 300, 0);
    this.uniforms = { uTime: { value: 0 }, uFlash: { value: 0 }, uR: { value: 500 }, uCam: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec2 vN; void main(){ vUv = uv; vN = normalize(position.xz); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec2 vN;
        uniform float uTime; uniform float uFlash; uniform float uR; uniform vec3 uCam; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
        float swirl(vec2 p){
          vec2 q = vec2(fbm(p + vec2(uTime * 0.05, -uTime * 0.12)), fbm(p * 1.3 + vec2(-uTime * 0.08, uTime * 0.06) + 5.2));
          return fbm(p * 1.6 + q * 2.2 + vec2(uTime * 0.15, -uTime * 0.25));
        }
        void main(){
          // seamless: sample the swirl on the two world planes and blend by which way the wall faces
          vec2 pz = vec2(vW.z, vW.y) / 40.0, px = vec2(vW.x, vW.y) / 40.0;
          float wx = vN.x * vN.x;
          float s = mix(swirl(px), swirl(pz), wx);
          float u = mix(vW.x, vW.z, wx) / 40.0;
          vec3 deep = vec3(0.22, 0.03, 0.42), mid = vec3(0.55, 0.12, 0.85), hi = vec3(0.95, 0.55, 1.0);
          vec3 c = mix(deep, mid, smoothstep(0.25, 0.6, s));
          c = mix(c, hi, smoothstep(0.62, 0.85, s) * 0.8);
          // glowing rim on the inner edge: brighter where the clouds are thin
          float rim = smoothstep(0.45, 0.2, s) * 0.35;
          c += vec3(0.85, 0.5, 1.0) * rim;
          // vertical energy streaks
          float streak = pow(n(vec2(u * 6.0, uTime * 0.6)), 8.0) * smoothstep(0.4, 0.8, s);
          c += vec3(0.8, 0.6, 1.0) * streak * 1.5;
          // lightning: whole-wall flash plus forked bolts
          float boltX = abs(fract(u * 0.15 + floor(uTime * 3.0) * 0.37) - 0.5);
          float wig = (n(vec2(vW.y * 0.08, floor(uTime * 3.0))) - 0.5) * 0.08;
          float bolt = smoothstep(0.008, 0.0, abs(boltX - 0.25 + wig)) * step(0.93, h(vec2(floor(u * 0.15), floor(uTime * 3.0)))) * step(fract(uTime * 3.0), 0.4);
          c += vec3(1.0, 0.9, 1.0) * (bolt * 2.5 + uFlash * 0.7);
          // more see-through up close so you can still fight inside it
          float camD = length(vW - uCam);
          float a = 0.5 + s * 0.3 + bolt * 0.5;
          a *= mix(0.55, 1.0, smoothstep(5.0, 40.0, camD));
          a *= smoothstep(600.0, 300.0, vW.y);
          gl_FragColor = vec4(c * (1.0 + uFlash * 0.5), clamp(a, 0.0, 0.95));
        }`,
    });
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.position.y = -40;
    this.wall.renderOrder = 10;
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.game.scene.add(this.wall);
    // next circle: a faint white curtain of light that shows exactly where the safe zone will be
    const ringMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: { uTime: this.uniforms.uTime },
      vertexShader: `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vY;
        void main(){ float a = (1.0 - vUv.y) * 0.22 * (0.75 + 0.25 * sin(vUv.x * 600.0 - uTime * 2.0)); gl_FragColor = vec4(1.0, 1.0, 1.0, a); }`,
    });
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 128, 1, true).translate(0, 10, 0), ringMat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 9;
    this.game.scene.add(this.ring);
    this.flashT = rand(4, 9);
  }

  // What the map needs to draw the storm (current circle, next circle, phase timing)
  mapInfo() {
    return {
      current: { ...this.current }, next: this.next ? { ...this.next } : null, phase: this.phase, shrinking: this.shrinking,
      timeLeft: Math.max(0, this.timer), progress: this.shrinking && this.shrinkTotal ? 1 - Math.max(0, this.timer) / this.shrinkTotal : 0,
      dps: this.dps,
    };
  }

  pickNext() {
    const ph = PHASES[this.phase];
    const r = Math.max(0, this.current.r * ph.frac);
    if (this.phase === 0) this.current.r = Math.min(this.current.r, ISLAND_RADIUS + 20);
    // new center is inside the old circle and on land
    let x = this.current.x, z = this.current.z;
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2), d = rand(0, Math.max(0, this.current.r - r) * 0.8);
      x = this.current.x + Math.cos(a) * d; z = this.current.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < ISLAND_RADIUS - 60 && this.game.world.groundY(x, z) > 3) break;
    }
    this.next = { x, z, r };
    this.dps = ph.dps;
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
    // lightning flashes every few seconds
    this.flashT -= dt;
    if (this.flashT <= 0 && this.phase >= 0) {
      this.flashT = rand(3, 8);
      this.uniforms.uFlash.value = 1;
      const a = rand(0, Math.PI * 2);
      this.game.events.emit('stormLightning', { x: this.current.x + Math.cos(a) * (this.current.r + 30), z: this.current.z + Math.sin(a) * (this.current.r + 30) });
    }
    this.uniforms.uFlash.value = Math.max(0, this.uniforms.uFlash.value - dt * 4);
    const cam = this.game.renderer && this.game.renderer.camera;
    if (cam) this.uniforms.uCam.value.copy(cam.position);
    this.timer -= dt;
    if (this.timer <= 0) {
      if (!this.shrinking) {
        if (this.phase >= PHASES.length - 1 && !this.next) { this.timer = 9999; return; }
        if (this.next) { // start closing toward next
          this.shrinking = true;
          this.from = { ...this.current };
          this.timer = PHASES[this.phase].shrink / this.speed;
          this.shrinkTotal = this.timer;
          this.game.events.emit('stormClosing', this);
        } else {
          this.phase++;
          this.pickNext();
          this.timer = PHASES[this.phase].wait / this.speed;
          this.game.events.emit('stormNext', this);
        }
      } else {
        this.shrinking = false;
        this.current = { ...this.next };
        if (this.phase < PHASES.length - 1) {
          this.phase++;
          this.pickNext();
          this.timer = PHASES[this.phase].wait / this.speed;
          this.game.events.emit('stormNext', this);
        } else { this.next = null; this.timer = 9999; }
      }
    }
    if (this.shrinking) {
      const k = 1 - Math.max(0, this.timer) / this.shrinkTotal;
      this.current.x = this.from.x + (this.next.x - this.from.x) * k;
      this.current.z = this.from.z + (this.next.z - this.from.z) * k;
      this.current.r = this.from.r + (this.next.r - this.from.r) * k;
    }
    this.wall.visible = this.phase >= 0;
    const r = Math.max(0.5, this.current.r);
    this.wall.position.x = this.current.x; this.wall.position.z = this.current.z;
    this.wall.scale.set(r, 1, r);
    this.uniforms.uR.value = r;
    if (this.next && this.next.r > 1) {
      this.ring.visible = true;
      this.ring.position.set(this.next.x, -5, this.next.z);
      this.ring.scale.set(this.next.r, 1, this.next.r);
    } else this.ring.visible = false;
  }

  // >0 means outside the (current or next) circle by that many meters
  distanceOutside(p, useNext = false) {
    const c = useNext && this.next ? this.next : this.current;
    return Math.hypot(p.x - c.x, p.z - c.z) - c.r;
  }

  safePointFor(p) {
    const c = this.next || this.current;
    const dx = c.x - p.x, dz = c.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const go = Math.max(0, d - c.r * 0.6);
    const x = p.x + (dx / d) * go, z = p.z + (dz / d) * go;
    return new THREE.Vector3(x, this.game.world.groundY(x, z), z);
  }

  dispose() { this.wall.removeFromParent(); this.ring.removeFromParent(); }
}
