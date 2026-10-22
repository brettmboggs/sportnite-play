import * as THREE from 'three';
import { assets, HERO_SCALE } from '../engine/assets.js';
import { findBones } from './dances.js';
import { prepHero } from './skins.js';

// Shared setup for every KayKit hero (players, bots, bosses, the lobby hero and mini-game players).

// Clip names the rest of the game asks for (from the old rig) -> the KayKit clip that plays.
export const CLIP_ALIAS = {
  Idle: 'Idle_A', Idle_Neutral: 'Idle_A', Idle_Gun: 'Ranged_2H_Aiming', Idle_Sword: 'Melee_2H_Idle',
  Run: 'Running_A', Walk: 'Walking_A', Run_Back: 'Walking_Backwards', Run_Left: 'Running_Strafe_Left', Run_Right: 'Running_Strafe_Right',
  Death: 'Death_A', HitRecieve: 'Hit_A', HitRecieve_2: 'Hit_B',
  Punch_Right: 'Melee_Unarmed_Attack_Punch_A', Punch_Left: 'Melee_Unarmed_Attack_Punch_A',
  Kick_Right: 'Melee_Unarmed_Attack_Kick', Kick_Left: 'Melee_Unarmed_Attack_Kick',
  Wave: 'Waving', Roll: 'Dodge_Forward', Sword_Slash: 'Melee_2H_Attack_Slice', Gun_Shoot: 'Ranged_2H_Shoot',
};

// clips that play once and hold their last frame
const ONCE = /^(Death_|Hit_|Melee_.*Attack|Melee_Block_|Interact|PickUp|Throw|Use_Item|Dodge_|Jump_Start|Jump_Land|Spawn_|Ranged_.*(Reload|Shoot|Release|Draw)$|Ranged_Magic_(Shoot|Raise|Summon)|Lie_Down|Lie_StandUp|Sit_.*(Down|StandUp))/;

// The action table is filled on demand, so a hero only builds the clips it actually plays.
export function heroActions(mixer, clips) {
  const byName = new Map(clips.map((c) => [c.name, c]));
  const made = {};
  return new Proxy(made, {
    get(o, k) {
      if (typeof k !== 'string') return undefined;
      if (k in o) return o[k];
      const real = CLIP_ALIAS[k] || k;
      let a = o[real];
      if (!a) {
        const c = byName.get(real);
        if (!c) return undefined;
        a = mixer.clipAction(c);
        if (ONCE.test(real)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
        o[real] = a;
      }
      o[k] = a;
      return a;
    },
  });
}

// Build a hero model: { object, frame, bones, materials, animations, mixer, actions, headBone, handBone }.
// `frame` is a group with the feet at its origin, facing +Z, 1.8 m tall.
export function buildHero(model) {
  const { object, animations } = assets.hero(model);
  object.scale.setScalar(HERO_SCALE);
  const frame = new THREE.Group();
  frame.add(object);
  frame.userData.size = new THREE.Vector3(1.6, 1.8, 0.9);
  const materials = prepHero(object);
  const bones = findBones(object);
  const mixer = new THREE.AnimationMixer(object);
  const actions = heroActions(mixer, animations);
  return { object, frame, bones, materials, animations, mixer, actions, headBone: bones.head || null, handBone: bones.handslotr || bones.wristr || null };
}

// ---- upper-body clip overlay ----
// Plays part of a clip on top of whatever the mixer did this frame (e.g. a reload or a throw on the arms while
// the legs keep running). Writes straight into the bones through the Poser so it's undone next frame.
const UPPER = /^(spine|chest|head|upperarm[lr]|lowerarm[lr]|wrist[lr]|hand[lr])$/;
const ARMS = /^(upperarm[lr]|lowerarm[lr]|wrist[lr]|hand[lr])$/;
const _q = new THREE.Quaternion();
export class ClipOverlay {
  constructor(bones, clips) { this.bones = bones; this.byName = new Map(clips.map((c) => [c.name, c])); this.cache = new Map(); }
  sampler(name, mask) {
    const key = name + '|' + mask;
    if (this.cache.has(key)) return this.cache.get(key);
    const clip = this.byName.get(CLIP_ALIAS[name] || name);
    let s = null;
    if (clip) {
      const re = mask === 'arms' ? ARMS : mask === 'all' ? /./ : UPPER;
      const tracks = [];
      for (const t of clip.tracks) {
        const [bn, prop] = t.name.split('.');
        if (prop !== 'quaternion' || !re.test(bn) || !this.bones[bn]) continue;
        tracks.push({ bone: this.bones[bn], interp: t.createInterpolant() });
      }
      s = { duration: clip.duration, tracks };
    }
    this.cache.set(key, s);
    return s;
  }
  duration(name) { const c = this.byName.get(CLIP_ALIAS[name] || name); return c ? c.duration : 0; }
  // t in seconds (clamped to the clip), w = blend weight
  apply(poser, name, t, w = 1, mask = 'upper') {
    const s = this.sampler(name, mask);
    if (!s || w <= 0) return;
    const tt = Math.min(Math.max(t, 0), s.duration);
    for (const tr of s.tracks) {
      const v = tr.interp.evaluate(tt);
      poser.save(tr.bone);
      _q.fromArray(v);
      if (w >= 1) tr.bone.quaternion.copy(_q); else tr.bone.quaternion.slerp(_q, w);
    }
    if (this.bones.hips) this.bones.hips.updateMatrixWorld(true);
  }
}
