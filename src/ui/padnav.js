// Controller navigation for every HTML menu (lobby tabs, locker, shop, settings, pause, results, modals).
// Polls the gamepad on its own animation frame so it keeps working while the game is paused.
//   D-pad / left stick  move the focus highlight (spatially, like a console menu)
//   ✕ select · ◯ back · L1/R1 top tabs · L2/R2 sub tabs · right stick scrolls · OPTIONS pause/resume
import { audio } from '../engine/audio.js';

const FOCUSABLE = 'button, .tab, .card, .tier, input[type=range], input[type=checkbox], select, [data-nav]';
const REPEAT_DELAY = 0.34, REPEAT_RATE = 0.11;
const B = { X: 0, O: 1, SQ: 2, TRI: 3, L1: 4, R1: 5, L2: 6, R2: 7, OPT: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export function pickGamepad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
  let best = null, bestScore = -1;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    // Linux exposes the DualSense touchpad / motion sensors as extra "gamepads": skip them
    if (/motion|sensor|touchpad/i.test(p.id)) continue;
    const score = (p.mapping === 'standard' ? 1000 : 0) + p.buttons.length * 10 + p.axes.length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

export const padName = (p) => (p ? p.id.replace(/\s*\(.*\)\s*/g, ' ').replace(/Vendor:.*$/i, '').trim() || 'Controller' : '');

export class PadNav {
  constructor(game) {
    this.game = game;
    this.prev = new Array(17).fill(false);
    this.state = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0], values: new Array(17).fill(0) };
    this.focus = null;
    this.repeatDir = null; this.repeatT = 0;
    this.swallow = false;
    this.oHeld = 0;
    this.connected = null;
    this.last = performance.now();
    // mouse or keyboard takes over: hide the pad highlight
    addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setPadMode(false); });
    addEventListener('keydown', () => this.setPadMode(false));
    addEventListener('gamepadconnected', (e) => this.onConnect(e.gamepad));
    addEventListener('gamepaddisconnected', (e) => this.onConnect(e.gamepad));
    const loop = (now) => { requestAnimationFrame(loop); const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.tick(dt); };
    requestAnimationFrame(loop);
  }

  // the connect/disconnect toast comes from input.js (onPadChange -> hud.toast); just refresh the menu
  onConnect(p) {
    if (p && /motion|sensor|touchpad/i.test(p.id)) return;
    this.connected = undefined;
  }

  setPadMode(on) {
    if (this.padMode === on) return;
    this.padMode = on;
    document.body.classList.toggle('pad-mode', on);
    if (this.game.input) this.game.input.usingPad = on;
    if (!on && this.focus) { this.focus.classList.remove('pad-focus'); }
    else if (on && this.focus) this.focus.classList.add('pad-focus');
    this.game.menu?.refreshGlyphs?.();
  }

  read() {
    const raw = pickGamepad();
    this.pad = raw;
    const inp = this.game.input;
    // non-standard layouts: use the lead's normalized state from input.js when it exists
    if (raw && raw.mapping !== 'standard' && inp && typeof inp.getPadState === 'function') {
      const st = inp.getPadState();
      if (st && st.buttons) {
        const btn = st.buttons.map((b) => (typeof b === 'object' ? !!b.pressed : !!b));
        return { buttons: btn, values: btn.map((b) => (b ? 1 : 0)), axes: st.axes || [0, 0, 0, 0], id: raw.id };
      }
    }
    if (!raw) return null;
    const buttons = [], values = [];
    for (let i = 0; i < 17; i++) { const b = raw.buttons[i]; buttons.push(!!(b && (b.pressed || b.value > 0.5))); values.push(b ? b.value : 0); }
    return { buttons, values, axes: [raw.axes[0] || 0, raw.axes[1] || 0, raw.axes[2] || 0, raw.axes[3] || 0], id: raw.id };
  }

  // which UI layer is on top right now?
  layer() {
    const g = this.game;
    const menuRoot = g.menu && g.menu.root;
    const modal = menuRoot && [...menuRoot.querySelectorAll('.modal')].pop();
    if (modal) return { el: modal, kind: 'modal' };
    const res = g.hud && g.hud.root.querySelector('.results');
    if (res && !res.classList.contains('hidden') && !g.hud.root.classList.contains('hidden')) return { el: res, kind: 'results' };
    if (menuRoot && !menuRoot.classList.contains('hidden') && menuRoot.children.length) return { el: menuRoot, kind: g.state === 'paused' ? 'pause' : 'menu' };
    return null;
  }

  tick(dt) {
    const s = this.read();
    const g = this.game;
    const name = s ? padName(this.pad) : null;
    if (name !== this.connected) { this.connected = name; g.menu?.onPadChange?.(name); }
    if (!s) { this.prev.fill(false); return; }
    this.state = s;
    const b = s.buttons;
    const pressed = (i) => b[i] && !this.prev[i];
    const released = (i) => !b[i] && this.prev[i];
    const ax = (v) => (Math.abs(v) < 0.35 ? 0 : v);
    const any = b.some(Boolean) || s.axes.some((v) => Math.abs(v) > 0.35);
    if (any) this.setPadMode(true);
    // browsers may let a controller press unlock sound; try once
    if (any && !this.audioKick) { this.audioKick = true; try { audio.init(); if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); if (g.state === 'lobby') audio.startMusic('lobby'); } catch { /* needs a click */ } }
    g.menu?.updatePadTest?.(s);

    // after a menu button sends us back into gameplay, keep game input off until every button is let go
    if (this.swallow) {
      if (!any) { this.swallow = false; if (g.state === 'match' && g.input) g.input.enabled = true; }
      else if (g.input) g.input.enabled = false;
    }

    const L = this.layer();
    // OPTIONS: open pause in a match, close it when paused
    if (pressed(B.OPT)) {
      if (g.state === 'match' && !L && !(g.minigames && g.minigames.active) && !(g.match && g.match.over)) { g.menu.showPause(); this.focus = null; audio.ui('click'); }
      else if (g.state === 'paused') this.optArmed = true;
    }
    if (released(B.OPT) && this.optArmed) { this.optArmed = false; if (g.state === 'paused') this.resumeGame(); }

    if (L) {
      // button-test view swallows buttons; hold ◯ to leave it
      const testing = this.focus && this.focus.dataset && this.focus.dataset.nav === 'padtest' && this.focus.isConnected;
      if (testing) {
        this.oHeld = b[B.O] ? this.oHeld + dt : 0;
        g.menu?.updatePadTestHold?.(this.oHeld / 0.8);
        if (this.oHeld > 0.8) { this.oHeld = 0; this.move('up', L.el, true); }
        this.prev = b.slice();
        return;
      }
      const list = this.focusables(L.el);
      if (!this.focus || !this.focus.isConnected || !list.includes(this.focus)) this.setFocus(this.defaultFocus(L.el, list), false);

      // directions (D-pad + left stick) with key-repeat
      const lx = ax(s.axes[0]), ly = ax(s.axes[1]);
      let dir = b[B.UP] || ly < 0 ? 'up' : b[B.DOWN] || ly > 0 ? 'down' : b[B.LEFT] || lx < 0 ? 'left' : b[B.RIGHT] || lx > 0 ? 'right' : null;
      if (Math.abs(lx) > Math.abs(ly) && lx) dir = lx < 0 ? 'left' : 'right';
      if (dir) {
        if (dir !== this.repeatDir) { this.repeatDir = dir; this.repeatT = REPEAT_DELAY; this.dirAction(dir, L.el); }
        else { this.repeatT -= dt; if (this.repeatT <= 0) { this.repeatT = REPEAT_RATE; this.dirAction(dir, L.el); } }
      } else this.repeatDir = null;

      // right stick scrolls the panel under the focus
      const ry = ax(s.axes[3]);
      if (ry) { const sc = this.scroller(this.focus) ; if (sc) sc.scrollTop += ry * dt * 900; }

      if (pressed(B.X)) this.activate();
      if (pressed(B.O)) this.back(L);
      if (pressed(B.L1) || pressed(B.R1)) { g.menu?.cycleTab?.(pressed(B.R1) ? 1 : -1); this.focus = null; }
      if (pressed(B.L2) || pressed(B.R2)) { g.menu?.cycleSub?.(pressed(B.R2) ? 1 : -1); this.focus = null; }
      if (pressed(B.TRI)) { const t = L.el.querySelector('[data-tri]'); if (t) { t.click(); this.afterActivate(); } }
      if (pressed(B.SQ)) { const t = L.el.querySelector('[data-sq]'); if (t) { t.click(); this.afterActivate(); } }
    }
    this.prev = b.slice();
  }

  focusables(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter((e) => {
      if (e.disabled || e.dataset.nav === 'skip') return false;
      if (e.closest('.hidden')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  defaultFocus(root, list) {
    const pref = root.querySelector('[data-focus]:not(.hidden)');
    if (pref && list.includes(pref)) return pref;
    const main = root.querySelector('.panel, .modal-box, .pause-box, .res-card');
    const inMain = main ? list.filter((e) => main.contains(e) && !e.matches('.tab')) : [];
    return inMain[0] || list.find((e) => e.matches('.card, .btn')) || list[0] || null;
  }

  setFocus(el, sound = true) {
    if (el === this.focus) return;
    const old = this.focus;
    if (old) { old.classList.remove('pad-focus'); old.dispatchEvent(new MouseEvent('mouseleave')); }
    this.focus = el;
    if (!el) return;
    if (this.padMode) el.classList.add('pad-focus');
    if (sound) audio.ui('select');
    if (this.padMode) {
      el.dispatchEvent(new MouseEvent('mouseenter'));
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  dirAction(dir, root) {
    const f = this.focus;
    // sliders and dropdowns use left / right to change their value
    if (f && (dir === 'left' || dir === 'right')) {
      const d = dir === 'right' ? 1 : -1;
      if (f.matches('input[type=range]')) {
        const step = +f.step || 1, v = Math.min(+f.max, Math.max(+f.min, +f.value + step * d));
        if (v !== +f.value) { f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); audio.ui('select'); }
        return;
      }
      if (f.matches('select')) { this.cycleSelect(f, d); return; }
    }
    this.move(dir, root);
  }

  cycleSelect(f, d) {
    const n = f.options.length; if (!n) return;
    f.selectedIndex = (f.selectedIndex + d + n) % n;
    f.dispatchEvent(new Event('change', { bubbles: true }));
    audio.ui('click');
  }

  // spatial navigation: nearest element in the pressed direction, favouring ones lined up with the current one
  move(dir, root, force = false) {
    const list = this.focusables(root);
    const f = this.focus && list.includes(this.focus) ? this.focus : null;
    if (!f) { this.setFocus(this.defaultFocus(root, list)); return; }
    const r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const e of list) {
      if (e === f || (f.dataset.nav === 'padtest' && !force && e.dataset.nav === 'padtest')) continue;
      const q = e.getBoundingClientRect();
      const ex = q.left + q.width / 2, ey = q.top + q.height / 2;
      let main, cross;
      if (dir === 'up') { main = r.top - q.bottom; cross = Math.max(0, Math.max(q.left - r.right, r.left - q.right)); if (ey >= cy - 2) continue; }
      else if (dir === 'down') { main = q.top - r.bottom; cross = Math.max(0, Math.max(q.left - r.right, r.left - q.right)); if (ey <= cy + 2) continue; }
      else if (dir === 'left') { main = r.left - q.right; cross = Math.max(0, Math.max(q.top - r.bottom, r.top - q.bottom)); if (ex >= cx - 2) continue; }
      else { main = q.left - r.right; cross = Math.max(0, Math.max(q.top - r.bottom, r.top - q.bottom)); if (ex <= cx + 2) continue; }
      const centerOff = dir === 'up' || dir === 'down' ? Math.abs(ex - cx) : Math.abs(ey - cy);
      const score = Math.max(-20, main) + cross * 3 + centerOff * 0.15;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) this.setFocus(best);
  }

  scroller(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4) return e;
    }
    return null;
  }

  activate() {
    const f = this.focus;
    if (!f) return;
    if (f.matches('input[type=checkbox]')) { f.checked = !f.checked; f.dispatchEvent(new Event('change', { bubbles: true })); audio.ui('click'); }
    else if (f.matches('select')) this.cycleSelect(f, 1);
    else if (f.matches('input[type=range]')) { /* left/right adjusts */ }
    else { f.classList.add('pad-press'); setTimeout(() => f.classList.remove('pad-press'), 140); f.click(); }
    this.afterActivate();
  }

  // a menu button just put us into gameplay: don't let the held ✕ also make the player jump
  afterActivate() {
    const g = this.game;
    if (g.state === 'match' && !this.layer()) { this.swallow = true; if (g.input) g.input.enabled = false; this.focus = null; }
  }

  resumeGame() {
    this.game.menu.resume();
    this.afterActivate();
    this.swallow = true;
    if (this.game.input) this.game.input.enabled = false;
  }

  back(L) {
    const g = this.game;
    audio.ui('click');
    if (L.kind === 'modal') { const c = L.el.querySelector('.close-modal'); if (c) c.click(); else L.el.remove(); this.focus = null; return; }
    if (L.kind === 'results') { const lb = L.el.querySelector('.lobby'); if (lb) lb.click(); this.focus = null; return; }
    if (g.menu && g.menu.back) { g.menu.back(); this.focus = null; this.afterActivate(); }
  }
}
