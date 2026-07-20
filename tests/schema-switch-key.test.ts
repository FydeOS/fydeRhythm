import { describe, expect, it } from 'vitest';

import {
  formatSchemaSwitchKey,
  interpretRecordingKey,
  isValidSchemaSwitchKey,
  kDefaultSchemaSwitchKey,
  keyCodeLabel,
  matchesSchemaSwitchKey,
  resolveSchemaSwitchKey,
  type SchemaSwitchKey,
} from '../lib/utils';

// Convenience for building synthetic key events the matcher/recorder care about.
function ev(code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) {
  return { code, ctrlKey: mods.ctrl, altKey: mods.alt, shiftKey: mods.shift, metaKey: mods.meta };
}

describe('resolveSchemaSwitchKey (tri-state)', () => {
  it('undefined resolves to the Ctrl+` default', () => {
    expect(resolveSchemaSwitchKey(undefined)).toEqual(kDefaultSchemaSwitchKey);
  });

  it('null resolves to disabled (null)', () => {
    expect(resolveSchemaSwitchKey(null)).toBeNull();
  });

  it('a binding with an empty code is treated as disabled', () => {
    expect(resolveSchemaSwitchKey({ code: '' })).toBeNull();
  });

  it('a concrete binding passes through unchanged', () => {
    const b: SchemaSwitchKey = { code: 'F2', ctrlKey: true };
    expect(resolveSchemaSwitchKey(b)).toBe(b);
  });
});

describe('matchesSchemaSwitchKey — default binding (undefined → Ctrl+`)', () => {
  it('fires on exactly Ctrl+Backquote', () => {
    expect(matchesSchemaSwitchKey(ev('Backquote', { ctrl: true }), undefined)).toBe(true);
  });

  it('treats absent modifier fields as false (Ctrl only, alt/shift undefined)', () => {
    // Only ctrlKey provided; altKey/shiftKey are undefined and must coerce to false.
    expect(matchesSchemaSwitchKey({ code: 'Backquote', ctrlKey: true }, undefined)).toBe(true);
  });

  it('does NOT fire without Ctrl', () => {
    expect(matchesSchemaSwitchKey(ev('Backquote'), undefined)).toBe(false);
  });

  it('does NOT fire when an extra modifier is held (Ctrl+Alt+`)', () => {
    expect(matchesSchemaSwitchKey(ev('Backquote', { ctrl: true, alt: true }), undefined)).toBe(false);
  });

  it('does NOT fire when an extra modifier is held (Ctrl+Shift+`)', () => {
    expect(matchesSchemaSwitchKey(ev('Backquote', { ctrl: true, shift: true }), undefined)).toBe(false);
  });

  it('does NOT fire on a different key with Ctrl', () => {
    expect(matchesSchemaSwitchKey(ev('KeyA', { ctrl: true }), undefined)).toBe(false);
  });
});

describe('matchesSchemaSwitchKey — disabled binding (null)', () => {
  it('never fires, not even on the old default Ctrl+`', () => {
    expect(matchesSchemaSwitchKey(ev('Backquote', { ctrl: true }), null)).toBe(false);
  });
});

describe('matchesSchemaSwitchKey — custom modifier-less binding (F2)', () => {
  const f2: SchemaSwitchKey = { code: 'F2' };

  it('fires on F2 with no modifiers', () => {
    expect(matchesSchemaSwitchKey(ev('F2'), f2)).toBe(true);
  });

  it('fires when modifier fields are explicitly false', () => {
    expect(matchesSchemaSwitchKey(ev('F2', { ctrl: false, alt: false, shift: false }), f2)).toBe(true);
  });

  it('does NOT fire when a modifier is held (Ctrl+F2)', () => {
    expect(matchesSchemaSwitchKey(ev('F2', { ctrl: true }), f2)).toBe(false);
  });
});

describe('matchesSchemaSwitchKey — custom multi-modifier binding (Ctrl+Shift+Space)', () => {
  const binding: SchemaSwitchKey = { code: 'Space', ctrlKey: true, shiftKey: true };

  it('fires on the exact combination', () => {
    expect(matchesSchemaSwitchKey(ev('Space', { ctrl: true, shift: true }), binding)).toBe(true);
  });

  it('does NOT fire when one required modifier is missing', () => {
    expect(matchesSchemaSwitchKey(ev('Space', { ctrl: true }), binding)).toBe(false);
  });

  it('does NOT fire when an extra modifier is added', () => {
    expect(matchesSchemaSwitchKey(ev('Space', { ctrl: true, shift: true, alt: true }), binding)).toBe(false);
  });
});

describe('matchesSchemaSwitchKey — defensive', () => {
  it('a binding with an empty code never matches', () => {
    expect(matchesSchemaSwitchKey(ev('', { ctrl: true }), { code: '' })).toBe(false);
    expect(matchesSchemaSwitchKey(ev('Backquote', { ctrl: true }), { code: '' })).toBe(false);
  });
});

describe('isValidSchemaSwitchKey', () => {
  it('accepts the special sentinels (undefined = default, null = disabled)', () => {
    expect(isValidSchemaSwitchKey(undefined)).toBe(true);
    expect(isValidSchemaSwitchKey(null)).toBe(true);
  });

  it('accepts any key with Ctrl or Alt', () => {
    expect(isValidSchemaSwitchKey({ code: 'Backquote', ctrlKey: true })).toBe(true);
    expect(isValidSchemaSwitchKey({ code: 'Space', altKey: true })).toBe(true);
    expect(isValidSchemaSwitchKey({ code: 'Digit1', ctrlKey: true, shiftKey: true })).toBe(true);
  });

  it('rejects a plain key with no modifier (would swallow typing)', () => {
    expect(isValidSchemaSwitchKey({ code: 'KeyA' })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: 'Backquote' })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: 'Space' })).toBe(false);
  });

  it('rejects Shift-only combos — Shift+letter/digit IS ordinary typing', () => {
    // Shift+A types a capital A; binding it would swallow every capital A.
    expect(isValidSchemaSwitchKey({ code: 'KeyA', shiftKey: true })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: 'Digit7', shiftKey: true })).toBe(false); // types '&'
    expect(isValidSchemaSwitchKey({ code: 'Backquote', shiftKey: true })).toBe(false); // types '~'
  });

  it('accepts Shift with a function key (F-keys are safe regardless)', () => {
    expect(isValidSchemaSwitchKey({ code: 'F2', shiftKey: true })).toBe(true);
  });

  it('accepts modifier-less function keys F1–F24', () => {
    expect(isValidSchemaSwitchKey({ code: 'F1' })).toBe(true);
    expect(isValidSchemaSwitchKey({ code: 'F9' })).toBe(true);
    expect(isValidSchemaSwitchKey({ code: 'F10' })).toBe(true);
    expect(isValidSchemaSwitchKey({ code: 'F24' })).toBe(true);
  });

  it('rejects out-of-range "function" codes without a modifier', () => {
    expect(isValidSchemaSwitchKey({ code: 'F0' })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: 'F25' })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: 'Fx' })).toBe(false);
  });

  it('still accepts a function key combined with a modifier', () => {
    expect(isValidSchemaSwitchKey({ code: 'F2', ctrlKey: true })).toBe(true);
  });

  it('rejects an empty code', () => {
    expect(isValidSchemaSwitchKey({ code: '' })).toBe(false);
    expect(isValidSchemaSwitchKey({ code: '', ctrlKey: true })).toBe(false);
  });
});

describe('interpretRecordingKey (options-page shortcut recorder)', () => {
  it('Escape cancels', () => {
    expect(interpretRecordingKey(ev('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('Escape cancels even with modifiers held (never records Ctrl+Escape)', () => {
    expect(interpretRecordingKey(ev('Escape', { ctrl: true }))).toEqual({ kind: 'cancel' });
    expect(interpretRecordingKey(ev('Escape', { ctrl: true, alt: true, shift: true }))).toEqual({ kind: 'cancel' });
  });

  it('every modifier-only press is pending (user may still be building a combo)', () => {
    for (const code of ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
      'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']) {
      expect(interpretRecordingKey(ev(code, { ctrl: true }))).toEqual({ kind: 'pending' });
    }
  });

  it('accepts a valid modified combo and normalizes undefined modifiers to false', () => {
    // altKey/shiftKey omitted on the event → must come back as explicit false,
    // so the stored binding never carries undefined fields.
    expect(interpretRecordingKey({ code: 'Digit1', ctrlKey: true, shiftKey: true })).toEqual({
      kind: 'accept',
      binding: { code: 'Digit1', ctrlKey: true, altKey: false, shiftKey: true },
    });
  });

  it('accepts a modifier-less function key', () => {
    expect(interpretRecordingKey(ev('F2'))).toEqual({
      kind: 'accept',
      binding: { code: 'F2', ctrlKey: false, altKey: false, shiftKey: false },
    });
  });

  it('rejects an unmodified plain key as invalid (recording continues)', () => {
    expect(interpretRecordingKey(ev('KeyA'))).toEqual({ kind: 'invalid' });
    expect(interpretRecordingKey(ev('Space'))).toEqual({ kind: 'invalid' });
    expect(interpretRecordingKey(ev('Backquote'))).toEqual({ kind: 'invalid' });
  });

  it('rejects any combo held with Meta/Search — bindings cannot express it', () => {
    // chrome.input.ime key events carry no metaKey, so the background could
    // never distinguish Search+F2 from plain F2. Recording must reject the
    // combo instead of silently saving something broader than pressed.
    expect(interpretRecordingKey(ev('F2', { meta: true }))).toEqual({ kind: 'invalid' });
    expect(interpretRecordingKey(ev('KeyK', { shift: true, meta: true }))).toEqual({ kind: 'invalid' });
    expect(interpretRecordingKey(ev('Digit1', { ctrl: true, meta: true }))).toEqual({ kind: 'invalid' });
  });

  it('rejects Shift-only combos while recording (matches isValidSchemaSwitchKey)', () => {
    expect(interpretRecordingKey(ev('KeyA', { shift: true }))).toEqual({ kind: 'invalid' });
  });

  it('an accepted binding round-trips through matchesSchemaSwitchKey', () => {
    const result = interpretRecordingKey(ev('Digit1', { ctrl: true, shift: true }));
    expect(result.kind).toBe('accept');
    if (result.kind === 'accept') {
      expect(matchesSchemaSwitchKey(ev('Digit1', { ctrl: true, shift: true }), result.binding)).toBe(true);
      expect(matchesSchemaSwitchKey(ev('Digit1', { ctrl: true }), result.binding)).toBe(false);
    }
  });
});

describe('keyCodeLabel', () => {
  it('maps punctuation codes to their glyphs', () => {
    expect(keyCodeLabel('Backquote')).toBe('`');
    expect(keyCodeLabel('Slash')).toBe('/');
    expect(keyCodeLabel('Space')).toBe('Space');
  });

  it('maps letter and digit codes', () => {
    expect(keyCodeLabel('KeyA')).toBe('A');
    expect(keyCodeLabel('KeyZ')).toBe('Z');
    expect(keyCodeLabel('Digit0')).toBe('0');
    expect(keyCodeLabel('Digit9')).toBe('9');
  });

  it('falls back to the raw code for unknown keys', () => {
    expect(keyCodeLabel('F2')).toBe('F2');
    expect(keyCodeLabel('ArrowUp')).toBe('ArrowUp');
  });
});

describe('formatSchemaSwitchKey', () => {
  it('formats the default (undefined) as Ctrl + `', () => {
    expect(formatSchemaSwitchKey(undefined)).toBe('Ctrl + `');
  });

  it('formats a disabled binding (null) as empty string', () => {
    expect(formatSchemaSwitchKey(null)).toBe('');
  });

  it('orders modifiers Ctrl, Alt, Shift then the key', () => {
    expect(formatSchemaSwitchKey({ code: 'KeyA', ctrlKey: true, altKey: true, shiftKey: true }))
      .toBe('Ctrl + Alt + Shift + A');
    expect(formatSchemaSwitchKey({ code: 'KeyB', altKey: true, shiftKey: true }))
      .toBe('Alt + Shift + B');
  });

  it('formats a modifier-less function key', () => {
    expect(formatSchemaSwitchKey({ code: 'F2' })).toBe('F2');
  });

  it('formats a defensive empty-code binding as empty string', () => {
    expect(formatSchemaSwitchKey({ code: '' })).toBe('');
  });
});
