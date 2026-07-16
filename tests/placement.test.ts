import { describe, expect, it } from 'vitest';
import { dockedHeight, geometryFor, kDefaultPlacement, normalizePlacement, type Placement } from '../entrypoints/inputview/placement';

// A typical FydeOS tablet in landscape.
const screen = { width: 1280, height: 800 };

const placement = (over: Partial<Placement> = {}): Placement => ({ ...kDefaultPlacement, ...over });

describe('normalizePlacement', () => {
    it('defaults a missing or malformed value to docked', () => {
        expect(normalizePlacement(null)).toEqual(kDefaultPlacement);
        expect(normalizePlacement(undefined)).toEqual(kDefaultPlacement);
        expect(normalizePlacement('nonsense')).toEqual(kDefaultPlacement);
        expect(normalizePlacement(42)).toEqual(kDefaultPlacement);
    });

    it('migrates the legacy bare-boolean value to the default scale', () => {
        // An older build stored just `true` under the key.
        expect(normalizePlacement(true)).toMatchObject({ mode: 'floating', scale: 0.6 });
        expect(normalizePlacement(false)).toMatchObject({ mode: 'docked' });
    });

    it('migrates the pre-one-hand { floating } shape to a mode', () => {
        expect(normalizePlacement({ floating: true, scale: 0.55, left: 12, top: 34 }))
            .toEqual({ mode: 'floating', scale: 0.55, side: 'right', left: 12, top: 34 });
        expect(normalizePlacement({ floating: false, scale: 0.55 })).toMatchObject({ mode: 'docked' });
    });

    it('passes a valid mode and side through, rejecting unknown ones', () => {
        expect(normalizePlacement({ mode: 'onehand', side: 'left' }))
            .toMatchObject({ mode: 'onehand', side: 'left' });
        expect(normalizePlacement({ mode: 'sideways' })).toMatchObject({ mode: 'docked' });
        expect(normalizePlacement({ mode: 'onehand', side: 'up' })).toMatchObject({ side: 'right' });
    });

    it('clamps the scale into the grip range and falls back when unusable', () => {
        expect(normalizePlacement({ mode: 'floating', scale: 5 })).toMatchObject({ scale: 0.85 });
        // Below the floor the 5-row layouts (zhuyin/kana) lose their keys, so a
        // stored 0.4 from the old range is pulled up rather than honoured.
        expect(normalizePlacement({ mode: 'floating', scale: 0.1 })).toMatchObject({ scale: 0.55 });
        expect(normalizePlacement({ mode: 'floating', scale: 0.4 })).toMatchObject({ scale: 0.55 });
        expect(normalizePlacement({ mode: 'floating' })).toMatchObject({ scale: 0.6 });
        expect(normalizePlacement({ mode: 'floating', scale: NaN })).toMatchObject({ scale: 0.6 });
    });

    it('preserves a valid dragged position and drops a malformed one', () => {
        // Non-finite coords are dropped (→ undefined = centre on next float).
        const cleaned = normalizePlacement({ mode: 'floating', left: NaN, top: 'x' });
        expect(cleaned.left).toBeUndefined();
        expect(cleaned.top).toBeUndefined();
    });
});

describe('geometryFor', () => {
    it('spans the screen when docked', () => {
        expect(geometryFor(placement(), screen))
            .toEqual({ floating: false, draggable: false, width: 1280, height: 372 });
    });

    it('guards the docked height at the screen-shape extremes', () => {
        // Every shipping screen resolves exactly as before the guards…
        expect(dockedHeight({ width: 1366, height: 768 })).toBe(372);
        expect(dockedHeight({ width: 1280, height: 800 })).toBe(372);
        expect(dockedHeight({ width: 1080, height: 720 })).toBe(372);
        expect(dockedHeight({ width: 2560, height: 1600 })).toBe(440);
        // …a short landscape window keeps ≥48% of itself…
        expect(dockedHeight({ width: 1024, height: 500 })).toBe(260);
        // …portrait follows the width instead of the height…
        expect(dockedHeight({ width: 800, height: 1280 })).toBe(336);
        // …and a portrait phone lands on the 280 floor.
        expect(dockedHeight({ width: 412, height: 915 })).toBe(280);
    });

    it('floors the floating width on phone screens, keeping the docked aspect', () => {
        const phone = { width: 412, height: 915 };
        const g = geometryFor(placement({ mode: 'floating', scale: 0.55 }), phone, 4);
        // 0.55 × 412 would be a 227px keyboard; the effective scale rises to
        // keep the board at the shared 320px width floor.
        expect(g.width).toBe(320);
        expect(g.height).toBeGreaterThanOrEqual(217);
        // Wide screens are untouched by the floor.
        expect(geometryFor(placement({ mode: 'floating', scale: 0.55 }), screen, 4).width).toBe(704);
    });

    it('scales the docked keyboard when floating', () => {
        const float = geometryFor(placement({ mode: 'floating', scale: 0.85, left: 40, top: 300 }), screen);
        expect(float).toMatchObject({ floating: true, draggable: true, width: 1088, height: 316, left: 40, top: 300 });
    });

    // The handle and the candidate bar hold real controls and have floors, so
    // they do NOT shrink with the card. Scale the card far enough and they eat
    // it: the rows are what is left over, and a 5-row layout came out at 21px
    // per key. The card refuses to go below the height its rows need.
    it('floors the floating card at the height its rows need', () => {
        const rowsOf = (g: { height: number }, rows: number) => (g.height - 22 - 34 - 5) / rows;
        for (const rows of [4, 5]) {
            const min = geometryFor(placement({ mode: 'floating', scale: 0.55 }), screen, rows);
            // Uniform scaling would have given 205px; the floor overrides it.
            expect(min.height).toBeGreaterThan(Math.round(372 * 0.55));
            const keyHeight = rowsOf(min, rows) - 7; // less the cell padding
            expect(keyHeight).toBeGreaterThanOrEqual(32);
        }
        // A 5-row layout needs the taller card.
        expect(geometryFor(placement({ mode: 'floating', scale: 0.55 }), screen, 5).height)
            .toBeGreaterThan(geometryFor(placement({ mode: 'floating', scale: 0.55 }), screen, 4).height);
        // Above the floor the scale is honoured as-is.
        expect(geometryFor(placement({ mode: 'floating', scale: 0.85 }), screen, 4).height).toBe(316);
    });

    describe('one-hand', () => {
        const geom = (side: 'left' | 'right' = 'right') => geometryFor(placement({ mode: 'onehand', side }), screen);

        it('pins the card to the chosen bottom corner and never drags', () => {
            const right = geom('right');
            const left = geom('left');
            expect(right.draggable).toBe(false);
            expect(right.left).toBe(screen.width - right.width - 8);
            expect(left.left).toBe(8);
            // Bottom-anchored: the thumb arc pivots at the gripping hand.
            expect(right.top).toBe(screen.height - right.height - 8);
            expect(left).toMatchObject({ width: right.width, height: right.height, top: right.top });
        });

        it('reflows to phone proportions instead of shrinking the docked card', () => {
            const { width, height } = geom();
            // Narrow enough for a thumb to sweep across, and far narrower than
            // the smallest floating keyboard (0.4 × 1280 = 512).
            expect(width).toBe(420);
            expect(height).toBe(310);
            // Keys taller than wide, at phone metrics: the frame is 10 key
            // columns across, and a row is ~1.4× that pitch. Mirrors the CSS in
            // md3.css (--kb-edge, --kb-bar-height, .kb-onehand-bar).
            const pitch = (width - 2 * 4) / 10;
            const rowHeight = (height - 34 - 36 - 2 * 4) / 4;
            expect(pitch).toBeCloseTo(41.2, 1);
            expect(rowHeight).toBe(58);
            expect(rowHeight).toBeGreaterThan(pitch);
        });

        it('grows a row for the 5-row layouts instead of shrinking their keys', () => {
            // zhuyin/kana are 5 rows. Dividing the 4-row card among 5 rows would
            // drop the keys to ~35px; the card takes the extra row instead, so a
            // key is the same height in every layout.
            const four = geometryFor(placement({ mode: 'onehand' }), screen, 4);
            const five = geometryFor(placement({ mode: 'onehand' }), screen, 5);
            const rowHeight = (g: { height: number }, rows: number) => (g.height - 34 - 36 - 2 * 4) / rows;
            expect(five.height).toBe(368);
            expect(five.height - four.height).toBe(58);
            expect(rowHeight(five, 5)).toBe(rowHeight(four, 4));
            expect(five.width).toBe(four.width);
            // Still corner-pinned, just taller — so it rides up from the bottom.
            expect(five.top).toBe(screen.height - five.height - 8);
        });

        it('holds the card in its width band on very wide and very narrow screens', () => {
            const wide = geometryFor(placement({ mode: 'onehand' }), { width: 2560, height: 1600 });
            const narrow = geometryFor(placement({ mode: 'onehand' }), { width: 800, height: 1280 });
            expect(wide.width).toBe(420);
            expect(narrow.width).toBe(320);
            // Still on-screen, still corner-pinned.
            expect(narrow.left).toBe(800 - 320 - 8);
            expect(narrow.top).toBeGreaterThan(0);
        });
    });
});
