import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// relative to wherever the game is hosted, so the built game also works from a sub-folder (like GitHub Pages)
const BASE = `${import.meta.env.BASE_URL}assets/`;

// Heroes: KayKit Adventurers (Kay Lousberg, CC0). They all share the "Rig_Medium" skeleton, and the
// KayKit Character Animations files hold the clips; any clip plays on any hero (bound by bone name).
export const CHARACTER_FILES = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];
export const heroPath = (model) => `kaykit/characters/${model}.glb`;
export const HERO_ANIM_FILES = ['General', 'MovementBasic', 'MovementAdvanced', 'CombatRanged', 'CombatMelee', 'Simulation', 'Special']
  .map((n) => `kaykit/anims/Rig_Medium_${n}.glb`);
export const HERO_FILES = [...CHARACTER_FILES.map(heroPath), ...HERO_ANIM_FILES];
// the rig is ~2.2 m from feet to the top of the head; this makes every hero 1.8 m (hats stick up a bit)
export const HERO_SCALE = 1.8 / 2.2;

class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.pending = new Map();
    this.audio = new Map();
    this.total = 0;
    this.done = 0;
    this.onProgress = null;
  }

  async gltf(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    if (this.pending.has(path)) return this.pending.get(path);
    this.total++;
    const p = new Promise((resolve) => {
      this.loader.load(BASE + path, (g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            if (o.material && o.material.map) o.material.map.anisotropy = 8;
          }
        });
        this.cache.set(path, g); this.done++; this.onProgress && this.onProgress(this.done, this.total);
        resolve(g);
      }, undefined, (err) => {
        console.warn('Failed to load', path, err);
        const g = { scene: new THREE.Group(), animations: [] };
        this.cache.set(path, g); this.done++; this.onProgress && this.onProgress(this.done, this.total);
        resolve(g);
      });
    });
    this.pending.set(path, p);
    return p;
  }

  get(path) { return this.cache.get(path); }

  // Clone a static model, scaled so its height (or largest side) == size.
  model(path, { height, size, center = true, ground = true } = {}) {
    const g = this.cache.get(path);
    if (!g) { console.warn('model not loaded', path); return new THREE.Group(); }
    const obj = g.scene.clone(true);
    return fitObject(obj, { height, size, center, ground });
  }

  character(path) {
    const g = this.cache.get(path);
    const obj = SkeletonUtils.clone(g.scene);
    return { object: obj, animations: g.animations };
  }

  // a fresh, independently animatable copy of a hero plus every KayKit clip
  hero(model) {
    const g = this.cache.get(heroPath(model)) || this.cache.get(heroPath(CHARACTER_FILES[0]));
    const obj = SkeletonUtils.clone(g.scene);
    return { object: obj, animations: this.heroClips() };
  }

  heroClips() {
    if (this._heroClips) return this._heroClips;
    const seen = new Set(), out = [];
    for (const f of HERO_ANIM_FILES) {
      const g = this.cache.get(f); if (!g) continue;
      for (const c of g.animations) {
        if (c.name === 'T-Pose' || seen.has(c.name)) continue;
        seen.add(c.name);
        // the clips key every bone's scale (always 1) and position; drop the constant scale tracks to save work
        c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
        out.push(c);
      }
    }
    if (out.length) this._heroClips = out;
    return out;
  }

  async loadAll(paths) { await Promise.all(paths.map((p) => this.gltf(p))); }
}

export function fitObject(obj, { height, size, center = true, ground = true } = {}) {
  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const s = box.getSize(new THREE.Vector3());
  let k = 1;
  if (height) k = height / (s.y || 1);
  else if (size) k = size / Math.max(s.x, s.y, s.z, 0.0001);
  obj.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  if (center) { obj.position.x -= c.x; obj.position.z -= c.z; }
  if (ground) obj.position.y -= box.min.y * k;
  wrap.userData.size = s.multiplyScalar(k);
  return wrap;
}

// Build InstancedMeshes for a static model so we can place hundreds cheaply.
// Returns { add(matrix) -> index, hide(index), meshes, count, size }
export class Instancer {
  constructor(scene, model, capacity) {
    this.meshes = [];
    this.count = 0;
    this.capacity = capacity;
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, capacity);
      im.castShadow = true; im.receiveShadow = true;
      im.count = 0;
      im.userData.local = o.matrixWorld.clone();
      im.frustumCulled = false;
      this.meshes.push(im);
      scene.add(im);
    });
    this.size = model.userData.size || new THREE.Vector3(1, 1, 1);
    this.matrices = [];
  }
  add(matrix) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const m = new THREE.Matrix4();
    for (const im of this.meshes) {
      m.multiplyMatrices(matrix, im.userData.local);
      im.setMatrixAt(i, m);
      im.count = this.count;
      im.instanceMatrix.needsUpdate = true;
    }
    this.matrices[i] = matrix.clone();
    return i;
  }
  setMatrix(i, matrix) {
    const m = new THREE.Matrix4();
    for (const im of this.meshes) { m.multiplyMatrices(matrix, im.userData.local); im.setMatrixAt(i, m); im.instanceMatrix.needsUpdate = true; }
    this.matrices[i] = matrix.clone();
  }
  hide(i) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const im of this.meshes) { im.setMatrixAt(i, zero); im.instanceMatrix.needsUpdate = true; }
  }
  finalize() { for (const im of this.meshes) { im.computeBoundingSphere(); } }
  dispose(scene) { for (const im of this.meshes) scene.remove(im); }
}

export const assets = new Assets();
