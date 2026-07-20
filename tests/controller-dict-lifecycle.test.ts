import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFs: vi.fn(),
}));

vi.mock('@/lib/utils', async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  getFs: mocks.getFs,
}));

vi.mock('../entrypoints/background/engine', () => ({
  RimeEngine: vi.fn(),
}));

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(async () => []),
}));

const { InputController } = await import('../entrypoints/background/controller');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function schemaBytes() {
  return new TextEncoder().encode('translator:\n  dictionary: schema_a\n');
}

describe('dictionary compiler engine lifetime', () => {
  it('keeps using the engine captured for the operation when the field becomes null', async () => {
    const read = deferred<Uint8Array>();
    mocks.getFs.mockResolvedValue({
      readWholeFile: vi.fn(() => read.promise),
    });
    const firstEngine = {
      compileDictionaryPack: vi.fn(async () => ({ ok: true, warnings: [] })),
    };
    const controller = new InputController();
    controller.engine = firstEngine as never;

    const compiling = controller.compileDictPack('schema_a', 'pack', 'yaml');
    await vi.waitFor(() => expect(mocks.getFs).toHaveBeenCalled());
    controller.engine = null;
    read.resolve(schemaBytes());

    await expect(compiling).resolves.toEqual({ ok: true, warnings: [] });
    expect(firstEngine.compileDictionaryPack).toHaveBeenCalledOnce();
  });

  it('does not redirect an in-flight compilation to a replacement engine', async () => {
    const read = deferred<Uint8Array>();
    mocks.getFs.mockResolvedValue({
      readWholeFile: vi.fn(() => read.promise),
    });
    const firstEngine = {
      compileDictionaryPack: vi.fn(async () => ({ ok: true, warnings: [] })),
    };
    const replacementEngine = {
      compileDictionaryPack: vi.fn(async () => ({ ok: true, warnings: [] })),
    };
    const controller = new InputController();
    controller.engine = firstEngine as never;

    const compiling = controller.compileDictPack('schema_a', 'pack', 'yaml');
    await vi.waitFor(() => expect(mocks.getFs).toHaveBeenCalled());
    controller.engine = replacementEngine as never;
    read.resolve(schemaBytes());
    await compiling;

    expect(firstEngine.compileDictionaryPack).toHaveBeenCalledOnce();
    expect(replacementEngine.compileDictionaryPack).not.toHaveBeenCalled();
  });

  it('keeps classification on the engine that started the operation', async () => {
    const read = deferred<Uint8Array>();
    mocks.getFs.mockResolvedValue({
      readWholeFile: vi.fn(() => read.promise),
    });
    const result = { ok: true, warnings: [], entries: [] };
    const firstEngine = {
      collectValidDictionaryEntries: vi.fn(async () => result),
    };
    const replacementEngine = {
      collectValidDictionaryEntries: vi.fn(async () => result),
    };
    const controller = new InputController();
    controller.engine = firstEngine as never;

    const classifying = controller.classifyDictPackEntries('schema_a', 'pack', 'yaml');
    await vi.waitFor(() => expect(mocks.getFs).toHaveBeenCalled());
    controller.engine = replacementEngine as never;
    read.resolve(schemaBytes());

    await expect(classifying).resolves.toEqual(result);
    expect(firstEngine.collectValidDictionaryEntries).toHaveBeenCalledOnce();
    expect(replacementEngine.collectValidDictionaryEntries).not.toHaveBeenCalled();
  });

  it('makes unload wait until an in-flight compilation releases the engine', async () => {
    const read = deferred<Uint8Array>();
    mocks.getFs.mockResolvedValue({
      readWholeFile: vi.fn(() => read.promise),
    });
    const events: string[] = [];
    const engine = {
      compileDictionaryPack: vi.fn(async () => {
        events.push('compile');
        return { ok: true, warnings: [] };
      }),
      destroy: vi.fn(async () => { events.push('destroy'); }),
    };
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: null,
        sendMessage: vi.fn((_message, _options, callback?: () => void) => callback?.()),
      },
    });
    const controller = new InputController();
    controller.engine = engine as never;

    const compiling = controller.compileDictPack('schema_a', 'pack', 'yaml');
    await vi.waitFor(() => expect(mocks.getFs).toHaveBeenCalled());
    const unloading = controller.unloadRime();
    await Promise.resolve();
    expect(engine.destroy).not.toHaveBeenCalled();

    read.resolve(schemaBytes());
    await compiling;
    await unloading;

    expect(events).toEqual(['compile', 'destroy']);
    expect(controller.engine).toBeNull();
  });
});
