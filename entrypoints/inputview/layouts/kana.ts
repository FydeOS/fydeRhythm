import { backspaceKey, commit, shiftKey, type KeyboardLayout, type KeyDef } from './types';
import { enterKey } from './frame';

// かな (五十音 grid). Unlike zhuyin/hangul there is no reliable physical-key
// mapping a Rime schema is guaranteed to understand (Japanese Rime schemas are
// typically romaji-driven — use the Latin layout for those), so kana are
// committed directly to the field. Shift switches to katakana; long-press
// offers the small forms and voiced variants.

function kana(hira: string, kata: string, alts?: string[]): KeyDef {
    return {
        id: `kana-${hira}`,
        label: hira,
        shiftLabel: kata,
        action: commit(hira),
        shiftAction: commit(kata),
        ...(alts && alts.length > 0
            ? { alts: alts.map((a) => ({ label: a, action: commit(a) })) }
            : {}),
    };
}

export const kanaLayout: KeyboardLayout = {
    id: 'kana',
    rows: [
        [
            kana('あ', 'ア', ['ぁ']),
            kana('か', 'カ', ['が']),
            kana('さ', 'サ', ['ざ']),
            kana('た', 'タ', ['だ']),
            kana('な', 'ナ'),
            kana('は', 'ハ', ['ば', 'ぱ']),
            kana('ま', 'マ'),
            kana('や', 'ヤ', ['ゃ']),
            kana('ら', 'ラ'),
            kana('わ', 'ワ', ['ゎ']),
            { ...backspaceKey, width: 1.5 },
        ],
        [
            kana('い', 'イ', ['ぃ']),
            kana('き', 'キ', ['ぎ']),
            kana('し', 'シ', ['じ']),
            kana('ち', 'チ', ['ぢ']),
            kana('に', 'ニ'),
            kana('ひ', 'ヒ', ['び', 'ぴ']),
            kana('み', 'ミ'),
            kana('ゆ', 'ユ', ['ゅ']),
            kana('り', 'リ'),
            kana('を', 'ヲ'),
            { ...enterKey, width: 1.5 },
        ],
        [
            kana('う', 'ウ', ['ぅ', 'ゔ']),
            kana('く', 'ク', ['ぐ']),
            kana('す', 'ス', ['ず']),
            kana('つ', 'ツ', ['づ', 'っ']),
            kana('ぬ', 'ヌ'),
            kana('ふ', 'フ', ['ぶ', 'ぷ']),
            kana('む', 'ム'),
            kana('よ', 'ヨ', ['ょ']),
            kana('る', 'ル'),
            kana('ん', 'ン'),
            { id: 'kana-sp3', label: ' ', kind: 'spacer', action: { type: 'none' }, width: 1.5 },
        ],
        [
            shiftKey,
            kana('え', 'エ', ['ぇ']),
            kana('け', 'ケ', ['げ']),
            kana('せ', 'セ', ['ぜ']),
            kana('て', 'テ', ['で']),
            kana('ね', 'ネ'),
            kana('へ', 'ヘ', ['べ', 'ぺ']),
            kana('め', 'メ'),
            kana('お', 'オ', ['ぉ']),
            kana('こ', 'コ', ['ご']),
            kana('ー', 'ー', ['〜']),
        ],
    ],
};
