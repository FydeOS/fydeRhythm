// Physical-frame builder for Latin layouts.
//
// The frame is the Keyline spec's grid map (§02): ten 1-unit letter columns,
// row 2 centred with half-unit spacers, Shift and Backspace anchored at the
// bottom corners of row 3 at 1.5u. Enter is NOT here — it lives in the shared
// bottom row (index.ts), Gboard-style. Switching QWERTY/Colemak/Dvorak only
// remaps which letter is painted in which cell; the frame never reflows.
// Every row totals kFrameUnits so the unit grid lines up across rows.

import { backspaceKey, charAlts, charKey, letterKey, shiftKey, stroke, withSymbolHints, type KeyboardLayout, type KeyDef } from './types';

export const kFrameUnits = 10;

// Positional long-press data, FlorisBoard-style: digits over row 1, symbols
// over rows 2/3, Latin diacritics merged per letter.
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

// A letter cell. Dvorak's row-1 punctuation renders like the bottom-row pair:
// the same physical stroke under a CJK cap in Chinese mode. 、 has no key of
// its own anywhere — Rime's punctuator puts it on backslash, so the zh cap
// sends that stroke. Colemak's ';' stays a plain char key.
function cellKey(ch: string, ascii: boolean): KeyDef {
    if (/^[a-z]$/.test(ch)) return letterKey(ch, kDiacritics[ch]);
    if (ch === ',') return { id: 'dv-Comma', label: ascii ? ',' : '，', action: stroke(',', 'Comma') };
    if (ch === '.') return { id: 'dv-Period', label: ascii ? '.' : '。', action: stroke('.', 'Period') };
    if (ch === "'") {
        return ascii
            ? { id: 'dv-Quote', label: "'", action: stroke("'", 'Quote') }
            : { id: 'dv-Quote', label: '、', action: stroke('\\', 'Backslash') };
    }
    return charKey(ch);
}

export interface LatinFrameSpec {
    id: string;
    /** Letters (or chars) for the three rows, e.g. 'qwertyuiop'. */
    rows: [string, string, string];
}

// Chinese/ASCII punctuation pair on the bottom row. Taps send plain
// keystrokes — the engine picks half/full width; bubbles carry the direct
// CJK marks.
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

export function buildLatinLayout(spec: LatinFrameSpec, ascii: boolean): KeyboardLayout {
    const [r1, r2, r3] = spec.rows.map((s) => [...s].map((ch) => cellKey(ch, ascii)));

    // Row 1: ten letter columns fill the frame exactly.
    const row1 = withSymbolHints(r1, kRow1Digits);

    // Row 2: half-unit margins centre the home row; the letters share the
    // rest (1u for the 9-key home rows, 0.9u for Dvorak's ten — the spec's
    // 9% cells).
    const w2 = (kFrameUnits - 1) / r2.length;
    const row2: KeyDef[] = withSymbolHints(r2, kRow2Symbols)
        .map((k) => (w2 === 1 ? k : { ...k, width: w2 }));
    row2.unshift(spacer('sp-home-l', 0.5));
    row2.push(spacer('sp-home-r', 0.5));

    // Row 3: Shift and Backspace anchor the corners; the letters share what is
    // left (1u for the 7-letter rows; Dvorak's nine squeeze to 7/9u).
    const w3 = (kFrameUnits - 3) / r3.length;
    const row3: KeyDef[] = withSymbolHints(r3, kRow3Symbols)
        .map((k) => (w3 === 1 ? k : { ...k, width: w3 }));
    row3.unshift({ ...shiftKey, width: 1.5 });
    row3.push({ ...backspaceKey, width: 1.5 });

    return { id: spec.id, rows: [row1, row2, row3] };
}

export { commaKey, periodKey };
