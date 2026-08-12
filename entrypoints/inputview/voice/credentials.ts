// Two sources — our gateway, or the user's own Volcano key — each keeping its
// own credential, so switching never destroys the other's.
//
// A usable credential IS the feature flag: without one no microphone button is
// rendered, and no key is ever baked into a build.
//
// NEVER move this to chrome.storage.sync: sync uploads to Google's servers,
// and a credential does not leave the device.

import { voiceEnabled } from '@/lib/voice-build';

import type { VoiceCredentials } from './transport';

/** The hour-billed plan of the 2.0 model (Seed-ASR), measured live as
 *  frame-for-frame equivalent to 1.0 at ~1/5 the price. A key whose plan lacks
 *  2.0 is refused at the handshake and lands on the auth card — the 1.0 id
 *  (`volc.bigasr.sauc.duration`) and the concurrency plans are other ids. */
export const kDefaultResourceId = 'volc.seedasr.sauc.duration';

const kStoredKey = 'voiceCredentials';

/** Off leaves out the whole feature, not a narrower one — the .io images. */
export const kVoiceOffered = voiceEnabled(import.meta.env.FYDE_VOICE_INPUT);

export type CredentialSource = 'gateway' | 'own';

export interface StoredCredentials {
  source: CredentialSource;
  /** Our gateway's one-api token, issued by account sign-in. */
  gatewayToken: string;
  /** Whose account that token belongs to, for the options page to show. A
   *  label, not a credential — it proves nothing and unlocks nothing. */
  gatewayAccount: string;
  /** The user's own Volcano key, billed to their own console account. */
  apiKey: string;
}

let stored: VoiceCredentials | null = null;

function readShape(value: unknown): StoredCredentials {
  const record = (value ?? {}) as Partial<StoredCredentials>;
  return {
    source: record.source !== 'own' && kVoiceOffered ? 'gateway' : 'own',
    gatewayToken: record.gatewayToken?.trim() ?? '',
    // Bounded on read as well as on write: storage is shared with whatever
    // wrote it last, and a label is never worth more than this.
    gatewayAccount: [...(record.gatewayAccount?.trim() ?? '')].slice(0, 64).join(''),
    apiKey: record.apiKey?.trim() ?? '',
  };
}

/** Null when the chosen source has nothing usable, so voice stays hidden
 *  rather than offering a button that can only fail. */
export function credentialsOf(stored: StoredCredentials): VoiceCredentials | null {
  if (stored.source === 'gateway') {
    return stored.gatewayToken && kVoiceOffered
      ? { mode: 'gateway', token: stored.gatewayToken }
      : null;
  }
  // Always the default plan: a second field costs every user a question only a
  // few can answer.
  return stored.apiKey
    ? { mode: 'direct', apiKey: stored.apiKey, resourceId: kDefaultResourceId }
    : null;
}

/** What a draft value would connect as, for verifying before it is trusted. */
export function credentialsFrom(source: CredentialSource, raw: string): VoiceCredentials | null {
  const value = raw.trim();
  return credentialsOf({ source, gatewayToken: value, gatewayAccount: '', apiKey: value });
}

/** The credentials a session uses right now. Synchronous so availability and
 *  session start can ask mid-render; hydrateCredentials() runs once at page
 *  startup, long before any session can begin. */
export function readCredentials(): VoiceCredentials | null {
  return stored;
}

export async function hydrateCredentials(): Promise<void> {
  try {
    const got = await chrome.storage.local.get([kStoredKey]) as Record<string, unknown>;
    stored = credentialsOf(readShape(got[kStoredKey]));
  }
  catch {
    stored = null; // dev tab — no storage, no key
  }
}

/** Fires when the options page changes what is stored, after the cached answer
 *  has been updated. Returns an unsubscribe. */
export function watchCredentials(onChange: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (!(kStoredKey in changes)) return;
    stored = credentialsOf(readShape(changes[kStoredKey].newValue));
    onChange();
  };
  try {
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }
  catch {
    return () => {};
  }
}

export async function readStoredCredentials(): Promise<StoredCredentials> {
  try {
    const got = await chrome.storage.local.get([kStoredKey]) as Record<string, unknown>;
    return readShape(got[kStoredKey]);
  }
  catch {
    return readShape(undefined);
  }
}

/** Read-modify-write, so choosing a source cannot drop the other's credential. */
export async function writeStoredCredentials(change: Partial<StoredCredentials>): Promise<void> {
  // Trimmed on the way in too, so " " clears a field like "" does.
  const next = readShape({ ...await readStoredCredentials(), ...change });
  const empty = next.gatewayToken === '' && next.apiKey === '';
  if (empty && next.source === 'own') await chrome.storage.local.remove(kStoredKey);
  else await chrome.storage.local.set({ [kStoredKey]: next });
}
