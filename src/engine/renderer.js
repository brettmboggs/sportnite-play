import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Ambient occlusion (soft contact shadows in corners, under props and at the feet of characters).
// Reads the depth the main render already wrote, so the scene is NOT drawn a second time: normals are
// rebuilt from depth. The result is multiplied in by the grade pass below (no extra full-screen copy).
class DepthAOPass extends GTAOPass {
  constructor(scene, camera) {
    super(scene, camera, 2, 2);
    this.needsSwap = false;
    this.output = GTAOPass.OUTPUT.Off;
    this._renderGBuffer = false;
    this.maxPixels = 1.6e6; // AO is computed at up to this many pixels (scaled down on big screens) and upsampled
    for (const m of [this.gtaoMaterial, this.pdMaterial]) { m.defines.NORMAL_VECTOR_TYPE = 0; m.defines.DEPTH_SWIZZLING = 'x'; m.needsUpdate = true; }
    this.depth = null;
  }
  setSize(w, h) {
    const k = Math.min(1, Math.sqrt(this.maxPixels / Math.max(1, w * h)));
    super.setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    if (this.composite) this.composite.uAOTexel.value.set(1 / this.width, 1 / this.height);
    this.normalRenderTarget.setSize(1, 1); // unused: normals come from depth
  }
  render(renderer, writeBuffer, readBuffer) {
    this.depth = readBuffer.depthTexture;
    this.gtaoMaterial.uniforms.tDepth.value = this.depth;
    this.pdMaterial.uniforms.tDepth.value = this.depth;
    if (this.composite) this.composite.tDepth.value = this.depth;
    super.render(renderer, writeBuffer, readBuffer);
  }
}

// Atmosphere: replaces three's plain distance fog for every material.
//  - measured along the real view ray (no fog "swimming" at the screen edges when turning)
//  - a light aerial-perspective haze, so mid-distance hills and buildings separate into layers
//  - height fog: thick in the lowlands, thinner up high, so mountain peaks stay crisp against the sky
//  - the fog glows warm toward the sun, matching the sky's sun glow
// (sun direction is fixed for the whole match; keep in sync with Renderer.sunDir)
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
    float fogDist = length(vFogRay);
    float haze = 0.0;
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDist * fogDist );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, fogDist );
      // clear-weather biomes (long fog) get height fog + haze; the haunted forest keeps its thick wall of fog
      float clearAir = smoothstep( 500.0, 1200.0, fogFar );
      float fogY = cameraPosition.y + vFogRay.y;
      float thin = exp( - max( 0.0, fogY - 10.0 ) / 90.0 );
      fogFactor *= mix( 1.0, 0.45 + 0.55 * thin, clearAir );
      haze = ( 1.0 - exp( - fogDist * 0.001 ) ) * 0.2 * clearAir * ( 0.55 + 0.45 * thin );
    #endif
    vec3 fogRayDir = vFogRay / max( fogDist, 1e-4 );
    float fogSun = pow( max( dot( fogRayDir, vec3( 0.4581, 0.8144, 0.3563 ) ), 0.0 ), 6.0 );
    vec3 fogCol = fogColor + vec3( 1.0, 0.85, 0.6 ) * fogSun * 0.18;
    // aerial perspective: distance first turns things a little bluer, then the fog takes over
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol * vec3( 0.78, 0.9, 1.08 ), haze );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
  }
#endif`;

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null }, uStorm: { value: 0 }, uDamage: { value: 0 }, uTime: { value: 0 }, uFreeze: { value: 0 },
    tAO: { value: null }, tDepth: { value: null }, uAO: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 3000 },
    uSat: { value: 1.14 }, uContrast: { value: 1.0 }, uAOTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uStorm; uniform float uDamage; uniform float uTime; uniform float uFreeze;
    uniform sampler2D tAO; uniform highp sampler2D tDepth; uniform float uAO; uniform float uNear; uniform float uFar;
    uniform float uSat; uniform float uContrast; uniform vec2 uAOTexel;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (uAO > 0.0) {
        // ambient occlusion: full strength up close, fading out with distance (far things are hazy anyway)
        float dz = texture2D(tDepth, vUv).x;
        float viewZ = uNear * uFar / (uFar - dz * (uFar - uNear));
        // 4 bilinear taps = a soft tent filter that hides the last bit of AO grain
        float ao = 0.25 * (texture2D(tAO, vUv + uAOTexel * vec2(-0.75, -0.75)).r + texture2D(tAO, vUv + uAOTexel * vec2(0.75, -0.75)).r
                         + texture2D(tAO, vUv + uAOTexel * vec2(-0.75, 0.75)).r + texture2D(tAO, vUv + uAOTexel * vec2(0.75, 0.75)).r);
        float k = uAO * (1.0 - smoothstep(45.0, 160.0, viewZ));
        // a slightly cool, purple-ish tint in the crevices reads as stylized instead of dirty
        c.rgb *= mix(vec3(1.0), mix(vec3(0.22, 0.2, 0.32), vec3(1.0), ao), k);
      }
      vec2 d = vUv - 0.5; float r = length(d);
      // color grade (linear, before tone mapping): a little extra saturation, cool shadows, warm highlights
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(vec3(0.0), mix(vec3(lum), c.rgb, uSat));
      // contrast around mid-grey (in log space, so it never clips): punchier shapes without crushing the shade
      c.rgb = 0.18 * pow(c.rgb / 0.18 + 1e-5, vec3(uContrast));
      c.rgb *= mix(vec3(0.94, 0.98, 1.08), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.8, lum));
      float vig = smoothstep(0.9, 0.35, r);
      c.rgb *= mix(0.82, 1.0, vig);
      // storm tint
      float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
      c.rgb = mix(c.rgb, c.rgb * vec3(0.75, 0.45, 1.15) + vec3(0.08, 0.0, 0.14), uStorm * 0.75 * pulse);
      // damage red edges
      c.rgb = mix(c.rgb, vec3(0.9, 0.05, 0.05), uDamage * smoothstep(0.3, 0.75, r));
      // freeze blue edges
      c.rgb = mix(c.rgb, vec3(0.6, 0.85, 1.0), uFreeze * smoothstep(0.25, 0.7, r));
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.dom = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 3000);
    this.baseFov = 75;

    this.setupLights();
    this.setupSky();
    this.setupEnvironment();

    // the composer's buffers keep a depth texture so ambient occlusion can reuse the main pass depth
    const pr0 = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(innerWidth * pr0, innerHeight * pr0, { type: THREE.HalfFloatType });
    rt.depthTexture = new THREE.DepthTexture(innerWidth * pr0, innerHeight * pr0, THREE.FloatType);
    rt.texture.name = 'EffectComposer.rt1';
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.ao = new DepthAOPass(this.scene, this.camera);
    this.ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.5, thickness: 0.9, scale: 1.6, samples: 12, distanceFallOff: 1.0 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, samples: 12, rings: 2 });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.45, 1.05);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.tAO.value = this.ao.gtaoMap;
    // The composer swaps its two buffers every frame when AO is off (low/potato). The grade pass must always read
    // the depth of the buffer it reads colour from: a stale one can be attached to the buffer it is drawing into,
    // the GPU refuses that draw, and every other frame comes out black or white (a strobing screen).
    const vignetteRender = this.vignette.render.bind(this.vignette);
    this.vignette.render = (renderer, writeBuffer, readBuffer, dt, mask) => {
      this.vignette.uniforms.tDepth.value = readBuffer.depthTexture;
      vignetteRender(renderer, writeBuffer, readBuffer, dt, mask);
    };
    this.ao.composite = this.vignette.uniforms;
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass(innerWidth * this.renderer.getPixelRatio(), innerHeight * this.renderer.getPixelRatio());
    this.composer.addPass(this.smaa);

    this.quality = 'high';
    this.viewScale = 1;
    addEventListener('resize', () => this.resize());
  }

  // potato < low < medium < high. Potato is for old or cheap laptops: 3/4 resolution, no shadows, no grass, no
  // post effects, and a shorter view distance (the fog closes in so the far-away stuff doesn't get drawn)
  setQuality(q) {
    this.quality = q;
    const dpr = Math.min(devicePixelRatio, 2);
    const pr = q === 'potato' ? 0.75 : q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : dpr;
    this.renderer.setPixelRatio(pr);
    const map = q === 'potato' || q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(map, map);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.castShadow = q !== 'potato';
    // soft but defined shadow edges (PCF radius is in shadow-map texels)
    this.sun.shadow.radius = q === 'low' ? 1 : q === 'medium' ? 1.2 : 1.6;
    this.bloom.enabled = q === 'medium' || q === 'high';
    // AO: up to ~1600x900 worth of pixels on high (full res at 900p, ~0.6x at 1440p), a third of that on medium, off on low
    this.ao.enabled = q === 'medium' || q === 'high';
    this.ao.maxPixels = q === 'high' ? 1.6e6 : 0.55e6;
    this.aoStrength = this.ao.enabled ? 0.85 : 0;
    this.smaa.enabled = q !== 'potato';
    // how far you can see (1 = everything); the fog and the far clip plane both shrink with it
    this.viewScale = q === 'potato' ? 0.45 : q === 'low' ? 0.75 : 1;
    this.camera.far = 3000 * this.viewScale;
    this.sky.scale.setScalar(this.viewScale); // the sky dome has to stay inside the far plane or it gets clipped away
    this.renderer.sportniteQuality = q; // the grass reads this to pick how far it grows
    this.resize();
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5a7d3a, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const s = 70;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xcfe8ff, 250, 1400);
  }

  setupSky() {
    const geo = new THREE.SphereGeometry(2500, 48, 24);
    this.skyUniforms = {
      top: { value: new THREE.Color(0x2f8cff) }, horizon: { value: new THREE.Color(0xbfe6ff) },
      bottom: { value: new THREE.Color(0x9fd2ff) }, sunDir: { value: this.sunDir }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p){ p = mod(p, 289.0); vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 sd = normalize(sunDir);
          float sun = max(dot(d, sd), 0.0);
          // gradient, a touch brighter toward the sun
          vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.65, h), 0.75)) : mix(horizon, bottom, smoothstep(0.0, -0.15, h));
          col += vec3(1.0, 0.85, 0.6) * pow(sun, 6.0) * 0.18;
          col = mix(col, vec3(1.0), smoothstep(0.12, 0.0, abs(h)) * 0.18);
          // stylized cartoon clouds: crisp puffy edges, lit from the sun side, soft lavender bellies
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.18) * 1.6;
            vec2 drift = vec2(uTime * 0.006, uTime * 0.0025);
            float base = fbm(uv + drift);
            float puff = fbm(uv * 2.2 + drift * 1.6 + 4.0);
            float shape = base * 0.75 + puff * 0.35;
            float cov = smoothstep(0.56, 0.62, shape);
            float lit = clamp((fbm(uv + drift - sd.xz * 0.06) - base) * 6.0 + 0.6, 0.0, 1.0);
            vec3 cloud = mix(vec3(0.78, 0.8, 0.95), vec3(1.0, 0.99, 0.96), lit);
            cloud = mix(cloud, vec3(1.0), smoothstep(0.62, 0.72, shape) * 0.3);
            cloud += vec3(1.0, 0.85, 0.6) * pow(sun, 18.0) * 0.6 * (1.0 - cov * 0.5);
            float fade = smoothstep(0.02, 0.18, h);
            col = mix(col, cloud, cov * fade * 0.96);
            // high thin streaks
            float cir = smoothstep(0.55, 0.85, fbm(vec2(uv.x * 0.6, uv.y * 3.0) * 0.7 + drift * 2.0 + 20.0));
            col = mix(col, vec3(1.0), cir * 0.18 * fade * (1.0 - cov));
          }
          // sun disc + glow
          col += vec3(1.0, 0.95, 0.8) * (smoothstep(0.9993, 0.9996, sun) * 4.0 + pow(sun, 300.0) * 1.2 + pow(sun, 24.0) * 0.25);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // Image-based light from a soft sky dome, so shiny and shaded surfaces pick up the sky color instead of going flat
  setupEnvironment() {
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; void main(){
        float h = vD.y;
        vec3 sky = mix(vec3(0.75, 0.88, 1.0), vec3(0.3, 0.55, 1.0), smoothstep(0.0, 0.8, h));
        vec3 ground = mix(vec3(0.55, 0.6, 0.45), vec3(0.35, 0.42, 0.3), smoothstep(0.0, -0.6, h));
        vec3 c = h > 0.0 ? sky : ground;
        c += vec3(1.0, 0.9, 0.7) * pow(max(dot(vD, normalize(vec3(0.45, 0.8, 0.35))), 0.0), 40.0) * 6.0;
        gl_FragColor = vec4(c, 1.0); }`,
    }));
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.45;
  }

  setTheme({ top, horizon, bottom, fog, hemiSky, hemiGround, sun, sunIntensity, fogNear, fogFar, exposure }) {
    if (top) this.skyUniforms.top.value.set(top);
    if (horizon) this.skyUniforms.horizon.value.set(horizon);
    if (bottom) this.skyUniforms.bottom.value.set(bottom);
    if (fog) this.scene.fog.color.set(fog);
    if (fogNear) this.scene.fog.near = fogNear;
    if (fogFar) this.scene.fog.far = fogFar;
    if (hemiSky) this.hemi.color.set(hemiSky);
    if (hemiGround) this.hemi.groundColor.set(hemiGround);
    if (sun) this.sun.color.set(sun);
    if (sunIntensity !== undefined) this.sun.intensity = sunIntensity;
    if (exposure) this.renderer.toneMappingExposure = exposure;
  }

  // neutral colour grade (lobby / menus); the match blends per-biome values in game.biomeLighting()
  resetGrade() {
    this.vignette.uniforms.uSat.value = 1.12;
    this.vignette.uniforms.uContrast.value = 1.05;
    this.renderer.toneMappingExposure = 1.0;
  }

  followShadow(target) {
    // Keep the shadow box around the player, pushed ahead of where the camera looks so more of the visible
    // ground gets shadows. Snapped to whole shadow-map texels in the light's own frame, so shadow edges stay
    // perfectly still while moving (no shimmering).
    const sh = this.sun.shadow, cam = sh.camera;
    const half = cam.right;
    this._fwd ??= new THREE.Vector3();
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    const fl = this._fwd.length();
    const ahead = fl > 1e-3 ? half * 0.4 / fl : 0;
    const cx = target.x + this._fwd.x * ahead, cz = target.z + this._fwd.z * ahead, cy = target.y;
    if (!this._lsR) {
      this._lsR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
      this._lsU = new THREE.Vector3().crossVectors(this.sunDir, this._lsR);
    }
    const R = this._lsR, U = this._lsU, D = this.sunDir;
    const texel = (2 * half) / sh.mapSize.x;
    const lx = Math.round((cx * R.x + cy * R.y + cz * R.z) / texel) * texel;
    const ly = Math.round((cx * U.x + cy * U.y + cz * U.z) / texel) * texel;
    const lz = cx * D.x + cy * D.y + cz * D.z;
    const x = R.x * lx + U.x * ly + D.x * lz, y = R.y * lx + U.y * ly + D.y * lz, z = R.z * lx + U.z * ly + D.z * lz;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + D.x * 200, y + D.y * 200, z + D.z * 200);
    this.sky.position.copy(this.camera.position);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  render(dt) {
    // never draw from a broken camera (NaN position/rotation draws nothing, or a white screen on some laptops):
    // put it back where it last was fine
    const c = this.camera, p = c.position, q = c.quaternion;
    if (Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z + q.w)) {
      (this._goodCamPos ??= new THREE.Vector3()).copy(p); (this._goodCamQuat ??= new THREE.Quaternion()).copy(q);
    } else if (this._goodCamPos) {
      console.warn('[sportnite] camera went NaN, restoring it');
      p.copy(this._goodCamPos); q.copy(this._goodCamQuat); c.updateMatrixWorld();
    }
    const vu = this.vignette.uniforms;
    vu.uAO.value = this.ao.enabled ? (this.aoStrength ?? 1) : 0;
    vu.uNear.value = this.camera.near; vu.uFar.value = this.camera.far;
    this.skyUniforms.uTime.value += dt;
    this.vignette.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
