// When a dictation session stops on its own.
//
// Three triggers, deliberately independent: prolonged silence ends the normal
// case, a hard ceiling catches silence detection failing (a noisy room keeps
// every batch above the threshold), and the caller stops the session outright
// when the keyboard is dismissed. Volcano's own idle timeout protects Volcano's
// resources, not the bill, so none of this may be delegated to the server.

/** Silence long enough to read as "finished speaking". */
export const kSilenceStopMs = 3000;
/** Ceiling on one session, regardless of what the microphone is hearing. */
export const kMaxSessionMs = 60000;
/** Batch RMS at or below this counts as silence.
 *
 *  Provisional. The device probe measured 0.0035 in a quiet room with nobody
 *  speaking, so this sits well above the noise floor of that one machine — it
 *  has NOT been calibrated against a noisy room or a quiet talker. */
export const kSilenceRms = 0.02;

export interface CapturePolicy {
  silenceStopMs: number;
  maxSessionMs: number;
  silenceRms: number;
}

export const kDefaultPolicy: CapturePolicy = {
  silenceStopMs: kSilenceStopMs,
  maxSessionMs: kMaxSessionMs,
  silenceRms: kSilenceRms,
};

export interface CaptureProgress {
  /** Audio seen so far, from the batches themselves rather than a clock: a
   *  throttled page delivers fewer batches, and the session should be bounded
   *  by how much audio was actually captured, not by wall time. */
  elapsedMs: number;
  /** Length of the current unbroken run of silent batches. */
  silentMs: number;
}

export const kInitialProgress: CaptureProgress = { elapsedMs: 0, silentMs: 0 };

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
  const silentMs = batch.rms <= policy.silenceRms
    ? progress.silentMs + batch.durationMs
    : 0;

  const next = { elapsedMs, silentMs };

  // Timeout wins over silence: at the ceiling the session ends regardless, and
  // reporting 'silence' there would misattribute why.
  if (elapsedMs >= policy.maxSessionMs) return { progress: next, stop: 'timeout' };
  if (silentMs >= policy.silenceStopMs) return { progress: next, stop: 'silence' };
  return { progress: next, stop: null };
}
