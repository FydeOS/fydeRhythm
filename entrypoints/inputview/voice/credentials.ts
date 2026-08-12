// Volcano credentials: the user's own key, entered once on the options page.
//
// Its presence IS the feature flag: without a key no microphone button is
// rendered. No key is ever baked into a build — a bundle that carries no
// secret cannot leak one — so every install is configured the same way, on
// the options page.
//
// The key lives in chrome.storage.local and must NEVER move to sync: sync
// uploads to Google's servers, and a credential does not leave the device.
// Production replaces this with a gateway that holds the key server-side.

import type { VolcanoCredentials } from './transport';

/** The hour-billed plan of the 2.0 model (Seed-ASR), measured live as
 *  frame-for-frame equivalent to 1.0 at ~1/5 the price. A key whose plan lacks
 *  2.0 is refused at the handshake and lands on the auth card — the 1.0 id
 *  (`volc.bigasr.sauc.duration`) and the concurrency plans are other ids. */
export const kDefaultResourceId = 'volc.seedasr.sauc.duration';

const kStoredKey = 'voiceCredentials';

let stored: VolcanoCredentials | null = null;

/** A stored key runs on the default plan; other plans have never been asked
 *  for, and a second field costs every user a question only a few can answer. */
function normalize(value: unknown): VolcanoCredentials | null {
  const record = value as { apiKey?: string } | undefined;
  const apiKey = record?.apiKey?.trim();
  if (!apiKey) return null;
  return { apiKey, resourceId: kDefaultResourceId };
}

/** The credentials a session uses right now. Synchronous so availability and
 *  session start can ask mid-render; hydrateCredentials() runs once at page
 *  startup, long before any session can begin. */
export function readCredentials(): VolcanoCredentials | null {
  return stored;
}

export async function hydrateCredentials(): Promise<void> {
  try {
    const got = await chrome.storage.local.get([kStoredKey]) as Record<string, unknown>;
    stored = normalize(got[kStoredKey]);
  }
  catch {
    stored = null; // dev tab — no storage, no key
  }
}

/** Fires when the options page changes the stored key, after the cached answer
 *  has been updated. Returns an unsubscribe. */
export function watchCredentials(onChange: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (!(kStoredKey in changes)) return;
    stored = normalize(changes[kStoredKey].newValue);
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

/** The stored key as entered, for the options page field. */
export async function readStoredKey(): Promise<string> {
  try {
    const got = await chrome.storage.local.get([kStoredKey]) as { [kStoredKey]?: { apiKey?: string } };
    return got[kStoredKey]?.apiKey ?? '';
  }
  catch {
    return '';
  }
}

/** An empty key removes the override, falling back to the baked key if any. */
export async function writeStoredKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed) await chrome.storage.local.set({ [kStoredKey]: { apiKey: trimmed } });
  else await chrome.storage.local.remove(kStoredKey);
}
