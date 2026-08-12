import { afterEach, describe, expect, it, vi } from 'vitest';

import { kDefaultClientId, kDefaultIssuer, voiceEnabled } from '../lib/voice-build';

describe('the voice build flag', () => {
  it('is off when unset, so a build leaves voice out unless asked', () => {
    expect(voiceEnabled(undefined)).toBe(false);
    expect(voiceEnabled('')).toBe(false);
    expect(voiceEnabled('   ')).toBe(false);
  });

  // A shell or CI that spells "off" this way would otherwise turn voice on.
  it.each(['0', 'false', 'FALSE', ' False '])('reads %o as off', (raw) => {
    expect(voiceEnabled(raw)).toBe(false);
  });

  it.each(['1', 'true', ' yes ', 'on'])('reads %o as on', (raw) => {
    expect(voiceEnabled(raw)).toBe(true);
  });
});

describe('the hardcoded service defaults', () => {
  afterEach(() => vi.unstubAllEnvs());

  // The production values ship as constants; the env vars only exist so a
  // development deployment can be pointed at instead.
  it('falls back to the constants when no env var overrides them', async () => {
    vi.stubEnv('FYDE_ACCOUNT_CLIENT_ID', undefined);
    vi.stubEnv('FYDE_ACCOUNT_ISSUER', undefined);
    const { clientId, issuer } = await import('../entrypoints/inputview/voice/signin');
    expect(clientId()).toBe(kDefaultClientId);
    expect(issuer()).toBe(kDefaultIssuer);
  });

  it('prefers the env var when one is set', async () => {
    vi.stubEnv('FYDE_ACCOUNT_ISSUER', 'http://account.dev.test');
    const { issuer } = await import('../entrypoints/inputview/voice/signin');
    expect(issuer()).toBe('http://account.dev.test');
  });

  // Empty would ship a sign-in button with nowhere to send the user.
  it('has a client id to sign in with', () => {
    expect(kDefaultClientId).not.toBe('');
  });
});
