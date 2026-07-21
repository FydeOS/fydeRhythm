// How many candidates to seed / keep loaded, derived from the candidate bar's
// pixel width alone. Keeping this independent of the candidates themselves is
// what prevents the flicker: a word with narrower candidates can't shrink the
// count and force a mid-composition top-up that grows the strip in place.

// Bounds on one keystroke's seed count.
export const kMinBatch = 10;
export const kMaxBatch = 48;
// Narrowest a chip can render (min font + padding). Dividing width by this
// floor — not the current word's actual chip width — is what keeps the count
// covering the strip for every word.
const kMinChipPx = 30;

// Candidates needed to fill a bar `width` px wide. Since a real chip is never
// narrower than kMinChipPx, this is an upper bound on how many fit, so seeding
// it fills the strip on first paint for any word. 0 before the bar is measured.
export function candidateSeed(width: number): number {
  if (width <= 0) return 0;
  return Math.min(kMaxBatch, Math.max(kMinBatch, Math.ceil(width / kMinChipPx)));
}
