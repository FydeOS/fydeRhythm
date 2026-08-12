import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  return await import('../entrypoints/inputview/voice/credentials');
}

function stubLocalStorage(storedValue?: unknown) {
  const set = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>) => void> = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => (storedValue === undefined ? {} : { voiceCredentials: storedValue })),
        set,
        remove,
        onChanged: {
          addListener: (fn: never) => listeners.push(fn),
          removeListener: (fn: never) => listeners.splice(listeners.indexOf(fn), 1),
        },
      },
    },
  });
  return { set, remove, listeners };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('reading the key', () => {
  it('reads the stored key, trimmed, on the default plan', async () => {
    stubLocalStorage({ apiKey: ' user ' });
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toEqual({
      apiKey: 'user',
      resourceId: credentials.kDefaultResourceId,
    });
  });

  it('answers null when nothing is stored — no key is ever baked in', async () => {
    stubLocalStorage();
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toBeNull();
  });

  it('answers null for a stored key that is only whitespace', async () => {
    // writeStoredKey removes the entry instead of storing an empty key, so this
    // guards the value arriving any other way — a hand-edited storage entry, or
    // a future writer. Without it an empty key reads as configured, and the
    // keyboard offers a microphone whose handshake cannot succeed.
    stubLocalStorage({ apiKey: '   ' });
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toBeNull();
  });

  it('survives a dev tab with no chrome at all', async () => {
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toBeNull();
  });
});

describe('storing the key', () => {
  it('trims what it stores', async () => {
    const { set } = stubLocalStorage();
    const credentials = await load();
    await credentials.writeStoredKey(' k ');
    expect(set).toHaveBeenCalledWith({ voiceCredentials: { apiKey: 'k' } });
  });

  it('removes the override when the key is emptied', async () => {
    const { set, remove } = stubLocalStorage();
    const credentials = await load();
    await credentials.writeStoredKey('   ');
    expect(remove).toHaveBeenCalledWith('voiceCredentials');
    expect(set).not.toHaveBeenCalled();
  });
});

describe('watching for changes', () => {
  it('updates the live answer when the options page saves', async () => {
    const { listeners } = stubLocalStorage();
    const credentials = await load();
    await credentials.hydrateCredentials();

    const onChange = vi.fn();
    const unsubscribe = credentials.watchCredentials(onChange);
    listeners[0]({ voiceCredentials: { newValue: { apiKey: 'user2' } } } as never);
    expect(onChange).toHaveBeenCalledOnce();
    expect(credentials.readCredentials()?.apiKey).toBe('user2');

    // Removal leaves no key at all.
    listeners[0]({ voiceCredentials: { newValue: undefined } } as never);
    expect(credentials.readCredentials()).toBeNull();

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });
});
