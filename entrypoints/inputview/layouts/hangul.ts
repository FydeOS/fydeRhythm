import { backspaceKey, shiftKey, stroke, type KeyboardLayout, type KeyDef } from './types';
import { enterKey } from './frame';

// 한글 2-set (두벌식). Keys show jamo but inject the underlying Latin
// keystroke; a hangul schema in the Rime engine composes syllables from them,
// as with a physical keyboard. Shift produces the double consonants and
// ㅒ/ㅖ, injected as shifted strokes.

function ko(label: string, key: string, shiftLabel?: string): KeyDef {
    const code = `Key${key.toUpperCase()}`;
    return {
        id: `ko-${code}`,
        label,
        action: stroke(key, code),
        ...(shiftLabel
            ? { shiftLabel, shiftAction: stroke(key.toUpperCase(), code, true) }
            : {}),
    };
}

export const hangulLayout: KeyboardLayout = {
    id: 'hangul',
    rows: [
        [
            ko('ㅂ', 'q', 'ㅃ'),
            ko('ㅈ', 'w', 'ㅉ'),
            ko('ㄷ', 'e', 'ㄸ'),
            ko('ㄱ', 'r', 'ㄲ'),
            ko('ㅅ', 't', 'ㅆ'),
            ko('ㅛ', 'y'),
            ko('ㅕ', 'u'),
            ko('ㅑ', 'i'),
            ko('ㅐ', 'o', 'ㅒ'),
            ko('ㅔ', 'p', 'ㅖ'),
            { ...backspaceKey, width: 1.5 },
        ],
        [
            { id: 'ko-sp2', label: ' ', kind: 'spacer', action: { type: 'none' }, width: 0.4 },
            ko('ㅁ', 'a'),
            ko('ㄴ', 's'),
            ko('ㅇ', 'd'),
            ko('ㄹ', 'f'),
            ko('ㅎ', 'g'),
            ko('ㅗ', 'h'),
            ko('ㅓ', 'j'),
            ko('ㅏ', 'k'),
            ko('ㅣ', 'l'),
            { ...enterKey, width: 2.1 },
        ],
        [
            shiftKey,
            ko('ㅋ', 'z'),
            ko('ㅌ', 'x'),
            ko('ㅊ', 'c'),
            ko('ㅍ', 'v'),
            ko('ㅠ', 'b'),
            ko('ㅜ', 'n'),
            ko('ㅡ', 'm'),
            { id: 'ko-sp3', label: ' ', kind: 'spacer', action: { type: 'none' }, width: 3 },
        ],
    ],
};
