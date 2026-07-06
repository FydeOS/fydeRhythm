import { backspaceKey, charKey, type KeyboardLayout, type KeyDef } from './types';
import { commaKey, enterKey, kFrameUnits, periodKey } from './frame';

// Symbol layers on the same physical frame as the letter layouts: Backspace
// stays top-right, Enter middle-right, the page toggle bottom-left — so
// switching layers never moves the anchors under the user's fingers.

const toSym2: KeyDef = {
    id: 'to-sym2',
    label: '=\\<',
    kind: 'function',
    action: { type: 'layer', layer: 'sym2' },
    width: 1.5,
};

const toSym: KeyDef = {
    id: 'to-sym',
    label: '?123',
    kind: 'function',
    action: { type: 'layer', layer: 'sym' },
    width: 1.5,
};

function spacer(id: string, width: number): KeyDef {
    return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
}

function frameRows(
    id: string,
    row1: KeyDef[],
    row2: KeyDef[],
    row3head: KeyDef,
    row3: KeyDef[],
    ascii: boolean,
): KeyboardLayout {
    const r1 = [...row1, { ...backspaceKey, width: kFrameUnits - row1.length }];
    const r2 = [spacer(`${id}-sp2`, 0.4), ...row2, { ...enterKey, width: kFrameUnits - row2.length - 0.4 }];
    const r3 = [row3head, ...row3, commaKey(ascii), periodKey(ascii)];
    const used = r3.reduce((s, k) => s + (k.width ?? 1), 0);
    if (kFrameUnits - used > 0.05) r3.push(spacer(`${id}-sp3`, kFrameUnits - used));
    return { id, rows: [r1, r2, r3] };
}

export function symLayout(ascii: boolean): KeyboardLayout {
    return frameRows(
        'sym',
        [
            charKey('1', ['¹', '½', '⅓', '¼']),
            charKey('2', ['²', '⅔']),
            charKey('3', ['³', '¾']),
            charKey('4', ['⁴']),
            charKey('5'),
            charKey('6'),
            charKey('7'),
            charKey('8'),
            charKey('9'),
            charKey('0', ['ⁿ', '∅']),
        ],
        [
            charKey('@'),
            charKey('#', ['№']),
            charKey('$', ['¢', '€', '£', '¥']),
            charKey('%', ['‰']),
            charKey('&'),
            charKey('-', ['–', '—', '·']),
            charKey('+', ['±']),
            charKey('(', ['<', '{', '[']),
            charKey(')', ['>', '}', ']']),
        ],
        toSym2,
        [
            charKey('*', ['†', '‡', '★']),
            charKey('"', ['“', '”', '«', '»']),
            charKey("'", ['‘', '’', '‚']),
            charKey(':'),
            charKey(';'),
            charKey('!', ['¡']),
            charKey('?', ['¿']),
        ],
        ascii,
    );
}

export function sym2Layout(ascii: boolean): KeyboardLayout {
    return frameRows(
        'sym2',
        [
            charKey('~'),
            charKey('`'),
            charKey('|'),
            charKey('•', ['◦', '‣']),
            charKey('√'),
            charKey('π', ['Π']),
            charKey('÷'),
            charKey('×'),
            charKey('¶', ['§']),
            charKey('∆'),
        ],
        [
            charKey('£'),
            charKey('€'),
            charKey('¥'),
            charKey('°', ['′', '″']),
            charKey('^', ['↑', '↓', '←', '→']),
            charKey('_'),
            charKey('='),
            charKey('{'),
            charKey('}'),
        ],
        toSym,
        [
            charKey('©'),
            charKey('®'),
            charKey('™'),
            charKey('℅'),
            charKey('['),
            charKey(']'),
            charKey('\\'),
        ],
        ascii,
    );
}
