// Auto graphics: watches the frame rate during a match and picks the prettiest quality that still runs smooth.
// Choppy for a few seconds → one step down. Smooth for a long while → one step up, but never back up to a level
// that was already too slow this session (so it can't flip back and forth).
export const QUALITY_LEVELS = ['potato', 'low', 'medium', 'high'];

const DOWN_FPS = 50, DOWN_WINDOW = 4; // average below 50 FPS over 4 seconds, even at the lowest resolution
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
  // canDown / canUp: dynamic resolution goes first, so the level only drops once resolution is already at its lowest
  // and only rises once it's back at full resolution
  update(dt, canDown = true, canUp = true) {
    if (this.settle > 0) { this.settle -= dt; return null; }
    this.downT += dt; this.downN++;
    this.upT += dt; this.upN++;
    const i = QUALITY_LEVELS.indexOf(this.level);
    if (this.downT >= DOWN_WINDOW) {
      const fps = this.downN / this.downT;
      this.downT = 0; this.downN = 0;
      if (fps < DOWN_FPS && i > 0 && canDown) {
        this.ceiling = i - 1;
        return this.set(QUALITY_LEVELS[i - 1]);
      }
    }
    if (this.upT >= UP_WINDOW) {
      const fps = this.upN / this.upT;
      this.upT = 0; this.upN = 0;
      if (fps >= UP_FPS && i < this.ceiling && canUp) return this.set(QUALITY_LEVELS[i + 1]);
    }
    return null;
  }

  set(level) { this.level = level; this.reset(); return level; }
}

// Dynamic resolution, like console games: if frames take too long, render at a slightly lower resolution; when it's
// smooth again, creep back up. Reacts within a second, long before the quality level has to drop.
export const MIN_SCALE = 0.6;
const SLOW_MS = 19, SMOOTH_MS = 17.6; // aiming for a steady 60 FPS

export class DynamicResolution {
  constructor() { this.reset(); }

  // call every match frame with the real frame time; returns the new scale when it changes, otherwise null
  update(dt) {
    this.failT -= dt;
    if (this.cool > 0) { this.cool -= dt; return null; } // let a resize settle before judging again
    this.t += dt; this.n++;
    if (this.t < 0.75) return null;
    const avg = (this.t / this.n) * 1000;
    this.t = 0; this.n = 0;
    if (avg > SLOW_MS) {
      this.upWait = 4;
      if (this.scale <= MIN_SCALE) return null;
      // remember what was too slow, and don't climb back to it for a while (no bouncing up and down)
      this.failAt = this.scale; this.failT = 30;
      this.scale = Math.max(MIN_SCALE, this.scale - (avg > 28 ? 0.15 : 0.08));
      this.cool = 0.5;
      return this.scale;
    }
    if (avg < SMOOTH_MS) {
      this.upWait -= 0.75;
      const next = Math.min(1, this.scale + 0.05);
      if (this.upWait <= 0 && this.scale < 1 && (this.failT <= 0 || next < this.failAt - 0.001)) {
        this.scale = next;
        this.upWait = 3; this.cool = 0.5;
        return this.scale;
      }
    } else this.upWait = Math.max(this.upWait, 1.5);
    return null;
  }

  atFloor() { return this.scale <= MIN_SCALE + 0.001; }
  atTop() { return this.scale >= 0.999; }
  reset(scale = 1) { this.scale = scale; this.t = 0; this.n = 0; this.cool = 1; this.upWait = 3; this.failAt = 2; this.failT = 0; }
}
