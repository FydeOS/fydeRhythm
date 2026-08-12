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
import {
  acquireHeaderRule,
  type HeaderRuleLease,
  kHandshakeTimeoutMs,
  openTransport,
  type SocketLike,
  type TransportCallbacks,
} from '../entrypoints/inputview/voice/transport';
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
  acquireHeaderRule: vi.fn(),
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
const releaseRule = vi.fn();

let captured: CaptureCallbacks;
let transportCallbacks: TransportCallbacks;

function setup() {
  const onCommit = vi.fn();
  const view = renderHook(() => useVoiceSession({ onCommit, uid: 'uid' }));
  return { ...view, onCommit };
}

beforeEach(() => {
  vi.mocked(readCredentials).mockReturnValue({ mode: 'direct', apiKey: 'k', resourceId: 'r' });
  vi.mocked(micPermission).mockResolvedValue('granted');
  vi.mocked(watchMicPermission).mockReturnValue(() => {});
  vi.mocked(acquireHeaderRule).mockResolvedValue({ release: releaseRule });
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
    // Dynamic rules survive restarts, so abandoning a lease after acquisition
    // must release it before another extension page can install its own rule.
    const rule = deferred<HeaderRuleLease>();
    vi.mocked(acquireHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { result.current.close(); });
    await act(async () => {
      rule.settle({ release: releaseRule });
      await rule.promise;
    });

    expect(releaseRule).toHaveBeenCalledOnce();
  });

  it('hands the transport the lease of the rule it was opened with', async () => {
    const lease = { release: releaseRule };
    vi.mocked(acquireHeaderRule).mockResolvedValue(lease);

    const { result } = setup();
    await settled(() => { result.current.open(); });

    expect(openTransport).toHaveBeenCalledWith(expect.objectContaining({ headerRuleLease: lease }));
  });

  it('abandons an attempt whose header rule finished after the panel closed', async () => {
    // The rule is installed and the socket opened between two awaits; without a
    // check here the transport is created behind a closed panel and stays open.
    const rule = deferred<HeaderRuleLease>();
    vi.mocked(acquireHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { result.current.close(); });

    await act(async () => {
      rule.settle({ release: releaseRule });
      await rule.promise;
    });

    expect(openTransport).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('does not blame the microphone for a failure past capture', async () => {
    // The catch spans the header-rule install and the socket; capture already
    // succeeded there, so the failure is a connection problem, not the mic's.
    vi.mocked(acquireHeaderRule).mockRejectedValue(new Error('rules api failed'));

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

describe('transport failure recovery', () => {
  it('turns two real black-holed handshakes into one retry and a visible error', async () => {
    vi.useFakeTimers();
    const sockets: SocketLike[] = [];
    class BlackHoleSocket implements SocketLike {
      binaryType = '';
      onopen: SocketLike['onopen'] = null;
      onmessage: SocketLike['onmessage'] = null;
      onerror: SocketLike['onerror'] = null;
      onclose: SocketLike['onclose'] = null;

      constructor(_url: string) {
        sockets.push(this);
      }

      send() {}
      close() {}
    }

    const actualTransport = await vi.importActual<{ openTransport: typeof openTransport }>(
      '../entrypoints/inputview/voice/transport',
    );
    vi.mocked(openTransport).mockImplementation(actualTransport.openTransport);
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', BlackHoleSocket);
    try {
      const { result } = setup();
      await settled(() => { result.current.open(); });
      expect(sockets).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(kHandshakeTimeoutMs);
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      expect(result.current.state.kind).toBe('listening');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(kHandshakeTimeoutMs);
        await Promise.resolve();
      });
      expect(sockets).toHaveLength(2);
      expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
    }
    finally {
      vi.stubGlobal('WebSocket', originalWebSocket);
      vi.useRealTimers();
    }
  });

  it('retries from the real transport close event, not only a mocked callback', async () => {
    const sockets: SocketLike[] = [];
    class ClosingSocket implements SocketLike {
      binaryType = '';
      onopen: SocketLike['onopen'] = null;
      onmessage: SocketLike['onmessage'] = null;
      onerror: SocketLike['onerror'] = null;
      onclose: SocketLike['onclose'] = null;

      constructor(_url: string) {
        sockets.push(this);
      }

      send() {}
      close() {}
    }

    const actualTransport = await vi.importActual<{ openTransport: typeof openTransport }>(
      '../entrypoints/inputview/voice/transport',
    );
    // Pin the handshake probe to "no network": these sockets die before they
    // open, and the default probe would fetch the real endpoint host.
    vi.mocked(openTransport).mockImplementation(options =>
      actualTransport.openTransport({ ...options, probeReachability: () => Promise.resolve(false) }));
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', ClosingSocket);
    try {
      const { result } = setup();
      await settled(() => { result.current.open(); });
      expect(sockets).toHaveLength(1);

      act(() => { sockets[0]?.onclose?.call(null, {}); });
      await waitFor(() => expect(sockets).toHaveLength(2));
      expect(result.current.state.kind).toBe('listening');

      // The retried real transport shares the same one-retry budget. A second
      // failure delivered through WebSocket.onerror must surface instead of
      // starting a third invisible recording attempt.
      act(() => { sockets[1]?.onerror?.call(null, {}); });
      await waitFor(() => expect(result.current.state).toEqual({ kind: 'error', reason: 'network' }));
      expect(sockets).toHaveLength(2);
    }
    finally {
      vi.stubGlobal('WebSocket', originalWebSocket);
    }
  });

  it('retries a clean pre-commit close once, then reports the next close', async () => {
    const { result } = setup();
    await settled(() => { result.current.open(); });

    act(() => { transportCallbacks.onClosed(); });
    await waitFor(() => expect(openTransport).toHaveBeenCalledTimes(2));
    expect(result.current.state.kind).toBe('listening');

    // The retry budget is shared with the socket-error path. A second clean
    // close must stop rather than loop forever.
    act(() => { transportCallbacks.onClosed(); });
    expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
  });

  it('does not reopen the microphone when the stop and the close land together', async () => {
    // The retry gate asks whether the session is still listening, and the answer
    // lives in a ref written inside a setState updater — so a close arriving in
    // the same batch as the stop still sees 'listening'. The user tapped stop;
    // restarting capture there records them without being asked.
    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });

    await settled(() => {
      captured.onEnd('caller');
      transportCallbacks.onClosed();
    });
    // The retry is async, so let it get as far as it is going to.
    await settled(() => {});

    expect(startCapture).toHaveBeenCalledOnce();
    expect(openTransport).toHaveBeenCalledOnce();
    expect(result.current.state.kind).not.toBe('listening');
  });

  it('does not reopen the microphone when the socket fails while a stop is winding down', async () => {
    // stop() asks the capture layer to end; its onEnd arrives later. A socket
    // failure in that gap must not read as "still talking" either — the user has
    // already said they were done.
    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });

    await settled(() => {
      result.current.stop();
      transportCallbacks.onClosed();
    });
    await settled(() => {});

    expect(startCapture).toHaveBeenCalledOnce();
    expect(result.current.state.kind).not.toBe('listening');
  });

  it('does not retry a clean close after text has been committed', async () => {
    const { result, onCommit } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });
    act(() => {
      transportCallbacks.onResult({ utterances: [{ text: '已经写入。', definite: true }] }, false);
    });
    expect(onCommit).toHaveBeenCalledWith('已经写入。');

    act(() => { transportCallbacks.onClosed(); });

    expect(openTransport).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
  });

  it('retries once when the network drops mid-speech without inserting an unconfirmed tail', async () => {
    const { result, onCommit } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });
    act(() => {
      transportCallbacks.onResult({ utterances: [{ text: '还没有确认的内容' }] }, false);
    });
    expect(result.current.state).toMatchObject({ kind: 'listening', pending: '还没有确认的内容' });

    act(() => { transportCallbacks.onError('network', 'offline'); });
    await waitFor(() => expect(openTransport).toHaveBeenCalledTimes(2));

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ kind: 'listening', pending: '' });
  });

  it('keeps the source the session started on when options change under it', async () => {
    // The running transport was handed its credentials at start and never
    // re-reads them, so the failure card must name that route — not whatever
    // the options page happens to hold when the card renders.
    vi.mocked(readCredentials).mockReturnValue({ mode: 'gateway', token: 'sk-1' });
    const { result } = setup();
    await settled(() => { result.current.open(); });
    expect(result.current.source).toBe('gateway');

    vi.mocked(readCredentials).mockReturnValue({ mode: 'direct', apiKey: 'k', resourceId: 'r' });
    act(() => { transportCallbacks.onError('auth', 'close 4401 credential_rejected'); });

    expect(result.current.state).toEqual({ kind: 'error', reason: 'auth' });
    expect(result.current.source).toBe('gateway');

    // The next session is the one that picks up the change.
    await settled(() => { result.current.retry(); });
    expect(result.current.source).toBe('own');
  });

  it.each(['auth', 'quota'] as const)('does not retry a %s refusal', async (reason) => {
    // The second attempt is refused identically; the fix lives on the options
    // page, and a quota retry also spends another reservation to hear it again.
    const { result } = setup();
    await settled(() => { result.current.open(); });

    act(() => { transportCallbacks.onError(reason, 'websocket error'); });

    expect(openTransport).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ kind: 'error', reason });
  });

  it('allows a manual retry after repeated failure and ignores the dead sockets afterward', async () => {
    const { result, onCommit } = setup();
    await settled(() => { result.current.open(); });
    const first = transportCallbacks;

    act(() => { first.onError('network', 'offline'); });
    await waitFor(() => expect(openTransport).toHaveBeenCalledTimes(2));
    const second = transportCallbacks;

    act(() => { second.onError('network', 'still offline'); });
    expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
    expect(openTransport).toHaveBeenCalledTimes(2);

    await settled(() => { result.current.retry(); });
    await waitFor(() => expect(openTransport).toHaveBeenCalledTimes(3));
    const recovered = transportCallbacks;
    expect(result.current.state.kind).toBe('listening');

    // Browsers may deliver close/message after a replacement socket is live.
    // Neither old attempt may repaint or commit into the recovered generation.
    act(() => {
      first.onResult({ utterances: [{ text: '旧连接一', definite: true }] }, false);
      first.onClosed();
      second.onResult({ utterances: [{ text: '旧连接二', definite: true }] }, false);
      second.onClosed();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe('listening');

    act(() => {
      recovered.onReady();
      recovered.onResult({ utterances: [{ text: '网络恢复', definite: true }] }, false);
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('网络恢复');
  });

  it('reports a clean close while finalizing without reopening the microphone', async () => {
    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { transportCallbacks.onReady(); });
    act(() => { captured.onEnd('caller'); });
    expect(result.current.state.kind).toBe('finalizing');

    act(() => { transportCallbacks.onClosed(); });

    expect(openTransport).toHaveBeenCalledOnce();
    expect(startCapture).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
  });

  it('reports a missing final response instead of silently claiming success', async () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      await settled(() => { result.current.open(); });
      act(() => { transportCallbacks.onReady(); });
      act(() => {
        transportCallbacks.onResult({ utterances: [{ text: '没有返回的结尾' }] }, false);
        captured.onEnd('silence');
      });
      expect(result.current.state.kind).toBe('finalizing');

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(openTransport).toHaveBeenCalledOnce();
      expect(result.current.state).toEqual({ kind: 'error', reason: 'network' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('does not invent a loss when the deadline passes with nothing pending', async () => {
    // The server confirmed every sentence and then went quiet. All of it is
    // already in the user's document, so the session did finish — an error card
    // here would report a loss that did not happen.
    vi.useFakeTimers();
    try {
      const { result, onCommit } = setup();
      await settled(() => { result.current.open(); });
      act(() => { transportCallbacks.onReady(); });
      act(() => {
        transportCallbacks.onResult({ utterances: [{ text: '全部都已写入。', definite: true }] }, false);
        captured.onEnd('silence');
      });
      expect(onCommit).toHaveBeenCalledWith('全部都已写入。');
      expect(result.current.state).toEqual({ kind: 'finalizing', pending: '', stopped: 'silence' });

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(result.current.state).toEqual({ kind: 'idle' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('accepts a final response that arrives just before the deadline', async () => {
    vi.useFakeTimers();
    try {
      const { result, onCommit } = setup();
      await settled(() => { result.current.open(); });
      act(() => { transportCallbacks.onReady(); });
      act(() => {
        transportCallbacks.onResult({ utterances: [{ text: '慢网络的最后一句' }] }, false);
        captured.onEnd('silence');
      });
      expect(result.current.state.kind).toBe('finalizing');

      await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
      expect(result.current.state.kind).toBe('finalizing');
      expect(onCommit).not.toHaveBeenCalled();

      act(() => { transportCallbacks.onResult(null, true); });
      expect(onCommit).toHaveBeenCalledWith('慢网络的最后一句');
      expect(result.current.state).toEqual({ kind: 'idle' });

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.state).toEqual({ kind: 'idle' });
    }
    finally {
      vi.useRealTimers();
    }
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

    expect(result.current.state).toEqual({ kind: 'blocked' });
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

      expect(result.current.state).toEqual({ kind: 'blocked' });
      expect(startCapture).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe('ordering across the readiness boundary', () => {
  it('keeps one backlog until the socket is ready', async () => {
    // The transport exists from the moment the socket starts connecting, so
    // switching to it on assignment would put newer audio — and a stop's final
    // packet — ahead of everything captured before it.
    const rule = deferred<HeaderRuleLease>();
    vi.mocked(acquireHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });
    act(() => { captured.onBatch(new Int16Array([1])); });

    await act(async () => {
      rule.settle({ release: releaseRule });
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
    const rule = deferred<HeaderRuleLease>();
    vi.mocked(acquireHeaderRule).mockReturnValue(rule.promise);

    const { result } = setup();
    await settled(() => { result.current.open(); });

    // Capture is live but the transport is not: a stop here would otherwise
    // drop the final packet, the server would never emit its last sentence,
    // and the finalise timeout would discard the transcript.
    act(() => { captured.onEnd('caller'); });
    expect(sendAudio).not.toHaveBeenCalled();

    await act(async () => {
      rule.settle({ release: releaseRule });
      await rule.promise;
    });
    act(() => { transportCallbacks.onReady(); });

    await waitFor(() => expect(sendAudio).toHaveBeenCalled());
    expect(sendAudio.mock.calls.at(-1)?.[1]).toBe(true);
  });
});
