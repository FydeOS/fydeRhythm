import React, { useEffect, useMemo, useRef, useState } from 'react';
import { kLatinLayoutIds, type InputViewCandidate, type InputViewState, type InputViewToBackground, type LatinLayoutId } from '@/lib/shared-types';
import { strokeForChar } from '@/lib/latin-remap';
import { createHost, kFloatingScaleMin, kFloatingScaleMax, type ContainerGeometry } from './chrome-shim';
import { t } from './i18n';
import { bottomRow, getLayerLayout, getLayout, layoutHostsPunctuation, numpadLayout } from './layouts';
import type { AltDef, KeyAction, KeyDef, LayerId } from './layouts/types';
import { Key, type ShiftState } from './components/Key';
import { AltBubble } from './components/AltBubble';
import { CandidateBar } from './components/CandidateBar';
import { ExpandedPanel } from './components/ExpandedPanel';
import { DeleteConfirm, KeyboardModeMenu, SchemaMenu } from './components/Popovers';
import { EmojiPanel } from './components/EmojiPanel';
import { ResizeGripIcon } from './components/icons';

type Popover =
    | { type: 'bubble'; alts: AltDef[]; anchor: DOMRect; pointerId: number }
    | { type: 'confirm'; candidate: InputViewCandidate; anchor: DOMRect }
    | { type: 'menu'; anchor: DOMRect }
    | { type: 'kbmode'; anchor: DOMRect }
    | null;

type FloatingPos = { left: number; top: number };

function readWindowPos(): FloatingPos {
    return { left: window.screenX, top: window.screenY };
}

// Floating = docked keyboard scaled uniformly (aspect always matches docked);
// `pos` places the window, null centres it.
function geomFor(floating: boolean, scale: number, pos?: FloatingPos | null): ContainerGeometry {
    const dockedH = keyboardHeight();
    return floating
        ? { floating: true, width: Math.round(window.screen.width * scale), height: Math.round(dockedH * scale), left: pos?.left, top: pos?.top }
        : { floating: false, width: window.screen.width, height: dockedH };
}

// Docked keyboard height. The legacy keyboard was a fixed 372px and users are
// calibrated to it, so that is the floor; larger screens scale up to 42% of
// screen height, capped. (Earlier cuts at 260/300px read visibly too short.)
function keyboardHeight(): number {
    return Math.max(372, Math.min(Math.round(window.screen.height * 0.42), 440));
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
    const [schemas, setSchemas] = useState<Array<{ id: string; label: string }>>([]);
    const [layer, setLayer] = useState<LayerId>('main');
    // On a numeric field, the user tapped ABC to see the letter keyboard.
    const [numericLetters, setNumericLetters] = useState(false);
    const [shift, setShift] = useState<ShiftState>('off');
    const [expanded, setExpanded] = useState(false);
    const [popover, setPopover] = useState<Popover>(null);
    const [containerReady, setContainerReady] = useState(false);
    const [floating, setFloating] = useState(false);
    const [floatingScale, setFloatingScale] = useState(1);
    // Mirrors for the once-on-mount handlers (visibility/orientation) and the
    // resize gesture, which would otherwise capture stale state.
    const floatingRef = useRef(false);
    const floatingScaleRef = useRef(1);
    // Last known floating window position (null = never placed → centre it).
    const floatingPosRef = useRef<FloatingPos | null>(null);
    // Active corner-grip drag: start pointer-x, scale, window position, and card
    // width — the top-right corner is held fixed so it grows toward lower-left.
    const resizeStart = useRef<{ x: number; scale: number; pos: FloatingPos; width: number } | null>(null);
    const resizeRaf = useRef(false);
    const loadedSignaled = useRef(false);
    const lastShiftTap = useRef(0);
    // Candidate count when the last load-more was posted; avoids re-posting for
    // the same tail while the engine is still iterating.
    const loadMoreMark = useRef(-1);

    const post = (msg: InputViewToBackground) => postRef.current?.(msg);

    useEffect(() => {
        postRef.current = host.connect((msg) => {
            switch (msg.kind) {
                case 'state':
                    setVk(msg.state);
                    break;
                case 'candidates':
                    setCandidates(msg.candidates);
                    if (msg.candidates.length === 0) {
                        setExpanded(false);
                        loadMoreMark.current = -1;
                    }
                    break;
                case 'schemaList':
                    setSchemas(msg.schemas);
                    break;
            }
        });
        post({ kind: 'visibility', visible: true });

        // Re-assert geometry, keeping a floating keyboard where it sits.
        const resetContainer = () => {
            if (floatingRef.current) {
                const pos = readWindowPos();
                floatingPosRef.current = pos;
                return host.setupContainer(geomFor(true, floatingScaleRef.current, pos));
            }
            return host.setupContainer(geomFor(false, floatingScaleRef.current));
        };

        const onVisibility = () => {
            post({ kind: 'visibility', visible: !document.hidden });
            if (document.hidden) {
                // Remember where a floating keyboard was before it hides.
                if (floatingRef.current) {
                    const pos = readWindowPos();
                    floatingPosRef.current = pos;
                    host.writeFloatingPrefs({ floating: true, scale: floatingScaleRef.current, left: pos.left, top: pos.top });
                }
            } else {
                void resetContainer();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        // Restore saved placement before the first setup. Uses the saved
        // position (null → centre), not the live pos, which isn't placed yet.
        void host.readFloatingPrefs().then((prefs) => {
            floatingRef.current = prefs.floating;
            floatingScaleRef.current = prefs.scale;
            floatingPosRef.current = prefs.left !== undefined && prefs.top !== undefined
                ? { left: prefs.left, top: prefs.top }
                : null;
            setFloating(prefs.floating);
            setFloatingScale(prefs.scale);
            void host.setupContainer(geomFor(prefs.floating, prefs.scale, floatingPosRef.current)).then(() => setContainerReady(true));
        });
        const onOrientation = () => void resetContainer();
        window.screen.orientation?.addEventListener('change', onOrientation);

        // Never leave the keyboard blank: if no state arrives (background dead
        // or stuck), fall back to plain QWERTY. A later real state overwrites.
        const fallback = window.setTimeout(() => setVk((prev) => prev ?? kFallbackState), kFallbackStateMs);

        return () => {
            window.clearTimeout(fallback);
            document.removeEventListener('visibilitychange', onVisibility);
            window.screen.orientation?.removeEventListener('change', onOrientation);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const performAction = (action: KeyAction) => {
        switch (action.type) {
            case 'stroke':
                host.typeStroke(layoutStroke(action.stroke));
                if (shift === 'shift') setShift('off');
                break;
            case 'strokes':
                for (const s of action.strokes) host.typeStroke(layoutStroke(s));
                if (shift === 'shift') setShift('off');
                break;
            case 'commit':
                host.insertText(action.text);
                if (shift === 'shift') setShift('off');
                break;
            case 'shift': {
                const now = Date.now();
                if (shift === 'off') {
                    setShift(now - lastShiftTap.current < 350 ? 'caps' : 'shift');
                } else if (shift === 'shift') {
                    setShift(now - lastShiftTap.current < 350 ? 'caps' : 'off');
                } else {
                    setShift('off');
                }
                lastShiftTap.current = now;
                break;
            }
            case 'layer':
                setLayer(action.layer);
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
        post({ kind: 'selectCandidate', index });
    };

    const openBubble = (def: KeyDef, anchor: DOMRect, pointerId: number) => {
        if (def.alts?.length) {
            setPopover({ type: 'bubble', alts: def.alts, anchor, pointerId });
        }
    };

    const openSchemaMenu = (anchor: DOMRect) => {
        post({ kind: 'getSchemaList' });
        setPopover({ type: 'menu', anchor });
    };

    // iPadOS-style: a long-press on the hide key opens a dock/float menu (a
    // plain tap still hides). Applies the chosen placement and persists it.
    const setFloatingMode = (next: boolean) => {
        floatingRef.current = next;
        setFloating(next);
        const pos = floatingPosRef.current;
        host.writeFloatingPrefs({ floating: next, scale: floatingScaleRef.current, left: pos?.left, top: pos?.top });
        void host.setupContainer(geomFor(next, floatingScaleRef.current, next ? pos : null));
    };

    // Corner-grip drag scales the window, anchored at the top-left captured on
    // down; resizes coalesced per frame, size+pos persisted on up.
    const onResizeDown = (e: React.PointerEvent) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        resizeStart.current = { x: e.clientX, scale: floatingScaleRef.current, pos: readWindowPos(), width: geomFor(true, floatingScaleRef.current).width };
    };
    const onResizeMove = (e: React.PointerEvent) => {
        const start = resizeStart.current;
        if (!start) return;
        // Dragging left (clientX decreases) grows the keyboard.
        const next = Math.min(kFloatingScaleMax, Math.max(kFloatingScaleMin, start.scale + (start.x - e.clientX) / window.screen.width));
        floatingScaleRef.current = next;
        setFloatingScale(next);
        // Hold the top-right corner: new left = right edge − new width.
        const rightEdge = start.pos.left + start.width;
        floatingPosRef.current = { left: rightEdge - geomFor(true, next).width, top: start.pos.top };
        if (!resizeRaf.current) {
            resizeRaf.current = true;
            requestAnimationFrame(() => {
                resizeRaf.current = false;
                void host.setupContainer(geomFor(true, floatingScaleRef.current, floatingPosRef.current));
            });
        }
    };
    const onResizeUp = () => {
        if (!resizeStart.current) return;
        resizeStart.current = null;
        const pos = floatingPosRef.current;
        host.writeFloatingPrefs({ floating: true, scale: floatingScaleRef.current, left: pos?.left, top: pos?.top });
    };

    if (!vk) {
        return <div className="kb-root" />;
    }

    const activeLayoutId = vk.asciiMode ? vk.latinLayout : vk.layout;
    // Numeric field → numberpad, unless the user tapped ABC for letters.
    const numpad = layer === 'main' && vk.numericField && !numericLetters ? numpadLayout(vk.numericField) : null;
    const layout = numpad || layer === 'emoji'
        ? null
        : layer === 'main'
            ? getLayout(activeLayoutId, vk.asciiMode)
            : getLayerLayout(layer, vk.asciiMode);
    let bottom = bottomRow({
        layer,
        asciiMode: vk.asciiMode,
        spaceLabel: vk.schemaName,
        layoutHasPunctuation: layoutHostsPunctuation(activeLayoutId),
        script: vk.script,
    });
    // On the letters view of a numeric field, the ?123 key returns to the pad.
    if (vk.numericField && numericLetters && layer === 'main') {
        bottom = bottom.map((k) => k.id === 'to-sym'
            ? { id: 'to-numpad', label: '123', kind: 'function', action: { type: 'numericLetters', on: false }, width: k.width }
            : k);
    }
    const renderRows: KeyDef[][] | null = numpad
        ? numpad.rows
        : layout
            ? [...layout.rows, bottom]
            : null;

    const floatStyle = floating
        ? { width: geomFor(true, floatingScale).width, height: geomFor(true, floatingScale).height }
        : undefined;

    return (
        <div className={`kb-root${floating ? ' floating' : ''}`} style={floatStyle}>
            {floating && (
                // Visible counterpart of the OS draggable region.
                <div className="kb-handle" aria-hidden="true">
                    <span className="kb-grabber" />
                </div>
            )}
            {/* Announce candidate updates for screen readers (ChromeVox). */}
            <div aria-live="polite" className="sr-only">
                {candidates.length > 0 ? t('vk_candidates_announce', String(candidates.length)) : ''}
            </div>
            <CandidateBar
                candidates={candidates}
                onSelect={selectCandidate}
                onDeleteRequest={(candidate, anchor) => setPopover({ type: 'confirm', candidate, anchor })}
                onLoadMore={requestLoadMore}
                onExpand={() => { requestLoadMore(); setExpanded(true); }}
                onOpenSettings={() => host.openSettings()}
                onEmoji={() => setLayer('emoji')}
                onHide={() => host.hideKeyboard()}
                onSchemaMenu={openSchemaMenu}
            />
            <div className="kb-keys">
                {layer === 'emoji' ? (
                    <EmojiPanel
                        onInsert={(emoji) => host.insertText(emoji)}
                        onBack={() => setLayer('main')}
                        onBackspace={() => host.typeStroke({ key: 'Backspace', code: 'Backspace' })}
                    />
                ) : (
                    // Every key sits in a fixed-fraction cell of a shared unit grid,
                    // so letter keys are the same width on every row and short rows
                    // center with side margins — the Gboard alignment model. Rows
                    // must never stretch keys to fill the width.
                    (() => {
                        const rows = renderRows!;
                        const units = (row: KeyDef[]) => row.reduce((s, k) => s + (k.width ?? 1), 0);
                        const maxUnits = Math.max(...rows.map(units));
                        const cell = (def: KeyDef) => ({
                            width: `${((def.width ?? 1) / maxUnits) * 100}%`,
                        });
                        const gridId = numpad ? numpad.id : layout!.id;
                        return (
                            <>
                                {rows.map((row, i) => (
                                    <div className="kb-row" key={`${gridId}-${i}`}>
                                        {row.map((def) => (
                                            <div className="kb-cell" key={def.id} style={cell(def)}>
                                                <Key
                                                    def={def}
                                                    shift={shift}
                                                    active={
                                                        (def.id === 'Shift' && shift !== 'off') ||
                                                        (def.id === 'ascii-toggle' && !vk.asciiMode)
                                                    }
                                                    onAction={performAction}
                                                    onOpenBubble={openBubble}
                                                    onLongPressMenu={
                                                        def.id === 'ascii-toggle' ? (_def, anchor) => openSchemaMenu(anchor)
                                                            : def.id === 'hide' ? (_def, anchor) => setPopover({ type: 'kbmode', anchor })
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
                        onSelect={selectCandidate}
                        onDeleteRequest={(candidate, anchor) => setPopover({ type: 'confirm', candidate, anchor })}
                        onLoadMore={requestLoadMore}
                        onCollapse={() => setExpanded(false)}
                    />
                )}
            </div>
            {floating && (
                <button
                    className="kb-resize-grip"
                    aria-label={t('vk_resize_keyboard')}
                    onPointerDown={onResizeDown}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                    onPointerCancel={onResizeUp}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    <ResizeGripIcon />
                </button>
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
                    onPick={(id) => post({ kind: 'switchSchema', schemaId: id })}
                    onClose={() => setPopover(null)}
                />
            )}
            {popover?.type === 'kbmode' && (
                <KeyboardModeMenu
                    floating={floating}
                    anchor={popover.anchor}
                    onPick={setFloatingMode}
                    onClose={() => setPopover(null)}
                />
            )}
        </div>
    );
}
