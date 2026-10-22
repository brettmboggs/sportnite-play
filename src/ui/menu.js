import { audio } from '../engine/audio.js';
import { SKINS, SKIN_BY_ID } from '../game/skins.js';
import { RARITIES, WEAPONS, SKILLS } from '../game/weapons/data.js';
import { EMOTES, GLIDERS, WRAPS, REWARD_TRACK, shopToday, xpForLevel, grant } from '../meta/progression.js';
import { CHEATS } from '../game/secrets.js';
import { DEFAULT_SETTINGS } from '../meta/save.js';
import { PadNav, padName, pickGamepad } from './padnav.js';
import { padGlyph, keyGlyph, PS } from './glyphs.js';

const rc = (r) => (RARITIES[r].color === 'rainbow' ? 'var(--rainbow)' : RARITIES[r].color);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['main', 'PLAY'], ['locker', 'LOCKER'], ['shop', 'ITEM SHOP'], ['track', 'REWARDS'], ['minigames', 'MINI-GAMES'], ['career', 'CAREER']];
const LOCKER_SECS = ['skins', 'emotes', 'gliders', 'wraps'];
const SET_SECS = [['game', 'GAME'], ['controller', 'CONTROLLER'], ['video', 'VIDEO'], ['audio', 'AUDIO']];
const TYPE_ICON = { skin: '👕', emote: '💃', glider: '🪂', wrap: '🎨', coins: '🪙' };
// both prompt styles are rendered; CSS shows the one that matches the last device used
const hint = (padIdx, key, label) => `<span class="hint"><span class="pad-only">${padGlyph(padIdx)}</span>${key ? `<span class="kb-only">${keyGlyph(key)}</span>` : ''}${label}</span>`;
const both = (padIdx, key) => `<span class="pad-only">${padGlyph(padIdx)}</span><span class="kb-only">${keyGlyph(key)}</span>`;

export class Menu {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    document.getElementById('ui').appendChild(this.root);
    this.root.addEventListener('click', (e) => { if (e.target.closest('button, .card, .tab, .tier')) audio.ui('click'); }, true);
    this.current = 'main';
    this.lockerSec = 'skins';
    this.setSec = 'game';
    this.inPause = false;
    addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      if (e.code !== 'Escape') return;
      const modal = [...this.root.querySelectorAll('.modal')].pop();
      if (modal) { modal.remove(); return; }
      if (this.game.state === 'paused' && performance.now() - (this.pausedAt || 0) > 250) this.back();
      // controller players have no pointer lock, so Esc must still pause
      else if (this.game.state === 'match' && !this.game.input.locked && !this.game.minigames?.active && !(this.game.match && this.game.match.over)) this.showPause();
      else if (this.game.state === 'lobby' && this.current !== 'main' && !this.root.classList.contains('hidden')) this.showMain();
    });
    this.padnav = new PadNav(game);
  }

  get d() { return this.game.save.data; }

  header(active) {
    const d = this.d;
    return `
      <div class="topbar">
        <div class="logo">SPORT<span>NITE</span></div>
        <div class="tabs">
          <span class="pad-only tab-glyph">${padGlyph(4)}</span>
          ${TABS.map(([k, n]) => `<div class="tab ${k === active ? 'active' : ''}" data-tab="${k}">${n}</div>`).join('')}
          <span class="pad-only tab-glyph">${padGlyph(5)}</span>
        </div>
        <div class="wallet">
          <div class="pad-status ${this.padConnected ? 'on' : ''}" title="Controller">🎮</div>
          <div class="lvl"><div class="lvl-badge">${d.level}</div><div class="lvl-info"><span>LEVEL ${d.level}</span><div class="xpbar"><div style="width:${(d.xp / xpForLevel(d.level)) * 100}%"></div></div></div></div>
          <div class="coins"><span class="coin"></span>${d.coins.toLocaleString()}</div>
          <button class="icon-btn ${active === 'settings' ? 'active' : ''}" data-tab="settings" title="Settings">⚙️</button>
        </div>
      </div>`;
  }

  footer(extra = []) {
    const items = [hint(0, null, 'Select'), hint(1, 'Esc', 'Back'), ...extra];
    return `<div class="footer-hints"><span class="pad-only">${items.join('')}</span>${this.current !== 'main' ? `<span class="kb-only"><span class="hint">${keyGlyph('Esc')}Back</span></span>` : ''}</div>`;
  }

  bindTabs() {
    this.root.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => this.show(t.dataset.tab)));
  }

  show(tab) {
    const map = { main: () => this.showMain(), locker: () => this.showLocker(), shop: () => this.showShop(), track: () => this.showTrack(), minigames: () => this.showMinigames(), career: () => this.showCareer(), settings: () => this.showSettings() };
    (map[tab] || map.main)();
  }

  open(tab, offsetX) {
    this.current = tab;
    this.root.classList.remove('hidden');
    if (offsetX !== undefined && this.game.lobby) this.game.lobby.offsetX = offsetX;
    this.root.dataset.screen = tab;
  }

  hideAll() { this.root.innerHTML = ''; this.root.classList.add('hidden'); this.inPause = false; }

  // ---------- controller hooks (called by padnav) ----------
  cycleTab(dir) {
    if (this.game.state !== 'lobby' || this.root.classList.contains('hidden')) return;
    const keys = TABS.map(([k]) => k);
    const i = keys.indexOf(this.current);
    const next = i < 0 ? 0 : (i + dir + keys.length) % keys.length;
    audio.ui('select');
    this.show(keys[next]);
  }

  cycleSub(dir) {
    if (this.current === 'locker') { const i = LOCKER_SECS.indexOf(this.lockerSec); this.showLocker(LOCKER_SECS[(i + dir + LOCKER_SECS.length) % LOCKER_SECS.length]); audio.ui('select'); }
    else if (this.current === 'settings') { const k = SET_SECS.map(([x]) => x), i = k.indexOf(this.setSec); this.showSettings(k[(i + dir + k.length) % k.length]); audio.ui('select'); }
  }

  back() {
    if (this.game.state === 'paused') {
      if (this.current === 'pause') this.resume();
      else this.renderPause();
      return;
    }
    if (this.game.state === 'lobby' && this.current !== 'main') this.showMain();
  }

  onPadChange(name) {
    this.padConnected = name;
    this.root.querySelectorAll('.pad-status').forEach((e) => { e.classList.toggle('on', !!name); e.title = name || 'No controller'; });
    const n = this.root.querySelector('.pad-name');
    if (n) { n.textContent = name ? `Connected: ${name}` : 'No controller found. Plug in or pair your controller, then press any button.'; n.classList.toggle('on', !!name); }
  }

  padToast(msg) {
    const t = document.createElement('div');
    t.className = 'menu-toast';
    t.textContent = msg;
    document.getElementById('ui').appendChild(t);
    setTimeout(() => t.classList.add('fade'), 2400);
    setTimeout(() => t.remove(), 3000);
  }

  // ---------- main ----------
  showMain() {
    this.open('main', 0.5);
    const d = this.d, s = this.game.settings;
    const skin = SKIN_BY_ID[d.skin];
    const diffs = [['coach', '🧠 Coach (adapts to you)'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['insane', '🔥 Insane']];
    this.root.innerHTML = `
      ${this.header('main')}
      <div class="main-left">
        <div class="hero-rarity" style="--rc:${rc(skin.rarity)}">${RARITIES[skin.rarity].name.toUpperCase()} OUTFIT</div>
        <div class="hero-name">${esc(skin.name)}</div>
        <div class="player-name"><span>👤</span><input class="name-input" data-nav="skip" maxlength="16" value="${esc(d.name)}"></div>
        <div class="main-quick">
          <button class="btn ghost how-btn" data-sq><span class="pad-only">${padGlyph(2)}</span>🎮 How to Play</button>
          <button class="btn ghost cheat-btn" data-tri><span class="pad-only">${padGlyph(3)}</span>🤫 Cheat Codes</button>
        </div>
      </div>
      <div class="main-right">
        <div class="mode-card">
          <div class="mode-tag">SOLO · ${this.game.matchBots() + 1} PLAYERS</div>
          <div class="mode-title">BATTLE ROYALE</div>
          <div class="mode-sub">Drop in. Loot up. Be the last one standing.</div>
          <div class="opt-row"><label>Bots</label><input type="range" min="20" max="50" value="${s.bots}" class="bots-range" style="--p:${((s.bots - 20) / 30) * 100}%"><span class="bots-val">${s.bots}</span></div>
          <div class="opt-row"><label>Difficulty</label><select class="diff">${diffs.map(([k, n]) => `<option value="${k}" ${s.difficulty === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="coach-note">${s.difficulty === 'coach' ? `Coach rating: <b>${Math.round(d.skill * 100)}</b> / 100` : '&nbsp;'}</div>
        </div>
        <button class="btn play-btn" data-focus><span class="play-glyph pad-only">${padGlyph(0)}</span>PLAY</button>
      </div>
      ${this.footer([hint(4, null, ''), hint(5, null, 'Tabs')])}`;
    this.bindTabs();
    const q = (s2) => this.root.querySelector(s2);
    q('.name-input').onchange = (e) => { d.name = e.target.value.trim().slice(0, 16) || 'Player'; this.game.save.write(); };
    q('.name-input').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
    q('.bots-range').oninput = (e) => { s.bots = +e.target.value; q('.bots-val').textContent = s.bots; e.target.style.setProperty('--p', `${((s.bots - 20) / 30) * 100}%`); q('.mode-tag').textContent = `SOLO · ${this.game.matchBots() + 1} PLAYERS`; this.game.save.write(); };
    q('.diff').onchange = (e) => { s.difficulty = e.target.value; this.game.save.write(); q('.coach-note').innerHTML = s.difficulty === 'coach' ? `Coach rating: <b>${Math.round(d.skill * 100)}</b> / 100` : '&nbsp;'; };
    q('.play-btn').onclick = () => { audio.ui('confirm'); this.hideAll(); this.game.startMatchWithLoader(); };
    q('.how-btn').onclick = () => this.showHowTo();
    q('.cheat-btn').onclick = () => this.showCheats();
  }

  // ---------- locker ----------
  card(it, extra = '') {
    const rainbow = RARITIES[it.rarity].color === 'rainbow';
    return `<div class="card r${it.rarity} ${rainbow ? 'cosmic' : ''} ${it.equipped ? 'equipped' : ''} ${it.cls || ''}" ${it.attrs || ''} style="--rc:${rc(it.rarity)}">
      <div class="card-shine"></div>
      <div class="card-icon">${it.icon}</div>
      <div class="card-foot"><div class="card-name">${esc(it.name)}</div><div class="card-r">${it.sub || RARITIES[it.rarity].name}</div></div>
      ${it.equipped ? '<div class="eq">✓ EQUIPPED</div>' : ''}${extra}</div>`;
  }

  showLocker(section = this.lockerSec) {
    this.lockerSec = section;
    this.open('locker', 1.9);
    const d = this.d;
    let items = [];
    if (section === 'skins') items = SKINS.filter((s) => d.owned.skins.includes(s.id)).sort((a, b) => b.rarity - a.rarity).map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, icon: '👕', equipped: d.skin === s.id }));
    if (section === 'emotes') items = EMOTES.filter((e) => d.owned.emotes.includes(e.id)).map((e) => ({ id: e.id, name: e.name, rarity: e.rarity, icon: '💃', equipped: d.emote === e.id }));
    if (section === 'gliders') items = GLIDERS.filter((gl) => d.owned.gliders.includes(gl.id)).map((gl) => ({ id: gl.id, name: gl.name, rarity: gl.rarity, icon: '🪂', equipped: d.glider === gl.id }));
    if (section === 'wraps') items = WRAPS.filter((w) => d.owned.wraps.includes(w.id)).map((w) => ({ id: w.id, name: w.name, rarity: w.rarity, icon: '🎨', equipped: d.wrap === w.id }));
    const total = { skins: SKINS.length, emotes: EMOTES.length, gliders: GLIDERS.length, wraps: WRAPS.length }[section];
    const icons = { skins: '👕', emotes: '💃', gliders: '🪂', wraps: '🎨' };
    this.root.innerHTML = `${this.header('locker')}
      <div class="panel right-panel slide-in">
        <div class="subtabs"><span class="pad-only tab-glyph">${padGlyph(6)}</span>${LOCKER_SECS.map((k) => `<div class="tab sub ${k === section ? 'active' : ''}" data-sec="${k}">${icons[k]} ${k.toUpperCase()}</div>`).join('')}<span class="pad-only tab-glyph">${padGlyph(7)}</span></div>
        <div class="owned-count"><b>${items.length}</b> / ${total} collected<div class="xpbar wide"><div style="width:${(items.length / total) * 100}%"></div></div></div>
        ${items.length ? `<div class="grid">${items.map((it) => this.card({ ...it, attrs: `data-id="${esc(it.id)}"` })).join('')}</div>` : `<div class="empty-note">Nothing here yet! Earn ${section} on the Reward Track or buy them in the Item Shop.</div>`}
      </div>
      ${this.footer([hint(6, null, ''), hint(7, null, 'Sections')])}`;
    this.bindTabs();
    this.root.querySelectorAll('[data-sec]').forEach((t) => (t.onclick = () => this.showLocker(t.dataset.sec)));
    this.root.querySelectorAll('.card').forEach((c) => {
      const id = c.dataset.id;
      c.onmouseenter = () => { if (section === 'skins') this.game.lobby.setSkin(id); else if (section === 'emotes') this.game.lobby.playEmote(id); };
      c.onmouseleave = () => { if (section === 'skins') this.game.lobby.setSkin(d.skin); };
      c.onclick = () => {
        if (section === 'skins') { d.skin = id; this.game.lobby.setSkin(id); }
        if (section === 'emotes') { d.emote = id; this.game.lobby.playEmote(id); }
        if (section === 'gliders') d.glider = id;
        if (section === 'wraps') d.wrap = id;
        this.game.save.write();
        audio.ui('confirm');
        this.root.querySelectorAll('.card.equipped').forEach((e) => { e.classList.remove('equipped'); e.querySelector('.eq')?.remove(); });
        c.classList.add('equipped', 'bounce');
        c.insertAdjacentHTML('beforeend', '<div class="eq">✓ EQUIPPED</div>');
        if (section === 'skins') { const hn = this.root.querySelector('.hero-name'); if (hn) hn.textContent = SKIN_BY_ID[id].name; }
      };
    });
  }

  // ---------- shop ----------
  showShop() {
    this.open('shop', 1.9);
    const d = this.d;
    const items = shopToday();
    const info = (it) => {
      if (it.type === 'skin') { const s = SKIN_BY_ID[it.id]; return { name: s.name, rarity: s.rarity, icon: '👕', owned: d.owned.skins.includes(it.id) }; }
      if (it.type === 'emote') { const e = EMOTES.find((x) => x.id === it.id); return { name: e.name, rarity: e.rarity, icon: '💃', owned: d.owned.emotes.includes(it.id) }; }
      const g = GLIDERS.find((x) => x.id === it.id); return { name: g.name, rarity: g.rarity, icon: '🪂', owned: d.owned.gliders.includes(it.id) };
    };
    const msLeft = 86400000 - (Date.now() % 86400000);
    const h = Math.floor(msLeft / 3600000), m = Math.floor((msLeft % 3600000) / 60000);
    const shopCard = (it, i, big) => {
      const f = info(it);
      return this.card({ ...f, cls: `${big ? 'featured' : ''} ${f.owned ? 'owned' : ''} ${!f.owned && d.coins < it.price ? 'pricey' : ''}`, attrs: `data-i="${i}"`, sub: `${RARITIES[f.rarity].name} ${it.type}` },
        `<div class="price">${f.owned ? '✓ OWNED' : `<span class="coin"></span>${it.price.toLocaleString()}`}</div>`);
    };
    // the two rarest items are "featured"
    const order = items.map((it, i) => ({ it, i, r: info(it).rarity })).sort((a, b) => b.r - a.r);
    const featured = order.slice(0, 2), daily = order.slice(2);
    this.root.innerHTML = `${this.header('shop')}
      <div class="panel right-panel shop-panel slide-in">
        <div class="shop-head"><h2>ITEM SHOP</h2><div class="shop-timer">⏱️ New items in <b>${h}h ${m}m</b></div></div>
        <div class="shop-sub">Coins come from playing matches and mini-games!</div>
        <h3 class="sec-title">FEATURED</h3>
        <div class="grid shop featured-row">${featured.map(({ it, i }) => shopCard(it, i, true)).join('')}</div>
        <h3 class="sec-title">DAILY</h3>
        <div class="grid shop">${daily.map(({ it, i }) => shopCard(it, i, false)).join('')}</div>
      </div>
      ${this.footer()}`;
    this.bindTabs();
    this.root.querySelectorAll('.card').forEach((c) => {
      const it = items[+c.dataset.i];
      c.onmouseenter = () => { if (it.type === 'skin') this.game.lobby.setSkin(it.id); else if (it.type === 'emote') this.game.lobby.playEmote(it.id); };
      c.onmouseleave = () => this.game.lobby.setSkin(d.skin);
      c.onclick = () => {
        const f = info(it);
        if (f.owned) { this.padToast('You already own this! Equip it in the Locker.'); return; }
        if (d.coins < it.price) { this.padToast(`You need ${it.price - d.coins} more coins. Win matches and play mini-games!`); audio.ui('error'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); return; }
        this.confirmBuy(it, f);
      };
    });
  }

  confirmBuy(it, f) {
    const d = this.d;
    const m = this.modal(`<div class="buy-box" style="--rc:${rc(f.rarity)}">
      <div class="buy-icon ${RARITIES[f.rarity].color === 'rainbow' ? 'cosmic' : ''}">${f.icon}</div>
      <div class="buy-r">${RARITIES[f.rarity].name.toUpperCase()} ${it.type.toUpperCase()}</div>
      <h2>${esc(f.name)}</h2>
      <div class="buy-price"><span class="coin"></span>${it.price.toLocaleString()} <small>(you have ${d.coins.toLocaleString()})</small></div>
      <button class="btn big buy-yes" data-focus>${both(0, 'Enter')} BUY</button></div>`, 'CANCEL');
    m.querySelector('.buy-yes').onclick = () => {
      d.coins -= it.price;
      grant(this.game.save, it);
      this.game.save.write();
      audio.jingle('unlock', 0.6);
      m.remove();
      this.showShop();
      this.celebrate(`${f.icon} ${f.name}`, 'is yours! Equip it in the Locker.', f.rarity);
    };
  }

  celebrate(title, sub, rarity = 4) {
    const c = document.createElement('div');
    c.className = 'celebrate';
    c.style.setProperty('--rc', rc(rarity));
    c.innerHTML = `<div class="cel-burst"></div><div class="cel-title">${esc(title)}</div><div class="cel-sub">${esc(sub)}</div>`;
    this.root.appendChild(c);
    setTimeout(() => c.classList.add('fade'), 1800);
    setTimeout(() => c.remove(), 2400);
  }

  // ---------- reward track ----------
  showTrack() {
    this.open('track', 0);
    const d = this.d;
    const label = (r) => r.type === 'coins' ? `${r.amount} Coins` : r.type === 'skin' ? SKIN_BY_ID[r.id]?.name : r.type === 'emote' ? EMOTES.find((e) => e.id === r.id)?.name : r.type === 'glider' ? GLIDERS.find((g) => g.id === r.id)?.name : WRAPS.find((w) => w.id === r.id)?.name;
    const rarity = (r) => r.type === 'skin' ? SKIN_BY_ID[r.id]?.rarity ?? 0 : r.type === 'emote' ? EMOTES.find((e) => e.id === r.id)?.rarity ?? 0 : r.type === 'glider' ? GLIDERS.find((g) => g.id === r.id)?.rarity ?? 0 : r.type === 'wrap' ? WRAPS.find((w) => w.id === r.id)?.rarity ?? 0 : 0;
    const pct = (d.xp / xpForLevel(d.level)) * 100;
    this.root.innerHTML = `${this.header('track')}
      <div class="panel wide slide-in">
        <div class="shop-head"><h2>REWARD TRACK</h2><div class="track-lvl">LEVEL <b>${d.level}</b><div class="xpbar wide"><div style="width:${pct}%"></div></div><small>${d.xp.toLocaleString()} / ${xpForLevel(d.level).toLocaleString()} XP</small></div></div>
        <div class="shop-sub">Level up by playing to unlock every tier. It's all free!</div>
        <div class="track">${REWARD_TRACK.map((r, i) => {
          const tier = i + 1, got = d.level > tier, rr = rarity(r);
          return `<div class="tier ${got ? 'got' : ''} ${d.level === tier ? 'next' : ''} ${RARITIES[rr].color === 'rainbow' ? 'cosmic' : ''} ${tier % 10 === 0 ? 'milestone' : ''}" style="--rc:${rc(rr)}">
            <div class="tier-num">${tier}</div><div class="tier-icon">${TYPE_ICON[r.type]}</div><div class="tier-reward">${esc(label(r) || '')}</div>${got ? '<div class="check">✓</div>' : d.level === tier ? '<div class="tier-next">NEXT</div>' : '<div class="lock">🔒</div>'}</div>`;
        }).join('')}</div>
      </div>
      ${this.footer()}`;
    this.bindTabs();
    const next = this.root.querySelector('.tier.next') || this.root.querySelector('.tier:not(.got)');
    if (next) { next.setAttribute('data-focus', ''); next.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  }

  // ---------- minigames ----------
  showMinigames() {
    this.open('minigames', 0);
    const hs = this.d.highscores || {};
    const games = [
      ['hoops', '🏀', 'HOOPS', '3-point shootout: 5 racks, money balls, 60 seconds!', 'points', '#ff7a1f'],
      ['homerun', '⚾', 'HOME RUN DERBY', '10 outs. Time your swing and smash homers over the wall!', 'home runs', '#3aa0ff'],
      ['penalty', '⚽', 'PENALTY KICKS', 'Best-of-5 shootout. Shoot AND be the goalie!', 'goals', '#58d63b'],
    ];
    this.root.innerHTML = `${this.header('minigames')}
      <div class="panel wide slide-in">
        <h2>MINI-GAMES <small>Earn coins here. In matches, win them at their venues for a Rare Chest!</small></h2>
        <div class="mg-cards">${games.map(([id, icon, name, desc, unit, col], i) => `<div class="mg-card" data-mg="${id}" style="--mc:${col};animation-delay:${i * 0.08}s"><div class="mg-icon">${icon}</div><div class="mg-name">${name}</div><div class="mg-desc">${desc}</div><div class="mg-best">🏅 Best: <b>${hs[id] || 0}</b> ${unit}</div><button class="btn">PLAY</button></div>`).join('')}</div>
      </div>
      ${this.footer()}`;
    this.bindTabs();
    this.root.querySelectorAll('.mg-card').forEach((c) => (c.querySelector('button').onclick = () => { this.hideAll(); this.game.startPractice(c.dataset.mg); }));
  }

  // ---------- career ----------
  showCareer() {
    this.open('career', 0);
    const d = this.d, s = d.stats;
    const hist = (d.history || []).slice(-10).reverse();
    const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
    this.root.innerHTML = `${this.header('career')}
      <div class="panel wide slide-in" data-nav-scroll>
        <h2>CAREER</h2>
        <div class="res-stats big">
          <div><b>${s.matches}</b>Matches</div><div><b>${s.wins}</b>Wins 🏆</div><div><b>${winRate}%</b>Win rate</div><div><b>${s.kills}</b>Eliminations</div>
          <div><b>${s.top10}</b>Top 10s</div><div><b>${s.bossKills}</b>Bosses beaten</div><div><b>${Math.round(s.damage || 0).toLocaleString()}</b>Damage</div><div><b>${(d.trophies || []).length}/5</b>Secret trophies</div>
        </div>
        <div class="coach-box">🧠 <b>Coach rating: ${Math.round(d.skill * 100)}/100.</b> The better you play, the smarter the bots get. Win to raise it!<div class="xpbar wide"><div style="width:${d.skill * 100}%"></div></div></div>
        <h3>Last matches</h3>
        <div class="history">${hist.length ? hist.map((h) => `<div class="hrow ${h.won ? 'won' : ''}">${h.won ? '🏆 WIN' : `#${h.place}`} · ${h.kills} elims</div>`).join('') : '<i>No matches yet. Go drop in!</i>'}</div>
        <div class="collection">Collection: ${d.owned.skins.length}/${SKINS.length} outfits · ${d.owned.emotes.length}/${EMOTES.length} emotes · ${d.owned.gliders.length}/${GLIDERS.length} gliders</div>
        <div class="weapon-list"><h3>Weapons in the game (${Object.keys(WEAPONS).length})</h3>${Object.values(WEAPONS).map((w) => `<span class="wtag">${w.name}</span>`).join('')}</div>
        <div class="weapon-list"><h3>Skills you can find (${Object.keys(SKILLS).length})</h3>${Object.values(SKILLS).map((s2) => `<span class="wtag">${s2.icon} ${s2.name}</span>`).join('')}</div>
        <button class="btn ghost scroll-top" data-nav>⬆ Back to top</button>
      </div>
      ${this.footer([`<span class="hint pad-only"><span class="glyph pad wide">R-STICK</span> Scroll</span>`])}`;
    this.bindTabs();
    this.root.querySelector('.scroll-top').onclick = () => { this.root.querySelector('.panel').scrollTop = 0; };
  }

  // ---------- settings ----------
  showSettings(section = this.setSec) {
    this.setSec = section;
    this.open('settings');
    const s = this.game.settings;
    const row = (label, html, help = '') => `<div class="set-row"><label>${label}${help ? `<small>${help}</small>` : ''}</label><div class="set-ctl">${html}</div></div>`;
    const fmt = (k, v) => (['master', 'sfx', 'music', 'aimAssist'].includes(k) ? `${Math.round(v * 100)}%` : k === 'padDeadzone' ? `${Math.round(v * 100)}%` : k === 'fov' || k === 'bots' ? v : (+v).toFixed(2));
    const range = (k, min, max, step) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}" style="--p:${((s[k] - min) / (max - min)) * 100}%"><span class="val">${fmt(k, s[k])}</span>`;
    const check = (k) => `<label class="toggle"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span class="knob"></span></label>`;
    const sel = (k, opts) => `<select data-k="${k}">${opts.map(([v, n]) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    let body = '';
    if (section === 'game') body = `<div class="set-cols"><div>
          <h3>Mouse + Keyboard</h3>
          ${row('Mouse sensitivity', range('sensitivity', 0.2, 3, 0.05))}
          ${row('Invert look', check('invertY'), 'Up and down are flipped')}
          ${row('Auto-sprint', check('autoSprint'), 'Always run fast')}
        </div><div>
          <h3>HUD</h3>
          ${row('HUD size', range('hudScale', 0.8, 1.25, 0.05))}
          ${row('Damage numbers', check('damageNumbers'))}
          ${row('Cartoon blood', check('blood'), 'Splats when you hit someone')}
          <h3>Progress</h3>
          <div class="set-btns"><button class="btn ghost reset-settings">Reset settings</button>
          <button class="btn ghost danger reset-save">Reset ALL progress</button></div>
        </div></div>`;
    if (section === 'controller') body = `<div class="pad-name ${this.padConnected ? 'on' : ''}">${this.padConnected ? `Connected: ${esc(this.padConnected)}` : 'No controller found. Plug in or pair your controller, then press any button.'}</div>
        <div class="set-cols"><div>
          <h3>Look</h3>
          ${row('Look sensitivity', range('padSensitivity', 0.2, 3, 0.05), 'Overall speed')}
          ${row('Horizontal (X) speed', range('padLookX', 0.3, 2, 0.05))}
          ${row('Vertical (Y) speed', range('padLookY', 0.3, 2, 0.05))}
          ${row('Aim-down-sights speed', range('padAdsSens', 0.2, 1.5, 0.05), 'Look speed while aiming (L2)')}
          ${row('Invert look', check('invertY'))}
          <h3>Feel</h3>
          ${row('Stick deadzone', range('padDeadzone', 0.05, 0.3, 0.01), 'Raise it if your view drifts')}
          ${row('Aim assist', range('aimAssist', 0, 1.5, 0.1))}
          ${row('Vibration', check('vibration'))}
          <div class="set-btns"><button class="btn ghost rumble-test">📳 Test vibration</button></div>
        </div><div>
          <h3>Button test</h3>
          <div class="padtest" data-nav="padtest" tabindex="-1">${this.padTestHtml()}</div>
          <div class="padtest-hint"><span class="pad-only">Move here and press buttons: they light up! Hold ${padGlyph(1)} to leave.</span><span class="kb-only">Press buttons on your controller: they light up!</span><div class="hold-bar"><div></div></div></div>
        </div></div>`;
    if (section === 'video') body = `<div class="set-cols"><div>
          <h3>Display</h3>
          ${row('Field of view', range('fov', 65, 100, 1))}
          ${row('Graphics', sel('quality', [['auto', 'Auto (recommended)'], ['potato', 'Potato (old laptops)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High (prettiest)']]), s.quality === 'auto' ? `Right now: ${this.game.renderer.quality}` : s.quality === 'potato' ? 'No shadows or grass, max 20 bots' : '')}
          ${row('Show FPS', check('showFps'))}
        </div><div></div></div>`;
    if (section === 'audio') body = `<div class="set-cols"><div>
          <h3>Volume</h3>
          ${row('Master volume', range('master', 0, 1, 0.05))}
          ${row('Sound effects', range('sfx', 0, 1, 0.05))}
          ${row('Music', range('music', 0, 1, 0.05))}
        </div><div></div></div>`;
    const top = this.inPause
      ? `<div class="topbar"><div class="logo">SPORT<span>NITE</span></div><div class="tabs"><div class="tab active">SETTINGS</div></div><div class="wallet"><button class="btn ghost back-pause">${both(1, 'Esc')} BACK</button></div></div>`
      : this.header('settings');
    this.root.innerHTML = `${top}
      <div class="panel wide settings slide-in">
        <div class="subtabs"><span class="pad-only tab-glyph">${padGlyph(6)}</span>${SET_SECS.map(([k, n]) => `<div class="tab sub ${k === section ? 'active' : ''}" data-set="${k}">${n}</div>`).join('')}<span class="pad-only tab-glyph">${padGlyph(7)}</span></div>
        ${body}
      </div>
      ${this.footer([hint(6, null, ''), hint(7, null, 'Sections'), `<span class="hint pad-only">${padGlyph(14)}${padGlyph(15)} Adjust</span>`])}`;
    if (!this.inPause) this.bindTabs();
    else this.root.querySelector('.back-pause').onclick = () => this.renderPause();
    this.root.querySelectorAll('[data-set]').forEach((t) => (t.onclick = () => this.showSettings(t.dataset.set)));
    this.root.querySelectorAll('[data-k]').forEach((inp) => {
      inp.oninput = inp.onchange = () => {
        const k = inp.dataset.k;
        s[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
        if (inp.type === 'range') { inp.style.setProperty('--p', `${((+inp.value - +inp.min) / (+inp.max - +inp.min)) * 100}%`); const v = inp.parentElement.querySelector('.val'); if (v) v.textContent = fmt(k, s[k]); }
        this.game.applySettings();
        this.game.hud?.applyHudSettings?.();
        if (k === 'quality') this.showSettings(); // refresh the "Right now" / Potato notes
      };
    });
    const q = (x) => this.root.querySelector(x);
    if (q('.rumble-test')) q('.rumble-test').onclick = () => {
      const p = pickGamepad();
      if (p && p.vibrationActuator && s.vibration) p.vibrationActuator.playEffect('dual-rumble', { duration: 400, strongMagnitude: 0.9, weakMagnitude: 0.6 }).catch(() => {});
      else this.padToast(!p ? 'No controller connected' : !s.vibration ? 'Vibration is turned off' : 'This controller can\'t vibrate in the browser');
    };
    if (q('.reset-settings')) q('.reset-settings').onclick = () => { Object.assign(s, DEFAULT_SETTINGS); this.game.applySettings(); this.game.hud?.applyHudSettings?.(); this.showSettings(); this.padToast('Settings reset'); };
    if (q('.reset-save')) q('.reset-save').onclick = (e) => {
      const b = e.currentTarget;
      if (b.dataset.confirm) { this.game.save.reset(); this.game.settings = this.game.save.data.settings; this.game.applySettings(); this.game.lobby.setSkin(this.d.skin); this.showMain(); }
      else { b.dataset.confirm = '1'; b.textContent = 'Press again to ERASE everything'; }
    };
  }

  padTestHtml() {
    const b = (i, cls) => `<div class="pt-b ${cls}" data-b="${i}">${PS[i]}</div>`;
    return `<div class="pt-body">
      ${b(6, 'l2')}${b(4, 'l1')}${b(7, 'r2')}${b(5, 'r1')}
      ${b(8, 'create')}${b(9, 'options')}${b(16, 'ps')}
      ${b(12, 'up')}${b(13, 'down')}${b(14, 'left')}${b(15, 'right')}
      ${b(3, 'tri')}${b(1, 'o')}${b(0, 'x')}${b(2, 'sq')}
      <div class="pt-stick ls" data-b="10"><div class="pt-dot"></div></div>
      <div class="pt-stick rs" data-b="11"><div class="pt-dot"></div></div>
    </div>`;
  }

  updatePadTest(s) {
    const t = this.root.querySelector('.padtest');
    if (!t) return;
    t.querySelectorAll('[data-b]').forEach((e) => e.classList.toggle('on', !!s.buttons[+e.dataset.b]));
    const dots = t.querySelectorAll('.pt-dot');
    if (dots[0]) dots[0].style.transform = `translate(${s.axes[0] * 14}px, ${s.axes[1] * 14}px)`;
    if (dots[1]) dots[1].style.transform = `translate(${s.axes[2] * 14}px, ${s.axes[3] * 14}px)`;
    // trigger pressure fill
    const val = s.values || [];
    t.querySelector('.l2').style.setProperty('--v', `${(val[6] || 0) * 100}%`);
    t.querySelector('.r2').style.setProperty('--v', `${(val[7] || 0) * 100}%`);
  }

  updatePadTestHold(f) {
    const hb = this.root.querySelector('.hold-bar div');
    if (hb) hb.style.width = `${Math.min(1, f) * 100}%`;
  }

  // ---------- extras ----------
  modal(html, closeLabel = 'CLOSE') {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box">${html}<button class="btn ghost close-modal">${both(1, 'Esc')} ${closeLabel}</button></div>`;
    this.root.appendChild(m);
    m.querySelector('.close-modal').onclick = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    return m;
  }

  showHowTo() {
    const r = (pad, kb, what) => `<div class="ctl-row"><div class="ctl-kb">${kb.map(keyGlyph).join('')}</div><div class="ctl-pad">${pad.map((x) => (typeof x === 'string' ? `<span class="glyph pad wide">${x}</span>` : padGlyph(x))).join('')}</div><div class="ctl-what">${what}</div></div>`;
    const m = this.modal(`<h2>HOW TO PLAY</h2>
      <div class="how-goal">🪂 Jump from the blimp · 🎁 Loot weapons · 🧱 Build to survive · ⚡ Stay out of the storm · 🏆 Be the last one standing!</div>
      <div class="ctl-table">
        <div class="ctl-row head"><div class="ctl-kb">⌨️ KEYBOARD</div><div class="ctl-pad">🎮 PS5</div><div class="ctl-what"></div></div>
        ${r(['L-STICK'], ['WASD'], 'Move')}
        ${r(['R-STICK'], ['Mouse'], 'Look')}
        ${r([0], ['Space'], 'Jump · open glider')}
        ${r([10], ['Shift'], 'Sprint')}
        ${r([1], ['Ctrl', 'C'], 'Crouch · slide while sprinting')}
        ${r([7], ['LMB'], 'Shoot')}
        ${r([6], ['RMB'], 'Aim down sights')}
        ${r([2], ['R'], 'Reload')}
        ${r([2], ['E'], 'Pick up · open chests (hold)')}
        ${r([4, 5], ['1-5', 'Wheel'], 'Switch weapons')}
        ${r([4, 5], ['X'], 'Bat (hit trees, rocks and cars for materials)')}
        ${r([1], ['Q'], 'Build mode on / off')}
        ${r([7, 6, 5, 4], ['Z', 'V', 'F2', 'F4'], 'Build wall · ramp · floor · cone')}
        ${r([2], ['R'], 'Switch material (in build mode)')}
        ${r([14, 15], ['F', 'B'], 'Use skills')}
        ${r([12], ['U'], 'Ultimate (kill streak)')}
        ${r([13], ['H'], 'Emote / dance')}
        ${r([8], ['M'], 'Map')}
        ${r([9], ['Esc'], 'Pause')}
      </div>
      <h3>Pro tips</h3>
      <div class="tips">
        <div>⛏️ Swing your bat at trees, rocks and cars to get materials.</div>
        <div>🎁 Supply drops have Epic loot or better.</div>
        <div>👑 Bosses guard Mythic weapons.</div>
        <div>🏀 Win mini-games at the sports venues for a Rare Chest.</div>
        <div>🔥 Get 3, 5 or 8 eliminations in one life for ULTIMATES!</div>
        <div>🏆 5 secret golden trophies are hidden on the island...</div>
      </div>`);
    m.querySelector('.modal-box').classList.add('how');
    m.querySelector('.close-modal').setAttribute('data-focus', '');
  }

  showCheats() {
    const active = () => Object.entries(CHEATS).filter(([, c]) => this.game.cheats[c.key]).map(([k]) => `<span class="wtag on">${k}</span>`).join('') || '<i>No cheats on</i>';
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const m = this.modal(`<h2>🤫 CHEAT CODES</h2>
      <p>Type a secret code. (Hint: try <b>GODMODE</b>, <b>MOONJUMP</b>, <b>TURBO</b>... there are more to find!)</p>
      <input class="cheat-input" data-nav="skip" placeholder="ENTER CODE" maxlength="20">
      <div class="osk">${keys.map((k) => `<button class="osk-k" data-k="${k}">${k}</button>`).join('')}<button class="osk-k wide del">⌫</button><button class="osk-k wide clr">CLEAR</button><button class="btn enter-code">ENTER</button></div>
      <div class="cheat-msg"></div>
      <div class="active-cheats">${active()}</div>`);
    const inp = m.querySelector('.cheat-input');
    const go = () => {
      const msg = this.game.secrets.enterCode(inp.value);
      const mm = m.querySelector('.cheat-msg');
      mm.textContent = msg; mm.classList.remove('pop'); void mm.offsetWidth; mm.classList.add('pop');
      inp.value = '';
      m.querySelector('.active-cheats').innerHTML = active();
    };
    m.querySelector('.enter-code').onclick = go;
    m.querySelectorAll('.osk-k[data-k]').forEach((b) => (b.onclick = () => { if (inp.value.length < 20) inp.value += b.dataset.k; }));
    m.querySelector('.del').onclick = () => { inp.value = inp.value.slice(0, -1); };
    m.querySelector('.clr').onclick = () => { inp.value = ''; };
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    if (!this.padnav.padMode) inp.focus();
  }

  // ---------- pause ----------
  showPause() {
    if (this.game.state !== 'match') return;
    this.game.state = 'paused';
    this.game.input.enabled = false;
    this.pausedAt = performance.now();
    audio.ui('open');
    this.renderPause();
  }

  renderPause() {
    this.inPause = true;
    this.current = 'pause';
    this.root.classList.remove('hidden');
    const g = this.game, m = g.match, p = g.player;
    const info = m ? `<div class="pause-info"><div><b>${m.alive().length}</b>Players left</div><div><b>${p ? p.kills : 0}</b>Eliminations</div><div><b>${m.storm && m.storm.phase >= 0 ? m.storm.phase + 1 : 0}</b>Storm phase</div></div>` : '';
    this.root.innerHTML = `<div class="pause"><div class="pause-box">
      <h1>PAUSED</h1>${info}
      <button class="btn big resume" data-focus>RESUME</button>
      <button class="btn ghost settings">⚙️ SETTINGS</button>
      <button class="btn ghost how">🎮 HOW TO PLAY</button>
      <button class="btn ghost danger quit">🚪 LEAVE MATCH</button>
      <div class="pause-hints"><span class="pad-only">${padGlyph(9)} or ${padGlyph(1)} Resume</span><span class="kb-only">${keyGlyph('Esc')} Resume</span></div>
    </div></div>`;
    const q = (s) => this.root.querySelector(s);
    q('.resume').onclick = () => this.resume();
    q('.how').onclick = () => this.showHowTo();
    q('.settings').onclick = () => this.showSettings();
    q('.quit').onclick = (e) => {
      const b = e.currentTarget;
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.innerHTML = '⚠️ PRESS AGAIN TO LEAVE'; return; }
      this.hideAll(); g.state = 'match'; g.input.enabled = true; g.returnToLobby();
    };
  }

  resume() {
    this.hideAll();
    this.game.state = 'match';
    this.game.input.enabled = true;
    // a controller player has no mouse to lock; asking without a click just throws an error
    if (!this.padnav.padMode) this.game.input.requestLock();
  }
}

export { padName };
