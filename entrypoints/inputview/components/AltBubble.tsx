import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AltDef, KeyAction } from '../layouts/types';
import { t } from '../i18n';

export interface AltBubbleProps {
    alts: AltDef[];
    anchor: DOMRect;
    // Pointer that initiated the long-press; the bubble tracks it globally so
    // slide-and-release selection works. -1 means click-driven (no tracking).
    pointerId: number;
    onSelect: (action: KeyAction) => void;
    onClose: () => void;
}

const kItemWidth = 46; // nominal item pitch, used only for initial placement

export function AltBubble({ alts, anchor, pointerId, onSelect, onClose }: AltBubbleProps) {
    const [selected, setSelected] = useState(0);
    // Fresh copy of `selected` for the pointerup handler, whose effect closure
    // captures state (releasing without sliding should pick the default, 0).
    const selectedRef = useRef(0);
    const listRef = useRef<HTMLDivElement>(null);
    // Rect of each rendered item, measured once per open: slide selection must
    // follow the REAL boxes (multi-char alts are wider than the nominal pitch,
    // and a long alt list wraps onto a second row), and pointermove must not
    // re-read layout.
    const rectsRef = useRef<DOMRect[]>([]);

    // Keep the bubble on screen: above the key, centred on it, clamped. The
    // keyboard is its own OS window, so a bubble wider than the window is simply
    // cut off — the widest list (9 alts on "a") is 426px against a 420px
    // one-hand window. Cap the width and let the items wrap onto another row
    // instead of running off the edge.
    const style = useMemo(() => {
        const room = window.innerWidth - 8;
        const width = Math.min(alts.length * kItemWidth + 12, room);
        const left = Math.max(4, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 4));
        return { left, top: Math.max(4, anchor.top - 64), width, maxWidth: room };
    }, [alts.length, anchor]);

    // Wrapping makes the bubble taller than the one row `style` assumed, so it
    // can end up covering the key or hanging off the top. Re-seat it against its
    // real height, then measure the items where they finally sit.
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const height = el.getBoundingClientRect().height;
        const top = Math.max(4, Math.min(anchor.top - height - 6, window.innerHeight - height - 4));
        el.style.top = `${top}px`;
        rectsRef.current = Array.from(el.children).map((k) => k.getBoundingClientRect());
    }, [alts, anchor]);

    useEffect(() => {
        // Nearest item to the finger, in 2D: the list can wrap onto a second
        // row, so an x-only scan would pick the wrong row's alt.
        const indexAt = (x: number, y: number) => {
            const rects = rectsRef.current;
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                const dx = Math.max(r.left - x, 0, x - r.right);
                const dy = Math.max(r.top - y, 0, y - r.bottom);
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = i;
                }
            }
            return best;
        };
        const move = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            const idx = indexAt(e.clientX, e.clientY);
            selectedRef.current = idx;
            setSelected(idx);
        };
        const up = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            onSelect(alts[selectedRef.current].action);
            onClose();
        };
        const cancel = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            onClose();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, [alts, onClose, onSelect, pointerId]);

    return (
        <div className="kb-bubble" role="listbox" aria-label={t('vk_alt_characters')} style={style} ref={listRef}>
            {alts.map((alt, i) => (
                <button
                    key={alt.label}
                    type="button"
                    role="option"
                    aria-selected={i === selected}
                    className={`alt${i === selected ? ' selected' : ''}`}
                    onClick={() => {
                        // Click-driven path (skin-tone bubble opened without a
                        // tracked pointer).
                        onSelect(alt.action);
                        onClose();
                    }}
                >
                    {alt.label}
                </button>
            ))}
        </div>
    );
}
