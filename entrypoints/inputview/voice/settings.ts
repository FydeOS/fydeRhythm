// Voice settings as the keyboard sees them.
//
// Reads chrome.storage directly, the way readPlacement does, and degrades to
// defaults in a dev tab where the API is absent.

import type { ImeSettings } from '@/lib/utils';

const kUidKey = 'voiceUid';

export interface VoiceSettings {
  enabled: boolean;
  consent: boolean;
}

export const kDefaultVoiceSettings: VoiceSettings = { enabled: false, consent: false };

export async function readVoiceSettings(): Promise<VoiceSettings> {
  try {
    const got = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    return {
      enabled: got.settings?.voiceInput ?? false,
      consent: got.settings?.voiceConsent ?? false,
    };
  }
  catch {
    return kDefaultVoiceSettings;
  }
}

/** Records consent without disturbing the rest of the settings object, which
 *  the options page may be editing at the same time. */
export async function writeVoiceConsent(consent: boolean): Promise<void> {
  try {
    const got = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    await chrome.storage.sync.set({ settings: { ...got.settings, voiceConsent: consent } });
  }
  catch { /* dev tab — consent lasts for this page only */ }
}

/** Fires when the options page changes either value. Returns an unsubscribe. */
export function watchVoiceSettings(onChange: (settings: VoiceSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (!('settings' in changes)) return;
    const next = changes.settings.newValue as ImeSettings | undefined;
    onChange({ enabled: next?.voiceInput ?? false, consent: next?.voiceConsent ?? false });
  };
  try {
    chrome.storage.sync.onChanged.addListener(listener);
    return () => chrome.storage.sync.onChanged.removeListener(listener);
  }
  catch {
    return () => {};
  }
}

/** A stable per-installation id.
 *
 *  Volcano uses `user.uid` to filter its server-side logs, so it has to be
 *  stable to be useful and opaque to be harmless: a random id in local storage
 *  is both, and — unlike a device or account identifier — it does not follow
 *  the user anywhere or identify them to anyone. */
export async function readVoiceUid(): Promise<string> {
  try {
    const got = await chrome.storage.local.get([kUidKey]) as { [kUidKey]?: string };
    if (got[kUidKey]) return got[kUidKey];
    const uid = crypto.randomUUID();
    await chrome.storage.local.set({ [kUidKey]: uid });
    return uid;
  }
  catch {
    return 'fyde-rhythm-dev';
  }
}
