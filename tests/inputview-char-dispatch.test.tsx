// @vitest-environment jsdom
//
// Drives the real App with real layouts and asserts where each char key
// routes: a stroke through the engine (host.typeStroke) or a literal insert
// (insertLiteral posted to the background). This is the tap-time half of the
// classifyChar contract — the pure matrix is pinned in inputview-char-policy.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundToInputView, InputViewState, InputViewToBackground } from '../lib/shared-types';

let onMessage: ((msg: BackgroundToInputView) => void) | null = null;
const post = vi.fn<(msg: InputViewToBackground) => void>();

const fakeHost = {
  mock: true,
  typeStroke: vi.fn(),
  insertText: vi.fn(),
  readClipboard: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
  pasteClipboardItem: vi.fn(() => Promise.resolve(true)),
  deleteClipboardItem: vi.fn(() => Promise.resolve(true)),
  subscribeClipboard: vi.fn(() => () => {}),
  hideKeyboard: vi.fn(),
  keyboardLoaded: vi.fn(),
  openSettings: vi.fn(),
  setupContainer: vi.fn(() => Promise.resolve()),
  releaseContainer: vi.fn(() => Promise.resolve()),
  readPlacement: vi.fn(() => Promise.resolve({ mode: 'docked' as const, scale: 0.6, side: 'right' as const })),
  writePlacement: vi.fn(),
  connect: vi.fn((cb: (msg: BackgroundToInputView) => void) => {
    onMessage = cb;
    return post;
  }),
};

vi.mock('../entrypoints/inputview/chrome-shim', () => ({
  createHost: () => fakeHost,
  RealHost: class {},
}));

const App = (await import('../entrypoints/inputview/App')).default;

const kDachen = 'abcdefghijklmnopqrstuvwxyz1234567890-;,./';
const kLuna = 'zyxwvutsrqponmlkjihgfedcba';
const kTerra = 'zyxwvutsrqponmlkjihgfedcba12345';

const baseState: InputViewState = {
  asciiMode: false,
  layout: 'qwerty',
  latinLayout: 'qwerty',
  script: 'zh',
  schemaId: 'luna_pinyin',
  schemaName: '拼音',
  alphabet: kLuna,
  numericField: null,
};

const flush = () => act(async () => { await Promise.resolve(); });

async function mountWith(state: Partial<InputViewState>) {
  render(<App />);
  await flush();
  await act(async () => {
    onMessage?.({ kind: 'state', state: { ...baseState, ...state } });
    await Promise.resolve();
  });
}

async function tap(name: string) {
  // Function keys carry i18n aria-labels; the test i18n stub echoes the key.
  const toSym = name === '?123' ? 'vk_key_symbols' : name;
  const key = screen.getByRole('button', { name: toSym });
  await act(async () => {
    fireEvent.pointerDown(key, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(key, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
    await Promise.resolve();
  });
}

const literals = () => post.mock.calls
  .filter(([m]) => m.kind === 'insertLiteral')
  .map(([m]) => (m as { text: string }).text);

beforeEach(() => {
  Object.defineProperty(window, 'screen', {
    value: { width: 1080, height: 800 },
    configurable: true,
  });
  // jsdom has no ResizeObserver; the candidate bar measures itself with one.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onMessage = null;
});

describe('char key dispatch through the real App', () => {
  it('大千: bottom-row ，and symbol-page digits insert literally; ！strokes', async () => {
    await mountWith({ layout: 'zhuyin', schemaId: 'bopomofo', schemaName: '注音', alphabet: kDachen });

    await tap('，');
    expect(literals()).toEqual(['，']);

    await tap('?123');
    await tap('1'); // digit ∈ alphabet on a script layout → literal
    await tap('￥'); // no ASCII identity → literal
    expect(literals()).toEqual(['，', '1', '￥']);

    await tap('！'); // ! ∉ alphabet → the punctuator owns it
    expect(fakeHost.typeStroke).toHaveBeenCalledTimes(1);
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: '!' }));
  });

  it('拼音: bottom-row ，strokes through the punctuator, unchanged', async () => {
    await mountWith({});

    await tap('，');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });

  it('声调 schema: symbol-page digits stroke so tones stay typable', async () => {
    await mountWith({ schemaId: 'terra_pinyin', alphabet: kTerra });

    await tap('?123');
    await tap('1');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: '1' }));
    expect(literals()).toEqual([]);
  });

  it('numpad digits always insert literally, never compose', async () => {
    await mountWith({ schemaId: 'terra_pinyin', alphabet: kTerra, numericField: 'number' });

    await tap('1');
    expect(literals()).toEqual(['1']);
    expect(fakeHost.typeStroke).not.toHaveBeenCalled();
  });

  it('the ABC escape hatch leaves numpad mode: normal classification resumes', async () => {
    // The field is still numeric, but the user left the pad for the letter
    // keyboard — the numpad override keys off the visible pad, not off the
    // field type, so its bottom-row ，goes back to the punctuator.
    await mountWith({ numericField: 'number' }); // luna pinyin
    await tap('ABC');
    await tap('，');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });

  it('re-routes the same key when a schema switch changes the alphabet', async () => {
    await mountWith({}); // luna pinyin: ，defers to the punctuator
    await tap('，');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);

    // Switching schema pushes a fresh state; the very same key must now
    // insert literally — 大千 claims ',' for ㄝ.
    await act(async () => {
      onMessage?.({
        kind: 'state',
        state: { ...baseState, layout: 'zhuyin', schemaId: 'bopomofo', schemaName: '注音', alphabet: kDachen },
      });
      await Promise.resolve();
    });
    await tap('，');
    expect(literals()).toEqual(['，']);
    expect(fakeHost.typeStroke).toHaveBeenCalledTimes(1); // still just the pinyin tap
  });

  it('an open symbol page swaps script glyphs when the switch changes script', async () => {
    await mountWith({}); // zh
    await tap('?123');
    expect(screen.getByRole('button', { name: '！' })).toBeTruthy();

    await act(async () => {
      onMessage?.({
        kind: 'state',
        state: { ...baseState, schemaId: 'jap_poly', schemaName: '日本語', script: 'ja', alphabet: '' },
      });
      await Promise.resolve();
    });
    // Still on the symbol layer; the page now paints Japanese glyphs.
    await tap('「');
    expect(literals()).toEqual(['「']);
  });

  it('ASCII mode strokes without consulting the classifier', async () => {
    await mountWith({ asciiMode: true });

    await tap(',');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });
});

// The options page lets users override the guessed key caps per schema
// (schemaKeys). Classification reads vk.layout — which already reflects the
// override — so crossed configurations must stay coherent per key.
describe('crossed layout corrections (schemaKeys overrides)', () => {
  it('注音方案配字母键帽: alphabet chars stroke — the full desktop experience', async () => {
    // An expert 大千 typist forced letter caps: ',' must compose ㄝ and '1'
    // must compose ㄅ, exactly like a physical keyboard. Literal here would
    // leave ㄝ with no entry point at all. (Known trade: the bottom-row cap
    // still paints ，while composing ㄝ — pre-existing expert-mode cost.)
    await mountWith({ layout: 'qwerty', schemaId: 'bopomofo', schemaName: '注音', alphabet: kDachen });

    await tap('，');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));

    await tap('?123');
    await tap('1');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: '1' }));
    expect(literals()).toEqual([]);
  });

  it('拼音方案配注音键帽: caps stroke 大千 keys, char keys follow the pinyin alphabet', async () => {
    await mountWith({ layout: 'zhuyin', schemaId: 'luna_pinyin', alphabet: kLuna });

    // Main-layer caps are plain strokes — the engine sees 大千's '1'.
    await tap('ㄅ');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: '1' }));

    // ',' ∉ luna alphabet → the punctuator keeps 全角 duty.
    await tap('，');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });
});

// Habits users formed on 3.0.x (Google inputview: baked glyph tables +
// literal insertText for anything without a physical key) and on 3.1 —
// pinned per persona so upgrades never move typed output under anyone.
describe('user behavior continuity', () => {
  it('拼音: symbol-page digits are half-width inserts, never candidate selection', async () => {
    await mountWith({}); // luna
    await tap('?123');
    await tap('1');
    expect(literals()).toEqual(['1']);
    expect(fakeHost.typeStroke).not.toHaveBeenCalled();
  });

  it('拼音: quotes are separate literal open/close glyphs, like the 3.0.x tables', async () => {
    await mountWith({});
    await tap('?123');
    await tap('“');
    expect(literals()).toEqual(['“']);
  });

  it('注音: ；inserts the full-width glyph instead of composing ㄤ', async () => {
    await mountWith({ layout: 'zhuyin', schemaId: 'bopomofo', alphabet: kDachen });
    await tap('?123');
    await tap('；');
    expect(literals()).toEqual(['；']);
  });

  it('韩文: caps are honest — jamo compose, bottom-row comma is ASCII', async () => {
    await mountWith({ layout: 'hangul', script: 'ko', schemaId: 'hangeul2set', alphabet: '' });

    await tap('ㅂ'); // jamo cap injects its Latin keystroke for the schema
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: 'q' }));

    // Korean writes Western punctuation: the cap shows ',' (not ，) and the
    // stroke passes through the engine as-is.
    await tap(',');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });

  it('日文罗马字: 、defers to the schema punctuator, same as 3.1', async () => {
    await mountWith({ script: 'ja', schemaId: 'jap_poly', schemaName: '日本語', alphabet: '' });
    await tap('、');
    expect(fakeHost.typeStroke).toHaveBeenCalledWith(expect.objectContaining({ key: ',' }));
    expect(literals()).toEqual([]);
  });
});
