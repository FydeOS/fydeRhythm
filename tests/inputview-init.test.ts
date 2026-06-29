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

// Minimal stand-in for the parts of InputController that sendInputViewInit uses:
// a `session` (possibly null) plus the schemaSwitched listener registry.
function fakeController(session: unknown) {
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    return {
        session,
        addListener: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
            (listeners[ev] ??= []).push(fn);
        }),
        removeListener: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
            listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
        }),
        emit(ev: string) {
            for (const fn of [...(listeners[ev] ?? [])]) fn();
        },
        listenerCount(ev: string) {
            return (listeners[ev] ?? []).length;
        },
    };
}

describe('sendInputViewInit', () => {
    let posted: object[];
    let postToPort: (msg: object) => void;

    beforeEach(() => {
        posted = [];
        postToPort = (msg) => posted.push(msg);
    });

    // --- Warm path: session already loaded => init sent immediately ---

    it('sends the real asciiMode immediately when the session is ready', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => true) });
        sendInputViewInit(controller as never, postToPort);

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
    });

    it('falls back to asciiMode=false when getOption rejects', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => { throw new Error('boom'); }) });
        sendInputViewInit(controller as never, postToPort);

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('treats an undefined asciiMode option as false', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => undefined) });
        sendInputViewInit(controller as never, postToPort);

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('still sends a default init when getOption throws synchronously', () => {
        const controller = fakeController({ getOption: vi.fn(() => { throw new Error('half-destroyed'); }) });
        sendInputViewInit(controller as never, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('handles getOption returning a plain (non-promise) value', () => {
        const controller = fakeController({ getOption: vi.fn(() => true) });
        sendInputViewInit(controller as never, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
    });

    // --- Cold-start path: engine not ready => defer until schemaSwitched ---

    it('does NOT send init while the engine is still loading (no session)', () => {
        const controller = fakeController(null);
        const cancel = sendInputViewInit(controller as never, postToPort);

        // Nothing yet: sending now would render a keyboard that types raw English.
        expect(posted).toEqual([]);
        expect(controller.addListener).toHaveBeenCalledWith('schemaSwitched', expect.any(Function));
        expect(controller.listenerCount('schemaSwitched')).toBe(1);
        cancel(); // clear the pending fallback timer
    });

    it('sends the real asciiMode once the engine finishes loading (schemaSwitched)', async () => {
        const controller = fakeController(null);
        sendInputViewInit(controller as never, postToPort);
        expect(posted).toEqual([]);

        // RIME finishes loading: session appears, then schemaSwitched fires.
        controller.session = { getOption: vi.fn(async () => true) };
        controller.emit('schemaSwitched');

        await vi.waitFor(() => expect(posted.length).toBe(1));
        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
        // The one-shot listener removes itself.
        expect(controller.listenerCount('schemaSwitched')).toBe(0);
    });

    it('does not send init after disconnect cleanup, even if the engine later loads', () => {
        const controller = fakeController(null);
        const cancel = sendInputViewInit(controller as never, postToPort);

        cancel(); // port disconnected before the engine was ready
        expect(controller.listenerCount('schemaSwitched')).toBe(0);

        controller.session = { getOption: vi.fn(async () => false) };
        controller.emit('schemaSwitched'); // stray late event must be ignored

        expect(posted).toEqual([]);
    });

    // --- Corner case: load fails / never signals ready => bounded fallback ---

    it('sends a default init when the engine never signals ready (fallback timeout)', () => {
        vi.useFakeTimers();
        try {
            const controller = fakeController(null);
            sendInputViewInit(controller as never, postToPort, 8000);

            expect(posted).toEqual([]);
            // loadRime failed terminally: schemaSwitched never fires.
            vi.advanceTimersByTime(8000);

            // VK still renders (degraded but visible) rather than hanging blank.
            expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
            expect(controller.listenerCount('schemaSwitched')).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not double-send when schemaSwitched arrives before the fallback fires', async () => {
        vi.useFakeTimers();
        try {
            const controller = fakeController(null);
            sendInputViewInit(controller as never, postToPort, 8000);

            controller.session = { getOption: vi.fn(async () => true) };
            controller.emit('schemaSwitched');
            await vi.advanceTimersByTimeAsync(0); // flush the getOption microtask
            expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);

            // The fallback timer must have been cleared — no second init.
            vi.advanceTimersByTime(8000);
            expect(posted).toEqual([{ name: 'init', msg: { asciiMode: true } }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cleanup cancels the fallback timer so a closed port is never posted to', () => {
        vi.useFakeTimers();
        try {
            const controller = fakeController(null);
            const cancel = sendInputViewInit(controller as never, postToPort, 8000);
            cancel();

            vi.advanceTimersByTime(8000);
            expect(posted).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    // --- Degenerate input ---

    it('sends a default init when the controller itself is undefined', () => {
        sendInputViewInit(undefined, postToPort);

        expect(posted).toEqual([{ name: 'init', msg: { asciiMode: false } }]);
    });

    it('never sends more than one init in any handled path', async () => {
        const controller = fakeController({ getOption: vi.fn(async () => true) });
        sendInputViewInit(controller as never, postToPort);
        await vi.waitFor(() => expect(posted.length).toBe(1));
        await Promise.resolve();
        expect(posted.length).toBe(1);
    });
});
