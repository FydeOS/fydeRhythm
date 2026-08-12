import { afterEach, describe, expect, it, vi } from 'vitest';

import { MicPermissionError, startCapture } from '../entrypoints/inputview/voice/audio';
import { kMaxSessionMs } from '../entrypoints/inputview/voice/capture-policy';

const addModule = vi.fn(() => Promise.resolve());
const closeContext = vi.fn(() => Promise.resolve());
const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: (): { stop: () => void }[] => [] }));

function stubAudio() {
  vi.stubGlobal('AudioContext', class {
    audioWorklet = { addModule };
    close = closeContext;
    createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} });
  });
  vi.stubGlobal('AudioWorkletNode', class {
    port = { postMessage: () => {}, onmessage: null };
    connect = () => {};
    disconnect = () => {};
  });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia },
    // Reported as unavailable, so startCapture proceeds to getUserMedia — the
    // path these tests are about.
    permissions: undefined,
  });
}

const callbacks = { onBatch: vi.fn(), onLevel: vi.fn(), onEnd: vi.fn() };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  addModule.mockResolvedValue(undefined);
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
});

describe('the session ceiling', () => {
  it('bounds wall time by the same number as captured audio', async () => {
    // The batch counter stops when the worklet stops, so it cannot bound a
    // stalled capture. Giving the wall clock a larger number would have made
    // the stalled case the most permissive one — the ceiling limits how long
    // the microphone may be open, not how much audio is collected.
    stubAudio();
    vi.useFakeTimers();
    const onEnd = vi.fn();

    await startCapture({ ...callbacks, onEnd });
    await vi.advanceTimersByTimeAsync(kMaxSessionMs + 500);

    expect(onEnd).toHaveBeenCalledWith('timeout', undefined);
    vi.useRealTimers();
  });

  it('does not stop early while audio is still flowing', async () => {
    stubAudio();
    vi.useFakeTimers();
    const onEnd = vi.fn();

    await startCapture({ ...callbacks, onEnd });
    await vi.advanceTimersByTimeAsync(kMaxSessionMs - 1000);

    expect(onEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('a caller that gave up during setup', () => {
  it('never opens the microphone when cancelled while the worklet loads', async () => {
    // The caller's own check runs only once the handle returns; without the
    // polled signal a close during addModule still walks into getUserMedia.
    stubAudio();
    let cancelled = false;
    addModule.mockImplementation(async () => { cancelled = true; });

    await expect(startCapture({ ...callbacks, cancelled: () => cancelled }))
      .rejects.toThrow(/cancelled/);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
  });

  it('releases a microphone granted after the caller had gone', async () => {
    // A cancellation during getUserMedia itself cannot be prevented, only made
    // right: the track stops here rather than waiting on a handle the caller
    // will never hold.
    stubAudio();
    const stopTrack = vi.fn();
    let cancelled = false;
    getUserMedia.mockImplementation(async () => {
      cancelled = true;
      return { getTracks: () => [{ stop: stopTrack }] };
    });

    await expect(startCapture({ ...callbacks, cancelled: () => cancelled }))
      .rejects.toThrow(/cancelled/);

    expect(stopTrack).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
  });
});

describe('acquiring the microphone', () => {
  it('loads the worklet before opening the microphone', async () => {
    // Reversed, a caller that gives up while addModule is still resolving has
    // no handle to stop with — and the stream is already live, so the
    // microphone stays on with nothing holding it.
    stubAudio();
    const module = { settled: false };
    addModule.mockImplementation(async () => {
      expect(getUserMedia).not.toHaveBeenCalled();
      module.settled = true;
    });

    await startCapture(callbacks);

    expect(module.settled).toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('never opens the microphone if the worklet cannot load', async () => {
    stubAudio();
    addModule.mockRejectedValue(new Error('csp'));

    await expect(startCapture(callbacks)).rejects.toThrow('csp');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
  });

  it('reports a dismissed prompt as a permission problem, not a broken device', async () => {
    // An IME window cannot show a permission bubble, so the prompt is dismissed
    // unseen. Reporting it as a microphone fault would offer a retry that fails
    // the same way; reporting permission routes the user to the page that can
    // actually ask.
    stubAudio();
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

    await expect(startCapture(callbacks)).rejects.toBeInstanceOf(MicPermissionError);
    expect(closeContext).toHaveBeenCalled();
  });

  it('lets an unrelated failure through unchanged', async () => {
    stubAudio();
    getUserMedia.mockRejectedValue(new DOMException('gone', 'NotFoundError'));

    await expect(startCapture(callbacks)).rejects.toThrow('gone');
  });
});
