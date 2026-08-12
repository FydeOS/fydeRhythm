import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHeader,
  gzip,
  kCompression,
  kErrorCode,
  kFlags,
  kMessageType,
  kSerialization,
  parseHeader,
} from '../entrypoints/inputview/voice/protocol';
import {
  acquireHeaderRule,
  buildSessionParams,
  errorReasonFor,
  headerRule,
  type HeaderRuleLease,
  kEndpointHost,
  kHeaderRuleId,
  openTransport,
  type SocketLike,
  type TransportCallbacks,
} from '../entrypoints/inputview/voice/transport';

const kCredentials = { apiKey: 'api-key', resourceId: 'volc.seedasr.sauc.duration' };

// Several tests below stub `chrome`, and one replaces `navigator` wholesale and
// resets the module registry. vitest.config.ts restores mocks but not stubbed
// globals, so without this the next test to be added runs in whatever world the
// last one left — and acquireHeaderRule would take the Web Lock branch through a
// leftover stub instead of the local fallback. Restoring by hand rather than
// with unstubAllGlobals, which would also discard the `chrome` stub that
// tests/setup.ts installs at load and leave every test here without one.
const kOuterChrome = globalThis.chrome;
const kOuterNavigator = globalThis.navigator;
afterEach(() => {
  vi.stubGlobal('chrome', kOuterChrome);
  vi.stubGlobal('navigator', kOuterNavigator);
  vi.resetModules();
});

class FakeSocket implements SocketLike {
  binaryType = '';
  sent: Uint8Array[] = [];
  closed = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;

  send(data: ArrayBufferView) {
    this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  close() {
    this.closed = true;
  }
}

function harness(
  headerRuleLease?: HeaderRuleLease,
  handshakeTimeoutMs = 0,
  // Every test drives its own probe: the default would fetch the real host.
  probeReachability: () => Promise<boolean> = () => Promise.resolve(false),
) {
  const socket = new FakeSocket();
  const events: string[] = [];
  const callbacks: TransportCallbacks = {
    onResult: (result, last) => events.push(`result:${result?.text ?? ''}:${last}`),
    onError: (reason, detail) => events.push(`error:${reason}:${detail}`),
    onReady: () => events.push('ready'),
    onClosed: () => events.push('closed'),
  };
  const transport = openTransport({
    callbacks,
    uid: 'test-uid',
    headerRuleLease,
    connect: () => socket,
    handshakeTimeoutMs,
    probeReachability,
  });
  return { socket, events, transport };
}

async function serverResult(text: string, last = false): Promise<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify({ result: { text, utterances: [] } }));
  const body = await gzip(json);
  const flags = last ? kFlags.negativeSequence : kFlags.positiveSequence;
  const out = new Uint8Array(4 + 4 + 4 + body.length);
  out.set(buildHeader(kMessageType.fullServerResponse, flags, kSerialization.json, kCompression.gzip));
  const view = new DataView(out.buffer);
  view.setInt32(4, last ? -2 : 1, false);
  view.setUint32(8, body.length, false);
  out.set(body, 12);
  return out.buffer;
}

function serverError(code: number, message: string): ArrayBuffer {
  const body = new TextEncoder().encode(message);
  const out = new Uint8Array(12 + body.length);
  out.set(buildHeader(kMessageType.errorResponse, kFlags.none, kSerialization.json, kCompression.none));
  const view = new DataView(out.buffer);
  view.setUint32(4, code, false);
  view.setUint32(8, body.length, false);
  out.set(body, 12);
  return out.buffer;
}

describe('voice session parameters', () => {
  const params = buildSessionParams('uid-1') as {
    user: { uid: string };
    audio: Record<string, unknown>;
    request: Record<string, unknown>;
  };

  it('asks for the second pass, without which nothing is ever definite', () => {
    expect(params.request.enable_nonstream).toBe(true);
    expect(params.request.show_utterances).toBe(true);
  });

  it('keeps responses cumulative', () => {
    expect(params.request.result_type).toBe('full');
  });

  it('describes exactly the audio the worklet produces', () => {
    expect(params.audio).toEqual({ format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 });
  });

  it('states punctuation, ITN and smoothing rather than inheriting defaults', () => {
    expect(params.request.enable_punc).toBe(true);
    expect(params.request.enable_itn).toBe(true);
    expect(params.request.enable_ddc).toBe(false);
  });
});

describe('voice header rule', () => {
  const rule = headerRule(kCredentials, { requestId: 'req-1', connectId: 'conn-1' });

  it('sets every documented auth header on the handshake', () => {
    // New-console scheme: one X-Api-Key rather than the old App-Key/Access-Key
    // pair, which the console no longer issues.
    expect(rule.action.requestHeaders?.map(h => [h.header, h.value])).toEqual([
      ['X-Api-Key', 'api-key'],
      ['X-Api-Resource-Id', 'volc.seedasr.sauc.duration'],
      ['X-Api-Request-Id', 'req-1'],
      ['X-Api-Connect-Id', 'conn-1'],
    ]);
    expect(rule.action.requestHeaders?.every(h => h.operation === 'set')).toBe(true);
  });

  it('matches only websocket requests to the endpoint host', () => {
    expect(rule.condition.resourceTypes).toEqual(['websocket']);
    expect(rule.condition.urlFilter).toBe(kEndpointHost);
  });

  it('matches only sockets this extension opened', () => {
    // Without an initiator, the rule also fires for any web page that opens a
    // socket to this host — the page cannot read the header, but it receives
    // authenticated recognition billed to our account.
    expect(rule.condition.initiatorDomains).toEqual(['test-extension-id']);
  });

  it('uses a fixed id so re-registering replaces rather than accumulates', () => {
    expect(rule.id).toBe(kHeaderRuleId);
    expect(headerRule(kCredentials, { requestId: 'other', connectId: 'other' }).id).toBe(kHeaderRuleId);
  });
});

describe('voice error mapping', () => {
  it('calls a packet timeout a network problem', () => {
    expect(errorReasonFor(kErrorCode.packetTimeout)).toBe('network');
  });

  it('calls the 550xxxxx family and a busy server a server problem', () => {
    expect(errorReasonFor(kErrorCode.serverBusy)).toBe('server');
    expect(errorReasonFor(55012345)).toBe('server');
    expect(errorReasonFor(kErrorCode.invalidParams)).toBe('server');
  });
});

describe('voice transport', () => {
  it('terminates a black-holed handshake and ignores a late open', async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      // A timeout is silence, not a refusal — it must never be probed into 'auth'.
      const probe = vi.fn(() => Promise.resolve(true));
      const { socket, events, transport } = harness({ release }, 1000, probe);
      const queuedWrite = transport.sendAudio(new Int16Array(160));

      await vi.advanceTimersByTimeAsync(999);
      expect(events).toEqual([]);
      expect(socket.closed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(['error:network:websocket handshake timeout']);
      expect(socket.closed).toBe(true);
      expect(release).toHaveBeenCalledOnce();
      await expect(queuedWrite).rejects.toThrow('websocket handshake timeout');

      socket.onopen?.call(null, {});
      await Promise.resolve();
      expect(socket.sent).toHaveLength(0);
      expect(events).toEqual(['error:network:websocket handshake timeout']);
      expect(probe).not.toHaveBeenCalled();
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('allows a slow handshake before the deadline and drains queued audio in order', async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      const { socket, events, transport } = harness({ release }, 1000);
      const first = transport.sendAudio(new Int16Array(320));
      const second = transport.sendAudio(new Int16Array(160));

      await vi.advanceTimersByTimeAsync(999);
      expect(socket.sent).toHaveLength(0);

      socket.onopen?.call(null, {});
      await Promise.all([first, second]);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(events).toEqual(['ready']);
      expect(socket.closed).toBe(false);
      expect(release).toHaveBeenCalledOnce();
      expect(socket.sent.map(frame => parseHeader(frame).messageType)).toEqual([
        kMessageType.fullClientRequest,
        kMessageType.audioOnlyRequest,
        kMessageType.audioOnlyRequest,
      ]);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('holds every write until the socket opens', async () => {
    // send() on a CONNECTING socket throws, and audio queued by the caller
    // must not reach the wire ahead of the parameters frame.
    const { socket, transport } = harness();
    const write = transport.sendAudio(new Int16Array(160));

    await Promise.resolve();
    expect(socket.sent).toHaveLength(0);

    socket.onopen?.call(null, {});
    await write;
    expect(parseHeader(socket.sent[0]).messageType).toBe(kMessageType.fullClientRequest);
    expect(parseHeader(socket.sent[1]).messageType).toBe(kMessageType.audioOnlyRequest);
  });

  it('sends the parameters frame before any audio, then reports ready', async () => {
    const { socket, events, transport } = harness();
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    expect(parseHeader(socket.sent[0]).messageType).toBe(kMessageType.fullClientRequest);

    await transport.sendAudio(new Int16Array(320));
    expect(parseHeader(socket.sent[1]).messageType).toBe(kMessageType.audioOnlyRequest);
  });

  it('writes packets in order even though encoding is async', async () => {
    const { socket, transport } = harness();
    socket.onopen?.call(null, {});

    // Descending sizes: a naive implementation lets the small one finish
    // gzipping first and overtake the large one.
    const sizes = [8000, 4000, 2000, 100];
    await Promise.all(sizes.map(size => transport.sendAudio(new Int16Array(size))));

    // Frame 0 is the parameters frame; audio follows in call order.
    const audio = socket.sent.slice(1).map(frame => new DataView(
      frame.buffer, frame.byteOffset,
    ).getUint32(4, false));
    // Larger PCM compresses to a larger payload, so sizes must stay descending.
    expect(audio).toEqual([...audio].sort((a, b) => b - a));
    expect(socket.sent).toHaveLength(1 + sizes.length);
  });

  it('marks only the packet asked to be last', async () => {
    const { socket, transport } = harness();
    socket.onopen?.call(null, {});
    await transport.sendAudio(new Int16Array(160));
    await transport.sendAudio(new Int16Array(160), true);

    expect(parseHeader(socket.sent[1]).flags).toBe(kFlags.none);
    expect(parseHeader(socket.sent[2]).flags).toBe(kFlags.lastPacket);
  });

  it('reports results and flags the final one', async () => {
    const { socket, events } = harness();
    socket.onmessage?.call(null, { data: await serverResult('你好') });
    await vi.waitUntil(() => events.some(e => e.startsWith('result')));
    expect(events).toContain('result:你好:false');

    socket.onmessage?.call(null, { data: await serverResult('你好世界', true) });
    await vi.waitUntil(() => events.includes('result:你好世界:true'));
  });

  it('turns a server error frame into an error, not a result', async () => {
    const { socket, events } = harness();
    socket.onmessage?.call(null, { data: serverError(kErrorCode.serverBusy, 'busy') });
    await vi.waitUntil(() => events.some(e => e.startsWith('error')));

    expect(events[0]).toBe('error:server:55000031: busy');
    expect(events.some(e => e.startsWith('result'))).toBe(false);
  });

  it('calls a refused handshake an auth problem when the host answers HTTPS', async () => {
    // A rejected key and a dead network raise the same error event — the
    // handshake status is invisible to page JS, and the probe is the only
    // signal that tells them apart.
    const { socket, events } = harness(undefined, 0, () => Promise.resolve(true));
    socket.onerror?.call(null, {});
    expect(socket.closed).toBe(true);
    await vi.waitUntil(() => events.length > 0);
    expect(events).toEqual(['error:auth:websocket error']);
  });

  it('calls a refused handshake a network problem when nothing answers', async () => {
    const { socket, events } = harness(undefined, 0, () => Promise.resolve(false));
    socket.onerror?.call(null, {});
    await vi.waitUntil(() => events.length > 0);
    expect(events).toEqual(['error:network:websocket error']);
    expect(socket.closed).toBe(true);
  });

  it('classifies a pre-open close the same way as a pre-open error', async () => {
    const { socket, events } = harness(undefined, 0, () => Promise.resolve(true));
    socket.onclose?.call(null, {});
    await vi.waitUntil(() => events.length > 0);
    expect(events).toEqual(['error:auth:websocket closed during handshake']);
  });

  it('treats a probe that itself fails as no network', async () => {
    const { socket, events } = harness(undefined, 0, () => Promise.reject(new Error('probe died')));
    socket.onerror?.call(null, {});
    await vi.waitUntil(() => events.length > 0);
    expect(events).toEqual(['error:network:websocket error']);
  });

  it('keeps a post-open failure a network problem without consulting the probe', async () => {
    // The handshake had already authenticated, so a later death is never the
    // key's fault — probing it could misname a mid-session drop.
    const probe = vi.fn(() => Promise.resolve(true));
    const { socket, events } = harness(undefined, 0, probe);
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    socket.onerror?.call(null, {});
    expect(events).toEqual(['ready', 'error:network:websocket error']);
    expect(probe).not.toHaveBeenCalled();
  });

  it('turns a synchronous send failure into one terminal network error', async () => {
    const release = vi.fn();
    const { socket, events, transport } = harness({ release });
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    const originalSend = socket.send.bind(socket);
    socket.send = (data) => {
      if (socket.sent.length === 1) throw new DOMException('link disappeared', 'NetworkError');
      originalSend(data);
    };

    await expect(transport.sendAudio(new Int16Array(160))).rejects.toThrow('link disappeared');
    expect(events).toEqual(['ready', 'error:network:link disappeared']);
    expect(socket.closed).toBe(true);
    expect(release).toHaveBeenCalledOnce();

    socket.onerror?.call(null, {});
    socket.onclose?.call(null, {});
    expect(events).toEqual(['ready', 'error:network:link disappeared']);
  });

  it('ignores non-binary messages', () => {
    const { socket, events } = harness();
    socket.onmessage?.call(null, { data: 'unexpected text frame' });
    expect(events).toEqual([]);
  });

  it('closes the socket once and stops delivering callbacks afterwards', async () => {
    const { socket, events, transport } = harness();
    transport.close();
    expect(socket.closed).toBe(true);

    socket.onmessage?.call(null, { data: await serverResult('迟到的') });
    socket.onerror?.call(null, {});
    socket.onclose?.call(null, {});
    await Promise.resolve();

    expect(events).toEqual([]);
  });

  it('writes nothing after close', async () => {
    const { socket, transport } = harness();
    socket.onopen?.call(null, {});
    await transport.sendAudio(new Int16Array(160));
    const before = socket.sent.length;

    transport.close();
    await transport.sendAudio(new Int16Array(160));
    expect(socket.sent).toHaveLength(before);
  });

  it('takes the header rule down as soon as the handshake is over', async () => {
    // Waiting for close() leaves the rule installed whenever the far end closes
    // first: `closed` is set by then and close() returns early. Dynamic rules
    // survive restarts, so that one is permanent.
    const release = vi.fn();

    const { socket, events } = harness({ release });
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    expect(release).toHaveBeenCalledOnce();
  });

  it('takes it down too when the far end closes first', async () => {
    const release = vi.fn();

    const { socket } = harness({ release });
    socket.onclose?.call(null, {});

    expect(release).toHaveBeenCalledOnce();
  });

  it('takes the header rule down when the session ends', async () => {
    // Dynamic rules survive restarts, so a rule left installed is a standing
    // offer of our credentials for every future handshake — the headers are
    // needed for the few milliseconds of one.
    const release = vi.fn();

    const { transport } = harness({ release });
    transport.close();

    expect(release).toHaveBeenCalledOnce();
  });

  it('reports a close that came from the far end', async () => {
    const { socket, events } = harness();
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    socket.onclose?.call(null, {});
    expect(events).toEqual(['ready', 'closed']);
  });

  it('still delivers a final result whose decode the close overtook', async () => {
    // Frames are gzipped, so delivery is async while the close event is not. The
    // close is fired in the same turn as the message here, which guarantees the
    // inflate is still in flight — the ordering a loaded machine produces on its
    // own, and the one that used to drop the last sentence and report a network
    // failure in its place. The close must wait behind the result, not race it.
    const { socket, events } = harness();
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    socket.onmessage?.call(null, { data: await serverResult('末尾', true) });
    socket.onclose?.call(null, {});
    await vi.waitUntil(() => events.includes('closed'));

    expect(events).toEqual(['ready', 'result:末尾:true', 'closed']);
  });

  it('drops a decode still running when the caller closed the transport itself', async () => {
    // The mirror case: teardown means the session is over, so a frame that was
    // inflating when close() ran must not surface a result or an error into a
    // caller that has moved on.
    const { socket, events, transport } = harness();
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    socket.onmessage?.call(null, { data: await serverResult('丢弃', true) });
    transport.close();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(events).toEqual(['ready']);
    expect(socket.closed).toBe(true);
  });

  it('does not take a rule down when its own install failed', async () => {
    // Every session shares rule id 1, so a removal on behalf of an install that
    // never happened would strip whatever the previous holder left behind. The
    // lock makes the removal safe; this is the one case it cannot cover.
    const updateDynamicRules = vi.fn<(change: {
      addRules?: chrome.declarativeNetRequest.Rule[];
      removeRuleIds?: number[];
    }) => Promise<void>>(() => Promise.reject(new Error('rules api failed')));
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });

    await expect(acquireHeaderRule(kCredentials, { requestId: 'a', connectId: 'a' }))
      .rejects.toThrow('rules api failed');
    expect(updateDynamicRules.mock.calls).toHaveLength(1);
    expect(updateDynamicRules.mock.calls[0]?.[0]).toMatchObject({ addRules: [{ id: kHeaderRuleId }] });
  });

  it('serialises rule ownership until the current handshake releases it', async () => {
    // Web Locks are shared by same-origin extension pages, unlike module state.
    // Load a second copy of the module to give it a separate install counter,
    // just as InputView and Options have separate JS realms.
    const updateDynamicRules = vi.fn<(change: {
      addRules?: chrome.declarativeNetRequest.Rule[];
      removeRuleIds?: number[];
    }) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });
    let lockTail = Promise.resolve();
    const request = vi.fn((_name: string, operation: () => Promise<void>) => {
      const turn = lockTail.then(operation);
      lockTail = turn.catch(() => {});
      return turn;
    });
    vi.stubGlobal('navigator', { locks: { request } });

    const dictation = await acquireHeaderRule(kCredentials, { requestId: 'dictation', connectId: 'a' });
    vi.resetModules();
    const optionsRealm = await import('../entrypoints/inputview/voice/transport');
    expect(optionsRealm.acquireHeaderRule).not.toBe(acquireHeaderRule);

    const dictationSocket = new FakeSocket();
    const events: string[] = [];
    openTransport({
      callbacks: {
        onResult: () => {},
        onError: () => {},
        onReady: () => events.push('ready'),
        onClosed: () => {},
      },
      uid: 'test-uid',
      headerRuleLease: dictation,
      connect: () => dictationSocket,
    });

    let verifierAcquired = false;
    const verifierPromise = optionsRealm.acquireHeaderRule(kCredentials, { requestId: 'verify', connectId: 'b' })
      .then((lease) => {
        verifierAcquired = true;
        return lease;
      });
    await Promise.resolve();

    expect(verifierAcquired).toBe(false);
    expect(updateDynamicRules.mock.calls.filter(([change]) => change.addRules)).toHaveLength(1);

    // A real transport releases immediately after the WebSocket handshake,
    // not when dictation ends. Options can proceed while that socket remains
    // open, so ordinary recognition is not serialised behind key verification.
    dictationSocket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));
    const verifier = await verifierPromise;
    expect(dictationSocket.closed).toBe(false);
    expect(updateDynamicRules.mock.calls.map(([change]) => change)).toEqual([
      expect.objectContaining({ addRules: [expect.objectContaining({ id: kHeaderRuleId })] }),
      { removeRuleIds: [kHeaderRuleId] },
      expect.objectContaining({ addRules: [expect.objectContaining({ id: kHeaderRuleId })] }),
    ]);

    verifier.release();
    await vi.waitUntil(() => updateDynamicRules.mock.calls.length === 4);
  });
});
