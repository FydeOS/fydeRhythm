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

    it('frame anchors never move across layouts (Keyline grid map)', () => {
        for (const id of ['qwerty', 'colemak', 'dvorak'] as const) {
            for (const ascii of [false, true]) {
                const layout = getLayout(id, ascii);
                const [, , r3] = layout.rows;
                expect(r3[0].id, `${id}: Shift anchors row3 left`).toBe('Shift');
                expect(r3[r3.length - 1].id, `${id}: Backspace anchors row3 right`).toBe('Backspace');
                for (const row of layout.rows) {
                    expect(rowUnits(row), `${id}: row must total ${kFrameUnits} units`).toBeCloseTo(kFrameUnits, 5);
                }
            }
        }
    });

    it('every layout squares its rows to one unit basis', () => {
        for (const layout of allLayouts()) {
            const units = layout.units ?? kFrameUnits;
            for (const row of layout.rows) {
                expect(rowUnits(row), `${layout.id}: row must total ${units} units`).toBeCloseTo(units, 5);
            }
        }
    });

    it('letter cells share a width per row (positions stable across layouts)', () => {
        for (const id of ['qwerty', 'colemak', 'dvorak'] as const) {
            const layout = getLayout(id, false);
            layout.rows.forEach((row, i) => {
                const letters = row.filter((k) => k.action.type === 'stroke' && k.action.stroke.key.length === 1 && !k.kind);
                // Row 1 keeps the 1-unit letter column; rows 2/3 share what the
                // margins and anchors leave (1u for 9/7 letters, 0.9u for
                // Dvorak's ten, 7/9u for its bottom nine).
                const want = i === 0 ? 1 : i === 1 ? (kFrameUnits - 1) / letters.length : (kFrameUnits - 3) / letters.length;
                for (const key of letters) {
                    expect(key.width ?? 1, `${id}/${key.id}: letter cell width`).toBeCloseTo(want, 5);
                }
            });
        }
    });

    it('bottom row is valid in every context and scales to the layout basis', () => {
        for (const layer of ['main', 'sym', 'sym2'] as const) {
            for (const asciiMode of [false, true]) {
                const row = bottomRow({ layer, asciiMode, spaceLabel: '极光拼音', script: 'zh' });
                checkKeys([row], `bottom(${layer},ascii=${asciiMode})`);
                expect(rowUnits(row)).toBeCloseTo(kFrameUnits, 5);
                expect(row[row.length - 1].id, 'Enter anchors the bottom row right').toBe('Enter');
            }
        }
        // The wider grids get the same row scaled to their basis.
        const zhuyin = bottomRow({ layer: 'main', asciiMode: false, spaceLabel: 's', script: 'zh', units: 12 });
        expect(rowUnits(zhuyin)).toBeCloseTo(12, 5);
    });

    it('ASCII toggle badge follows the schema script (中/英, あ/A, 한/A)', () => {
        const badge = (script: 'zh' | 'ja' | 'ko', asciiMode: boolean) =>
            bottomRow({ layer: 'main', asciiMode, spaceLabel: 's', script })
                .find((k) => k.id === 'ascii-toggle')?.label;
        expect(badge('zh', false)).toBe('中');
        expect(badge('zh', true)).toBe('英');
        expect(badge('ja', false)).toBe('あ');
        expect(badge('ja', true)).toBe('A');
        expect(badge('ko', false)).toBe('한');
        expect(badge('ko', true)).toBe('A');
    });

    it('punctuation follows ASCII mode and sends the plain keystroke', () => {
        const bottom = (asciiMode: boolean) =>
            bottomRow({ layer: 'main', asciiMode, spaceLabel: 's', script: 'zh' });
        const zh = bottom(false).find((k) => k.id === 'Comma');
        const en = bottom(true).find((k) => k.id === 'Comma');
        expect(zh?.label).toBe('，');
        expect(en?.label).toBe(',');
        // Both send the same plain keystroke — the engine picks the width.
        expect(zh?.action.type === 'stroke' && zh.action.stroke.key).toBe(',');
        // ，。 live only on the bottom row; the letter frame never hosts them.
        expect(getLayout('qwerty', false).rows.flat().find((k) => k.id === 'Comma')).toBeUndefined();
        // Dvorak's row-1 punctuation cells follow ASCII mode the same way,
        // keeping the physical stroke under the CJK cap.
        const dv = (ascii: boolean) => getLayout('dvorak', ascii).rows[0];
        expect(dv(false).map((k) => k.label).slice(0, 3)).toEqual(['、', '，', '。']);
        expect(dv(true).map((k) => k.label).slice(0, 3)).toEqual(["'", ',', '.']);
        const cap = dv(false)[0];
        // The 、 cap sends backslash — where Rime's punctuator puts 顿号.
        expect(cap.action.type === 'stroke' && cap.action.stroke.key).toBe('\\');
    });
});

describe('kana layout (12-key)', () => {
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
        // jap_poly base spellings (kunrei): し=si, つ=tu, ふ=hu. Flick petals
        // are mirrored into alts, so byLabel covers the whole board.
        for (const [kana, romaji] of [
            ['あ', 'a'], ['し', 'si'], ['つ', 'tu'], ['ふ', 'hu'], ['ん', 'n'],
            ['を', 'wo'], ['ー', '-'], ['ゆ', 'yu'], ['ろ', 'ro'],
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

    it('小゛゜ cycles small/dakuten variants with jap_poly spellings', async () => {
        const { kanaModifyNext } = await import('../entrypoints/inputview/layouts/kana');
        expect(kanaModifyNext('つ')).toEqual({ kana: 'っ', romaji: 'xtu' });
        expect(kanaModifyNext('っ')).toEqual({ kana: 'づ', romaji: 'du' });
        expect(kanaModifyNext('づ')).toEqual({ kana: 'つ', romaji: 'tu' });
        expect(kanaModifyNext('は')).toEqual({ kana: 'ば', romaji: 'ba' });
        expect(kanaModifyNext('ば')).toEqual({ kana: 'ぱ', romaji: 'pa' });
        expect(kanaModifyNext('や')).toEqual({ kana: 'ゃ', romaji: 'xya' });
        expect(kanaModifyNext('ん')).toBeNull();
        // Every variant a cycle can produce must have a spelling, and every
        // cycle must wrap back to its base.
        for (const start of ['あ', 'う', 'か', 'さ', 'た', 'は', 'や', 'わ']) {
            let cur = start;
            let steps = 0;
            do {
                const next = kanaModifyNext(cur);
                expect(next, `${cur} must be in a cycle`).not.toBeNull();
                expect(next!.romaji, `${cur} → ${next!.kana}`).toMatch(/^[a-z-]+$/);
                cur = next!.kana;
                steps++;
            } while (cur !== start && steps < 5);
            expect(cur, `${start} cycle must wrap back`).toBe(start);
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
