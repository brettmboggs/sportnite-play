// Unified input: keyboard + mouse (pointer lock) + PS5/Xbox gamepad.
// Game code reads actions: input.down('fire'), input.pressed('jump'), input.move, input.look.

export const DEFAULT_KEYS = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  jump: ['Space'], sprint: ['ShiftLeft'], crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'], interact: ['KeyE'], build: ['KeyQ'], edit: ['KeyG'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], pickaxe: ['KeyX'],
  wall: ['F1', 'KeyZ'], floor: ['F2'], ramp: ['F3', 'KeyV'], cone: ['F4'],
  rotate: ['KeyT'], skill1: ['KeyF'], skill2: ['KeyB'], ultimate: ['KeyU'],
  map: ['KeyM'], emote: ['KeyH'], pause: ['Escape', 'KeyP'], tab: ['Tab'],
};

// Standard Gamepad layout (what Chrome gives a DualSense):
// 0 ✕  1 ◯  2 □  3 △  4 L1  5 R1  6 L2  7 R2  8 Create  9 Options  10 L3  11 R3  12-15 D-pad ↑↓←→  16 PS  17 touchpad
export const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, PAD: 17 };

// Fortnite "Builder Pro" layout. Combat:
const PAD = {
  jump: [BTN.CROSS], reload: [BTN.SQUARE], interact: [BTN.SQUARE], pickaxe: [BTN.TRIANGLE],
  swapNext: [BTN.R1], swapPrev: [BTN.L1], fire: [BTN.R2], aim: [BTN.L2],
  map: [BTN.CREATE, BTN.PAD], skill1: [BTN.LEFT], skill2: [BTN.RIGHT], ultimate: [BTN.UP], emote: [BTN.DOWN],
};
// in build mode the triggers/bumpers place pieces, □ swaps material, △ goes back to the pickaxe
const PAD_BUILD = {
  jump: [BTN.CROSS], reload: [BTN.SQUARE], interact: [BTN.SQUARE], pickaxe: [BTN.TRIANGLE],
  wall: [BTN.R2], ramp: [BTN.L2], floor: [BTN.R1], cone: [BTN.L1],
  map: [BTN.CREATE, BTN.PAD], skill1: [BTN.LEFT], skill2: [BTN.RIGHT], ultimate: [BTN.UP], emote: [BTN.DOWN],
};

// Linux browsers without the standard mapping see the DualSense through evdev, in a different order.
// raw button -> standard button, plus which axes hold the right stick, triggers and d-pad.
const RAW_DUALSENSE = { buttons: [0, 1, 3, 2, 4, 5, 6, 7, 8, 9, 16, 10, 11], rx: 3, ry: 4, l2: 2, r2: 5, hatX: 6, hatY: 7 };

// devices that show up next to a DualSense but aren't the controller itself
const NOT_A_PAD = /motion sensors|touchpad|accelerometer/i;

const TAP_HOLD = 0.28; // ◯ tap = build mode, hold = edit

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.taps = new Set(); // keys pressed since the last update, so a quick tap between two frames still counts
    this.clicks = { left: false, right: false };
    this.prevActions = new Set();
    this.actions = new Set();
    this.binds = structuredClone(DEFAULT_KEYS);
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.locked = false;
    this.usingPad = false;
    this.buildMode = false; // set by game so pad triggers map to build pieces
    this.editing = false;   // set by the player while a wall edit is open
    this.sensitivity = 1;
    this.padSensitivity = 1;
    this.padLookX = 1;
    this.padLookY = 1;
    this.padDeadzone = 0.12;
    this.vibration = true;
    this.invertY = false;
    this.enabled = true;
    this.onPauseRequest = null;
    this.onPadChange = null; // (name | null) when a controller connects or disconnects
    this.padState = { buttons: new Array(18).fill(false), values: new Array(18).fill(0), axes: [0, 0, 0, 0] };
    this.padName = null;
    this.crouchLatch = false;
    this.sprintLatch = false;
    this.circleT = -1;
    this.prevPadButtons = new Array(18).fill(false);

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      if (['Tab', 'F1', 'F2', 'F3', 'F4', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.taps.add(e.code); this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked && this.wantLock) { this.usingPad = false; this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.clicks.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.clicks.right = true; }
      this.usingPad = false;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.usingPad = false;
    });
    dom.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === dom;
      // a controller player never had the mouse captured, so only a real unlock means "pause"
      if (was && !this.locked && this.wantLock && this.onPauseRequest) this.onPauseRequest();
    });
    addEventListener('gamepadconnected', () => this.checkPad());
    addEventListener('gamepaddisconnected', () => this.checkPad());
    this.wantLock = false;
  }

  requestLock() {
    if (this.usingPad) return; // controller players don't need the mouse captured
    // browsers refuse the lock without a click or when the page isn't focused; that's fine, never throw
    const plain = () => { try { const q = this.dom.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } };
    try { const p = this.dom.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(plain); }
    catch { plain(); }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // The best connected controller: standard mapping first, then the one with the most buttons.
  getPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    let best = null, bestScore = -1;
    for (const p of pads) {
      if (!p || !p.connected || NOT_A_PAD.test(p.id) || p.buttons.length < 10 || p.axes.length < 4) continue;
      const score = (p.mapping === 'standard' ? 100 : 0) + p.buttons.length + (p.timestamp ? 1 : 0);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  checkPad() {
    const p = this.getPad();
    const name = p ? prettyPadName(p.id) : null;
    if (name !== this.padName) { this.padName = name; if (this.onPadChange) this.onPadChange(name); }
  }

  getPadState() { return this.padState; }

  // Read the pad into the standard layout, whatever the browser gave us.
  readPad(pad) {
    const st = this.padState;
    const b = st.buttons, v = st.values;
    b.fill(false); v.fill(0);
    if (pad.mapping === 'standard') {
      for (let i = 0; i < Math.min(18, pad.buttons.length); i++) { v[i] = pad.buttons[i].value; b[i] = pad.buttons[i].pressed || pad.buttons[i].value > 0.5; }
      // triggers count as pressed a little before the click so they feel snappy
      for (const i of [BTN.L2, BTN.R2]) b[i] = v[i] > 0.15;
      st.axes[0] = pad.axes[0] || 0; st.axes[1] = pad.axes[1] || 0; st.axes[2] = pad.axes[2] || 0; st.axes[3] = pad.axes[3] || 0;
    } else {
      const m = RAW_DUALSENSE;
      for (let i = 0; i < m.buttons.length && i < pad.buttons.length; i++) { const s = m.buttons[i]; b[s] = pad.buttons[i].pressed; v[s] = pad.buttons[i].value; }
      const ax = (i) => pad.axes[i] ?? 0;
      st.axes[0] = ax(0); st.axes[1] = ax(1); st.axes[2] = ax(m.rx); st.axes[3] = ax(m.ry);
      // triggers rest at -1 on evdev
      if (pad.axes.length > m.r2) { v[BTN.L2] = (ax(m.l2) + 1) / 2; v[BTN.R2] = (ax(m.r2) + 1) / 2; b[BTN.L2] = v[BTN.L2] > 0.15; b[BTN.R2] = v[BTN.R2] > 0.15; }
      if (pad.axes.length > m.hatY) { b[BTN.LEFT] = ax(m.hatX) < -0.5; b[BTN.RIGHT] = ax(m.hatX) > 0.5; b[BTN.UP] = ax(m.hatY) < -0.5; b[BTN.DOWN] = ax(m.hatY) > 0.5; }
    }
    return st;
  }

  update(dt = 1 / 60) {
    this.prevActions = this.actions;
    const a = new Set();
    if (!this.enabled) { this.taps.clear(); this.clicks.left = this.clicks.right = false; this.actions = a; this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0; this.move.x = this.move.y = 0; this.look.x = this.look.y = 0; return; }
    for (const [act, codes] of Object.entries(this.binds)) if (codes.some((c) => this.keys.has(c) || this.taps.has(c))) a.add(act);
    if (this.mouse.left || this.clicks.left) a.add('fire');
    if (this.mouse.right || this.clicks.right) a.add('aim');
    this.taps.clear(); this.clicks.left = this.clicks.right = false;
    let mx = (a.has('right') ? 1 : 0) - (a.has('left') ? 1 : 0);
    let my = (a.has('forward') ? 1 : 0) - (a.has('back') ? 1 : 0);
    let lx = this.mouse.dx * 0.0022 * this.sensitivity;
    let ly = this.mouse.dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0;
    if (this.mouse.wheel) { a.add(this.mouse.wheel > 0 ? 'swapNext' : 'swapPrev'); this.mouse.wheel = 0; }

    const pad = this.getPad();
    this.pad = pad;
    if (pad) {
      const st = this.readPad(pad), b = st.buttons;
      const [sx, sy] = radialDeadzone(st.axes[0], st.axes[1], this.padDeadzone);
      const [rx, ry] = radialDeadzone(st.axes[2], st.axes[3], this.padDeadzone);
      const edge = (i) => b[i] && !this.prevPadButtons[i];
      if (sx || sy || rx || ry || b.some(Boolean)) this.usingPad = true;
      if (sx || sy) { mx = sx; my = -sy; }
      // look speed in radians per second, with a curve for fine aim near the center, and a Fortnite-style
      // "look ramp": holding the stick all the way over speeds turning up so you can spin around fast
      const curve = (x) => Math.sign(x) * Math.pow(Math.abs(x), 1.7);
      if (Math.abs(rx) > 0.92) this.rampT = Math.min(1, (this.rampT || 0) + dt / 0.35); else this.rampT = 0;
      const boost = 1 + this.rampT * 0.8;
      lx += curve(rx) * 4.8 * boost * this.padSensitivity * this.padLookX * dt;
      ly += curve(ry) * 3.2 * this.padSensitivity * this.padLookY * dt * (this.invertY ? -1 : 1);

      const map = this.buildMode ? PAD_BUILD : PAD;
      for (const [act, btns] of Object.entries(map)) if (btns.some((i) => b[i])) a.add(act);
      if (this.editing) { if (b[BTN.R2]) a.add('fire'); if (b[BTN.L2]) a.add('aim'); }
      else if (this.buildMode && (b[BTN.R2] || b[BTN.L2] || b[BTN.R1] || b[BTN.L1])) a.add('fire');
      if (b[BTN.OPTIONS]) a.add('pause');

      // ◯: tap toggles build mode, hold opens edit; while editing, any ◯ press confirms the edit
      if (this.editing) { if (edge(BTN.CIRCLE)) a.add('edit'); this.circleT = -1; }
      else if (edge(BTN.CIRCLE)) this.circleT = 0;
      if (this.circleT >= 0) {
        if (b[BTN.CIRCLE]) {
          this.circleT += dt;
          if (this.circleT >= TAP_HOLD) { a.add('edit'); this.circleT = -1; }
        } else { a.add('build'); this.circleT = -1; }
      }
      // R3 toggles crouch, L3 latches sprint until the stick is let go (like Fortnite)
      if (edge(BTN.R3)) this.crouchLatch = !this.crouchLatch;
      if (b[BTN.R3] && !this.prevPadButtons[BTN.R3]) a.add('crouchTap');
      if (edge(BTN.L3)) this.sprintLatch = !this.sprintLatch;
      if (!sx && !sy) this.sprintLatch = false;
      if (this.crouchLatch && (a.has('jump') || this.sprintLatch)) this.crouchLatch = false;
      if (this.crouchLatch) a.add('crouch');
      if (this.sprintLatch) a.add('sprint');
      for (let i = 0; i < b.length; i++) this.prevPadButtons[i] = b[i];
    } else {
      this.crouchLatch = this.sprintLatch = false;
      this.prevPadButtons.fill(false);
    }
    // controller crouch is a toggle, so the "pressed" edge comes from the tap
    if (a.has('crouchTap')) { a.delete('crouchTap'); if (!this.prevActions.has('crouch') && !a.has('crouch')) a.add('crouch'); }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    this.look.x = lx; this.look.y = ly;
    this.actions = a;
  }

  down(act) { return this.actions.has(act); }
  pressed(act) { return this.actions.has(act) && !this.prevActions.has(act); }
  released(act) { return !this.actions.has(act) && this.prevActions.has(act); }
  consume(act) { this.prevActions.add(act); }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const p = this.pad;
    if (!p || !this.usingPad || !this.vibration) return;
    const fx = p.vibrationActuator;
    if (fx && fx.playEffect) fx.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    else if (p.hapticActuators && p.hapticActuators[0]) p.hapticActuators[0].pulse(Math.max(strong, weak), ms).catch(() => {});
  }
}

function radialDeadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

function prettyPadName(id) {
  if (/dualsense|0ce6|0df2/i.test(id)) return 'PS5 DualSense';
  if (/dualshock|054c/i.test(id)) return 'PlayStation Controller';
  if (/xbox|xinput|045e/i.test(id)) return 'Xbox Controller';
  return id.replace(/\(.*?\)/g, '').trim() || 'Controller';
}
