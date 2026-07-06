// Physical-frame builder for Latin layouts.
//
// A laptop-style keyboard is a FIXED frame: Backspace anchored at the top
// right, a widened Enter at the middle right, Shift at the bottom left —
// switching QWERTY/Colemak/Dvorak only remaps which letter is painted in
// which 1-unit letter cell; the frame never reflows. Every row totals
// kFrameUnits so the unit grid lines up across rows.

import { backspaceKey, charAlts, charKey, letterKey, shiftKey, stroke, withSymbolHints, type KeyboardLayout, type KeyDef } from './types';

export const kFrameUnits = 11.5;

// Positional long-press data, FlorisBoard-style: digits over row 1, symbols
// over rows 2/3, diacritics merged per letter.
const kRow1Digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const kRow2Symbols = ['@', '#', '$', '%', '&', '-', '+', '(', ')'];
const kRow3Symbols = ['*', '"', "'", ':', ';', '!', '?'];

const kDiacritics: Record<string, string[]> = {
    a: ['à', 'á', 'â', 'ä', 'ã', 'å', 'ā', 'æ'],
    c: ['ç', 'ć', 'č'],
    e: ['è', 'é', 'ê', 'ë', 'ē'],
    i: ['ì', 'í', 'î', 'ï', 'ī'],
    n: ['ñ', 'ń'],
    o: ['ò', 'ó', 'ô', 'ö', 'õ', 'ō'],
    s: ['ß', 'ś', 'š'],
    u: ['ù', 'ú', 'û', 'ü', 'ū'],
    y: ['ý'],
    z: ['ź', 'ž'],
};

function spacer(id: string, width: number): KeyDef {
    return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
}

// A letter cell; non-letter chars (';' in Colemak, "'," in Dvorak) become
// plain char keys in the same 1-unit cell.
function cellKey(ch: string): KeyDef {
    if (/^[a-z]$/.test(ch)) return letterKey(ch, kDiacritics[ch]);
    return charKey(ch);
}

export interface LatinFrameSpec {
    id: string;
    /** Letters (or chars) for the three rows, e.g. 'qwertyuiop'. */
    rows: [string, string, string];
}

// Chinese/ASCII punctuation pair on the frame (bottom-right of row 3, where
// physical keyboards put , and .). Taps send plain keystrokes — the engine
// picks half/full width; bubbles carry the direct CJK marks.
function commaKey(ascii: boolean): KeyDef {
    return {
        id: 'Comma',
        label: ascii ? ',' : '，',
        action: stroke(',', 'Comma'),
        hint: ascii ? '!' : '、',
        alts: ascii ? charAlts(['!', ';', ':', '-', '@']) : charAlts(['、', '！', '；', '：', '…']),
    };
}

function periodKey(ascii: boolean): KeyDef {
    return {
        id: 'Period',
        label: ascii ? '.' : '。',
        action: stroke('.', 'Period'),
        hint: ascii ? '?' : '？',
        alts: ascii ? charAlts(['?', '"', "'", '(', ')', '/']) : charAlts(['？', '“', '”', '《', '》', '（', '）']),
    };
}

export const enterKey: KeyDef = {
    id: 'Enter',
    label: '↵',
    kind: 'enter',
    action: stroke('Enter', 'Enter'),
};

/** Whether the frame could host ，。 on row 3 (10-letter rows can't; the
 *  bottom row hosts them instead — see bottomRow). */
export function frameHasPunctuation(spec: LatinFrameSpec): boolean {
    return spec.rows[2].length <= 8;
}

export function buildLatinLayout(spec: LatinFrameSpec, ascii: boolean): KeyboardLayout {
    const [r1, r2, r3] = spec.rows.map((s) => [...s].map(cellKey));

    // Row 1: letters + anchored Backspace.
    const row1 = withSymbolHints(r1, kRow1Digits);
    row1.push({ ...backspaceKey, width: kFrameUnits - r1.length });

    // Row 2: home row, offset like a physical keyboard when it has 9 keys,
    // then the widened Enter fills to the frame edge.
    const row2: KeyDef[] = withSymbolHints(r2, kRow2Symbols);
    if (r2.length <= 9) row2.unshift(spacer('sp-home', 0.4));
    const row2Used = r2.length + (r2.length <= 9 ? 0.4 : 0);
    row2.push({ ...enterKey, width: kFrameUnits - row2Used });

    // Row 3: anchored Shift, letters, then ，。 (when they fit) and a filler
    // spacer so the punctuation doesn't hug the frame edge.
    const row3: KeyDef[] = withSymbolHints(r3, kRow3Symbols);
    row3.unshift({ ...shiftKey, width: 1.5 });
    if (frameHasPunctuation(spec)) {
        row3.push(commaKey(ascii), periodKey(ascii));
    }
    const row3Used = row3.reduce((s, k) => s + (k.width ?? 1), 0);
    if (kFrameUnits - row3Used > 0.05) row3.push(spacer('sp-r3', kFrameUnits - row3Used));

    return { id: spec.id, rows: [row1, row2, row3] };
}

export { commaKey, periodKey };
