import { describe, expect, it } from 'vitest';

import {
  formatElapsed,
  kMeterCeilingDb,
  kMeterFloorDb,
  meterBars,
  meterLevel,
  pushLevel,
} from '../entrypoints/inputview/voice/panel-model';

describe('voice session timer', () => {
  it('formats mm:ss with a padded seconds field', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(12_400)).toBe('0:12');
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(125_000)).toBe('2:05');
  });

  it('floors rather than rounds, so the timer never shows time not yet elapsed', () => {
    expect(formatElapsed(1_999)).toBe('0:01');
  });

  it('never shows a negative time', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('voice level meter', () => {
  it('reads as empty at the silence the device actually measured', () => {
    // 0.0035 RMS was the probe's quiet-room reading with nobody speaking.
    expect(meterLevel(0.0035)).toBeLessThan(0.05);
  });

  it('gives speech most of the meter', () => {
    // Conversational speech sits around 0.05–0.3 RMS.
    expect(meterLevel(0.05)).toBeGreaterThan(0.4);
    expect(meterLevel(0.3)).toBeGreaterThan(0.85);
  });

  it('separates speech from silence by most of the range', () => {
    // The point of the dB curve: linear RMS would put these within 0.3 of
    // each other at the bottom of the bar.
    expect(meterLevel(0.1) - meterLevel(0.0035)).toBeGreaterThan(0.5);
  });

  it('clamps to 0..1 outside the calibrated range', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(-1)).toBe(0);
    expect(meterLevel(Number.NaN)).toBe(0);
    expect(meterLevel(10)).toBe(1);
  });

  it('anchors exactly at the floor and the ceiling', () => {
    expect(meterLevel(10 ** (kMeterFloorDb / 20))).toBeCloseTo(0, 5);
    expect(meterLevel(10 ** (kMeterCeilingDb / 20))).toBeCloseTo(1, 5);
  });

  it('rises monotonically', () => {
    const samples = [0.001, 0.01, 0.05, 0.1, 0.5];
    const levels = samples.map(meterLevel);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe('voice level history', () => {
  it('puts the newest sample at the right end', () => {
    const bars = meterBars([0.0035, 0.0035, 0.3], 3);
    expect(bars[2]).toBeGreaterThan(bars[0]);
  });

  it('pads a short history on the left instead of stretching it', () => {
    const bars = meterBars([0.3], 4);
    expect(bars.slice(0, 3)).toEqual([0, 0, 0]);
    expect(bars[3]).toBeGreaterThan(0.85);
  });

  it('shows only the most recent samples when the history is longer', () => {
    const history = [0.3, 0.3, 0.0035, 0.0035];
    expect(meterBars(history, 2)).toEqual([meterLevel(0.0035), meterLevel(0.0035)]);
  });

  it('caps the history it keeps', () => {
    let history: number[] = [];
    for (let i = 0; i < 50; i++) history = pushLevel(history, i / 50, 16);
    expect(history).toHaveLength(16);
    expect(history[15]).toBeCloseTo(49 / 50, 5);
  });
});
