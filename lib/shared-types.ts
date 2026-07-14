
export interface RimeSchema {
    id: string;
    name: string;
}

export interface RimeContext {
    composition: {
        length: number;
        cursorPosition: number;
        selectionStart: number;
        selectionEnd: number;
        preedit: string;
    };

    menu: {
        pageSize: number;
        pageNumber: number;
        isLastPage: boolean;
        highlightedCandidateIndex: number;
        candidates: Array<{
            text: string;
            comment: string;
        }>
    };

    selectKeys: string;
    commitTextPreview: string;
    selectLabels: string[];
}

export interface RimeCommit {
    text: string;
}

export interface RimeStatus {
    schemaId: string;
    schemaName: string;
    isDisabled: boolean;
    isComposing: boolean;
    isAsciiMode: boolean;
    isFullShape: boolean;
    isSimplified: boolean;
    isTraditional: boolean;
    isAsciiPunct: boolean;
}

export interface RimeCandidate {
    index: number;
    text: string;
    comment: string;
}

// ---------------------------------------------------------------------------
// InputView ↔ background port protocol
//
// The InputView (on-screen keyboard page) talks to the background over a
// long-lived runtime port. Key presses do NOT travel this port — they are
// injected via chrome.virtualKeyboardPrivate.sendKeyEvent so they take the
// same path as physical keys (see docs/adr/0001). The port only carries
// IME-state sync and candidate traffic.
// ---------------------------------------------------------------------------

export const kInputViewPortName = "inputviewMessages";

// How the user's letters are arranged. One answer, used everywhere: the
// physical remap, the InputView's letter keys, and English mode on both.
export const kLatinLayoutIds = ["qwerty", "colemak", "dvorak"] as const;
export type LatinLayoutId = typeof kLatinLayoutIds[number];

// Key sets a schema paints instead of letters — a fact about the schema, not a
// preference. Only the InputView can honour them; a physical keyboard has
// whatever is printed on it.
export const kScriptLayoutIds = ["zhuyin", "kana", "hangul"] as const;
export type ScriptLayoutId = typeof kScriptLayoutIds[number];

export const kLayoutIds = [...kLatinLayoutIds, ...kScriptLayoutIds] as const;
export type LayoutId = typeof kLayoutIds[number];

/** A candidate as displayed in the InputView candidate bar. `index` is the
 *  global candidate index understood by InputController.selectCandidate. */
export interface InputViewCandidate {
    text: string;
    index: number;
}

/** Writing system of the active schema — drives the language badge on the
 *  ASCII toggle (中/英 vs あ/A vs 한/A). Independent of the layout: Japanese
 *  Rime schemas are typically romaji-driven, so their LAYOUT is qwerty while
 *  their script is 'ja'. */
export type ScriptId = "zh" | "ja" | "ko";

/** Focused-field kind that routes the keyboard to a compact numberpad instead
 *  of letters. Derived from chrome.input.ime InputContext.type; `null` (any
 *  other field type) renders the normal letter keyboard. `number` gets a
 *  decimal pad (.-,), `tel` a phone pad (*#+). */
export type NumericFieldKind = "number" | "tel";

/** Everything the InputView needs to render the right keyboard. Sent as one
 *  atomic snapshot so the page never sees layout and ASCII state out of sync. */
export interface InputViewState {
    asciiMode: boolean;
    /** Layout bound to the active schema; shown when not in ASCII mode. */
    layout: LayoutId;
    /** Global Latin layout; shown in ASCII mode and password fields. */
    latinLayout: LatinLayoutId;
    script: ScriptId;
    schemaId: string;
    schemaName: string;
    /** Set when the focused field is numeric — the keyboard renders a
     *  numberpad rather than letters. `null` for ordinary text fields. */
    numericField: NumericFieldKind | null;
}

export type BackgroundToInputView =
    | { kind: "state"; state: InputViewState }
    | { kind: "candidates"; candidates: InputViewCandidate[] }
    | { kind: "schemaList"; schemas: Array<{ id: string; label: string }>; activeSchema: string };

export type InputViewToBackground =
    | { kind: "visibility"; visible: boolean }
    | { kind: "setAsciiMode"; asciiMode: boolean }
    | { kind: "selectCandidate"; index: number }
    | { kind: "deleteCandidate"; index: number }
    | { kind: "loadMoreCandidates"; count: number }
    | { kind: "switchSchema"; schemaId: string }
    | { kind: "getSchemaList" };