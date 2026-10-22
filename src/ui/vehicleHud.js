import { glyph, isPad } from './glyphs.js';

// Small vehicle panel (name, health, boost/fuel, speed, controls) + trick pop-ups.
// Lives inside the HUD root so it hides with the HUD; styles are injected here so styles.css stays untouched.
const CSS = `
.veh-hud { position: absolute; left: var(--edge-x, 16px); bottom: calc(var(--edge-y, 16px) + 125px); zoom: var(--hud-k, 1);
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px; pointer-events: none; font-family: var(--body, sans-serif); }
.veh-hud.hidden { display: none; }
.veh-card { display: flex; align-items: center; gap: 10px; background: rgba(18,8,46,.72); border: 3px solid rgba(255,255,255,.85); border-radius: 16px;
  padding: 7px 14px 7px 10px; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.veh-card.hit { animation: vehHit .25s; }
@keyframes vehHit { 0% { border-color: #ff4a4a; transform: scale(1.05); } 100% { border-color: rgba(255,255,255,.85); transform: scale(1); } }
.veh-icon { font-size: 30px; line-height: 1; }
.veh-mid { display: flex; flex-direction: column; gap: 4px; min-width: 190px; }
.veh-name { font-family: var(--display, sans-serif); font-size: 18px; color: #fff; letter-spacing: .5px; display: flex; justify-content: space-between; gap: 14px; white-space: nowrap; }
.veh-name em { font-style: normal; color: #ffd34d; font-size: 16px; }
.veh-bar { position: relative; height: 10px; background: rgba(255,255,255,.18); border-radius: 6px; overflow: hidden; }
.veh-bar > div { position: absolute; inset: 0 auto 0 0; border-radius: 6px; transition: width .12s linear; }
.veh-bar.hp > div { background: linear-gradient(90deg, #7dff5a, #2fbf5a); }
.veh-bar.hp.low > div { background: linear-gradient(90deg, #ff7a1a, #ff4a4a); }
.veh-bar.en > div { background: linear-gradient(90deg, #48b6ff, #18e0ff); }
.veh-bar.en.fuel > div { background: linear-gradient(90deg, #ffd34d, #ff9a1a); }
.veh-bar span { position: absolute; right: 4px; top: -3px; font-size: 10px; color: #fff; }
.veh-hints { display: flex; gap: 4px 12px; flex-wrap: wrap; max-width: 420px; font-size: 14px; color: #fff; background: rgba(18,8,46,.5);
  padding: 4px 12px; border-radius: 12px; }
.veh-hints b { font-weight: normal; white-space: nowrap; }
.veh-trick { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; pointer-events: none; zoom: var(--hud-k, 1); }
.veh-trick .t1 { font-family: var(--display, sans-serif); font-size: 44px; color: #ffd34d; -webkit-text-stroke: 2px #12082e; text-shadow: 0 4px 0 #12082e, 0 0 24px rgba(255,79,216,.7); }
.veh-trick .t2 { font-family: var(--display, sans-serif); font-size: 22px; color: #fff; text-shadow: 0 2px 0 #12082e; }
.veh-trick.pop { animation: vehPop 1.4s both; }
@keyframes vehPop { 0% { opacity: 0; transform: translateX(-50%) scale(.4) rotate(-6deg); } 12% { opacity: 1; transform: translateX(-50%) scale(1.15) rotate(3deg); }
  22% { transform: translateX(-50%) scale(1) rotate(0); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(.95); } }
`;

export class VehicleHud {
  constructor(game) {
    this.game = game;
    this.v = null;
    this.el = null;
  }

  ensure() {
    if (this.el) return true;
    const hudRoot = this.game.hud && this.game.hud.root;
    if (!hudRoot) return false;
    if (!document.getElementById('veh-hud-css')) {
      const st = document.createElement('style'); st.id = 'veh-hud-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'veh-hud hidden';
    this.el.innerHTML = `<div class="veh-card"><div class="veh-icon"></div><div class="veh-mid"><div class="veh-name"><span class="vn"></span><em class="vs"></em></div>
      <div class="veh-bar hp"><div></div></div><div class="veh-bar en"><div></div><span></span></div></div></div><div class="veh-hints"></div>`;
    this.tr = document.createElement('div'); this.tr.className = 'veh-trick';
    hudRoot.appendChild(this.el); hudRoot.appendChild(this.tr);
    this.q = (s) => this.el.querySelector(s);
    return true;
  }

  show(v) {
    if (!this.ensure()) return;
    this.v = v; this.hintKey = null;
    this.el.classList.remove('hidden');
    this.q('.veh-icon').textContent = v.def.icon;
    this.q('.vn').textContent = v.def.name.toUpperCase();
    this.q('.veh-bar.en').classList.toggle('fuel', !!v.def.fly);
    this.update(v);
  }

  hide() { this.v = null; if (this.el) this.el.classList.add('hidden'); }

  hints(v) {
    const g = this.game, k = (a) => glyph(g, a);
    const pad = isPad(g);
    const parts = v.def.fly
      ? [`${k('jump')}${pad ? ` ${glyph(g, 'fire')}` : ''} Up`, `${k('crouch')}${pad ? ` ${glyph(g, 'aim')}` : ''} Down`, `${k('sprint')} Boost`]
      : v.type === 'board'
        ? [`${k('sprint')} Boost`, `${k('jump')} Ollie (again in the air = Kickflip)`, `Steer in the air = Spin`]
        : [`${k('sprint')} Boost`, `Hold ${k('jump')} Drift`, `${k('fire')} Honk`];
    parts.push(`${k('interact')} Hop off`);
    return parts.map((p) => `<b>${p}</b>`).join('');
  }

  update(v) {
    if (!this.el || this.v !== v) return;
    const key = `${v.type}:${isPad(this.game)}`;
    if (key !== this.hintKey) { this.hintKey = key; this.q('.veh-hints').innerHTML = this.hints(v); }
    const hp = Math.max(0, v.hp / v.def.hp);
    const hb = this.q('.veh-bar.hp');
    hb.firstChild.style.width = `${hp * 100}%`;
    hb.classList.toggle('low', hp < 0.35);
    const en = v.def.fly ? v.fuel / v.def.fuelMax : v.boost / 100;
    const eb = this.q('.veh-bar.en');
    eb.firstChild.style.width = `${Math.max(0, en) * 100}%`;
    eb.lastChild.textContent = v.def.fly ? 'FUEL' : 'BOOST';
    const mph = Math.round(Math.hypot(v.vel.x, v.vel.z) * 2.237);
    let s = `${mph} MPH`;
    if (v.def.fly) s += ` · ${Math.max(0, Math.round(v.pos.y - Math.max(0, this.game.world.groundY(v.pos.x, v.pos.z))))} m up`;
    this.q('.vs').textContent = s;
  }

  flash() {
    if (!this.el) return;
    const c = this.q('.veh-card');
    c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit');
  }

  trick(text, sub = '') {
    if (!this.ensure()) return;
    const now = this.game.time;
    if (this.lastTrick === text && now - (this.lastTrickT || 0) < 1.5) return;
    this.lastTrick = text; this.lastTrickT = now;
    this.tr.innerHTML = `<div class="t1"></div><div class="t2"></div>`;
    this.tr.firstChild.textContent = text; this.tr.lastChild.textContent = sub;
    this.tr.classList.remove('pop'); void this.tr.offsetWidth; this.tr.classList.add('pop');
  }
}
