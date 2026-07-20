import type { NumericFieldKind } from '@/lib/shared-types';

import { enterKey } from './frame';
import { backspaceKey, charKey, type KeyboardLayout, type KeyDef } from './types';

function digit(d: string): KeyDef {
  return { ...charKey(d), width: 1 };
}

function sym(c: string): KeyDef {
  return { ...charKey(c), kind: 'function', width: 1 };
}

// Escape hatch to the full letter keyboard (numeric fields otherwise trap you).
// It sits where the spec's numeric map draws 中 — an ASCII toggle is useless on
// a digits-only field, the way back out is not.
const lettersKey: KeyDef = { id: 'to-letters', label: 'ABC', kind: 'function', action: { type: 'numericLetters', on: true }, width: 1 };

// The odd symbol out is the field kind's: # for tel, * for number. ASCII
// glyphs throughout — the spec draws full-width ＋（， but numeric FIELDS
// reject full-width characters, and these keys type straight into one.
const symbolsFor: Record<NumericFieldKind, string> = {
  tel: '#',
  number: '*',
};

// The spec's uniform 5-column numeric grid (§02), shown for number/tel fields.
export function numpadLayout(kind: NumericFieldKind): KeyboardLayout {
  return {
    id: `numpad-${kind}`,
    rows: [
      [digit('1'), digit('2'), digit('3'), sym('+'), { ...backspaceKey, width: 1 }],
      [digit('4'), digit('5'), digit('6'), sym('-'), sym('(')],
      [digit('7'), digit('8'), digit('9'), sym(symbolsFor[kind]), sym(')')],
      [lettersKey, digit('0'), digit('.'), digit(','), { ...enterKey, width: 1 }],
    ],
  };
}
