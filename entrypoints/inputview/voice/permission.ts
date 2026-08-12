// Microphone permission, which in this extension is never obtained from the
// keyboard.
//
// Extensions cannot declare `audioCapture` (Chrome reserves it for platform
// apps), so there is no silent grant, and an IME window cannot display a
// permission bubble. The grant is an ordinary content setting on
// chrome-extension://<id>, made from the options page — a real tab, where the
// prompt works — and it then reaches this window. That was measured on device.
//
// The consequence for this file: NEVER call getUserMedia speculatively. If the
// state is not 'granted', the bubble is raised into a window that cannot show
// it and is auto-dismissed, so the user sees a microphone button that does
// nothing at all, with no way to discover why. Check first, and route to the
// options page instead.
//
// A grant can also lapse: Chrome offers "allow this time" alongside "allow on
// every visit", and only the persistent choice survives the options page
// closing. The two are indistinguishable through this API while both are live,
// so every session re-checks rather than caching an answer.

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

const kMicrophone = { name: 'microphone' as PermissionName };

/** 'unknown' when the Permissions API cannot answer — callers should treat it
 *  as "try, but be ready for a dismissed prompt", not as a grant. */
export async function micPermission(): Promise<MicPermission> {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query(kMicrophone);
    return status.state as MicPermission;
  }
  catch {
    return 'unknown';
  }
}

/** Watches for the grant being revoked (or granted) while the keyboard is open,
 *  so an in-session revocation can stop recording immediately rather than
 *  surfacing later as an unexplained failure. Returns an unsubscribe. */
export function watchMicPermission(onChange: (state: MicPermission) => void): () => void {
  if (!navigator.permissions?.query) return () => {};

  let status: PermissionStatus | null = null;
  let cancelled = false;
  const handler = () => onChange((status?.state ?? 'unknown') as MicPermission);

  void navigator.permissions.query(kMicrophone).then((result) => {
    if (cancelled) return;
    status = result;
    result.addEventListener('change', handler);
  }).catch(() => { /* no watcher; the per-session check still applies */ });

  return () => {
    cancelled = true;
    status?.removeEventListener('change', handler);
  };
}
