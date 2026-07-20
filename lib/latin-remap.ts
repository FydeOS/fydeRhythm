// Physical-key remapping for Latin layouts (Colemak/Dvorak), shared by both
// sides of the IME:
//  - the background remaps PHYSICAL key events (code → layout char), so an
//    external keyboard follows the chosen layout — the manifest pins the
//    system layout to plain US, so the OS always reports QWERTY chars;
//  - the InputView uses the inverse (char → code) when synthesizing strokes,
//    so on-screen keys survive the background's remap unchanged.

import type { LatinLayoutId } from './shared-types';

// Physical key codes of the three letter rows plus the punctuation keys the
// alternative layouts move, in US order.
const kPhysicalCodes = [
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash',
  'Minus', 'Equal',
] as const;

// Unshifted output of each physical key per layout (same order as above).
// Digits and other keys are identical across these layouts and stay untouched.
const kLayoutChars: Record<LatinLayoutId, string> = {
  qwerty: 'qwertyuiop[]' + "asdfghjkl;'" + 'zxcvbnm,./' + '-=',
  colemak: 'qwfpgjluy;[]' + "arstdhneio'" + 'zxcvbkm,./' + '-=',
  dvorak: "',.pyfgcrl/=" + 'aoeuidhtns-' + ';qjkxbmwvz' + '[]',
};

// US shift pairs for the punctuation the tables can produce.
const kShiftedPunct: Record<string, string> = {
  '-': '_', '=': '+', '[': '{', ']': '}', ';': ':', "'": '"',
  ',': '<', '.': '>', '/': '?', '`': '~', '\\': '|',
};

function shiftChar(c: string): string {
  if (/^[a-z]$/.test(c)) return c.toUpperCase();
  return kShiftedPunct[c] ?? c;
}

const kForward: Record<LatinLayoutId, Record<string, string>> = {
  qwerty: {}, colemak: {}, dvorak: {},
};
for (const layout of Object.keys(kLayoutChars) as LatinLayoutId[]) {
  kPhysicalCodes.forEach((code, i) => {
    kForward[layout][code] = kLayoutChars[layout][i];
  });
}

/** The character a physical key produces under the given layout, or null when
 *  the key is not remapped (digits, specials) or the layout is plain QWERTY. */
export function remapPhysicalKey(
  layout: LatinLayoutId,
  code: string,
  shifted: boolean,
  capsLock: boolean = false,
): string | null {
  if (layout === 'qwerty') return null;
  const base = kForward[layout][code];
  if (base === undefined) return null;
  // Caps Lock changes letter case, while Shift both inverts that case and
  // selects shifted punctuation. Treating Caps Lock as plain Shift would turn
  // Dvorak's apostrophe position into a quote.
  if (/^[a-z]$/.test(base)) return shifted !== capsLock ? base.toUpperCase() : base;
  return shifted ? shiftChar(base) : base;
}

export interface LayoutStroke {
  code: string;
  shiftKey: boolean;
}

/** Inverse lookup: the physical key (and shift state) that produces `char`
 *  under the given layout. Null when the char isn't on the remapped keys. */
export function strokeForChar(layout: LatinLayoutId, char: string): LayoutStroke | null {
  const chars = kLayoutChars[layout];
  const lower = char.toLowerCase();
  // Direct (unshifted) hit, or a letter's uppercase form.
  let i = chars.indexOf(/^[A-Z]$/.test(char) ? lower : char);
  if (i >= 0) {
    return { code: kPhysicalCodes[i], shiftKey: /^[A-Z]$/.test(char) };
  }
  // Shifted punctuation ("_{}:"<>?+ …): find the base char whose shift is `char`.
  for (const [base, shifted] of Object.entries(kShiftedPunct)) {
    if (shifted === char) {
      i = chars.indexOf(base);
      if (i >= 0) return { code: kPhysicalCodes[i], shiftKey: true };
    }
  }
  return null;
}
