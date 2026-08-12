// @vitest-environment jsdom
//
// What App hands the session hook. Separate from the other App test because it
// replaces the hook with a spy — the tests there depend on the real one.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundToInputView, InputViewState } from '../lib/shared-types';

let post: ((message: BackgroundToInputView) => void) | null = null;
const sessionOptions: { zhVariant?: string }[] = [];

vi.mock('../entrypoints/inputview/chrome-shim', () => ({
  createHost: () => ({
    mock: false,
    typeStroke: vi.fn(),
    insertText: vi.fn(),
    readClipboard: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
    pasteClipboardItem: vi.fn(() => Promise.resolve(true)),
    deleteClipboardItem: vi.fn(() => Promise.resolve(true)),
    subscribeClipboard: vi.fn(() => () => {}),
    hideKeyboard: vi.fn(),
    keyboardLoaded: vi.fn(),
    openSettings: vi.fn(),
    openExtensionOptions: vi.fn(),
    setupContainer: vi.fn(() => Promise.resolve()),
    releaseContainer: vi.fn(() => Promise.resolve()),
    writePlacement: vi.fn(),
    readPlacement: vi.fn(() => Promise.resolve({ mode: 'docked', scale: 0.6, side: 'right' })),
    connect: vi.fn((onMessage: (message: BackgroundToInputView) => void) => {
      post = onMessage;
      return vi.fn();
    }),
  }),
  RealHost: class {},
}));
vi.mock('../entrypoints/inputview/voice/use-voice-session', () => ({
  useVoiceSession: (options: { zhVariant?: string }) => {
    sessionOptions.push(options);
    return {
      state: { kind: 'idle' as const },
      elapsedMs: 0,
      levels: [],
      prepare: vi.fn(),
      open: vi.fn(),
      retry: vi.fn(),
      stop: vi.fn(),
      close: vi.fn(),
    };
  },
}));

const App = (await import('../entrypoints/inputview/App')).default;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

function state(zhVariant?: InputViewState['zhVariant']): InputViewState {
  return {
    asciiMode: false,
    layout: 'qwerty',
    latinLayout: 'qwerty',
    script: 'zh',
    schemaId: 'aurora_pinyin',
    schemaName: '极光拼音',
    alphabet: 'abcdefghijklmnopqrstuvwxyz',
    numericField: null,
    passwordField: false,
    zhVariant,
  };
}

async function mountWith(zhVariant?: InputViewState['zhVariant']) {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    post?.({ kind: 'state', state: state(zhVariant) });
    await Promise.resolve();
  });
  return sessionOptions.at(-1);
}

beforeEach(() => {
  post = null;
  sessionOptions.length = 0;
});
afterEach(cleanup);

describe('the script the session asks for', () => {
  it('requests conversion while Rime is emitting traditional', async () => {
    // Voice text bypasses Rime, so a traditional document would otherwise
    // receive simplified insertions.
    expect((await mountWith('traditional'))?.zhVariant).toBe('traditional');
  });

  it('passes a regional standard through unchanged', async () => {
    expect((await mountWith('hk'))?.zhVariant).toBe('hk');
  });

  it('asks for nothing while Rime is emitting simplified', async () => {
    expect((await mountWith(undefined))?.zhVariant).toBeUndefined();
  });
});
