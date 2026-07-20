import type { LatinFrameSpec } from './frame';

// Colemak letter mapping for the shared frame. The 10-key home row is
// physically correct: Colemak places o on the ; key.
export const colemakSpec: LatinFrameSpec = {
  id: 'colemak',
  rows: ['qwfpgjluy;', 'arstdhneio', 'zxcvbkm'],
};
