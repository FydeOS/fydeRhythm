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
    // 45 silent batches = 4500 ms.
    const result = run([loud, ...Array.from({ length: 45 }, () => quiet)]);
    expect(result.stop).toBe('silence');
    expect(result.afterBatches).toBe(46);
  });

  it('does not stop on a thinking pause of four seconds', () => {
    const pause = Array.from({ length: 40 }, () => quiet);
    expect(run([loud, ...pause, loud, ...pause, loud]).stop).toBeNull();
  });

  it('resets the silent run when speech resumes', () => {
    const almost = Array.from({ length: 44 }, () => quiet);
    const result = run([...almost, loud, ...almost]);
    expect(result.stop).toBeNull();
    expect(result.progress.silentMs).toBe(4400);
  });

  it('treats a batch exactly at the threshold as silence', () => {
    const threshold = kInitialProgress.noiseFloor * kDefaultPolicy.silenceMargin;
    const result = run(Array.from({ length: 45 }, () => threshold));
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
    const policy: CapturePolicy = { ...kDefaultPolicy, silenceStopMs: 300, maxSessionMs: 300 };
    expect(run([quiet, quiet, quiet], policy).stop).toBe('timeout');
  });

  it('accumulates elapsed time from the batches, not a clock', () => {
    let progress = kInitialProgress;
    for (let i = 0; i < 5; i++) progress = advance(progress, batch(loud)).progress;
    expect(progress.elapsedMs).toBe(500);
    expect(progress.silentMs).toBe(0);
  });

  it('honours a custom policy', () => {
    const policy: CapturePolicy = { ...kDefaultPolicy, silenceStopMs: 500, silenceRmsMin: 0.5 };
    // 0.3 counts as silence under this floor, though it is speech by default.
    expect(run(Array.from({ length: 5 }, () => loud), policy).stop).toBe('silence');
  });
});

describe('the adaptive noise floor', () => {
  const quietTalker = 0.012; // silent under the old fixed 0.02 threshold

  it('keeps hearing a quiet talker for a whole session', () => {
    // The floor must hold during speech: if it drifted up it would eventually
    // pull the threshold over this voice and cut the session mid-sentence.
    const result = run(Array.from({ length: 400 }, () => quietTalker));
    expect(result.stop).toBeNull();
    expect(result.progress.noiseFloor).toBe(kInitialProgress.noiseFloor);
  });

  it('still ends the session when a quiet talker stops talking', () => {
    const result = run([...Array.from({ length: 20 }, () => quietTalker), ...Array.from({ length: 45 }, () => quiet)]);
    expect(result.stop).toBe('silence');
  });

  it('adopts a quieter room instantly, bounded below', () => {
    let progress = kInitialProgress;
    progress = advance(progress, batch(0.0008)).progress;
    expect(progress.noiseFloor).toBe(0.0008);
    progress = advance(progress, batch(0.0001)).progress;
    expect(progress.noiseFloor).toBe(kDefaultPolicy.floorMinRms);
  });

  it('drifts up toward a louder ambient only while silent', () => {
    // A hum above the seed but below the threshold is ambient, not speech.
    let progress = kInitialProgress;
    for (let i = 0; i < 20; i++) progress = advance(progress, batch(0.008)).progress;
    expect(progress.noiseFloor).toBeGreaterThan(kInitialProgress.noiseFloor);
    expect(progress.noiseFloor).toBeLessThanOrEqual(0.008);
  });

  it('never lets the threshold sink below the absolute minimum', () => {
    // Floor at its lower bound: 0.004 is under the minimum threshold and must
    // still read as silence rather than speech.
    let progress = { ...kInitialProgress, noiseFloor: kDefaultPolicy.floorMinRms };
    progress = advance(progress, batch(0.004)).progress;
    expect(progress.silentMs).toBe(100);
  });
});
