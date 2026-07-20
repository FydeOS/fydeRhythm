import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { kDefaultPressTiming, KeyPress, type PressUpdate } from '../gestures/press';
import { t } from '../i18n';
import type { FlickDef, KeyAction, KeyDef } from '../layouts/types';
import { BackspaceIcon, CapsLockIcon, EnterIcon, KeyboardHideIcon, MoodIcon, ShiftFilledIcon, ShiftIcon } from './icons';

export type ShiftState = 'off' | 'shift' | 'caps';

export interface KeyProps {
  def: KeyDef;
  shift: ShiftState;
  onAction: (action: KeyAction) => void;
  // Long-press with alts: hand the interaction over to the bubble layer.
  onOpenBubble: (def: KeyDef, anchor: DOMRect, pointerId: number) => void;
  // Special long-press surfaces (schema menu on the 中/英 key).
  onLongPressMenu?: (def: KeyDef, anchor: DOMRect) => void;
  // Space only: a horizontal drag steps the caret instead of typing, and a
  // still long-press arms the same cursor mode (Gboard convention — the
  // schema switcher lives on 中/英 and the toolbar globe instead).
  onCaretDrag?: (dir: 1 | -1) => void;
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
//
// The preview exists because a FINGER hides the key, and a finger is the same
// size whatever the keyboard is. So the preview is not a fixed multiple of the
// key: multiplying an already-huge docked key (103x73) by 1.3 magnified a letter
// nobody was struggling to read, and landed a 134x95 slab with a 39px glyph on
// the board. The glyph grows until it is comfortably legible and then stops.
const kPreviewMagnify = 1.25;
// Past this, a bigger letter is just louder, not clearer.
const kPreviewGlyphMax = 30;
// Box follows the GLYPH, not the key — it is a label, so it is as big as the
// thing it has to hold.
const kPreviewLead = 1.75;
const kPreviewMinWidth = 48;

// Space caret drag: past the slop the press stops being a tap (and stops the
// long-press menu); each further step moves the caret one character. The slop
// is wider than the step so an idle thumb resting on space never scrubs.
const kCaretSlop = 24;
const kCaretStep = 16;

// Flick (12-key kana): sliding past the slop picks the petal in the dominant
// direction; release commits it. Below the slop the press is still a tap, and
// a STILL hold still opens the long-press bubble.
const kFlickSlop = 20;

// The preview is portalled to <body>, OUTSIDE the keyboard's CSS container, so
// it can see neither the row-relative type scale nor a per-placement token
// override — a cqh font would silently resolve against the viewport, and
// --kb-key-radius would come from :root (12px) even over an 8px one-hand key.
// Everything it needs is measured off the key it magnifies instead.
function previewStyle(anchor: DOMRect, key: HTMLElement): React.CSSProperties {
  const cs = window.getComputedStyle(key);
  const keyGlyph = parseFloat(cs.fontSize);

  // NEVER smaller than the key's own glyph. The cap is an absolute number and
  // the keyboard is not: the docked board grows to 440px on a tall screen and
  // takes its keys' glyphs to ~36px, so a bare cap would print the letter
  // SMALLER in the preview than on the key underneath — which is exactly how
  // the floating keyboard used to look.
  const glyph = Math.max(keyGlyph, Math.min(keyGlyph * kPreviewMagnify, kPreviewGlyphMax));

  const height = glyph * kPreviewLead;
  // At least as wide as the key, so it reads as sitting over it rather than
  // beside it, and always wide enough to hold its own glyph.
  const width = Math.max(anchor.width * 1.1, glyph * 1.8, kPreviewMinWidth);
  const centred = anchor.left + (anchor.width - width) / 2;

  return {
    left: Math.max(4, Math.min(centred, window.innerWidth - width - 4)),
    top: Math.max(4, anchor.top - height - 8),
    width,
    height,
    fontSize: `${glyph}px`,
    borderRadius: `${parseFloat(cs.borderRadius) + 2}px`,
  };
}

// i18n keys for keys whose visible label is an icon or an internal id.
const kAriaKeys: Record<string, string> = {
  'Shift': 'vk_key_shift',
  'Backspace': 'vk_key_backspace',
  'Enter': 'vk_key_enter',
  'Space': 'vk_key_space',
  'emoji': 'vk_emoji',
  'to-sym': 'vk_key_symbols',
  'to-sym2': 'vk_key_more_symbols',
  'to-main': 'vk_key_letters',
  'ascii-toggle': 'vk_key_toggle_language',
};

export function Key({ def, shift, onAction, onOpenBubble, onLongPressMenu, onCaretDrag, active }: KeyProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(false);
  const machineRef = useRef<KeyPress | null>(null);
  const timerRef = useRef<number | null>(null);
  // Key rect captured once per press: pointermove fires dozens of times and
  // the preview renders repeatedly — neither should hit layout again.
  const pressRect = useRef<DOMRect | null>(null);
  // Caret drag on space: pointer-down x while armed, then the x the last
  // caret step was taken from (null = not dragging).
  const downX = useRef(0);
  const downY = useRef(0);
  const caretDrag = useRef<number | null>(null);
  // Cursor mode is rendered: the space label becomes ‹ › while it drives
  // the caret, so the mode change is visible under the finger.
  const [careting, setCareting] = useState(false);
  // Flick direction lives in a ref for the release logic — a fast flick can
  // land pointermove and pointerup in one event batch, where state is still
  // a render behind — and in state for the preview render.
  const flickRef = useRef<keyof FlickDef | null>(null);
  const [flickDir, setFlickDir] = useState<keyof FlickDef | null>(null);
  const pickFlick = (dir: keyof FlickDef | null) => {
    flickRef.current = dir;
    setFlickDir(dir);
  };

  const shifted = shift !== 'off';
  const label = shifted && def.shiftLabel ? def.shiftLabel : def.label;
  const action = shifted && def.shiftAction ? def.shiftAction : def.action;
  const wantsMenu = !!onLongPressMenu;
  // onCaretDrag counts as a long-press surface: the machine's timer is what
  // arms cursor mode on a still hold.
  const hasAlts = (def.alts?.length ?? 0) > 0 || wantsMenu || !!onCaretDrag;

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
      }
      else if (effect === 'openBubble') {
        if (onCaretDrag && !wantsMenu && !def.alts?.length) {
          // Space: a still hold arms cursor mode. Capture stays —
          // the finger keeps driving the caret until release.
          machineRef.current = null;
          caretDrag.current = downX.current;
          setCareting(true);
          continue;
        }
        const anchor = pressRect.current;
        if (anchor) {
          if (pointerId !== undefined) {
            try {
              ref.current?.releasePointerCapture(pointerId);
            }
            catch { /* pointer already gone */ }
          }
          if (wantsMenu) {
            onLongPressMenu(def, anchor);
          }
          else {
            onOpenBubble(def, anchor, pointerId ?? -1);
          }
        }
        setPressed(false);
      }
      else if (effect === 'release') {
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
    downX.current = e.clientX;
    downY.current = e.clientY;
    caretDrag.current = null;
    pickFlick(null);
    pressRect.current = e.currentTarget.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    catch { /* synthetic or already-released pointer */ }
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
    if (caretDrag.current !== null) {
      // The drag consumed the press: no space is typed on release.
      caretDrag.current = null;
      setCareting(false);
      setPressed(false);
      return;
    }
    const m = machineRef.current;
    if (!m) return;
    // Releasing a flick commits the petal instead of the key's own action.
    const dir = flickRef.current;
    if (dir && def.flick?.[dir] && kind === 'up' && !m.isBubbling) {
      machineRef.current = null;
      clearTimer();
      onAction(def.flick[dir].action);
      pickFlick(null);
      setPressed(false);
      return;
    }
    machineRef.current = null;
    pickFlick(null);
    apply(kind === 'up' ? m.up() : m.cancel());
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (def.flick) {
      const m = machineRef.current;
      if (!m || m.isBubbling) return;
      // Dominant-axis pick, re-derived on every move so a finger can
      // wander back to centre. Movement kills the long-press timer; a
      // direction with no petal falls back to the centre kana. No
      // slide-off cancel here — leaving the key is how a flick works.
      const dx = e.clientX - downX.current;
      const dy = e.clientY - downY.current;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > kFlickSlop) {
        clearTimer();
        const dir: keyof FlickDef = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
        pickFlick(def.flick[dir] ? dir : null);
      }
      else {
        pickFlick(null);
      }
      return;
    }
    if (onCaretDrag) {
      if (caretDrag.current === null) {
        const m = machineRef.current;
        if (m && !m.isBubbling && Math.abs(e.clientX - downX.current) > kCaretSlop) {
          // The press becomes a drag: kill the tap and its hold timer,
          // keep the pressed look while the finger drives the caret.
          machineRef.current = null;
          clearTimer();
          caretDrag.current = downX.current;
          setCareting(true);
        }
      }
      if (caretDrag.current !== null) {
        let dx = e.clientX - caretDrag.current;
        while (Math.abs(dx) >= kCaretStep) {
          onCaretDrag(dx > 0 ? 1 : -1);
          caretDrag.current += Math.sign(dx) * kCaretStep;
          dx = e.clientX - caretDrag.current;
        }
        return;
      }
    }
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
      case 'emoji':
        return <MoodIcon />;
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
  // Mid-flick the preview shows the petal being picked, not the centre.
  const previewLabel = flickDir && def.flick?.[flickDir] ? def.flick[flickDir].label : label;

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
      onContextMenu={e => e.preventDefault()}
    >
      {icon ?? <span className="glyph">{careting ? '‹ ›' : label}</span>}
      {def.hint && <span className="hint">{shifted ? '' : def.hint}</span>}
      {anchor && createPortal(
        <div
          className="kb-preview"
          style={previewStyle(anchor, ref.current!)}
        >
          {previewLabel}
        </div>,
        document.body,
      )}
    </button>
  );
}
