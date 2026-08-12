// Read by the bundle and by the manifest; the two must agree or a build ships
// a host permission with no button, or a button with no permission.

export function voiceEnabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase() ?? '';
  return value !== '' && value !== '0' && value !== 'false';
}

// Overridable by the matching env var, for a development deployment.
export const kDefaultGateway = 'wss://ai.fydeos.com/v1/asr/stream';
export const kDefaultIssuer = 'https://account.fydeos.com';
/** Public OAuth client id — PKCE stands in for the secret, so not one. */
export const kDefaultClientId = '039d8c2dd6e6daa1b56b6eeb57a854e5fefa68b7';
