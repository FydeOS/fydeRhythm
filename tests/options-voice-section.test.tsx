// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Credentials from '../entrypoints/inputview/voice/credentials';
import { kDefaultResourceId, readStoredCredentials, writeStoredCredentials } from '../entrypoints/inputview/voice/credentials';
import type { MicPermission } from '../entrypoints/inputview/voice/permission';
import { signIn } from '../entrypoints/inputview/voice/signin';
import { verifyCredentials } from '../entrypoints/inputview/voice/verify';
import { VoiceSection } from '../entrypoints/options/VoiceSection';
import { voiceEnabled } from '../lib/voice-build';

// credentialsFrom stays real: which route a key takes is what is under test.
vi.mock('../entrypoints/inputview/voice/credentials', async importOriginal => ({
  ...await importOriginal<typeof Credentials>(),
  readStoredCredentials: vi.fn(),
  writeStoredCredentials: vi.fn(),
}));
vi.mock('../entrypoints/inputview/voice/verify', () => ({
  verifyCredentials: vi.fn(),
}));
vi.mock('../entrypoints/inputview/voice/signin', () => ({
  signIn: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(readStoredCredentials).mockResolvedValue({ source: 'own', gatewayToken: '', gatewayAccount: '', apiKey: '' });
  vi.mocked(writeStoredCredentials).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The Permissions API, with a handle for answering as Chrome would. */
function stubMic(initial: MicPermission) {
  const listeners = new Set<() => void>();
  const status = {
    state: initial,
    addEventListener: (_type: string, handler: () => void) => { listeners.add(handler); },
    removeEventListener: (_type: string, handler: () => void) => { listeners.delete(handler); },
  };
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: async () => status },
  });
  return {
    answer(next: MicPermission) {
      status.state = next;
      listeners.forEach(handler => handler());
    },
  };
}

function stubGetUserMedia(result: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(result);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

describe('the microphone switch', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'permissions');
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('turns the setting on without waiting for an answer to the prompt', async () => {
    stubMic('prompt');
    // A bubble nobody answers: never settles, never rejects, cannot be cancelled.
    const asked = stubGetUserMedia(() => new Promise<MediaStream>(() => {}));
    const onChange = vi.fn();

    render(<VoiceSection enabled={false} onChange={onChange} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'voice_input' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(asked).toHaveBeenCalledOnce();
  });

  it('asks for the microphone only when the switch goes on', async () => {
    stubMic('prompt');
    const asked = stubGetUserMedia(() => new Promise<MediaStream>(() => {}));

    render(<VoiceSection enabled onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'voice_input' }));

    expect(asked).not.toHaveBeenCalled();
  });

  it('offers a way back to the prompt while one is still reachable', async () => {
    stubMic('prompt');
    const asked = stubGetUserMedia(() => new Promise<MediaStream>(() => {}));
    render(<VoiceSection enabled onChange={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'voice_mic_retry' }));
    expect(asked).toHaveBeenCalledOnce();
  });

  it('offers no retry once the microphone is blocked outright', async () => {
    stubMic('denied');
    stubGetUserMedia(() => Promise.reject(new Error('NotAllowedError')));
    render(<VoiceSection enabled onChange={() => {}} />);

    await screen.findByText('voice_mic_denied');
    expect(screen.queryByRole('button', { name: 'voice_mic_retry' })).toBeNull();
  });

  it('clears the warning when the grant arrives from outside this page', async () => {
    const mic = stubMic('denied');
    render(<VoiceSection enabled onChange={() => {}} />);
    await screen.findByText('voice_mic_denied');

    act(() => mic.answer('granted'));

    await waitFor(() => expect(screen.queryByText('voice_mic_denied')).toBeNull());
    expect(screen.queryByText('voice_mic_needed')).toBeNull();
  });

  it('warns about nothing while the feature is off', async () => {
    const mic = stubMic('denied');
    render(<VoiceSection enabled onChange={() => {}} />);
    await screen.findByText('voice_mic_denied');

    cleanup();
    render(<VoiceSection enabled={false} onChange={() => {}} />);
    act(() => mic.answer('denied'));

    await waitFor(() => expect(screen.queryByText('voice_mic_denied')).toBeNull());
    expect(screen.queryByText('voice_mic_needed')).toBeNull();
  });
});

describe('the voice key verifier', () => {
  it('keeps the normal save path immediate and publishes its own verdict', async () => {
    vi.mocked(verifyCredentials).mockResolvedValue('valid');

    render(<VoiceSection enabled onChange={() => {}} />);
    const input = await screen.findByLabelText('voice_key_api');
    fireEvent.change(input, { target: { value: 'current-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));

    await screen.findByText('voice_key_valid');
    expect(writeStoredCredentials).toHaveBeenCalledExactlyOnceWith({ apiKey: 'current-key' });
    expect(verifyCredentials).toHaveBeenCalledOnce();
  });

  it('shows only the verdict for the newest saved key', async () => {
    const first = deferred<'invalid'>();
    const second = deferred<'valid'>();
    vi.mocked(verifyCredentials)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<VoiceSection enabled onChange={() => {}} />);
    const input = await screen.findByLabelText('voice_key_api');
    fireEvent.change(input, { target: { value: 'key-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));
    await waitFor(() => expect(verifyCredentials).toHaveBeenCalledWith({
      mode: 'direct',
      apiKey: 'key-a',
      resourceId: kDefaultResourceId,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'voice_key_remove' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'voice_key_save' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('voice_key_api'), { target: { value: 'key-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));
    await waitFor(() => expect(verifyCredentials).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve('invalid');
      await first.promise;
    });
    expect(screen.getByText('voice_key_checking')).toBeTruthy();

    await act(async () => {
      second.resolve('valid');
      await second.promise;
    });
    expect(screen.getByText('voice_key_valid')).toBeTruthy();
    expect(screen.queryByText('voice_key_invalid')).toBeNull();
  });

  it('invalidates an old verification as soon as remove is clicked', async () => {
    const verification = deferred<'invalid'>();
    const removeWrite = deferred<void>();
    vi.mocked(verifyCredentials).mockReturnValue(verification.promise);
    vi.mocked(writeStoredCredentials)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(removeWrite.promise);

    render(<VoiceSection enabled onChange={() => {}} />);
    const input = await screen.findByLabelText('voice_key_api');
    fireEvent.change(input, { target: { value: 'old-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));
    await screen.findByText('voice_key_checking');

    fireEvent.click(screen.getByRole('button', { name: 'voice_key_remove' }));
    await act(async () => {
      verification.resolve('invalid');
      await verification.promise;
    });
    // Removal is still writing, but the old verifier must already be unable to
    // publish. Otherwise a slow storage write briefly shows the wrong verdict.
    expect(screen.getByText('voice_key_checking')).toBeTruthy();
    expect(screen.queryByText('voice_key_invalid')).toBeNull();

    await act(async () => {
      removeWrite.resolve();
      await removeWrite.promise;
    });
    expect(screen.queryByText('voice_key_checking')).toBeNull();
    expect((screen.getByLabelText('voice_key_api') as HTMLInputElement).value).toBe('');
  });
});

// The picker only exists in a build that was given voice.
describe.skipIf(!voiceEnabled(import.meta.env.FYDE_VOICE_INPUT))('switching between the two sources', () => {
  beforeEach(() => {
    vi.mocked(readStoredCredentials).mockResolvedValue({
      source: 'own',
      gatewayToken: 'sk-saved',
      gatewayAccount: '',
      apiKey: 'volc-saved',
    });
  });

  it('never asks for a credential on our own service', async () => {
    render(<VoiceSection enabled onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'voice_key_source_gateway' }));

    await waitFor(() => expect(screen.queryByLabelText('voice_key_api')).toBeNull());
    expect(screen.queryByRole('button', { name: 'voice_key_save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'voice_key_signout' })).toBeTruthy();
  });

  it('offers sign-in, not a form, when the account has no session yet', async () => {
    vi.mocked(readStoredCredentials).mockResolvedValue({
      source: 'gateway',
      gatewayToken: '',
      gatewayAccount: '',
      apiKey: 'volc-saved',
    });
    render(<VoiceSection enabled onChange={() => {}} />);

    expect(await screen.findByRole('button', { name: 'voice_key_signin' })).toBeTruthy();
    expect(screen.queryByLabelText('voice_key_api')).toBeNull();
  });

  it('stores the token a completed sign-in returns', async () => {
    vi.mocked(readStoredCredentials).mockResolvedValue({ source: 'gateway', gatewayToken: '', gatewayAccount: '', apiKey: '' });
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: 'sk-fresh', name: 'someone@fydeos.com' });
    render(<VoiceSection enabled onChange={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'voice_key_signin' }));

    await waitFor(() => expect(writeStoredCredentials).toHaveBeenCalledWith({
      gatewayToken: 'sk-fresh',
      gatewayAccount: 'someone@fydeos.com',
    }));
    // The exchange already proved the session.
    expect(verifyCredentials).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: 'voice_key_signout' });
  });

  it('says nothing when the user closes the sign-in window', async () => {
    vi.mocked(readStoredCredentials).mockResolvedValue({ source: 'gateway', gatewayToken: '', gatewayAccount: '', apiKey: '' });
    vi.mocked(signIn).mockResolvedValue({ ok: false, reason: 'cancelled' });
    render(<VoiceSection enabled onChange={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'voice_key_signin' }));

    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(screen.queryByText('voice_key_signin_failed')).toBeNull();
    expect(writeStoredCredentials).not.toHaveBeenCalled();
  });

  it('reports a sign-in that actually failed', async () => {
    vi.mocked(readStoredCredentials).mockResolvedValue({ source: 'gateway', gatewayToken: '', gatewayAccount: '', apiKey: '' });
    vi.mocked(signIn).mockResolvedValue({ ok: false, reason: 'failed' });
    render(<VoiceSection enabled onChange={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'voice_key_signin' }));

    await screen.findByText('voice_key_signin_failed');
    expect(writeStoredCredentials).not.toHaveBeenCalled();
  });

  it('keeps the other source\'s credential through a round trip', async () => {
    render(<VoiceSection enabled onChange={() => {}} />);
    // A locked field shows only a tail, which is what identifies it.
    expect(((await screen.findByLabelText('voice_key_api')) as HTMLInputElement).value).toContain('aved');

    fireEvent.click(screen.getByRole('button', { name: 'voice_key_source_gateway' }));
    await waitFor(() => expect(screen.queryByLabelText('voice_key_api')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_source_own' }));

    // Choosing a source writes only the choice.
    expect(((await screen.findByLabelText('voice_key_api')) as HTMLInputElement).value).toContain('aved');
    expect(writeStoredCredentials).toHaveBeenNthCalledWith(1, { source: 'gateway' });
    expect(writeStoredCredentials).toHaveBeenNthCalledWith(2, { source: 'own' });
  });

  it('does not carry one source\'s verdict over to the other', async () => {
    vi.mocked(verifyCredentials).mockResolvedValue('invalid');
    render(<VoiceSection enabled onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'voice_key_remove' }));
    fireEvent.change(await screen.findByLabelText('voice_key_api'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));
    await screen.findByText('voice_key_invalid');

    fireEvent.click(screen.getByRole('button', { name: 'voice_key_source_gateway' }));

    // A rejected Volcano key says nothing about the gateway token.
    await waitFor(() => expect(screen.queryByText('voice_key_invalid')).toBeNull());
    expect(screen.getByRole('button', { name: 'voice_key_signout' })).toBeTruthy();
  });
});
