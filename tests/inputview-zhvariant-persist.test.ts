import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(async () => []),
}));

function stubSessionStorage(stored: Record<string, unknown>) {
  const set = vi.fn(async () => {});
  vi.stubGlobal('chrome', {
    i18n: { getMessage: () => '' },
    storage: { session: { get: vi.fn(async () => stored), set } },
  });
  return set;
}

const kController = { activeSettings: { schema: 'cangjie5', pageSize: 5, algebraList: [] }, context: null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the script carry-forward across worker restarts', () => {
  it('hydrates from storage.session before the engine can answer', async () => {
    // A fresh MV3 worker forgets module state exactly when the engine is
    // slowest to answer; without this the first posts assert simplified.
    stubSessionStorage({ inputviewZhVariant: 'traditional' });
    vi.resetModules();
    const { postInputViewState } = await import('../entrypoints/background/inputview-state');
    await new Promise(resolve => setTimeout(resolve, 0));

    const posts: { state: { zhVariant?: string } }[] = [];
    await postInputViewState(kController as never, ((m: unknown) => posts.push(m as never)) as never);
    expect(posts[0]!.state.zhVariant).toBe('traditional');
  });

  it('persists a live answer for the next worker', async () => {
    const set = stubSessionStorage({});
    vi.resetModules();
    const { postInputViewState } = await import('../entrypoints/background/inputview-state');
    const controller = {
      ...kController,
      getEngineScriptState: vi.fn(async () => ({ asciiMode: false, zhVariant: 'hk' as const })),
    };
    await postInputViewState(controller as never, (() => {}) as never);
    expect(set).toHaveBeenCalledWith({ inputviewZhVariant: 'hk' });
  });
});
