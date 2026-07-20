import type { LatinLayoutId, LayoutId, ScriptId } from '@/lib/shared-types';

import { colemakSpec } from './colemak';
import { dvorakSpec } from './dvorak';
import { buildLatinLayout, commaKey, enterKey, kFrameUnits, type LatinFrameSpec, periodKey } from './frame';
import { hangulLayout } from './hangul';
import { kanaLayout } from './kana';
import { qwertySpec } from './qwerty';
import { sym2Layout, symLayout } from './symbols';
import { type KeyboardLayout, type KeyDef, type LayerId, stroke } from './types';
import { zhuyinLayout } from './zhuyin';

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

// Latin layouts are built per ASCII mode (Dvorak's punctuation caps differ);
// non-Latin layouts are static data. Unknown ids fall back to QWERTY so a bad
// binding still yields a usable keyboard.
export function getLayout(id: LayoutId, ascii: boolean): KeyboardLayout {
  const spec = latinSpecs[id as LatinLayoutId];
  if (spec) return buildLatinLayout(spec, ascii);
  return staticLayouts[id] ?? buildLatinLayout(qwertySpec, ascii);
}

export function getLayerLayout(layer: 'sym' | 'sym2'): KeyboardLayout {
  return layer === 'sym' ? symLayout() : sym2Layout();
}

// Every layout that can appear on screen, in both ASCII modes — the
// layout-validation tests iterate this, so new layouts get structural checks
// for free.
export function allLayouts(): KeyboardLayout[] {
  return [
    ...Object.values(latinSpecs).flatMap(spec => [buildLatinLayout(spec, false), buildLatinLayout(spec, true)]),
    ...Object.values(staticLayouts) as KeyboardLayout[],
    symLayout(),
    sym2Layout(),
  ];
}

export interface BottomRowContext {
  // Which layer the bottom row sits under; decides the layer-toggle slot.
  layer: LayerId;
  asciiMode: boolean;
  // Painted on the space bar.
  spaceLabel: string;
  // Writing system of the active schema — decides the language badge on
  // the ASCII toggle. NOT derivable from the layout: romaji-driven Japanese
  // schemas use a qwerty layout but must still show あ/A.
  script: ScriptId;
  // Unit basis of the layout above (KeyboardLayout.units); the row's widths
  // are scaled to it so the spec's fractions hold on the wider grids.
  units?: number;
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

// The shared bottom row, the Keyline spec's fractions (§02):
// [layer toggle 1u][中/英 1u][，1u][space 4u][。1u][Enter 2u].
// Two amendments to the spec's drawing: the layer toggle sits in its ☺ slot
// (emoji is one tap away in the toolbar — a board with no symbols access is
// unusable), and there is no hide key (the toolbar's trailing button hides).
export function bottomRow(ctx: BottomRowContext): KeyDef[] {
  const layerToggle: KeyDef = ctx.layer === 'main'
    ? { id: 'to-sym', label: '?123', kind: 'function', action: { type: 'layer', layer: 'sym' }, width: 1 }
    : { id: 'to-main', label: 'ABC', kind: 'function', action: { type: 'layer', layer: 'main' }, width: 1 };

  const asciiToggle: KeyDef = {
    id: 'ascii-toggle',
    label: asciiToggleLabel(ctx.script, ctx.asciiMode),
    kind: 'function',
    action: { type: 'toggleAscii' },
    width: 1,
  };

  const space: KeyDef = {
    id: 'Space',
    label: ctx.spaceLabel,
    kind: 'space',
    action: stroke(' ', 'Space'),
    width: 4,
  };

  const row = [
    layerToggle,
    asciiToggle,
    commaKey(ctx.asciiMode),
    space,
    periodKey(ctx.asciiMode),
    { ...enterKey, width: 2 },
  ];
  const scale = (ctx.units ?? kFrameUnits) / kFrameUnits;
  return scale === 1 ? row : row.map(k => ({ ...k, width: (k.width ?? 1) * scale }));
}
