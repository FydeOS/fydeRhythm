// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readStoredKey, writeStoredKey } from '../entrypoints/inputview/voice/credentials';
import { verifyCredentials } from '../entrypoints/inputview/voice/verify';
import { VoiceSection } from '../entrypoints/options/VoiceSection';

vi.mock('../entrypoints/inputview/voice/credentials', () => ({
  kDefaultResourceId: 'resource',
  readStoredKey: vi.fn(),
  writeStoredKey: vi.fn(),
}));
vi.mock('../entrypoints/inputview/voice/verify', () => ({
  verifyCredentials: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(readStoredKey).mockResolvedValue('');
  vi.mocked(writeStoredKey).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the voice key verifier', () => {
  it('keeps the normal save path immediate and publishes its own verdict', async () => {
    vi.mocked(verifyCredentials).mockResolvedValue('valid');

    render(<VoiceSection enabled onChange={() => {}} />);
    const input = await screen.findByLabelText('voice_key_api');
    fireEvent.change(input, { target: { value: 'current-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'voice_key_save' }));

    await screen.findByText('voice_key_valid');
    expect(writeStoredKey).toHaveBeenCalledExactlyOnceWith('current-key');
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
      apiKey: 'key-a',
      resourceId: 'resource',
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
    vi.mocked(writeStoredKey)
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
    expect(screen.getByText('voice_key_missing')).toBeTruthy();
  });
});
