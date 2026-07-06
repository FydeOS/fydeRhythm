// Data model for declarative keyboard layouts. A layout is pure data — adding a
// new one means adding a file under layouts/, not writing components.

// A key event to inject via chrome.virtualKeyboardPrivate.sendKeyEvent — the
// on-screen equivalent of pressing a physical key. `key` is the produced
// character (or W3C key name for specials like "Backspace"), `code` is the W3C
// KeyboardEvent.code. The Rime engine receives it exactly like a physical key.
export interface KeyStroke {
    key: string;
    code: string;
    shiftKey?: boolean;
}

export type LayerId = 'main' | 'sym' | 'sym2' | 'emoji';

export type KeyAction =
    // Inject a keystroke (letters, digits, punctuation, Backspace, Enter, …)
    | { type: 'stroke'; stroke: KeyStroke }
    // Commit text directly, bypassing the engine (emoji, glyphs with no key mapping)
    | { type: 'commit'; text: string }
    | { type: 'shift' }
    | { type: 'layer'; layer: LayerId }
    | { type: 'toggleAscii' }
    | { type: 'hide' }
    | { type: 'none' };

export interface AltDef {
    label: string;
    action: KeyAction;
}

export interface KeyDef {
    id: string;
    action: KeyAction;
    label: string;
    // Label and stroke while shift/caps is active. Letter keys get these
    // derived automatically by letterKey().
    shiftLabel?: string;
    shiftAction?: KeyAction;
    // Small corner hint showing the primary long-press alternate.
    hint?: string;
    // Long-press bubble content. The first item is highlighted by default.
    alts?: AltDef[];
    // Flex weight within the row; default 1.
    width?: number;
    // Visual role (function keys are tinted, enter is filled, spacer is blank).
    kind?: 'normal' | 'function' | 'enter' | 'space' | 'spacer';
    // Hold-to-repeat (backspace). Repeating keys activate on pointer-down.
    repeat?: boolean;
}

export interface KeyboardLayout {
    id: string;
    rows: KeyDef[][];
}

export function stroke(key: string, code: string, shiftKey?: boolean): KeyAction {
    return { type: 'stroke', stroke: { key, code, ...(shiftKey ? { shiftKey } : {}) } };
}

export function commit(text: string): KeyAction {
    return { type: 'commit', text };
}

// Characters that live on the shifted layer of a US physical keyboard. Their
// synthesized key events MUST carry the shift modifier: the system rebuilds
// the typed character from keyCode+modifiers (not from charValue), so an '@'
// sent as unshifted Digit2 actually types '2'.
const kShiftedSymbols = new Set([...'~!@#$%^&*()_+{}|:"<>?']);

// The keystroke that types a single printable ASCII char.
export function charStroke(c: string): KeyAction {
    return stroke(c, codeForChar(c), /^[A-Z]$/.test(c) || kShiftedSymbols.has(c));
}

// Alternates that type a plain character. Single Latin chars are sent as
// strokes (so the engine sees them); anything else is committed directly.
export function charAlts(chars: string[]): AltDef[] {
    return chars.map((c) => ({
        label: c,
        action: /^[\x20-\x7e]$/.test(c) ? charStroke(c) : commit(c),
    }));
}

// W3C KeyboardEvent.code for a printable ASCII char, for strokes synthesized
// from bare characters (alt bubbles, symbol layers). Unknown symbols map to
// an empty code — the adapter then sends charValue only, which is enough for
// direct insertion paths.
export function codeForChar(c: string): string {
    if (/^[a-z]$/.test(c)) return `Key${c.toUpperCase()}`;
    if (/^[A-Z]$/.test(c)) return `Key${c}`;
    if (/^[0-9]$/.test(c)) return `Digit${c}`;
    const map: Record<string, string> = {
        ' ': 'Space', '`': 'Backquote', '-': 'Minus', '=': 'Equal',
        '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
        ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
        '~': 'Backquote', '_': 'Minus', '+': 'Equal',
        '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash',
        ':': 'Semicolon', '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash',
        '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
        '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
    };
    return map[c] ?? '';
}

// A Latin letter key: lowercase stroke by default, uppercase stroke + label
// under shift, digits/diacritics in the long-press bubble.
export function letterKey(letter: string, altChars?: string[]): KeyDef {
    const code = `Key${letter.toUpperCase()}`;
    const upper = letter.toUpperCase();
    return {
        id: code,
        label: letter,
        shiftLabel: upper,
        action: stroke(letter, code),
        shiftAction: stroke(upper, code, true),
        ...(altChars && altChars.length > 0
            ? { hint: altChars[0], alts: charAlts(altChars) }
            : {}),
    };
}

// A key that types a single printable char (symbol layers).
export function charKey(c: string, altChars?: string[]): KeyDef {
    return {
        id: `char-${c}`,
        label: c,
        action: /^[\x20-\x7e]$/.test(c) ? charStroke(c) : commit(c),
        ...(altChars && altChars.length > 0
            ? { hint: altChars[0], alts: charAlts(altChars) }
            : {}),
    };
}

// Merge a positional long-press symbol (FlorisBoard/Gboard style) into a key:
// it becomes the corner hint and the first bubble alternate.
export function withSymbol(key: KeyDef, symbol: string): KeyDef {
    return { ...key, hint: symbol, alts: [...charAlts([symbol]), ...(key.alts ?? [])] };
}

// Apply a row of positional symbols to the typing keys of a row, skipping
// function keys (shift/backspace) and keys beyond the symbol list.
export function withSymbolHints(row: KeyDef[], symbols: string[]): KeyDef[] {
    let i = 0;
    return row.map((key) => {
        if (key.kind || key.action.type === 'shift' || i >= symbols.length) return key;
        return withSymbol(key, symbols[i++]);
    });
}

export const backspaceKey: KeyDef = {
    id: 'Backspace',
    label: '⌫',
    kind: 'function',
    repeat: true,
    action: stroke('Backspace', 'Backspace'),
    width: 1.5,
};

export const shiftKey: KeyDef = {
    id: 'Shift',
    label: '⇧',
    kind: 'function',
    action: { type: 'shift' },
    width: 1.5,
};
