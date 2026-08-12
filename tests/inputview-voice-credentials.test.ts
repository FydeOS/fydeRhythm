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
    stubLocalStorage({ source: 'own', apiKey: ' user ' });
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toEqual({
      mode: 'direct',
      apiKey: 'user',
      resourceId: credentials.kDefaultResourceId,
    });
  });

  it('uses the source the user chose, not whichever credential is present', async () => {
    stubLocalStorage({ source: 'gateway', gatewayToken: ' sk-abc ', apiKey: 'volc' });
    const credentials = await load();
    await credentials.hydrateCredentials();
    const expected = credentials.kVoiceOffered
      ? { mode: 'gateway', token: 'sk-abc' }
      // No gateway to honour the choice; the own key stands in.
      : { mode: 'direct', apiKey: 'volc', resourceId: credentials.kDefaultResourceId };
    expect(credentials.readCredentials()).toEqual(expected);
  });

  it('starts a fresh install on our own service', async () => {
    // No key to respect, so the default is the service that needs none.
    stubLocalStorage();
    const credentials = await load();
    const stored = await credentials.readStoredCredentials();
    expect(stored.source).toBe(credentials.kVoiceOffered ? 'gateway' : 'own');
  });

  it('answers null when nothing is stored — no key is ever baked in', async () => {
    stubLocalStorage();
    const credentials = await load();
    await credentials.hydrateCredentials();
    expect(credentials.readCredentials()).toBeNull();
  });

  it('answers null for a stored key that is only whitespace', async () => {
    // Writing removes the record instead, so this guards the value arriving any
    // other way; read as configured it offers a microphone that cannot connect.
    stubLocalStorage({ source: 'own', apiKey: '   ' });
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
  it('keeps what it was not asked to change', async () => {
    // Otherwise switching back means fetching a token or a key again.
    const { set } = stubLocalStorage({ source: 'own', apiKey: 'volc', gatewayToken: 'sk-old' });
    const credentials = await load();
    await credentials.writeStoredCredentials({ apiKey: 'volc2' });
    expect(set).toHaveBeenCalledWith({
      voiceCredentials: { source: 'own', apiKey: 'volc2', gatewayToken: 'sk-old', gatewayAccount: '' },
    });
  });

  it('drops the record once nothing is left to remember', async () => {
    const { set, remove } = stubLocalStorage({ source: 'own', apiKey: 'volc' });
    const credentials = await load();
    await credentials.writeStoredCredentials({ apiKey: '   ' });
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
    listeners[0]({ voiceCredentials: { newValue: { source: 'own', apiKey: 'user2' } } } as never);
    expect(onChange).toHaveBeenCalledOnce();
    expect(credentials.readCredentials()).toMatchObject({ mode: 'direct', apiKey: 'user2' });

    // Removal leaves no key at all.
    listeners[0]({ voiceCredentials: { newValue: undefined } } as never);
    expect(credentials.readCredentials()).toBeNull();

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });
});
