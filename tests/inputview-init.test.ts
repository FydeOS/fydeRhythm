import { beforeEach, describe, expect, it, vi } from 'vitest';

// index.ts calls defineBackground(...) and onMessage(...) at module load via the
// wxt auto-import globals. Stub/mocks below keep the import side-effect-free so we
// can exercise the exported state-building helpers in isolation.
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

vi.mock('@/lib/utils', async (importOriginal) => ({
    ...(await importOriginal() as Record<string, unknown>),
    getFs: vi.fn(),
}));

vi.mock('@/lib/schema-install', () => ({
    resolveInstalledSchemaId: vi.fn(),
}));

const { buildFastInputViewState, refineInputViewState, postInputViewState, postRefinedInputViewState } =
    await import('../entrypoints/background/index');
const { listEnabledInstalledSchemas } = await import('../entrypoints/background/schemas');

// Minimal stand-in for the part of InputController that the state builders read.
// There is no chrome global in this environment, so readSettings falls back to
// activeSettings — the same path a real cold start takes when storage is empty.
function fakeController(session: unknown, activeSettings?: object) {
    return { session, activeSettings };
}

beforeEach(() => {
    vi.mocked(listEnabledInstalledSchemas).mockReset();
    vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => []);
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
        });
    });

    it('resolves the per-schema layout binding', async () => {
        const controller = fakeController(null, {
            schema: 'terra_zhuyin',
            schemaLayouts: { terra_zhuyin: 'zhuyin' },
        });
        const state = await buildFastInputViewState(controller as never);
        expect(state.layout).toBe('zhuyin');
        expect(state.latinLayout).toBe('qwerty');
    });

    it('follows the global Latin layout when a schema has no binding (跟随 rule)', async () => {
        const controller = fakeController(null, {
            schema: 'aurora_pinyin',
            latinLayout: 'colemak',
        });
        const state = await buildFastInputViewState(controller as never);
        expect(state.layout).toBe('colemak');
        expect(state.latinLayout).toBe('colemak');
    });
});

describe('refineInputViewState', () => {
    it('fills in the real asciiMode and catalog label', async () => {
        vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => [
            { id: 'aurora_pinyin', label: '极光拼音' },
        ]);
        const controller = fakeController(
            { getOption: vi.fn(async () => true) },
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
            { getOption: vi.fn(async () => { throw new Error('boom'); }) },
            { schema: 'my_custom' },
        );
        const fast = await buildFastInputViewState(controller as never);
        const refined = await refineInputViewState(controller as never, fast);
        expect(refined.asciiMode).toBe(false);
        expect(refined.schemaName).toBe('my_custom');
    });

    it('treats an undefined option value as false', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => undefined) });
        const fast = await buildFastInputViewState(controller as never);
        expect((await refineInputViewState(controller as never, fast)).asciiMode).toBe(false);
    });
});

describe('postInputViewState', () => {
    it('posts the fast snapshot first, then the refined one when it differs', async () => {
        const posted: object[] = [];
        const controller = fakeController(
            { getOption: vi.fn(async () => true) },
            { schema: 'aurora_pinyin' },
        );
        await postInputViewState(controller as never, (msg) => posted.push(msg));
        expect(posted).toHaveLength(2);
        expect(posted[0]).toMatchObject({ kind: 'state', state: { asciiMode: false } });
        expect(posted[1]).toMatchObject({ kind: 'state', state: { asciiMode: true } });
    });

    it('posts only once when refinement changes nothing (cold start)', async () => {
        const posted: object[] = [];
        await postInputViewState(undefined, (msg) => posted.push(msg));
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ kind: 'state', state: { layout: 'qwerty', asciiMode: false } });
    });
});

describe('postRefinedInputViewState', () => {
    it('posts a single refined snapshot (no stale fast-first flash)', async () => {
        const posted: Array<{ state: { asciiMode: boolean } }> = [];
        const controller = fakeController(
            { getOption: vi.fn(async () => true) },
            { schema: 'aurora_pinyin' },
        );
        await postRefinedInputViewState(controller as never, (msg) => posted.push(msg as never));
        expect(posted).toHaveLength(1);
        expect(posted[0].state.asciiMode).toBe(true);
    });
});
