import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { strokeForChar } from '@/lib/latin-remap';
import { type InputViewCandidate, type InputViewState, type InputViewToBackground, kLatinLayoutIds, type LatinLayoutId } from '@/lib/shared-types';

import { acceptCandidatePacket, type CandidateOrder } from './candidate-order';
import { createHost } from './chrome-shim';
import type { ClipboardHistoryItem, ClipboardReadResult } from './clipboard';
import { AltBubble } from './components/AltBubble';
import { CandidateBar } from './components/CandidateBar';
import { ClipboardPanel } from './components/ClipboardPanel';
import { EmojiPanel } from './components/EmojiPanel';
import { ExpandedPanel } from './components/ExpandedPanel';
import { ChevronLeftIcon, ChevronRightIcon, ExpandKeyboardIcon, ResizeGripIcon } from './components/icons';
import { Key, type ShiftState } from './components/Key';
import { DeleteConfirm, KeyboardModeMenu, SchemaMenu } from './components/Popovers';
import { t } from './i18n';
import { bottomRow, getLayerLayout, getLayout, numpadLayout } from './layouts';
import { kanaModifyNext } from './layouts/kana';
import { type AltDef, codeForChar, type KeyAction, type KeyDef, type LayerId } from './layouts/types';
import {
  geometryFor,
  type KeyboardMode,
  kFloatingScaleMax,
  kFloatingScaleMin,
  kOneHandRows,
  type OneHandSide,
  type Placement,
} from './placement';
import { tapShift, typeWithShift } from './shift-state';

type Popover
  = | { type: 'bubble'; alts: AltDef[]; anchor: DOMRect; pointerId: number }
    | { type: 'confirm'; candidate: InputViewCandidate; anchor: DOMRect }
    | { type: 'menu'; anchor: DOMRect }
    | { type: 'kbmode'; anchor: DOMRect }
    | null;

type FloatingPos = { left: number; top: number };
type InputPanel = 'emoji' | 'clipboard' | null;

function readWindowPos(): FloatingPos {
  return { left: window.screenX, top: window.screenY };
}

const kCandidatePageSize = 10;

// If the background can't produce a state at all (dead worker, first install),
// render a plain QWERTY keyboard after this delay rather than staying blank.
// A real state arriving later always wins.
const kFallbackStateMs = 1500;

const kFallbackState: InputViewState = {
  asciiMode: false,
  layout: 'qwerty',
  latinLayout: 'qwerty',
  script: 'zh',
  schemaId: '',
  schemaName: '',
  numericField: null,
};

export default function App() {
  const host = useMemo(createHost, []);
  const postRef = useRef<((msg: InputViewToBackground) => void) | null>(null);

  const [vk, setVk] = useState<InputViewState | null>(null);
  const [candidates, setCandidates] = useState<InputViewCandidate[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Ordering metadata is transient: keep it out of React state so accepting
  // a candidate packet causes only the candidate render itself.
  const candidateOrderRef = useRef<CandidateOrder | null>(null);
  const [schemas, setSchemas] = useState<Array<{ id: string; label: string }>>([]);
  const [layer, setLayer] = useState<LayerId>('main');
  const [panel, setPanel] = useState<InputPanel>(null);
  const [clipboardRequest, setClipboardRequest] = useState<Promise<ClipboardReadResult> | null>(null);
  // On a numeric field, the user tapped ABC to see the letter keyboard.
  const [numericLetters, setNumericLetters] = useState(false);
  const [shift, setShift] = useState<ShiftState>('off');
  const [expanded, setExpanded] = useState(false);
  const [popover, setPopover] = useState<Popover>(null);
  const [containerReady, setContainerReady] = useState(false);
  const [placementLoaded, setPlacementLoaded] = useState(false);
  const [mode, setMode] = useState<KeyboardMode>('docked');
  const [side, setSide] = useState<OneHandSide>('right');
  const [floatingScale, setFloatingScale] = useState(1);
  // Mirrors for the once-on-mount handlers (visibility/orientation) and the
  // resize gesture, which would otherwise capture stale state.
  const modeRef = useRef<KeyboardMode>('docked');
  const sideRef = useRef<OneHandSide>('right');
  const floatingScaleRef = useRef(1);
  // Rows in the layout on screen (0 = no layout yet). The card is sized from
  // the key up, so its height depends on this; 0 holds a one-hand card back
  // until the first layout arrives rather than placing it at the wrong height
  // and resizing under the user. It is STATE, not just a ref: the card's own
  // inline size is computed from it during render, and a ref written in an
  // effect would leave the card a render behind the window it sits in.
  const [rows, setRows] = useState(0);
  const rowsRef = useRef(0);
  const placementLoadedRef = useRef(false);
  // Geometry last handed to the OS, so a re-render that changes nothing about
  // the card doesn't re-place the window.
  const appliedRef = useRef('');
  // Last known floating window position (null = never placed → centre it).
  // One-hand ignores it: geometryFor pins that card to a corner.
  const floatingPosRef = useRef<FloatingPos | null>(null);
  // Active corner-grip drag: start pointer-x, scale, window position, and card
  // width — the top-right corner is held fixed so it grows toward lower-left.
  const resizeStart = useRef<{ x: number; scale: number; pos: FloatingPos } | null>(null);
  const resizeRaf = useRef(false);
  const loadedSignaled = useRef(false);
  const lastShiftTap = useRef(0);
  // The last kana typed and the length of its romaji, so 小゛゜ can replace
  // it in the composition. Anything else typed or picked resets it.
  const lastKana = useRef<{ kana: string; len: number } | null>(null);
  // Candidate count when the last load-more was posted; avoids re-posting for
  // the same tail while the engine is still iterating.
  const loadMoreMark = useRef(-1);

  const post = (msg: InputViewToBackground) => postRef.current?.(msg);
  const readClipboard = useCallback(() => host.readClipboard(), [host]);
  const pasteClipboardItem = useCallback((item: ClipboardHistoryItem) =>
    host.pasteClipboardItem(item), [host]);
  const deleteClipboardItem = useCallback((itemId: string) => host.deleteClipboardItem(itemId), [host]);
  const subscribeClipboard = useCallback((refresh: () => void) => host.subscribeClipboard(refresh), [host]);

  // Placement read off the mirrors, so the mount-only handlers and the resize
  // gesture always see the live values. `over` applies a not-yet-committed
  // change (the mode being picked, the side being swapped).
  const placement = (over: Partial<Placement> = {}): Placement => ({
    mode: modeRef.current,
    scale: floatingScaleRef.current,
    side: sideRef.current,
    left: floatingPosRef.current?.left,
    top: floatingPosRef.current?.top,
    ...over,
  });
  const geom = (over: Partial<Placement> = {}) =>
    geometryFor(placement(over), window.screen, rowsRef.current || kOneHandRows);

  useEffect(() => {
    postRef.current = host.connect((msg) => {
      switch (msg.kind) {
        case 'state':
          setVk(msg.state);
          break;
        case 'candidates': {
          const accepted = acceptCandidatePacket(candidateOrderRef.current, msg);
          if (!accepted) break;
          candidateOrderRef.current = accepted.order;
          setCandidates(accepted.candidates);
          setHighlightedIndex(accepted.highlightedIndex);
          if (accepted.collapseExpanded) {
            setExpanded(false);
            loadMoreMark.current = -1;
          }
          break;
        }
        case 'schemaList':
          setSchemas(msg.schemas);
          break;
      }
    });
    post({ kind: 'visibility', visible: true });

    // Re-assert geometry, keeping a floating keyboard where it sits. (A
    // one-hand card is re-pinned to its corner, which is what we want after
    // a rotation.)
    const resetContainer = () => {
      if (modeRef.current === 'floating') floatingPosRef.current = readWindowPos();
      const next = geom();
      appliedRef.current = JSON.stringify(next);
      return host.setupContainer(next);
    };

    const onVisibility = () => {
      post({ kind: 'visibility', visible: !document.hidden });
      // Before the stored placement lands, the refs still say "docked" —
      // re-asserting that would place the wrong container.
      if (!placementLoadedRef.current) return;
      if (document.hidden) {
        // Remember where a floating keyboard was before it hides.
        if (modeRef.current === 'floating') {
          floatingPosRef.current = readWindowPos();
          host.writePlacement(placement());
        }
      }
      else {
        void resetContainer();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Restore saved placement; the effect below performs the setup, once it
    // knows enough to size the card.
    void host.readPlacement().then((prefs) => {
      modeRef.current = prefs.mode;
      sideRef.current = prefs.side;
      floatingScaleRef.current = prefs.scale;
      floatingPosRef.current = prefs.left !== undefined && prefs.top !== undefined
        ? { left: prefs.left, top: prefs.top }
        : null;
      setMode(prefs.mode);
      setSide(prefs.side);
      setFloatingScale(prefs.scale);
      placementLoadedRef.current = true;
      setPlacementLoaded(true);
    });
    const onOrientation = () => void resetContainer();
    window.screen.orientation?.addEventListener('change', onOrientation);

    // screen.* can be stale when the orientation event fires; resize fires
    // after the OS actually resized. Dedup ends our own resizeTo echo.
    const onResize = () => {
      if (!placementLoadedRef.current || resizeStart.current || document.hidden) return;
      if (modeRef.current === 'floating') floatingPosRef.current = readWindowPos();
      const next = geom();
      const key = JSON.stringify(next);
      if (key === appliedRef.current) return;
      appliedRef.current = key;
      void host.setupContainer(next);
    };
    window.addEventListener('resize', onResize);

    // Never leave the keyboard blank: if no state arrives (background dead
    // or stuck), fall back to plain QWERTY. A later real state overwrites.
    const fallback = window.setTimeout(() => setVk(prev => prev ?? kFallbackState), kFallbackStateMs);

    return () => {
      window.clearTimeout(fallback);
      document.removeEventListener('visibilitychange', onVisibility);
      window.screen.orientation?.removeEventListener('change', onOrientation);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The keys on screen. Derived above the early return because the container
  // effect below sizes the one-hand card from the row count (zhuyin and kana
  // are 5 rows, the Latin layouts 4).
  const view = useMemo(() => {
    if (!vk) return null;
    const activeLayoutId = vk.asciiMode ? vk.latinLayout : vk.layout;
    // Numeric field → numberpad, unless the user tapped ABC for letters.
    const numpad = layer === 'main' && vk.numericField && !numericLetters ? numpadLayout(vk.numericField) : null;
    const layout = numpad || (layer === 'main'
      ? getLayout(activeLayoutId, vk.asciiMode)
      : getLayerLayout(layer));
    let bottom = bottomRow({
      layer,
      asciiMode: vk.asciiMode,
      spaceLabel: vk.schemaName,
      script: vk.script,
      units: layout.units,
    });
    // On the letters view of a numeric field, the ?123 key returns to the pad.
    if (vk.numericField && numericLetters && layer === 'main') {
      bottom = bottom.map(k => k.id === 'to-sym'
        ? { id: 'to-numpad', label: '123', kind: 'function', action: { type: 'numericLetters', on: false }, width: k.width } as KeyDef
        : k);
    }
    // Self-contained layouts (12-key kana) carry their own space/enter row.
    const rows: KeyDef[][] = numpad || layout.selfContained ? layout.rows : [...layout.rows, bottom];
    return { gridId: numpad ? numpad.id : layout.id, rows };
  }, [vk, layer, numericLetters]);

  // Panels use the active keys' row-derived geometry and replace the keys
  // without changing the keyboard's layout.
  const rowCount = view?.rows?.length ?? null;

  // Publish the row count for the render below and the effect after it. Both
  // must agree: the window is sized from this, and so is the card drawn inside
  // it. (zhuyin is 5 rows, the Latin layouts 4.)
  useEffect(() => {
    if (rowCount && rowCount !== rowsRef.current) {
      rowsRef.current = rowCount;
      setRows(rowCount);
    }
  }, [rowCount]);

  // Size and place the window. A one-hand card waits for the first layout,
  // because its height is derived from the row count — placing it early would
  // mean resizing it out from under the user a frame later.
  useEffect(() => {
    if (!placementLoaded) return;
    if (mode === 'onehand' && !rows) return;
    // The OS moves a floating window when the user drags the handle, and
    // tells us nothing. Re-read where it actually is before re-asserting
    // geometry, or we would teleport it back to wherever we last put it.
    if (mode === 'floating' && appliedRef.current) floatingPosRef.current = readWindowPos();
    const next = geom();
    const key = JSON.stringify(next);
    // Rows change on every layer switch, but only a one-hand card resizes
    // for them — don't re-place a window whose geometry hasn't moved.
    if (key === appliedRef.current) {
      setContainerReady(true);
      return;
    }
    appliedRef.current = key;
    void host.setupContainer(next).then(() => setContainerReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementLoaded, mode, side, rows, host]);

  // Tell Chrome to show the window only after the container mode is confirmed
  // AND the first keyboard has rendered — signaling earlier can flash a
  // blank/incorrectly-sized keyboard (the legacy adapter waited for the
  // keyset switch for the same reason).
  useEffect(() => {
    if (vk && containerReady && !loadedSignaled.current) {
      loadedSignaled.current = true;
      host.keyboardLoaded();
    }
  }, [vk, containerReady, host]);

  // A new field starts on the numberpad, not wherever the last one was left.
  useEffect(() => { setNumericLetters(false); }, [vk?.numericField]);

  // The background remaps physical keys by POSITION (Colemak/Dvorak on
  // external keyboards). Our synthesized strokes travel the same path, so
  // for printable chars we must send the position whose remap yields the
  // intended char — otherwise the remap would double-apply to VK taps.
  const layoutStroke = (stroke: { key: string; code: string; shiftKey?: boolean }) => {
    if (!vk || stroke.key.length !== 1) return stroke;
    const remapLayout: LatinLayoutId = vk.asciiMode
      ? vk.latinLayout
      : (kLatinLayoutIds as readonly string[]).includes(vk.layout)
          ? vk.layout as LatinLayoutId
          : 'qwerty';
    if (remapLayout === 'qwerty') return stroke;
    const inverse = strokeForChar(remapLayout, stroke.key);
    if (!inverse) return stroke;
    return { key: stroke.key, code: inverse.code, ...(inverse.shiftKey ? { shiftKey: true } : {}) };
  };

  const dismissClipboard = () => {
    if (panel !== 'clipboard') return;
    setPanel(null);
    setClipboardRequest(null);
  };

  const performAction = (action: KeyAction) => {
    dismissClipboard();
    // 小゛゜ transforms the kana the previous action typed; every other
    // action starts a new one (or invalidates the tracking entirely).
    if (action.type !== 'kanaModify') lastKana.current = null;
    const finishTyping = () => {
      const next = typeWithShift({ mode: shift, lastTap: lastShiftTap.current });
      lastShiftTap.current = next.lastTap;
      if (next.mode !== shift) setShift(next.mode);
    };
    switch (action.type) {
      case 'stroke':
        host.typeStroke(layoutStroke(action.stroke));
        finishTyping();
        break;
      case 'strokes':
        for (const s of action.strokes) host.typeStroke(layoutStroke(s));
        if (action.kana) lastKana.current = { kana: action.kana, len: action.strokes.length };
        finishTyping();
        break;
      case 'kanaModify': {
        // Replace the last kana's romaji in the composition with its
        // next small/゛/゜ variant (は→ば→ぱ, つ→っ→づ, …).
        const last = lastKana.current;
        const next = last && kanaModifyNext(last.kana);
        if (last && next) {
          for (let i = 0; i < last.len; i++) {
            host.typeStroke({ key: 'Backspace', code: 'Backspace' });
          }
          for (const c of next.romaji) {
            host.typeStroke(layoutStroke({ key: c, code: codeForChar(c) }));
          }
          lastKana.current = { kana: next.kana, len: next.romaji.length };
        }
        break;
      }
      case 'convert':
        // Idle, a bare Down moves the text caret; only convert while composing.
        if (candidates.length > 0) host.typeStroke({ key: 'ArrowDown', code: 'ArrowDown' });
        break;
      case 'emoji':
        setPanel('emoji');
        break;
      case 'commit':
        host.insertText(action.text);
        finishTyping();
        break;
      case 'shift': {
        const now = Date.now();
        const next = tapShift({ mode: shift, lastTap: lastShiftTap.current }, now);
        lastShiftTap.current = next.lastTap;
        setShift(next.mode);
        break;
      }
      case 'layer':
        setLayer(action.layer);
        setPanel(null);
        setShift('off');
        break;
      case 'toggleAscii':
        if (vk) {
          // Optimistic flip; the engine echoes the real state back.
          setVk({ ...vk, asciiMode: !vk.asciiMode });
          post({ kind: 'setAsciiMode', asciiMode: !vk.asciiMode });
        }
        break;
      case 'hide':
        host.hideKeyboard();
        break;
      case 'numericLetters':
        setNumericLetters(action.on);
        break;
      case 'none':
        break;
    }
  };

  const requestLoadMore = () => {
    if (loadMoreMark.current === candidates.length) return;
    loadMoreMark.current = candidates.length;
    post({ kind: 'loadMoreCandidates', count: kCandidatePageSize });
  };

  const selectCandidate = (index: number) => {
    setPopover(null);
    lastKana.current = null;
    post({ kind: 'selectCandidate', index });
  };

  const openBubble = (def: KeyDef, anchor: DOMRect, pointerId: number) => {
    if (def.alts?.length) {
      dismissClipboard();
      setPopover({ type: 'bubble', alts: def.alts, anchor, pointerId });
    }
  };

  const openSchemaMenu = (anchor: DOMRect) => {
    dismissClipboard();
    post({ kind: 'getSchemaList' });
    setPopover({ type: 'menu', anchor });
  };

  const closePanel = () => {
    setPanel(null);
    setClipboardRequest(null);
    setLayer('main');
  };

  const openClipboard = () => {
    if (panel === 'clipboard') {
      closePanel();
      return;
    }
    setPopover(null);
    setClipboardRequest(readClipboard());
    setPanel('clipboard');
  };

  // iPadOS-style: a long-press on the hide key opens the placement menu (a
  // plain tap still hides). Applies the chosen mode and persists it.
  const setKeyboardMode = (next: KeyboardMode) => {
    // Capture where the OS actually left the card before leaving floating —
    // a drag of the handle fires no event, so this is the only chance to
    // learn about it, and persisting without it would throw the drag away.
    if (modeRef.current === 'floating') floatingPosRef.current = readWindowPos();
    modeRef.current = next;
    setMode(next);
    // A keyboard returning to float lands where it was left (the position is
    // kept across modes); docked and one-hand place themselves. The container
    // effect applies the new geometry.
    host.writePlacement(placement());
  };

  // Pin the one-hand keyboard to a bottom corner — the frequent gesture (you
  // switch hands far more often than you switch modes), so it gets permanent
  // buttons rather than a trip through the menu.
  const pinSide = (next: OneHandSide) => {
    if (next === sideRef.current) return;
    sideRef.current = next;
    setSide(next);
    host.writePlacement(placement());
  };

  // The resize button sits at the right end of the drag handle, so dragging it
  // right grows the keyboard and the top-left corner stays put — the card grows
  // the way the pointer is going. Resizes are coalesced per frame; size and
  // position are persisted on release.
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); }
    catch { /* synthetic */ }
    resizeStart.current = { x: e.screenX, scale: floatingScaleRef.current, pos: readWindowPos() };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const start = resizeStart.current;
    if (!start) return;
    // A missed pointerup (the OS can steal the pointer while it moves the
    // window) would otherwise leave the card resizing on plain hover.
    if (e.buttons === 0) { onResizeUp(); return; }
    // screenX, NOT clientX: growing the card can push it against the screen
    // edge, and the OS then slides the whole window left. A viewport-relative
    // x would read that as the finger moving, grow the card again, and run
    // the scale to its limit in a few frames.
    const next = Math.min(kFloatingScaleMax, Math.max(kFloatingScaleMin, start.scale + (e.screenX - start.x) / window.screen.width));
    floatingScaleRef.current = next;
    setFloatingScale(next);
    floatingPosRef.current = start.pos;
    if (!resizeRaf.current) {
      resizeRaf.current = true;
      requestAnimationFrame(() => {
        resizeRaf.current = false;
        const g = geom();
        appliedRef.current = JSON.stringify(g);
        void host.setupContainer(g);
      });
    }
  };
  const onResizeUp = () => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    host.writePlacement(placement());
  };

  if (!vk || !view) {
    return <div className="kb-root" />;
  }

  // The card is the window on device; only the mock tab, which has no OS
  // window to size it, needs the inline size.
  const card = host.mock && mode !== 'docked'
    ? geometryFor({ mode, scale: floatingScale, side }, window.screen, rows || kOneHandRows)
    : undefined;
  const cardStyle = card ? { width: card.width, height: card.height } : undefined;

  return (
    <div className={`kb-root${mode === 'docked' ? '' : ` ${mode}`}`} style={cardStyle}>
      {mode === 'floating' && (
      // The card's top strip: the visible counterpart of the OS drag
      // region, with the resize button parked at its right end. The
      // grip used to float over the bottom-left KEY, where it could
      // never line up with anything and covered ?123; here it sits in
      // chrome that is already reserved.
        <div className="kb-handle">
          <span className="kb-grabber" aria-hidden="true" />
          <button
            className="kb-resize-grip"
            aria-label={t('vk_resize_keyboard')}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onContextMenu={e => e.preventDefault()}
          >
            <ResizeGripIcon />
          </button>
        </div>
      )}
      {/* Announce candidate updates for screen readers (ChromeVox). */}
      <div aria-live="polite" className="sr-only">
        {candidates.length > 0 ? t('vk_candidates_announce', String(candidates.length)) : ''}
      </div>
      <CandidateBar
        candidates={candidates}
        highlightedIndex={highlightedIndex}
        onSelect={selectCandidate}
        onDeleteRequest={(candidate, anchor) => setPopover({ type: 'confirm', candidate, anchor })}
        onLoadMore={requestLoadMore}
        onExpand={() => { requestLoadMore(); setExpanded(true); }}
        onOpenSettings={() => { dismissClipboard(); host.openSettings(); }}
        onEmoji={() => { dismissClipboard(); setPanel('emoji'); }}
        onClipboard={openClipboard}
        activeTool={panel ?? undefined}
        onHide={() => { dismissClipboard(); host.hideKeyboard(); }}
        onModeMenu={(anchor) => { dismissClipboard(); setPopover({ type: 'kbmode', anchor }); }}
        onSchemaMenu={openSchemaMenu}
      />
      <div className="kb-keys">
        {panel === 'emoji' ? (
          <EmojiPanel
            onInsert={emoji => host.insertText(emoji)}
            onBack={closePanel}
            onBackspace={() => host.typeStroke({ key: 'Backspace', code: 'Backspace' })}
          />
        ) : panel === 'clipboard' && clipboardRequest ? (
          <ClipboardPanel
            initialRequest={clipboardRequest}
            onRead={readClipboard}
            onPaste={pasteClipboardItem}
            onDelete={deleteClipboardItem}
            onHistoryChange={subscribeClipboard}
            onClose={closePanel}
          />
        ) : (
        // Every key sits in a fixed-fraction cell of a shared unit grid,
        // so letter keys are the same width on every row and short rows
        // center with side margins — the Gboard alignment model. Rows
        // must never stretch keys to fill the width.
          (() => {
            const rows = view.rows!;
            const units = (row: KeyDef[]) => row.reduce((s, k) => s + (k.width ?? 1), 0);
            const maxUnits = Math.max(...rows.map(units));
            const cell = (def: KeyDef) => ({
              width: `${((def.width ?? 1) / maxUnits) * 100}%`,
            });
            const gridId = view.gridId;
            return (
              <>
                {rows.map((row, i) => (
                  <div className="kb-row" key={`${gridId}-${i}`}>
                    {row.map(def => (
                      <div className="kb-cell" key={def.id} style={cell(def)}>
                        <Key
                          def={def}
                          shift={shift}
                          active={
                            (def.id === 'Shift' && shift !== 'off')
                            || (def.id === 'ascii-toggle' && !vk.asciiMode)
                          }
                          onAction={performAction}
                          onOpenBubble={openBubble}
                          onLongPressMenu={
                            // Schema switcher: long-press 中/英 (the toolbar
                            // globe is the other path). Space long-press arms
                            // cursor mode instead — Gboard convention, Alex's
                            // call over the spec's §11 switcher.
                            def.id === 'ascii-toggle'
                              ? (_def, anchor) => openSchemaMenu(anchor)
                              : undefined
                          }
                          onCaretDrag={
                            // Spec §11 cursor control — off while composing:
                            // arrows navigate candidates in some schemas.
                            def.id === 'Space' && candidates.length === 0
                              ? dir => host.typeStroke(dir > 0
                                ? { key: 'ArrowRight', code: 'ArrowRight' }
                                : { key: 'ArrowLeft', code: 'ArrowLeft' })
                              : undefined
                          }
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </>
            );
          })()
        )}
        {expanded && (
          <ExpandedPanel
            candidates={candidates}
            highlightedIndex={highlightedIndex}
            onSelect={selectCandidate}
            onDeleteRequest={(candidate, anchor) => setPopover({ type: 'confirm', candidate, anchor })}
            onLoadMore={requestLoadMore}
            onCollapse={() => setExpanded(false)}
          />
        )}
      </div>
      {mode === 'onehand' && (
      // Spec control bar, under the keys where the working thumb
      // already is: ‹ › pin the card to a bottom corner, ⤢ expands
      // back to the docked keyboard.
        <div className="kb-onehand-bar">
          <button className="icon-btn" aria-label={t('vk_pin_left')} onClick={() => pinSide('left')}>
            <ChevronLeftIcon />
          </button>
          <button className="icon-btn" aria-label={t('vk_exit_onehand')} onClick={() => setKeyboardMode('docked')}>
            <ExpandKeyboardIcon />
          </button>
          <button className="icon-btn" aria-label={t('vk_pin_right')} onClick={() => pinSide('right')}>
            <ChevronRightIcon />
          </button>
        </div>
      )}
      {popover?.type === 'bubble' && (
        <AltBubble
          alts={popover.alts}
          anchor={popover.anchor}
          pointerId={popover.pointerId}
          onSelect={performAction}
          onClose={() => setPopover(null)}
        />
      )}
      {popover?.type === 'confirm' && (
        <DeleteConfirm
          text={popover.candidate.text}
          anchor={popover.anchor}
          onConfirm={() => {
            post({ kind: 'deleteCandidate', index: popover.candidate.index });
            setPopover(null);
          }}
          onCancel={() => setPopover(null)}
        />
      )}
      {popover?.type === 'menu' && (
        <SchemaMenu
          schemas={schemas.length > 0 ? schemas : [{ id: vk.schemaId, label: vk.schemaName }]}
          activeSchema={vk.schemaId}
          anchor={popover.anchor}
          onPick={id => post({ kind: 'switchSchema', schemaId: id })}
          onClose={() => setPopover(null)}
        />
      )}
      {popover?.type === 'kbmode' && (
        <KeyboardModeMenu
          mode={mode}
          anchor={popover.anchor}
          onPick={setKeyboardMode}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
