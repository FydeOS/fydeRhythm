import type { LatinFrameSpec } from './frame';

// Dvorak letter mapping for the shared frame, per the Keyline spec's Dvorak
// map: ' , . live on row-1 letter cells (CJK caps in Chinese mode), the
// 10-letter home row squeezes to 0.9u, and row 3 drops ';' (it lives on the
// symbols layer) so its nine letters fit between the anchors.
export const dvorakSpec: LatinFrameSpec = {
  id: 'dvorak',
  rows: ["',.pyfgcrl", 'aoeuidhtns', 'qjkxbmwvz'],
};
