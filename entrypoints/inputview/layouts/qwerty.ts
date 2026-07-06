import type { LatinFrameSpec } from './frame';

// QWERTY letter mapping for the shared physical frame (see frame.ts —
// Backspace/Enter/Shift positions are fixed by the frame, not this file).
export const qwertySpec: LatinFrameSpec = {
    id: 'qwerty',
    rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
};
