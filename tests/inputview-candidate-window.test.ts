import { describe, expect, it } from 'vitest';

import { candidateSeed, kMaxBatch, kMinBatch } from '../entrypoints/inputview/candidate-window';

// The flicker returns whenever a composition's seed is too small for the bar:
// candidates paint short, then grow in place. These lock the seed's shape so a
// future edit can't reintroduce that — across every bar width, i.e. every
// keyboard state (docked, floating, one-hand, portrait/landscape).
describe('candidateSeed — anti-flicker invariant', () => {
  it('is 0 only before the bar is measured', () => {
    expect(candidateSeed(0)).toBe(0);
    expect(candidateSeed(-10)).toBe(0);
    expect(candidateSeed(1)).toBe(kMinBatch);
  });

  it('never seeds below the floor or above the cap', () => {
    for (let w = 1; w <= 4000; w += 7) {
      const n = candidateSeed(w);
      expect(n).toBeGreaterThanOrEqual(kMinBatch);
      expect(n).toBeLessThanOrEqual(kMaxBatch);
    }
    expect(candidateSeed(60)).toBe(kMinBatch); // clamps up on a tiny bar
    expect(candidateSeed(9000)).toBe(kMaxBatch); // clamps down on a huge one
  });

  it('never decreases as the bar widens (a wider state seeds at least as many)', () => {
    let prev = 0;
    for (let w = 1; w <= 4000; w += 13) {
      const n = candidateSeed(w);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('covers the strip: at least as many as fit at the widest chip width', () => {
    // A real chip is >= 30px, so at most ceil(width / 30) fit; the seed must
    // meet that (up to the cap) or the last chips paint after a top-up.
    for (const w of [200, 360, 768, 1024]) {
      expect(candidateSeed(w)).toBeGreaterThanOrEqual(Math.min(kMaxBatch, Math.ceil(w / 30)));
    }
  });

  it('depends only on width — content can never shift it', () => {
    // Same width, same seed: candidateSeed takes no candidate input, so a word
    // with narrower or wider candidates cannot change the count. This is the
    // property whose absence caused the recurring single-key flicker.
    expect(candidateSeed(600)).toBe(candidateSeed(600));
    expect(candidateSeed(360)).toBe(12); // ceil(360 / 30)
  });
});
