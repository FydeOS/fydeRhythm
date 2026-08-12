import { describe, expect, it, vi } from 'vitest';

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
  buildSessionParams,
  errorReasonFor,
  headerRule,
  installHeaderRule,
  kEndpointHost,
  kHeaderRuleId,
  openTransport,
  removeHeaderRule,
  type SocketLike,
  type TransportCallbacks,
} from '../entrypoints/inputview/voice/transport';

const kCredentials = { apiKey: 'api-key', resourceId: 'volc.bigasr.sauc.duration' };

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

function harness() {
  const socket = new FakeSocket();
  const events: string[] = [];
  const callbacks: TransportCallbacks = {
    onResult: (result, last) => events.push(`result:${result?.text ?? ''}:${last}`),
    onError: (reason, detail) => events.push(`error:${reason}:${detail}`),
    onReady: () => events.push('ready'),
    onClosed: () => events.push('closed'),
  };
  const transport = openTransport({ callbacks, uid: 'test-uid', connect: () => socket });
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
      ['X-Api-Resource-Id', 'volc.bigasr.sauc.duration'],
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

  it('reports a socket error as a network problem', () => {
    const { socket, events } = harness();
    socket.onerror?.call(null, {});
    expect(events).toEqual(['error:network:websocket error']);
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
    const updateDynamicRules = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });

    const { socket, events } = harness();
    socket.onopen?.call(null, {});
    await vi.waitUntil(() => events.includes('ready'));

    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [kHeaderRuleId] });
  });

  it('takes it down too when the far end closes first', async () => {
    const updateDynamicRules = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });

    const { socket } = harness();
    socket.onclose?.call(null, {});
    await vi.waitUntil(() => updateDynamicRules.mock.calls.length > 0);

    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [kHeaderRuleId] });
  });

  it('takes the header rule down when the session ends', async () => {
    // Dynamic rules survive restarts, so a rule left installed is a standing
    // offer of our credentials for every future handshake — the headers are
    // needed for the few milliseconds of one.
    const updateDynamicRules = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      declarativeNetRequest: { updateDynamicRules },
    });

    const { transport } = harness();
    transport.close();
    await vi.waitUntil(() => updateDynamicRules.mock.calls.length > 0);

    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [kHeaderRuleId] });
    // Deliberately not unstubbed: the stub extends the global chrome that
    // tests/setup.ts installs at load, and unstubbing would remove that too —
    // every later assertion would then pass for the wrong reason.
  });

  it('reports a close that came from the far end', () => {
    const { socket, events } = harness();
    socket.onclose?.call(null, {});
    expect(events).toEqual(['closed']);
  });

  it('lets only the latest install take the rule down by token', async () => {
    // Every session shares rule id 1. An attempt abandoned during its install
    // resolves late, and "its" rule is by then the one a newer session just
    // put up for its own handshake — an unconditional removal strips that
    // handshake of its credentials.
    const updateDynamicRules = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });

    const stale = await installHeaderRule(kCredentials, { requestId: 'a', connectId: 'a' });
    const fresh = await installHeaderRule(kCredentials, { requestId: 'b', connectId: 'b' });
    updateDynamicRules.mockClear();

    await removeHeaderRule(stale);
    expect(updateDynamicRules).not.toHaveBeenCalled();

    await removeHeaderRule(fresh);
    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [kHeaderRuleId] });
  });

  it('holds the transport to its own token at every exit', async () => {
    // The transport takes the rule down itself at three points — handshake
    // done, far end gone, close() — and shares rule id 1 with every other
    // session. Untokenised, a socket that outlives its session removes
    // whichever rule is installed by the time it notices.
    const updateDynamicRules = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { ...globalThis.chrome, declarativeNetRequest: { updateDynamicRules } });

    const stale = await installHeaderRule(kCredentials, { requestId: 'a', connectId: 'a' });
    await installHeaderRule(kCredentials, { requestId: 'b', connectId: 'b' });
    updateDynamicRules.mockClear();

    const stalled = () => {
      const socket = new FakeSocket();
      const events: string[] = [];
      const transport = openTransport({
        callbacks: {
          onResult: () => {},
          onError: () => {},
          onReady: () => events.push('ready'),
          onClosed: () => events.push('closed'),
        },
        uid: 'test-uid',
        headerRuleToken: stale,
        connect: () => socket,
      });
      return { socket, events, transport };
    };

    // Each exit is reached on its own transport: the first one taken latches
    // `closed` and the other two then return early for that reason instead.
    const handshake = stalled();
    handshake.socket.onopen?.call(null, {});
    await vi.waitUntil(() => handshake.events.includes('ready'));

    const dropped = stalled();
    dropped.socket.onclose?.call(null, {});
    await vi.waitUntil(() => dropped.events.includes('closed'));

    stalled().transport.close();
    await Promise.resolve();

    expect(updateDynamicRules).not.toHaveBeenCalled();
  });
});
