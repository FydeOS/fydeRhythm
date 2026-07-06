import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RimeCandidate } from '../lib/shared-types';

vi.mock('../entrypoints/background/engine', () => ({
    RimeEngine: vi.fn(),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const actual = await importOriginal<typeof import('../lib/utils')>();
    return {
        ...actual,
        getFs: vi.fn(),
        kDefaultSettings: {
            schema: 'aurora',
            pageSize: 5,
            algebraList: [],
        },
    };
});

vi.mock('../entrypoints/background/schemas', () => ({
    listEnabledInstalledSchemas: vi.fn(async () => []),
}));

const { InputController } = await import('../entrypoints/background/controller');

// Async iterator stub over a fixed candidate list, mirroring the RIME
// semantics: positioned before the first candidate, advance() moves,
// current() reads without moving and returns null past the end.
function fakeIterator(candidates: RimeCandidate[]) {
    let pos = -1;
    return {
        destroy: vi.fn(async () => { }),
        advance: vi.fn(async () => { pos++; }),
        current: vi.fn(async () => candidates[pos] ?? null),
    };
}

function candidates(count: number, offset = 0): RimeCandidate[] {
    return Array.from({ length: count }, (_, i) => ({
        text: `词${offset + i}`,
        comment: '',
        index: offset + i,
    } as RimeCandidate));
}

// Controller wired for the inputview candidate path: session present, virtual
// keyboard visible, no chrome context (so refreshContext skips the system
// candidate window entirely).
function makeController(iterators: Array<ReturnType<typeof fakeIterator>>) {
    const controller = new InputController();
    let nextIterator = 0;
    controller.engineId = 'engine';
    controller.inputViewVisible = true;
    controller.context = null;
    controller.session = {
        getContext: vi.fn(async () => ({
            composition: { cursorPosition: 0, preedit: 'ni' },
            menu: { candidates: [], pageSize: 5, pageNumber: 0, isLastPage: false },
            selectLabels: [],
        })),
        iterateCandidates: vi.fn(async () => iterators[nextIterator++]),
        actionCandidate: vi.fn(async () => { }),
        getCommit: vi.fn(async () => null),
    } as never;
    return controller;
}

beforeEach(() => {
    vi.stubGlobal('chrome', {
        i18n: { getMessage: (key: string) => key },
        runtime: { lastError: null, sendMessage: vi.fn() },
        input: {
            ime: {
                // refreshContext always hides the system candidate window while
                // the virtual keyboard is visible.
                setCandidateWindowProperties: vi.fn((_opts: unknown, cb: (ok: boolean) => void) => cb(true)),
            },
        },
    });
});

describe('inputview candidate cache', () => {
    it('installs one iterator and caches the first 10 candidates', async () => {
        const iterator = fakeIterator(candidates(12));
        const controller = makeController([iterator]);
        const candidatesBack = vi.fn();
        controller.addListener('candidatesBack', candidatesBack);

        await controller.refreshContext();

        expect(controller.candidateCache.map(c => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(candidatesBack).toHaveBeenLastCalledWith(
            candidates(10).map(c => ({ candidate: c.text, ix: c.index })),
            expect.any(Number),
            expect.any(String),
        );
        expect(iterator.destroy).not.toHaveBeenCalled();
    });

    it('concurrent refreshContext calls do not duplicate the candidate cache', async () => {
        // Regression: two overlapping refreshContext calls both saw
        // candidateIterator == null, installed two iterators, and interleaved
        // their pushes into the same cache — every candidate appeared twice.
        const first = fakeIterator(candidates(10));
        const second = fakeIterator(candidates(10));
        const controller = makeController([first, second]);

        await Promise.all([controller.refreshContext(), controller.refreshContext()]);

        expect(controller.candidateCache.map(c => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // refreshMutex serializes the two refreshes, so the second call reuses
        // the installed iterator instead of creating and discarding a loser.
        expect((controller.session as never as { iterateCandidates: ReturnType<typeof vi.fn> })
            .iterateCandidates).toHaveBeenCalledTimes(1);
        expect(first.destroy).not.toHaveBeenCalled();
        expect(second.destroy).not.toHaveBeenCalled();
    });

    it('discards an iterator whose setup raced with an invalidation', async () => {
        const iterator = fakeIterator(candidates(10));
        const controller = makeController([iterator]);
        // Invalidate while refreshContext awaits iterateCandidates: the
        // iterator that resolves afterwards belongs to a stale composition.
        (controller.session as never as { iterateCandidates: ReturnType<typeof vi.fn> })
            .iterateCandidates
            .mockImplementationOnce(async () => {
                await controller.invalidateCandidateCache();
                return iterator;
            });

        await controller.refreshContext();

        expect(iterator.destroy).toHaveBeenCalledTimes(1);
        expect(controller.candidateIterator).toBeNull();
        expect(controller.candidateCache).toEqual([]);
    });

    it('stops fetching when the cache is invalidated mid-fetch', async () => {
        const iterator = fakeIterator(candidates(20));
        const controller = makeController([iterator]);
        await controller.refreshContext();

        // Invalidate (e.g. a keystroke) on the 3rd advance of a follow-up
        // fetch: nothing fetched after that point may leak into the new cache.
        const baseAdvance = iterator.advance.getMockImplementation()!;
        let followUpAdvances = 0;
        iterator.advance.mockImplementation(async () => {
            await baseAdvance();
            followUpAdvances++;
            if (followUpAdvances === 3) {
                await controller.invalidateCandidateCache();
            }
        });
        await controller.fetchMoreCandidates(5);

        expect(controller.candidateCache).toEqual([]);
    });

    it('fetchMoreCandidates is a no-op without an iterator', async () => {
        const controller = makeController([]);
        const candidatesBack = vi.fn();
        controller.addListener('candidatesBack', candidatesBack);

        await controller.fetchMoreCandidates(10);

        expect(controller.candidateCache).toEqual([]);
        expect(candidatesBack).not.toHaveBeenCalled();
    });

    it('stops at the end of the candidate list without trailing nulls', async () => {
        const iterator = fakeIterator(candidates(3));
        const controller = makeController([iterator]);

        await controller.refreshContext();

        expect(controller.candidateCache.map(c => c.index)).toEqual([0, 1, 2]);
    });

    it('selectCandidate rejects when the engine refuses, after invalidating the cache', async () => {
        const iterator = fakeIterator(candidates(3));
        const controller = makeController([iterator]);
        await controller.refreshContext();
        (controller.session as never as { actionCandidate: ReturnType<typeof vi.fn> })
            .actionCandidate
            .mockRejectedValueOnce(new Error('Cannot select candidate 2'));

        await expect(controller.selectCandidate(2, false)).rejects.toThrow('Cannot select candidate 2');
        // The stale cache must not survive the failed tap.
        expect(controller.candidateCache).toEqual([]);
        expect(iterator.destroy).toHaveBeenCalled();
    });

    it('commitIfAvailable reads lastError and rejects with a descriptive Error', async () => {
        // Regression class: "Unchecked runtime.lastError" — the commitText
        // callback used to ignore lastError and reject with undefined.
        let lastErrorReads = 0;
        vi.stubGlobal('chrome', {
            i18n: { getMessage: (key: string) => key },
            runtime: {
                get lastError() {
                    lastErrorReads++;
                    return { message: 'No active context' };
                },
                sendMessage: vi.fn(),
            },
            input: {
                ime: {
                    commitText: vi.fn((_p: unknown, cb: (ok: boolean) => void) => cb(false)),
                },
            },
        });
        const controller = new InputController();
        controller.context = { contextID: 1 } as chrome.input.ime.InputContext;
        controller.session = { getCommit: vi.fn(async () => ({ text: '你好' })) } as never;

        await expect(controller.commitIfAvailable()).rejects.toThrow('commitText: No active context');
        expect(lastErrorReads).toBeGreaterThan(0);
    });

    it('handleInputViewVisibilityChanged propagates refresh failures to the caller', async () => {
        // The internal refreshContext() used to be fire-and-forget, so its
        // rejection bypassed the caller's catch and surfaced as uncaught.
        const controller = makeController([]);
        (controller.session as never as { getContext: ReturnType<typeof vi.fn> })
            .getContext
            .mockRejectedValueOnce(new Error('refresh boom'));

        await expect(controller.handleInputViewVisibilityChanged(true)).rejects.toThrow('refresh boom');
    });

    it('hiding the keyboard still refreshes when clearComposition fails', async () => {
        const controller = makeController([]);
        const clearComposition = vi.fn(async () => { throw new Error('engine dead'); });
        controller.session = { ...(controller.session as object), clearComposition } as never;
        const getContext = (controller.session as never as { getContext: ReturnType<typeof vi.fn> }).getContext;

        await controller.handleInputViewVisibilityChanged(false);

        expect(clearComposition).toHaveBeenCalledTimes(1);
        expect(getContext).toHaveBeenCalledTimes(1);
    });

    it('deactivate survives a rejecting clearComposition', async () => {
        const controller = makeController([]);
        controller.session = {
            ...(controller.session as object),
            clearComposition: vi.fn(async () => { throw new Error('boom'); }),
        } as never;

        await controller.deactivate('engine');

        expect(controller.engineId).toBeNull();
    });

    it('rightClick swallows a rejected delete instead of leaving an unhandled rejection', async () => {
        const controller = makeController([]);
        (controller.session as never as { actionCandidate: ReturnType<typeof vi.fn> })
            .actionCandidate
            .mockRejectedValue(new Error('Cannot delete candidate 1'));

        controller.rightClick(1);
        // Give the internal catch a microtask turn; an unhandled rejection
        // here would fail the test run.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(controller.lastRightClickItem).toBe(1);
    });
});
