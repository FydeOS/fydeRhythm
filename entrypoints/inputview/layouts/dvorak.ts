import type { LatinFrameSpec } from './frame';

// Dvorak letter mapping for the shared physical frame. Rows 1 and 3 use the
// full 10 physical columns (' , . and ; live on letter cells), so ，。 move
// to the bottom row for this layout (frameHasPunctuation → false).
export const dvorakSpec: LatinFrameSpec = {
    id: 'dvorak',
    rows: ["',.pyfgcrl", 'aoeuidhtns', ';qjkxbmwvz'],
};
