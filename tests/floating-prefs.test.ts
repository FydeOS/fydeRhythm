import { describe, expect, it } from 'vitest';
import { normalizeFloatingPrefs, kDefaultFloatingPrefs } from '../entrypoints/inputview/chrome-shim';

describe('normalizeFloatingPrefs', () => {
    it('defaults a missing or malformed value to docked, scale 1', () => {
        expect(normalizeFloatingPrefs(null)).toEqual(kDefaultFloatingPrefs);
        expect(normalizeFloatingPrefs(undefined)).toEqual(kDefaultFloatingPrefs);
        expect(normalizeFloatingPrefs('nonsense')).toEqual(kDefaultFloatingPrefs);
        expect(normalizeFloatingPrefs(42)).toEqual(kDefaultFloatingPrefs);
    });

    it('migrates the legacy bare-boolean value to the default scale', () => {
        // An older build stored just `true` under the key.
        expect(normalizeFloatingPrefs(true)).toEqual({ floating: true, scale: 0.6 });
        expect(normalizeFloatingPrefs(false)).toEqual({ floating: false, scale: 0.6 });
    });

    it('clamps the scale into the grip range and passes valid prefs through', () => {
        expect(normalizeFloatingPrefs({ floating: true, scale: 0.55 })).toEqual({ floating: true, scale: 0.55 });
        expect(normalizeFloatingPrefs({ floating: true, scale: 5 })).toEqual({ floating: true, scale: 0.85 });
        expect(normalizeFloatingPrefs({ floating: true, scale: 0.1 })).toEqual({ floating: true, scale: 0.4 });
    });

    it('falls back to the default scale when scale is absent or not finite', () => {
        expect(normalizeFloatingPrefs({ floating: true })).toEqual({ floating: true, scale: 0.6 });
        expect(normalizeFloatingPrefs({ floating: false, scale: NaN })).toEqual({ floating: false, scale: 0.6 });
    });

    it('preserves a valid dragged position and drops a malformed one', () => {
        expect(normalizeFloatingPrefs({ floating: true, scale: 0.6, left: 120, top: 340 }))
            .toEqual({ floating: true, scale: 0.6, left: 120, top: 340 });
        // Non-finite coords are dropped (→ undefined = centre on next float).
        const cleaned = normalizeFloatingPrefs({ floating: true, scale: 0.6, left: NaN, top: 'x' });
        expect(cleaned.left).toBeUndefined();
        expect(cleaned.top).toBeUndefined();
    });
});
