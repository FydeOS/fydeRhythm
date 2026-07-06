import { describe, expect, it } from 'vitest';
import { KeyPress, kDefaultPressTiming } from '../entrypoints/inputview/gestures/press';

function machine(overrides: Partial<{ hasAlts: boolean; repeat: boolean }> = {}) {
    return new KeyPress({
        hasAlts: false,
        repeat: false,
        ...kDefaultPressTiming,
        ...overrides,
    });
}

describe('KeyPress', () => {
    it('plain tap activates on release', () => {
        const m = machine();
        expect(m.down()).toEqual({ effects: [], timerMs: null });
        expect(m.up()).toEqual({ effects: ['activate', 'release'], timerMs: null });
    });

    it('key with alts schedules the long-press timer', () => {
        const m = machine({ hasAlts: true });
        expect(m.down().timerMs).toBe(kDefaultPressTiming.longPressMs);
    });

    it('quick release on an alts key still activates (timer never fires)', () => {
        const m = machine({ hasAlts: true });
        m.down();
        expect(m.up().effects).toContain('activate');
    });

    it('long-press opens the bubble and the release does not activate', () => {
        const m = machine({ hasAlts: true });
        m.down();
        expect(m.timer()).toEqual({ effects: ['openBubble'], timerMs: null });
        expect(m.isBubbling).toBe(true);
        expect(m.up().effects).toEqual(['release']);
    });

    it('repeat key activates immediately on down and on every tick', () => {
        const m = machine({ repeat: true });
        expect(m.down()).toEqual({ effects: ['activate'], timerMs: kDefaultPressTiming.repeatInitialMs });
        expect(m.timer()).toEqual({ effects: ['activate'], timerMs: kDefaultPressTiming.repeatIntervalMs });
        expect(m.timer()).toEqual({ effects: ['activate'], timerMs: kDefaultPressTiming.repeatIntervalMs });
        // Release fires no extra activation.
        expect(m.up().effects).toEqual(['release']);
    });

    it('cancel releases without activating', () => {
        const m = machine();
        m.down();
        expect(m.cancel().effects).toEqual(['release']);
        expect(m.up().effects).toEqual([]);
    });
});
