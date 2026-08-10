// Decides, per tap, whether a char key strokes through the engine or inserts
// its glyph literally. This is the WHOLE routing decision — the dispatcher
// only carries out the verdict.
//
//   no ASCII identity (￥ π 「 emoji) → literal, there is no key to send
//   numeric field (number/tel) → literal; those fields reject composition
//     outright, so no schema may claim their digits
//   ASCII mode → stroke; the engine passes printables through itself
//   otherwise the schema's own speller/alphabet decides, together with
//   whether the main layer already paints its full composition inventory
//   (script layouts: zhuyin/kana/hangul):
//     punctuation ∈ alphabet on a script layout → literal (大千 maps ,./;- to
//       finals; the caps for those finals are on the main layer, so this key
//       means the glyph itself — stroking it would compose ㄝ instead of ，)
//     punctuation otherwise → stroke (the punctuator owns half/full width,
//       paired quotes, and per-schema customization; ∈-alphabet chars on
//       Latin layouts compose — 行列 uses ,./ — as on a physical keyboard)
//     digit ∈ alphabet on a Latin layout → stroke (tone entry: terra_pinyin
//       1-5, jyutping 1-6 — the sym layer is the only digit entry point)
//     digit otherwise → literal (a stroked digit while composing selects a
//       candidate — a desktop convention that on a VK, where candidates are
//       tapped, only surprises)

// librime's speller/alphabet default, assumed while the real one is unknown.
const kDefaultAlphabet = 'zyxwvutsrqponmlkjihgfedcba';

export interface CharContext {
  // Main layer paints the schema's own script (zhuyin/kana/hangul).
  scriptLayout: boolean;
  // Active schema's speller/alphabet; '' while unknown.
  alphabet: string;
  asciiMode: boolean;
  // Numeric field showing the number pad (not its ABC escape hatch).
  numpad: boolean;
}

export function classifyChar(ascii: string, ctx: CharContext): 'stroke' | 'literal' {
  if (!ascii || ctx.numpad) return 'literal';
  if (ctx.asciiMode) return 'stroke';
  const inAlphabet = (ctx.alphabet || kDefaultAlphabet).includes(ascii);
  if (/^[0-9]$/.test(ascii)) {
    return inAlphabet && !ctx.scriptLayout ? 'stroke' : 'literal';
  }
  return ctx.scriptLayout && inAlphabet ? 'literal' : 'stroke';
}
