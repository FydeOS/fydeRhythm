import React, { useRef } from 'react';
import type { InputViewCandidate } from '@/lib/shared-types';
import { t } from '../i18n';
import { ChevronLeftIcon, ChevronRightIcon, ClipboardIcon, ExpandMoreIcon, KeyboardHideIcon, LanguageIcon, MoodIcon, SettingsIcon } from './icons';

export interface CandidateBarProps {
    candidates: InputViewCandidate[];
    onSelect: (index: number) => void;
    onDeleteRequest: (candidate: InputViewCandidate, anchor: DOMRect) => void;
    onLoadMore: () => void;
    onExpand: () => void;
    onOpenSettings: () => void;
    onEmoji: () => void;
    onClipboard: () => void;
    activeTool?: 'emoji' | 'clipboard';
    onHide: () => void;
    // Opens the placement menu anchored at the hide button (its long-press).
    onModeMenu: (anchor: DOMRect) => void;
    // Opens the schema menu anchored at the globe button.
    onSchemaMenu: (anchor: DOMRect) => void;
}

const kLongPressMs = 500;

// The toolbar's trailing button: tap hides the keyboard, long-press opens the
// placement menu — the pairing the bottom row's hide key used to carry before
// the spec's grid reclaimed its slot for Enter.
function HideButton({ onHide, onModeMenu }: { onHide: () => void; onModeMenu: (anchor: DOMRect) => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    const timer = useRef<number | null>(null);
    const longPressed = useRef(false);

    const clear = () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
    };

    return (
        <button
            ref={ref}
            className="icon-btn"
            aria-label={t('vk_key_hide')}
            aria-haspopup="menu"
            onPointerDown={() => {
                longPressed.current = false;
                clear();
                timer.current = window.setTimeout(() => {
                    timer.current = null;
                    longPressed.current = true;
                    const anchor = ref.current?.getBoundingClientRect();
                    if (anchor) onModeMenu(anchor);
                }, kLongPressMs);
            }}
            onPointerUp={() => {
                clear();
                if (!longPressed.current) onHide();
            }}
            onPointerCancel={clear}
            onPointerLeave={clear}
            onContextMenu={(e) => e.preventDefault()}
        >
            <KeyboardHideIcon />
        </button>
    );
}

// One candidate chip with tap-to-select and long-press-to-delete.
export function CandidateChip({ candidate, onSelect, onDeleteRequest }: {
    candidate: InputViewCandidate;
    onSelect: (index: number) => void;
    onDeleteRequest: (candidate: InputViewCandidate, anchor: DOMRect) => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const timer = useRef<number | null>(null);
    const longPressed = useRef(false);

    const clear = () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
    };

    return (
        <button
            ref={ref}
            className="kb-candidate"
            onPointerDown={() => {
                longPressed.current = false;
                clear();
                timer.current = window.setTimeout(() => {
                    timer.current = null;
                    longPressed.current = true;
                    const anchor = ref.current?.getBoundingClientRect();
                    if (anchor) onDeleteRequest(candidate, anchor);
                }, kLongPressMs);
            }}
            onPointerUp={() => {
                clear();
                if (!longPressed.current) onSelect(candidate.index);
            }}
            onPointerCancel={clear}
            onPointerLeave={clear}
            onContextMenu={(e) => e.preventDefault()}
        >
            <span className="glyph">{candidate.text}</span>
        </button>
    );
}

export function CandidateBar(props: CandidateBarProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    if (props.candidates.length === 0 || props.activeTool === 'clipboard') {
        return (
            <div className="kb-bar">
                <div className="kb-toolbar">
                    <button className="icon-btn" aria-label={t('vk_settings')} onClick={props.onOpenSettings}><SettingsIcon /></button>
                    <button
                        className={`icon-btn${props.activeTool === 'emoji' ? ' selected' : ''}`}
                        aria-label={t('vk_emoji')}
                        aria-pressed={props.activeTool === 'emoji'}
                        onClick={props.onEmoji}
                    >
                        <MoodIcon />
                    </button>
                    <button
                        className={`icon-btn${props.activeTool === 'clipboard' ? ' selected' : ''}`}
                        aria-label={t('vk_clipboard')}
                        aria-pressed={props.activeTool === 'clipboard'}
                        aria-expanded={props.activeTool === 'clipboard'}
                        aria-controls={props.activeTool === 'clipboard' ? 'kb-clipboard-panel' : undefined}
                        onClick={props.onClipboard}
                    >
                        <ClipboardIcon />
                    </button>
                    <button
                        className="icon-btn"
                        aria-label={t('vk_switch_schema')}
                        onClick={(e) => props.onSchemaMenu(e.currentTarget.getBoundingClientRect())}
                    >
                        <LanguageIcon />
                    </button>
                    <div className="spring" />
                    <HideButton onHide={props.onHide} onModeMenu={props.onModeMenu} />
                </div>
            </div>
        );
    }

    const page = (dir: 1 | -1) => {
        const el = scrollRef.current;
        if (!el) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduced ? 'auto' : 'smooth' });
        if (dir === 1) maybeLoadMore();
    };

    const maybeLoadMore = () => {
        const el = scrollRef.current;
        if (el && el.scrollLeft + el.clientWidth * 2 >= el.scrollWidth) {
            props.onLoadMore();
        }
    };

    return (
        <div className="kb-bar">
            <div className="kb-candidates" ref={scrollRef} onScroll={maybeLoadMore}>
                {props.candidates.map((c) => (
                    <CandidateChip
                        key={c.index}
                        candidate={c}
                        onSelect={props.onSelect}
                        onDeleteRequest={props.onDeleteRequest}
                    />
                ))}
            </div>
            <button className="icon-btn" aria-label={t('vk_prev_page')} onClick={() => page(-1)}><ChevronLeftIcon /></button>
            <button className="icon-btn" aria-label={t('vk_next_page')} onClick={() => page(1)}><ChevronRightIcon /></button>
            <button className="icon-btn" aria-label={t('vk_expand_candidates')} onClick={props.onExpand}><ExpandMoreIcon /></button>
        </div>
    );
}
