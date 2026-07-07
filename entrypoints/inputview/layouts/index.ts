import type { LatinLayoutId, LayoutId, ScriptId } from '@/lib/shared-types';
import { stroke, type KeyboardLayout, type KeyDef, type LayerId } from './types';
import { buildLatinLayout, commaKey, frameHasPunctuation, periodKey, type LatinFrameSpec } from './frame';
import { qwertySpec } from './qwerty';
import { colemakSpec } from './colemak';
import { dvorakSpec } from './dvorak';
import { zhuyinLayout } from './zhuyin';
import { kanaLayout } from './kana';
import { hangulLayout } from './hangul';
import { symLayout, sym2Layout } from './symbols';

export { numpadLayout } from './numpad';

const latinSpecs: Record<LatinLayoutId, LatinFrameSpec> = {
    qwerty: qwertySpec,
    colemak: colemakSpec,
    dvorak: dvorakSpec,
};

const staticLayouts: Partial<Record<LayoutId, KeyboardLayout>> = {
    zhuyin: zhuyinLayout,
    kana: kanaLayout,
    hangul: hangulLayout,
};

// Latin layouts are built on the shared physical frame per ASCII mode (the
// ，。/,. pair differs); non-Latin layouts are static data. Unknown ids fall
// back to QWERTY so a bad binding still yields a usable keyboard.
export function getLayout(id: LayoutId, ascii: boolean): KeyboardLayout {
    const spec = latinSpecs[id as LatinLayoutId];
    if (spec) return buildLatinLayout(spec, ascii);
    return staticLayouts[id] ?? buildLatinLayout(qwertySpec, ascii);
}

export function getLayerLayout(layer: 'sym' | 'sym2', ascii: boolean): KeyboardLayout {
    return layer === 'sym' ? symLayout(ascii) : sym2Layout(ascii);
}

// Whether the active layout hosts ，。 on its own row 3; when it doesn't
// (10-letter Dvorak rows, 注音/かな/한글), the bottom row hosts them.
export function layoutHostsPunctuation(id: LayoutId): boolean {
    const spec = latinSpecs[id as LatinLayoutId];
    return spec ? frameHasPunctuation(spec) : false;
}

// Every layout that can appear on screen, in both ASCII modes — the
// layout-validation tests iterate this, so new layouts get structural checks
// for free.
export function allLayouts(): KeyboardLayout[] {
    const result: KeyboardLayout[] = [];
    for (const spec of Object.values(latinSpecs)) {
        result.push(buildLatinLayout(spec, false), buildLatinLayout(spec, true));
    }
    result.push(...Object.values(staticLayouts) as KeyboardLayout[]);
    result.push(symLayout(false), symLayout(true), sym2Layout(false), sym2Layout(true));
    return result;
}

export interface BottomRowContext {
    // Which layer the bottom row sits under; decides the layer-toggle slot.
    layer: LayerId;
    asciiMode: boolean;
    // Painted on the space bar.
    spaceLabel: string;
    // Whether the active layout already hosts ，。 on row 3.
    layoutHasPunctuation: boolean;
    // Writing system of the active schema — decides the language badge on
    // the ASCII toggle. NOT derivable from the layout: romaji-driven Japanese
    // schemas use a qwerty layout but must still show あ/A.
    script: ScriptId;
}

// ASCII-toggle labels per script: shows the CURRENT mode.
function asciiToggleLabel(script: ScriptId, asciiMode: boolean): string {
    switch (script) {
        case 'ja':
            return asciiMode ? 'A' : 'あ';
        case 'ko':
            return asciiMode ? 'A' : '한';
        default:
            return asciiMode ? '英' : '中';
    }
}

// The shared bottom row. Slots are fixed across layouts and layers:
// [layer toggle][中/英][space][(，。ⁱᶠ ⁿᵉᵉᵈᵉᵈ)][hide]. Enter is NOT here —
// it is anchored at the frame's middle right like a physical keyboard.
export function bottomRow(ctx: BottomRowContext): KeyDef[] {
    const layerToggle: KeyDef = ctx.layer === 'main'
        ? { id: 'to-sym', label: '?123', kind: 'function', action: { type: 'layer', layer: 'sym' }, width: 2 }
        : { id: 'to-main', label: 'ABC', kind: 'function', action: { type: 'layer', layer: 'main' }, width: 2 };

    const asciiToggle: KeyDef = {
        id: 'ascii-toggle',
        label: asciiToggleLabel(ctx.script, ctx.asciiMode),
        kind: 'function',
        action: { type: 'toggleAscii' },
        width: 1.5,
    };

    const space: KeyDef = {
        id: 'Space',
        label: ctx.spaceLabel,
        kind: 'space',
        action: stroke(' ', 'Space'),
        width: ctx.layoutHasPunctuation ? 6 : 4,
    };

    const hide: KeyDef = {
        id: 'hide',
        label: '⌄',
        kind: 'function',
        action: { type: 'hide' },
        width: 2,
    };

    const row = [layerToggle, asciiToggle, space];
    if (!ctx.layoutHasPunctuation) {
        row.push(commaKey(ctx.asciiMode), periodKey(ctx.asciiMode));
    }
    row.push(hide);
    return row;
}
