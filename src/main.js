import { Game } from './game/game.js';
import { audio } from './engine/audio.js';

const TIPS = [
  'Swing your bat at trees, rocks and cars to collect building materials!',
  'Golden chests hum and glow. Listen for them!',
  'Get 3 eliminations in one life to unlock MEGA SHIELD.',
  'Bosses guard Mythic weapons. Bring friends... oh wait, bring rockets.',
  'Win a mini-game at a sports venue for a Rare Chest!',
  'Hold W while skydiving to fall faster.',
  'Slide by pressing crouch while sprinting.',
  'There are 5 secret golden trophies hidden on the island...',
  'Try emoting next to the dancing skeleton in Creepy Crypts.',
  'Cosmic weapons are the rarest of all. They shimmer like a rainbow!',
];

const loading = document.getElementById('loading');
const fill = loading.querySelector('.loading-fill');
const text = loading.querySelector('.loading-text');
const pct = loading.querySelector('.loading-pct');
const tipEl = loading.querySelector('.loading-tip');
let tipIdx = Math.floor(Math.random() * TIPS.length);
const showTip = () => { tipEl.innerHTML = `<b>TIP:</b> ${TIPS[tipIdx++ % TIPS.length]}`; };
showTip();
const tipTimer = setInterval(showTip, 4000);

const game = new Game();
window.sportnite = game; // handy for debugging in the browser console

game.init((p, msg) => {
  fill.style.width = `${Math.round(p * 100)}%`;
  if (pct) pct.textContent = `${Math.round(p * 100)}%`;
  if (msg) text.textContent = msg;
}).then(() => {
  clearInterval(tipTimer);
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 800);
  game.start();
  // browsers only allow sound after the first click/key press
  const unlock = () => { audio.init(); audio.startMusic('lobby'); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
}).catch((err) => {
  console.error(err);
  text.textContent = 'Oops! Something broke while loading: ' + err.message;
});
