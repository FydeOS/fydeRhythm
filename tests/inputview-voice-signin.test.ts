import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clientId, issuer, signIn } from '../entrypoints/inputview/voice/signin';

// Pin the endpoint here rather than reading the build's: these are unit tests
// of the sign-in flow, and gating them on a build-time variable means they
// quietly stop running wherever it is unset — CI, a colleague's checkout.
vi.mock('../entrypoints/inputview/voice/transport', () => ({
  kGatewayEndpoint: 'wss://gateway.test/v1/asr/stream',
}));

const kRedirect = 'https://nfglebjgiflmmcdddkbcbgmdkomlfcpa.chromiumapp.org/';

function stubChrome() {
  vi.stubGlobal('chrome', {
    identity: {
      getRedirectURL: () => kRedirect,
      launchWebAuthFlow: vi.fn(),
    },
  });
}

/** Echoes back the state the caller generated, so the happy path is reachable. */
function landing(params: Record<string, string>) {
  return async (details: { url: string }) => {
    const state = new URL(details.url).searchParams.get('state')!;
    const landed = new URL(kRedirect);
    for (const [key, value] of Object.entries({ state, ...params })) landed.searchParams.set(key, value);
    return landed.toString();
  };
}

/** The two calls a successful sign-in makes: the account token exchange, then
 *  the gateway trading it for the token this extension keeps. */
function stubFetch(overrides: { token?: Response; issued?: Response; info?: Response } = {}) {
  return vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.endsWith('/oauth2/token')) {
      return overrides.token ?? new Response(JSON.stringify({ access_token: 'account-token' }), { status: 200 });
    }
    if (href.endsWith('/api/oauth/fydeos/get_token')) {
      return overrides.issued ?? new Response(JSON.stringify({ success: true, data: { key: 'sk-issued' } }), { status: 200 });
    }
    if (href.endsWith('/oauth2/accountInfo')) {
      return overrides.info ?? new Response(JSON.stringify({ nickname: 'Voice Tester', email: 'voice@fydeos.io' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  stubChrome();
  // A build without a client id offers no sign-in, so pin one here rather than
  // letting the ambient environment decide whether these tests mean anything.
  vi.stubEnv('FYDE_ACCOUNT_CLIENT_ID', 'test-client');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('account sign-in', () => {
  it('authorises with PKCE and trades the account token for a gateway token', async () => {
    let authorizeUrl = '';
    const launch = vi.fn(async (details: { url: string; interactive: boolean }) => {
      authorizeUrl = details.url;
      return landing({ code: 'the-code' })(details);
    });
    const call = stubFetch();

    const result = await signIn({ launch, fetch: call });
    expect(result).toEqual({ ok: true, token: 'sk-issued', name: 'Voice Tester' });

    const sent = new URL(authorizeUrl);
    expect(sent.origin + sent.pathname).toBe(`${issuer()}/signin`);
    expect(Object.fromEntries(sent.searchParams)).toMatchObject({
      client_id: clientId(),
      redirect_uri: kRedirect,
      response_type: 'code',
      scope: 'profile',
      code_challenge_method: 'S256',
    });

    // The exchange carries the verifier and no secret: this client ships none.
    const body = new URLSearchParams((call as never as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: clientId(),
      redirect_uri: kRedirect,
    });
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBeNull();
  });

  it('sends a challenge the account server will accept', async () => {
    let authorizeUrl = '';
    const launch = vi.fn(async (details: { url: string; interactive: boolean }) => {
      authorizeUrl = details.url;
      return landing({ code: 'c' })(details);
    });
    const call = stubFetch();
    await signIn({ launch, fetch: call });

    // Server-side: base64url of a SHA-256 digest, and a verifier of 43-128
    // characters from the unreserved set.
    const challenge = new URL(authorizeUrl).searchParams.get('code_challenge')!;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const verifier = new URLSearchParams((call as never as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string).get('code_verifier')!;
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);

    // The challenge must actually be the digest of the verifier we sent.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('uses a fresh verifier for every attempt', async () => {
    const verifiers = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const call = stubFetch();
      await signIn({ launch: vi.fn(landing({ code: 'c' })), fetch: call });
      verifiers.add(new URLSearchParams((call as never as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string).get('code_verifier')!);
    }
    expect(verifiers.size).toBe(3);
  });

  it('refuses a callback whose state does not match', async () => {
    const launch = vi.fn(async () => `${kRedirect}?code=c&state=someone-elses`);
    const call = stubFetch();
    expect(await signIn({ launch, fetch: call })).toEqual({ ok: false, reason: 'failed' });
    expect(call).not.toHaveBeenCalled();
  });

  it('reads a closed window as cancelled, so the card offers another try', async () => {
    const thrown = await signIn({ launch: vi.fn(async () => { throw new Error('closed'); }), fetch: stubFetch() });
    expect(thrown).toEqual({ ok: false, reason: 'cancelled' });

    const empty = await signIn({ launch: vi.fn(async () => undefined), fetch: stubFetch() });
    expect(empty).toEqual({ ok: false, reason: 'cancelled' });

    // A callback with neither code nor error is the same dismissal.
    const bare = await signIn({ launch: vi.fn(landing({})), fetch: stubFetch() });
    expect(bare).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('reports a refused authorization as a failure, not a dismissal', async () => {
    const result = await signIn({ launch: vi.fn(landing({ error: 'access_denied' })), fetch: stubFetch() });
    expect(result).toEqual({ ok: false, reason: 'failed' });
  });

  it.each([
    ['the account exchange', { token: new Response('{}', { status: 400 }) }],
    ['the gateway', { issued: new Response('{}', { status: 401 }) }],
  ])('fails when %s refuses', async (_name, overrides) => {
    const result = await signIn({ launch: vi.fn(landing({ code: 'c' })), fetch: stubFetch(overrides) });
    expect(result).toEqual({ ok: false, reason: 'failed' });
  });

  it('names the account, falling back to the email and then to nothing', async () => {
    const named = await signIn({ launch: vi.fn(landing({ code: 'c' })), fetch: stubFetch() });
    expect(named).toMatchObject({ name: 'Voice Tester' });

    const byEmail = await signIn({
      launch: vi.fn(landing({ code: 'c' })),
      fetch: stubFetch({ info: new Response(JSON.stringify({ email: 'voice@fydeos.io' }), { status: 200 }) }),
    });
    expect(byEmail).toMatchObject({ name: 'voice@fydeos.io' });

    // A label is not worth failing a sign-in over.
    const nameless = await signIn({
      launch: vi.fn(landing({ code: 'c' })),
      fetch: stubFetch({ info: new Response('{}', { status: 500 }) }),
    });
    expect(nameless).toEqual({ ok: true, token: 'sk-issued', name: undefined });
  });

  it('bounds a name the account owner chose, on code points', async () => {
    const long = await signIn({
      launch: vi.fn(landing({ code: 'c' })),
      fetch: stubFetch({ info: new Response(JSON.stringify({ nickname: 'x'.repeat(500) }), { status: 200 }) }),
    });
    expect([...(long as { name: string }).name]).toHaveLength(64);
    expect((long as { name: string }).name.endsWith('…')).toBe(true);

    // Emoji are one code point each: cutting by UTF-16 units would leave half
    // a surrogate pair and render as a replacement character.
    const emoji = await signIn({
      launch: vi.fn(landing({ code: 'c' })),
      fetch: stubFetch({ info: new Response(JSON.stringify({ nickname: '🐈'.repeat(100) }), { status: 200 }) }),
    });
    expect((emoji as { name: string }).name).not.toContain('\uFFFD');
    expect([...(emoji as { name: string }).name]).toHaveLength(64);

    // A name that fits is kept whole, with no ellipsis bolted on.
    const short = await signIn({
      launch: vi.fn(landing({ code: 'c' })),
      fetch: stubFetch({ info: new Response(JSON.stringify({ nickname: 'Voice Tester' }), { status: 200 }) }),
    });
    expect(short).toMatchObject({ name: 'Voice Tester' });
  });
});
