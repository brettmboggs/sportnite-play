import * as THREE from 'three';
import { formatTime, clamp } from '../engine/utils.js';
import { RARITIES, AMMO, ELEMENTS, PERKS, ULTIMATES } from '../game/weapons/data.js';
import { POIS } from '../world/world.js';
import { MAT_ORDER } from '../game/building.js';
import { xpForLevel } from '../meta/progression.js';
import { SKIN_BY_ID } from '../game/skins.js';
import { glyph, padGlyph, keyGlyph } from './glyphs.js';
import { audio } from '../engine/audio.js';

const el = (cls, html = '', tag = 'div') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
const rc = (r) => (RARITIES[r].color === 'rainbow' ? 'var(--rainbow)' : RARITIES[r].color);
const rcSolid = (r) => (RARITIES[r].color === 'rainbow' ? '#ff6bd5' : RARITIES[r].color);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = { pistol: '🔫', revolver: '🔫', smg: '🔫', ar: '🔫', burst: '🔫', shotgun: '💥', sniper: '🎯', minigun: '🌀', rocket: '🚀', grenadeLauncher: '💣', bow: '🏹', crossbow: '🏹', sword: '🗡️', hammer: '🔨', freezeRay: '❄️', lightningGun: '⚡', bubble: '🫧', boomerang: '🪃', chicken: '🐔', paint: '🎨', golfSniper: '⛳', soccerCannon: '⚽', grenade: '💣', fireGrenade: '🔥', slamDunk: '🏀', blackHole: '🕳️', bat: '🏏' };
const MAT_ICON = { wood: '🪵', brick: '🧱', metal: '🔩' };
const RING_C = 2 * Math.PI * 26; // reload ring circumference (r = 26)
const CP_W = 560, PPD = 4; // compass: visible width (px) and pixels per degree (so it shows about ±70°)
const CP_LETTERS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const MILESTONES = [50, 25, 10, 5, 3, 2]; // "N PLAYERS REMAIN" announcements
const MULTI = ['', '', 'DOUBLE ELIM!', 'TRIPLE ELIM!', 'QUAD ELIM!', 'UNSTOPPABLE!'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// one-shot "pop" without forcing a reflow (Web Animations API)
const anim = (e, frames, ms = 260, easing = 'cubic-bezier(.2,1.6,.4,1)') => { if (e && e.animate) e.animate(frames, { duration: ms, easing }); };

export class Hud {
  constructor(game) {
    this.game = game;
    const ui = document.getElementById('ui');
    this.root = el('hud hidden');
    ui.appendChild(this.root);
    this.root.innerHTML = `
      <div class="low-hp"></div>
      <div class="compass"><div class="cp-window"><div class="cp-strip"></div></div><div class="cp-marks"></div><div class="cp-center"><i></i><b class="cp-deg">0</b></div></div>
      <div class="announce hidden"><div class="an-title"></div><div class="an-sub"></div></div>
      <div class="hud-tl">
        <div class="challenge hidden"></div>
      </div>
      <div class="hud-tr">
        <div class="map-wrap"><canvas class="minimap" width="240" height="240"></canvas><div class="map-compass"></div></div>
        <div class="hud-info">
          <div class="storm-box"><span class="storm-ico">⚡</span><span class="storm-timer">--:--</span><span class="storm-label">STORM FORMING</span></div>
          <div class="counts"><span class="alive" title="Players left"><i>👤</i><b>--</b></span><span class="kills" title="Eliminations"><i>💀</i><b>0</b></span></div>
        </div>
      </div>
      <div class="killfeed"></div>
      <div class="crosshair"><div class="ch-dot"></div><div class="ch-l"></div><div class="ch-r"></div><div class="ch-t"></div><div class="ch-b"></div></div>
      <svg class="ring hidden" viewBox="0 0 60 60"><circle class="ring-bg" cx="30" cy="30" r="26"/><circle class="ring-fg" cx="30" cy="30" r="26" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
      <div class="ring-label hidden"></div>
      <div class="reload-cue hidden"></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="dmg-dirs"></div>
      <div class="scope hidden"><div class="scope-ring"></div></div>
      <div class="prompt hidden"></div>
      <div class="toasts"></div>
      <div class="bigmsg hidden"><div class="big-title"></div><div class="big-sub"></div></div>
      <div class="elim-banner hidden"><div class="eb-multi"></div><div class="eb-row"><div class="eb-main"><span class="eb-top">ELIMINATED</span><span class="eb-name"></span></div><div class="eb-count"><b>0</b><small>ELIMS</small></div></div></div>
      <div class="death-card hidden"><div class="dc-place"></div><div class="dc-main"><div class="dc-title"></div><div class="dc-sub"></div></div></div>
      <div class="hud-bl">
        <div class="statuses"></div>
        <div class="vitals">
          <div class="bar shield-bar"><i class="bar-ico">🛡️</i><div class="track"><div class="chip"></div><div class="fill"></div><div class="ticks"></div><div class="crack"></div></div><span class="num">0</span><div class="shards"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
          <div class="bar health-bar"><i class="bar-ico">✚</i><div class="track"><div class="chip"></div><div class="fill"></div><div class="ticks"></div></div><span class="num">100</span></div>
          <div class="stamina"><div class="stamina-fill"></div></div>
        </div>
      </div>
      <div class="hud-bc">
        <div class="skills"></div>
        <div class="ult"></div>
      </div>
      <div class="hud-br">
        <div class="pickup-feed"></div>
        <div class="mats"></div>
        <div class="wrow">
          <div class="swap-label"><span class="sl-rar"></span><span class="sl-name"></span><span class="sl-perks"></span></div>
          <div class="weapon-info"><div class="wammo"><b></b><small></small></div></div>
        </div>
        <div class="hotbar"></div>
        <div class="build-bar hidden"></div>
        <div class="br-foot"><div class="ammo-list"></div><div class="gold">🪙 0</div></div>
      </div>
      <div class="bus-hint hidden"><div class="bh-jump"></div><div class="bh-thanks"></div></div>
      <div class="spectate hidden"></div>
      <div class="fullmap hidden"><canvas width="900" height="900"></canvas><div class="fullmap-hint"></div></div>
      <div class="results hidden"></div>
      <div class="fps hidden"></div>
    `;
    this.q = (s) => this.root.querySelector(s);
    this.mini = this.q('.minimap').getContext('2d');
    this.mapCanvas = this.q('.fullmap canvas');
    this.dmgLayer = el('dmg-layer'); ui.appendChild(this.dmgLayer);
    this.mapImage = null;
    this.invDirty = true;
    this.bars = { health: { shown: 100, chip: 100, hold: 0 }, shield: { shown: 0, chip: 0, hold: 0 } };
    game.events.on('inventory', (ch) => { if (ch === game.player) this.invDirty = true; });
    game.events.on('pickup', (ch) => { if (ch === game.player) this.invDirty = true; });
    for (const ev of ['shot', 'reload', 'harvest', 'build']) game.events.on(ev, (ch) => { if (ch === game.player) this.invDirty = true; });
    // crosshair kick on every shot (guns with a live spread cone kick a bit less: the cone already blooms)
    game.events.on('shot', (ch, w) => {
      if (ch !== game.player || (w && w.def && w.def.mode === 'melee')) return;
      this.kick = Math.min(1, (this.kick || 0) + (typeof ch.spreadNow === 'number' ? 0.3 : 0.45));
    });
    game.events.on('shieldBreak', (target, source) => {
      if (source && source === game.player && target !== game.player) this.shieldBreakMarker();
      if (target === game.player) this.ownShieldBroke();
    });
    game.events.on('damage', (e) => this.onDamage(e));
    game.events.on('pickup', (ch, it) => { if (ch === game.player) this.feedPickup(it); });
    game.events.on('matchOver', (m) => this.deathCard(m));
    this.fpsT = 0; this.frames = 0;
    this.kick = 0;
    this.lastPad = null;
    this.tmpV = new THREE.Vector3(); this.tmpDir = new THREE.Vector3();
    this.stacks = new Map(); this.stackPool = [];
    this.feed = [];
    this.annQ = []; this.ann = null;
    this.cpMarks = [];
    this.cpStrip = this.q('.cp-strip');
    this.buildCompass();
    this.buildHotbar();
    this.resetMatchUi();
    this.applyHudSettings();
  }

  // ---------- compass ----------
  // A long strip of degree ticks (−180°…540°) built once; each frame only its translateX changes.
  buildCompass() {
    let h = '';
    for (let d = -180; d <= 540; d += 15) {
      const n = ((d % 360) + 360) % 360, lab = CP_LETTERS[n];
      h += `<span class="${lab ? `cp-l${lab.length === 1 ? ' cp-card' : ''}${n === 0 ? ' north' : ''}` : 'cp-n'}" style="left:${(d + 180) * PPD}px">${lab || n}</span>`;
    }
    this.cpStrip.innerHTML = h;
    this.cpStrip.style.width = `${720 * PPD + 2}px`;
    this.q('.compass').style.setProperty('--cpw', `${CP_W}px`);
  }

  renderCompass() {
    const g = this.game, cam = g.renderer.camera, p = g.player;
    cam.getWorldDirection(this.tmpDir);
    let h = (Math.atan2(this.tmpDir.x, -this.tmpDir.z) * 180) / Math.PI;
    h = (h + 360) % 360;
    const x = Math.round((CP_W / 2 - (h + 180) * PPD) * 2) / 2;
    if (x !== this.cpX) { this.cpX = x; this.cpStrip.style.transform = `translate3d(${x}px,0,0)`; }
    this.setText('.cp-deg', Math.round(h) % 360);
    // markers: storm eye (safe zone) + supply drops
    const marks = [];
    const from = p.alive ? p.pos : cam.position;
    const st = g.match && g.match.storm;
    if (st && st.phase >= 0) {
      const c = st.next || st.current;
      const d = Math.hypot(c.x - from.x, c.z - from.z) - c.r;
      marks.push({ kind: 'storm', x: c.x, z: c.z, txt: d > 0 ? `${Math.round(d)}m` : '', inside: d <= 0 });
    }
    for (const ch of g.loot.chests) {
      if (!ch.supply || ch.opened) continue;
      marks.push({ kind: 'supply', x: ch.pos.x, z: ch.pos.z, txt: `${Math.round(Math.hypot(ch.pos.x - from.x, ch.pos.z - from.z))}m` });
      if (marks.length > 6) break;
    }
    const layer = this.q('.cp-marks');
    while (this.cpMarks.length < marks.length) { const e = el('cp-mark', '<i></i><small></small>'); layer.appendChild(e); this.cpMarks.push(e); }
    for (let i = 0; i < this.cpMarks.length; i++) {
      const e = this.cpMarks[i], m = marks[i];
      if (!m) { if (!e.hidden) e.hidden = true; continue; }
      if (e.hidden) e.hidden = false;
      const b = (Math.atan2(m.x - from.x, -(m.z - from.z)) * 180) / Math.PI;
      const delta = ((b - h + 540) % 360) - 180;
      let px = CP_W / 2 + delta * PPD;
      const edge = px < 14 ? 'l' : px > CP_W - 14 ? 'r' : '';
      px = clamp(px, 14, CP_W - 14);
      const cls = `cp-mark ${m.kind}${m.inside ? ' inside' : ''}${edge ? ` edge ${edge}` : ''}`;
      if (e.className !== cls) e.className = cls;
      const tx = `translate3d(${px.toFixed(1)}px,0,0)`;
      if (e._tx !== tx) { e._tx = tx; e.style.transform = tx; }
      const small = e.lastChild;
      if (small.textContent !== m.txt) small.textContent = m.txt;
    }
  }

  // ---------- center-top announcements (storm, players remaining) ----------
  announce(title, sub = '', kind = 'storm', dur = 3.2) {
    // the same message twice in a row just refreshes the timer
    if (this.ann && this.ann.title === title) { this.ann.t = 0; return; }
    // newer storm news replaces older storm news that hasn't finished showing
    const grp = kind.split(' ')[0];
    this.annQ = this.annQ.filter((a) => a.kind.split(' ')[0] !== grp);
    if (this.ann && this.ann.kind.split(' ')[0] === grp) this.ann.t = Math.max(this.ann.t, this.ann.dur);
    this.annQ.push({ title, sub, kind, dur, t: 0 });
    if (this.annQ.length > 3) this.annQ.shift();
  }

  updateAnnounce(dt) {
    const box = this.q('.announce');
    if (!this.ann && this.annQ.length) {
      this.ann = this.annQ.shift();
      box.className = `announce ${this.ann.kind}`;
      box.firstChild.textContent = this.ann.title;
      box.lastChild.textContent = this.ann.sub;
      anim(box, [{ scale: 1.5, opacity: 0 }, { scale: 1, opacity: 1 }], 380);
    }
    if (!this.ann) return;
    this.ann.t += dt;
    if (this.ann.t > this.ann.dur) {
      if (!box.classList.contains('out')) box.classList.add('out');
      if (this.ann.t > this.ann.dur + 0.35) { box.classList.add('hidden'); this.ann = null; }
    }
  }

  // HUD scales with the window (1280x720 up to 1440p+) times the player's HUD size setting
  applyHudSettings() {
    const s = this.game.settings || {};
    const k = clamp(Math.min(innerHeight / 950, innerWidth / 1690), 0.8, 1.5) * (s.hudScale || 1);
    this.hudK = k;
    document.documentElement.style.setProperty('--hud-k', k.toFixed(3));
    if (!this.resizeHooked) { this.resizeHooked = true; addEventListener('resize', () => this.applyHudSettings()); }
  }

  show() {
    this.root.classList.remove('hidden');
    this.q('.results').classList.add('hidden');
    this.q('.results').innerHTML = '';
    this.q('.killfeed').innerHTML = '';
    this.q('.spectate').classList.add('hidden');
    this.invDirty = true;
    this.bars.health = { shown: 100, chip: 100, hold: 0 };
    this.bars.shield = { shown: 0, chip: 0, hold: 0 };
    this.resetMatchUi();
    this.buildMapImage();
    this.applyHudSettings();
  }
  hide() { this.root.classList.add('hidden'); this.clearStacks(); this.q('.fullmap').classList.add('hidden'); this.mapOpen = false; }

  // everything that belongs to one match
  resetMatchUi() {
    this.clearStacks();
    for (const r of this.feed) r.el.remove();
    this.feed = [];
    this.annQ = []; this.ann = null; this.q('.announce').classList.add('hidden');
    this.q('.death-card').classList.add('hidden');
    this.q('.elim-banner').classList.add('hidden');
    this.prevAlive = null; this.saidMilestone = new Set();
    this.stormSeen = { phase: -2, shrinking: false, timer: 0, formed: false };
    this.thanked = false; this.botThanks = null;
    this.multi = { n: 0, t: -99 };
    this.heldKey = undefined; this.swapT = 0;
    this.myDeath = null;
    this.ringWas = '';
    this.q('.swap-label').classList.remove('show');
  }

  // ---------- minimap ----------
  buildMapImage() {
    if (this.mapImage) return;
    const t = this.game.world.terrain;
    const N = 300, c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
    const col = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * 1100, z = (j / N - 0.5) * 1100;
      const h = t.heightAt(x, z);
      if (h < 0.5) col.set(h < -4 ? '#1a7fd0' : '#3fb6ef');
      else { t.colorAt(x, h, z, t.normalAt(x, z).y, col); const shade = 0.85 + clamp(h / 120, 0, 0.3); col.multiplyScalar(shade); }
      col.convertLinearToSRGB();
      const k = (j * N + i) * 4;
      img.data[k] = col.r * 255; img.data[k + 1] = col.g * 255; img.data[k + 2] = col.b * 255; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // city roads
    ctx.strokeStyle = 'rgba(60,64,72,0.8)'; ctx.lineWidth = 1.5;
    for (let k = -4; k <= 4; k++) { const p = ((k * 48 + 3.5) / 1100 + 0.5) * N; ctx.beginPath(); ctx.moveTo(p, N * 0.35); ctx.lineTo(p, N * 0.65); ctx.stroke(); ctx.beginPath(); ctx.moveTo(N * 0.35, p); ctx.lineTo(N * 0.65, p); ctx.stroke(); }
    // faint grid like a real map
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let k = 1; k < 10; k++) { const p = (k / 10) * N; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke(); }
    this.mapImage = c;
  }

  drawArrow(ctx, x, y, rot, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#12082e'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  drawMap(ctx, size, mini) {
    const g = this.game, p = g.player;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (mini) {
      const c = p.pos;
      const R = 10;
      ctx.beginPath(); ctx.roundRect(0, 0, size, size, R); ctx.clip();
      ctx.fillStyle = '#1a7fd0'; ctx.fillRect(0, 0, size, size);
      ctx.translate(size / 2, size / 2); ctx.rotate(g.cameraRig.yaw);
      const s = size / 280;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.mapImage, -(c.x + 550) * s, -(c.z + 550) * s, 1100 * s, 1100 * s);
      const tm = (x, z) => [(x - c.x) * s, (z - c.z) * s];
      this.drawStorm(ctx, tm, s, [0, 0]);
      for (const ch of g.loot.chests) if (ch.supply && !ch.opened) { const [x, y] = tm(ch.pos.x, ch.pos.z); ctx.fillStyle = '#48b6ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
      for (const b of g.match ? g.match.bosses : []) if (b.alive) { const [x, y] = tm(b.pos.x, b.pos.z); ctx.save(); ctx.translate(x, y); ctx.rotate(-g.cameraRig.yaw); ctx.font = '15px serif'; ctx.textAlign = 'center'; ctx.fillText('👑', 0, 5); ctx.restore(); }
      ctx.restore();
      // player arrow in the middle (the map turns, you always face up)
      this.drawArrow(ctx, size / 2, size / 2, 0, 1);
      return;
    }
    ctx.drawImage(this.mapImage, 0, 0, size, size);
    const s = size / 1100;
    const tm = (x, z) => [(x + 550) * s, (z + 550) * s];
    this.drawStorm(ctx, tm, s, p ? tm(p.pos.x, p.pos.z) : null);
    ctx.font = 'bold 16px Lilita One, sans-serif'; ctx.textAlign = 'center';
    for (const poi of POIS) {
      const [x, y] = tm(poi.x, poi.z);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(18,8,46,0.75)'; ctx.strokeText(poi.name.toUpperCase(), x, y);
      ctx.fillStyle = '#fff'; ctx.fillText(poi.name.toUpperCase(), x, y);
    }
    if (g.match && g.match.blimp.visible) {
      const bp = g.match.busPath; const [x1, y1] = tm(bp.from.x, bp.from.z), [x2, y2] = tm(bp.to.x, bp.to.z);
      ctx.setLineDash([10, 8]); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      const [bx, by] = tm(g.match.blimp.position.x, g.match.blimp.position.z); ctx.font = '24px serif'; ctx.fillText('🎈', bx, by + 8);
    }
    for (const ch of g.loot.chests) if (ch.supply && !ch.opened) { const [x, y] = tm(ch.pos.x, ch.pos.z); ctx.font = '18px serif'; ctx.fillText('🎁', x, y + 6); }
    for (const b of g.match ? g.match.bosses : []) if (b.alive) { const [x, y] = tm(b.pos.x, b.pos.z); ctx.font = '18px serif'; ctx.fillText('👑', x, y + 6); }
    for (const z of g.world.minigames) { const [x, y] = tm(z.x, z.z); ctx.font = '16px serif'; ctx.fillText(z.type === 'hoops' ? '🏀' : z.type === 'penalty' ? '⚽' : '⚾', x, y - 14); }
    if (p) { const [x, y] = tm(p.pos.x, p.pos.z); this.drawArrow(ctx, x, y, -g.cameraRig.yaw, 1.4); }
    ctx.restore();
  }

  // storm outside = purple, next circle = white ring, path = white dashes from you to the safe zone
  drawStorm(ctx, tm, s, me) {
    const st = this.game.storm || this.game.match?.storm;
    if (!st || st.phase < 0) return;
    const [cx, cy] = tm(st.current.x, st.current.z);
    ctx.save();
    ctx.fillStyle = 'rgba(120, 40, 200, 0.5)';
    ctx.beginPath(); ctx.rect(-3000, -3000, 6000, 6000); ctx.arc(cx, cy, Math.max(0.1, st.current.r * s), 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = '#e0a8ff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, st.current.r * s, 0, Math.PI * 2); ctx.stroke();
    if (st.next) {
      const [nx, ny] = tm(st.next.x, st.next.z), nr = st.next.r * s;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(nx, ny, Math.max(1, nr), 0, Math.PI * 2); ctx.stroke();
      if (me) {
        const dx = nx - me[0], dy = ny - me[1], d = Math.hypot(dx, dy);
        if (d > nr) {
          const ex = me[0] + (dx / d) * (d - nr), ey = me[1] + (dy / d) * (d - nr);
          ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(me[0], me[1]); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();
  }

  toggleMap() {
    const m = this.q('.fullmap');
    m.classList.toggle('hidden');
    this.mapOpen = !m.classList.contains('hidden');
    if (this.mapOpen) this.q('.fullmap-hint').innerHTML = `${glyph(this.game, 'map')} Close map`;
  }

  // ---------- per-frame ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (!p) return;
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { const f = this.q('.fps'); f.textContent = `${Math.round(this.frames / this.fpsT)} FPS`; f.classList.toggle('hidden', !g.settings.showFps); this.frames = 0; this.fpsT = 0; }
    if (g.minigames.active) { this.root.classList.add('mg-mode'); return; }
    this.root.classList.remove('mg-mode');
    const usePad = !!g.input.usingPad;
    if (usePad !== this.lastPad) { this.lastPad = usePad; this.invDirty = true; this.root.classList.toggle('pad', usePad); }
    const m = g.match;
    this.drawMap(this.mini, 240, true);
    if (this.mapOpen) this.drawMap(this.mapCanvas.getContext('2d'), 900, false);
    this.q('.map-compass').style.transform = `rotate(${g.cameraRig.yaw}rad)`;
    this.renderCompass();
    this.renderStorm(m, dt);
    this.updateAnnounce(dt);
    this.setText('.kills b', p.kills);
    this.renderBus(m);
    this.renderBars(dt);
    // statuses
    const st = p.status, sts = [];
    if (st.burn > 0) sts.push(['🔥', 'Burning']); if (st.slow > 0 || st.frozen > 0) sts.push(['❄️', 'Frozen']); if (st.poison > 0) sts.push(['☠️', 'Poison']);
    if (st.speedBoost > 0) sts.push(['⚡', 'Speed']); if (st.invisible > 0) sts.push(['👻', 'Invisible']); if (p.mvpT > 0) sts.push(['🏆', 'MVP']);
    this.setHtml(this.q('.statuses'), sts.map(([i, n]) => `<span class="status">${i}<small>${n}</small></span>`).join(''));
    if (this.invDirty) { this.renderInventory(); this.invDirty = false; }
    this.renderWeaponInfo(dt);
    this.renderSkills();
    this.renderBuild();
    this.renderCrosshair(dt);
    this.renderPrompt();
    this.renderChallenge();
    this.renderSpectate(m);
    this.updateDamageNumbers(dt);
    this.updateFeed(dt);
  }

  // In the blimp: jump prompt + "Thank the Driver" (keyboard B / controller ▶, the 'skill2' action, which
  // nothing else reads while you're still on board)
  renderBus(m) {
    const g = this.game, p = g.player, bus = this.q('.bus-hint');
    const onBus = !!(m && m.phase === 'bus' && p.state === 'bus');
    bus.classList.toggle('hidden', !onBus);
    if (!onBus) return;
    this.setHtml(bus.firstChild, `${glyph(g, 'jump')} Jump from the blimp!`);
    this.setHtml(bus.lastChild, this.thanked ? '👍 Thanked!' : `${glyph(g, 'skill2')} Thank the Driver`);
    bus.lastChild.classList.toggle('done', this.thanked);
    if (!this.thanked && g.input.pressed('skill2')) {
      this.thanked = true;
      this.feedLine('👍 You thanked the driver!', 'thanks mine');
      audio.ui('select');
      anim(bus.lastChild, [{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], 320);
    }
    // a few bots are polite too
    if (!this.botThanks) {
      const bots = g.chars.filter((c) => c.brain && !c.isBoss).sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
      this.botThanks = bots.map((c) => ({ name: c.name, at: m.time + 1.5 + Math.random() * 7 }));
    }
    for (const b of this.botThanks) if (!b.done && m.time >= b.at) { b.done = true; this.feedLine(`👍 ${esc(b.name)} thanked the driver`, 'thanks'); }
  }

  // a plain line in the kill feed (thanks, notes)
  feedLine(html, cls = '') {
    const feed = this.q('.killfeed');
    const line = el(`kf ${cls}`, html);
    feed.prepend(line);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 5000);
    setTimeout(() => line.remove(), 5800);
  }

  setText(sel, v) { const e = this.q(sel); const s = String(v); if (e.textContent !== s) e.textContent = s; }
  setHtml(e, html) { if (e._html !== html) { e._html = html; e.innerHTML = html; } }

  renderStorm(m) {
    if (!m || !m.storm) return;
    const st = m.storm, p = this.game.player;
    const box = this.q('.storm-box');
    const forming = st.phase < 0 || !st.next;
    const final = st.timer > 999;
    this.setText('.storm-timer', final ? '--:--' : formatTime(Math.max(0, st.timer)));
    const outNext = st.phase >= 0 && p.alive ? st.distanceOutside(p.pos, true) : -1;
    const label = st.shrinking ? 'STORM EYE SHRINKING' : final ? 'FINAL CIRCLE' : forming ? 'STORM EYE FORMING' : 'STORM EYE SHRINKS IN';
    this.setText('.storm-label', outNext > 0 && !final ? `${label} · ${Math.round(outNext)}m` : label);
    this.setText('.storm-ico', st.shrinking ? '🌀' : '⚡');
    box.classList.toggle('closing', st.shrinking);
    const out = st.distanceOutside ? st.distanceOutside(p.pos) : -1;
    box.classList.toggle('outside', out > 0 && p.alive);
    // Fortnite-style announcements, worked out from the storm's state (no extra hooks needed)
    const s = this.stormSeen;
    if (m.phase !== 'bus' && !m.over) {
      if (st.phase < 0 && !s.formed) { s.formed = true; this.announce('STORM EYE FORMING', `Safe zone appears in ${formatTime(st.timer)}`); }
      if (st.phase !== s.phase && st.phase >= 0 && st.next && !st.shrinking) {
        this.announce(`STORM EYE SHRINKS IN ${formatTime(st.timer)}`, outNext > 0 ? 'Head for the white circle on your map!' : "You're in the safe zone. Nice!");
      } else if (st.shrinking && !s.shrinking) {
        this.announce('STORM EYE SHRINKING', outNext > 0 ? 'Run! Stay ahead of the storm!' : 'Stay inside the white circle!', 'storm closing');
      } else if (!st.shrinking && st.next && st.phase === s.phase) {
        for (const mark of [60, 30]) if (s.timer > mark && st.timer <= mark) this.announce(`STORM EYE SHRINKS IN ${formatTime(mark)}`, outNext > 0 ? `Safe zone is ${Math.round(outNext)}m away` : '');
      }
      s.phase = st.phase; s.shrinking = st.shrinking; s.timer = st.timer;
    }
  }

  // Fortnite-style bars: fill drops instantly, a white "chip" lingers then drains; healing fills smoothly
  renderBars(dt) {
    const p = this.game.player;
    const set = (key, sel, val, max) => {
      const b = this.bars[key], bar = this.q(sel);
      const pct = clamp((val / max) * 100, 0, 100);
      if (pct < b.shown - 0.01) { if (b.chip < b.shown) b.chip = Math.max(b.chip, b.shown); else b.chip = b.shown; b.hold = 0.45; b.shown = pct; bar.classList.remove('hit'); void bar.offsetWidth; bar.classList.add('hit'); }
      else if (pct > b.shown) { b.shown = Math.min(pct, b.shown + dt * 140); if (pct - b.shown > 0.5) bar.classList.add('heal'); else bar.classList.remove('heal'); }
      else bar.classList.remove('heal');
      if (b.hold > 0) b.hold -= dt; else b.chip = Math.max(b.shown, b.chip - dt * 90);
      bar.querySelector('.fill').style.width = `${b.shown}%`;
      bar.querySelector('.chip').style.width = `${Math.max(b.chip, b.shown)}%`;
      const n = String(Math.ceil(val));
      const num = bar.querySelector('.num');
      if (num.textContent !== n) num.textContent = n;
      bar.classList.toggle('low', key === 'health' && val > 0 && val <= 30);
      bar.classList.toggle('empty', val <= 0);
    };
    set('health', '.health-bar', p.health, p.maxHealth);
    set('shield', '.shield-bar', p.shield + p.overshield, p.maxShield);
    this.q('.shield-bar').classList.toggle('over', p.overshield > 0);
    this.q('.stamina-fill').style.width = `${p.stamina}%`;
    this.q('.stamina').classList.toggle('locked', !!p.staminaLock);
    this.q('.stamina').classList.toggle('full', p.stamina >= 99.5);
    // low health: red edges that pulse harder the lower you are
    const lv = p.alive && p.state !== 'bus' && p.health <= 35 ? (p.health <= 15 ? 3 : p.health <= 25 ? 2 : 1) : 0;
    if (lv !== this.lowLv) { this.lowLv = lv; this.q('.low-hp').className = `low-hp${lv ? ` on l${lv}` : ''}`; }
  }

  ownShieldBroke() {
    const b = this.q('.shield-bar');
    b.classList.remove('broke'); void b.offsetWidth; b.classList.add('broke');
    clearTimeout(this.sbT); this.sbT = setTimeout(() => b.classList.remove('broke'), 700);
  }

  renderInventory() {
    const g = this.game, p = g.player, inv = p.inv;
    const pad = !!g.input.usingPad;
    const slots = [{ i: -1, item: p.pickaxe }, ...inv.slots.map((item, i) => ({ i, item }))];
    const building = !!g.playerCtl?.buildMode;
    this.q('.hotbar').classList.toggle('dim', building);
    // slot nodes are reused so the selected one animates (CSS transition) instead of being rebuilt
    slots.forEach(({ i, item }, k) => {
      const e = this.slotEls[k];
      const sel = inv.sel === i && !building;
      const key = pad ? '' : `<span class="key">${i < 0 ? 'X' : i + 1}</span>`;
      let cls, html, style = '';
      if (!item) { cls = `slot empty${sel ? ' sel' : ''}`; html = key; }
      else {
        const icon = item.type === 'weapon' ? ICON[item.id] || '🔫' : item.def.icon;
        const count = item.count > 1 ? `<span class="count">${item.count}</span>` : '';
        const elem = item.element ? `<span class="elem">${ELEMENTS[item.element].icon}</span>` : '';
        let ammo = '';
        if (item.type === 'weapon' && item.mag) ammo = `<span class="mag ${item.ammoInMag === 0 ? 'out' : ''}">${p.infiniteAmmo ? '∞' : item.ammoInMag}</span>`;
        cls = `slot r${item.rarity}${sel ? ' sel' : ''}`; style = `--rc:${rc(item.rarity)}`;
        html = `${key}<span class="icon">${icon}</span>${count}${elem}${ammo}`;
      }
      if (e.className !== cls) {
        const was = e.classList.contains('sel');
        e.className = cls;
        if (sel && !was) anim(e, [{ scale: 1.2 }, { scale: 1 }], 300);
      }
      if (e._style !== style) { e._style = style; e.setAttribute('style', style); }
      this.setHtml(e, html);
    });
    const ctl = g.playerCtl;
    this.q('.mats').innerHTML = MAT_ORDER.map((m, k) => `<div class="mat ${m} ${ctl && ctl.matIdx === k ? 'sel' : ''} ${inv.mats[m] < 10 ? 'low' : ''}"><span class="mat-icon">${MAT_ICON[m]}</span><b>${inv.mats[m]}</b></div>`).join('');
    this.q('.gold').textContent = `🪙 ${inv.gold}`;
    this.q('.ammo-list').innerHTML = Object.entries(inv.ammo).filter(([, n]) => n > 0).map(([k, n]) => `<span class="ammo-chip" style="--ac:${AMMO[k].color}"><i></i>${n}</span>`).join('');
  }

  buildHotbar() {
    const bar = this.q('.hotbar');
    this.slotEls = [];
    for (let k = 0; k < 6; k++) { const e = el('slot empty'); bar.appendChild(e); this.slotEls.push(e); }
  }

  renderWeaponInfo(dt) {
    const g = this.game, p = g.player;
    const building = !!g.playerCtl?.buildMode;
    const w = p.heldItem();
    const am = this.q('.wammo'), hint = this.q('.reload-cue');
    // swap: weapon name + rarity pops up next to the ammo for a moment (like Fortnite)
    const key = building ? 'build' : w ? `${w.uid ?? w.id}:${w.rarity}` : 'none';
    if (key !== this.heldKey) {
      const first = this.heldKey === undefined;
      this.heldKey = key;
      const sl = this.q('.swap-label');
      if (w && !building && !first) {
        sl.style.setProperty('--rc', rc(w.rarity));
        sl.style.setProperty('--rcs', rcSolid(w.rarity));
        sl.children[0].textContent = RARITIES[w.rarity].name;
        sl.children[1].textContent = w.name;
        sl.children[2].textContent = w.perks && w.perks.length ? w.perks.map((k) => PERKS[k].name).join(' · ') : '';
        sl.classList.add('show');
        anim(sl, [{ transform: 'translateX(18px) scale(.85)', opacity: 0 }, { transform: 'none', opacity: 1 }], 280);
        this.swapT = 1.8;
      } else { sl.classList.remove('show'); this.swapT = 0; }
    }
    if (this.swapT > 0) { this.swapT -= dt; if (this.swapT <= 0) this.q('.swap-label').classList.remove('show'); }
    let main = '', sub = '', cls = 'wammo', hintHtml = '';
    if (w && !building) {
      if (w.type === 'weapon' && w.mag) {
        const inf = p.infiniteAmmo;
        const reserve = w.def.ammo ? p.inv.ammo[w.def.ammo] : null;
        main = inf ? '∞' : String(w.ammoInMag);
        sub = inf || reserve === null ? '∞' : String(reserve);
        const empty = !inf && w.ammoInMag === 0, low = !inf && w.ammoInMag <= Math.ceil(w.mag * 0.25);
        cls += `${empty ? ' empty' : low ? ' low' : ''}${p.reloadT > 0 ? ' reloading' : ''}${!inf && reserve === 0 ? ' dry' : ''}`;
        if (empty && p.reloadT <= 0) hintHtml = reserve === 0 ? 'No ammo!' : `${glyph(g, 'reload')} Reload`;
      } else if (w.type !== 'weapon' && w.count) { main = String(w.count); sub = w.def.use ? 'use' : ''; cls += ' item'; }
    } else cls += ' none';
    if (am.className !== cls) am.className = cls;
    const b = am.firstChild, s = am.lastChild;
    if (b.textContent !== main) {
      // each shot ticks the number; a low mag flashes red on every shot
      if (main && b.textContent && +main < +b.textContent && cls.includes(' low')) anim(b, [{ transform: 'scale(1.3)', color: '#fff' }, { transform: 'scale(1)' }], 200, 'ease-out');
      b.textContent = main;
    }
    if (s.textContent !== sub) s.textContent = sub;
    this.setHtml(hint, hintHtml);
    hint.classList.toggle('hidden', !hintHtml);
    // reload / consume / charge ring around the crosshair
    const ring = this.q('.ring'), label = this.q('.ring-label');
    let prog = 0, lab = '', kind = '';
    if (p.useT > 0 && p.useItem) { prog = p.useT / p.useItem.def.use; lab = p.useItem.name; kind = 'use'; }
    else if (p.chargeT > 0 && w && w.def && w.def.charge) { prog = p.chargeT / w.def.charge; lab = 'CHARGING'; kind = 'charge'; }
    else if (p.reloadT > 0 && w && w.reload) { prog = 1 - p.reloadT / w.reload; lab = 'RELOADING'; kind = 'reload'; }
    ring.classList.toggle('hidden', !prog);
    label.classList.toggle('hidden', !prog);
    if (prog) {
      ring.querySelector('.ring-fg').setAttribute('stroke-dashoffset', String(RING_C * (1 - clamp(prog, 0, 1))));
      if (label.textContent !== lab) label.textContent = lab;
      const rcls = `ring ${kind}`;
      if (ring.getAttribute('class') !== rcls) ring.setAttribute('class', rcls);
    } else if (this.ringWas === 'reload' && this.ringW === w && w && w.ammoInMag > 0) {
      // reload finished: quick flash on the crosshair and ammo counter
      anim(this.q('.crosshair'), [{ transform: 'scale(1.6)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], 220, 'ease-out');
      anim(b, [{ transform: 'scale(1.35)', color: '#9dff7a' }, { transform: 'scale(1)' }], 300);
    }
    this.ringWas = kind; this.ringW = w;
  }

  renderSkills() {
    const g = this.game, p = g.player, ctl = g.playerCtl;
    const html = p.inv.skills.map((s, i) => {
      const key = glyph(g, i ? 'skill2' : 'skill1');
      if (!s) return `<div class="skill empty"><span class="sk-key">${key}</span></div>`;
      const cdLeft = s.def.charges ? (s.charges > 0 ? 0 : s.cooldownLeft) : s.cooldownLeft;
      const cd = cdLeft > 0 ? Math.ceil(cdLeft) : '';
      const frac = cdLeft > 0 && s.def.cooldown ? clamp(cdLeft / s.def.cooldown, 0, 1) : 0;
      const extra = s.def.charges ? `<span class="charges">${s.charges}</span>` : s.id === 'jetpack' ? `<span class="charges">${Math.round((s.fuel / s.def.fuel) * 100)}%</span>` : '';
      return `<div class="skill ${cd ? 'cd' : 'ready'}" style="--cd:${frac * 360}deg" title="${esc(s.def.desc)}"><span class="sk-key">${s.def.passive ? '<span class="glyph key">✓</span>' : key}</span><span class="icon">${s.def.icon}</span>${cd ? `<span class="cdnum">${cd}</span>` : ''}${extra}<span class="sname">${esc(s.name)}</span></div>`;
    }).join('');
    this.setHtml(this.q('.skills'), html);
    const ult = this.q('.ult');
    let uh;
    if (ctl && ctl.ultReady.length) {
      const u = ULTIMATES.find((x) => x.id === ctl.ultReady[0]);
      uh = `<span class="icon">${u.icon}</span> ${u.name} ${glyph(g, 'ultimate')}`;
      ult.classList.remove('dim');
    } else {
      const next = ULTIMATES.find((x) => x.streak > p.streak);
      uh = next ? `<span class="streak-pips">${Array.from({ length: next.streak }, (_, k) => `<i class="${k < p.streak ? 'on' : ''}"></i>`).join('')}</span> ${next.icon} <small>${next.name}</small>` : '🏆 MAX STREAK';
      ult.classList.add('dim');
    }
    this.setHtml(ult, uh);
  }

  renderBuild() {
    const g = this.game, ctl = g.playerCtl;
    const bar = this.q('.build-bar');
    const on = !!(ctl && ctl.buildMode);
    if (on !== this.wasBuild) { this.wasBuild = on; this.invDirty = true; this.root.classList.toggle('building', on); }
    if (!on) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const icons = {
      wall: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5"/></svg>',
      floor: '<svg viewBox="0 0 24 24"><path d="M2 15 L8 9 H22 L16 15 Z"/></svg>',
      ramp: '<svg viewBox="0 0 24 24"><path d="M3 20 L21 4 V20 Z"/></svg>',
      cone: '<svg viewBox="0 0 24 24"><path d="M12 3 L22 20 H2 Z"/></svg>',
    };
    const mat = MAT_ORDER[ctl.matIdx], count = g.player.inv.mats[mat];
    const html = ['wall', 'floor', 'ramp', 'cone'].map((k, i) => `<div class="piece ${ctl.piece === k ? 'sel' : ''}"><span class="pc-key">${g.input.usingPad ? glyph(g, k) : keyGlyph(String(i + 1))}</span>${icons[k]}<small>${k}</small></div>`).join('')
      + `<div class="piece mat ${mat} ${count < 10 ? 'low' : ''}"><span class="pc-key">${glyph(g, 'material')}</span><span class="mat-big">${MAT_ICON[mat]}</span><small>${count} ${mat}</small></div>`;
    this.setHtml(bar, html);
  }

  renderCrosshair(dt) {
    const p = this.game.player, w = p.heldItem();
    const ch = this.q('.crosshair');
    const scoped = this.game.cameraRig.scoped;
    this.q('.scope').classList.toggle('hidden', !scoped);
    ch.classList.toggle('hidden', scoped || p.state !== 'ground' || !p.alive);
    let spread = 7;
    if (w && w.type === 'weapon') {
      if (typeof p.spreadNow === 'number') {
        // real cone half-angle -> pixels on screen, so the crosshair matches where bullets can go
        const cam = this.game.renderer.camera;
        const px = (Math.tan(p.spreadNow) / Math.tan((cam.fov * Math.PI) / 360)) * (innerHeight / 2);
        spread = 4 + px;
      } else spread = 5 + ((p.aiming ? w.adsSpread : w.spread) || 0) * 600 * (p.sprinting ? 1.5 : 1) * (p.grounded ? 1 : 1.6);
    }
    this.kick = Math.max(0, this.kick - dt * 5);
    spread += this.kick * 14;
    if (this.game.playerCtl?.buildMode) spread = 3;
    const target = Math.min(64, spread);
    this.spread = this.spread === undefined ? target : this.spread + (target - this.spread) * Math.min(1, dt * 18);
    ch.style.setProperty('--spread', `${this.spread.toFixed(1)}px`);
    ch.classList.toggle('shotgun', !!(w && w.def && w.def.pellets));
    ch.classList.toggle('build', !!this.game.playerCtl?.buildMode);
    ch.classList.toggle('melee', !!(w && w.def && w.def.mode === 'melee'));
  }

  renderPrompt() {
    const g = this.game, ctl = g.playerCtl, pr = this.q('.prompt');
    const p = ctl && ctl.prompt;
    if (!p || !g.player.alive) { pr.classList.add('hidden'); this.lastPrompt = null; return; }
    if (pr.classList.contains('hidden')) { pr.classList.remove('hidden'); pr.classList.remove('pop'); void pr.offsetWidth; pr.classList.add('pop'); }
    const hasR = p.rarity !== undefined;
    const name = `<div class="pr-name" ${hasR ? `style="color:${rcSolid(p.rarity)}"` : ''}>${esc(p.name)}${p.count > 1 ? ` <small>x${p.count}</small>` : ''}</div>`;
    const rar = hasR ? `<div class="pr-rarity" style="--rc:${rc(p.rarity)}">${RARITIES[p.rarity].name}</div>` : '';
    const prog = p.progress ? `<div class="prompt-prog"><div style="width:${clamp(p.progress, 0, 1) * 100}%"></div></div>` : '';
    const html = `${hasR ? `<div class="pr-stripe" style="--rc:${rc(p.rarity)}"></div>` : ''}<div class="pr-body">${name}${rar}${p.verb ? `<div class="pr-act">${glyph(g, 'interact')} ${esc(p.verb)}</div>` : ''}${prog}</div>`;
    this.setHtml(pr, html);
  }

  renderChallenge() {
    const m = this.game.match, c = this.q('.challenge');
    if (!m || !m.challenge) { c.classList.add('hidden'); return; }
    const ch = m.challenge;
    c.classList.remove('hidden');
    const prog = Math.min(ch.goal, Math.floor(ch.progress));
    this.setHtml(c, `<div class="ch-top"><span>⏱️ BONUS CHALLENGE</span><em>${Math.ceil(ch.left)}s</em></div><div class="ch-text">${esc(ch.text)}</div><div class="ch-bar"><div style="width:${(prog / ch.goal) * 100}%"></div><span>${prog}/${ch.goal}</span></div>`);
  }

  renderSpectate(m) {
    const g = this.game, p = g.player;
    const spec = this.q('.spectate');
    if (!p.alive && m && !m.over) {
      const t = g.spectateTarget();
      spec.classList.remove('hidden');
      const killer = p.lastDamagedBy;
      const html = t !== p
        ? `<div class="sp-label">SPECTATING</div><div class="sp-name">${esc(t.name)}</div><div class="sp-stats"><span>💀 ${t.kills || 0}</span><span class="sp-hp"><i style="width:${clamp(t.health, 0, 100)}%"></i></span><span class="sp-sh"><i style="width:${clamp(t.shield || 0, 0, 100)}%"></i></span></div>${killer && killer !== p ? `<div class="sp-by">Eliminated by <b>${esc(killer.name)}</b></div>` : ''}`
        : `<div class="sp-name">ELIMINATED</div>`;
      this.setHtml(spec, html);
    } else spec.classList.add('hidden');
  }

  updateAlive(n) {
    const e = this.q('.alive b');
    if (e.textContent !== String(n)) { e.textContent = n; anim(this.q('.alive'), [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 350); }
    // "N PLAYERS REMAIN" when the count crosses a milestone
    const prev = this.prevAlive;
    this.prevAlive = n;
    const g = this.game, m = g.match;
    if (prev === null || !m || m.over || !g.player || !g.player.alive || n >= prev) return;
    const hit = MILESTONES.filter((k) => prev > k && n <= k && !this.saidMilestone.has(k));
    if (!hit.length) return;
    for (const k of hit) this.saidMilestone.add(k);
    this.announce(n === 2 ? 'FINAL 2!' : `${n} PLAYERS REMAIN`, n === 2 ? 'Only one opponent left. You got this!' : n <= 5 ? 'Almost there. Stay sharp!' : '', 'players', 2.6);
  }

  // ---------- feedback ----------
  // Everything you deal: stacked damage number on the target + hit marker. Hooked to game.events 'damage'.
  onDamage(e) {
    const g = this.game, p = g.player;
    if (!p || e.source !== p || e.target === p || !e.amount) return;
    const kill = e.target.health <= 0;
    const kind = e.headshot ? 'head' : e.shieldDmg > e.healthDmg ? 'shield' : 'health';
    this.showHitmarker(kind, kill);
    if (g.settings.damageNumbers !== false) this.stackDamage(e.target, e.amount, kind, kill);
  }

  // kept for game.js: the 'damage' event listener above already does this
  hitmarker() {}
  damageNumber() {}

  showHitmarker(kind, kill) {
    const h = this.q('.hitmarker');
    h.className = `hitmarker show ${kind}${kill ? ' kill' : ''}`;
    const big = kill ? 1.9 : kind === 'head' ? 1.7 : 1.45;
    anim(h, [{ transform: `scale(${big})`, opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.4 }, { transform: 'scale(1)', opacity: 0 }], kill ? 480 : kind === 'head' ? 320 : 260, 'ease-out');
  }

  // enemy shield popped: blue shattered ring around the crosshair
  shieldBreakMarker() {
    const e = el('shield-break');
    this.root.appendChild(e);
    setTimeout(() => e.remove(), 600);
  }

  // Fortnite-style stacking: hits on the same target in quick succession add into one number
  // that grows and pops each hit. One stack per target, pooled DOM nodes.
  stackDamage(target, amount, kind, kill) {
    let s = this.stacks.get(target);
    if (s && s.life > 0.9) { this.releaseStack(target, s); s = null; } // already fading: start a fresh one
    if (!s) {
      const node = this.stackPool.pop() || el('dmgnum');
      if (!node.parentNode) this.dmgLayer.appendChild(node);
      node.hidden = false;
      s = { el: node, total: 0, life: 0, pop: 0, kind: '', ox: 30 + Math.random() * 30, oy: Math.random() * 16, rise: 0, x: 0, y: 0, cls: '' };
      this.stacks.set(target, s);
    }
    s.total += Math.round(amount);
    s.life = 0;
    s.pop = Math.min(1.6, 0.7 + amount / 60);
    s.kind = kind; s.kill = kill;
    s.el.textContent = s.total;
  }

  releaseStack(target, s) {
    this.stacks.delete(target);
    s.el.hidden = true;
    this.stackPool.push(s.el);
  }

  clearStacks() {
    if (!this.stacks) return;
    for (const [t, s] of [...this.stacks]) this.releaseStack(t, s);
  }

  updateDamageNumbers(dt) {
    if (!this.stacks.size) return;
    const cam = this.game.renderer.camera, v = this.tmpV;
    const k = this.hudK || 1;
    for (const [t, s] of this.stacks) {
      s.life += dt;
      if (s.life > 1.25) { this.releaseStack(t, s); continue; }
      s.pop = Math.max(0, s.pop - dt * 7);
      // float up a little while being hit, a lot once the hits stop
      s.rise += dt * (s.life > 0.35 ? 70 : 12);
      v.set(t.pos.x, t.pos.y + 2.1 * (t.scale || 1), t.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { if (s.el.style.visibility !== 'hidden') s.el.style.visibility = 'hidden'; continue; }
      if (s.el.style.visibility) s.el.style.visibility = '';
      const x = (v.x * 0.5 + 0.5) * innerWidth + s.ox * k;
      const y = (-v.y * 0.5 + 0.5) * innerHeight - (s.oy + s.rise) * k;
      // bigger running total = bigger number
      const base = (0.85 + Math.min(1, s.total / 220) * 0.75) * k;
      const sc = base * (1 + s.pop * 0.45);
      s.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${sc.toFixed(3)})`;
      const op = s.life > 0.95 ? Math.max(0, 1 - (s.life - 0.95) / 0.3) : 1;
      s.el.style.opacity = op.toFixed(2);
      const cls = `dmgnum ${s.kind}${s.kill ? ' kill' : ''}`;
      if (s.cls !== cls) { s.cls = cls; s.el.className = cls; }
    }
  }

  damaged(source, amount) {
    const v = this.game.renderer.vignette.uniforms.uDamage;
    v.value = Math.min(1, v.value + amount / 60);
    const bl = this.q('.vitals');
    bl.classList.remove('shake'); void bl.offsetWidth; bl.classList.add('shake');
    if (!source || source === this.game.player || !source.pos) return;
    const p = this.game.player;
    const to = source.pos.clone().sub(p.pos);
    const ang = Math.atan2(to.x, -to.z) + this.game.cameraRig.yaw;
    const layer = this.q('.dmg-dirs');
    // refresh an existing indicator from the same attacker instead of stacking them
    let ind = [...layer.children].find((e) => e.src === source);
    if (!ind) { ind = el('dmg-dir'); ind.src = source; layer.appendChild(ind); }
    ind.style.setProperty('--a', `${ang}rad`);
    ind.style.setProperty('--w', `${clamp(amount / 40, 0.35, 1)}`);
    ind.classList.remove('live'); void ind.offsetWidth; ind.classList.add('live');
    clearTimeout(ind.t); ind.t = setTimeout(() => ind.remove(), 1300);
  }

  killfeed(e) {
    const feed = this.q('.killfeed');
    const v = e.victim, k = e.killer;
    if (v.isDecoy) return;
    if (v === this.game.player) this.myDeath = e;
    const how = e.kind === 'storm' ? '🌀' : e.kind === 'fall' ? '🪂' : e.weapon ? (ICON[e.weapon.id] || '🔫') : '💥';
    const me = (c) => (c === this.game.player ? 'me' : c && c.isBoss ? 'boss' : '');
    const mine = k === this.game.player || v === this.game.player;
    const line = el(`kf ${mine ? 'mine' : ''}`, k && k !== v
      ? `<span class="${me(k)}">${esc(k.name)}</span><span class="kf-how">${how}${e.headshot ? '<i class="kf-hs">🎯</i>' : ''}</span><span class="${me(v)}">${esc(v.name)}</span>`
      : `<span class="${me(v)}">${esc(v.name)}</span><span class="kf-how">${how}</span><span class="kf-txt">${e.kind === 'storm' ? 'lost to the storm' : e.kind === 'fall' ? 'fell too far' : 'was eliminated'}</span>`);
    feed.prepend(line);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 6000);
    setTimeout(() => line.remove(), 6800);
  }

  // Big center "ELIMINATED <NAME>" with your elim count; multi-kills get a shout on top
  elimBanner(victim, head) {
    const g = this.game, b = this.q('.elim-banner');
    const kills = g.player ? g.player.kills : 0;
    this.multi.n = g.time - this.multi.t < 5 ? this.multi.n + 1 : 1;
    this.multi.t = g.time;
    b.querySelector('.eb-top').textContent = head ? '🎯 HEADSHOT ELIMINATION' : 'ELIMINATED';
    b.querySelector('.eb-name').textContent = victim.name;
    b.querySelector('.eb-count b').textContent = kills;
    const multi = b.querySelector('.eb-multi');
    multi.textContent = MULTI[Math.min(this.multi.n, MULTI.length - 1)] || '';
    b.classList.toggle('head', !!head);
    b.classList.remove('hidden', 'out');
    anim(b, [{ scale: 2.2, opacity: 0 }, { scale: 0.94, opacity: 1, offset: 0.55 }, { scale: 1 }], 420);
    anim(b.querySelector('.eb-count'), [{ transform: 'scale(1)' }, { transform: 'scale(1.6)', offset: 0.5 }, { transform: 'scale(1)' }], 500, 'ease-out');
    if (multi.textContent) anim(multi, [{ transform: 'scale(.3) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1.15) rotate(-3deg)', opacity: 1, offset: 0.6 }, { transform: 'rotate(-3deg)' }], 450);
    clearTimeout(this.ebT); clearTimeout(this.ebT2);
    this.ebT = setTimeout(() => b.classList.add('out'), 2400);
    this.ebT2 = setTimeout(() => b.classList.add('hidden'), 2800);
  }

  // On your elimination: placement + who got you, shown until the results screen takes over
  deathCard(m) {
    if (m.won || !this.game.player) return;
    const d = this.myDeath, p = this.game.player;
    const killer = d ? d.killer : p.lastDamagedBy && p.lastDamagedBy !== p ? p.lastDamagedBy : null;
    const card = this.q('.death-card');
    card.querySelector('.dc-place').textContent = `#${m.placement}`;
    card.querySelector('.dc-title').textContent = d && d.kind === 'storm' ? 'LOST TO THE STORM' : d && d.kind === 'fall' ? 'FELL TOO FAR' : 'ELIMINATED';
    card.querySelector('.dc-sub').innerHTML = killer && killer !== p
      ? `by <b>${esc(killer.name)}</b> ${d && d.weapon ? ICON[d.weapon.id] || '' : ''}${d && d.headshot ? ' 🎯' : ''}`
      : `${m.opts.bots + 1} players · ${p.kills} elim${p.kills === 1 ? '' : 's'}`;
    card.classList.remove('hidden');
    this.q('.elim-banner').classList.add('hidden');
    this.annQ = []; this.ann = null; this.q('.announce').classList.add('hidden');
    anim(card, [{ scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1 }], 450);
  }

  // ---------- pickup feed (right side, above the hotbar) ----------
  feedPickup(it) {
    let key = null, icon = '', label = '', amount = 0, rar = -1;
    if (it.kind === 'ammo') { key = `a:${it.ammo}`; amount = it.amount; label = AMMO[it.ammo].name; icon = `<i class="pf-ammo" style="--ac:${AMMO[it.ammo].color}"></i>`; }
    else if (it.kind === 'mats') { key = `m:${it.mat}`; amount = it.amount; label = cap(it.mat); icon = MAT_ICON[it.mat]; }
    else if (it.kind === 'gold') { key = 'g'; amount = it.gold; label = 'Gold'; icon = '🪙'; }
    else if (it.item) {
      const item = it.item;
      rar = item.rarity ?? -1;
      label = item.name;
      icon = item.type === 'weapon' ? ICON[item.id] || '🔫' : item.def.icon || '✨';
      // stackables merge ("Bandages x2" -> "x4"); a gun is always its own row
      if (item.type !== 'weapon' || item.def.stack) { key = `i:${item.id}:${rar}`; amount = item.count || 0; }
    }
    if (!label) return;
    let row = key && this.feed.find((r) => r.key === key && r.t < 3);
    if (row) {
      row.amount += amount;
      row.t = 0;
      row.el.classList.remove('out');
      this.setFeedText(row);
      anim(row.el, [{ transform: 'scale(1.12)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'none' }], 260);
      return;
    }
    const e = el(`pf-row${rar >= 0 ? ` r${rar}` : ''}`, `<span class="pf-ico">${icon}</span><span class="pf-txt"></span>${rar >= 0 ? `<span class="pf-rar">${RARITIES[rar].name}</span>` : ''}`);
    if (rar >= 0) { e.style.setProperty('--rc', rc(rar)); e.style.setProperty('--rcs', rcSolid(rar)); }
    row = { key, el: e, amount, label, isItem: !!it.item, t: 0 };
    this.setFeedText(row);
    const box = this.q('.pickup-feed');
    box.appendChild(e);
    this.feed.push(row);
    while (this.feed.length > 5) this.feed.shift().el.remove();
  }

  setFeedText(row) {
    const txt = row.isItem ? `${row.label}${row.amount > 1 ? ` x${row.amount}` : ''}` : `+${row.amount} ${row.label}`;
    row.el.querySelector('.pf-txt').textContent = txt;
  }

  updateFeed(dt) {
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const r = this.feed[i];
      r.t += dt;
      if (r.t > 3 && !r.el.classList.contains('out')) r.el.classList.add('out');
      if (r.t > 3.45) { r.el.remove(); this.feed.splice(i, 1); }
    }
  }

  harvestPop(mat, n) {
    const mats = this.q('.mats');
    const idx = MAT_ORDER.indexOf(mat);
    const d = el(`harvest-pop ${mat}`, `+${n}`);
    d.style.setProperty('--i', idx);
    mats.appendChild(d);
    const m = mats.children[idx];
    if (m) { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
    setTimeout(() => d.remove(), 800);
  }

  toast(msg) {
    if (!msg) return;
    const t = el('toast', msg);
    let box = this.q('.toasts');
    // HUD hidden (lobby/menus): show it in a layer above the menus instead
    if (this.root.classList.contains('hidden')) {
      box = document.querySelector('#ui > .toasts.global');
      if (!box) { box = el('toasts global'); document.getElementById('ui').appendChild(box); }
    }
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.classList.add('fade'), 2800);
    setTimeout(() => t.remove(), 3400);
  }

  bigMessage(title, sub = '') {
    const b = this.q('.bigmsg');
    b.querySelector('.big-title').textContent = title;
    b.querySelector('.big-sub').textContent = sub;
    b.classList.remove('hidden'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    clearTimeout(this.bmT); this.bmT = setTimeout(() => b.classList.add('hidden'), 3200);
  }

  // ---------- end of match ----------
  results(m, unlocks, delta, cheated) {
    const g = this.game, d = g.save.data, s = m.stats;
    g.input.wantLock = false; g.input.releaseLock();
    this.q('.fullmap').classList.add('hidden'); this.mapOpen = false;
    const r = this.q('.results');
    const unlockHtml = unlocks.map((u, i) => {
      const rw = u.reward;
      const name = rw.type === 'coins' ? `${rw.amount} Coins` : rw.type === 'skin' ? SKIN_BY_ID[rw.id]?.name || rw.id : rw.type === 'emote' ? 'New Emote' : rw.type === 'glider' ? 'New Glider' : 'New Wrap';
      const icon = { coins: '🪙', skin: '👕', emote: '💃', glider: '🪂', wrap: '🎨' }[rw.type];
      const rr = rw.type === 'skin' ? SKIN_BY_ID[rw.id]?.rarity ?? 2 : 2;
      return `<div class="unlock" style="--rc:${rc(rr)};animation-delay:${0.6 + i * 0.15}s"><span>${icon}</span><div><small>LEVEL ${u.level}</small>${esc(name)}</div></div>`;
    }).join('');
    const coach = delta > 0.001 ? '📈 The bots will get tougher next time!' : delta < -0.001 ? '📉 Coach is easing up a little.' : '';
    const stat = (v, label, i) => `<div style="animation-delay:${0.25 + i * 0.07}s"><b>${v}</b>${label}</div>`;
    const total = m.opts.bots + 1;
    r.className = `results ${m.won ? 'victory' : 'defeat'}`;
    r.innerHTML = `
      ${m.won ? '<div class="rays"></div><div class="confetti">' + Array.from({ length: 40 }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 2).toFixed(2)}s;--h:${(i * 37) % 360}"></i>`).join('') + '</div>' : ''}
      <div class="res-card">
        ${m.won ? `<div class="res-place">#1</div><div class="res-title win">SPORTNITE CHAMPION</div><div class="res-sub">Victory! You outlasted all ${total - 1} players!</div>`
          : `<div class="res-place">#${m.placement}</div><div class="res-title">${m.placement <= 10 ? 'TOP 10!' : 'ELIMINATED'}</div><div class="res-sub">You placed #${m.placement} of ${total}${m.placement <= 10 ? '. So close!' : '. Drop back in!'}</div>`}
        <div class="res-stats">
          ${stat(s.kills, 'Eliminations', 0)}${stat(Math.round(s.damage), 'Damage', 1)}${stat(formatTime(s.survived), 'Survived', 2)}
          ${stat(s.chests, 'Chests', 3)}${stat(s.built, 'Built', 4)}${stat(s.bossKills, 'Bosses', 5)}
        </div>
        ${cheated ? '<div class="res-xp">Cheats were on: no XP this match</div>' : `<div class="res-xp">+${s.xp.toLocaleString()} XP <span>·</span> +${s.coins} 🪙</div>
        <div class="res-level"><span class="lvl-badge">${d.level}</span><div class="xpbar"><div style="width:${(d.xp / xpForLevel(d.level)) * 100}%"></div></div></div>`}
        ${unlockHtml ? `<div class="unlocks"><h3>UNLOCKED!</h3><div class="unlock-row">${unlockHtml}</div></div>` : ''}
        <div class="res-coach">${coach}</div>
        <div class="res-buttons"><button class="btn big play-again" data-focus><span class="pad-only">${padGlyph(0)}</span>PLAY AGAIN</button><button class="btn ghost lobby"><span class="pad-only">${padGlyph(1)}</span>LOBBY</button></div>
      </div>
    `;
    r.classList.remove('hidden');
    r.querySelector('.play-again').onclick = () => { r.classList.add('hidden'); g.startMatchWithLoader(); };
    r.querySelector('.lobby').onclick = () => { r.classList.add('hidden'); g.returnToLobby(); };
  }
}
