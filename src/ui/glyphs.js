// Button prompts that match what the player is holding: PlayStation glyphs for a controller,
// keycaps for keyboard + mouse. Every prompt in the UI goes through here.

// standard gamepad button index -> PlayStation label
export const PS = ['✕', '◯', '□', '△', 'L1', 'R1', 'L2', 'R2', 'CREATE', 'OPTIONS', 'L3', 'R3', '▲', '▼', '◀', '▶', 'PS'];
const FACE_CLASS = { 0: 'x', 1: 'o', 2: 'sq', 3: 'tri' };

// action -> controller button (matches src/engine/input.js PAD map)
const PAD_ACTION = {
  jump: 0, crouch: 11, build: 1, reload: 2, interact: 2, pickaxe: 3, fire: 7, aim: 6, swapNext: 5, swapPrev: 4,
  sprint: 10, edit: 1, pause: 9, map: 8, skill1: 14, skill2: 15, ultimate: 12, emote: 13,
  wall: 7, ramp: 6, floor: 5, cone: 4, material: 2, confirm: 0, back: 1, tabPrev: 4, tabNext: 5, subPrev: 6, subNext: 7,
};
const KEY_ACTION_FALLBACK = { fire: 'LMB', aim: 'RMB', swapNext: 'Wheel', swapPrev: 'Wheel', material: 'R', confirm: 'Enter', back: 'Esc', tabPrev: 'Q', tabNext: 'E' };

const keyName = (code) => {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter' })[code] || code;
};

export function padGlyph(index) {
  const label = PS[index] ?? '?';
  const face = FACE_CLASS[index];
  return `<span class="glyph pad ${face ? `face ${face}` : label.length > 2 ? 'wide' : ''}">${label}</span>`;
}

export function keyGlyph(label) {
  return `<span class="glyph key ${label.length > 2 ? 'wide' : ''}">${label}</span>`;
}

// glyph for a game action, picking controller or keyboard automatically
export function glyph(game, action, usePad = isPad(game)) {
  if (usePad && PAD_ACTION[action] !== undefined) return padGlyph(PAD_ACTION[action]);
  const binds = game?.input?.binds?.[action];
  if (binds && binds.length) return keyGlyph(keyName(binds[0]));
  return keyGlyph(KEY_ACTION_FALLBACK[action] || action);
}

export function isPad(game) {
  return !!(game && game.input && game.input.usingPad);
}
