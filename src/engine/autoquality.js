// Auto graphics: watches the frame rate during a match and picks the prettiest quality that still runs smooth.
// Choppy for a few seconds → one step down. Smooth for a long while → one step up, but never back up to a level
// that was already too slow this session (so it can't flip back and forth).
export const QUALITY_LEVELS = ['potato', 'low', 'medium', 'high'];

const DOWN_FPS = 42, DOWN_WINDOW = 4; // average below 42 FPS over 4 seconds
const UP_FPS = 57, UP_WINDOW = 20; // average 57+ FPS over 20 seconds
const SETTLE = 5; // seconds to ignore after a match starts or the quality changes (loading hitches)

export class AutoQuality {
  constructor(level) {
    this.level = QUALITY_LEVELS.includes(level) ? level : 'medium';
    this.ceiling = QUALITY_LEVELS.length - 1; // highest level we're still allowed to try
    this.reset();
  }

  reset() { this.settle = SETTLE; this.downT = 0; this.downN = 0; this.upT = 0; this.upN = 0; }

  // call once per match frame with the real frame time; returns the new level when it changes, otherwise null
  update(dt) {
    if (this.settle > 0) { this.settle -= dt; return null; }
    this.downT += dt; this.downN++;
    this.upT += dt; this.upN++;
    const i = QUALITY_LEVELS.indexOf(this.level);
    if (this.downT >= DOWN_WINDOW) {
      const fps = this.downN / this.downT;
      this.downT = 0; this.downN = 0;
      if (fps < DOWN_FPS && i > 0) {
        this.ceiling = i - 1;
        return this.set(QUALITY_LEVELS[i - 1]);
      }
    }
    if (this.upT >= UP_WINDOW) {
      const fps = this.upN / this.upT;
      this.upT = 0; this.upN = 0;
      if (fps >= UP_FPS && i < this.ceiling) return this.set(QUALITY_LEVELS[i + 1]);
    }
    return null;
  }

  set(level) { this.level = level; this.reset(); return level; }
}
