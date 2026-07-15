import { backspaceKey, stroke, type KeyboardLayout, type KeyDef } from './types';

// 注音 (bopomofo), the Keyline spec's 10-column rearrangement of 大千 (§02).
// Each key shows the bopomofo symbol but injects the standard 大千 keystroke —
// the bopomofo schema in the Rime engine does the actual mapping, exactly as
// it would for a physical keyboard, so the rearranged caps change nothing
// about composition.
//
// The 11th column is ours, fixing two gaps in the spec's drawing: bopomofo
// has 41 symbols but the spec's 4×10 grid holds 40 (ㄡ was dropped), and the
// grid has no Backspace at all. ⌫ tops the column, ㄡ sits beside the finals.

function zy(label: string, key: string, code: string): KeyDef {
    return { id: `zy-${code}`, label, action: stroke(key, code) };
}

function spacer(id: string, width: number): KeyDef {
    return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
}

export const zhuyinLayout: KeyboardLayout = {
    id: 'zhuyin',
    units: 11,
    rows: [
        [
            zy('ㄅ', '1', 'Digit1'),
            zy('ㄉ', '2', 'Digit2'),
            zy('ˇ', '3', 'Digit3'),
            zy('ˋ', '4', 'Digit4'),
            zy('ㄓ', '5', 'Digit5'),
            zy('ˊ', '6', 'Digit6'),
            zy('˙', '7', 'Digit7'),
            zy('ㄦ', '-', 'Minus'),
            zy('ㄝ', ',', 'Comma'),
            zy('ㄥ', '/', 'Slash'),
            { ...backspaceKey, width: 1 },
        ],
        [
            zy('ㄆ', 'q', 'KeyQ'),
            zy('ㄊ', 'w', 'KeyW'),
            zy('ㄍ', 'e', 'KeyE'),
            zy('ㄐ', 'r', 'KeyR'),
            zy('ㄔ', 't', 'KeyT'),
            zy('ㄗ', 'y', 'KeyY'),
            zy('ㄧ', 'u', 'KeyU'),
            zy('ㄛ', 'i', 'KeyI'),
            zy('ㄞ', '9', 'Digit9'),
            zy('ㄢ', '0', 'Digit0'),
            zy('ㄡ', '.', 'Period'),
        ],
        [
            zy('ㄇ', 'a', 'KeyA'),
            zy('ㄋ', 's', 'KeyS'),
            zy('ㄎ', 'd', 'KeyD'),
            zy('ㄑ', 'f', 'KeyF'),
            zy('ㄕ', 'g', 'KeyG'),
            zy('ㄘ', 'h', 'KeyH'),
            zy('ㄨ', 'j', 'KeyJ'),
            zy('ㄚ', '8', 'Digit8'),
            zy('ㄟ', 'o', 'KeyO'),
            zy('ㄣ', 'p', 'KeyP'),
            spacer('zy-sp3', 1),
        ],
        [
            zy('ㄈ', 'z', 'KeyZ'),
            zy('ㄌ', 'x', 'KeyX'),
            zy('ㄏ', 'c', 'KeyC'),
            zy('ㄒ', 'v', 'KeyV'),
            zy('ㄖ', 'b', 'KeyB'),
            zy('ㄙ', 'n', 'KeyN'),
            zy('ㄩ', 'm', 'KeyM'),
            zy('ㄜ', 'k', 'KeyK'),
            zy('ㄠ', 'l', 'KeyL'),
            zy('ㄤ', ';', 'Semicolon'),
            spacer('zy-sp4', 1),
        ],
    ],
};
