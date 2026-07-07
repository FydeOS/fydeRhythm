import { describe, expect, it, vi } from 'vitest';
import { Mutex } from 'async-mutex';

// Keep the wasm loader out of the test process; RimeCandidateIterator only
// needs the engine's mutex.
vi.mock('../entrypoints/background/rime_emscripten', () => ({ default: vi.fn() }));

const { RimeCandidateIterator } = await import('../entrypoints/background/engine');

function fakeWasmIterator() {
    return {
        advance: vi.fn(async () => { }),
        current: vi.fn(async () => ({ text: '词', comment: '', index: 0 })),
        delete: vi.fn(),
    };
}

function makeIterator() {
    const wasm = fakeWasmIterator();
    const engine = { mutex: new Mutex() };
    const iterator = new RimeCandidateIterator(wasm, engine as never);
    return { wasm, engine, iterator };
}

describe('RimeCandidateIterator lifecycle', () => {
    it('passes advance and current through while alive', async () => {
        const { wasm, iterator } = makeIterator();

        await iterator.advance();
        const candidate = await iterator.current();

        expect(wasm.advance).toHaveBeenCalledTimes(1);
        expect(candidate).toEqual({ text: '词', comment: '', index: 0 });
    });

    it('deletes the embind handle exactly once', async () => {
        const { wasm, iterator } = makeIterator();

        await Promise.all([iterator.destroy(), iterator.destroy()]);

        expect(wasm.delete).toHaveBeenCalledTimes(1);
    });

    it('never touches the wasm handle after destroy', async () => {
        const { wasm, iterator } = makeIterator();
        await iterator.destroy();

        await iterator.advance();
        const candidate = await iterator.current();

        expect(wasm.advance).not.toHaveBeenCalled();
        expect(wasm.current).not.toHaveBeenCalled();
        expect(candidate).toBeNull();
    });

    it('lets destroy beat an iterator operation queued behind the mutex', async () => {
        const { wasm, engine, iterator } = makeIterator();
        let releaseMutex!: () => void;
        const gate = new Promise<void>((resolve) => { releaseMutex = resolve; });
        const blocked = engine.mutex.runExclusive(() => gate);
        const queuedAdvance = iterator.advance();
        const destroying = iterator.destroy();

        releaseMutex();
        await Promise.all([blocked, queuedAdvance, destroying]);

        expect(wasm.delete).toHaveBeenCalledTimes(1);
        expect(wasm.advance).not.toHaveBeenCalled();
    });

    it('resolves a queued current call to null when destroy wins', async () => {
        const { wasm, engine, iterator } = makeIterator();
        let releaseMutex!: () => void;
        const gate = new Promise<void>((resolve) => { releaseMutex = resolve; });
        const blocked = engine.mutex.runExclusive(() => gate);
        const queuedCurrent = iterator.current();
        const destroying = iterator.destroy();

        releaseMutex();
        await Promise.all([blocked, destroying]);

        expect(await queuedCurrent).toBeNull();
        expect(wasm.current).not.toHaveBeenCalled();
    });

    it('waits for an active iterator operation before deleting the wasm object', async () => {
        let releaseAdvance!: () => void;
        const advanceGate = new Promise<void>((resolve) => { releaseAdvance = resolve; });
        const events: string[] = [];
        const wasmIterator = {
            advance: vi.fn(async () => {
                events.push('advance:start');
                await advanceGate;
                events.push('advance:end');
            }),
            delete: vi.fn(() => events.push('delete')),
        };
        const iterator = new RimeCandidateIterator(
            wasmIterator,
            { mutex: new Mutex() } as never,
        );

        const advancing = iterator.advance();
        await vi.waitFor(() => expect(wasmIterator.advance).toHaveBeenCalledTimes(1));
        const destroying = iterator.destroy();
        await Promise.resolve();
        expect(wasmIterator.delete).not.toHaveBeenCalled();

        releaseAdvance();
        await Promise.all([advancing, destroying]);
        expect(events).toEqual(['advance:start', 'advance:end', 'delete']);
    });

    it('tolerates a missing wasm handle on destroy', async () => {
        const iterator = new RimeCandidateIterator(null, { mutex: new Mutex() } as never);
        await expect(iterator.destroy()).resolves.toBeUndefined();
    });
});
