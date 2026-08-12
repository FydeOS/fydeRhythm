// When a dictation session stops on its own.
//
// Three triggers, deliberately independent: prolonged silence ends the normal
// case, a hard ceiling catches silence detection failing (a noisy room keeps
// every batch above the threshold), and the caller stops the session outright
// when the keyboard is dismissed. Volcano's own idle timeout protects Volcano's
// resources, not the bill, so none of this may be delegated to the server.
//
// Silence is judged against a tracked noise floor (minimum statistics), not an
// absolute level: any fixed constant is wrong for some microphone, and the
// first device reports showed exactly that — a quiet talker read as silence.

/** Silence long enough to read as "finished speaking". */
export const kSilenceStopMs = 4500;
/** Ceiling on one session, regardless of what the microphone is hearing. */
export const kMaxSessionMs = 60000;

/** Speech must clear the noise floor by this amplitude ratio. ×3 ≈ +9.5 dB,
 *  the top of the conventional 6–10 dB energy-VAD margin. */
export const kSilenceMargin = 3;
/** The threshold never sinks below this: in a dead-quiet room breath and
 *  keyboard rustle must not count as speech. */
export const kSilenceRmsMin = 0.005;
/** Where the floor starts: the quiet-room level measured on device (V5). */
export const kFloorSeedRms = 0.0035;
/** The floor never drops below this — digital near-silence would otherwise
 *  collapse the margin to nothing. */
export const kFloorMinRms = 0.0005;
/** How fast the floor drifts up toward a louder ambient, per second — and only
 *  during batches already read as silent: rising during speech would pull the
 *  threshold over a quiet talker's voice and cut them off mid-sentence. */
export const kFloorRisePerSecond = 1.1;

export interface CapturePolicy {
  silenceStopMs: number;
  maxSessionMs: number;
  /** Threshold = max(noiseFloor × silenceMargin, silenceRmsMin). */
  silenceMargin: number;
  silenceRmsMin: number;
  floorMinRms: number;
  floorRisePerSecond: number;
}

export const kDefaultPolicy: CapturePolicy = {
  silenceStopMs: kSilenceStopMs,
  maxSessionMs: kMaxSessionMs,
  silenceMargin: kSilenceMargin,
  silenceRmsMin: kSilenceRmsMin,
  floorMinRms: kFloorMinRms,
  floorRisePerSecond: kFloorRisePerSecond,
};

export interface CaptureProgress {
  /** Audio seen so far, from the batches themselves rather than a clock: a
   *  throttled page delivers fewer batches, and the session should be bounded
   *  by how much audio was actually captured, not by wall time. */
  elapsedMs: number;
  /** Length of the current unbroken run of silent batches. */
  silentMs: number;
  /** Estimated ambient level of this session's room. */
  noiseFloor: number;
}

export const kInitialProgress: CaptureProgress = {
  elapsedMs: 0,
  silentMs: 0,
  noiseFloor: kFloorSeedRms,
};

/** Why a session ended by itself. `null` means it continues. */
export type CaptureStop = 'silence' | 'timeout' | null;

export interface CaptureBatch {
  rms: number;
  durationMs: number;
}

/** Folds one PCM batch into the session's progress and reports whether it ends.
 *
 *  Silence is only a stop once the run reaches the threshold, so a speaker
 *  pausing for breath does not end the session; any batch above the threshold
 *  resets the run to zero. */
export function advance(
  progress: CaptureProgress,
  batch: CaptureBatch,
  policy: CapturePolicy = kDefaultPolicy,
): { progress: CaptureProgress; stop: CaptureStop } {
  const elapsedMs = progress.elapsedMs + batch.durationMs;
  const threshold = Math.max(progress.noiseFloor * policy.silenceMargin, policy.silenceRmsMin);
  const silent = batch.rms <= threshold;
  const silentMs = silent ? progress.silentMs + batch.durationMs : 0;

  // Minimum statistics: adopt a quieter level immediately, drift up toward a
  // louder ambient only while already silent, hold during speech.
  const noiseFloor = batch.rms < progress.noiseFloor
    ? Math.max(policy.floorMinRms, batch.rms)
    : silent
      ? Math.min(batch.rms, progress.noiseFloor * policy.floorRisePerSecond ** (batch.durationMs / 1000))
      : progress.noiseFloor;

  const next = { elapsedMs, silentMs, noiseFloor };

  // Timeout wins over silence: at the ceiling the session ends regardless, and
  // reporting 'silence' there would misattribute why.
  if (elapsedMs >= policy.maxSessionMs) return { progress: next, stop: 'timeout' };
  if (silentMs >= policy.silenceStopMs) return { progress: next, stop: 'silence' };
  return { progress: next, stop: null };
}
