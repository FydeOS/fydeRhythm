// The WebSocket side of a dictation session.
//
// Two things make this more than a socket wrapper. First, Volcano authenticates
// in the handshake headers, which a browser cannot set — so a declarativeNetRequest
// rule injects them; that this works for an extension's own request was measured
// on device (ADR 0002, V1). Second, every frame is gzipped, so encoding is
// async and sends have to be serialised or packets would race onto the wire out
// of order.

import {
  type AsrResult,
  decodeServerMessage,
  encodeAudioPacket,
  encodeFullClientRequest,
  isServerFault,
  kErrorCode,
} from './protocol';
import type { VoiceErrorReason } from './session';

export const kEndpoint = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
export const kEndpointHost = 'openspeech.bytedance.com';

/** Rule id for the header-injection rule. Fixed so re-registering replaces it
 *  rather than accumulating duplicates. */
export const kHeaderRuleId = 1;

export interface VolcanoCredentials {
  /** New-console auth: a single X-Api-Key replaces the old console's
   *  X-Api-App-Key / X-Api-Access-Key pair. */
  apiKey: string;
  /** e.g. volc.bigasr.sauc.duration — picks the model and the billing plan. */
  resourceId: string;
}

/** The parameters frame.
 *
 *  `enable_nonstream` is what makes the second pass run, and the second pass is
 *  the only thing that ever emits `definite` — without it there is no signal
 *  for when a sentence may be committed. `result_type: 'full'` keeps responses
 *  cumulative, which is what makes reprocessing a packet harmless.
 *
 *  punc/itn/ddc are passed explicitly even though these are the API defaults,
 *  so that a change of default upstream cannot quietly rewrite what users see. */
export function buildSessionParams(uid: string, zhVariant?: ZhVariant): unknown {
  return {
    user: { uid },
    audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_nonstream: true,
      show_utterances: true,
      result_type: 'full',
      enable_punc: true,
      enable_itn: true,
      enable_ddc: false,
      // The model only ever emits simplified Chinese; this converts on the
      // server for users whose keyboard is otherwise traditional.
      ...(zhVariant ? { output_zh_variant: zhVariant } : {}),
    },
  };
}

/** Server-side simplified→traditional conversion. `traditional` is mainland
 *  traditional; `tw` and `hk` use the regional character standards.
 *
 *  Nothing passes this yet, deliberately. The model only ever emits simplified,
 *  so a caller has to decide — and the only correct signal is what Rime is
 *  currently producing: the schema (bopomofo is traditional, luna_pinyin_simp
 *  is simplified) together with its `simplification` switch, which the user can
 *  flip mid-session. Neither reaches the InputView today.
 *
 *  It was briefly wired to the browser UI language. That is a different fact
 *  about a different thing: a zh-CN interface says nothing about whether the
 *  user is typing traditional, so voice output silently disagreed with typed
 *  output. Do not reintroduce that — expose Rime's state instead. */
export type ZhVariant = 'traditional' | 'tw' | 'hk';

/** The handshake headers, as a declarativeNetRequest modifyHeaders rule. */
export function headerRule(
  credentials: VolcanoCredentials,
  ids: { requestId: string; connectId: string },
): chrome.declarativeNetRequest.Rule {
  return {
    id: kHeaderRuleId,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        { header: 'X-Api-Key', value: credentials.apiKey },
        { header: 'X-Api-Resource-Id', value: credentials.resourceId },
        { header: 'X-Api-Request-Id', value: ids.requestId },
        { header: 'X-Api-Connect-Id', value: ids.connectId },
      ].map(header => ({
        ...header,
        operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
      })),
    },
    condition: {
      urlFilter: kEndpointHost,
      resourceTypes: ['websocket' as chrome.declarativeNetRequest.ResourceType],
      // Without this the rule matches EVERY page's WebSocket to this host, and
      // the browser attaches our key to it — the page cannot read the header,
      // but it gets authenticated recognition billed to us. Extension-initiated
      // requests carry the extension id as their initiator.
      initiatorDomains: [chrome.runtime.id],
    },
  };
}

/** Maps a documented error code onto what the panel should say about it. */
export function errorReasonFor(code: number): VoiceErrorReason {
  if (code === kErrorCode.packetTimeout) return 'network';
  if (code === kErrorCode.serverBusy || isServerFault(code)) return 'server';
  return 'server';
}

/** The slice of WebSocket this module uses, so a session can be driven without
 *  a real socket. */
export interface SocketLike {
  binaryType: string;
  send: (data: ArrayBufferView) => void;
  close: () => void;
  onopen: ((this: unknown, event: unknown) => void) | null;
  onmessage: ((this: unknown, event: { data: unknown }) => void) | null;
  onerror: ((this: unknown, event: unknown) => void) | null;
  onclose: ((this: unknown, event: unknown) => void) | null;
}

export interface TransportCallbacks {
  /** A recognition result. `last` marks the response to the final audio packet. */
  onResult: (result: AsrResult | null, last: boolean) => void;
  onError: (reason: VoiceErrorReason, detail: string) => void;
  /** The socket is up and the parameters frame has been accepted for sending. */
  onReady: () => void;
  onClosed: () => void;
}

export interface TransportOptions {
  callbacks: TransportCallbacks;
  uid: string;
  zhVariant?: ZhVariant;
  /** The token from the install that put up this session's handshake rule, so
   *  the removals below cannot take down a rule a newer session installed. */
  headerRuleToken?: number;
  /** Injectable so a session can be driven without a real socket. */
  connect?: (url: string) => SocketLike;
}

export interface Transport {
  /** Queues one audio packet. Resolves once it has been written. */
  sendAudio: (pcm: Int16Array, last?: boolean) => Promise<void>;
  close: () => void;
}

/** Counts installs. Every session shares rule id 1, so a removal issued on
 *  behalf of an old attempt must prove that install is still the latest — or
 *  it takes down the rule a newer session just put up for its handshake. */
let installCount = 0;

/** Returns a token identifying this install, for removeHeaderRule. */
export async function installHeaderRule(
  credentials: VolcanoCredentials,
  ids: { requestId: string; connectId: string },
): Promise<number> {
  const token = ++installCount;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [kHeaderRuleId],
    addRules: [headerRule(credentials, ids)],
  });
  return token;
}

/** Takes the rule down again. Dynamic rules persist across restarts, so a rule
 *  left installed is a standing offer of our credentials for every future
 *  handshake — the headers are only needed for the few milliseconds of one.
 *
 *  With a token, the removal happens only while that install is the latest:
 *  an attempt abandoned mid-install resolves late, and by then the rule it
 *  would remove can belong to the session that replaced it. */
export async function removeHeaderRule(token?: number): Promise<void> {
  if (token !== undefined && token !== installCount) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [kHeaderRuleId] });
  }
  catch { /* the next install replaces it by id anyway */ }
}

export function openTransport(options: TransportOptions): Transport {
  const { callbacks } = options;
  const connect = options.connect ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);

  const socket = connect(kEndpoint);
  socket.binaryType = 'arraybuffer';

  let closed = false;
  // Nothing may be written before the socket opens: send() on a CONNECTING
  // socket throws, and audio queued by the caller can otherwise reach the wire
  // ahead of the parameters frame. Seeding the chain with the open event makes
  // every write — including the parameters frame itself — wait for it.
  //
  // Frames are also gzipped, so building one is async. Chaining every send onto
  // a single tail is what guarantees the server sees packets in the order the
  // microphone produced them: without it two rapid sends race and a short
  // packet can overtake a longer one.
  let opened!: () => void;
  let failed!: (error: Error) => void;
  let tail: Promise<void> = new Promise<void>((resolve, reject) => {
    opened = resolve;
    failed = reject;
  });
  // The seed is consumed by the first write; nothing else observes it.
  tail.catch(() => {});

  const write = (make: () => Promise<Uint8Array>): Promise<void> => {
    const next = tail.then(async () => {
      if (closed) return;
      socket.send(await make());
    });
    // Keep the chain alive after a failure so later packets still have an
    // ordering anchor; the rejection is surfaced to the caller of write().
    tail = next.catch(() => {});
    return next;
  };

  socket.onopen = () => {
    // The parameters frame bypasses the queue deliberately: callers may have
    // queued audio before the socket opened, and going through write() would
    // put the frame BEHIND that audio — the server would receive sound before
    // being told how to interpret it. Send it directly, then release the queue.
    void (async () => {
      const frame = await encodeFullClientRequest(buildSessionParams(options.uid, options.zhVariant));
      if (closed) return;
      socket.send(frame);
      opened();
      // The headers were needed for the handshake, which is over. Waiting for
      // close() to remove the rule leaves it installed whenever the far end
      // closes first — `closed` is already set by then, so close() returns
      // early — and dynamic rules survive restarts.
      void removeHeaderRule(options.headerRuleToken);
      callbacks.onReady();
    })().catch((error: unknown) => {
      failed(error instanceof Error ? error : new Error(String(error)));
      if (!closed) callbacks.onError('unknown', error instanceof Error ? error.message : String(error));
    });
  };

  socket.onmessage = (event) => {
    if (closed) return;
    const data = event.data;
    if (!(data instanceof ArrayBuffer)) return;

    void decodeServerMessage(data).then((message) => {
      if (closed) return;
      if (message.kind === 'error') {
        callbacks.onError(errorReasonFor(message.code), `${message.code}: ${message.message}`);
        return;
      }
      callbacks.onResult(message.result, message.last);
    }).catch((error: unknown) => {
      callbacks.onError('server', error instanceof Error ? error.message : String(error));
    });
  };

  socket.onerror = () => {
    // Unblocks anything waiting on the handshake; the write itself then no-ops
    // because close() has set `closed`.
    failed(new Error('websocket error'));
    if (!closed) callbacks.onError('network', 'websocket error');
  };

  socket.onclose = () => {
    if (closed) return;
    closed = true;
    failed(new Error('closed'));
    void removeHeaderRule(options.headerRuleToken);
    callbacks.onClosed();
  };

  return {
    sendAudio: (pcm, last = false) => write(() => encodeAudioPacket(pcm, last)),
    close: () => {
      if (closed) return;
      closed = true;
      failed(new Error('closed'));
      socket.close();
      void removeHeaderRule(options.headerRuleToken);
    },
  };
}

/** Ids for one session: both go in the handshake and both are worth logging
 *  alongside the server's X-Tt-Logid when something needs diagnosing. */
export function newSessionIds(newId: () => string = () => crypto.randomUUID()) {
  return { requestId: newId(), connectId: newId() };
}
