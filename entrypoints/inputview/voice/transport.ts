// The WebSocket side of a dictation session.
//
// Two things make this more than a socket wrapper. First, Volcano authenticates
// in the handshake headers, which a browser cannot set — so a declarativeNetRequest
// rule injects them; that this works for an extension's own request was measured
// on device (ADR 0002, V1). Second, every frame is gzipped, so encoding is
// async and sends have to be serialised or packets would race onto the wire out
// of order.

import type { ZhVariant } from '@/lib/shared-types';
import { kDefaultGateway } from '@/lib/voice-build';

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
/** A black-holed TCP/TLS/WebSocket handshake may emit neither error nor close.
 *  Fifteen seconds leaves ample room for a weak link; the session layer then
 *  gets one fresh attempt rather than recording indefinitely into a dead one. */
export const kHandshakeTimeoutMs = 15_000;

/** Rule id for the header-injection rule. Fixed so re-registering replaces it
 *  rather than accumulating duplicates. */
export const kHeaderRuleId = 1;

export interface VolcanoCredentials {
  /** New-console auth: a single X-Api-Key replaces the old console's
   *  X-Api-App-Key / X-Api-Access-Key pair. */
  apiKey: string;
  /** e.g. volc.seedasr.sauc.duration — picks the model and the billing plan. */
  resourceId: string;
}

/** Our gateway, which holds the Volcano key server-side. */
export const kGatewayEndpoint: string = import.meta.env.FYDE_ASR_GATEWAY ?? kDefaultGateway;

/** The gateway by default; a user's own key talks to Volcano directly. */
export type VoiceCredentials
  = | { mode: 'gateway'; token: string }
    | ({ mode: 'direct' } & VolcanoCredentials);

/** A browser WebSocket cannot set headers, so the direct route borrows
 *  declarativeNetRequest while the gateway reads the subprotocol — the one part
 *  of the handshake a page controls. */
export function endpointFor(credentials: VoiceCredentials): { url: string; protocols?: string[] } {
  if (credentials.mode === 'direct') return { url: kEndpoint };
  return { url: kGatewayEndpoint, protocols: ['asr', `api-key.${credentials.token}`] };
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

/** Server-side simplified→traditional conversion. App passes
 *  `InputViewState.zhVariant`, resolved from the schema's own simplifier
 *  declarations — the only correct signal. It was briefly wired to the browser
 *  UI language: a zh-CN interface says nothing about what is being typed, so
 *  voice output silently disagreed with typed output. Do not reintroduce that. */
export type { ZhVariant } from '@/lib/shared-types';

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

/** The gateway's rejection vocabulary. Additive on its side, so anything not
 *  listed here must fall through to the retryable verdict rather than be
 *  guessed at. */
const kRejections: Record<string, VoiceErrorReason> = {
  insufficient_quota: 'quota',
  credential_rejected: 'auth',
  // Banned account, subnet binding, model not permitted: refused, and not by
  // spending — the card names both moves the user has.
  forbidden: 'auth',
};

/** Page JS cannot read a handshake's HTTP status, so the gateway completes the
 *  upgrade and closes with `4000 + status` and a machine-readable reason.
 *
 *  The reason is authoritative: a status cannot separate a spent quota from a
 *  rejected token, since both arrive as 401 or 403 depending on which check
 *  caught it. The code is only a fallback for a gateway older than that
 *  vocabulary. Null for ordinary codes — those end a session, not refuse one. */
export function reasonForClose(code: number, reason?: string): VoiceErrorReason | null {
  if (code < 4000 || code > 4999) return null;
  const named = reason && kRejections[reason];
  if (named) return named;
  if (reason) return 'server';
  return code - 4000 === 401 ? 'auth' : 'server';
}

/** Maps a documented error code onto what the panel should say about it. */
export function errorReasonFor(code: number): VoiceErrorReason {
  if (code === kErrorCode.packetTimeout) return 'network';
  if (code === kErrorCode.serverBusy || isServerFault(code)) return 'server';
  return 'server';
}

/** True when the endpoint host answers HTTPS at all — the one observable a
 *  browser gets for telling "this socket was refused" from "no network",
 *  since the WebSocket handshake status is hidden from page JS. */
export async function httpsReachable(host: string = kEndpointHost): Promise<boolean> {
  try {
    await fetch(`https://${host}/`, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(4000) });
    return true;
  }
  catch {
    return false;
  }
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
  /** Picks the route and carries its proof of identity. */
  credentials: VoiceCredentials;
  zhVariant?: ZhVariant;
  /** Held from rule installation until this socket's handshake finishes.
   *  Releasing it removes the rule before another page may install its own. */
  headerRuleLease?: HeaderRuleLease;
  /** Injectable so a session can be driven without a real socket. */
  connect?: (url: string, protocols?: string[]) => SocketLike;
  /** Test seam for black-holed handshakes. Zero disables the deadline. */
  handshakeTimeoutMs?: number;
  /** Consulted only when the handshake dies, to split 'auth' from 'network'. */
  probeReachability?: () => Promise<boolean>;
}

export interface Transport {
  /** Queues one audio packet. Resolves once it has been written. */
  sendAudio: (pcm: Int16Array, last?: boolean) => Promise<void>;
  close: () => void;
}

const kHeaderRuleLock = 'fyde-rhythm:voice-header-rule';
let localHeaderRuleTail: Promise<void> = Promise.resolve();

export interface HeaderRuleLease {
  /** Idempotent. Removal completes before the next lease is granted. */
  release: () => void;
}

/** Puts the handshake rule up. Only acquireHeaderRule may call this: the lease
 *  it hands out is what keeps one install from replacing another's rule, and a
 *  caller that installs directly bypasses that. */
async function installHeaderRule(
  credentials: VolcanoCredentials,
  ids: { requestId: string; connectId: string },
): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [kHeaderRuleId],
    addRules: [headerRule(credentials, ids)],
  });
}

/** Takes the rule down again. Dynamic rules persist across restarts, so a rule
 *  left installed is a standing offer of our credentials for every future
 *  handshake — the headers are only needed for the few milliseconds of one.
 *
 *  Unconditional, because the lock makes it safe: the removal runs inside the
 *  same critical section as its install, so no other holder can have replaced
 *  the rule in between. An install-counter token used to stand in for that
 *  guarantee and is gone with it. */
async function removeHeaderRule(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [kHeaderRuleId] });
  }
  catch { /* the next install replaces it by id anyway */ }
}

/** Owns the one extension-wide handshake rule until release.
 *
 * InputView and Options run in separate JS realms, so the install token above
 * cannot coordinate them: both realms can believe their own install is latest.
 * A Web Lock is shared by same-origin extension pages and keeps one rule in
 * place from install through handshake. The local tail preserves the same
 * behaviour in tests and older non-browser environments. */
export async function acquireHeaderRule(
  credentials: VoiceCredentials,
  ids: { requestId: string; connectId: string },
): Promise<HeaderRuleLease> {
  // Nothing to install, and nothing to serialise against.
  if (credentials.mode === 'gateway') return { release: () => {} };

  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  let readyResolve!: () => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const ownRule = async () => {
    let installed = false;
    try {
      await installHeaderRule(credentials, ids);
      installed = true;
      readyResolve();
      await hold;
    }
    catch (error) {
      readyReject(error);
    }
    finally {
      // Only if it went up: a failed install has no rule of ours to remove, and
      // removing anyway would strip whatever the previous holder left behind.
      if (installed) await removeHeaderRule();
    }
  };

  if (typeof navigator !== 'undefined' && navigator.locks) {
    void navigator.locks.request(kHeaderRuleLock, ownRule).catch(readyReject);
  }
  else {
    const turn = localHeaderRuleTail.then(ownRule, ownRule);
    localHeaderRuleTail = turn.catch(() => {});
  }

  await ready;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      releaseHold();
    },
  };
}

export function openTransport(options: TransportOptions): Transport {
  const { callbacks } = options;
  const connect = options.connect
    ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols) as unknown as SocketLike);

  const { url, protocols } = endpointFor(options.credentials);
  const socket = connect(url, protocols);
  socket.binaryType = 'arraybuffer';

  let closed = false;
  // Authentication lives entirely in the handshake, so this bit is what
  // decides whether a failure may still be the key's fault.
  let handshakeDone = false;
  // Every frame is gzipped, so a result is decoded asynchronously and the close
  // event can win the race — measured: a `message` immediately followed by a
  // `close` loses the result whenever the inflate needs a task turn, which under
  // load it does. That frame is usually the final one, so the tail vanished and
  // the panel reported a network failure instead of committing it. Deliveries
  // therefore stop only when WE tear the transport down, and a remote close
  // waits for decodes already in flight before it is announced.
  let abandoned = false;
  let decoding = 0;
  let closeDeferred = false;
  let headerRuleReleased = false;
  const releaseHeaderRule = () => {
    if (headerRuleReleased) return;
    headerRuleReleased = true;
    options.headerRuleLease?.release();
  };
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

  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHandshakeTimer = () => {
    if (handshakeTimer === undefined) return;
    clearTimeout(handshakeTimer);
    handshakeTimer = undefined;
  };
  /** Announces a remote close once nothing is still being decoded. */
  const announceClose = () => {
    if (!closeDeferred || decoding > 0) return;
    closeDeferred = false;
    callbacks.onClosed();
  };

  const teardownFailed = (detail: string) => {
    closed = true;
    // A failure is our own teardown: a result decoded after it belongs to a
    // session the caller has already been told is over.
    abandoned = true;
    closeDeferred = false;
    clearHandshakeTimer();
    failed(new Error(detail));
    try {
      socket.close();
    }
    catch { /* already unusable; the error callback is the terminal signal */ }
    releaseHeaderRule();
  };
  const failSocket = (reason: VoiceErrorReason, detail: string) => {
    if (closed) return;
    teardownFailed(detail);
    callbacks.onError(reason, detail);
  };
  // A death before the handshake finishes is the one place a rejected key can
  // hide: the handshake status is invisible to page JS, so a refusal and a
  // dead network raise the same event. The host answering HTTPS while refusing
  // this socket means the refusal was aimed at the credentials. Teardown is
  // immediate; only the verdict waits on the probe.
  const failHandshake = (detail: string) => {
    if (closed) return;
    teardownFailed(detail);
    const probe = options.probeReachability ?? httpsReachable;
    void probe()
      .catch(() => false)
      .then(up => callbacks.onError(up ? 'auth' : 'network', detail));
  };

  const write = (make: () => Promise<Uint8Array>): Promise<void> => {
    const next = tail.then(async () => {
      if (closed) return;
      let frame: Uint8Array;
      try {
        frame = await make();
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failSocket('unknown', detail);
        throw error;
      }
      if (closed) return;
      try {
        socket.send(frame);
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failSocket('network', detail);
        throw error;
      }
    });
    // Keep the chain alive after a failure so later packets still have an
    // ordering anchor. Attaching the handler here also means fire-and-forget
    // capture callbacks cannot create an unhandled rejection when send throws.
    tail = next.catch(() => {});
    return next;
  };

  socket.onopen = () => {
    if (closed) return;
    handshakeDone = true;
    clearHandshakeTimer();
    // The headers were needed for the handshake, which is now over. Release
    // before async frame encoding so Options is never serialised behind it.
    releaseHeaderRule();
    // The parameters frame bypasses the queue deliberately: callers may have
    // queued audio before the socket opened, and going through write() would
    // put the frame BEHIND that audio — the server would receive sound before
    // being told how to interpret it. Send it directly, then release the queue.
    void (async () => {
      const frame = await encodeFullClientRequest(buildSessionParams(options.uid, options.zhVariant));
      if (closed) return;
      try {
        socket.send(frame);
      }
      catch (error) {
        failSocket('network', error instanceof Error ? error.message : String(error));
        return;
      }
      opened();
      callbacks.onReady();
    })().catch((error: unknown) => {
      failSocket('unknown', error instanceof Error ? error.message : String(error));
    });
  };

  socket.onmessage = (event) => {
    if (abandoned) return;
    const data = event.data;
    if (!(data instanceof ArrayBuffer)) return;

    decoding++;
    void decodeServerMessage(data).then((message) => {
      if (abandoned) return;
      if (message.kind === 'error') {
        callbacks.onError(errorReasonFor(message.code), `${message.code}: ${message.message}`);
        return;
      }
      callbacks.onResult(message.result, message.last);
    }).catch((error: unknown) => {
      if (abandoned) return;
      callbacks.onError('server', error instanceof Error ? error.message : String(error));
    }).finally(() => {
      decoding--;
      announceClose();
    });
  };

  socket.onerror = () => {
    // Unblocks anything waiting on the handshake; the write itself then no-ops
    // because close() has set `closed`.
    if (!handshakeDone) {
      failHandshake('websocket error');
      return;
    }
    failSocket('network', 'websocket error');
  };

  socket.onclose = (event) => {
    if (closed) return;
    // Before the handshake flag, not after: the gateway completes the upgrade
    // in order to send this code, so `handshakeDone` is already true.
    const closure = event as { code?: number; reason?: string } | undefined;
    const code = closure?.code;
    const refused = code === undefined ? null : reasonForClose(code, closure?.reason);
    if (refused) {
      failSocket(refused, `close ${code} ${closure?.reason ?? ''}`.trim());
      return;
    }
    // A refusal surfaces as error-then-close; classifying the close too keeps
    // the verdict the same if only the close event is delivered.
    if (!handshakeDone) {
      failHandshake('websocket closed during handshake');
      return;
    }
    closed = true;
    clearHandshakeTimer();
    failed(new Error('closed'));
    releaseHeaderRule();
    // The far end went away. Anything already being inflated was sent before
    // that and is still owed to the caller — usually the final sentence — so the
    // close is announced only once those have landed.
    closeDeferred = true;
    announceClose();
  };

  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? kHandshakeTimeoutMs;
  if (handshakeTimeoutMs > 0) {
    handshakeTimer = setTimeout(() => {
      // Never probed into 'auth': a timeout is silence, not a refusal.
      failSocket('network', 'websocket handshake timeout');
    }, handshakeTimeoutMs);
  }

  return {
    sendAudio: (pcm, last = false) => write(() => encodeAudioPacket(pcm, last)),
    close: () => {
      if (closed) return;
      closed = true;
      // The caller is done with this session, so a frame still inflating is no
      // longer wanted — unlike a remote close, which may still owe us the tail.
      abandoned = true;
      closeDeferred = false;
      clearHandshakeTimer();
      failed(new Error('closed'));
      socket.close();
      releaseHeaderRule();
    },
  };
}

/** Ids for one session: both go in the handshake and both are worth logging
 *  alongside the server's X-Tt-Logid when something needs diagnosing. */
export function newSessionIds(newId: () => string = () => crypto.randomUUID()) {
  return { requestId: newId(), connectId: newId() };
}
