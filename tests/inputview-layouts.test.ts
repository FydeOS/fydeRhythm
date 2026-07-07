import { describe, expect, it } from 'vitest';
import { allLayouts, bottomRow, getLayout } from '../entrypoints/inputview/layouts';
import { kFrameUnits } from '../entrypoints/inputview/layouts/frame';
import { codeForChar, type KeyAction, type KeyDef } from '../entrypoints/inputview/layouts/types';

// Structural validation for every registered layout. New layout files are
// picked up automatically via allLayouts(), so adding one gets these checks
// without writing a test.

// Characters on the shifted layer of a US physical keyboard. The system
// rebuilds typed characters from keyCode+modifiers, so these MUST be sent
// with the shift flag or they type the unshifted key ('@' → '2').
const kShiftedSymbols = new Set([...'~!@#$%^&*()_+{}|:"<>?']);

function checkAction(action: KeyAction, keyId: string) {
    if (action.type === 'stroke') {
        expect(action.stroke.key, `${keyId}: stroke.key must be set`).not.toBe('');
        // Specials carry a W3C name in `key`; printable chars must be 1 char.
        if (action.stroke.key.length > 1) {
            expect(action.stroke.code, `${keyId}: special stroke needs a code`).not.toBe('');
        }
        if (action.stroke.key.length === 1 && /[\x20-\x7e]/.test(action.stroke.key)) {
            const needsShift = kShiftedSymbols.has(action.stroke.key) || /^[A-Z]$/.test(action.stroke.key);
            expect(
                !!action.stroke.shiftKey,
                `${keyId}: '${action.stroke.key}' must ${needsShift ? '' : 'NOT '}carry shiftKey`,
            ).toBe(needsShift);
        }
    } else if (action.type === 'strokes') {
        expect(action.strokes.length, `${keyId}: strokes must be non-empty`).toBeGreaterThan(0);
        for (const s of action.strokes) {
            expect(s.key, `${keyId}: stroke.key must be set`).not.toBe('');
            expect(s.code, `${keyId}: stroke '${s.key}' needs a code`).not.toBe('');
        }
    } else if (action.type === 'commit') {
        expect(action.text.length, `${keyId}: commit text must be non-empty`).toBeGreaterThan(0);
    }
}

function checkKeys(keys: KeyDef[][], layoutId: string) {
    const ids = new Set<string>();
    for (const row of keys) {
        expect(row.length, `${layoutId}: empty row`).toBeGreaterThan(0);
        for (const key of row) {
            expect(ids.has(key.id), `${layoutId}: duplicate key id ${key.id}`).toBe(false);
            ids.add(key.id);
            if (key.kind !== 'spacer') {
                expect(key.label.trim().length, `${layoutId}/${key.id}: empty label`).toBeGreaterThan(0);
            }
            if (key.width !== undefined) {
                expect(key.width, `${layoutId}/${key.id}: non-positive width`).toBeGreaterThan(0);
            }
            checkAction(key.action, `${layoutId}/${key.id}`);
            if (key.shiftAction) checkAction(key.shiftAction, `${layoutId}/${key.id} (shift)`);
            if (key.alts) {
                expect(key.alts.length, `${layoutId}/${key.id}: empty alts array`).toBeGreaterThan(0);
                const altLabels = new Set(key.alts.map((a) => a.label));
                expect(altLabels.size, `${layoutId}/${key.id}: duplicate alt labels`).toBe(key.alts.length);
                for (const alt of key.alts) checkAction(alt.action, `${layoutId}/${key.id} alt ${alt.label}`);
            }
            if (key.hint && key.alts) {
                expect(key.alts[0].label, `${layoutId}/${key.id}: hint must be the first alt`).toBe(key.hint);
            }
        }
    }
}

const rowUnits = (row: KeyDef[]) => row.reduce((s, k) => s + (k.width ?? 1), 0);

describe('layout data', () => {
    for (const layout of allLayouts()) {
        it(`${layout.id} is structurally valid`, () => {
            expect(layout.rows.length).toBeGreaterThan(0);
            checkKeys(layout.rows, layout.id);
        });
    }

    it('latin frame anchors never move across layouts (物理框架)', () => {
        for (const id of ['qwerty', 'colemak', 'dvorak'] as const) {
            for (const ascii of [false, true]) {
                const layout = getLayout(id, ascii);
                const [r1, r2, r3] = layout.rows;
                expect(r1[r1.length - 1].id, `${id}: Backspace anchors row1 right`).toBe('Backspace');
                expect(r2[r2.length - 1].id, `${id}: Enter anchors row2 right`).toBe('Enter');
                expect(r3[0].id, `${id}: Shift anchors row3 left`).toBe('Shift');
                for (const row of layout.rows) {
                    expect(rowUnits(row), `${id}: row must total ${kFrameUnits} units`).toBeCloseTo(kFrameUnits, 5);
                }
            }
        }
    });

    it('letter cells are all 1 unit wide (positions stable across layouts)', () => {
        for (const id of ['qwerty', 'colemak', 'dvorak'] as const) {
            const layout = getLayout(id, false);
            for (const row of layout.rows) {
                for (const key of row) {
                    if (key.action.type === 'stroke' && key.action.stroke.key.length === 1 && !key.kind) {
                        expect(key.width ?? 1, `${id}/${key.id}: letter cell must be 1u`).toBe(1);
                    }
                }
            }
        }
    });

    it('bottom row is valid in every context and totals the frame width', () => {
        for (const layer of ['main', 'sym', 'sym2'] as const) {
            for (const asciiMode of [false, true]) {
                for (const layoutHasPunctuation of [false, true]) {
                    const row = bottomRow({ layer, asciiMode, spaceLabel: '极光拼音', layoutHasPunctuation, script: 'zh' });
                    checkKeys([row], `bottom(${layer},ascii=${asciiMode},punct=${layoutHasPunctuation})`);
                    expect(rowUnits(row)).toBeCloseTo(kFrameUnits, 5);
                }
            }
        }
    });

    it('ASCII toggle badge follows the schema script (中/英, あ/A, 한/A)', () => {
        const badge = (script: 'zh' | 'ja' | 'ko', asciiMode: boolean) =>
            bottomRow({ layer: 'main', asciiMode, spaceLabel: 's', layoutHasPunctuation: true, script })
                .find((k) => k.id === 'ascii-toggle')?.label;
        expect(badge('zh', false)).toBe('中');
        expect(badge('zh', true)).toBe('英');
        expect(badge('ja', false)).toBe('あ');
        expect(badge('ja', true)).toBe('A');
        expect(badge('ko', false)).toBe('한');
        expect(badge('ko', true)).toBe('A');
    });

    it('punctuation follows ASCII mode and sends the plain keystroke', () => {
        const zh = getLayout('qwerty', false).rows.flat().find((k) => k.id === 'Comma');
        const en = getLayout('qwerty', true).rows.flat().find((k) => k.id === 'Comma');
        expect(zh?.label).toBe('，');
        expect(en?.label).toBe(',');
        // Both send the same plain keystroke — the engine picks the width.
        expect(zh?.action.type === 'stroke' && zh.action.stroke.key).toBe(',');
        // Dvorak's full rows push ，。 to the bottom row instead.
        expect(getLayout('dvorak', false).rows.flat().find((k) => k.id === 'Comma')).toBeUndefined();
        const dvorakBottom = bottomRow({ layer: 'main', asciiMode: false, spaceLabel: 's', layoutHasPunctuation: false, script: 'zh' });
        expect(dvorakBottom.find((k) => k.id === 'Comma')?.label).toBe('，');
    });
});

describe('kana layout', () => {
    it('keys type romaji stroke sequences the jap_poly schema understands', async () => {
        const { kanaLayout } = await import('../entrypoints/inputview/layouts/kana');
        const romajiOf = (action: KeyAction) =>
            action.type === 'strokes' ? action.strokes.map((s) => s.key).join('') : null;
        const byLabel = new Map<string, KeyAction>();
        for (const row of kanaLayout.rows) {
            for (const key of row) {
                byLabel.set(key.label, key.action);
                for (const alt of key.alts ?? []) byLabel.set(alt.label, alt.action);
            }
        }
        // jap_poly base spellings (kunrei): し=si, つ=tu, ふ=hu; っ/small use x.
        for (const [kana, romaji] of [
            ['あ', 'a'], ['し', 'si'], ['つ', 'tu'], ['ふ', 'hu'], ['ん', 'n'],
            ['を', 'wo'], ['ー', '-'], ['っ', 'xtu'], ['ゃ', 'xya'], ['が', 'ga'], ['ぱ', 'pa'],
        ] as const) {
            expect(romajiOf(byLabel.get(kana)!), `${kana} must type "${romaji}"`).toBe(romaji);
        }
        // Every kana stroke must stay inside jap_poly's alphabet (a–z and -).
        for (const [label, action] of byLabel) {
            const romaji = romajiOf(action);
            if (romaji !== null) {
                expect(/^[a-z-]+$/.test(romaji), `${label}: '${romaji}' outside a–z/-`).toBe(true);
            }
        }
    });
});

describe('codeForChar', () => {
    it('maps letters, digits and shifted symbols', () => {
        expect(codeForChar('a')).toBe('KeyA');
        expect(codeForChar('Z')).toBe('KeyZ');
        expect(codeForChar('7')).toBe('Digit7');
        expect(codeForChar('!')).toBe('Digit1');
        expect(codeForChar('{')).toBe('BracketLeft');
    });

    it('returns an empty code for unmapped glyphs', () => {
        expect(codeForChar('§')).toBe('');
    });
});
