import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyPress, kDefaultPressTiming, type PressUpdate } from '../gestures/press';
import type { KeyAction, KeyDef } from '../layouts/types';
import { t } from '../i18n';
import { BackspaceIcon, CapsLockIcon, EnterIcon, KeyboardHideIcon, ShiftFilledIcon, ShiftIcon } from './icons';

export type ShiftState = 'off' | 'shift' | 'caps';

export interface KeyProps {
    def: KeyDef;
    shift: ShiftState;
    onAction: (action: KeyAction) => void;
    // Long-press with alts: hand the interaction over to the bubble layer.
    onOpenBubble: (def: KeyDef, anchor: DOMRect, pointerId: number) => void;
    // Special long-press surfaces (schema menu on the 中/英 key).
    onLongPressMenu?: (def: KeyDef, anchor: DOMRect) => void;
    // Highlight as active (中/英 key reflecting ASCII mode, shift when engaged).
    active?: boolean;
}

// Whether the magnified press preview makes sense for this key.
function hasPreview(def: KeyDef): boolean {
    return (def.kind ?? 'normal') === 'normal' && def.label.length <= 2;
}

// Preview box above the key, clamped INSIDE the window: the keyboard is its
// own ChromeOS window, so anything positioned past its edges is simply cut
// off — top-row previews must slide down over the key instead.
function previewStyle(anchor: DOMRect): React.CSSProperties {
    // Key-sized, not magnified — an oversized preview reads as a heavy box.
    const width = anchor.width;
    const height = anchor.height;
    return {
        left: Math.max(4, Math.min(anchor.left, window.innerWidth - width - 4)),
        top: Math.max(4, anchor.top - height - 6),
        width,
        height,
    };
}

// i18n keys for keys whose visible label is an icon or an internal id.
const kAriaKeys: Record<string, string> = {
    Shift: 'vk_key_shift',
    Backspace: 'vk_key_backspace',
    Enter: 'vk_key_enter',
    Space: 'vk_key_space',
    hide: 'vk_key_hide',
    'to-sym': 'vk_key_symbols',
    'to-sym2': 'vk_key_more_symbols',
    'to-main': 'vk_key_letters',
    'ascii-toggle': 'vk_key_toggle_language',
};

export function Key({ def, shift, onAction, onOpenBubble, onLongPressMenu, active }: KeyProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const [pressed, setPressed] = useState(false);
    const machineRef = useRef<KeyPress | null>(null);
    const timerRef = useRef<number | null>(null);
    // Key rect captured once per press: pointermove fires dozens of times and
    // the preview renders repeatedly — neither should hit layout again.
    const pressRect = useRef<DOMRect | null>(null);

    const shifted = shift !== 'off';
    const label = shifted && def.shiftLabel ? def.shiftLabel : def.label;
    const action = shifted && def.shiftAction ? def.shiftAction : def.action;
    const wantsMenu = !!onLongPressMenu;
    const hasAlts = (def.alts?.length ?? 0) > 0 || wantsMenu;

    const clearTimer = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    useEffect(() => clearTimer, []);

    const apply = (update: PressUpdate, pointerId?: number) => {
        for (const effect of update.effects) {
            if (effect === 'activate') {
                onAction(action);
            } else if (effect === 'openBubble') {
                const anchor = pressRect.current;
                if (anchor) {
                    if (pointerId !== undefined) {
                        try {
                            ref.current?.releasePointerCapture(pointerId);
                        } catch { /* pointer already gone */ }
                    }
                    if (wantsMenu) {
                        onLongPressMenu(def, anchor);
                    } else {
                        onOpenBubble(def, anchor, pointerId ?? -1);
                    }
                }
                setPressed(false);
            } else if (effect === 'release') {
                setPressed(false);
            }
        }
        clearTimer();
        if (update.timerMs !== null) {
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                const m = machineRef.current;
                if (m) apply(m.timer(), pointerId);
            }, update.timerMs);
        }
    };

    const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (def.kind === 'spacer') return;
        pressRect.current = e.currentTarget.getBoundingClientRect();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch { /* synthetic or already-released pointer */ }
        const machine = new KeyPress({
            hasAlts,
            repeat: !!def.repeat,
            ...kDefaultPressTiming,
        });
        machineRef.current = machine;
        setPressed(true);
        apply(machine.down(), e.pointerId);
    };

    const finish = (kind: 'up' | 'cancel') => {
        const m = machineRef.current;
        if (!m) return;
        machineRef.current = null;
        apply(kind === 'up' ? m.up() : m.cancel());
    };

    const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        const m = machineRef.current;
        if (!m || m.isBubbling) return;
        // Slide well off the key = cancel, so a mistaken press can be aborted.
        const r = pressRect.current;
        if (r && (e.clientX < r.left - 24 || e.clientX > r.right + 24
            || e.clientY < r.top - 32 || e.clientY > r.bottom + 32)) {
            finish('cancel');
        }
    };

    // Special keys draw icons — text glyphs (⌫/⇧/↵) render inconsistently
    // across device font stacks.
    const icon = (() => {
        switch (def.id) {
            case 'Shift':
                return shift === 'caps' ? <CapsLockIcon /> : shift === 'shift' ? <ShiftFilledIcon /> : <ShiftIcon />;
            case 'Backspace':
                return <BackspaceIcon />;
            case 'Enter':
                return <EnterIcon />;
            case 'hide':
                return <KeyboardHideIcon />;
            default:
                return null;
        }
    })();

    const classes = ['kb-key'];
    if (def.kind === 'function') classes.push('fn');
    if (def.kind === 'enter') classes.push('enter');
    if (def.kind === 'space') classes.push('space');
    if (def.kind === 'spacer') classes.push('spacer');
    if (pressed) classes.push('pressed');
    if (active) classes.push('active');
    if (def.id === 'Shift' && shift === 'caps') classes.push('caps');

    const anchor = pressed && hasPreview(def) ? pressRect.current : undefined;

    return (
        <button
            ref={ref}
            className={classes.join(' ')}
            aria-label={kAriaKeys[def.id] ? t(kAriaKeys[def.id]) : label}
            aria-hidden={def.kind === 'spacer' || undefined}
            tabIndex={def.kind === 'spacer' ? -1 : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => finish('up')}
            onPointerCancel={() => finish('cancel')}
            onKeyDown={(e) => {
                // Physical-keyboard activation for focus-ring users.
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (def.kind !== 'spacer') onAction(action);
                }
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {icon ?? <span className="glyph">{label}</span>}
            {def.hint && <span className="hint">{shifted ? '' : def.hint}</span>}
            {anchor && createPortal(
                <div
                    className="kb-preview"
                    style={previewStyle(anchor)}
                >
                    {label}
                </div>,
                document.body,
            )}
        </button>
    );
}
