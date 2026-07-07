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
    // Right edge of each rendered item, measured once per open: slide
    // selection must follow the REAL widths (multi-char alts are wider than
    // the nominal pitch), and pointermove must not re-read layout.
    const edgesRef = useRef<number[]>([]);

    // Keep the bubble on screen: start above the key, centred, clamped.
    const style = useMemo(() => {
        const width = alts.length * kItemWidth + 12;
        const left = Math.max(4, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 4));
        const top = Math.max(4, anchor.top - 64);
        return { left, top, minWidth: width };
    }, [alts.length, anchor]);

    useLayoutEffect(() => {
        const kids = Array.from(listRef.current?.children ?? []) as HTMLElement[];
        edgesRef.current = kids.map((k) => k.getBoundingClientRect().right);
    }, [alts]);

    useEffect(() => {
        const indexAt = (x: number) => {
            const edges = edgesRef.current;
            for (let i = 0; i < edges.length; i++) {
                if (x < edges[i]) return i;
            }
            return edges.length - 1;
        };
        const move = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            const idx = Math.max(0, indexAt(e.clientX));
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
