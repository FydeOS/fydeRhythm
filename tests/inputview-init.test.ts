import { beforeEach, describe, expect, it, vi } from 'vitest';

// index.ts calls defineBackground(...) and onMessage(...) at module load via the
// wxt auto-import globals. Stub/mocks below keep the import side-effect-free so we
// can exercise the exported sendInputViewInit helper in isolation.
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

const { sendInputViewInit } = await import('../entrypoints/background/index');

// Minimal stand-in for InputController as far as sendInputViewInit cares.
type FakeController = { session: { getOption: (name: string) => Promise<boolean | undefined> } | null };

describe('sendInputViewInit', () => {
    let posted: object[];
    let postToPort: (msg: object) => void;

    beforeEach(() => {
        posted = [];
        postToPort = (msg) => posted.push(msg);
    });

    it('still sends a default init when the session is not loaded yet (cold-start race)', () => {
        // controller exists but RIME has not loaded => session is null.
        sendInputViewInit({ session: null } as unknown as FakeController as never, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('sends a default init when the controller itself is undefined', () => {
        sendInputViewInit(undefined, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('sends the real asciiMode when the session is ready', async () => {
        const controller = { session: { getOption: vi.fn(async () => true) } };
        sendInputViewInit(controller as unknown as never, postToPort);

        // getOption resolves asynchronously.
        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
        expect(controller.session.getOption).toHaveBeenCalledWith('ascii_mode');
    });

    it('falls back to asciiMode=false when getOption rejects', async () => {
        const controller = { session: { getOption: vi.fn(async () => { throw new Error('boom'); }) } };
        sendInputViewInit(controller as unknown as never, postToPort);

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('treats an undefined asciiMode option as false', async () => {
        const controller = { session: { getOption: vi.fn(async () => undefined) } };
        sendInputViewInit(controller as unknown as never, postToPort);

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    // --- Corner cases: getOption misbehaving must still produce exactly one init ---

    it('still sends a default init when getOption throws synchronously', () => {
        const controller = {
            session: { getOption: vi.fn(() => { throw new Error('half-destroyed session'); }) },
        };
        sendInputViewInit(controller as unknown as never, postToPort);

        // Synchronous throw must not swallow the init (the original bug class).
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('handles getOption returning a plain (non-promise) value', () => {
        const controller = { session: { getOption: vi.fn(() => true) } };
        sendInputViewInit(controller as unknown as never, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
    });

    it('sends a default init when session.getOption is missing entirely', () => {
        const controller = { session: {} };
        sendInputViewInit(controller as unknown as never, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('never sends more than one init in any handled path', async () => {
        const controller = { session: { getOption: vi.fn(async () => true) } };
        sendInputViewInit(controller as unknown as never, postToPort);
        await vi.waitFor(() => expect(posted.length).toBe(1));
        // give any stray async path a tick to (wrongly) double-post
        await Promise.resolve();
        expect(posted.length).toBe(1);
    });
});
