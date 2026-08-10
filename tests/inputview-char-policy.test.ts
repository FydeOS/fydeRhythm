import { describe, expect, it } from 'vitest';

import { classifyChar } from '../entrypoints/inputview/char-policy';

// Representative speller/alphabet values from real schemas. Only membership
// matters to the classifier.
const kDachen = 'abcdefghijklmnopqrstuvwxyz1234567890-;,./'; // 大千 bopomofo
const kLuna = 'zyxwvutsrqponmlkjihgfedcba'; // luna_pinyin (librime default)
const kTerra = 'zyxwvutsrqponmlkjihgfedcba12345'; // terra_pinyin (digit tones)
const kArray = 'abcdefghijklmnopqrstuvwxyz;,./'; // 行列-style (punct composes)

const kBase = { asciiMode: false, numpad: false };
const script = (alphabet: string) => ({ ...kBase, scriptLayout: true, alphabet });
const latin = (alphabet: string) => ({ ...kBase, scriptLayout: false, alphabet });

describe('classifyChar', () => {
  it('inserts 大千-mapped punctuation and digits literally on the script layout', () => {
    // Stroking these would compose (， → ㄝ, 1 → ㄅ); the caps for those
    // finals already live on the main layer.
    expect(classifyChar(',', script(kDachen))).toBe('literal');
    expect(classifyChar('.', script(kDachen))).toBe('literal');
    expect(classifyChar('1', script(kDachen))).toBe('literal');
  });

  it('keeps unmapped punctuation on the engine so the punctuator styles it', () => {
    expect(classifyChar('!', script(kDachen))).toBe('stroke'); // 注音 ！
    expect(classifyChar(',', latin(kLuna))).toBe('stroke'); // 拼音 ，
    expect(classifyChar("'", latin(kLuna))).toBe('stroke'); // pinyin separator
  });

  it('keeps alphabet chars on the engine for Latin layouts (they compose)', () => {
    expect(classifyChar('1', latin(kTerra))).toBe('stroke'); // tone entry
    expect(classifyChar(',', latin(kArray))).toBe('stroke'); // 行列 composes ,./
  });

  it('inserts non-composing digits literally (never candidate selection)', () => {
    expect(classifyChar('1', latin(kLuna))).toBe('literal');
    expect(classifyChar('1', script('abcdefghijklmnopqrstuvwxyz-'))).toBe('literal'); // kana
  });

  it('assumes the librime default alphabet while the real one is unknown', () => {
    // Letters-only default: punctuation strokes (status quo), digits literal.
    expect(classifyChar(',', script(''))).toBe('stroke');
    expect(classifyChar(',', latin(''))).toBe('stroke');
    expect(classifyChar('1', latin(''))).toBe('literal');
  });

  it('glyphs with no keystroke identity are always literal', () => {
    // ￥ 「 emoji: there is no key to send, whatever the schema claims.
    expect(classifyChar('', script(kDachen))).toBe('literal');
    expect(classifyChar('', { ...latin(kTerra), asciiMode: true })).toBe('literal');
  });

  it('the number pad never composes, whatever the schema claims', () => {
    // Numeric fields reject composition outright — no schema may claim them.
    expect(classifyChar('1', { ...latin(kTerra), numpad: true })).toBe('literal');
    expect(classifyChar(',', { ...script(kDachen), numpad: true })).toBe('literal');
  });

  it('ASCII mode strokes everything: the engine passes printables through', () => {
    for (const ctx of [latin(kLuna), latin(kTerra), script(kDachen)]) {
      for (const c of [',', '1', '!']) {
        expect(classifyChar(c, { ...ctx, asciiMode: true })).toBe('stroke');
      }
    }
  });
});
