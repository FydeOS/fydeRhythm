import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// index.ts calls defineBackground(...) and onMessage(...) at module load via the
// wxt auto-import globals. Stub/mocks below keep the import side-effect-free so we
// can exercise the exported postAsciiMode helper in isolation.
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

vi.mock('@/lib/utils', () => ({
    getFs: vi.fn(),
    kDefaultSettings: { schema: 'aurora', pageSize: 5, algebraList: [] },
}));

vi.mock('@/lib/schema-install', () => ({
    resolveInstalledSchemaId: vi.fn(),
}));

const { postAsciiMode } = await import('../entrypoints/background/index');

// Minimal stand-in for the part of InputController that postAsciiMode reads.
function fakeController(session: unknown) {
    return { session };
}

describe('postAsciiMode', () => {
    let posted: object[];
    let postToPort: (msg: object) => void;

    beforeEach(() => {
        posted = [];
        postToPort = (msg) => posted.push(msg);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the real asciiMode when the session is ready', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => true) });
        await postAsciiMode(controller as never, postToPort, 'init');
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
    });

    it('posts asciiMode=false on a cold start (session not loaded yet)', async () => {
        // This is the invariant that keeps the keyboard from rendering as one row:
        // the "init" must be sent even before RIME has loaded.
        const controller = fakeController(null);
        await postAsciiMode(controller as never, postToPort, 'init');
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('posts asciiMode=false when the controller is undefined', async () => {
        await postAsciiMode(undefined, postToPort, 'init');
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('treats an undefined option value as false', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => undefined) });
        await postAsciiMode(controller as never, postToPort, 'init');
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('falls back to asciiMode=false when getOption rejects', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => { throw new Error('boom'); }) });
        await postAsciiMode(controller as never, postToPort, 'init');
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('uses the given message name (schema_switched correction path)', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => true) });
        await postAsciiMode(controller as never, postToPort, 'schema_switched');
        expect(posted).toEqual([{ name: 'schema_switched', msg: { asciiMode: true } }]);
    });
});
