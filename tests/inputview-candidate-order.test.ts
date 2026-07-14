import { describe, expect, it } from 'vitest';
import { acceptCandidatePacket, isNewCandidateOrder } from '../entrypoints/inputview/candidate-order';

describe('InputView candidate packet ordering', () => {
    it('accepts only increasing sequences within one worker stream', () => {
        const current = { streamId: 'worker-a', sequence: 7 };
        expect(isNewCandidateOrder(current, { streamId: 'worker-a', sequence: 8 })).toBe(true);
        expect(isNewCandidateOrder(current, { streamId: 'worker-a', sequence: 7 })).toBe(false);
        expect(isNewCandidateOrder(current, { streamId: 'worker-a', sequence: 6 })).toBe(false);
    });

    it('accepts the first snapshot from a replacement background worker', () => {
        expect(isNewCandidateOrder(
            { streamId: 'old-worker', sequence: 99 },
            { streamId: 'new-worker', sequence: 0 },
        )).toBe(true);
    });

    it('leaves displayed candidates unchanged for stale packets and collapses on an accepted clear', () => {
        const current = { streamId: 'worker-a', sequence: 7 };
        expect(acceptCandidatePacket(current, {
            kind: 'candidates', streamId: 'worker-a', sequence: 6,
            candidates: [{ text: 'stale', index: 0 }],
        })).toBeNull();

        expect(acceptCandidatePacket(current, {
            kind: 'candidates', streamId: 'worker-a', sequence: 8, candidates: [],
        })).toEqual({
            order: { streamId: 'worker-a', sequence: 8 },
            candidates: [],
            collapseExpanded: true,
        });
    });
});
