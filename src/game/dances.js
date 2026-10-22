import * as THREE from 'three';

// Procedural posing, layered on top of the playing animation clip.
// Directions are in the character's body frame: +X = character's LEFT, +Y = up (head), +Z = forward (belly).
// Limb helpers take [out, up, fwd] where "out" means away from the body on that side.
// Bones are looked up by the game's own names (Abdomen, Torso, UpperArmL, WristR, FootL...). The KayKit
// "Rig_Medium" heroes have different bone names (and three.js strips the dots: "upperarm.l" is "upperarml"),
// so findBones adds the game's names as aliases for the matching KayKit bones.

const S = Math.sin, C = Math.cos;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _eu = new THREE.Euler();
const ID = new THREE.Quaternion();

// game name -> KayKit Rig_Medium bone. Two game names on one bone simply add up (the old rig had more spine
// and neck bones), which keeps every pose's total bend the same.
const KAYKIT_ALIAS = {
  Root: 'root', Body: 'hips', Hips: 'spine', Abdomen: 'spine', Torso: 'chest', Chest: 'chest', Neck: 'head', Head: 'head',
  UpperArmL: 'upperarml', LowerArmL: 'lowerarml', WristL: 'wristl', HandL: 'handl', HandSlotL: 'handslotl',
  UpperArmR: 'upperarmr', LowerArmR: 'lowerarmr', WristR: 'wristr', HandR: 'handr', HandSlotR: 'handslotr',
  UpperLegL: 'upperlegl', LowerLegL: 'lowerlegl', FootL: 'footl', ToesL: 'toesl',
  UpperLegR: 'upperlegr', LowerLegR: 'lowerlegr', FootR: 'footr', ToesR: 'toesr',
};

export function findBones(root) {
  const b = {};
  root.traverse((o) => { if (o.isBone) b[o.name] = o; });
  if (b.handslotr) {
    for (const k in KAYKIT_ALIAS) if (b[KAYKIT_ALIAS[k]]) b[k] = b[KAYKIT_ALIAS[k]];
    b.__kaykit = true;
  }
  return b;
}

// The poses were written for a 1.8 m figure with long legs (hips ~0.85 m, shoulders ~1.4 m). KayKit heroes are
// chunky: same height, but hips at ~0.33 m and shoulders at ~0.9 m (the head is huge). Body-frame heights are
// remapped so hands land in the same place relative to the shoulders and hips.
export function kayY(y) {
  return y < 0.85 ? y * (0.33 / 0.85) : y < 1.4 ? 0.33 + (y - 0.85) * (0.57 / 0.55) : y - 0.5;
}

export class Poser {
  constructor(frame, bones) {
    this.frame = frame; this.b = bones;
    this.kay = !!bones.__kaykit;
    this.hipK = this.kay ? 0.39 : 1; // vertical body shifts shrink with the shorter legs
    this.fq = new THREE.Quaternion(); this.fqi = new THREE.Quaternion();
    this.saved = new Map(); this.touched = [];
    this.w = 1;
  }
  // put every bone we touched last frame back the way the animation left it
  restore() {
    for (const bone of this.touched) { const s = this.saved.get(bone); bone.quaternion.copy(s.q); bone.position.copy(s.p); }
    this.touched.length = 0;
  }
  save(bone) {
    let s = this.saved.get(bone);
    if (!s) { s = { q: new THREE.Quaternion(), p: new THREE.Vector3(), t: -1 }; this.saved.set(bone, s); }
    if (s.t !== this.stamp) { s.t = this.stamp; s.q.copy(bone.quaternion); s.p.copy(bone.position); this.touched.push(bone); }
  }
  begin() {
    this.stamp = (this.stamp || 0) + 1;
    this.frame.updateWorldMatrix(true, true);
    this.frame.getWorldQuaternion(this.fq); this.fqi.copy(this.fq).invert();
    this.unit = this.frame.matrixWorld.getMaxScaleOnAxis();
    return this;
  }
  // body-frame direction -> world
  dir(v, out = _d) { return out.set(v[0], v[1], v[2]).normalize().applyQuaternion(this.fq); }
  // body-frame point (meters, feet origin) -> world
  point(v, out = _e) { return out.set(v[0], this.kay ? kayY(v[1]) : v[1], v[2]).applyMatrix4(this.frame.matrixWorld); }
  // same, without the KayKit height remap (for points already measured on the new rig)
  rawPoint(v, out = _e) { return out.set(v[0], v[1], v[2]).applyMatrix4(this.frame.matrixWorld); }
  // apply a world-space rotation q to a bone (keeps its children attached)
  applyWorld(bone, q) {
    this.save(bone);
    bone.getWorldQuaternion(_wq);
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(_q2.copy(q).multiply(_wq)));
    bone.updateMatrixWorld(true);
  }
  // rotate a bone so the line bone->child points along worldDir (weight w)
  aimWorld(bone, child, worldDir, w = this.w) {
    if (!bone || !child || w <= 0) return;
    bone.getWorldPosition(_a); child.getWorldPosition(_b);
    _c.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_c, worldDir);
    if (w < 1) _q.copy(_q3.slerpQuaternions(ID, _q, w)); // (slerpQuaternions can't write into its own input)
    this.applyWorld(bone, _q);
  }
  aim(name, childName, v, w = this.w) { this.aimWorld(this.b[name], this.b[childName], this.dir(v), w); }
  // extra rotation in body-frame axes (radians, scaled by weight)
  rot(name, x = 0, y = 0, z = 0, w = this.w) {
    const bone = this.b[name]; if (!bone) return;
    _eu.set(x * w, y * w, z * w);
    _q.setFromEuler(_eu);
    _q.premultiply(this.fq).multiply(this.fqi);
    this.applyWorld(bone, _q);
  }
  side(v, s) { return [v[0] * s, v[1], v[2]]; }
  // s = 1 left, -1 right
  arm(s, up, low, w = this.w) {
    const k = s > 0 ? 'L' : 'R';
    if (up) this.aim('UpperArm' + k, 'LowerArm' + k, this.side(up, s), w);
    if (low) this.aim('LowerArm' + k, 'Wrist' + k, this.side(low, s), w);
  }
  // legs: the rig's feet are IK bones parented to Root, so we carry them along with the shin
  footGrab(k) {
    const foot = this.b['Foot' + k], shin = this.b['LowerLeg' + k];
    if (!foot || !shin) return null;
    return _m2.copy(shin.matrixWorld).invert().multiply(foot.matrixWorld).clone();
  }
  footPlace(k, rel) {
    const foot = this.b['Foot' + k], shin = this.b['LowerLeg' + k];
    if (!rel) return;
    this.save(foot);
    _m.multiplyMatrices(shin.matrixWorld, rel);
    _m.premultiply(_m2.copy(foot.parent.matrixWorld).invert());
    _m.decompose(foot.position, foot.quaternion, _a);
    foot.updateMatrixWorld(true);
  }
  leg(s, up, low, w = this.w) {
    const k = s > 0 ? 'L' : 'R';
    const rel = this.footGrab(k);
    if (up) this.aim('UpperLeg' + k, 'LowerLeg' + k, this.side(up, s), w);
    if (low) this.aim('LowerLeg' + k, 'Foot' + k, this.side(low, s), w);
    this.footPlace(k, rel);
  }
  // two-bone IK: put the end of a limb at a world point; pole = body-frame hint for the elbow/knee
  ik(upper, lower, end, target, pole, w = this.w) {
    const U = this.b[upper], L = this.b[lower], E = this.b[end];
    if (!U || !L || !E || w <= 0) return;
    const sp = U.getWorldPosition(new THREE.Vector3());
    const l1 = sp.distanceTo(L.getWorldPosition(_a)), l2 = _a.distanceTo(E.getWorldPosition(_b));
    const to = _c.subVectors(target, sp);
    const d = Math.min(Math.max(to.length(), Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
    to.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = this.dir(pole, new THREE.Vector3());
    p.addScaledVector(to, -p.dot(to)).normalize();
    const elbow = sp.clone().addScaledVector(to, a).addScaledVector(p, h);
    const wt = sp.clone().addScaledVector(to, d);
    this.aimWorld(U, L, elbow.sub(sp).normalize(), w);
    L.getWorldPosition(_a);
    this.aimWorld(L, E, wt.sub(_a).normalize(), w);
  }
  reach(s, target, pole, w = this.w) {
    const k = s > 0 ? 'L' : 'R';
    this.ik('UpperArm' + k, 'LowerArm' + k, 'Wrist' + k, target, pole || [0.6 * s, -1, -0.2], w);
  }
  // straighten a wrist so the hand lines up with the forearm (good for gripping things)
  wrist(s, w = this.w) {
    const bone = this.b['Wrist' + (s > 0 ? 'L' : 'R')]; if (!bone) return;
    this.save(bone); bone.quaternion.slerp(ID, w); bone.updateMatrixWorld(true);
  }
  // keep a foot planted where it is (or at target) after the hips moved
  legIK(s, target, w = this.w) {
    const k = s > 0 ? 'L' : 'R';
    const foot = this.b['Foot' + k]; if (!foot) return;
    const t = target || foot.getWorldPosition(new THREE.Vector3());
    const rel = this.footGrab(k);
    this.ik('UpperLeg' + k, 'LowerLeg' + k, 'Foot' + k, t, [0.15 * s, 0, 1], w);
    if (target) this.footPlace(k, rel);
  }
  // move the whole upper body + legs root (Body bone) by a body-frame offset in meters
  shiftBody(x, y, z, w = this.w) {
    const body = this.b.Body; if (!body) return;
    this.save(body);
    body.getWorldPosition(_a);
    _a.add(_b.set(x * w, y * w * this.hipK, z * w).applyQuaternion(this.fq).multiplyScalar(this.unit));
    body.parent.worldToLocal(_a);
    body.position.copy(_a);
    body.updateMatrixWorld(true);
  }
}

// ---------- dance emotes ----------
// Each dance poses the rig at time t. They run on top of Idle_Neutral.
const bounce = (P, t, f = 2, amt = 0.06) => { P.shiftBody(0, -amt * (0.5 + 0.5 * C(t * f * Math.PI * 2)), 0); P.legIK(1); P.legIK(-1); };

export const DANCES = {
  floss(P, t) {
    const k = S(t * 9), hip = S(t * 9 + Math.PI / 2);
    // straight arms swing front/back across the body while the hips go the other way
    P.shiftBody(-0.07 * k, 0, 0); P.legIK(1); P.legIK(-1);
    P.rot('Abdomen', 0, 0, 0.12 * k);
    const fx = k > 0 ? 1 : -1;
    P.arm(1, [0.25 * -k, -0.9, 0.5 * fx], [0.25 * -k, -0.9, 0.5 * fx]);
    P.arm(-1, [0.25 * k, -0.9, 0.5 * fx], [0.25 * k, -0.9, 0.5 * fx]);
    P.rot('Head', 0, 0.15 * hip, 0);
  },
  disco(P, t) {
    const beat = Math.floor(t * 2.5) % 2, k = S(t * 5 * Math.PI / 2);
    bounce(P, t, 2.5);
    P.rot('Abdomen', 0, 0.25 * k, 0.1 * k);
    if (beat) { P.arm(-1, [0.4, 0.9, 0.2], [0.25, 1, 0.1]); P.arm(1, [0.5, -0.8, 0.3], [0.2, -0.6, 0.8]); }
    else { P.arm(-1, [0.6, -0.7, 0.4], [-0.3, -0.5, 0.8]); P.arm(1, [0.5, -0.8, 0.3], [0.2, -0.6, 0.8]); }
    P.rot('Head', 0, 0.3 * k, 0);
  },
  robot(P, t) {
    const step = Math.floor(t * 3) % 4;
    const a = [1, -1, 0.5, -0.5][step];
    P.rot('Abdomen', 0, a * 0.35, 0);
    P.arm(1, [1, 0, 0.05], [0.05, 0.5 + 0.4 * a, 0.8]);
    P.arm(-1, [1, 0, 0.05], [0.05, 0.5 - 0.4 * a, 0.8]);
    P.rot('Head', 0, -a * 0.4, 0);
    P.shiftBody(0, step % 2 ? -0.05 : 0, 0); P.legIK(1); P.legIK(-1);
  },
  chicken(P, t) {
    const k = S(t * 12);
    bounce(P, t, 3, 0.1);
    P.rot('Abdomen', 0.25, 0, 0);
    for (const s of [1, -1]) P.arm(s, [0.8, 0.1 + 0.35 * k, -0.4], [-0.3, -0.6, 0.6]);
    P.rot('Neck', 0.35 * (0.5 + 0.5 * S(t * 12)), 0, 0);
  },
  dab(P, t) {
    const k = Math.min(1, t * 5), hold = t % 2.4 < 1.6 ? 1 : 0.3;
    P.w = k * hold;
    P.rot('Abdomen', 0.25, -0.3, 0);
    P.arm(1, [1, 0.6, 0.15], [1, 0.75, 0.1]); // left arm flung out and up
    P.arm(-1, [-0.5, 0.45, 0.8], [-0.1, -0.2, 1]); // right arm across the face
    P.rot('Head', 0.65, -0.5, 0.2);
    P.w = 1;
  },
  spin(P, t) {
    P.rot('Hips', 0, t * 12, 0);
    for (const s of [1, -1]) P.arm(s, [1, 0.15, 0], [1, 0.3, 0]);
    P.rot('Head', -0.2, 0, 0);
  },
  worm(P, t) {
    bounce(P, t, 1.5, 0.05);
    for (const s of [1, -1]) {
      const ph = s > 0 ? 0 : Math.PI;
      P.arm(s, [1, 0.5 * S(t * 6 + ph), 0.2], [1, 0.8 * S(t * 6 + ph - 1.2), 0.3]);
    }
    P.rot('Abdomen', 0, 0, 0.18 * C(t * 6)); P.rot('Head', 0, 0, -0.2 * C(t * 6));
  },
};

export function applyDance(poser, id, t) {
  const fn = DANCES[id.replace('dance:', '')];
  if (fn) fn(poser, t);
}

// ---------- movement poses ----------
export const POSES = {
  // belly-down spread eagle, arms bent up by the head, knees bent up behind
  skydive(P, t) {
    const f = S(t * 7) * 0.06, f2 = S(t * 5.3 + 1) * 0.05;
    P.rot('Abdomen', -0.18, 0, 0); P.rot('Torso', -0.12, 0, 0);
    P.rot('Neck', -0.35, 0, 0); P.rot('Head', -0.35, 0, 0);
    P.arm(1, [1, 0.35 + f, -0.25], [0.2, 0.9, -0.15]);
    P.arm(-1, [1, 0.35 - f, -0.25], [0.2, 0.9, -0.15]);
    P.leg(1, [0.24, -1, -0.2 + f2], [0.15, -0.45, -0.9]);
    P.leg(-1, [0.24, -1, -0.2 - f2], [0.15, -0.45, -0.9]);
  },
  // head-first dive: arms swept back along the sides, legs together and straight
  dive(P, t) {
    const f = S(t * 14) * 0.04;
    P.rot('Neck', -0.4, 0, 0); P.rot('Head', -0.45, 0, 0);
    P.arm(1, [0.3, -1, -0.35 + f], [0.15, -1, -0.2]);
    P.arm(-1, [0.3, -1, -0.35 - f], [0.15, -1, -0.2]);
    P.leg(1, [0.06, -1, -0.05], [0.04, -1, -0.12]);
    P.leg(-1, [0.06, -1, -0.05], [0.04, -1, -0.12]);
  },
  // hanging under the glider: legs dangle and swing a little (arms are done with IK to the bar)
  glide(P, t) {
    const sw = S(t * 2.2) * 0.2;
    P.rot('Abdomen', 0.08, 0, 0);
    P.leg(1, [0.08, -1, 0.2 + sw], [0.03, -1, -0.15 + sw]);
    P.leg(-1, [0.08, -1, 0.1 - sw], [0.03, -1, -0.25 - sw]);
  },
  // in the air after a jump: knees tucked up
  air(P, t, k) {
    P.leg(1, [0.12, -0.55, 0.8], [0.05, -1, -0.15 - 0.3 * k]);
    P.leg(-1, [0.12, -0.85, 0.35], [0.05, -0.8, -0.6]);
    P.arm(1, [0.85, 0.05, 0.1], [0.6, 0.5, 0.3], P.w * 0.6);
    P.arm(-1, [0.85, 0.05, 0.1], [0.6, 0.5, 0.3], P.w * 0.6);
  },
  // Fortnite-style slide: low, leaning back, lead leg out front
  slide(P) {
    P.shiftBody(0, -0.5, -0.1);
    P.rot('Abdomen', -0.45, 0.25, 0); P.rot('Head', 0.35, -0.2, 0);
    P.leg(1, [0.1, -0.5, 0.85], [0.05, -0.35, 0.95]);
    P.leg(-1, [0.22, -0.9, 0.3], [0.1, -0.3, -0.95]);
    P.arm(1, [0.5, -0.3, 0.8], [0.3, 0, 1]);
    P.arm(-1, [0.6, -0.75, -0.35], [0.2, -1, -0.1]);
  },
  // crouch: drop the hips, keep the feet planted, lean in
  crouch(P) {
    P.shiftBody(0, -0.32, -0.02);
    P.legIK(1); P.legIK(-1);
    P.rot('Abdomen', 0.3, 0, 0);
  },
  // grabbing a ledge
  mantle(P) {
    P.arm(1, [0.4, 0.85, 0.5], [0.2, 0.6, 0.8]);
    P.arm(-1, [0.4, 0.85, 0.5], [0.2, 0.6, 0.8]);
    P.leg(1, [0.1, -0.4, 0.9], [0.05, -1, -0.2]);
    P.leg(-1, [0.1, -0.9, 0.2], [0.05, -0.7, -0.7]);
  },
  // lobby idle: relaxed weight shift and breathing
  lobbyIdle(P, t) {
    const br = S(t * 1.6), sh = S(t * 0.55);
    P.rot('Torso', 0.02 * br, 0, 0); P.rot('Chest', 0.015 * br, 0, 0);
    P.rot('Abdomen', 0, 0.08 * sh, 0.03 * sh);
    P.rot('Head', 0.05 * S(t * 0.7), 0.15 * S(t * 0.35), 0);
  },
};
