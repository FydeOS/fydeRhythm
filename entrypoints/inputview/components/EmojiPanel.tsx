import React, { useEffect, useRef, useState } from 'react';

import { type EmojiDef, kEmojiCategories, skinVariants } from '../emoji/data';
import { t } from '../i18n';
import { commit, type KeyAction } from '../layouts/types';
import { AltBubble } from './AltBubble';
import { BackspaceIcon, ScheduleIcon } from './icons';

const kRecentsKey = 'emojiRecents';
const kMaxRecents = 40;
// Match the letter keys' long-press timing so the gesture feels the same.
const kLongPressMs = 300; // kDefaultPressTiming.longPressMs — the same gesture
// Finger-jitter slop before a held press reads as a scroll (the keys use a
// similar margin) — leaving the small cell alone must NOT cancel the press.
const kPressSlopPx = 24;

// Recents persist in chrome.storage.local on device; localStorage keeps the
// mock/dev path working in a plain tab.
async function loadRecents(): Promise<string[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const obj = await chrome.storage.local.get([kRecentsKey]) as { [kRecentsKey]?: string[] };
      return obj[kRecentsKey] ?? [];
    }
  }
  catch { /* fall through to localStorage */ }
  try {
    return JSON.parse(localStorage.getItem(kRecentsKey) ?? '[]') as string[];
  }
  catch {
    return [];
  }
}

function saveRecents(recents: string[]): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [kRecentsKey]: recents });
      return;
    }
  }
  catch { /* fall through to localStorage */ }
  try {
    localStorage.setItem(kRecentsKey, JSON.stringify(recents));
  }
  catch { /* private mode etc. — recents just don't persist */ }
}

// One emoji cell: tap inserts; long-press opens the skin-tone bubble for
// emoji that take modifiers.
function EmojiCell({ def, onInsert, onOpenTones }: {
  def: EmojiDef;
  onInsert: (emoji: string) => void;
  onOpenTones: (def: EmojiDef, anchor: DOMRect, pointerId: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const pointerId = useRef(-1);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  // While the tone bubble is up, block touchmove's default: the grid is
  // scrollable, and the browser claiming the still-held touch for a pan would
  // fire pointercancel and close the bubble — the reason slides used to kill
  // it. Non-passive on purpose; removed on release/cancel/unmount.
  const blockScroll = useRef((e: TouchEvent) => e.preventDefault()).current;
  const unblockScroll = () => window.removeEventListener('touchmove', blockScroll);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => () => window.removeEventListener('touchmove', blockScroll), [blockScroll]);

  return (
    <button
      ref={ref}
      className="kb-emoji-cell"
      aria-label={def.char}
      onPointerDown={(e) => {
        longPressed.current = false;
        pointerId.current = e.pointerId;
        downPos.current = { x: e.clientX, y: e.clientY };
        if (!def.skin) return;
        clear();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          longPressed.current = true;
          // Keep the gesture: capture the pointer and stop the pan
          // from starting, so the bubble can track slide-to-tone.
          try { ref.current?.setPointerCapture(pointerId.current); }
          catch { /* pointer gone */ }
          window.addEventListener('touchmove', blockScroll, { passive: false });
          const anchor = ref.current?.getBoundingClientRect();
          if (anchor) onOpenTones(def, anchor, pointerId.current);
        }, kLongPressMs);
      }}
      onPointerMove={(e) => {
        // Beyond the slop before the press fires = a scroll, not a hold.
        const d = downPos.current;
        if (timer.current !== null && d
          && (Math.abs(e.clientX - d.x) > kPressSlopPx || Math.abs(e.clientY - d.y) > kPressSlopPx)) {
          clear();
        }
      }}
      onPointerUp={() => {
        clear();
        unblockScroll();
        if (!longPressed.current) onInsert(def.char);
      }}
      onPointerCancel={() => { clear(); unblockScroll(); }}
      onContextMenu={e => e.preventDefault()}
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
      onContextMenu={e => e.preventDefault()}
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
  const [active, setActive] = useState<string>(kEmojiCategories[0].id);
  // Recents as they were when the panel opened. The section does NOT reorder
  // while the panel is up — a live reorder above the viewport would yank the
  // scroll position around under the user's finger.
  const [shelf, setShelf] = useState<string[]>([]);
  const [tones, setTones] = useState<{ def: EmojiDef; anchor: DOMRect; pointerId: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const recentsRef = useRef<string[]>([]);
  const spyRaf = useRef(false);

  useEffect(() => {
    void loadRecents().then((r) => {
      recentsRef.current = r;
      setShelf(r);
      if (r.length > 0) setActive('recents');
    });
  }, []);

  const insert = (emoji: string) => {
    onInsert(emoji);
    recentsRef.current = [emoji, ...recentsRef.current.filter(x => x !== emoji)].slice(0, kMaxRecents);
    saveRecents(recentsRef.current);
  };

  // One continuous scroll across every category; the tabs are scroll-spies.
  const sections: Array<{ id: string; label: string; emoji: EmojiDef[] }> = [
    ...(shelf.length > 0 ? [{ id: 'recents', label: t('vk_recent_emoji'), emoji: shelf.map(char => ({ char })) }] : []),
    ...kEmojiCategories.map(c => ({ id: c.id, label: t(`vk_emoji_${c.id}`), emoji: c.emoji })),
  ];

  const pick = (id: string) => {
    const el = sectionRefs.current.get(id);
    const grid = gridRef.current;
    if (!el || !grid) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    grid.scrollTo({ top: el.offsetTop, behavior: reduced ? 'auto' : 'smooth' });
    setActive(id);
  };

  // The active tab follows the scroll: the last section whose top has passed
  // the sticky-header line. rAF-coalesced — scroll fires per frame anyway.
  const spy = () => {
    if (spyRaf.current) return;
    spyRaf.current = true;
    requestAnimationFrame(() => {
      spyRaf.current = false;
      const grid = gridRef.current;
      if (!grid) return;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = sectionRefs.current.get(s.id);
        if (el && el.offsetTop <= grid.scrollTop + 40) current = s.id;
      }
      if (current) setActive(current);
    });
  };

  return (
    <div className="kb-emoji">
      <div className="kb-emoji-grid" ref={gridRef} onScroll={spy}>
        {sections.map(s => (
          <section
            key={s.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(s.id, el);
              else sectionRefs.current.delete(s.id);
            }}
          >
            <div className="kb-emoji-head">{s.label}</div>
            <div className="kb-emoji-section-grid">
              {s.emoji.map(def => (
                <EmojiCell
                  key={def.char}
                  def={def}
                  onInsert={insert}
                  onOpenTones={(d, anchor, pid) => setTones({ def: d, anchor, pointerId: pid })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="kb-emoji-bottom">
        <button className="kb-key fn kb-emoji-side" aria-label={t('vk_back_to_keyboard')} onClick={onBack}>
          ABC
        </button>
        <div className="kb-emoji-tabs">
          {shelf.length > 0 && (
            <button
              className={`tab${active === 'recents' ? ' active' : ''}`}
              aria-label={t('vk_recent_emoji')}
              onClick={() => pick('recents')}
            >
              <ScheduleIcon />
            </button>
          )}
          {kEmojiCategories.map(c => (
            <button
              key={c.id}
              className={`tab${active === c.id ? ' active' : ''}`}
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
          alts={skinVariants(tones.def.char).map(v => ({ label: v, action: commit(v) }))}
          anchor={tones.anchor}
          pointerId={tones.pointerId}
          onSelect={(action: KeyAction) => {
            if (action.type === 'commit') insert(action.text);
          }}
          onClose={() => setTones(null)}
        />
      )}
    </div>
  );
}
