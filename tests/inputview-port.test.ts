import { beforeEach, describe, expect, it, vi } from 'vitest';

// Boot the real background main() with a stubbed chrome so we can drive the
// inputview port listener and the IME event listeners end to end. The regression
// under test: async controller calls in these listeners used to run without a
// catch, so a failed candidate action surfaced as an uncaught rejection on the
// chrome://extensions error page ("Cannot select candidate N").

vi.stubGlobal('defineBackground', (def: unknown) => def);
// The background scripts address the worker global as `self`.
vi.stubGlobal('self', globalThis);

const mocks = vi.hoisted(() => {
  const controller = {
    engineId: 'engine-1',
    context: null as unknown,
    activeSettings: { schema: 'aurora' },
    lastRightClickItem: -1,
    session: undefined as unknown,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    resetComposition: vi.fn(async () => { }),
    loadRime: vi.fn(async () => true),
    feedKey: vi.fn(),
    setContext: vi.fn(),
    selectCandidate: vi.fn(async () => { }),
    deleteCandidate: vi.fn(async () => { }),
    rightClick: vi.fn(),
    deactivate: vi.fn(),
    applySchemaSwitchKey: vi.fn(),
    handleInputViewVisibilityChanged: vi.fn(async () => { }),
    setAsciiMode: vi.fn(async () => { }),
    fetchMoreCandidates: vi.fn(async () => { }),
    refreshContext: vi.fn(async () => { }),
    clearContext: vi.fn(async () => { }),
    getAsciiMode: vi.fn(async () => false),
    getCurrentSchema: vi.fn(async () => 'aurora'),
    getRimeStatus: vi.fn(async () => ({ loading: false, loaded: true })),
    getCandidateSnapshot: vi.fn(() => ({ streamId: 'test', sequence: 0, candidates: [] })),
    printErr: vi.fn(),
    compileDictPack: vi.fn(async () => ({ status: 'success' })),
    classifyDictPackEntries: vi.fn(async () => ({ status: 'success' })),
    getLogs: vi.fn(() => []),
  };
  return { controller };
});

vi.mock('@/lib/messaging', () => ({
  onMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../entrypoints/background/controller', () => ({
  // Must be `new`-able: a function expression, not an arrow function.
  InputController: vi.fn(function () { return mocks.controller; }),
}));

vi.mock('../entrypoints/background/keepalive', () => ({
  serviceWorkerKeepalive: vi.fn(),
}));

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(async () => []),
}));

vi.mock('@/lib/utils', async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  getFs: vi.fn(async () => ({ readAll: vi.fn(async () => []) })),
}));

vi.mock('@/lib/schema-install', () => ({
  resolveInstalledSchemaId: vi.fn(() => 'aurora'),
}));

const backgroundModule = await import('../entrypoints/background/index');
const background = backgroundModule.default as { main: () => void };
const { refreshImeMenuItems } = backgroundModule;

type Listener = (...args: never[]) => unknown;

function listenerCollector() {
  const listeners: Listener[] = [];
  return {
    addListener: vi.fn((l: Listener) => listeners.push(l)),
    listeners,
  };
}

function makeFakePort() {
  const messageListeners: Array<(msg: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name: 'inputviewMessages',
    postMessage: vi.fn(),
    onMessage: { addListener: (l: (msg: unknown) => void) => messageListeners.push(l) },
    onDisconnect: { addListener: (l: () => void) => disconnectListeners.push(l) },
    emitMessage: (msg: unknown) => { for (const l of messageListeners) l(msg); },
    emitDisconnect: () => { for (const l of disconnectListeners) l(); },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function bootBackground() {
  const ime = {
    onFocus: listenerCollector(),
    onBlur: listenerCollector(),
    onReset: listenerCollector(),
    onKeyEvent: listenerCollector(),
    onCandidateClicked: listenerCollector(),
    onMenuItemActivated: listenerCollector(),
    onActivate: listenerCollector(),
    onDeactivated: listenerCollector(),
    keyEventHandled: vi.fn(),
    setMenuItems: vi.fn(),
  };
  const onConnect = listenerCollector();
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => key },
    runtime: { onConnect, lastError: null, sendMessage: vi.fn() },
    storage: {
      sync: {
        get: vi.fn(async () => ({ settings: { schema: 'aurora', pageSize: 5, algebraList: [] } })),
        set: vi.fn(async () => { }),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => { }) },
      local: { set: vi.fn(async () => { }) },
      onChanged: listenerCollector(),
    },
    input: { ime },
  });

  background.main();
  // Let the async startup chain (settings load → postLoad) settle so the
  // IME listeners are registered.
  await flush();
  await flush();

  expect(onConnect.listeners).toHaveLength(1);
  expect(ime.onKeyEvent.listeners).toHaveLength(1);

  const port = makeFakePort();
  onConnect.listeners[0](port as never);
  return { ime, port };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.controller.engineId = 'engine-1';
  mocks.controller.context = null;
  mocks.controller.selectCandidate.mockResolvedValue(undefined);
  mocks.controller.deleteCandidate.mockResolvedValue(undefined);
  mocks.controller.handleInputViewVisibilityChanged.mockResolvedValue(undefined);
  mocks.controller.setAsciiMode.mockResolvedValue(undefined);
  mocks.controller.fetchMoreCandidates.mockResolvedValue(undefined);
  mocks.controller.refreshContext.mockResolvedValue(undefined);
  mocks.controller.clearContext.mockResolvedValue(undefined);
  mocks.controller.loadRime.mockResolvedValue(true);
  mocks.controller.getCandidateSnapshot.mockReturnValue({ streamId: 'test', sequence: 0, candidates: [] });
});

describe('inputview port message handling', () => {
  it('selects the tapped candidate by its global index', async () => {
    const { port } = await bootBackground();

    port.emitMessage({ kind: 'selectCandidate', index: 4 });
    await flush();

    expect(mocks.controller.selectCandidate).toHaveBeenCalledWith(4, false);
  });

  it('reports a stale tap without leaving an unhandled rejection', async () => {
    const { port } = await bootBackground();
    mocks.controller.selectCandidate.mockRejectedValueOnce(new Error('Cannot select candidate 4'));

    // An unhandled rejection here would fail the test run.
    port.emitMessage({ kind: 'selectCandidate', index: 4 });
    await flush();

    expect(mocks.controller.printErr).toHaveBeenCalledWith(expect.stringContaining('selectCandidate'));
  });

  it('ignores malformed select_candidate payloads', async () => {
    const { port } = await bootBackground();

    port.emitMessage({ kind: 'selectCandidate' });
    port.emitMessage({ kind: 'selectCandidate', index: 'not-a-number' });
    port.emitMessage({ kind: 'selectCandidate', index: Infinity });
    port.emitMessage({ kind: 'selectCandidate', index: 1.5 });
    port.emitMessage({ kind: 'selectCandidate', index: -1 });
    port.emitMessage({ kind: 'deleteCandidate', index: Number.NaN });
    port.emitMessage(null);
    port.emitMessage('bogus');
    await flush();

    expect(mocks.controller.selectCandidate).not.toHaveBeenCalled();
    expect(mocks.controller.deleteCandidate).not.toHaveBeenCalled();
  });

  it('ignores non-finite, fractional, and non-positive pagination counts', async () => {
    const { port } = await bootBackground();

    port.emitMessage({ kind: 'loadMoreCandidates', count: Infinity });
    port.emitMessage({ kind: 'loadMoreCandidates', count: Number.NaN });
    port.emitMessage({ kind: 'loadMoreCandidates', count: 1.5 });
    port.emitMessage({ kind: 'loadMoreCandidates', count: 0 });
    port.emitMessage({ kind: 'loadMoreCandidates', count: -1 });
    await flush();

    expect(mocks.controller.fetchMoreCandidates).not.toHaveBeenCalled();
  });

  it('does not persist or reload an empty schema id', async () => {
    const { port } = await bootBackground();
    const chromeStub = globalThis.chrome as never as {
      storage: { sync: { set: ReturnType<typeof vi.fn> } };
    };
    chromeStub.storage.sync.set.mockClear();
    mocks.controller.loadRime.mockClear();

    port.emitMessage({ kind: 'switchSchema', schemaId: '' });
    port.emitMessage({ kind: 'switchSchema', schemaId: '   ' });
    await flush();

    expect(chromeStub.storage.sync.set).not.toHaveBeenCalled();
    expect(mocks.controller.loadRime).not.toHaveBeenCalled();
  });

  it('visibility and language toggles survive controller rejections', async () => {
    const { port } = await bootBackground();
    mocks.controller.handleInputViewVisibilityChanged.mockRejectedValueOnce(new Error('boom'));
    mocks.controller.setAsciiMode.mockRejectedValueOnce(new Error('boom'));
    mocks.controller.fetchMoreCandidates.mockRejectedValueOnce(new Error('boom'));

    port.emitMessage({ kind: 'visibility', visible: true });
    port.emitMessage({ kind: 'setAsciiMode', asciiMode: false });
    port.emitMessage({ kind: 'loadMoreCandidates', count: 150 });
    await flush();

    expect(mocks.controller.handleInputViewVisibilityChanged).toHaveBeenCalledWith(true);
    expect(mocks.controller.setAsciiMode).toHaveBeenCalledWith(false);
    expect(mocks.controller.fetchMoreCandidates).toHaveBeenCalledWith(150);
  });
});

describe('system candidate window and key events', () => {
  it('a stale system-window click is swallowed', async () => {
    const { ime } = await bootBackground();
    mocks.controller.selectCandidate.mockRejectedValueOnce(new Error('Cannot select candidate 2'));

    ime.onCandidateClicked.listeners[0]('engine-1' as never, 2 as never, 'left' as never);
    await flush();

    expect(mocks.controller.selectCandidate).toHaveBeenCalledWith(2);
    expect(mocks.controller.lastRightClickItem).toBe(-1);
  });

  it('an async feedKey failure still answers the key event as unhandled', async () => {
    const { ime } = await bootBackground();
    mocks.controller.feedKey.mockReturnValueOnce(Promise.reject(new Error('engine crashed')));

    const result = ime.onKeyEvent.listeners[0](
      'engine-1' as never,
      { type: 'keydown', key: 'a', code: 'KeyA' } as never,
      'req-7' as never,
    );
    await flush();

    expect(result).toBeUndefined();
    expect((globalThis.chrome as never as { input: { ime: { keyEventHandled: ReturnType<typeof vi.fn> } } })
      .input.ime.keyEventHandled).toHaveBeenCalledWith('req-7', false);
  });

  it('refreshImeMenuItems never rejects, even when storage fails', async () => {
    await bootBackground();
    const chromeStub = globalThis.chrome as never as {
      storage: { sync: { get: ReturnType<typeof vi.fn> } };
    };
    chromeStub.storage.sync.get.mockRejectedValueOnce(new Error('storage gone'));

    // It is fired unawaited from several listeners; a rejection here
    // would be uncaught.
    await expect(refreshImeMenuItems()).resolves.toBeUndefined();
  });

  it('menu item activation survives a storage failure', async () => {
    const { ime } = await bootBackground();
    const chromeStub = globalThis.chrome as never as {
      storage: { sync: { get: ReturnType<typeof vi.fn> } };
    };
    mocks.controller.activeSettings = { schema: 'aurora' };
    chromeStub.storage.sync.get.mockRejectedValueOnce(new Error('storage gone'));

    ime.onMenuItemActivated.listeners[0]('engine-1' as never, 'luna' as never);
    await flush();

    expect(mocks.controller.loadRime).not.toHaveBeenCalledWith(true);
  });

  it('a failing clearContext on blur is swallowed', async () => {
    const { ime } = await bootBackground();
    mocks.controller.context = { contextID: 9 };
    mocks.controller.clearContext.mockRejectedValueOnce(new Error('boom'));

    ime.onBlur.listeners[0](9 as never);
    await flush();

    expect(mocks.controller.clearContext).toHaveBeenCalledTimes(1);
  });

  it('a successful async feedKey answers with the handled flag', async () => {
    const { ime } = await bootBackground();
    mocks.controller.feedKey.mockReturnValueOnce(Promise.resolve(true));

    ime.onKeyEvent.listeners[0](
      'engine-1' as never,
      { type: 'keydown', key: 'a', code: 'KeyA' } as never,
      'req-8' as never,
    );
    await flush();

    expect((globalThis.chrome as never as { input: { ime: { keyEventHandled: ReturnType<typeof vi.fn> } } })
      .input.ime.keyEventHandled).toHaveBeenCalledWith('req-8', true);
  });
});
