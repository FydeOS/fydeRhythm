import { backspaceKey, codeForChar, commit, type KeyAction, type KeyboardLayout, type KeyDef } from './types';
import { enterKey } from './frame';

// かな (五十音 grid). Each key injects the romaji keystrokes the jap_poly
// schema spells that kana with (し=si, つ=tu, っ=xtu, ん=n, ー=-), so the
// engine composes and converts to kanji exactly as romaji typing would.
// Committing kana directly (the previous design) bypassed the engine and made
// conversion impossible. Katakana come from the candidate list, as in other
// Japanese IMEs; long-press offers the voiced/semi-voiced/small variants.

function seq(romaji: string): KeyAction {
    return { type: 'strokes', strokes: [...romaji].map((c) => ({ key: c, code: codeForChar(c) })) };
}

function kana(label: string, romaji: string, alts?: Array<[string, string]>): KeyDef {
    return {
        id: `kana-${label}`,
        label,
        action: seq(romaji),
        ...(alts && alts.length > 0
            ? { alts: alts.map(([l, r]) => ({ label: l, action: seq(r) })) }
            : {}),
    };
}

function spacer(id: string, width: number): KeyDef {
    return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
}

export const kanaLayout: KeyboardLayout = {
    id: 'kana',
    rows: [
        [
            kana('あ', 'a', [['ぁ', 'xa']]),
            kana('か', 'ka', [['が', 'ga']]),
            kana('さ', 'sa', [['ざ', 'za']]),
            kana('た', 'ta', [['だ', 'da']]),
            kana('な', 'na'),
            kana('は', 'ha', [['ば', 'ba'], ['ぱ', 'pa']]),
            kana('ま', 'ma'),
            kana('や', 'ya', [['ゃ', 'xya']]),
            kana('ら', 'ra'),
            kana('わ', 'wa', [['ゎ', 'xwa']]),
            { ...backspaceKey, width: 1.5 },
        ],
        [
            kana('い', 'i', [['ぃ', 'xi']]),
            kana('き', 'ki', [['ぎ', 'gi']]),
            kana('し', 'si', [['じ', 'zi']]),
            kana('ち', 'ti', [['ぢ', 'di']]),
            kana('に', 'ni'),
            kana('ひ', 'hi', [['び', 'bi'], ['ぴ', 'pi']]),
            kana('み', 'mi'),
            kana('ゆ', 'yu', [['ゅ', 'xyu']]),
            kana('り', 'ri'),
            kana('を', 'wo'),
            { ...enterKey, width: 1.5 },
        ],
        [
            kana('う', 'u', [['ぅ', 'xu'], ['ゔ', 'vu']]),
            kana('く', 'ku', [['ぐ', 'gu']]),
            kana('す', 'su', [['ず', 'zu']]),
            kana('つ', 'tu', [['っ', 'xtu'], ['づ', 'du']]),
            kana('ぬ', 'nu'),
            kana('ふ', 'hu', [['ぶ', 'bu'], ['ぷ', 'pu']]),
            kana('む', 'mu'),
            kana('よ', 'yo', [['ょ', 'xyo']]),
            kana('る', 'ru'),
            kana('ん', 'n'),
            spacer('kana-sp3', 1.5),
        ],
        [
            spacer('kana-sp4', 1.5),
            kana('え', 'e', [['ぇ', 'xe']]),
            kana('け', 'ke', [['げ', 'ge']]),
            kana('せ', 'se', [['ぜ', 'ze']]),
            kana('て', 'te', [['で', 'de']]),
            kana('ね', 'ne'),
            kana('へ', 'he', [['べ', 'be'], ['ぺ', 'pe']]),
            kana('め', 'me'),
            kana('お', 'o', [['ぉ', 'xo']]),
            kana('こ', 'ko', [['ご', 'go']]),
            { id: 'kana-ー', label: 'ー', action: seq('-'), alts: [{ label: '〜', action: commit('〜') }] },
        ],
    ],
};
