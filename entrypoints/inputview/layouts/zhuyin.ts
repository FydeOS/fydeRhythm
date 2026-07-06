import { backspaceKey, shiftKey, stroke, type KeyboardLayout, type KeyDef } from './types';
import { enterKey } from './frame';

// 注音 (bopomofo), standard 大千 arrangement. Each key shows the bopomofo
// symbol but injects the underlying Latin/digit keystroke — the bopomofo
// schema in the Rime engine does the actual mapping, exactly as it would for
// a physical keyboard. Four symbol rows, so keys are shorter than QWERTY's
// three-row shape; that matches ChromeOS/Windows zhuyin virtual keyboards.
// Backspace/Enter are anchored right like the Latin frame (12.5-unit rows).

function zy(label: string, key: string, code: string): KeyDef {
    return { id: `zy-${code}`, label, action: stroke(key, code) };
}

function spacer(id: string, width: number): KeyDef {
    return { id, label: ' ', kind: 'spacer', action: { type: 'none' }, width };
}

export const zhuyinLayout: KeyboardLayout = {
    id: 'zhuyin',
    rows: [
        [
            zy('ㄅ', '1', 'Digit1'),
            zy('ㄉ', '2', 'Digit2'),
            zy('ˇ', '3', 'Digit3'),
            zy('ˋ', '4', 'Digit4'),
            zy('ㄓ', '5', 'Digit5'),
            zy('ˊ', '6', 'Digit6'),
            zy('˙', '7', 'Digit7'),
            zy('ㄚ', '8', 'Digit8'),
            zy('ㄞ', '9', 'Digit9'),
            zy('ㄢ', '0', 'Digit0'),
            zy('ㄦ', '-', 'Minus'),
            { ...backspaceKey, width: 1.5 },
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
            zy('ㄟ', 'o', 'KeyO'),
            zy('ㄣ', 'p', 'KeyP'),
            { ...enterKey, width: 2.5 },
        ],
        [
            spacer('zy-sp3a', 0.5),
            zy('ㄇ', 'a', 'KeyA'),
            zy('ㄋ', 's', 'KeyS'),
            zy('ㄎ', 'd', 'KeyD'),
            zy('ㄑ', 'f', 'KeyF'),
            zy('ㄕ', 'g', 'KeyG'),
            zy('ㄘ', 'h', 'KeyH'),
            zy('ㄨ', 'j', 'KeyJ'),
            zy('ㄜ', 'k', 'KeyK'),
            zy('ㄠ', 'l', 'KeyL'),
            zy('ㄤ', ';', 'Semicolon'),
            spacer('zy-sp3b', 2),
        ],
        [
            shiftKey,
            zy('ㄈ', 'z', 'KeyZ'),
            zy('ㄌ', 'x', 'KeyX'),
            zy('ㄏ', 'c', 'KeyC'),
            zy('ㄒ', 'v', 'KeyV'),
            zy('ㄖ', 'b', 'KeyB'),
            zy('ㄙ', 'n', 'KeyN'),
            zy('ㄩ', 'm', 'KeyM'),
            zy('ㄝ', ',', 'Comma'),
            zy('ㄡ', '.', 'Period'),
            zy('ㄥ', '/', 'Slash'),
            spacer('zy-sp4', 1),
        ],
    ],
};
