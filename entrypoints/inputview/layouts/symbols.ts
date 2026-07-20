import { kFrameUnits } from './frame';
import { backspaceKey, charKey, type KeyboardLayout, type KeyDef } from './types';

// Symbol layers on the same frame as the letter layouts: the page toggle and
// Backspace anchor the corners of row 3 exactly where Shift and Backspace sit
// on the letter frame, so switching layers never moves the anchors under the
// user's fingers. Row content follows the Keyline spec's symbols map (§02).

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

function frameRows(id: string, row1: KeyDef[], row2: KeyDef[], row3head: KeyDef, row3: KeyDef[]): KeyboardLayout {
  const pad = (kFrameUnits - row2.length) / 2;
  const r2 = pad > 0.05
    ? [spacer(`${id}-sp2l`, pad), ...row2, spacer(`${id}-sp2r`, pad)]
    : row2;
  const keyWidth = (kFrameUnits - 3) / row3.length;
  const r3 = [
    row3head,
    ...row3.map(k => (keyWidth === 1 ? k : { ...k, width: keyWidth })),
    { ...backspaceKey, width: 1.5 },
  ];
  return { id, rows: [row1, r2, r3] };
}

export function symLayout(): KeyboardLayout {
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
      charKey('￥', ['$', '¢', '€', '£']),
      charKey('&', ['%', '‰']),
      charKey('_'),
      charKey('-', ['–', '—', '·']),
      charKey('+', ['±']),
      charKey('(', ['<', '{', '[']),
      charKey(')', ['>', '}', ']']),
      charKey('/', ['\\', '÷']),
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
      charKey('~'),
    ],
  );
}

export function sym2Layout(): KeyboardLayout {
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
  );
}
