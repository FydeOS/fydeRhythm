import React, { useEffect, useRef, useState } from 'react';
import { kEmojiCategories, skinVariants, type EmojiDef } from '../emoji/data';
import { AltBubble } from './AltBubble';
import { commit, type KeyAction } from '../layouts/types';
import { BackspaceIcon, ScheduleIcon } from './icons';
import { t } from '../i18n';

const kRecentsKey = 'emojiRecents';
const kMaxRecents = 40;
const kLongPressMs = 400;

// Recents persist in chrome.storage.local on device; localStorage keeps the
// mock/dev path working in a plain tab.
async function loadRecents(): Promise<string[]> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const obj = await chrome.storage.local.get([kRecentsKey]) as { [kRecentsKey]?: string[] };
            return obj[kRecentsKey] ?? [];
        }
    } catch { /* fall through to localStorage */ }
    try {
        return JSON.parse(localStorage.getItem(kRecentsKey) ?? '[]') as string[];
    } catch {
        return [];
    }
}

function saveRecents(recents: string[]): void {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            void chrome.storage.local.set({ [kRecentsKey]: recents });
            return;
        }
    } catch { /* fall through to localStorage */ }
    try {
        localStorage.setItem(kRecentsKey, JSON.stringify(recents));
    } catch { /* private mode etc. — recents just don't persist */ }
}

// One emoji cell: tap inserts; long-press opens the skin-tone bubble for
// emoji that take modifiers.
function EmojiCell({ def, onInsert, onOpenTones }: {
    def: EmojiDef;
    onInsert: (emoji: string) => void;
    onOpenTones: (def: EmojiDef, anchor: DOMRect) => void;
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
            className="kb-emoji-cell"
            aria-label={def.char}
            onPointerDown={() => {
                longPressed.current = false;
                if (!def.skin) return;
                clear();
                timer.current = window.setTimeout(() => {
                    timer.current = null;
                    longPressed.current = true;
                    const anchor = ref.current?.getBoundingClientRect();
                    if (anchor) onOpenTones(def, anchor);
                }, kLongPressMs);
            }}
            onPointerUp={() => {
                clear();
                if (!longPressed.current) onInsert(def.char);
            }}
            onPointerCancel={clear}
            onPointerLeave={clear}
            onContextMenu={(e) => e.preventDefault()}
        >
            {def.char}
        </button>
    );
}

// Hold-to-repeat backspace, mirroring the keyboard's backspace behavior.
function RepeatBackspace({ onBackspace }: { onBackspace: () => void }) {
    const timer = useRef<number | null>(null);
    const interval = useRef<number | null>(null);

    const stop = () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (interval.current !== null) window.clearInterval(interval.current);
        timer.current = null;
        interval.current = null;
    };

    useEffect(() => stop, []);

    return (
        <button
            className="kb-key fn kb-emoji-side"
            aria-label={t('vk_key_backspace')}
            onPointerDown={() => {
                onBackspace();
                timer.current = window.setTimeout(() => {
                    interval.current = window.setInterval(onBackspace, 60);
                }, 300);
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onPointerLeave={stop}
            onContextMenu={(e) => e.preventDefault()}
        >
            <BackspaceIcon />
        </button>
    );
}

export function EmojiPanel({ onInsert, onBack, onBackspace }: {
    onInsert: (emoji: string) => void;
    onBack: () => void;
    onBackspace: () => void;
}) {
    const [category, setCategory] = useState<string>('recents');
    const [recents, setRecents] = useState<string[]>([]);
    const [tones, setTones] = useState<{ def: EmojiDef; anchor: DOMRect } | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        void loadRecents().then((r) => {
            setRecents(r);
            if (r.length === 0) setCategory(kEmojiCategories[0].id);
        });
    }, []);

    const insert = (emoji: string) => {
        onInsert(emoji);
        setRecents((prev) => {
            const next = [emoji, ...prev.filter((x) => x !== emoji)].slice(0, kMaxRecents);
            saveRecents(next);
            return next;
        });
    };

    const pick = (id: string) => {
        setCategory(id);
        gridRef.current?.scrollTo({ top: 0 });
    };

    const active: EmojiDef[] = category === 'recents'
        ? recents.map((char) => ({ char }))
        : (kEmojiCategories.find((c) => c.id === category) ?? kEmojiCategories[0]).emoji;

    return (
        <div className="kb-emoji">
            <div className="kb-emoji-grid" ref={gridRef}>
                {active.map((def) => (
                    <EmojiCell
                        key={def.char}
                        def={def}
                        onInsert={insert}
                        onOpenTones={(d, anchor) => setTones({ def: d, anchor })}
                    />
                ))}
            </div>
            <div className="kb-emoji-bottom">
                <button className="kb-key fn kb-emoji-side" aria-label={t('vk_back_to_keyboard')} onClick={onBack}>
                    ABC
                </button>
                <div className="kb-emoji-tabs">
                    <button
                        className={`tab${category === 'recents' ? ' active' : ''}`}
                        aria-label={t('vk_recent_emoji')}
                        onClick={() => pick('recents')}
                    >
                        <ScheduleIcon />
                    </button>
                    {kEmojiCategories.map((c) => (
                        <button
                            key={c.id}
                            className={`tab${category === c.id ? ' active' : ''}`}
                            aria-label={t(`vk_emoji_${c.id}`)}
                            onClick={() => pick(c.id)}
                        >
                            {c.icon}
                        </button>
                    ))}
                </div>
                <RepeatBackspace onBackspace={onBackspace} />
            </div>
            {tones && (
                <AltBubble
                    alts={skinVariants(tones.def.char).map((v) => ({ label: v, action: commit(v) }))}
                    anchor={tones.anchor}
                    pointerId={-1}
                    onSelect={(action: KeyAction) => {
                        if (action.type === 'commit') insert(action.text);
                    }}
                    onClose={() => setTones(null)}
                />
            )}
        </div>
    );
}
