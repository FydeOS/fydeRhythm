import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundToInputView } from '../lib/shared-types';
import { createHost, RealHost } from '../entrypoints/inputview/chrome-shim';

function eventSlot<T>() {
    let listener: ((value: T) => void) | null = null;
    return {
        addListener(fn: (value: T) => void) { listener = fn; },
        emit(value: T) { listener?.(value); },
    };
}

function fakePort() {
    return {
        onMessage: eventSlot<unknown>(),
        onDisconnect: eventSlot<void>(),
        postMessage: vi.fn(),
    };
}

describe('InputView background-port reconnect', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('ignores queued candidate packets from the disconnected port after reconnect', async () => {
        vi.useFakeTimers();
        const first = fakePort();
        const replacement = fakePort();
        const connect = vi.fn()
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(replacement);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            innerWidth: 1000,
            innerHeight: 400,
            screen: { width: 1000, height: 800 },
        });
        vi.stubGlobal('document', { hidden: false });
        vi.stubGlobal('chrome', { runtime: { connect, lastError: null }, storage: { local: {} } });
        const vk = { setHitTestBounds: vi.fn() };
        const received: BackgroundToInputView[] = [];
        const host = new RealHost(vk as never);
        host.connect((message) => received.push(message));

        first.onDisconnect.emit();
        await vi.advanceTimersByTimeAsync(250);
        expect(connect).toHaveBeenCalledTimes(2);

        first.onMessage.emit({
            kind: 'candidates', streamId: 'old', sequence: 99, candidates: [{ text: '旧', index: 0 }],
        });
        replacement.onMessage.emit({
            kind: 'candidates', streamId: 'new', sequence: 0, candidates: [],
        });

        expect(received).toEqual([
            { kind: 'candidates', streamId: 'new', sequence: 0, candidates: [] },
        ]);
        expect(replacement.postMessage).toHaveBeenCalledWith({ kind: 'visibility', visible: true });
    });

    it('queues user messages posted while the background port is reconnecting', async () => {
        vi.useFakeTimers();
        const first = fakePort();
        const replacement = fakePort();
        const connect = vi.fn()
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(replacement);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            innerWidth: 1000,
            innerHeight: 400,
            screen: { width: 1000, height: 800 },
        });
        vi.stubGlobal('document', { hidden: false });
        vi.stubGlobal('chrome', { runtime: { connect, lastError: null }, storage: { local: {} } });
        const host = new RealHost({ setHitTestBounds: vi.fn() } as never);
        const post = host.connect(vi.fn());

        first.onDisconnect.emit();
        post({ kind: 'switchSchema', schemaId: 'schema_b' });
        await vi.advanceTimersByTimeAsync(250);

        expect(replacement.postMessage).toHaveBeenCalledWith({
            kind: 'switchSchema',
            schemaId: 'schema_b',
        });
    });

    it('reconnects and retries a message when the current port throws', async () => {
        vi.useFakeTimers();
        const first = fakePort();
        first.postMessage.mockImplementation(() => { throw new Error('port closed'); });
        const replacement = fakePort();
        const connect = vi.fn()
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(replacement);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            innerWidth: 1000,
            innerHeight: 400,
            screen: { width: 1000, height: 800 },
        });
        vi.stubGlobal('document', { hidden: false });
        vi.stubGlobal('chrome', { runtime: { connect, lastError: null }, storage: { local: {} } });
        const host = new RealHost({ setHitTestBounds: vi.fn() } as never);
        const post = host.connect(vi.fn());

        post({ kind: 'setAsciiMode', asciiMode: true });
        await vi.advanceTimersByTimeAsync(250);

        expect(connect).toHaveBeenCalledTimes(2);
        expect(replacement.postMessage).toHaveBeenCalledWith({
            kind: 'setAsciiMode',
            asciiMode: true,
        });
    });

    it('contains runtime.connect failures and retries without crashing the page', async () => {
        vi.useFakeTimers();
        const replacement = fakePort();
        const connect = vi.fn()
            .mockImplementationOnce(() => { throw new Error('Extension context invalidated'); })
            .mockReturnValueOnce(replacement);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            innerWidth: 1000,
            innerHeight: 400,
            screen: { width: 1000, height: 800 },
        });
        vi.stubGlobal('document', { hidden: false });
        vi.stubGlobal('chrome', { runtime: { connect, lastError: null }, storage: { local: {} } });
        const host = new RealHost({ setHitTestBounds: vi.fn() } as never);
        let post!: ReturnType<RealHost['connect']>;

        expect(() => { post = host.connect(vi.fn()); }).not.toThrow();
        post({ kind: 'getSchemaList' });
        await vi.advanceTimersByTimeAsync(250);

        expect(connect).toHaveBeenCalledTimes(2);
        expect(replacement.postMessage).toHaveBeenCalledWith({ kind: 'getSchemaList' });
    });

    it('gives every mock candidate update an increasing protocol sequence', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => key } });
        vi.stubGlobal('window', { location: { search: '' } });
        const received: BackgroundToInputView[] = [];
        const post = createHost().connect((message) => received.push(message));
        await vi.runAllTimersAsync();

        post({ kind: 'setAsciiMode', asciiMode: true });
        post({ kind: 'setAsciiMode', asciiMode: false });
        const candidates = received.filter(
            (message): message is Extract<BackgroundToInputView, { kind: 'candidates' }> =>
                message.kind === 'candidates',
        );

        expect(candidates.map(({ streamId, sequence }) => ({ streamId, sequence }))).toEqual([
            { streamId: 'mock', sequence: 1 },
            { streamId: 'mock', sequence: 2 },
        ]);
    });
});
