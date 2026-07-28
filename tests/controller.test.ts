import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import type { ImeSettings } from '../lib/utils';

const mocks = vi.hoisted(() => ({
  listEnabledInstalledSchemas: vi.fn(),
  fs: {
    readEntryRaw: vi.fn(async (_path: string) => true),
    createDirectory: vi.fn(async () => { }),
    readWholeFile: vi.fn(async (_path: string) => new Uint8Array()),
    writeWholeFile: vi.fn(async () => { }),
  },
  getFs: vi.fn(),
  createSession: vi.fn((schema: string) => ({
    addListener: vi.fn(),
    destroy: vi.fn(),
    getContext: vi.fn(async () => null),
    getOption: vi.fn(async () => false),
    getOptionLabel: vi.fn(async () => ''),
    getStatus: vi.fn(async () => ({ schemaId: schema })),
    processKey: vi.fn(async () => true),
    setOption: vi.fn(async () => { }),
  })),
  createEngine: vi.fn(),
  RimeEngine: vi.fn(function () {
    return mocks.createEngine();
  }),
}));

vi.mock('../entrypoints/background/engine', () => ({
  RimeEngine: mocks.RimeEngine,
}));

// Use the real helpers (matchesSchemaSwitchKey et al.) but stub getFs and pin
// kDefaultSettings so the controller has no schemaSwitchKey by default (→ Ctrl+`).
vi.mock('@/lib/utils', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../lib/utils')>();
  return {
    ...actual,
    getFs: mocks.getFs,
    kDefaultSettings: {
      schema: 'aurora',
      pageSize: 5,
      algebraList: [],
    },
  };
});

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: mocks.listEnabledInstalledSchemas,
}));

const { InputController } = await import('../entrypoints/background/controller');
// Resolves to the mocked module — the same kDefaultSettings object the controller sees.
const { kDefaultSettings } = await import('../lib/utils');

function stubChrome(settings?: ImeSettings) {
  let storedSettings = settings;
  const get = vi.fn(async () => ({ settings: storedSettings }));
  const set = vi.fn(async (obj: { settings?: ImeSettings }) => {
    if (obj.settings) {
      storedSettings = obj.settings;
    }
  });
  const sendMessage = vi.fn();

  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
    },
    runtime: {
      lastError: null,
      sendMessage,
    },
    storage: {
      sync: { get, set },
    },
    input: {
      ime: {},
    },
  });

  return { get, set, sendMessage };
}

function settings(overrides: Partial<ImeSettings> = {}): ImeSettings {
  return {
    schema: 'aurora',
    pageSize: 5,
    algebraList: [],
    ...overrides,
  };
}

describe('InputController schema switching', () => {
  beforeEach(() => {
    mocks.listEnabledInstalledSchemas.mockReset();
    mocks.fs.readEntryRaw.mockClear();
    mocks.fs.createDirectory.mockClear();
    mocks.fs.readWholeFile.mockClear();
    mocks.fs.writeWholeFile.mockClear();
    mocks.getFs.mockReset();
    mocks.getFs.mockResolvedValue(mocks.fs);
    mocks.createSession.mockClear();
    mocks.createEngine.mockReset();
    mocks.createEngine.mockImplementation(() => ({
      createSession: vi.fn(async (schema: string) => mocks.createSession(schema)),
      destroy: vi.fn(),
      initialize: vi.fn(async () => { }),
      rebuildPrism: vi.fn(async () => { }),
    }));
    mocks.RimeEngine.mockClear();
  });

  it('cycles to the next enabled installed schema and reloads RIME', async () => {
    const chromeMock = stubChrome(settings({
      schema: 'aurora',
      enabledSchemas: ['aurora', 'luna'],
    }));
    mocks.listEnabledInstalledSchemas.mockResolvedValue([
      { id: 'aurora', label: 'Aurora' },
      { id: 'luna', label: 'Luna' },
    ]);
    const controller = new InputController();
    const loadRime = vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

    await controller.cycleToNextSchema();

    expect(mocks.listEnabledInstalledSchemas).toHaveBeenCalledWith('aurora', ['aurora', 'luna']);
    expect(chromeMock.set).toHaveBeenCalledWith({
      settings: {
        schema: 'luna',
        pageSize: 5,
        algebraList: [],
        enabledSchemas: ['aurora', 'luna'],
      },
    });
    expect(loadRime).toHaveBeenCalledWith(true);
  });

  it('wraps from the last schema to the first schema', async () => {
    const chromeMock = stubChrome(settings({ schema: 'luna' }));
    mocks.listEnabledInstalledSchemas.mockResolvedValue([
      { id: 'aurora', label: 'Aurora' },
      { id: 'luna', label: 'Luna' },
    ]);
    const controller = new InputController();
    vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

    await controller.cycleToNextSchema();

    expect(chromeMock.set).toHaveBeenCalledWith({
      settings: {
        schema: 'aurora',
        pageSize: 5,
        algebraList: [],
      },
    });
  });

  it('does not switch when fewer than two schemas are available', async () => {
    const chromeMock = stubChrome(settings({ schema: 'aurora' }));
    mocks.listEnabledInstalledSchemas.mockResolvedValue([{ id: 'aurora', label: 'Aurora' }]);
    const controller = new InputController();
    const loadRime = vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

    await controller.cycleToNextSchema();

    expect(chromeMock.set).not.toHaveBeenCalled();
    expect(loadRime).not.toHaveBeenCalled();
  });

  it('swallows Ctrl+Backquote keydown and cycles schemas', async () => {
    stubChrome(settings());
    mocks.listEnabledInstalledSchemas.mockResolvedValue([
      { id: 'aurora', label: 'Aurora' },
      { id: 'luna', label: 'Luna' },
    ]);
    const controller = new InputController();
    const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    const handled = await controller.feedKey({
      type: 'keydown',
      code: 'Backquote',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(true);
    expect(cycleToNextSchema).toHaveBeenCalledTimes(1);
  });

  it('cycles from index 0 when the active schema is not in the enabled list', async () => {
    // Simulates a stale setting where the saved schema no longer exists.
    // idx = -1 → clamped to 0 → next = index 1.
    const chromeMock = stubChrome(settings({ schema: 'stale' }));
    mocks.listEnabledInstalledSchemas.mockResolvedValue([
      { id: 'aurora', label: 'Aurora' },
      { id: 'luna', label: 'Luna' },
    ]);
    const controller = new InputController();
    vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

    await controller.cycleToNextSchema();

    expect(chromeMock.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ schema: 'luna' }),
    });
  });

  it('swallows the keyup of a swallowed keydown without cycling twice', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    await controller.feedKey({
      type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    const handled = controller.feedKey({
      type: 'keyup', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(true);
    expect(cycleToNextSchema).toHaveBeenCalledTimes(1);
  });

  it('swallows the keyup even when modifiers were released before the main key', async () => {
    // Press Ctrl+`, cycle fires; release Ctrl first, then `. The `Backquote`
    // keyup arrives with ctrlKey=false and must still be swallowed so the
    // page never sees a stray release without its press.
    stubChrome(settings());
    const controller = new InputController();
    vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    await controller.feedKey({
      type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    const handled = controller.feedKey({
      type: 'keyup', code: 'Backquote', ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(true);
  });

  it('does not swallow a keyup whose keydown was not intercepted', () => {
    // Binding is default Ctrl+`; a bare Ctrl+` keyup with no swallowed
    // keydown (e.g. the press happened before the IME took focus) must be
    // forwarded, not eaten.
    stubChrome(settings());
    const controller = new InputController();
    const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    const handled = controller.feedKey({
      type: 'keyup', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(false);
    expect(cycleToNextSchema).not.toHaveBeenCalled();
  });

  it('fires a custom schema-switch shortcut from activeSettings', async () => {
    stubChrome(settings());
    const controller = new InputController();
    controller.activeSettings = settings({ schemaSwitchKey: { code: 'F2' } });
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    const handled = await controller.feedKey({
      type: 'keydown',
      code: 'F2',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('stops firing the old default once a custom shortcut is set', async () => {
    stubChrome(settings());
    const controller = new InputController();
    controller.activeSettings = settings({ schemaSwitchKey: { code: 'F2' } });
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    // Ctrl+` should now be forwarded normally, not swallowed for switching.
    const handled = await controller.feedKey({
      type: 'keydown',
      code: 'Backquote',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(false);
    expect(cycle).not.toHaveBeenCalled();
  });

  it('does not switch schemas when the shortcut is disabled (null)', async () => {
    stubChrome(settings());
    const controller = new InputController();
    controller.activeSettings = settings({ schemaSwitchKey: null });
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    const handled = await controller.feedKey({
      type: 'keydown',
      code: 'Backquote',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(false);
    expect(cycle).not.toHaveBeenCalled();
  });

  it('does not fire the default when an extra modifier is held (Ctrl+Alt+`)', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    const handled = await controller.feedKey({
      type: 'keydown',
      code: 'Backquote',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(handled).toBe(false);
    expect(cycle).not.toHaveBeenCalled();
  });

  it('applySchemaSwitchKey hot-swaps the switch key without a reload', () => {
    stubChrome(settings());
    const controller = new InputController();
    // Starts on the default (undefined → Ctrl+`).
    expect(controller.activeSettings.schemaSwitchKey).toBeUndefined();

    controller.applySchemaSwitchKey({ code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(controller.activeSettings.schemaSwitchKey).toEqual({ code: 'Digit1', ctrlKey: true, shiftKey: true });

    // Disabling also propagates.
    controller.applySchemaSwitchKey(null);
    expect(controller.activeSettings.schemaSwitchKey).toBeNull();

    // Missing settings (undefined) resets to the default.
    controller.applySchemaSwitchKey(undefined);
    expect(controller.activeSettings.schemaSwitchKey).toBeUndefined();
  });

  it('never mutates the shared kDefaultSettings constant (regression: aliasing)', () => {
    // activeSettings starts as a copy of kDefaultSettings; hot-swapping the
    // shortcut before the first loadRime must not write through to the
    // module-wide default object.
    stubChrome(settings());
    const controller = new InputController();

    controller.applySchemaSwitchKey(null);

    expect(controller.activeSettings.schemaSwitchKey).toBeNull();
    expect('schemaSwitchKey' in kDefaultSettings).toBe(false);
  });

  it('a live-updated shortcut is honored by feedKey immediately (regression: stale activeSettings)', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    // Before: Ctrl+Shift+1 conflicts with a schema binding and is NOT ours yet,
    // so it must fall through to RIME.
    const before = await controller.feedKey({
      type: 'keydown', code: 'Digit1', ctrlKey: true, altKey: false, shiftKey: true,
    } as chrome.input.ime.KeyboardEvent);
    expect(before).toBe(false);
    expect(cycle).not.toHaveBeenCalled();

    // User saves Ctrl+Shift+1 as the switch key → storage.onChanged → applySchemaSwitchKey.
    controller.applySchemaSwitchKey({ code: 'Digit1', ctrlKey: true, shiftKey: true });

    // After: the same keystroke is now intercepted for switching, not forwarded.
    const after = await controller.feedKey({
      type: 'keydown', code: 'Digit1', ctrlKey: true, altKey: false, shiftKey: true,
    } as chrome.input.ime.KeyboardEvent);
    expect(after).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('reverting to default via applySchemaSwitchKey drops the old custom key and restores Ctrl+`', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    controller.applySchemaSwitchKey({ code: 'F4' });
    controller.applySchemaSwitchKey(undefined); // reset to default

    const f4 = await controller.feedKey({
      type: 'keydown', code: 'F4', ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    expect(f4).toBe(false); // old custom key no longer ours

    const backquote = await controller.feedKey({
      type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    expect(backquote).toBe(true); // default fires again
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('disabling (null) via applySchemaSwitchKey stops both the custom key and the old default', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    controller.applySchemaSwitchKey({ code: 'F4' });
    controller.applySchemaSwitchKey(null); // disable entirely

    const f4 = await controller.feedKey({
      type: 'keydown', code: 'F4', ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    const backquote = await controller.feedKey({
      type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);

    expect(f4).toBe(false);
    expect(backquote).toBe(false);
    expect(cycle).not.toHaveBeenCalled();
  });

  it('re-enabling from disabled to a new custom key takes effect immediately', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

    controller.applySchemaSwitchKey(null);
    controller.applySchemaSwitchKey({ code: 'F4', ctrlKey: true });

    const handled = await controller.feedKey({
      type: 'keydown', code: 'F4', ctrlKey: true, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent);
    expect(handled).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('clears active RIME composition when deactivated', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const clearComposition = vi.fn(async () => { });
    const candidateIterator = { destroy: vi.fn() };
    const candidatesBack = vi.fn();

    controller.engineId = 'engine';
    controller.context = { contextID: 7 } as chrome.input.ime.InputContext;
    controller.session = { clearComposition } as any;
    controller.inputCache = ['n', 'i'];
    controller.preeditEmpty = false;
    controller.candidateCache = [{ text: '你', index: 0 } as any];
    controller.candidateIterator = candidateIterator as any;
    controller.addListener('candidatesBack', candidatesBack);

    await controller.deactivate('engine');

    expect(clearComposition).toHaveBeenCalledTimes(1);
    expect(controller.engineId).toBeNull();
    expect(controller.context).toBeNull();
    expect(controller.inputCache).toEqual([]);
    expect(controller.preeditEmpty).toBe(true);
    expect(controller.candidateCache).toEqual([]);
    expect(candidateIterator.destroy).toHaveBeenCalledTimes(1);
    expect(controller.candidateIterator).toBeNull();
    expect(candidatesBack.mock.calls.at(-1)?.[0]).toEqual([]);
  });

  // Regression: reset must clear RIME's composition or it repaints the preedit
  // Chrome already committed, duplicating it on wake.
  it('clears the surviving composition and preedit on reset, keeping focus', async () => {
    stubChrome();
    const composed: string[] = [];
    (chrome.input.ime as unknown as Record<string, unknown>).setComposition
      = (param: { text: string }, cb: (ok: boolean) => void) => { composed.push(param.text); cb(true); };
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    const clearComposition = vi.fn(async () => { });
    controller.engineId = 'engine';
    controller.context = { contextID: 9 } as chrome.input.ime.InputContext;
    controller.session = { clearComposition } as never;
    controller.inputCache = ['n', 'i'];
    controller.preeditEmpty = false;

    await controller.resetComposition();

    expect(clearComposition).toHaveBeenCalledTimes(1);
    expect(composed.at(-1)).toBe('');
    expect(controller.inputCache).toEqual([]);
    // Reset clears the composition but not focus.
    expect(controller.context).toEqual({ contextID: 9 });
    expect(controller.engineId).toBe('engine');
  });

  it('records the last successfully loaded schema', async () => {
    stubChrome(settings({ schema: 'aurora' }));
    const controller = new InputController();
    const schemaSwitched = vi.fn();
    controller.addListener('schemaSwitched', schemaSwitched);
    vi.spyOn(controller, 'loadRimeConfig').mockResolvedValue('schema: aurora\n');

    await expect(controller.loadRime(false)).resolves.toBe(true);

    expect(controller.lastSuccessfulSchema).toBe('aurora');
    expect(schemaSwitched).toHaveBeenCalledWith('aurora');
  });

  it('publishes the ready status only after the loading mutex is unlocked', async () => {
    stubChrome(settings({ schema: 'aurora' }));
    const controller = new InputController();
    const observedLoadingStates: boolean[] = [];
    vi.spyOn(controller, 'notifyRimeStatusChanged').mockImplementation(() => {
      observedLoadingStates.push(controller.engineLoading);
    });
    vi.spyOn(controller, 'loadRimeConfig').mockResolvedValue('schema: aurora\n');

    await expect(controller.loadRime(false)).resolves.toBe(true);

    expect(observedLoadingStates).toContain(true);
    expect(observedLoadingStates.at(-1)).toBe(false);
  });

  it('falls back to the last successfully loaded schema when a later schema fails', async () => {
    const chromeMock = stubChrome(settings({ schema: 'broken' }));
    const controller = new InputController();
    controller.lastSuccessfulSchema = 'aurora';
    const loadRimeConfig = vi.spyOn(controller, 'loadRimeConfig');
    loadRimeConfig.mockImplementation(async (activeSettings) => {
      if (activeSettings.schema === 'broken') {
        throw new Error('bad schema');
      }
      return 'schema: aurora\n';
    });

    await expect(controller.loadRime(true)).resolves.toBe(true);

    expect(chromeMock.set).toHaveBeenCalledWith({
      settings: {
        schema: 'aurora',
        pageSize: 5,
        algebraList: [],
      },
    });
    expect(loadRimeConfig).toHaveBeenCalledTimes(2);
    expect(loadRimeConfig).toHaveBeenNthCalledWith(1, expect.objectContaining({ schema: 'broken' }));
    expect(loadRimeConfig).toHaveBeenNthCalledWith(2, expect.objectContaining({ schema: 'aurora' }));
    expect(controller.lastSuccessfulSchema).toBe('aurora');
  });

  it('does not retry fallback when there is no previously successful schema', async () => {
    const chromeMock = stubChrome(settings({ schema: 'broken' }));
    const controller = new InputController();
    const loadRimeConfig = vi.spyOn(controller, 'loadRimeConfig').mockRejectedValue(new Error('bad schema'));

    await expect(controller.loadRime(false)).resolves.toBe(false);

    expect(chromeMock.set).not.toHaveBeenCalled();
    expect(loadRimeConfig).toHaveBeenCalledTimes(1);
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ rimeStatusChanged: true }, {}, expect.any(Function));
  });

  it('clears loading candidates and buffered preedit after a terminal load failure', async () => {
    stubChrome(settings({ schema: 'broken' }));
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.inputViewVisible = true;
    controller.inputCache = ['n', 'i'];
    const candidatesBack = vi.fn();
    controller.addListener('candidatesBack', candidatesBack);
    vi.spyOn(controller, 'loadRimeConfig').mockRejectedValue(new Error('bad schema'));

    await expect(controller.loadRime(false)).resolves.toBe(false);

    expect(controller.inputCache).toEqual([]);
    expect(candidatesBack.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(controller.engineLoading).toBe(false);
  });

  it('does not report success to a concurrent waiter when the active load fails', async () => {
    stubChrome(settings({ schema: 'broken' }));
    const controller = new InputController();
    let rejectConfig!: (reason: Error) => void;
    const configStarted = new Promise<void>((resolve) => {
      vi.spyOn(controller, 'loadRimeConfig').mockImplementation(() => {
        resolve();
        return new Promise<string>((_resolve, reject) => { rejectConfig = reject; });
      });
    });

    const activeLoad = controller.loadRime(false);
    await configStarted;
    const waitingLoad = controller.loadRime(false);
    rejectConfig(new Error('bad schema'));

    await expect(activeLoad).resolves.toBe(false);
    await expect(waitingLoad).resolves.toBe(false);
    expect(controller.engine).toBeNull();
    expect(controller.session).toBeNull();
  });

  it('does not publish or retain a partially initialized session', async () => {
    stubChrome(settings({ schema: 'aurora' }));
    const controller = new InputController();
    vi.spyOn(controller, 'loadRimeConfig').mockResolvedValue('schema: aurora\n');
    const session = {
      ...mocks.createSession('aurora'),
      setOption: vi.fn(async () => { throw new Error('setOption failed'); }),
      destroy: vi.fn(),
    };
    const engine = {
      createSession: vi.fn(async () => session),
      destroy: vi.fn(async () => { }),
      initialize: vi.fn(async () => { }),
      rebuildPrism: vi.fn(async () => { }),
    };
    mocks.createEngine.mockReturnValueOnce(engine);

    await expect(controller.loadRime(false)).resolves.toBe(false);

    expect(controller.session).toBeNull();
    expect(controller.engine).toBeNull();
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });

  it('waits for an active key transaction before replacing its session', async () => {
    stubChrome(settings({ schema: 'aurora' }));
    const controller = new InputController();
    vi.spyOn(controller, 'loadRimeConfig').mockResolvedValue('schema: aurora\n');
    let releaseKey!: () => void;
    const keyGate = new Promise<void>((resolve) => { releaseKey = resolve; });
    const oldSession = {
      processKey: vi.fn(async () => { await keyGate; return true; }),
      getOption: vi.fn(async () => false),
      destroy: vi.fn(),
    };
    const oldEngine = { destroy: vi.fn(async () => { }) };
    controller.session = oldSession as never;
    controller.engine = oldEngine as never;

    const key = controller.feedKey({
      type: 'keydown', key: 'a', code: 'KeyA',
      ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent) as Promise<boolean>;
    await vi.waitFor(() => expect(oldSession.processKey).toHaveBeenCalledTimes(1));
    const reload = controller.loadRime(false);
    await Promise.resolve();
    expect(oldSession.destroy).not.toHaveBeenCalled();
    expect(oldEngine.destroy).not.toHaveBeenCalled();

    releaseKey();
    await Promise.all([key, reload]);
    expect(oldSession.destroy).toHaveBeenCalledTimes(1);
    expect(oldEngine.destroy).toHaveBeenCalledTimes(1);
    expect(controller.session).not.toBe(oldSession);
  });

  it('waits for an active key transaction before unloading its session', async () => {
    stubChrome(settings());
    const controller = new InputController();
    let releaseKey!: () => void;
    const keyGate = new Promise<void>((resolve) => { releaseKey = resolve; });
    const session = {
      processKey: vi.fn(async () => { await keyGate; return true; }),
      destroy: vi.fn(),
    };
    const engine = { destroy: vi.fn(async () => { }) };
    controller.session = session as never;
    controller.engine = engine as never;

    const key = controller.feedKey({
      type: 'keydown', key: 'a', code: 'KeyA',
      ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    const unload = controller.unloadRime();
    await Promise.resolve();
    expect(session.destroy).not.toHaveBeenCalled();
    expect(engine.destroy).not.toHaveBeenCalled();

    releaseKey();
    await Promise.all([key, unload]);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(controller.session).toBeNull();
    expect(controller.engine).toBeNull();
  });

  it('does not let an old blur clear the composition owned by a newer focus', async () => {
    stubChrome(settings());
    const controller = new InputController();
    const clearComposition = vi.fn(async () => { });
    controller.session = { clearComposition } as never;
    controller.setContext({ contextID: 1 } as chrome.input.ime.InputContext);

    const release = await controller.sessionMutex.acquire();
    const clearing = controller.clearContext(1);
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    release();
    await clearing;

    expect(clearComposition).not.toHaveBeenCalled();
    expect(controller.context?.contextID).toBe(2);
  });

  it('serializes candidate actions, option writes, and session reads behind a key', async () => {
    stubChrome(settings());
    const controller = new InputController();
    let releaseKey!: () => void;
    const keyGate = new Promise<void>((resolve) => { releaseKey = resolve; });
    const session = {
      processKey: vi.fn(async () => { await keyGate; return true; }),
      actionCandidate: vi.fn(async () => { }),
      setOption: vi.fn(async () => { }),
      getOption: vi.fn(async () => true),
      getCurrentSchema: vi.fn(async () => 'aurora'),
      getStatus: vi.fn(async () => ({ schemaId: 'aurora' })),
    };
    controller.session = session as never;

    const key = controller.feedKey({
      type: 'keydown', key: 'a', code: 'KeyA',
      ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    const operations = [
      controller.selectCandidate(0, false),
      controller.deleteCandidate(0, false),
      controller.setAsciiMode(true),
      controller.getAsciiMode(),
      controller.getCurrentSchema(),
      controller.getRimeStatus(),
    ];
    await Promise.resolve();
    expect(session.actionCandidate).not.toHaveBeenCalled();
    expect(session.setOption).not.toHaveBeenCalled();
    expect(session.getOption).not.toHaveBeenCalled();

    releaseKey();
    const [, , , , asciiMode, schema, status] = await Promise.all([key, ...operations]);
    expect(session.actionCandidate).toHaveBeenCalledTimes(2);
    expect(session.setOption).toHaveBeenCalledWith('ascii_mode', true);
    expect(asciiMode).toBe(true);
    expect(schema).toBe('aurora');
    expect(status).toEqual({ schemaId: 'aurora' });
  });
});

describe('InputView candidate lifecycle (regression: zombie candidates)', () => {
  function candidateHarness() {
    stubChrome();
    // refreshContext always hides the system candidate window while the VK
    // is visible; give the stub that API.
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.inputViewVisible = true;
    // No IME text field context in this harness — refreshContext skips
    // setComposition and goes straight to the candidate flow.
    controller.context = null as never;

    const state = { preedit: '', words: [] as string[] };
    controller.session = {
      getContext: async () => ({
        composition: {
          preedit: state.preedit,
          cursorPosition: 0,
          selectionStart: 0,
          selectionEnd: 0,
          length: state.preedit.length,
        },
        menu: {
          pageSize: 5,
          pageNumber: 0,
          isLastPage: true,
          highlightedCandidateIndex: 0,
          candidates: state.words.map(text => ({ text, comment: '' })),
        },
        selectKeys: '',
        commitTextPreview: '',
        selectLabels: [],
      }),
      iterateCandidates: async () => {
        const snapshot = [...state.words];
        let i = -1;
        return {
          advance: async () => { i++; },
          current: async () => (i >= 0 && i < snapshot.length
            ? { index: i, text: snapshot[i], comment: '' }
            : null),
          destroy: () => { },
        };
      },
      clearComposition: () => { },
    } as never;

    const sent: string[][] = [];
    controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
      sent.push(cands.map(c => c.candidate));
    });
    return { controller, state, sent };
  }

  it('replaces candidates when the preedit changes (never appends across compositions)', async () => {
    const { controller, state, sent } = candidateHarness();

    state.preedit = 'p';
    state.words = ['苹', '平'];
    await controller.refreshContext();
    expect(sent.at(-1)).toEqual(['苹', '平']);

    state.preedit = 'pi';
    state.words = ['品', '拼'];
    await controller.refreshContext();
    // The zombie bug appended: ['苹','平','品','拼'].
    expect(sent.at(-1)).toEqual(['品', '拼']);
  });

  it('clears the keyboard when the composition ends', async () => {
    const { controller, state, sent } = candidateHarness();

    state.preedit = 'hao';
    state.words = ['好', '号'];
    await controller.refreshContext();
    expect(sent.at(-1)).toEqual(['好', '号']);

    state.preedit = '';
    state.words = [];
    await controller.refreshContext();
    expect(sent.at(-1)).toEqual([]);
  });

  it('clears the keyboard when it is hidden and re-shown mid-composition', async () => {
    const { controller, state, sent } = candidateHarness();

    state.preedit = 'ni';
    state.words = ['你', '尼'];
    await controller.refreshContext();
    expect(sent.at(-1)).toEqual(['你', '尼']);

    // Hiding clears the engine composition; re-showing must sync the VK.
    await controller.handleInputViewVisibilityChanged(false);
    state.preedit = '';
    state.words = [];
    await controller.handleInputViewVisibilityChanged(true);
    expect(sent.at(-1)).toEqual([]);
  });

  it('publishes monotonic candidate snapshots without exposing mutable state', () => {
    stubChrome();
    const controller = new InputController();
    const events: Array<{ sequence: number; streamId: string }> = [];
    controller.addListener('candidatesBack', (_candidates, sequence, streamId) => {
      events.push({ sequence, streamId });
    });

    const candidates = [{ candidate: '候选', ix: 3 }];
    controller.sendCandidatesToInputView(candidates);
    const snapshot = controller.getCandidateSnapshot();
    candidates[0].candidate = 'mutated source';
    snapshot.candidates[0].candidate = 'mutated snapshot';
    const reread = controller.getCandidateSnapshot();

    expect(events).toEqual([{ sequence: 1, streamId: reread.streamId }]);
    expect(reread.sequence).toBe(1);
    expect(reread.candidates).toEqual([{ candidate: '候选', ix: 3 }]);
  });
});

describe('loading input buffer presentation', () => {
  it('removes the loading candidate when buffered characters are deleted', async () => {
    stubChrome();
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.inputViewVisible = true;
    const sent: string[][] = [];
    controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
      sent.push(cands.map(candidate => candidate.candidate));
    });

    const releaseLoad = await controller.loadMutex.acquire();
    try {
      await controller.feedKey({
        type: 'keydown', key: 'a', code: 'KeyA',
        ctrlKey: false, altKey: false, shiftKey: false,
      } as chrome.input.ime.KeyboardEvent);
      expect(sent.at(-1)).toEqual(['loading_engine']);

      await controller.feedKey({
        type: 'keydown', key: 'Backspace', code: 'Backspace',
        ctrlKey: false, altKey: false, shiftKey: false,
      } as chrome.input.ime.KeyboardEvent);

      expect(controller.inputCacheToString()).toBe('');
      expect(controller.inputCache).toEqual([]);
      expect(sent.at(-1)).toEqual([]);

      const logAfterDelete = [...controller.inputCache];
      const extraBackspaceHandled = await controller.feedKey({
        type: 'keydown', key: 'Backspace', code: 'Backspace',
        ctrlKey: false, altKey: false, shiftKey: false,
      } as chrome.input.ime.KeyboardEvent);
      expect(extraBackspaceHandled).toBe(false);
      expect(controller.inputCache).toEqual(logAfterDelete);

      // Once the effective buffer is empty, punctuation belongs to the
      // application; historical entries must not make it look buffered.
      const punctuationHandled = await controller.feedKey({
        type: 'keydown', key: '.', code: 'Period',
        ctrlKey: false, altKey: false, shiftKey: false,
      } as chrome.input.ime.KeyboardEvent);
      expect(punctuationHandled).toBe(false);
      expect(controller.inputCache).toEqual(logAfterDelete);
      expect(sent.at(-1)).toEqual([]);
    }
    finally {
      releaseLoad();
    }
  });

  it('preserves the replay log semantics when the engine becomes ready', async () => {
    stubChrome();
    const controller = new InputController();
    controller.inputCache = ['a', 'b', null, 'c'];
    const processKey = vi.fn(async () => true);

    await controller.flushInputCacheToSession({ processKey } as never);

    expect(processKey.mock.calls).toEqual([
      ['a'.charCodeAt(0), 0],
      ['b'.charCodeAt(0), 0],
      [0xff08, 0],
      ['c'.charCodeAt(0), 0],
    ]);
    expect(controller.inputCache).toEqual([]);
  });

  it('drains keys that arrive while an earlier buffered key is replaying', async () => {
    stubChrome();
    const controller = new InputController();
    controller.inputCache = ['a'];
    const processed: number[] = [];
    const session = {
      processKey: vi.fn(async (code: number) => {
        processed.push(code);
        if (processed.length === 1) controller.inputCache.push('b');
        return true;
      }),
    };

    await controller.flushInputCacheToSession(session as never);

    expect(processed).toEqual(['a'.charCodeAt(0), 'b'.charCodeAt(0)]);
    expect(controller.inputCache).toEqual([]);
  });
});

describe('InputView candidate lifecycle (regression: delete + stale fetch race)', () => {
  function deleteHarness() {
    stubChrome();
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.inputViewVisible = true;
    controller.context = null as never;

    const state = { preedit: 'hao', words: ['好', '号', '嚎'] };
    controller.session = {
      getContext: async () => ({
        composition: {
          preedit: state.preedit, cursorPosition: 0,
          selectionStart: 0, selectionEnd: 0, length: state.preedit.length,
        },
        menu: {
          pageSize: 5, pageNumber: 0, isLastPage: true,
          highlightedCandidateIndex: 0,
          candidates: state.words.map(text => ({ text, comment: '' })),
        },
        selectKeys: '', commitTextPreview: '', selectLabels: [],
      }),
      iterateCandidates: async () => {
        const snapshot = [...state.words];
        let i = -1;
        return {
          advance: async () => { i++; },
          current: async () => (i >= 0 && i < snapshot.length
            ? { index: i, text: snapshot[i], comment: '' }
            : null),
          destroy: () => { },
        };
      },
      actionCandidate: async (index: number, op: string) => {
        if (op === 'delete') state.words.splice(index, 1);
      },
      clearComposition: () => { },
    } as never;

    const sent: string[][] = [];
    controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
      sent.push(cands.map(c => c.candidate));
    });
    return { controller, state, sent };
  }

  it('deleting a candidate removes it from the keyboard (preedit unchanged)', async () => {
    const { controller, sent } = deleteHarness();
    await controller.refreshContext();
    expect(sent.at(-1)).toEqual(['好', '号', '嚎']);

    // Long-press delete on the first candidate: the menu changes while
    // the preedit stays 'hao' — the cache must still be rebuilt.
    await controller.deleteCandidate(0, false);
    expect(sent.at(-1)).toEqual(['号', '嚎']);
  });

  it('a superseded fetchMoreCandidates loop drops its results (no zombie resurrection)', async () => {
    const { controller, sent } = deleteHarness();
    await controller.refreshContext();
    sent.length = 0;

    // Make the iterator slow and controllable.
    let releaseAdvance: (() => void) | null = null;
    const gate = () => new Promise<void>((res) => { releaseAdvance = res; });
    const slowWords = ['旧', '词'];
    let i = -1;
    controller.candidateIterator = {
      advance: async () => { await gate(); i++; },
      current: async () => (i >= 0 && i < slowWords.length
        ? { index: 100 + i, text: slowWords[i], comment: '' }
        : null),
      destroy: () => { },
    } as never;

    const fetching = controller.fetchMoreCandidates(2);
    await Promise.resolve();
    // A new keystroke supersedes the fetch mid-flight.
    await controller.invalidateCandidateCache();
    releaseAdvance!();
    await fetching;

    // The stale loop must neither pollute the cache nor re-send.
    expect(controller.candidateCache).toEqual([]);
    expect(sent).toEqual([[]]);
  });

  it('drops a stale context snapshot that resolves after the composition was cleared', async () => {
    const { controller, state, sent } = deleteHarness();
    let resolveOldContext!: (value: any) => void;
    const oldContext = new Promise<any>((resolve) => { resolveOldContext = resolve; });
    const liveSession = controller.session as any;
    const originalGetContext = liveSession.getContext;
    liveSession.getContext = vi.fn()
      .mockReturnValueOnce(oldContext)
      .mockImplementation(originalGetContext);

    const staleRefresh = controller.refreshContext();
    await Promise.resolve();
    await controller.invalidateCandidateCache();
    state.preedit = '';
    state.words = [];
    const freshRefresh = controller.refreshContext();
    expect(sent.at(-1)).toEqual([]);

    resolveOldContext({
      composition: {
        preedit: 'old', cursorPosition: 3,
        selectionStart: 0, selectionEnd: 0, length: 3,
      },
      menu: {
        pageSize: 5, pageNumber: 0, isLastPage: true,
        highlightedCandidateIndex: 0,
        candidates: [{ text: '旧', comment: '' }],
      },
      selectKeys: '', commitTextPreview: '', selectLabels: [],
    });
    await Promise.all([staleRefresh, freshRefresh]);

    expect(sent.at(-1)).toEqual([]);
    expect(controller.candidateCache).toEqual([]);
  });

  it('does not install an iterator that resolves after a newer empty composition', async () => {
    const { controller, state, sent } = deleteHarness();
    let resolveOldIterator!: (value: any) => void;
    const oldIterator = new Promise<any>((resolve) => { resolveOldIterator = resolve; });
    const liveSession = controller.session as any;
    liveSession.iterateCandidates = vi.fn().mockReturnValueOnce(oldIterator);

    const staleRefresh = controller.refreshContext();
    // getContext resolves first; let refreshContext reach the delayed
    // iterateCandidates call before superseding it.
    await vi.waitFor(() => expect(liveSession.iterateCandidates).toHaveBeenCalledTimes(1));

    await controller.invalidateCandidateCache();
    state.preedit = '';
    state.words = [];
    const freshRefresh = controller.refreshContext();
    expect(sent.at(-1)).toEqual([]);

    const destroy = vi.fn();
    resolveOldIterator({
      advance: vi.fn(async () => { }),
      current: vi.fn(async () => ({ index: 0, text: '旧', comment: '' })),
      destroy,
    });
    await Promise.all([staleRefresh, freshRefresh]);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(controller.candidateIterator).toBeNull();
    expect(controller.candidateCache).toEqual([]);
    expect(sent.at(-1)).toEqual([]);
  });

  it('drops a context snapshot from a previously focused field', async () => {
    const { controller, sent } = deleteHarness();
    controller.setContext({ contextID: 1 } as chrome.input.ime.InputContext);
    let resolveOldContext!: (value: any) => void;
    (controller.session as any).getContext = vi.fn(() =>
      new Promise<any>((resolve) => { resolveOldContext = resolve; }));

    const staleRefresh = controller.refreshContext();
    await vi.waitFor(() => expect(resolveOldContext).toBeTypeOf('function'));
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    expect(sent.at(-1)).toEqual([]);
    resolveOldContext({
      composition: {
        preedit: 'old', cursorPosition: 3,
        selectionStart: 0, selectionEnd: 0, length: 3,
      },
      menu: {
        pageSize: 5, pageNumber: 0, isLastPage: true,
        highlightedCandidateIndex: 0,
        candidates: [{ text: '旧', comment: '' }],
      },
      selectKeys: '', commitTextPreview: '', selectLabels: [],
    });
    await staleRefresh;

    expect(controller.context?.contextID).toBe(2);
    expect(controller.candidateCache).toEqual([]);
    expect(sent.at(-1)).toEqual([]);
  });

  it('versions hide/show so an obsolete disconnect cannot refresh after reconnect', async () => {
    const { controller, state, sent } = deleteHarness();
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const clearComposition = vi.fn(async () => {
      await clearGate;
      state.preedit = '';
      state.words = [];
    });
    (controller.session as any).clearComposition = clearComposition;

    const hiding = controller.handleInputViewVisibilityChanged(false);
    await vi.waitFor(() => expect(clearComposition).toHaveBeenCalledTimes(1));
    const showing = controller.handleInputViewVisibilityChanged(true);
    expect(sent.at(-1)).toEqual([]);
    releaseClear();
    await Promise.all([hiding, showing]);

    expect(controller.inputViewVisible).toBe(true);
    expect(controller.candidateCache).toEqual([]);
    expect(sent.at(-1)).toEqual([]);
  });

  it('serializes concurrent pagination loops for one iterator generation', async () => {
    const { controller } = deleteHarness();
    let releaseAdvance!: () => void;
    const gate = new Promise<void>((resolve) => { releaseAdvance = resolve; });
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    controller.candidateIterator = {
      advance: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (calls++ === 0) await gate;
        active--;
      },
      current: async () => null,
      destroy: async () => { },
    } as never;

    const first = controller.fetchMoreCandidates(1);
    await Promise.resolve();
    const second = controller.fetchMoreCandidates(1);
    await Promise.resolve();
    expect(maxActive).toBe(1);
    releaseAdvance();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });
});

describe('rapid key processing order', () => {
  it('serializes the real keydown/keyup burst so an older character cannot finish last', async () => {
    stubChrome();
    (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties
      = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.inputViewVisible = true;

    let text = '';
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const processed: Array<{ code: number; mask: number }> = [];
    controller.session = {
      processKey: async (code: number, mask: number) => {
        processed.push({ code, mask });
        if (processed.length === 1) await firstGate;
        if ((mask & (1 << 30)) === 0) {
          if (code === 0xff08) text = text.slice(0, -1);
          else text += String.fromCharCode(code);
        }
        return true;
      },
      getContext: async () => ({
        composition: {
          preedit: text, cursorPosition: text.length,
          selectionStart: 0, selectionEnd: 0, length: text.length,
        },
        menu: {
          pageSize: 5, pageNumber: 0, isLastPage: true,
          highlightedCandidateIndex: 0,
          candidates: text ? [{ text: '候选', comment: '' }] : [],
        },
        selectKeys: '', commitTextPreview: '', selectLabels: [],
      }),
      iterateCandidates: async () => {
        let advanced = false;
        return {
          advance: async () => { advanced = true; },
          current: async () => advanced && text
            ? { index: 0, text: '候选', comment: '' }
            : null,
          destroy: () => { },
        };
      },
      getCommit: async () => null,
    } as never;

    const sent: string[][] = [];
    controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
      sent.push(cands.map(candidate => candidate.candidate));
    });

    const key = (type: 'keydown' | 'keyup', key: string, code: string) => controller.feedKey({
      type, key, code, ctrlKey: false, altKey: false, shiftKey: false,
    } as chrome.input.ime.KeyboardEvent) as Promise<boolean>;
    const operations = [key('keydown', 'a', 'KeyA')];
    await Promise.resolve();
    operations.push(
      key('keyup', 'a', 'KeyA'),
      key('keydown', 'Backspace', 'Backspace'),
      key('keyup', 'Backspace', 'Backspace'),
    );
    await Promise.resolve();

    // The three later events are queued, not allowed to race the first.
    expect(processed).toEqual([{ code: 'a'.charCodeAt(0), mask: 0 }]);
    releaseFirst();
    await Promise.all(operations);

    expect(processed).toEqual([
      { code: 'a'.charCodeAt(0), mask: 0 },
      { code: 'a'.charCodeAt(0), mask: 1 << 30 },
      { code: 0xff08, mask: 0 },
      { code: 0xff08, mask: 1 << 30 },
    ]);
    expect(text).toBe('');
    expect(sent.at(-1)).toEqual([]);
  });
});

describe('physical-key Latin layout remap', () => {
  function remapHarness(layoutSettings: Partial<ImeSettings>) {
    stubChrome();
    const commits: string[] = [];
    (chrome.input.ime as unknown as Record<string, unknown>).commitText
      = (opts: { text: string }, cb: (ok: boolean) => void) => { commits.push(opts.text); cb(true); };
    for (const api of ['setCandidateWindowProperties', 'setComposition', 'setCandidates', 'setCursorPosition']) {
      (chrome.input.ime as unknown as Record<string, unknown>)[api]
        = (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
    }
    const controller = new InputController();
    controller.engineId = 'engine-1';
    controller.context = { contextID: 7 } as never;
    controller.activeSettings = { ...kDefaultSettings, ...layoutSettings } as ImeSettings;

    const fed: number[] = [];
    let handled = true;
    controller.session = {
      processKey: async (code: number) => { fed.push(code); return handled; },
      getContext: async () => null,
      getCommit: async () => null,
    } as never;
    // refreshContext hits resetUI paths; context/engine mocks above keep it quiet.
    return { controller, fed, commits, setHandled: (h: boolean) => { handled = h; } };
  }

  const keyS = { type: 'keydown', key: 's', code: 'KeyS', ctrlKey: false, altKey: false, shiftKey: false } as chrome.input.ime.KeyboardEvent;

  it('feeds the engine the remapped char while composing (dvorak KeyS → o)', async () => {
    const { controller, fed } = remapHarness({ keyboardLayout: 'dvorak' });
    await controller.feedKey(keyS);
    expect(fed).toEqual(['o'.charCodeAt(0)]);
  });

  it('honors Caps Lock and Shift+Caps Lock while composing', async () => {
    const { controller, fed } = remapHarness({ keyboardLayout: 'dvorak' });
    await controller.feedKey({ ...keyS, capsLock: true } as never);
    await controller.feedKey({ ...keyS, key: 'S', shiftKey: true, capsLock: true } as never);
    expect(fed).toEqual(['O'.charCodeAt(0), 'o'.charCodeAt(0)]);
  });

  it('commits the remapped char itself when the engine passes the key through (ASCII mode)', async () => {
    const { controller, commits, setHandled } = remapHarness({ keyboardLayout: 'dvorak' });
    setHandled(false);
    const result = await controller.feedKey(keyS);
    expect(commits).toEqual(['o']);
    expect(result).toBe(true); // swallowed — the system must not also insert 's'
  });

  it('honors Caps Lock when committing an ASCII pass-through key', async () => {
    const { controller, commits, setHandled } = remapHarness({ keyboardLayout: 'dvorak' });
    setHandled(false);
    await controller.feedKey({ ...keyS, capsLock: true } as never);
    expect(commits).toEqual(['O']);
  });

  it('does not remap while composing a non-Latin schema even with a global Latin layout', async () => {
    const { controller, fed } = remapHarness({
      keyboardLayout: 'colemak',
      schemaKeys: { aurora: 'zhuyin' },
    });
    await controller.feedKey(keyS);
    expect(fed).toEqual(['s'.charCodeAt(0)]); // raw stroke for the engine's own mapping
  });

  it('remaps Latin-code HNC but preserves raw QWERTY positions for Korean 2-set', () => {
    const hnc = remapHarness({ schema: 'hangeul_hnc', keyboardLayout: 'colemak' }).controller;
    expect(hnc.remapLayouts()).toEqual({ composing: 'colemak', ascii: 'colemak' });

    const twoSet = remapHarness({ schema: 'hangeul2set', keyboardLayout: 'colemak' }).controller;
    expect(twoSet.remapLayouts()).toEqual({ composing: 'qwerty', ascii: 'colemak' });
  });

  it('leaves modifier shortcuts on US positions', async () => {
    const { controller, fed, commits } = remapHarness({ keyboardLayout: 'dvorak' });
    await controller.feedKey({ ...keyS, ctrlKey: true, key: 's' } as never);
    // Pre-existing shortcut convention: Ctrl combos feed the uppercase
    // keysym from the code field (83 = 'S'). The point here: NOT dvorak 'o'.
    expect(fed).toEqual(['S'.charCodeAt(0)]);
    expect(commits).toEqual([]);
  });
});

describe('InputController loadRimeConfig', () => {
  const kSchemaYamlPath = '/root/aurora/build/aurora.schema.yaml';
  const kManifestPath = '/root/aurora/user/dict-packs.json';

  beforeEach(() => {
    stubChrome();
    mocks.getFs.mockReset();
    mocks.getFs.mockResolvedValue(mocks.fs);
    mocks.fs.readEntryRaw.mockReset();
    mocks.fs.readWholeFile.mockReset();
  });

  // Paths absent from `files` do not exist; the rest read as UTF-8 text.
  function scriptFs(files: Record<string, string>) {
    mocks.fs.readEntryRaw.mockImplementation(async (path: string) => path in files);
    mocks.fs.readWholeFile.mockImplementation(async (path: string) => {
      if (!(path in files)) throw new Error(`no fixture for ${path}`);
      return new TextEncoder().encode(files[path]);
    });
  }

  async function loadConfig(overrides: Partial<ImeSettings> = {}) {
    const controller = new InputController();
    return parse(await controller.loadRimeConfig(settings(overrides))) as Record<string, any>;
  }

  it('injects the page size, creating the menu node if missing', async () => {
    scriptFs({ [kSchemaYamlPath]: 'translator:\n  dictionary: aurora_dict\n' });

    const config = await loadConfig({ pageSize: 9 });

    expect(config.menu.page_size).toBe(9);
    expect(config.translator.dictionary).toBe('aurora_dict');
  });

  it('overrides the page size inside an existing menu block', async () => {
    scriptFs({ [kSchemaYamlPath]: 'menu:\n  page_size: 7\n  alternative_select_keys: "123"\n' });

    const config = await loadConfig({ pageSize: 5 });

    expect(config.menu.page_size).toBe(5);
    expect(config.menu.alternative_select_keys).toBe('123');
  });

  it('appends user algebra after the schema speller rules', async () => {
    scriptFs({ [kSchemaYamlPath]: 'speller:\n  algebra:\n    - derive/^x/y/\n' });

    const config = await loadConfig({ algebraList: ['abbrev/^(.).+$/$1/'] });

    expect(config.speller.algebra).toEqual(['derive/^x/y/', 'abbrev/^(.).+$/$1/']);
  });

  it('creates the speller block when the schema has none', async () => {
    scriptFs({ [kSchemaYamlPath]: 'translator:\n  dictionary: aurora_dict\n' });

    const config = await loadConfig({ algebraList: ['abbrev/^(.).+$/$1/'] });

    expect(config.speller.algebra).toEqual(['abbrev/^(.).+$/$1/']);
  });

  it('adds no speller block when no algebra is configured', async () => {
    scriptFs({ [kSchemaYamlPath]: 'translator:\n  dictionary: aurora_dict\n' });

    const config = await loadConfig();

    expect(config.speller).toBeUndefined();
  });

  it('survives a corrupt dict-pack manifest and keeps the config usable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    scriptFs({
      [kSchemaYamlPath]: 'translator:\n  dictionary: aurora_dict\n',
      [kManifestPath]: 'not json {{',
    });

    const config = await loadConfig({ pageSize: 6 });

    expect(config.menu.page_size).toBe(6);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not read dict pack manifest'),
      expect.anything(),
    );
  });
});
