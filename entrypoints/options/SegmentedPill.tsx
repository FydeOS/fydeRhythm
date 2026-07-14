import React, { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

// The sliding pill: a radiogroup whose selection springs between segments.
// Click, keyboard and drag/swipe all work. Shared by the appearance toggle
// (icons) and the letter-arrangement picker (words).

export interface PillOption<T extends string> {
    value: T;
    /** Accessible name, and the tooltip when the segment shows an icon. */
    label: string;
    content: React.ReactNode;
}

export interface SegmentedPillProps<T extends string> {
    options: Array<PillOption<T>>;
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    /** Segment box. Square for icons; wider for words. */
    width?: number;
    height?: number;
    /** Icon segments need their name on hover; word segments already say it. */
    tooltips?: boolean;
}

const kGap = 2;

export function SegmentedPill<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    width = 34,
    height = 34,
    tooltips = false,
}: SegmentedPillProps<T>) {
    const step = width + kGap;
    const n = options.length;
    const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

    const trackRef = useRef<HTMLDivElement | null>(null);
    const draggingRef = useRef(false);
    // Distinguishes a drag from a click so a drag ending on a segment doesn't
    // also trigger its onClick.
    const movedRef = useRef(false);
    const startXRef = useRef(0);
    const rectLeftRef = useRef(0);
    // Snapped slot under the pointer while dragging; null follows the selection.
    const [dragIndex, setDragIndex] = useState<number | null>(null);

    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const indexFromClientX = (clientX: number) =>
        clamp(Math.round((clientX - rectLeftRef.current - width / 2) / step), 0, n - 1);

    function onPointerDown(e: React.PointerEvent) {
        draggingRef.current = true;
        movedRef.current = false;
        startXRef.current = e.clientX;
        // Measured once per drag to keep pointermove reflow-free.
        rectLeftRef.current = trackRef.current?.getBoundingClientRect().left ?? 0;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: React.PointerEvent) {
        if (!draggingRef.current) return;
        if (Math.abs(e.clientX - startXRef.current) > 4) movedRef.current = true;
        if (movedRef.current) {
            const idx = indexFromClientX(e.clientX);
            setDragIndex((prev) => (prev === idx ? prev : idx));
        }
    }
    function endDrag(e: React.PointerEvent) {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
        if (movedRef.current) onChange(options[indexFromClientX(e.clientX)].value);
        setDragIndex(null);
    }

    const dragging = dragIndex != null;
    const litIndex = dragging ? dragIndex! : activeIndex;

    return (
        <Box
            role="radiogroup"
            aria-label={ariaLabel}
            sx={{
                p: '4px',
                borderRadius: '999px',
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.08)',
                display: 'inline-flex',
                flex: 'none',
            }}
        >
            <Box
                ref={trackRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                sx={{
                    position: 'relative',
                    display: 'inline-flex',
                    gap: `${kGap}px`,
                    touchAction: 'none',
                    userSelect: 'none',
                    cursor: dragging ? 'grabbing' : 'default',
                }}
            >
                <Box
                    aria-hidden
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width,
                        height,
                        borderRadius: '999px',
                        background: 'linear-gradient(135deg, #F5316E 0%, #E40046 100%)',
                        transform: `translateX(${litIndex * step}px) scale(${dragging ? 1.08 : 1})`,
                        boxShadow: dragging
                            ? '0 6px 16px rgba(228,0,70,0.44)'
                            : '0 3px 8px rgba(228,0,70,0.32)',
                        transition: 'transform .3s cubic-bezier(.34, 1.56, .64, 1), box-shadow .2s ease',
                        pointerEvents: 'none',
                    }}
                />
                {options.map((opt, i) => {
                    const selected = i === litIndex;
                    const segment = (
                        <Box
                            component="button"
                            type="button"
                            role="radio"
                            aria-checked={value === opt.value}
                            aria-label={opt.label}
                            onClick={() => { if (!movedRef.current) onChange(opt.value); }}
                            sx={{
                                position: 'relative',
                                zIndex: 1,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width,
                                height,
                                p: 0,
                                m: 0,
                                border: 0,
                                borderRadius: '999px',
                                cursor: dragging ? 'grabbing' : 'pointer',
                                appearance: 'none',
                                background: 'transparent',
                                outline: 'none',
                                touchAction: 'none',
                                WebkitTapHighlightColor: 'transparent',
                                font: 'inherit',
                                fontSize: '13px',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                color: selected ? '#fff' : 'text.secondary',
                                transition: 'color .25s ease',
                                '& svg': { transition: 'transform .3s cubic-bezier(.34, 1.56, .64, 1)' },
                                '&:hover': { color: selected ? '#fff' : 'text.primary' },
                                '&:hover svg': { transform: selected ? 'none' : 'scale(1.12)' },
                                '&:focus-visible': { boxShadow: '0 0 0 2px var(--mui-palette-primary-main)' },
                            }}
                        >
                            {opt.content}
                        </Box>
                    );
                    return tooltips
                        ? <Tooltip key={opt.value} title={opt.label} arrow>{segment}</Tooltip>
                        : <React.Fragment key={opt.value}>{segment}</React.Fragment>;
                })}
            </Box>
        </Box>
    );
}
