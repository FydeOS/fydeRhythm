import { backspaceKey, type KeyboardLayout, type KeyDef, shiftKey, stroke } from './types';

// 한글 2-set (두벌식) on the shared frame — the Keyline spec's Dubeolsik map
// (§02). Keys show jamo but inject the underlying Latin keystroke; a hangul
// schema in the Rime engine composes syllables from them, as with a physical
// keyboard. Shift produces the double consonants and ㅒ/ㅖ, injected as
// shifted strokes.

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

function spacer(id: string, width: number): KeyDef {
  return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
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
    ],
    [
      spacer('ko-sp2l', 0.5),
      ko('ㅁ', 'a'),
      ko('ㄴ', 's'),
      ko('ㅇ', 'd'),
      ko('ㄹ', 'f'),
      ko('ㅎ', 'g'),
      ko('ㅗ', 'h'),
      ko('ㅓ', 'j'),
      ko('ㅏ', 'k'),
      ko('ㅣ', 'l'),
      spacer('ko-sp2r', 0.5),
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
      backspaceKey,
    ],
  ],
};
