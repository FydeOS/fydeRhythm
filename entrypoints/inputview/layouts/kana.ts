import { enterKey } from './frame';
import { type AltDef, backspaceKey, char, codeForChar, type FlickDef, type KeyAction, type KeyboardLayout, type KeyDef, stroke } from './types';

// 12-key kana per the Keyline spec (§02): five uniform columns, function keys
// down both edges, flick input on the kana cells — self-contained, so App does
// not append the shared bottom row.
//
// Each kana injects the romaji keystrokes the jap_poly schema spells it with
// (し=si, つ=tu, っ=xtu, ん=n, ー=-), so the engine composes and converts to
// kanji exactly as romaji typing would. Committing kana directly bypasses the
// engine and makes conversion impossible. Katakana come from the candidate
// list, as in other Japanese IMEs.

// jap_poly spellings (kunrei base; alphabet is a–z plus '-').
const kKanaRomaji: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'si', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'ti', つ: 'tu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'hu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n', ー: '-',
  ぁ: 'xa', ぃ: 'xi', ぅ: 'xu', ぇ: 'xe', ぉ: 'xo', ゔ: 'vu',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'zi', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'di', づ: 'du', っ: 'xtu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゃ: 'xya', ゅ: 'xyu', ょ: 'xyo', ゎ: 'xwa',
};

// 小゛゜ cycles the LAST typed kana through its variants (base → small →
// dakuten → handakuten, whichever exist), the way every 12-key IME does.
const kModifyCycles: string[][] = [
  ['あ', 'ぁ'], ['い', 'ぃ'], ['う', 'ぅ', 'ゔ'], ['え', 'ぇ'], ['お', 'ぉ'],
  ['か', 'が'], ['き', 'ぎ'], ['く', 'ぐ'], ['け', 'げ'], ['こ', 'ご'],
  ['さ', 'ざ'], ['し', 'じ'], ['す', 'ず'], ['せ', 'ぜ'], ['そ', 'ぞ'],
  ['た', 'だ'], ['ち', 'ぢ'], ['つ', 'っ', 'づ'], ['て', 'で'], ['と', 'ど'],
  ['は', 'ば', 'ぱ'], ['ひ', 'び', 'ぴ'], ['ふ', 'ぶ', 'ぷ'], ['へ', 'べ', 'ぺ'], ['ほ', 'ぼ', 'ぽ'],
  ['や', 'ゃ'], ['ゆ', 'ゅ'], ['よ', 'ょ'], ['わ', 'ゎ'],
];

export function kanaModifyNext(kana: string): { kana: string; romaji: string } | null {
  for (const cycle of kModifyCycles) {
    const i = cycle.indexOf(kana);
    if (i >= 0) {
      const next = cycle[(i + 1) % cycle.length];
      return { kana: next, romaji: kKanaRomaji[next] };
    }
  }
  return null;
}

// The strokes that type one kana, tagged with the glyph so 小゛゜ can find it.
function seq(kana: string): KeyAction {
  const romaji = kKanaRomaji[kana];
  return { type: 'strokes', kana, strokes: [...romaji].map(c => ({ key: c, code: codeForChar(c) })) };
}

// A flick petal: kana type their romaji; anything else (brackets, dots)
// inserts literally.
function petal(label: string): AltDef {
  return { label, action: kKanaRomaji[label] ? seq(label) : char(label) };
}

// A 12-key kana cell: tap = the column head, flick left/up/right/down = the
// rest of the row. The petals double as the long-press bubble for tap-typists.
function kanaCell(center: string, petals: [string?, string?, string?, string?]): KeyDef {
  const [left, up, right, down] = petals;
  const flick: FlickDef = {
    ...(left ? { left: petal(left) } : {}),
    ...(up ? { up: petal(up) } : {}),
    ...(right ? { right: petal(right) } : {}),
    ...(down ? { down: petal(down) } : {}),
  };
  return {
    id: `kana-${center}`,
    label: center,
    action: seq(center),
    flick,
    alts: petals.filter((p): p is string => !!p).map(petal),
  };
}

// The punctuation cells carry the CJK glyph plus its ASCII keystroke;
// classifyChar picks stroke (romaji schemas — the punctuator maps , to 、)
// or literal per schema, with the composition flushed first either way.
function punctCell(center: string, centerAction: KeyAction, petals: Array<[string, KeyAction]>): KeyDef {
  const alts: AltDef[] = petals.map(([label, action]) => ({ label, action }));
  const dir: (keyof FlickDef)[] = ['up', 'left', 'right', 'down'];
  const flick: FlickDef = {};
  alts.forEach((a, i) => { if (dir[i]) flick[dir[i]] = a; });
  return {
    id: `kana-${center}`,
    label: center,
    action: centerAction,
    flick,
    alts,
  };
}

function fn(id: string, label: string, action: KeyAction): KeyDef {
  return { id, label, kind: 'function', action };
}

export const kanaLayout: KeyboardLayout = {
  id: 'kana',
  units: 5,
  selfContained: true,
  rows: [
    [
      fn('emoji', '☺', { type: 'emoji' }),
      kanaCell('あ', ['い', 'う', 'え', 'お']),
      kanaCell('か', ['き', 'く', 'け', 'こ']),
      kanaCell('さ', ['し', 'す', 'せ', 'そ']),
      { ...backspaceKey, width: 1 },
    ],
    [
      fn('to-sym', '記号', { type: 'layer', layer: 'sym' }),
      kanaCell('た', ['ち', 'つ', 'て', 'と']),
      kanaCell('な', ['に', 'ぬ', 'ね', 'の']),
      kanaCell('は', ['ひ', 'ふ', 'へ', 'ほ']),
      fn('kana-space', '空白', stroke(' ', 'Space')),
    ],
    [
      fn('kana-abc', 'ABC', { type: 'toggleAscii' }),
      kanaCell('ま', ['み', 'む', 'め', 'も']),
      kanaCell('や', ['「', 'ゆ', '」', 'よ']),
      kanaCell('ら', ['り', 'る', 'れ', 'ろ']),
      // 変換 steps candidates (Down); 空白 sends Space to confirm or space.
      fn('kana-henkan', '変換', { type: 'convert' }),
    ],
    [
      fn('kana-modify', '小゛゜', { type: 'kanaModify' }),
      punctCell('、', char('、', ','), [['。', char('。', '.')], ['・', char('・')], ['…', char('…')]]),
      kanaCell('わ', ['を', 'ん', 'ー', undefined]),
      punctCell('？', char('？', '?'), [['！', char('！', '!')]]),
      { ...enterKey, width: 1 },
    ],
  ],
};
