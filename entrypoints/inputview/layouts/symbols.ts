import type { ScriptId } from '@/lib/shared-types';

import { kFrameUnits } from './frame';
import { backspaceKey, char, charAlts, charKey, type KeyboardLayout, type KeyDef } from './types';

// Symbol layers on the same frame as the letter layouts: the page toggle and
// Backspace anchor the corners of row 3 exactly where Shift and Backspace sit
// on the letter frame, so switching layers never moves the anchors under the
// user's fingers. Row content follows the Keyline spec's symbols map (§02).
//
// In zh/ja modes the punctuation keys paint the script's own glyphs
// (Gboard/Trime/Hamster all show a CJK symbol page in CJK mode); digits,
// math and currency stay ASCII everywhere. Korean uses Western punctuation,
// so ko keeps the ASCII page.

// The quote pair, per script. Paired quotes are separate open/close keys —
// a literal key cannot alternate the way the punctuator does — so each
// script contributes two fixed glyphs plus the other pair in the bubble.
const kQuotePairs: Record<'zh' | 'ja', Array<[string, string[]]>> = {
  zh: [['“', ['”', '"', '«', '»']], ['‘', ['’', "'", '‚']]],
  ja: [['「', ['」', '『', '』', '"']], ['」', ['「', '『', '』', "'"]]],
};

function quoteKeys(cjk: 'zh' | 'ja' | null): KeyDef[] {
  if (!cjk) return [charKey('"', ['“', '”', '«', '»']), charKey("'", ['‘', '’', '‚'])];
  return kQuotePairs[cjk].map(([glyph, alts]) => cjkKey(glyph, '', alts));
}

// A punctuation key that paints a CJK glyph over its ASCII keystroke.
function cjkKey(glyph: string, ascii: string, altChars: string[]): KeyDef {
  return {
    id: `char-${glyph}`,
    label: glyph,
    action: char(glyph, ascii),
    hint: altChars[0],
    alts: charAlts(altChars),
  };
}

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

export function symLayout(script: ScriptId, ascii: boolean): KeyboardLayout {
  const cjk = ascii || script === 'ko' ? null : script;
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
      cjk ? cjkKey('（', '(', ['(', '<', '{', '[']) : charKey('(', ['<', '{', '[']),
      cjk ? cjkKey('）', ')', [')', '>', '}', ']']) : charKey(')', ['>', '}', ']']),
      charKey('/', ['\\', '÷']),
    ],
    toSym2,
    [
      charKey('*', ['†', '‡', '★']),
      ...quoteKeys(cjk),
      cjk ? cjkKey('：', ':', [':']) : charKey(':'),
      cjk ? cjkKey('；', ';', [';']) : charKey(';'),
      cjk ? cjkKey('！', '!', ['¡', '!']) : charKey('!', ['¡']),
      cjk ? cjkKey('？', '?', ['¿', '?']) : charKey('?', ['¿']),
      cjk ? cjkKey('～', '~', ['~']) : charKey('~'),
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
