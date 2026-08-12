import { FastIndexedDbFsController } from './fs';
import { kLatinLayoutIds, kScriptLayoutIds, type LatinLayoutId, type LayoutId, type ScriptLayoutId } from './shared-types';

export function dec2hex(dec: number): string {
  return dec.toString(16).padStart(2, '0');
}

export function generateId(len: number = 40): string {
  const arr = new Uint8Array(len / 2);
  self.crypto.getRandomValues(arr);
  return Array.from(arr, dec2hex).join('');
}

export async function getFs(): Promise<FastIndexedDbFsController> {
  const fs = new FastIndexedDbFsController('rime-files');
  await fs.open();
  return fs;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function getParentPath(path: string): string {
  const regex = /^(.*)\/[^/]*$/;
  const match = regex.exec(path);
  return match ? match[1] : '/';
}

export function getFileName(path: string): string | null {
  const regex = /\/([^/]+)$/;
  const match = regex.exec(path);
  return match ? match[1] : null;
}

// A keyboard combination that cycles to the next enabled schema. `code` is a
// KeyboardEvent.code value (e.g. "Backquote"); the three booleans are the
// required modifier state (an exact match is required — a binding for Ctrl+`
// must NOT fire when Alt is also held).
export interface SchemaSwitchKey {
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

// "latin" undoes a wrong guess (an imported "my_bopomofo_fork" → zhuyin).
export type SchemaKeys = ScriptLayoutId | 'latin';

export interface ImeSettings {
  schema: string;
  pageSize: number;
  algebraList: string[];
  // Ids of schemas visible in the IME tray menu. Undefined = legacy "all downloaded are enabled".
  // The currently active schema is always implicitly enabled regardless of this list.
  enabledSchemas?: string[];
  // Shortcut that cycles to the next enabled schema.
  //   undefined → use kDefaultSchemaSwitchKey (Ctrl+`)
  //   null      → disabled, no shortcut at all
  //   object    → a user-defined binding
  schemaSwitchKey?: SchemaSwitchKey | null;
  // Physical remap, on-screen letter keys and English mode all derive from this.
  keyboardLayout?: LatinLayoutId;
  // Corrections to guessSchemaKeys(). Only the InputView reads these.
  schemaKeys?: Record<string, SchemaKeys>;
  // Voice input master switch. Undefined = off: dictation uploads audio to a
  // third party, so it is never on by default.
  voiceInput?: boolean;
  /** @deprecated Read once by migrateLayoutSettings, then dropped. */
  latinLayout?: LatinLayoutId | 'follow';
  /** @deprecated Read once by migrateLayoutSettings, then dropped. */
  schemaLayouts?: Record<string, LayoutId>;
}

export const kDefaultSettings: ImeSettings = { schema: 'aurora_pinyin', pageSize: 5, algebraList: [] };

const kScriptSet = new Set<string>(kScriptLayoutIds);
const kLatinSet = new Set<string>(kLatinLayoutIds);

// Latin values in the old schemaLayouts were per-schema arrangements, which no
// longer exist: the ACTIVE schema's becomes the global one (what "follow" already
// resolved to) and the rest are dropped.
export function migrateLayoutSettings(settings: ImeSettings): ImeSettings {
  if (settings.latinLayout === undefined && settings.schemaLayouts === undefined) {
    return settings;
  }

  const legacy = settings.schemaLayouts ?? {};
  const schemaKeys: Record<string, SchemaKeys> = { ...(settings.schemaKeys ?? {}) };
  for (const [id, layout] of Object.entries(legacy)) {
    if (kScriptSet.has(layout) && schemaKeys[id] === undefined) {
      schemaKeys[id] = layout as ScriptLayoutId;
    }
  }

  const activeLegacy = legacy[settings.schema];
  const keyboardLayout: LatinLayoutId = settings.keyboardLayout
    ?? (settings.latinLayout && settings.latinLayout !== 'follow' ? settings.latinLayout : undefined)
    ?? (activeLegacy && kLatinSet.has(activeLegacy) ? activeLegacy as LatinLayoutId : undefined)
    ?? 'qwerty';

  const next: ImeSettings = { ...settings, keyboardLayout };
  if (Object.keys(schemaKeys).length > 0) next.schemaKeys = schemaKeys;
  delete next.latinLayout;
  delete next.schemaLayouts;
  return next;
}

export function resolveKeyboardLayout(
  settings: Pick<ImeSettings, 'keyboardLayout'> | undefined,
): LatinLayoutId {
  return settings?.keyboardLayout ?? 'qwerty';
}

// Best-effort guess at the key set a schema paints. Keyword matching on id+name
// is deliberately simple: schemas are arbitrary user imports, so anything
// cleverer (parsing schema YAML) would still be a guess, just a slower one.
// Undefined for Latin-typed schemas (pinyin, wubi, cangjie…).
export function guessSchemaKeys(schemaId: string, schemaName?: string): ScriptLayoutId | undefined {
  const haystack = `${schemaId} ${schemaName ?? ''}`.toLowerCase();
  if (/zhuyin|bopomofo|注音/.test(haystack)) return 'zhuyin';
  // "jap" catches the store's jap_poly, whose id lacks the full word.
  if (/kana|japan|jap|nihon|日本|日文|假名|かな/.test(haystack)) return 'kana';
  // The Hangul key caps are specifically the standard 2-set (Dubeolsik)
  // arrangement. A Korean language name alone is not enough: HNC, Korean
  // Hanja and Hangul shape-code schemas all paint Latin mnemonic codes.
  if (/2[\s_-]*set|dubeolsik|du[\s_-]*beol[\s_-]*sik|두벌식/.test(haystack)) return 'hangul';
  return undefined;
}

// Undefined means letters.
export function resolveSchemaKeys(
  settings: Pick<ImeSettings, 'schemaKeys'> | undefined,
  schemaId: string,
  schemaName?: string,
): ScriptLayoutId | undefined {
  const corrected = settings?.schemaKeys?.[schemaId];
  if (corrected === 'latin') return undefined;
  if (corrected) return corrected;
  return guessSchemaKeys(schemaId, schemaName);
}

// Writing system of a schema, for the ASCII-toggle badge. Keyword matching on
// id+name (like guessSchemaKeys), with the bound layout as a fallback
// signal: romaji-driven Japanese schemas have a qwerty LAYOUT but are still
// Japanese, so the layout alone can't decide this.
export function guessScriptForSchema(
  schemaId: string,
  schemaName: string | undefined,
  layout: LayoutId,
): 'zh' | 'ja' | 'ko' {
  const haystack = `${schemaId} ${schemaName ?? ''}`.toLowerCase();
  // "poly" is the well-known Japanese kana-kanji Rime schema; 日语/日文 are
  // the usual Chinese-catalog names for Japanese schemas.
  if (/japan|kana|romaji|nihon|poly|日本|日语|日文|假名|かな|カナ|ローマ字/.test(haystack)) return 'ja';
  if (/korean|hangul|hangeul|谚文|한글|韩|韓|朝鲜/.test(haystack)) return 'ko';
  if (layout === 'kana') return 'ja';
  if (layout === 'hangul') return 'ko';
  return 'zh';
}

export function resolveLayoutForSchema(
  settings: Pick<ImeSettings, 'keyboardLayout' | 'schemaKeys'> | undefined,
  schemaId: string,
  schemaName?: string,
): LayoutId {
  return resolveSchemaKeys(settings, schemaId, schemaName) ?? resolveKeyboardLayout(settings);
}

// The historical default — matches RIME's own Control+grave convention.
export const kDefaultSchemaSwitchKey: SchemaSwitchKey = { code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false };

// Resolve the tri-state setting into the binding that is actually in effect.
// Returns null when switching is disabled.
export function resolveSchemaSwitchKey(binding: SchemaSwitchKey | null | undefined): SchemaSwitchKey | null {
  if (binding === undefined) return kDefaultSchemaSwitchKey;
  if (binding === null) return null;
  // Defensive: a stored binding without a code is meaningless → treat as disabled.
  if (!binding.code) return null;
  return binding;
}

// Pure predicate used on the hot key-event path. `event` only needs the four
// fields below, so it is trivially testable without a real KeyboardEvent.
export function matchesSchemaSwitchKey(
  event: { code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  binding: SchemaSwitchKey | null | undefined,
): boolean {
  const resolved = resolveSchemaSwitchKey(binding);
  if (!resolved) return false;
  return event.code === resolved.code
    && !!event.ctrlKey === !!resolved.ctrlKey
    && !!event.altKey === !!resolved.altKey
    && !!event.shiftKey === !!resolved.shiftKey;
}

const kFunctionKeyRe = /^F([1-9]|1[0-9]|2[0-4])$/;

// Function keys (F1-F24) are safe to bind without a modifier.
function isFunctionKey(code: string): boolean {
  return kFunctionKeyRe.test(code);
}

// Whether a candidate binding is safe to save: it must never swallow ordinary
// typing. Ctrl or Alt makes any key safe; function keys are safe on their own.
// Shift alone is NOT enough — Shift+letter/digit/punctuation IS ordinary typing
// (capital letters, symbols), so binding it would eat those characters.
export function isValidSchemaSwitchKey(binding: SchemaSwitchKey | null | undefined): boolean {
  if (binding === null || binding === undefined) return true; // disabled / default are both fine
  if (!binding.code) return false;
  if (binding.ctrlKey || binding.altKey) return true;
  return isFunctionKey(binding.code);
}

// Codes that never complete a recording on their own — the user may be holding
// them on the way to the final key of a combo.
const kModifierOnlyCodes = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
]);

// Outcome of one keydown observed while recording a new shortcut:
//   cancel  → Escape pressed, abort and keep the old binding
//   pending → modifier-only press, keep waiting for the final key
//   invalid → unsafe combo (would swallow plain typing), show error, keep recording
//   accept  → a valid binding was captured
export type RecordingKeyResult
  = | { kind: 'cancel' }
    | { kind: 'pending' }
    | { kind: 'invalid' }
    | { kind: 'accept'; binding: SchemaSwitchKey };

// The write-side counterpart of matchesSchemaSwitchKey: turns a recorded
// keydown into a SchemaSwitchKey, enforcing the same binding policy that
// isValidSchemaSwitchKey guards (this is domain logic, not UI wiring — the
// component keeps only the DOM listeners).
export function interpretRecordingKey(
  event: { code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
): RecordingKeyResult {
  if (event.code === 'Escape') return { kind: 'cancel' };
  if (kModifierOnlyCodes.has(event.code)) return { kind: 'pending' };
  // A binding cannot express Meta/Search — chrome.input.ime key events carry
  // no metaKey field, so the background could never match it. Recording the
  // combo without Meta would bind something broader than the user pressed;
  // reject it instead.
  if (event.metaKey) return { kind: 'invalid' };
  const binding: SchemaSwitchKey = {
    code: event.code,
    ctrlKey: !!event.ctrlKey,
    altKey: !!event.altKey,
    shiftKey: !!event.shiftKey,
  };
  if (!isValidSchemaSwitchKey(binding)) return { kind: 'invalid' };
  return { kind: 'accept', binding };
}

const kKeyCodeLabels: Record<string, string> = {
  Backquote: '`',
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Enter: 'Enter',
  Tab: 'Tab',
};

const kLetterCodeRe = /^Key([A-Z])$/;
const kDigitCodeRe = /^Digit([0-9])$/;

// Map a KeyboardEvent.code to a short human label ("KeyA" → "A", "Digit1" → "1").
export function keyCodeLabel(code: string): string {
  if (code in kKeyCodeLabels) return kKeyCodeLabels[code];
  const key = kLetterCodeRe.exec(code);
  if (key) return key[1];
  const digit = kDigitCodeRe.exec(code);
  if (digit) return digit[1];
  return code; // F-keys, Arrow*, etc. read fine as-is
}

// Render a binding as a display string ("Ctrl + `"). Returns "" when disabled
// so the caller can substitute a localized "Disabled" label.
export function formatSchemaSwitchKey(binding: SchemaSwitchKey | null | undefined): string {
  const resolved = resolveSchemaSwitchKey(binding);
  if (!resolved) return '';
  const parts: string[] = [];
  if (resolved.ctrlKey) parts.push('Ctrl');
  if (resolved.altKey) parts.push('Alt');
  if (resolved.shiftKey) parts.push('Shift');
  parts.push(keyCodeLabel(resolved.code));
  return parts.join(' + ');
}

export const $$ = chrome.i18n.getMessage;
