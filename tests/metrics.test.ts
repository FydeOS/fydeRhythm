import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMetrics, kMetrics } from '../entrypoints/inputview/metrics';

const css = readFileSync(join(__dirname, '..', 'entrypoints', 'inputview', 'md3.css'), 'utf8');

// applyMetrics talks to a DOM element; capture what it publishes.
function published(): Map<string, string> {
  const out = new Map<string, string>();
  const fake = { style: { setProperty: (k: string, v: string) => out.set(k, v) } };
  applyMetrics(fake as unknown as HTMLElement);
  return out;
}

describe('metrics', () => {
  // The bug this guards: geometryFor() computes the OS window from these
  // numbers and the browser lays the card out from md3.css. Written twice,
  // they drift, and the card no longer fits the window it lives in.
  it('publishes every geometry variable the stylesheet consumes', () => {
    for (const name of published().keys()) {
      expect(css, `${name} is published but never used`).toContain(`var(${name}`);
    }
  });

  it('leaves no geometry number written a second time in the stylesheet', () => {
    for (const name of published().keys()) {
      // A literal like `--kb-edge: 5px` would be a second source of truth.
      // Referencing another published var (`--kb-edge: var(--kb-onehand-edge)`)
      // is how a per-placement override is meant to be spelled.
      const literal = new RegExp(`${name}:\\s*[0-9.]+px`);
      expect(css, `${name} is declared with a literal in md3.css`).not.toMatch(literal);
    }
  });

  it('keeps the keys hittable and the bars able to hold their controls', () => {
    // The bar's icon buttons are the bar minus 4px, and the floating card's
    // height floor is derived from minKeyHeight — these are the assumptions
    // the rest of the geometry rests on.
    expect(kMetrics.barMin - 4).toBeGreaterThanOrEqual(kMetrics.minKeyHeight - 2);
    expect(kMetrics.onehand.bar).toBeGreaterThanOrEqual(kMetrics.barMin);
    expect(kMetrics.resizeWidth).toBeLessThan(kMetrics.barMin * 2);
    expect(kMetrics.handleHeight).toBeGreaterThan(kMetrics.onehand.cellPad * 2);
  });
});
