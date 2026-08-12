// The parts of the voice panel worth reasoning about away from the DOM.

/** mm:ss for the session timer.
 *
 *  The timer is not decoration: `prefers-reduced-motion` kills every animation
 *  in this stylesheet with `!important`, so the pulsing dot disappears for
 *  anyone who set it. A running number is a text change, not an animation, so
 *  it survives — and it is one of the two signals (with the explicit label)
 *  that still say "recording" in that mode. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Floor of the meter, in dBFS. Below this the bar reads as empty.
 *
 *  The device probe measured RMS 0.0035 in a quiet room with nobody speaking,
 *  which is −49 dBFS — so the floor sits just under it and ordinary room noise
 *  does not light the meter up. */
export const kMeterFloorDb = -50;
/** Above this the meter is full; normal speech peaks well below 0 dBFS. */
export const kMeterCeilingDb = -6;

/** Maps batch RMS onto 0..1 for the level meter.
 *
 *  Linear RMS is useless here: speech sits around 0.05–0.3 against a 0.0035
 *  noise floor, so a linear bar would spend its life in the bottom tenth.
 *  Loudness is logarithmic, and so is this. */
export function meterLevel(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  const level = (db - kMeterFloorDb) / (kMeterCeilingDb - kMeterFloorDb);
  return Math.min(1, Math.max(0, level));
}

/** Bar heights for a meter of `count` bars, newest sample last.
 *
 *  The history is what makes the meter read as "listening" rather than "on":
 *  a single bar that jumps looks like a status light, a row that scrolls looks
 *  like it is following a voice. */
export function meterBars(history: readonly number[], count: number): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    // Right-align: the newest sample is the rightmost bar, and a short history
    // pads on the left rather than stretching.
    const index = history.length - count + i;
    bars.push(index >= 0 ? meterLevel(history[index]) : 0);
  }
  return bars;
}

/** Keeps the last `count` samples. */
export function pushLevel(history: readonly number[], rms: number, count: number): number[] {
  const next = [...history, rms];
  return next.length > count ? next.slice(next.length - count) : next;
}
