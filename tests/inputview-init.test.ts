import { beforeEach, describe, expect, it, vi } from 'vitest';

// The state module has no background-bootstrap side effects, so these tests hit
// its interface directly.
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

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(async () => []),
}));

vi.mock('@/lib/utils', async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  getFs: vi.fn(),
}));

vi.mock('@/lib/schema-install', () => ({
  resolveInstalledSchemaId: vi.fn(),
}));

const {
  buildFastInputViewState,
  refineInputViewState,
  postInputViewState,
  postRefinedInputViewState,
  settleKeyEventResult,
  updateVisibleInputViewConnections,
}
  = await import('../entrypoints/background/inputview-state');
const { listEnabledInstalledSchemas } = await import('../entrypoints/background/schemas');

// Minimal stand-in for the part of InputController that the state builders read.
// There is no chrome global in this environment, so readSettings falls back to
// activeSettings — the same path a real cold start takes when storage is empty.
function fakeController(session: unknown, activeSettings?: object) {
  return {
    session,
    activeSettings,
    getEngineScriptState: () => (session as { getScriptState?: () => Promise<unknown> } | null)
      ?.getScriptState?.() ?? Promise.resolve(undefined),
  };
}

beforeEach(() => {
  vi.mocked(listEnabledInstalledSchemas).mockReset();
  vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => []);
});

describe('asynchronous Chrome key acknowledgement', () => {
  it('acknowledges a rejected key request exactly once as unhandled', async () => {
    const keyEventHandled = vi.fn();
    vi.stubGlobal('chrome', { input: { ime: { keyEventHandled } } });
    const onError = vi.fn();

    expect(settleKeyEventResult(Promise.reject(new Error('refresh failed')), 'request-1', onError))
      .toBeUndefined();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(keyEventHandled).toHaveBeenCalledTimes(1);
    expect(keyEventHandled).toHaveBeenCalledWith('request-1', false);
  });

  it('returns synchronous decisions without calling the async callback', () => {
    const keyEventHandled = vi.fn();
    vi.stubGlobal('chrome', { input: { ime: { keyEventHandled } } });
    expect(settleKeyEventResult(true, 'request-2', vi.fn())).toBe(true);
    expect(keyEventHandled).not.toHaveBeenCalled();
  });
});

describe('overlapping InputView visibility connections', () => {
  it('changes global visibility only on the first show and last hide', () => {
    const connections = new Set<symbol>();
    const first = Symbol('first');
    const replacement = Symbol('replacement');

    expect(updateVisibleInputViewConnections(connections, first, true)).toBe(true);
    expect(updateVisibleInputViewConnections(connections, replacement, true)).toBeNull();
    expect(updateVisibleInputViewConnections(connections, first, false)).toBeNull();
    expect(updateVisibleInputViewConnections(connections, replacement, false)).toBe(false);
    expect(connections.size).toBe(0);
  });
});

describe('buildFastInputViewState', () => {
  it('never touches the engine and always resolves to a renderable snapshot', async () => {
    // This is the invariant that keeps the keyboard from rendering blank on
    // a cold start: the fast snapshot may only read settings.
    const state = await buildFastInputViewState(undefined);
    expect(state).toEqual({
      asciiMode: false,
      layout: 'qwerty',
      latinLayout: 'qwerty',
      script: 'zh',
      schemaId: '',
      schemaName: '',
      alphabet: '',
      numericField: null,
      passwordField: false,
    });
  });

  it('publishes the engine alphabet once the schema has loaded', async () => {
    const fast = await buildFastInputViewState(
      { ...fakeController(null), schemaAlphabet: 'abc123' } as never,
    );
    expect(fast.alphabet).toBe('abc123');

    // The refine pass re-reads it: the engine may finish loading in between.
    const cold = await buildFastInputViewState(undefined);
    expect(cold.alphabet).toBe('');
    const refined = await refineInputViewState(
      { ...fakeController(null), schemaAlphabet: 'xyz,./' } as never,
      cold,
    );
    expect(refined.alphabet).toBe('xyz,./');
  });

  it('routes number/tel fields to the numberpad and leaves others alone', async () => {
    const withField = (type: string | undefined) =>
      buildFastInputViewState({ session: null, context: type ? { type } : null } as never);
    expect((await withField('number')).numericField).toBe('number');
    expect((await withField('tel')).numericField).toBe('tel');
    expect((await withField('text')).numericField).toBeNull();
    expect((await withField('password')).numericField).toBeNull();
    expect((await withField(undefined)).numericField).toBeNull();
  });

  it('flags a password field, which is what withholds voice input there', async () => {
    const withField = (type: string | undefined) =>
      buildFastInputViewState({ session: null, context: type ? { type } : null } as never);
    expect((await withField('password')).passwordField).toBe(true);
    expect((await withField('text')).passwordField).toBe(false);
    // A numeric field is not sensitive: dictating a phone number is a good use.
    expect((await withField('tel')).passwordField).toBe(false);
    expect((await withField(undefined)).passwordField).toBe(false);
  });

  it('draws a script schema with its own keys, in the chosen arrangement for English', async () => {
    const controller = fakeController(null, {
      schema: 'terra_zhuyin',
      keyboardLayout: 'colemak',
    });
    const state = await buildFastInputViewState(controller as never);
    expect(state.layout).toBe('zhuyin');
    expect(state.latinLayout).toBe('colemak');
  });

  it('draws a Latin schema with the one chosen arrangement', async () => {
    const controller = fakeController(null, {
      schema: 'aurora_pinyin',
      keyboardLayout: 'colemak',
    });
    const state = await buildFastInputViewState(controller as never);
    expect(state.layout).toBe('colemak');
    expect(state.latinLayout).toBe('colemak');
  });

  it('draws HNC with letter keys but keeps Korean mode, and 2-set with Hangul keys', async () => {
    const hnc = await buildFastInputViewState(fakeController(null, {
      schema: 'hangeul_hnc',
      keyboardLayout: 'qwerty',
    }) as never);
    expect(hnc.layout).toBe('qwerty');
    expect(hnc.script).toBe('ko');

    const twoSet = await buildFastInputViewState(fakeController(null, {
      schema: 'hangeul2set',
      keyboardLayout: 'qwerty',
    }) as never);
    expect(twoSet.layout).toBe('hangul');
    expect(twoSet.script).toBe('ko');
  });

  it('migrates a pre-unification profile on read, even with no storage', async () => {
    const controller = fakeController(null, {
      schema: 'aurora_pinyin',
      latinLayout: 'follow',
      schemaLayouts: { aurora_pinyin: 'dvorak' },
    });
    const state = await buildFastInputViewState(controller as never);
    expect(state.layout).toBe('dvorak');
    expect(state.latinLayout).toBe('dvorak');
  });
});

describe('refineInputViewState', () => {
  it('fills in the real asciiMode and catalog label', async () => {
    vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => [
      { id: 'aurora_pinyin', label: '极光拼音' },
    ]);
    const controller = fakeController(
      { getScriptState: vi.fn(async () => ({ asciiMode: true })) },
      { schema: 'aurora_pinyin' },
    );
    const fast = await buildFastInputViewState(controller as never);
    const refined = await refineInputViewState(controller as never, fast);
    expect(refined.asciiMode).toBe(true);
    expect(refined.schemaName).toBe('极光拼音');
  });

  it('keeps the fast values when the engine/catalog fail or reject', async () => {
    vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => { throw new Error('fs not ready'); });
    const controller = fakeController(
      { getScriptState: vi.fn(async () => { throw new Error('boom'); }) },
      { schema: 'my_custom' },
    );
    const fast = await buildFastInputViewState(controller as never);
    const refined = await refineInputViewState(controller as never, fast);
    expect(refined.asciiMode).toBe(false);
    expect(refined.schemaName).toBe('my_custom');
  });

  it('treats a missing status as false', async () => {
    const controller = fakeController({ getScriptState: vi.fn(async () => undefined) });
    const fast = await buildFastInputViewState(controller as never);
    expect((await refineInputViewState(controller as never, fast)).asciiMode).toBe(false);
  });
});

describe('postInputViewState', () => {
  it('posts the fast snapshot first, then the refined one when it differs', async () => {
    const posted: object[] = [];
    const controller = fakeController(
      { getScriptState: vi.fn(async () => ({ asciiMode: true })) },
      { schema: 'aurora_pinyin' },
    );
    await postInputViewState(controller as never, msg => posted.push(msg));
    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({ kind: 'state', state: { asciiMode: false } });
    expect(posted[1]).toMatchObject({ kind: 'state', state: { asciiMode: true } });
  });

  it('posts only once when refinement changes nothing (cold start)', async () => {
    const posted: object[] = [];
    await postInputViewState(undefined, msg => posted.push(msg));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: 'state', state: { layout: 'qwerty', asciiMode: false } });
  });
});

describe('postRefinedInputViewState', () => {
  it('posts a single refined snapshot (no stale fast-first flash)', async () => {
    const posted: Array<{ state: { asciiMode: boolean } }> = [];
    const controller = fakeController(
      { getScriptState: vi.fn(async () => ({ asciiMode: true })) },
      { schema: 'aurora_pinyin' },
    );
    await postRefinedInputViewState(controller as never, msg => posted.push(msg as never));
    expect(posted).toHaveLength(1);
    expect(posted[0].state.asciiMode).toBe(true);
  });
});
