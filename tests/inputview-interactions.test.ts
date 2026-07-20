import { describe, expect, it } from 'vitest';

import { fitMenuToViewport } from '../entrypoints/inputview/popover-geometry';
import { tapShift, typeWithShift } from '../entrypoints/inputview/shift-state';

describe('schema menu viewport fitting', () => {
  it('pins an oversized menu inside the viewport with a scrollable height', () => {
    expect(fitMenuToViewport({ top: 350, bottom: 390 }, 900, 400)).toEqual({
      top: 4,
      maxHeight: 392,
    });
  });

  it('still places a short menu above its bottom-row anchor', () => {
    expect(fitMenuToViewport({ top: 350, bottom: 390 }, 100, 400)).toEqual({
      top: 242,
      maxHeight: 392,
    });
  });
});

describe('Shift double-tap interaction', () => {
  it('typing breaks the double-tap sequence before the next Shift tap', () => {
    const firstTap = tapShift({ mode: 'off', lastTap: 0 }, 1_000);
    expect(firstTap.mode).toBe('shift');

    const typed = typeWithShift(firstTap);
    expect(typed).toEqual({ mode: 'off', lastTap: 0 });

    expect(tapShift(typed, 1_200).mode).toBe('shift');
  });

  it('still enables Caps Lock for two uninterrupted taps', () => {
    const firstTap = tapShift({ mode: 'off', lastTap: 0 }, 1_000);
    expect(tapShift(firstTap, 1_200).mode).toBe('caps');
  });
});
