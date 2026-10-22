import { clamp, rand } from '../engine/utils.js';

// "Coach Mode": remembers how good the player is and builds lobbies to match.
// rating 0..1 — 0.45 is a decent new player, 0.8+ is a sweaty champion.
export class Director {
  constructor(save) { this.save = save; }

  get rating() { return this.save.data.skill ?? 0.45; }

  botSkills(n, difficulty = 'coach') {
    const fixed = { easy: 0.08, normal: 0.35, hard: 0.7, insane: 0.92 }[difficulty];
    const base = fixed ?? this.rating;
    // newer players get more easy bots to beat; strong players get a sweatier lobby. Easy has no All-Stars at all.
    const rookies = difficulty === 'easy' ? 0.7 : difficulty === 'normal' ? 0.45 : fixed != null ? 0.35 : clamp(0.55 - base * 0.35, 0.25, 0.5);
    const stars = difficulty === 'easy' ? 0 : difficulty === 'normal' ? 0.1 : fixed != null ? 0.2 : clamp(0.08 + base * 0.2, 0.1, 0.28);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      // a mix: rookies below you, most around your level, a few all-stars above you
      const s = r < rookies ? base - rand(0.15, 0.35) : r < 1 - stars ? base + rand(-0.08, 0.08) : base + rand(0.12, 0.3);
      out.push(clamp(s, 0.05, 1));
    }
    return out;
  }

  // how hard bots hit the player: gentler on easy/normal, full strength on hard/insane
  damageMul(difficulty = 'coach') {
    return { easy: 0.5, normal: 0.75, hard: 1, insane: 1 }[difficulty] ?? clamp(0.6 + this.rating * 0.5, 0.65, 1);
  }

  // update rating after a match
  record(match) {
    const d = this.save.data;
    const n = match.opts.bots + 1;
    const place = match.placement / n; // 0 = won, 1 = first out
    let delta = 0;
    if (match.won) delta += 0.06;
    else if (place < 0.15) delta += 0.025;
    else if (place > 0.6) delta -= 0.035;
    delta += Math.min(0.04, match.stats.kills * 0.008);
    // three rough games in a row: ease off faster so it stays fun
    const recent = (d.history || []).slice(-2);
    if (place > 0.6 && recent.length === 2 && recent.every((h) => !h.won && h.kills === 0)) delta -= 0.03;
    d.skill = clamp((d.skill ?? 0.45) + delta, 0.05, 1);
    d.history = [...(d.history || []), { place: match.placement, kills: match.stats.kills, won: !!match.won, t: Date.now() }].slice(-30);
    this.save.write();
    return delta;
  }
}
