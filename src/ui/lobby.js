import * as THREE from 'three';
import { applySkin, animateSkin, SKIN_BY_ID } from '../game/skins.js';
import { applyDance, Poser, POSES } from '../game/dances.js';
import { buildHero } from '../game/heroRig.js';
import { EMOTES } from '../meta/progression.js';
import { canvasTexture } from '../engine/utils.js';

// The lobby: your hero on a spinning stage with lights.
export class Lobby {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = game.renderer.camera;
    const s = this.scene;
    s.background = canvasTexture(16, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a0f6b'); g.addColorStop(0.55, '#7b2cff'); g.addColorStop(1, '#ff4fb0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    s.add(new THREE.HemisphereLight(0xcfd8ff, 0x6a2a8a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(3, 6, 5); key.castShadow = true; key.shadow.normalBias = 0.03; key.shadow.bias = -0.0004; s.add(key); // (biases: no speckled self-shadow on the smooth heroes)
    const rim = new THREE.DirectionalLight(0x48b6ff, 3); rim.position.set(-4, 3, -4); s.add(rim);
    const rim2 = new THREE.DirectionalLight(0xff4fb0, 2.5); rim2.position.set(4, 2, -3); s.add(rim2);
    // stage
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 48), new THREE.MeshStandardMaterial({ color: 0x1b1240, metalness: 0.4, roughness: 0.3 }));
    stage.position.y = -0.2; stage.receiveShadow = true; s.add(stage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x48b6ff).multiplyScalar(3) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; s.add(ring);
    this.ring = ring;
    // floating sports balls in the background
    this.floaters = [];
    const colors = [0xff7a1f, 0xffffff, 0xffd34d, 0x58d63b, 0x3aa0ff];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15 + Math.random() * 0.35, 1), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.4, emissive: colors[i % colors.length], emissiveIntensity: 0.15 }));
      m.position.set((Math.random() - 0.5) * 16, Math.random() * 6 - 1, -4 - Math.random() * 8);
      m.userData.v = 0.2 + Math.random() * 0.4;
      s.add(m); this.floaters.push(m);
    }
    // the hero faces the camera; drag to spin them, they turn back to you after a moment
    this.yaw = 0; this.yawVel = 0; this.idleT = 0;
    this.dragging = false;
    addEventListener('pointerdown', (e) => { if (this.visible && e.target.tagName === 'CANVAS') { this.dragging = true; this.lastX = e.clientX; } });
    addEventListener('pointerup', () => (this.dragging = false));
    addEventListener('pointermove', (e) => { if (this.dragging) { const d = (e.clientX - this.lastX) * 0.012; this.yaw += d; this.yawVel = d * 60; this.idleT = 0; this.lastX = e.clientX; } });
    this.visible = false;
    this.emoteT = 0;
  }

  setSkin(id) {
    const skin = SKIN_BY_ID[id];
    if (!skin) return;
    if (this.model) this.scene.remove(this.model.root);
    const h = buildHero(skin.model);
    const fitted = h.frame;
    const root = new THREE.Group(); root.add(fitted);
    const fake = { materials: h.materials, headBone: h.headBone, bones: h.bones };
    applySkin(fake, skin);
    const { mixer, actions, bones } = h;
    actions.Idle_A.play();
    this.model = { root, mixer, actions, fake, bones, skin, poser: new Poser(fitted, bones), cur: 'Idle_A', idleT: 0 };
    this.scene.add(root);
    this.emote = null;
    this.popT = 0; // little bounce when a new outfit appears
  }

  // crossfade the lobby hero to a clip
  fadeTo(name) {
    const m = this.model; const a = m.actions[name]; if (!a || m.cur === name) return;
    const prev = m.actions[m.cur];
    a.reset(); a.setLoop(THREE.LoopRepeat); a.setEffectiveWeight(1); a.play();
    if (prev) prev.crossFadeTo(a, 0.25, false);
    m.cur = name;
  }

  playEmote(id) {
    const m = this.model; if (!m) return;
    const e = EMOTES.find((x) => x.id === id);
    this.emote = id; this.emoteT = 0; this.idleT = 99;
    const anim = id.startsWith('dance:') ? 'Idle_A' : e && e.anim ? e.anim : id;
    m.cur = null; for (const a of Object.values(m.actions)) a.stop();
    this.fadeTo(m.actions[anim] ? anim : 'Idle_A');
  }

  show() {
    this.visible = true;
    this.game.renderer.renderPass.scene = this.scene;
    this.game.renderer.vignette.uniforms.uStorm.value = 0;
    this.game.renderer.vignette.uniforms.uDamage.value = 0;
    if (!this.model || this.model.skin.id !== this.game.save.data.skin) this.setSkin(this.game.save.data.skin);
    this.camera.fov = 40; this.camera.updateProjectionMatrix();
  }
  hide() { this.visible = false; }

  update(dt) {
    const t = this.game.time;
    this.camera.position.set(this.offsetX ?? -0.9, 1.25, 5.6);
    this.camera.lookAt((this.offsetX ?? 0.5) + 0.0, 0.95, 0);
    if (this.model) {
      const m = this.model;
      // face the camera (slight 3/4 turn); after a drag, coast then swing back to face you
      const front = Math.atan2(this.camera.position.x, this.camera.position.z) + 0.15;
      if (!this.dragging) {
        this.yaw += this.yawVel * dt; this.yawVel *= Math.exp(-4 * dt);
        this.idleT += dt;
        if (this.idleT > 2.5) {
          let d = front - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.yaw += d * (1 - Math.exp(-3 * dt));
        }
      }
      m.root.rotation.y = this.yaw;
      this.popT += dt;
      const p = Math.min(1, this.popT / 0.45), sq = 1 + Math.sin(p * Math.PI * 2.5) * (1 - p) * 0.12;
      m.root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      m.poser.restore();
      m.mixer.update(dt);
      m.poser.begin();
      if (this.emote && this.emote.startsWith('dance:')) { this.emoteT += dt; applyDance(m.poser, this.emote, this.emoteT); }
      else if (!this.emote) POSES.lobbyIdle(m.poser, t);
      animateSkin(m.fake, t);
    }
    this.ring.material.color.setHSL((t * 0.08) % 1, 1, 0.6);
    for (const f of this.floaters) { f.position.y += f.userData.v * dt; f.rotation.x += dt * 0.5; if (f.position.y > 6) f.position.y = -2; }
  }
}
