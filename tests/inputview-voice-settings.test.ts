import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  kDefaultVoiceSettings,
  readVoiceSettings,
  readVoiceUid,
  watchVoiceSettings,
  writeVoiceConsent,
} from '../entrypoints/inputview/voice/settings';

type Listener = (changes: Record<string, { newValue?: unknown }>) => void;

function stubStorage(sync: Record<string, unknown>, local: Record<string, unknown> = {}) {
  const listeners: Listener[] = [];
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => key },
    storage: {
      sync: {
        get: (keys: string[]) => Promise.resolve(Object.fromEntries(
          keys.filter(key => key in sync).map(key => [key, sync[key]]),
        )),
        set: (values: Record<string, unknown>) => {
          Object.assign(sync, values);
          return Promise.resolve();
        },
        onChanged: {
          addListener: (fn: Listener) => listeners.push(fn),
          removeListener: (fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
        },
      },
      local: {
        get: (keys: string[]) => Promise.resolve(Object.fromEntries(
          keys.filter(key => key in local).map(key => [key, local[key]]),
        )),
        set: (values: Record<string, unknown>) => {
          Object.assign(local, values);
          return Promise.resolve();
        },
      },
    },
  });
  return { sync, local, listeners };
}

function stubBrokenStorage() {
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => key },
    storage: {
      sync: {
        get: () => Promise.reject(new Error('no storage')),
        set: () => Promise.reject(new Error('no storage')),
        onChanged: { addListener: () => { throw new Error('no storage'); }, removeListener: () => {} },
      },
      local: { get: () => Promise.reject(new Error('no storage')), set: () => Promise.reject(new Error('no storage')) },
    },
  });
}

describe('voice settings', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('is off until switched on — dictation never starts uploading by default', () => {
    expect(kDefaultVoiceSettings).toEqual({ enabled: false, consent: false });
  });

  it('reads both flags out of the shared settings object', async () => {
    stubStorage({ settings: { voiceInput: true, voiceConsent: true } });
    expect(await readVoiceSettings()).toEqual({ enabled: true, consent: true });
  });

  it('treats missing flags as off rather than inheriting anything', async () => {
    stubStorage({ settings: { schema: 'aurora_pinyin' } });
    expect(await readVoiceSettings()).toEqual({ enabled: false, consent: false });
  });

  it('falls back to defaults where chrome.storage is unavailable', async () => {
    stubBrokenStorage();
    expect(await readVoiceSettings()).toEqual(kDefaultVoiceSettings);
    // Must not throw: a dev tab is a supported way to run this page.
    await expect(writeVoiceConsent(true)).resolves.toBeUndefined();
  });

  it('records consent without disturbing the rest of the settings', async () => {
    const { sync } = stubStorage({ settings: { schema: 'aurora_pinyin', pageSize: 7 } });
    await writeVoiceConsent(true);
    expect(sync.settings).toEqual({ schema: 'aurora_pinyin', pageSize: 7, voiceConsent: true });
  });

  it('reports a change made by the options page', async () => {
    const { listeners } = stubStorage({});
    const seen: unknown[] = [];
    const stop = watchVoiceSettings(settings => seen.push(settings));

    listeners[0]({ settings: { newValue: { voiceInput: true, voiceConsent: true } } });
    expect(seen).toEqual([{ enabled: true, consent: true }]);

    // An unrelated key must not churn the keyboard's state.
    listeners[0]({ schemaList: { newValue: {} } });
    expect(seen).toHaveLength(1);

    stop();
    expect(listeners).toHaveLength(0);
  });

  it('reports the switch being turned off again', () => {
    const { listeners } = stubStorage({});
    const seen: unknown[] = [];
    watchVoiceSettings(settings => seen.push(settings));
    listeners[0]({ settings: { newValue: { voiceInput: false, voiceConsent: true } } });
    expect(seen).toEqual([{ enabled: false, consent: true }]);
  });
});

describe('voice uid', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('keeps the same id once one exists', async () => {
    stubStorage({}, { voiceUid: 'existing-uid' });
    expect(await readVoiceUid()).toBe('existing-uid');
  });

  it('mints and persists one on first use', async () => {
    const { local } = stubStorage({}, {});
    const uid = await readVoiceUid();
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(local.voiceUid).toBe(uid);
    // Stable across calls, which is what makes it useful for log filtering.
    expect(await readVoiceUid()).toBe(uid);
  });

  it('does not throw where storage is unavailable', async () => {
    stubBrokenStorage();
    expect(await readVoiceUid()).toBe('fyde-rhythm-dev');
  });
});
