// @vitest-environment jsdom
//
// Two decisions that only exist where App wires the pieces together: whether
// the microphone is offered at all, and what happens to a running session when
// it stops being allowed. Both are security-shaped, and both are invisible from
// the modules underneath.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundToInputView, InputViewState } from '../entrypoints/inputview/../../lib/shared-types';

const insertText = vi.fn();
const openExtensionOptions = vi.fn();
let post: ((message: BackgroundToInputView) => void) | null = null;

const fakeHost = {
  mock: false,
  typeStroke: vi.fn(),
  insertText,
  readClipboard: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
  pasteClipboardItem: vi.fn(() => Promise.resolve(true)),
  deleteClipboardItem: vi.fn(() => Promise.resolve(true)),
  subscribeClipboard: vi.fn(() => () => {}),
  hideKeyboard: vi.fn(),
  keyboardLoaded: vi.fn(),
  openSettings: vi.fn(),
  openExtensionOptions,
  setupContainer: vi.fn(() => Promise.resolve()),
  releaseContainer: vi.fn(() => Promise.resolve()),
  writePlacement: vi.fn(),
  readPlacement: vi.fn(() => Promise.resolve({ mode: 'docked', scale: 0.6, side: 'right' })),
  connect: vi.fn((onMessage: (message: BackgroundToInputView) => void) => {
    post = onMessage;
    return vi.fn();
  }),
};

vi.mock('../entrypoints/inputview/chrome-shim', () => ({
  createHost: () => fakeHost,
  RealHost: class {},
}));
// A build with a key: the microphone is otherwise never offered, and these
// tests are about the other three conditions.
vi.mock('../entrypoints/inputview/voice/credentials', () => ({
  readCredentials: () => ({ apiKey: 'k', resourceId: 'r' }),
  hydrateCredentials: async () => {},
  watchCredentials: () => () => {},
}));
vi.mock('../entrypoints/inputview/voice/settings', async original => ({
  ...(await original<object>()),
  readVoiceSettings: () => Promise.resolve({ enabled: true, consent: true }),
  readVoiceUid: () => Promise.resolve('uid'),
  watchVoiceSettings: () => () => {},
}));

const App = (await import('../entrypoints/inputview/App')).default;

function state(overrides: Partial<InputViewState> = {}): InputViewState {
  return {
    asciiMode: false,
    layout: 'qwerty',
    latinLayout: 'qwerty',
    script: 'zh',
    schemaId: 'aurora_pinyin',
    schemaName: '极光拼音',
    numericField: null,
    passwordField: false,
    ...overrides,
  };
}

const flush = () => act(async () => { await Promise.resolve(); });

async function send(next: InputViewState) {
  await act(async () => {
    post?.({ kind: 'state', state: next });
    await Promise.resolve();
  });
}

/** The toolbar's microphone, present only when voice is on offer. */
function micButton() {
  return screen.queryByLabelText('vk_voice');
}

// jsdom has no ResizeObserver and the candidate bar measures itself with one.
// Defined once rather than stubbed per test: unstubbing globals would also
// remove the `chrome` stub that tests/setup.ts installs at load, and every
// assertion about an ABSENT control would then pass for the wrong reason.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  post = null;
  Object.defineProperty(window, 'innerWidth', { value: 1080, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 320, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Every "the microphone is withheld" assertion needs this: without it the
 *  test passes just as happily when the toolbar failed to render at all. */
async function toolbarRendered() {
  return Boolean(await screen.findByLabelText('vk_settings'));
}

describe('offering the microphone', () => {
  it('withholds it on the fallback board, where the field type is unknown', async () => {
    // A dead or slow background leaves the keyboard drawing its fallback board.
    // It is a complete, usable keyboard — and nothing in it says whether the
    // caret is in a password box. Offering dictation exactly when the security
    // signal is missing is the wrong side to err on.
    vi.useFakeTimers();
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    vi.useRealTimers();

    expect(await toolbarRendered()).toBe(true);
    expect(micButton()).toBeNull();
  });

  it('offers it once the background reports an ordinary text field', async () => {
    render(<App />);
    await flush();
    await send(state());
    expect(await screen.findByLabelText('vk_voice')).toBeTruthy();
  });

  it('withholds it in a password field', async () => {
    render(<App />);
    await flush();
    await send(state({ passwordField: true }));
    expect(await toolbarRendered()).toBe(true);
    expect(micButton()).toBeNull();
  });

  it('withholds it on a schema the model cannot transcribe', async () => {
    // Japanese, and the guessed script says 'zh' for it — the schema id is what
    // decides, so the keyboard withholds the button anyway.
    render(<App />);
    await flush();
    await send(state({ schemaId: 'KappaJP', schemaName: '河童五笔' }));
    expect(await toolbarRendered()).toBe(true);
    expect(micButton()).toBeNull();
  });
});

describe('losing availability mid-session', () => {
  it('leaves the panel when focus moves into a password field', async () => {
    render(<App />);
    await flush();
    await send(state());

    const mic = await screen.findByLabelText('vk_voice');
    await act(async () => {
      fireEvent.click(mic);
      await Promise.resolve();
    });
    expect(document.querySelector('.kb-voice')).not.toBeNull();

    // Only the toolbar button would disappear otherwise: the panel and its
    // session would stay live, and recognised text would land in the password
    // field that just took focus.
    await send(state({ passwordField: true }));

    expect(document.querySelector('.kb-voice')).toBeNull();
    expect(micButton()).toBeNull();
  });
});
