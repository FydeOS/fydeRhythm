import React, { useEffect, useMemo, useState } from 'react';
import type { AltDef, KeyAction } from '../layouts/types';

export interface AltBubbleProps {
    alts: AltDef[];
    anchor: DOMRect;
    // Pointer that initiated the long-press; the bubble tracks it globally so
    // slide-and-release selection works. -1 means click-driven (no tracking).
    pointerId: number;
    onSelect: (action: KeyAction) => void;
    onClose: () => void;
}

const kItemWidth = 46; // .alt min-width + gap, used for slide selection math

export function AltBubble({ alts, anchor, pointerId, onSelect, onClose }: AltBubbleProps) {
    const [selected, setSelected] = useState(0);

    // Keep the bubble on screen: start above the key, centred, clamped.
    const style = useMemo(() => {
        const width = alts.length * kItemWidth + 12;
        const left = Math.max(4, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 4));
        const top = Math.max(4, anchor.top - 64);
        return { left, top, minWidth: width };
    }, [alts.length, anchor]);

    useEffect(() => {
        const move = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            const idx = Math.floor((e.clientX - style.left - 6) / kItemWidth);
            setSelected(Math.max(0, Math.min(alts.length - 1, idx)));
        };
        const up = (e: PointerEvent) => {
            if (pointerId !== -1 && e.pointerId !== pointerId) return;
            const idx = Math.floor((e.clientX - style.left - 6) / kItemWidth);
            if (idx >= 0 && idx < alts.length) {
                onSelect(alts[Math.max(0, idx)].action);
            } else {
                onSelect(alts[selected].action);
            }
            onClose();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', onClose);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', onClose);
        };
    }, [alts, onClose, onSelect, pointerId, selected, style.left]);

    return (
        <div className="kb-bubble" style={style}>
            {alts.map((alt, i) => (
                <div key={alt.label} className={`alt${i === selected ? ' selected' : ''}`}>
                    {alt.label}
                </div>
            ))}
        </div>
    );
}
