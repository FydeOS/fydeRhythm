// @vitest-environment jsdom
//
// The session hook is where the asynchronous edges live: permission, capture
// and the header rule are all awaited, and the panel can close during any of
// them. These drive those windows directly, because the failure they guard
// against — a microphone left open behind a closed panel — is invisible in the
// UI and would only ever show up on a device.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureCallbacks, CaptureHandle } from '../entrypoints/inputview/voice/audio';
import { MicPermissionError, startCapture } from '../entrypoints/inputview/voice/audio';
import { readCredentials } from '../entrypoints/inputview/voice/credentials';
import { micPermission, watchMicPermission } from '../entrypoints/inputview/voice/permission';
import { installHeaderRule, openTransport, removeHeaderRule, type TransportCallbacks } from '../entrypoints/inputview/voice/transport';
import { useVoiceSession } from '../entrypoints/inputview/voice/use-voice-session';

vi.mock('../entrypoints/inputview/voice/audio', async original => ({
  ...(await original<object>()),
  startCapture: vi.fn(),
}));
vi.mock('../entrypoints/inputview/voice/credentials', () => ({ readCredentials: vi.fn() }));
vi.mock('../entrypoints/inputview/voice/permission', () => ({
  micPermission: vi.fn(),
  watchMicPermission: vi.fn(() => () => {}),
}));
vi.mock('../entrypoints/inputview/voice/transport', async original => ({
  ...(await original<object>()),
  installHeaderRule: vi.fn(),
  removeHeaderRule: vi.fn(),
  openTransport: vi.fn(),
  newSessionIds: () => ({ requestId: 'r', connectId: 'c' }),
}));

/** Runs an action inside act() and lets the hook's pending microtasks settle —
 *  every entry point here is fire-and-forget, so the assertions come after. */
async function settled(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

/** A promise plus the handle to settle it, so a test can hold the hook inside
 *  one specific await and act while it is there. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, settle };
}

const stop = vi.fn(() => Promise.resolve());
const sendAudio = vi.fn<(pcm: Int16Array, last?: boolean) => Promise<void>>(() => Promise.resolve());
const closeTransport = vi.fn();

let captured: CaptureCallbacks;
let transportCallbacks: TransportCallbacks;

function setup(consent = true) {
  const onCommit = vi.fn();
  const onConsentGiven = vi.fn();
  const view = renderHook(({ agreed }: { agreed: boolean }) => useVoiceSession({
    onCommit,
    consent: agreed,
    onConsentGiven,
    uid: 'uid',
  }), { initialProps: { agreed: consent } });
  return { ...view, onCommit, onConsentGiven };
}

beforeEach(() => {
  vi.mocked(readCredentials).mockReturnValue({ apiKey: 'k', resourceId: 'r' });
  vi.mocked(micPermission).mockResolvedValue('granted');
  vi.mocked(watchMicPermission).mockReturnValue(() => {});
  vi.mocked(installHeaderRule).mockResolvedValue(1);
  vi.mocked(removeHeaderRule).mockResolvedValue(undefined);
  vi.mocked(startCapture).mockImplementation((callbacks) => {
    captured = callbacks;
    return Promise.resolve({ stop } as CaptureHandle);
  });
  vi.mocked(openTransport).mockImplementation((options) => {
    transportCallbacks = options.callbacks;
    return { sendAudio, close: closeTransport };
  });
});

afterEach(() => vi.clearAllMocks());

describe('a session abandoned while it was still starting', () => {
  it('does not open a microphone behind a closed panel', async () => {
    // The panel closes while permission is still being read. close() can only
    // tear down handles that exist, and none do yet — so without a generation
    // check the continuation goes on to acquire a microphone that nothing will
    // ever stop, with no sign of it in the UI.
    const permission = deferred<'granted'>();
    vi.mocked(micPermission).mockReturnValue(permission.promise);

    const { result } = setup();
    act(() => { result.current.open(); });
    act(() => { result.current.close(); });

    await act(async () => {
      permission.settle('granted');
      await permission.promise;
    });

    expect(startCapture).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('releases a microphone that was already granted by the time it closed', async () => {
    // Here the await that outlives the panel is capture acquisition itself, so
    // a handle really does come back — and has to be handed straight back.
    const handle = deferred<CaptureHandle>();
    vi.mocked(startCapture).mockReturnValue(handle.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { result.current.close(); });

    await act(async () => {
      handle.settle({ stop });
      await handle.promise;
    });

    expect(stop).toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('tells a capture still being acquired that its panel has gone', async () => {
    // startCapture has awaits of its own — the worklet load, getUserMedia —
    // and a close during them is only visible through the polled signal. The
    // hook's own check runs after the handle returns, which is after the
    // microphone is already on.
    const handle = deferred<CaptureHandle>();
    vi.mocked(startCapture).mockImplementation((callbacks) => {
      captured = callbacks;
      return handle.promise;
    });

    const { result } = setup();
    await settled(() => { result.current.open(); });
    expect(captured.cancelled?.()).toBe(false);

    act(() => { result.current.close(); });
    expect(captured.cancelled?.()).toBe(true);
  });

  it('ignores a stale capture ending after a new session began', async () => {
    const { result } = setup();
    await settled(() => { result.current.open(); });
    const stale = captured;

    act(() => { result.current.close(); });
    await settled(() => { result.current.open(); });

    // The abandoned capture stops long after its session was replaced; it must
    // not finalise or fail the one that took its place.
    act(() => { stale.onEnd('silence'); });
    expect(result.current.state.kind).toBe('listening');
  });
});

describe('the first generation check', () => {
  it('takes the credential rule back down when it abandons an attempt', async () => {
    // Dynamic rules survive restarts, and the removal carries the install's own
    // token so a late abandon cannot take down a newer session's rule.
    const rule = deferred<number>();
    vi.mocked(installHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { result.current.close(); });
    await act(async () => {
      rule.settle(7);
      await rule.promise;
    });

    expect(removeHeaderRule).toHaveBeenCalledWith(7);
  });

  it('hands the transport the token of the rule it was opened with', async () => {
    // The transport removes the rule itself once the handshake is over, and it
    // shares rule id 1 with every other session — untokenised, an outlived
    // socket takes down whichever rule is installed by the time it notices.
    vi.mocked(installHeaderRule).mockResolvedValue(42);

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(openTransport).toHaveBeenCalledWith(expect.objectContaining({ headerRuleToken: 42 }));
  });

  it('abandons an attempt whose header rule finished after the panel closed', async () => {
    // The rule is installed and the socket opened between two awaits; without a
    // check here the transport is created behind a closed panel and stays open.
    const rule = deferred<number>();
    vi.mocked(installHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { result.current.close(); });

    await act(async () => {
      rule.settle(1);
      await rule.promise;
    });

    expect(openTransport).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('does not blame the microphone for a failure past capture', async () => {
    // The catch spans the header-rule install and the socket; capture already
    // succeeded there, so the failure is a connection problem, not the mic's.
    vi.mocked(installHeaderRule).mockRejectedValue(new Error('rules api failed'));

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
  });

  it('stops the microphone it had already opened when the panel closed', async () => {
    const { result } = setup();
    await settled(() => { result.current.open(); });
    expect(result.current.state.kind).toBe('listening');

    act(() => { result.current.close(); });
    expect(stop).toHaveBeenCalled();
    expect(closeTransport).toHaveBeenCalled();
  });
});

describe('an unqueryable permission state', () => {
  it('starts normally when getUserMedia succeeds', async () => {
    // unknown means the Permissions API could not answer, not that permission
    // is missing. Blocking here would make voice permanently unreachable on any
    // build where that query is unavailable — and going to settings would not
    // change the answer, so the user could never get out.
    vi.mocked(micPermission).mockResolvedValue('unknown');

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(startCapture).toHaveBeenCalledOnce();
    expect(result.current.state.kind).toBe('listening');
  });

  it('routes a dismissed prompt to the settings card, not to a retry', async () => {
    // The prompt is raised into a window that cannot show it. A generic error
    // card offers a retry that must fail the same way; the settings card leads
    // to the page that can actually ask.
    vi.mocked(micPermission).mockResolvedValue('unknown');
    vi.mocked(startCapture).mockRejectedValue(new MicPermissionError('prompt'));

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(result.current.state).toEqual({ kind: 'blocked', reason: 'permission' });
  });

  it('reports a genuinely unusable microphone as an error', async () => {
    // NotFoundError, NotReadableError, AbortError: the device really is
    // unavailable, and retrying is a reasonable thing to offer.
    vi.mocked(micPermission).mockResolvedValue('unknown');
    vi.mocked(startCapture).mockRejectedValue(new DOMException('gone', 'NotFoundError'));

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(result.current.state).toEqual({ kind: 'error', reason: 'microphone' });
  });
});

describe('a known-missing permission', () => {
  it('never reaches getUserMedia', async () => {
    for (const permission of ['prompt', 'denied'] as const) {
      vi.mocked(startCapture).mockClear();
      vi.mocked(micPermission).mockResolvedValue(permission);

      const { result, unmount } = setup();
      await settled(() => { result.current.open(); });

      expect(result.current.state).toEqual({ kind: 'blocked', reason: 'permission' });
      expect(startCapture).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe('consent', () => {
  it('starts on the first press, without asking again', async () => {
    // onConsentGiven only schedules the App's state update, so the options ref
    // still reads consent: false. Starting without saying otherwise shows the
    // consent card a second time on a user's very first attempt.
    const { result, onConsentGiven } = setup(false);
    await settled(() => { result.current.open(); });
    expect(result.current.state).toEqual({ kind: 'blocked', reason: 'consent' });

    await settled(() => { result.current.consent(); });

    expect(onConsentGiven).toHaveBeenCalledOnce();
    expect(result.current.state.kind).toBe('listening');
  });
});

describe('ordering across the readiness boundary', () => {
  it('keeps one backlog until the socket is ready', async () => {
    // The transport exists from the moment the socket starts connecting, so
    // switching to it on assignment would put newer audio — and a stop's final
    // packet — ahead of everything captured before it.
    const rule = deferred<number>();
    vi.mocked(installHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { captured.onBatch(new Int16Array([1])); });

    await act(async () => {
      rule.settle(1);
      await rule.promise;
    });
    // The transport is assigned but the handshake has not finished.
    act(() => { captured.onBatch(new Int16Array([2])); });
    expect(sendAudio).not.toHaveBeenCalled();

    act(() => { transportCallbacks.onReady(); });
    const order = sendAudio.mock.calls.map(([pcm]) => pcm[0]);
    expect(order).toEqual([1, 2]);
  });
});

describe('an empty server packet', () => {
  it('means nothing changed, not that the transcript is empty', async () => {
    // bigmodel_async only sends a packet when something changed. Reading an
    // empty one as an empty transcript blanks the panel mid-sentence.
    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });

    act(() => { transportCallbacks.onResult({ utterances: [{ text: '说了一半' }] }, false); });
    expect(result.current.state).toMatchObject({ pending: '说了一半' });

    act(() => { transportCallbacks.onResult(null, false); });
    expect(result.current.state).toMatchObject({ pending: '说了一半' });
  });

  it('does not discard the tail when the final packet is empty', async () => {
    const { result, onCommit } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });
    act(() => { transportCallbacks.onResult({ utterances: [{ text: '最后半句' }] }, false); });

    // The flush must work from the last snapshot, not from the empty packet.
    act(() => { transportCallbacks.onResult(null, true); });
    expect(onCommit).toHaveBeenCalledWith('最后半句');
  });
});

describe('stopping before the socket is up', () => {
  it('still tells the server to finalise once it connects', async () => {
    const rule = deferred<number>();
    vi.mocked(installHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });

    // Capture is live but the transport is not: a stop here would otherwise
    // drop the final packet, the server would never emit its last sentence,
    // and the finalise timeout would discard the transcript.
    act(() => { captured.onEnd('caller'); });
    expect(sendAudio).not.toHaveBeenCalled();

    await act(async () => {
      rule.settle(1);
      await rule.promise;
    });
    act(() => { transportCallbacks.onReady(); });

    await waitFor(() => expect(sendAudio).toHaveBeenCalled());
    expect(sendAudio.mock.calls.at(-1)?.[1]).toBe(true);
  });
});
