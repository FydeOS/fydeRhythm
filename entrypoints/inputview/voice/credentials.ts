// Volcano credentials, baked in at build time from .env.
//
// Their presence IS the feature flag. A build made on a machine without .env —
// CI, a release — has no credentials, so voiceAvailable() is false and no
// microphone button is rendered. The feature is absent by construction rather
// than by remembering to switch it off, and there is no separate flag to keep
// in sync.
//
// They land in the bundle in clear text, so a build carrying them goes to named
// individuals only, never to a release channel. Production replaces this with a
// gateway that holds the key server-side.

import type { VolcanoCredentials } from './transport';

const env = import.meta.env as Record<string, string | undefined>;

export function readCredentials(): VolcanoCredentials | null {
  const apiKey = env.FYDE_ASR_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    // Picks the model and the billing plan: `volc.bigasr.sauc.duration` is the
    // 1.0 hour plan; the concurrency plan and the 2.0 model are other ids.
    resourceId: env.FYDE_ASR_RESOURCE_ID?.trim() || 'volc.bigasr.sauc.duration',
  };
}
