import { describe, expect, it, type Mock, vi } from 'vitest';

import type { FastIndexedDbFsController } from '../lib/fs';

// Keep the wasm loader out of the test process; the engine only needs the
// module surface, which each test fakes.
vi.mock('../entrypoints/background/rime_emscripten', () => ({ default: vi.fn() }));

const CreateRimeWasm = (await import('../entrypoints/background/rime_emscripten')).default as unknown as Mock;
const { RimeCandidateIterator, RimeEngine } = await import('../entrypoints/background/engine');

function makeWasm() {
  const sessions: FakeWasmSession[] = [];
  class FakeWasmSession {
    constructor() {
      sessions.push(this);
    }

    initialize = vi.fn(async (_schema: string, _config: string, _onOption: (name: string, val: boolean, label: string) => void) => undefined);
    processKey = vi.fn(async () => true);
    getContext = vi.fn(async () => ({ preedit: 'ni hai' }));
    getStatus = vi.fn(async () => ({ isAsciiMode: false }));
    getCurrentSchema = vi.fn(async (): Promise<string | null> => 'aurora_pinyin');
    actionCandidate = vi.fn(async () => true);
    setOption = vi.fn(async () => undefined);
    getOption = vi.fn(async () => true);
    getOptionLabel = vi.fn(async () => '中');
    iterateCandidates = vi.fn(async () => ({ advance: vi.fn(), current: vi.fn(), delete: vi.fn() }));
    delete = vi.fn();
  }
  const wasm = {
    rimeSetup: vi.fn(async () => undefined),
    rimeRebuildPrismForSchema: vi.fn(async () => undefined),
    rimePerformMaintenance: vi.fn(async () => undefined),
    rimeFinalize: vi.fn(),
    rimeGetSchemaList: vi.fn(async (): Promise<unknown> => [{ id: 'aurora_pinyin', name: '极光拼音' }]),
    rimeBuildDictionaryPack: vi.fn(async (): Promise<unknown> => ({ ok: true, warnings: ['dup'] })),
    rimeCollectValidDictionaryEntries: vi.fn(async (): Promise<unknown> => ({ ok: true })),
    RimeSession: FakeWasmSession,
  };
  return { wasm, sessions };
}

async function makeEngine() {
  const { wasm, sessions } = makeWasm();
  // restoreMocks only resets spies, not the module-level mock's call log.
  CreateRimeWasm.mockReset();
  CreateRimeWasm.mockResolvedValue(wasm);
  const engine = new RimeEngine();
  const printErr = vi.fn();
  await engine.initialize(printErr, { dbName: 'test' } as FastIndexedDbFsController, '/root');
  return { engine, wasm, sessions, printErr };
}

describe('RimeEngine lifecycle', () => {
  it('initializes the wasm once and mounts the fs', async () => {
    const { wasm, printErr } = await makeEngine();

    expect(CreateRimeWasm).toHaveBeenCalledTimes(1);
    const opts = CreateRimeWasm.mock.calls[0][0] as {
      locateFile: (path: string, dir: string) => string;
      fsc: unknown;
      printErr: unknown;
    };
    expect(opts.locateFile('rime.wasm', '/deep/dir/')).toBe('/rime.wasm');
    expect(opts.fsc).toEqual({ dbName: 'test' });
    expect(opts.printErr).toBe(printErr);
    expect(wasm.rimeSetup).toHaveBeenCalledWith('/root');
  });

  it('a second initialize is a no-op', async () => {
    const { engine, wasm } = await makeEngine();

    await engine.initialize(vi.fn(), {} as FastIndexedDbFsController, '/elsewhere');

    expect(CreateRimeWasm).toHaveBeenCalledTimes(1);
    expect(wasm.rimeSetup).toHaveBeenCalledTimes(1);
  });

  it('performMaintenance requests a full check', async () => {
    const { engine, wasm } = await makeEngine();

    await engine.performMaintenance();

    expect(wasm.rimePerformMaintenance).toHaveBeenCalledWith(true);
  });

  it('rebuildPrism forwards schema and config', async () => {
    const { engine, wasm } = await makeEngine();

    await engine.rebuildPrism('aurora_pinyin', 'config: yaml');

    expect(wasm.rimeRebuildPrismForSchema).toHaveBeenCalledWith('aurora_pinyin', 'config: yaml');
  });

  it('getSchemaList passes the list through and throws on null', async () => {
    const { engine, wasm } = await makeEngine();

    await expect(engine.getSchemaList()).resolves.toEqual([{ id: 'aurora_pinyin', name: '极光拼音' }]);

    wasm.rimeGetSchemaList.mockResolvedValue(null);
    await expect(engine.getSchemaList()).rejects.toThrow('Cannot get schema list');
  });

  it('destroy finalizes once and tolerates repeat calls', async () => {
    const { engine, wasm } = await makeEngine();

    await engine.destroy();
    await engine.destroy();

    expect(wasm.rimeFinalize).toHaveBeenCalledTimes(1);
    expect(engine.wasmObject).toBeNull();
  });
});

describe('RimeEngine dictionary packs', () => {
  it('fails actionably on an engine built without dict-pack support', async () => {
    const { engine, wasm } = await makeEngine();
    (wasm as Record<string, unknown>).rimeBuildDictionaryPack = undefined;

    const req = {
      schemaId: 's',
      schemaConfigYaml: '',
      baseDictionary: 'base',
      packName: 'p',
      packDictYaml: '',
    };
    await expect(engine.compileDictionaryPack(req)).rejects.toThrow(
      'does not support dictionary-pack import',
    );
  });

  it('compileDictionaryPack forwards the request and defaults warnings', async () => {
    const { engine, wasm } = await makeEngine();

    const req = {
      schemaId: 'aurora_pinyin',
      schemaConfigYaml: 'cfg',
      baseDictionary: 'aurora_pinyin.dict',
      packName: 'sogou',
      packDictYaml: 'entries',
    };
    await expect(engine.compileDictionaryPack(req)).resolves.toEqual({ ok: true, warnings: ['dup'] });
    expect(wasm.rimeBuildDictionaryPack).toHaveBeenCalledWith('aurora_pinyin', 'cfg', 'aurora_pinyin.dict', 'sogou', 'entries');

    wasm.rimeBuildDictionaryPack.mockResolvedValue({ ok: false });
    await expect(engine.compileDictionaryPack(req)).resolves.toEqual({ ok: false, warnings: [] });
  });

  it('collectValidDictionaryEntries defaults warnings and entries', async () => {
    const { engine } = await makeEngine();

    await expect(engine.collectValidDictionaryEntries({
      baseDictionary: 'base',
      packName: 'p',
      packDictYaml: '',
    })).resolves.toEqual({ ok: true, warnings: [], entries: [] });
  });
});

describe('RimeSession', () => {
  it('createSession re-emits the wasm option callback as optionChanged', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');

    expect(sessions[0].initialize.mock.calls[0].slice(0, 2)).toEqual(['aurora_pinyin', 'cfg']);
    const emitted: unknown[] = [];
    session.on('optionChanged', (...args: unknown[]) => emitted.push(args));
    const onOption = sessions[0].initialize.mock.calls[0][2];
    onOption('ascii_mode', true, 'A');

    expect(emitted).toEqual([['ascii_mode', true, 'A']]);
  });

  it('calls pass through to the wasm session', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');
    const wasmSession = sessions[0];

    await expect(session.processKey(0x61, 0)).resolves.toBe(true);
    expect(wasmSession.processKey).toHaveBeenCalledWith(0x61, 0);

    await expect(session.getContext()).resolves.toEqual({ preedit: 'ni hai' });
    await expect(session.getStatus()).resolves.toEqual({ isAsciiMode: false });
    await expect(session.getOption('ascii_mode')).resolves.toBe(true);
    await session.setOption('ascii_mode', false);
    expect(wasmSession.setOption).toHaveBeenCalledWith('ascii_mode', false);
    await expect(session.getOptionLabel('full_shape', false)).resolves.toBe('中');

    session.destroy();
    expect(wasmSession.delete).toHaveBeenCalledTimes(1);
  });

  it('getCurrentSchema throws when the wasm reports none', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');

    await expect(session.getCurrentSchema()).resolves.toBe('aurora_pinyin');

    sessions[0].getCurrentSchema.mockResolvedValue(null);
    await expect(session.getCurrentSchema()).rejects.toThrow('Cannot get current schema');
  });

  it('actionCandidate maps operations and surfaces failure', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');
    const wasmSession = sessions[0];

    await session.actionCandidate(2, 'select', true);
    expect(wasmSession.actionCandidate).toHaveBeenCalledWith(2, 0, true);
    await session.actionCandidate(5, 'delete', false);
    expect(wasmSession.actionCandidate).toHaveBeenCalledWith(5, 1, false);

    wasmSession.actionCandidate.mockResolvedValue(false);
    await expect(session.actionCandidate(1, 'select', true)).rejects.toThrow('Cannot select candidate 1');
  });

  it('iterateCandidates hands back an iterator on the engine mutex', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');

    const iterator = await session.iterateCandidates(7);

    expect(iterator).toBeInstanceOf(RimeCandidateIterator);
    expect(sessions[0].iterateCandidates).toHaveBeenCalledWith(7);
  });

  it('session calls serialize on the shared engine mutex', async () => {
    const { engine, sessions } = await makeEngine();
    const session = await engine.createSession('aurora_pinyin', 'cfg');
    const order: string[] = [];
    let releaseKey!: () => void;
    sessions[0].processKey.mockImplementation(async () => {
      order.push('key-start');
      await new Promise<void>((resolve) => { releaseKey = resolve; });
      order.push('key-end');
      return true;
    });
    sessions[0].getStatus.mockImplementation(async () => {
      order.push('status');
      return { isAsciiMode: false };
    });

    const key = session.processKey(0x61, 0);
    const status = session.getStatus();
    // Let the first exclusive section actually start before releasing it.
    await new Promise(resolve => setTimeout(resolve, 0));
    releaseKey();
    await Promise.all([key, status]);

    expect(order).toEqual(['key-start', 'key-end', 'status']);
  });
});
