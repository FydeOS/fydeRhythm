// What the audit sweeps. Every placement is checked against every keyboard
// state, because the bugs this catches live in the CROSS of the two: a hint
// that fits a docked key collides with the glyph on a one-hand key, and a
// layout that fits four rows overflows when it has five.

// Screens, in CSS pixels — which is what the keyboard's geometry is written in.
// A 2560x1600 panel at dsf 2 reports 1280x800 CSS px, so the second row here is
// a genuinely wide desktop, and `dsf` covers the high-density rendering case.
export const screens = [
    { name: 'chromebook', width: 1366, height: 768, dsf: 1 },
    { name: 'tablet', width: 1280, height: 800, dsf: 2 },
    { name: 'wide', width: 2560, height: 1600, dsf: 1 },
];

// Full placement prefs: geometryFor() reads mode, scale and side, and run.mjs
// computes the card from them with the real source function.
export const placements = [
    { name: 'docked', pref: { mode: 'docked', scale: 0.6, side: 'right' } },
    // Both ends of the resize control's range.
    { name: 'floating-min', pref: { mode: 'floating', scale: 0.55, side: 'right' } },
    { name: 'floating-max', pref: { mode: 'floating', scale: 0.85, side: 'right' } },
    { name: 'onehand-right', pref: { mode: 'onehand', scale: 0.6, side: 'right' } },
    { name: 'onehand-left', pref: { mode: 'onehand', scale: 0.6, side: 'left' } },
];

// Keyboard states.
//   query  — drives the mock's layout / field type
//   rows   — rows the layout renders; the one-hand card is sized from this, so
//            run.mjs needs it to size the window. Checked against the DOM: if a
//            layout changes shape, the audit fails instead of measuring a lie.
//   steps  — reach a state that only exists at runtime. Each step names what it
//            EXPECTS to appear, so a step that silently does nothing is a
//            finding rather than a quietly re-audited main keyboard.
export const states = [
    { name: 'qwerty', rows: 4 },
    { name: 'colemak', query: '?layout=colemak', rows: 4 },
    { name: 'dvorak', query: '?layout=dvorak', rows: 4 },
    // 5-row layouts: the one-hand card grows a row for these.
    { name: 'zhuyin', query: '?layout=zhuyin', rows: 5 },
    { name: 'kana', query: '?layout=kana', rows: 5 },
    { name: 'hangul', query: '?layout=hangul', rows: 4 },
    { name: 'symbols', rows: 4, steps: [{ glyph: '?123', expect: '.kb-key' }] },
    { name: 'symbols-2', rows: 4, steps: [{ glyph: '?123' }, { glyph: '=\\<', expect: '.kb-key' }] },
    { name: 'shifted', rows: 4, steps: [{ sel: '.kb-key[aria-label="Shift"]', expect: '.kb-key.active' }] },
    { name: 'caps', rows: 4, steps: [{ sel: '.kb-key[aria-label="Shift"]' }, { sel: '.kb-key[aria-label="Shift"]', expect: '.kb-key.caps' }] },
    { name: 'numpad', query: '?type=number', rows: 4 },
    { name: 'tel', query: '?type=tel', rows: 4 },
    // The numeric field's ABC escape hatch renders a letter keyboard with a
    // different bottom row.
    { name: 'numpad-letters', query: '?type=number', rows: 4, steps: [{ glyph: 'ABC', expect: '.kb-key[aria-label="Shift"]' }] },

    // --- surfaces that only exist once the user has actually typed or held ---
    // The mock only produces candidates for a-z strokes, so these type first.
    { name: 'candidates', rows: 4, steps: [{ glyph: 'a', expect: '.kb-candidate' }] },
    { name: 'candidates-expanded', rows: 4, steps: [{ glyph: 'a' }, { sel: '.kb-bar .icon-btn:last-child', expect: '.kb-expanded' }] },
    { name: 'candidate-delete', rows: 4, steps: [{ glyph: 'a' }, { sel: '.kb-candidate', hold: 700, expect: '.kb-confirm' }] },
    // Long-press surfaces. `hold` keeps the pointer down so the popover is still
    // up when the checks run.
    { name: 'alt-bubble', rows: 4, steps: [{ glyph: 'a', hold: 700, release: false, expect: '.kb-bubble' }] },
    { name: 'schema-menu', rows: 4, steps: [{ sel: '.kb-key[aria-label="中英切换"]', hold: 700, expect: '.kb-menu' }] },
    { name: 'placement-menu', rows: 4, steps: [{ sel: '.kb-key[aria-label="收起键盘"]', hold: 700, expect: '.kb-menu' }] },
    { name: 'emoji', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(2)', expect: '.kb-emoji-tabs' }] },
    { name: 'clipboard', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(3)', expect: '.kb-clipboard-tile' }] },
    { name: 'clipboard-loading', query: '?clipboard=loading', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(3)', expect: '.kb-clipboard-spinner' }] },
    { name: 'clipboard-empty', query: '?clipboard=empty', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(3)', expect: '.kb-clipboard-retry' }] },
    { name: 'clipboard-delete-pending', query: '?clipboard=delete-pending', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(3)' }, { sel: '.kb-clipboard-delete', expect: '.kb-clipboard-delete:disabled' }] },
    { name: 'clipboard-delete-error', query: '?clipboard=delete-fails', rows: 4, steps: [{ sel: '.kb-bar .icon-btn:nth-child(3)' }, { sel: '.kb-clipboard-delete', expect: '.kb-clipboard-heading > span' }] },
];
