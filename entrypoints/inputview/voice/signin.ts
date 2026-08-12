// The extension is a public OAuth client: it ships no secret, because anything
// in this bundle is published rather than kept. PKCE is what replaces the
// secret — a fresh verifier per attempt proves the code is being redeemed by
// whoever started the authorization, and nothing durable has to be hidden.
//
// Two hops: the account server issues the account token, then the gateway
// trades it for the gateway token this extension actually uses. Only the
// gateway token is stored; the account token has no further use here, and not
// keeping it means never having to rotate a refresh token.

import { kDefaultClientId, kDefaultIssuer } from '@/lib/voice-build';

import { kGatewayEndpoint } from './transport';

/** Read per call, not once at import, so tests can point sign-in elsewhere
 *  without rebuilding the module. */
export function clientId(): string {
  return import.meta.env.FYDE_ACCOUNT_CLIENT_ID ?? kDefaultClientId;
}

export function issuer(): string {
  return import.meta.env.FYDE_ACCOUNT_ISSUER ?? kDefaultIssuer;
}

/** Derived, not configured: the token is only valid at the gateway it came
 *  from, and two knobs could disagree. */
export function gatewayOrigin(): string {
  return new URL(kGatewayEndpoint).origin.replace(/^ws/, 'http');
}

export type SignInResult
  /** `name` is a label, not a credential: it is what the options page shows so
   *  a signed-in user can see which account the token belongs to. Absent when
   *  the account server answered without one — sign-in still succeeded. */
  = | { ok: true; token: string; name?: string }
    | { ok: false; reason: 'cancelled' | 'failed' };

export interface SignInOptions {
  /** False renews silently; a session that needs the user reads as cancelled. */
  interactive?: boolean;
  /** Test seams. */
  launch?: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
}

const kVerifierBytes = 64;

/** A verifier the server will accept: it enforces 43-128 characters from the
 *  unreserved set, which is exactly what base64url of random bytes produces. */
function newVerifier(): string {
  const bytes = new Uint8Array(kVerifierBytes);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A nickname is whatever its owner typed, so it is bounded before it is kept:
 *  storage and layout are ours to protect, and no name needs more than this to
 *  identify an account. Cut on code points, or a surrogate pair splits into a
 *  replacement character. */
const kNameLimit = 64;

function boundedName(raw: string | undefined): string | undefined {
  const name = raw?.trim();
  if (!name) return undefined;
  const points = [...name];
  return points.length <= kNameLimit ? name : `${points.slice(0, kNameLimit - 1).join('')}…`;
}

/** Read while the account token is still in hand — the label outlives it, the
 *  token does not. A failure here costs a name, not the sign-in. */
async function displayName(call: typeof globalThis.fetch, accountToken: string): Promise<string | undefined> {
  try {
    const res = await call(`${issuer()}/oauth2/accountInfo`, {
      headers: { Authorization: `Bearer ${accountToken}` },
    });
    if (!res.ok) return undefined;
    const info = await res.json() as { nickname?: string; email?: string };
    return boundedName(info.nickname) ?? boundedName(info.email);
  }
  catch {
    return undefined;
  }
}

export async function signIn(options: SignInOptions = {}): Promise<SignInResult> {
  const interactive = options.interactive ?? true;
  const launch = options.launch ?? (details => chrome.identity.launchWebAuthFlow(details));
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);

  if (!clientId() || !kGatewayEndpoint) return { ok: false, reason: 'failed' };

  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  // Kept only for this attempt: it is the proof, so it must not outlive the
  // exchange it authorises.
  const verifier = newVerifier();
  const query = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'profile',
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });

  let landed: string | undefined;
  try {
    landed = await launch({ url: `${issuer()}/signin?${query}`, interactive });
  }
  catch {
    // Closed window, or no live session when silent.
    return { ok: false, reason: 'cancelled' };
  }
  if (!landed) return { ok: false, reason: 'cancelled' };

  const returned = new URL(landed).searchParams;
  if (returned.get('state') !== state) return { ok: false, reason: 'failed' };
  const code = returned.get('code');
  if (!code) return { ok: false, reason: returned.get('error') ? 'failed' : 'cancelled' };

  try {
    // No secret: the verifier is what authenticates this exchange. redirect_uri
    // repeats the authorization's value, which the server matches exactly.
    const token = await call(`${issuer()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId(),
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!token.ok) return { ok: false, reason: 'failed' };
    const account = (await token.json() as { access_token?: string }).access_token;
    if (!account) return { ok: false, reason: 'failed' };

    // The gateway keys its quota ledger by FydeOS account id, so this both
    // registers a first-time user and returns the same token to a returning one.
    const issued = await call(`${gatewayOrigin()}/api/oauth/fydeos/get_token`, {
      headers: { Authorization: `Bearer ${account}` },
    });
    if (!issued.ok) return { ok: false, reason: 'failed' };
    const key = (await issued.json() as { data?: { key?: string } }).data?.key?.trim();
    if (!key) return { ok: false, reason: 'failed' };
    return { ok: true, token: key, name: await displayName(call, account) };
  }
  catch {
    return { ok: false, reason: 'failed' };
  }
}
