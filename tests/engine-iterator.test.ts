import { describe, expect, it, vi } from 'vitest';
import { Mutex } from 'async-mutex';

vi.mock('../entrypoints/background/rime_emscripten', () => ({ default: vi.fn() }));

const { RimeCandidateIterator } = await import('../entrypoints/background/engine');

describe('RimeCandidateIterator disposal', () => {
    it('waits for an active iterator operation before deleting the WASM object', async () => {
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
        const engine = { mutex: new Mutex() };
        const iterator = new RimeCandidateIterator(wasmIterator, engine as never);

        const advancing = iterator.advance();
        await vi.waitFor(() => expect(wasmIterator.advance).toHaveBeenCalledTimes(1));
        const destroying = iterator.destroy();
        await Promise.resolve();
        expect(wasmIterator.delete).not.toHaveBeenCalled();

        releaseAdvance();
        await Promise.all([advancing, destroying]);
        expect(events).toEqual(['advance:start', 'advance:end', 'delete']);
    });
});
