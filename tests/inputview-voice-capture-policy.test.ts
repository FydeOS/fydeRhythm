import { describe, expect, it } from 'vitest';

import {
  advance,
  type CaptureBatch,
  type CapturePolicy,
  type CaptureProgress,
  type CaptureStop,
  kDefaultPolicy,
  kInitialProgress,
} from '../entrypoints/inputview/voice/capture-policy';

const kBatchMs = 100; // one worklet batch: 1600 samples at 16 kHz

function batch(rms: number): CaptureBatch {
  return { rms, durationMs: kBatchMs };
}

/** Feeds a run of batches and reports where (and why) it stopped. */
function run(
  rmsValues: readonly number[],
  policy: CapturePolicy = kDefaultPolicy,
): { stop: CaptureStop; afterBatches: number; progress: CaptureProgress } {
  let progress = kInitialProgress;
  for (const [index, rms] of rmsValues.entries()) {
    const result = advance(progress, batch(rms), policy);
    progress = result.progress;
    if (result.stop) return { stop: result.stop, afterBatches: index + 1, progress };
  }
  return { stop: null, afterBatches: rmsValues.length, progress };
}

const loud = 0.3;
const quiet = 0.001;

describe('voice capture policy', () => {
  it('keeps running while there is speech', () => {
    expect(run(Array.from({ length: 100 }, () => loud)).stop).toBeNull();
  });

  it('stops after an unbroken silent run reaches the threshold', () => {
    // 30 silent batches = 3000 ms.
    const result = run([loud, ...Array.from({ length: 30 }, () => quiet)]);
    expect(result.stop).toBe('silence');
    expect(result.afterBatches).toBe(31);
  });

  it('does not stop on a pause shorter than the threshold', () => {
    // Breath-length pauses either side of speech, none of them long enough.
    const pause = Array.from({ length: 20 }, () => quiet);
    expect(run([loud, ...pause, loud, ...pause, loud]).stop).toBeNull();
  });

  it('resets the silent run when speech resumes', () => {
    const almost = Array.from({ length: 29 }, () => quiet);
    const result = run([...almost, loud, ...almost]);
    expect(result.stop).toBeNull();
    expect(result.progress.silentMs).toBe(2900);
  });

  it('treats a batch exactly at the threshold as silence', () => {
    const result = run(Array.from({ length: 30 }, () => kDefaultPolicy.silenceRms));
    expect(result.stop).toBe('silence');
  });

  it('stops at the ceiling even when the room never goes quiet', () => {
    // 600 loud batches = 60000 ms. Silence detection would never fire here.
    const result = run(Array.from({ length: 700 }, () => loud));
    expect(result.stop).toBe('timeout');
    expect(result.afterBatches).toBe(600);
    expect(result.progress.elapsedMs).toBe(kDefaultPolicy.maxSessionMs);
  });

  it('reports timeout rather than silence when both land on the same batch', () => {
    // Ceiling reached by a run of silence that also completes on that batch.
    const policy: CapturePolicy = { silenceStopMs: 300, maxSessionMs: 300, silenceRms: 0.02 };
    expect(run([quiet, quiet, quiet], policy).stop).toBe('timeout');
  });

  it('accumulates elapsed time from the batches, not a clock', () => {
    let progress = kInitialProgress;
    for (let i = 0; i < 5; i++) progress = advance(progress, batch(loud)).progress;
    expect(progress.elapsedMs).toBe(500);
    expect(progress.silentMs).toBe(0);
  });

  it('honours a custom policy', () => {
    const policy: CapturePolicy = { silenceStopMs: 500, maxSessionMs: 10000, silenceRms: 0.5 };
    // 0.3 counts as silence under this threshold, though it is speech by default.
    expect(run(Array.from({ length: 5 }, () => loud), policy).stop).toBe('silence');
  });
});
