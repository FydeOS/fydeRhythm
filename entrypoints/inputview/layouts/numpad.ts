import type { NumericFieldKind } from '@/lib/shared-types';
import { backspaceKey, charKey, type KeyboardLayout, type KeyDef } from './types';
import { enterKey } from './frame';

function digit(d: string): KeyDef {
    return { ...charKey(d), width: 1 };
}

function sym(c: string): KeyDef {
    return { ...charKey(c), kind: 'function', width: 1 };
}

const hideKey: KeyDef = { id: 'hide', label: '⌄', kind: 'function', action: { type: 'hide' }, width: 1 };
// Escape hatch to the full letter keyboard (numeric fields otherwise trap you).
const lettersKey: KeyDef = { id: 'to-letters', label: 'ABC', kind: 'function', action: { type: 'numericLetters', on: true }, width: 1 };

const symbolsFor: Record<NumericFieldKind, [string, string]> = {
    tel: ['+', '#'],
    number: ['.', '-'],
};

// Compact 4×4 pad shown for number/tel fields — digits, two field-specific
// symbols, backspace, enter, plus hide and an ABC escape.
export function numpadLayout(kind: NumericFieldKind): KeyboardLayout {
    const [s1, s2] = symbolsFor[kind];
    return {
        id: `numpad-${kind}`,
        rows: [
            [digit('1'), digit('2'), digit('3'), { ...backspaceKey, width: 1 }],
            [digit('4'), digit('5'), digit('6'), sym(s1)],
            [digit('7'), digit('8'), digit('9'), sym(s2)],
            [lettersKey, digit('0'), hideKey, { ...enterKey, width: 1 }],
        ],
    };
}
