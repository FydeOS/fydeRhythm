import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep importing index.ts side-effect-free (defineBackground / onMessage run at load).
vi.stubGlobal('defineBackground', (def: unknown) => def);

vi.mock('@/lib/messaging', () => ({
  onMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../entrypoints/background/controller', () => ({
  InputController: vi.fn(),
}));

vi.mock('../entrypoints/background/keepalive', () => ({
  serviceWorkerKeepalive: vi.fn(),
}));

const listEnabledInstalledSchemas = vi.fn(async () => [
  { id: 'aurora', label: 'Aurora Pinyin' },
  { id: 'wubi', label: 'Wubi' },
]);
vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas,
}));

vi.mock('@/lib/utils', () => ({
  getFs: vi.fn(),
  kDefaultSettings: { schema: 'aurora', pageSize: 5, algebraList: [] },
}));

vi.mock('@/lib/schema-install', () => ({
  resolveInstalledSchemaId: vi.fn(),
}));

const { refreshImeMenuItems, restoreEngineId } = await import('../entrypoints/background/index');

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ChromeStubOptions {
  sessionEngineId?: string;
  settingsSchema?: string;
}

function stubChrome(opts: ChromeStubOptions = {}) {
  const setMenuItems = vi.fn();
  const sessionStore: Record<string, unknown> = {};
  if (opts.sessionEngineId !== undefined) sessionStore.imeEngineId = opts.sessionEngineId;

  const chromeStub = {
    i18n: { getMessage: (k: string) => k },
    input: { ime: { setMenuItems } },
    storage: {
      session: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in sessionStore) out[k] = sessionStore[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(sessionStore, obj); }),
      },
      sync: {
        get: vi.fn(async () => ({
          settings: { schema: opts.settingsSchema ?? 'aurora', enabledSchemas: undefined },
        })),
      },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { setMenuItems, chromeStub };
}

function stubController(engineId: string | null) {
  const controller = { engineId, activeSettings: { schema: 'aurora' } };
  vi.stubGlobal('self', { controller });
  return controller;
}

describe('refreshImeMenuItems', () => {
  beforeEach(() => {
    listEnabledInstalledSchemas.mockClear();
  });

  it('bails without calling setMenuItems when engineId is null', async () => {
    const { setMenuItems } = stubChrome();
    stubController(null);

    await refreshImeMenuItems();

    expect(setMenuItems).not.toHaveBeenCalled();
  });

  it('sets the schema menu (with the active schema checked) when engineId is known', async () => {
    const { setMenuItems } = stubChrome({ settingsSchema: 'wubi' });
    stubController('fyde-rhythm');

    await refreshImeMenuItems();

    expect(setMenuItems).toHaveBeenCalledTimes(1);
    const arg = setMenuItems.mock.calls[0][0];
    expect(arg.engineID).toBe('fyde-rhythm');
    expect(arg.items.map((i: { id: string }) => i.id)).toEqual(['aurora', 'wubi']);
    const checked = arg.items.filter((i: { checked: boolean }) => i.checked).map((i: { id: string }) => i.id);
    expect(checked).toEqual(['wubi']);
  });

  it('does not throw when setMenuItems itself throws (engine not ready in framework)', async () => {
    const { setMenuItems } = stubChrome();
    setMenuItems.mockImplementation(() => { throw new Error('engine inactive'); });
    stubController('fyde-rhythm');

    await expect(refreshImeMenuItems()).resolves.toBeUndefined();
    expect(setMenuItems).toHaveBeenCalledTimes(1);
  });

  it('does not warn when setMenuItems reports an inactive engine (lock/teardown handoff)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { setMenuItems, chromeStub } = stubChrome();
    const stub = chromeStub as { runtime?: { lastError: { message: string } | null } };
    setMenuItems.mockImplementation((_arg: unknown, cb: () => void) => {
      stub.runtime = { lastError: { message: '[input.ime.setMenuItems]: The engine is not active.' } };
      cb();
      stub.runtime = { lastError: null };
    });
    stubController('fyde-rhythm');

    await refreshImeMenuItems();

    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns when setMenuItems reports a real failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { setMenuItems, chromeStub } = stubChrome();
    const stub = chromeStub as { runtime?: { lastError: { message: string } | null } };
    setMenuItems.mockImplementation((_arg: unknown, cb: () => void) => {
      stub.runtime = { lastError: { message: 'quota exceeded' } };
      cb();
      stub.runtime = { lastError: null };
    });
    stubController('fyde-rhythm');

    await refreshImeMenuItems();

    expect(warn).toHaveBeenCalledWith('setMenuItems failed:', 'quota exceeded');
  });
});

describe('restoreEngineId', () => {
  beforeEach(() => {
    listEnabledInstalledSchemas.mockClear();
  });

  it('recovers a cached engineId and populates the menu (no onActivate needed)', async () => {
    const { setMenuItems } = stubChrome({ sessionEngineId: 'fyde-rhythm' });
    const controller = stubController(null);

    await restoreEngineId();

    // This is the core regression: after a worker restart the menu fills in
    // without the user having to click the FydeRhythm bar.
    expect(controller.engineId).toBe('fyde-rhythm');
    expect(setMenuItems).toHaveBeenCalledTimes(1);
    expect(setMenuItems.mock.calls[0][0].engineID).toBe('fyde-rhythm');
  });

  it('is a no-op when the engineId is already known (onActivate already fired)', async () => {
    const { setMenuItems, chromeStub } = stubChrome({ sessionEngineId: 'fyde-rhythm' });
    const controller = stubController('live-engine');

    await restoreEngineId();

    expect(controller.engineId).toBe('live-engine'); // unchanged
    expect(chromeStub.storage.session.get).not.toHaveBeenCalled();
    expect(setMenuItems).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing was cached', async () => {
    const { setMenuItems } = stubChrome(); // no sessionEngineId
    const controller = stubController(null);

    await restoreEngineId();

    expect(controller.engineId).toBeNull();
    expect(setMenuItems).not.toHaveBeenCalled();
  });

  it('does not throw or set engineId when storage.session.get fails', async () => {
    const { setMenuItems, chromeStub } = stubChrome({ sessionEngineId: 'fyde-rhythm' });
    chromeStub.storage.session.get.mockRejectedValueOnce(new Error('session unavailable'));
    const controller = stubController(null);

    await expect(restoreEngineId()).resolves.toBeUndefined();
    expect(controller.engineId).toBeNull();
    expect(setMenuItems).not.toHaveBeenCalled();
  });

  it('defers to a fresh engineId if onActivate fires while awaiting storage', async () => {
    const { setMenuItems, chromeStub } = stubChrome({ sessionEngineId: 'stale-cached' });
    const controller = stubController(null);
    // Simulate onActivate landing during the awaited session.get.
    chromeStub.storage.session.get.mockImplementationOnce(async () => {
      controller.engineId = 'fresh-from-activate';
      return { imeEngineId: 'stale-cached' };
    });

    await restoreEngineId();

    // Must not clobber the fresher engineId set by a concurrent onActivate.
    expect(controller.engineId).toBe('fresh-from-activate');
    expect(setMenuItems).not.toHaveBeenCalled();
  });
});
