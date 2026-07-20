import React from 'react';

import { t } from '../i18n';
import type { KeyboardMode } from '../placement';
import { fitMenuToViewport } from '../popover-geometry';

// Confirm chip for deleting a user-learned word (long-press on a candidate).
export function DeleteConfirm({ text, anchor, onConfirm, onCancel }: {
  text: string;
  anchor: DOMRect;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const top = Math.max(4, anchor.top - 56);
  const left = Math.max(4, Math.min(anchor.left, window.innerWidth - 240));
  return (
    <>
      <div className="kb-scrim" aria-hidden="true" onPointerDown={onCancel} />
      <div className="kb-confirm" style={{ top, left }}>
        <span className="word">{t('vk_delete_word_confirm', text)}</span>
        <button className="plain" onClick={onCancel}>{t('vk_cancel')}</button>
        <button onClick={onConfirm}>{t('vk_delete')}</button>
      </div>
    </>
  );
}

// Placement picker opened by long-pressing the hide key (iPadOS-style).
export function KeyboardModeMenu({ mode, anchor, onPick, onClose }: {
  mode: KeyboardMode;
  anchor: DOMRect;
  onPick: (mode: KeyboardMode) => void;
  onClose: () => void;
}) {
  const items: Array<{ mode: KeyboardMode; label: string }> = [
    { mode: 'docked', label: t('vk_kbmode_docked') },
    { mode: 'floating', label: t('vk_kbmode_floating') },
    { mode: 'onehand', label: t('vk_kbmode_onehand') },
  ];
  const height = items.length * 44 + 12;
  // The hide key sits at the bottom-right; open above it, and right-align so
  // the menu doesn't spill past the window edge.
  const top = anchor.top - height - 8 >= 4
    ? anchor.top - height - 8
    : Math.min(anchor.bottom + 8, window.innerHeight - height - 4);
  const left = Math.max(4, Math.min(anchor.right - 180, window.innerWidth - 184));
  return (
    <>
      <div className="kb-scrim" aria-hidden="true" onPointerDown={onClose} />
      <div className="kb-menu" style={{ top, left, width: 180 }}>
        {items.map(it => (
          <button
            key={it.mode}
            className={`item${it.mode === mode ? ' active' : ''}`}
            onClick={() => {
              onClose();
              if (it.mode !== mode) onPick(it.mode);
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

// Schema picker opened by long-pressing the 中/英 key.
export function SchemaMenu({ schemas, activeSchema, anchor, onPick, onClose }: {
  schemas: Array<{ id: string; label: string }>;
  activeSchema: string;
  anchor: DOMRect;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const height = schemas.length * 44 + 12;
  // Prefer opening above the anchor (bottom-row 中/英 key); when the anchor
  // sits near the top (toolbar globe button), open below it instead. Long
  // lists are clamped to the window and scroll inside it.
  const { top, maxHeight } = fitMenuToViewport(anchor, height, window.innerHeight);
  const left = Math.max(4, Math.min(anchor.left, window.innerWidth - 200));
  return (
    <>
      <div className="kb-scrim" aria-hidden="true" onPointerDown={onClose} />
      <div
        className="kb-menu"
        style={{ top, left, maxHeight, overflowY: 'auto', boxSizing: 'border-box' }}
      >
        {schemas.map(s => (
          <button
            key={s.id}
            className={`item${s.id === activeSchema ? ' active' : ''}`}
            style={{ flex: '0 0 auto' }}
            onClick={() => {
              onClose();
              if (s.id !== activeSchema) onPick(s.id);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
