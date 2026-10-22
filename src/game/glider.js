import * as THREE from 'three';
import { GLIDERS } from '../meta/progression.js';
import { damp } from '../engine/utils.js';

export const BAR_Y = 1.15, BAR_Z = -0.4; // handle bar, in the glider's frame (forward is -Z)

// Colorful kite-glider: an arched canopy over the character's head with a bar they hang from.
// Faces -Z (the character's forward). It pops open with a springy unfold and banks into turns.
export class Glider {
  constructor(game) { this.game = game; this.active = new Map(); }

  make(id) {
    const def = GLIDERS.find((g) => g.id === id) || GLIDERS[0];
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const col = (k) => (def.colors[k] === 'rainbow' ? null : def.colors[k]);
    if (!col(0)) { const g = ctx.createLinearGradient(0, 0, 256, 0); ['#ff3d7f', '#ffd34d', '#58d63b', '#3aa0ff', '#b45cff'].forEach((h, i) => g.addColorStop(i / 4, h)); ctx.fillStyle = g; }
    else ctx.fillStyle = col(0);
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = col(1) || '#ffffff';
    for (let x = 0; x < 256; x += 64) ctx.fillRect(x + 24, 0, 16, 128);
    // darker trailing edge for depth
    const sh = ctx.createLinearGradient(0, 0, 0, 128); sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.4, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    // wing outline (x = span, y = chord; +y is the leading edge)
    const shape = new THREE.Shape();
    shape.moveTo(-2.2, 0); shape.quadraticCurveTo(0, 0.9, 2.2, 0); shape.lineTo(1.2, -0.9); shape.quadraticCurveTo(0, -0.5, -1.2, -0.9); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape, 16);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 2.2) / 4.4, (pos.getY(i) + 0.9) / 1.8);
    geo.rotateX(-Math.PI / 2); // leading edge -> -Z (forward)
    // arch the canopy: tips droop down like a real paraglider
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / 2.2; pos.setY(i, -0.55 * x * x - 0.08 * Math.abs(pos.getZ(i))); }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.5, emissive: def.rarity >= 5 ? 0x441100 : 0x000000 });
    const wing = new THREE.Mesh(geo, mat); wing.castShadow = true;
    wing.position.y = 2.75;
    const g = new THREE.Group();
    const rig = new THREE.Group(); g.add(rig); // the part that unfolds
    rig.add(wing);
    // handle bar the hands hold on to
    const dark = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.6 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), dark);
    // (the KayKit heroes have short arms and big heads, so the bar sits in front of the chin)
    bar.rotation.z = Math.PI / 2; bar.position.set(0, BAR_Y, BAR_Z); rig.add(bar);
    // lines from the bar ends up to the canopy
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const sx of [-1, 1]) {
      for (const [wx, wz] of [[1.9, 0.0], [1.1, -0.45], [0.9, 0.55]]) {
        a.set(sx * 0.36, BAR_Y, BAR_Z);
        b.set(sx * wx, 2.75 - 0.55 * (wx / 2.2) ** 2, wz);
        const len = a.distanceTo(b);
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), lineMat);
        line.position.copy(a).add(b).multiplyScalar(0.5);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        rig.add(line);
      }
    }
    g.userData.rainbow = !col(0);
    g.userData.mat = mat;
    g.userData.rig = rig;
    g.userData.open = 0;
    return g;
  }

  open(ch) {
    if (this.active.has(ch)) return;
    const id = ch.isPlayer ? this.game.save.data.glider : ['classic', 'ocean', 'jungle', 'candy', 'ghost'][ch.id % 5];
    const g = this.make(id);
    g.userData.t = 0;
    this.game.scene.add(g);
    this.active.set(ch, g);
  }

  update(dt = 1 / 60) {
    for (const [ch, g] of this.active) {
      if (ch.state !== 'glide' || !ch.alive) { g.removeFromParent(); this.active.delete(ch); continue; }
      const u = g.userData;
      u.t += dt;
      // springy unfold: scale from a folded bundle to full size with a little overshoot
      const k = Math.min(1, u.t / 0.45);
      u.open = Math.min(1, u.t / 0.25);
      const pop = k >= 1 ? 1 : 1 - Math.cos(k * Math.PI * 2.2) * Math.exp(-k * 5) * (1 - k);
      u.rig.scale.set(Math.max(0.05, pop), Math.max(0.2, Math.min(1, k * 2)), Math.max(0.05, pop));
      g.position.set(ch.pos.x, ch.root.position.y, ch.pos.z);
      g.rotation.order = 'YXZ';
      g.rotation.y = ch.bodyYaw;
      // bank with the character, pitch nose-down when diving, and sway a little
      u.bank = damp(u.bank || 0, (ch.bank || 0) * 1.4, 5, dt);
      g.rotation.z = u.bank + Math.sin(this.game.time * 2 + ch.id) * 0.05;
      g.rotation.x = damp(g.rotation.x, ch.vel.y < -8 ? -0.18 : 0, 3, dt);
      g.scale.setScalar(ch.scale || 1);
      g.visible = ch.root.visible;
      if (u.rainbow) u.mat.emissive.setHSL((this.game.time * 0.3) % 1, 1, 0.25);
    }
  }

  clear() { for (const g of this.active.values()) g.removeFromParent(); this.active.clear(); }
}
