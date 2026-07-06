import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { InputViewCandidate, InputViewState, InputViewToBackground } from '@/lib/shared-types';
import { createHost } from './chrome-shim';
import { bottomRow, getLayerLayout, getLayout, layoutHostsPunctuation } from './layouts';
import type { AltDef, KeyAction, KeyDef, LayerId } from './layouts/types';
import { Key, type ShiftState } from './components/Key';
import { AltBubble } from './components/AltBubble';
import { CandidateBar } from './components/CandidateBar';
import { ExpandedPanel } from './components/ExpandedPanel';
import { DeleteConfirm, SchemaMenu } from './components/Popovers';
import { EmojiPanel } from './components/EmojiPanel';

type Popover =
    | { type: 'bubble'; alts: AltDef[]; anchor: DOMRect; pointerId: number }
    | { type: 'confirm'; candidate: InputViewCandidate; anchor: DOMRect }
    | { type: 'menu'; anchor: DOMRect }
    | null;

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
};

export default function App() {
    const host = useMemo(createHost, []);
    const postRef = useRef<((msg: InputViewToBackground) => void) | null>(null);

    const [vk, setVk] = useState<InputViewState | null>(null);
    const [candidates, setCandidates] = useState<InputViewCandidate[]>([]);
    const [schemas, setSchemas] = useState<Array<{ id: string; label: string }>>([]);
    const [layer, setLayer] = useState<LayerId>('main');
    const [shift, setShift] = useState<ShiftState>('off');
    const [expanded, setExpanded] = useState(false);
    const [popover, setPopover] = useState<Popover>(null);
    const [containerReady, setContainerReady] = useState(false);
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

        const onVisibility = () => {
            post({ kind: 'visibility', visible: !document.hidden });
            // Re-assert our docked geometry when re-shown: another IME may have
            // switched the shared VK container (e.g. to floating) in between.
            if (!document.hidden) void host.setupContainer(keyboardHeight());
        };
        document.addEventListener('visibilitychange', onVisibility);

        void host.setupContainer(keyboardHeight()).then(() => setContainerReady(true));
        const onOrientation = () => void host.setupContainer(keyboardHeight());
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

    const performAction = (action: KeyAction) => {
        switch (action.type) {
            case 'stroke':
                host.typeStroke(action.stroke);
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

    if (!vk) {
        return <div className="kb-root" />;
    }

    const activeLayoutId = vk.asciiMode ? vk.latinLayout : vk.layout;
    const layout = layer === 'main'
        ? getLayout(activeLayoutId, vk.asciiMode)
        : layer === 'emoji' ? null : getLayerLayout(layer, vk.asciiMode);
    const bottom = bottomRow({
        layer,
        asciiMode: vk.asciiMode,
        spaceLabel: vk.schemaName,
        layoutHasPunctuation: layoutHostsPunctuation(activeLayoutId),
        script: vk.script,
    });

    return (
        <div className="kb-root">
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
                        const units = (row: typeof bottom) => row.reduce((s, k) => s + (k.width ?? 1), 0);
                        const maxUnits = Math.max(...layout!.rows.map(units), units(bottom));
                        const cell = (def: (typeof bottom)[number]) => ({
                            width: `${((def.width ?? 1) / maxUnits) * 100}%`,
                        });
                        return (
                            <>
                                {layout!.rows.map((row, i) => (
                                    <div className="kb-row" key={`${layout!.id}-${i}`}>
                                        {row.map((def) => (
                                            <div className="kb-cell" key={def.id} style={cell(def)}>
                                                <Key
                                                    def={def}
                                                    shift={shift}
                                                    active={def.id === 'Shift' && shift !== 'off'}
                                                    onAction={performAction}
                                                    onOpenBubble={openBubble}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ))}
                                <div className="kb-row">
                                    {bottom.map((def) => (
                                        <div className="kb-cell" key={def.id} style={cell(def)}>
                                            <Key
                                                def={def}
                                                shift={shift}
                                                active={def.id === 'ascii-toggle' && !vk.asciiMode}
                                                onAction={performAction}
                                                onOpenBubble={openBubble}
                                                onLongPressMenu={def.id === 'ascii-toggle' ? (_def, anchor) => openSchemaMenu(anchor) : undefined}
                                            />
                                        </div>
                                    ))}
                                </div>
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
        </div>
    );
}
