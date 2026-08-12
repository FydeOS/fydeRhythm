// Answers "can this key open a recognition session on its plan?" without
// recording audio.
//
// Both the key and the resource id ride the handshake headers, so a socket
// that dies before opening was rejected outright — browser JS cannot see the
// status, and an HTTPS reachability probe separates "bad key" from "no
// network". A session that opens answers with a first frame, which is decoded
// rather than trusted: measured live (2026-07), the server answers this probe
// with a clean empty result frame, and an error frame like 45000002 (empty
// audio) proves the key just as well — any decoded client-class response
// requires an authenticated handshake. Server faults are not the key's fault.

import { decodeServerMessage, encodeAudioPacket, encodeFullClientRequest, isServerFault, kErrorCode, type ServerMessage } from './protocol';
import {
  acquireHeaderRule,
  buildSessionParams,
  endpointFor,
  httpsReachable,
  newSessionIds,
  type SocketLike,
  type VoiceCredentials,
} from './transport';

export type KeyVerdict = 'valid' | 'invalid' | 'unreachable';

function verdictOf(message: ServerMessage): KeyVerdict {
  if (message.kind === 'result') return 'valid';
  if (message.code === kErrorCode.serverBusy || isServerFault(message.code)) return 'unreachable';
  // A decoded client-class response can only arrive after the server accepted
  // the authenticated WebSocket handshake. The empty-audio code is expected,
  // but invalid probe parameters prove the key just as strongly.
  return 'valid';
}

export interface VerifyOptions {
  connect?: (url: string, protocols?: string[]) => SocketLike;
  /** True when the endpoint host answers HTTPS at all. */
  probeReachability?: () => Promise<boolean>;
  timeoutMs?: number;
}

export async function verifyCredentials(
  credentials: VoiceCredentials,
  options: VerifyOptions = {},
): Promise<KeyVerdict> {
  const connect = options.connect
    ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols) as unknown as SocketLike);
  const { url, protocols } = endpointFor(credentials);
  // Whichever route this key takes, "is anything there?" must ask that route's
  // own host — a gateway outage is not evidence about Volcano, or the reverse.
  const reachable = options.probeReachability ?? (() => httpsReachable(new URL(url).host));
  const rule = await acquireHeaderRule(credentials, newSessionIds());
  try {
    return await new Promise<KeyVerdict>((resolve) => {
      const socket = connect(url, protocols);
      socket.binaryType = 'arraybuffer';
      let settled = false;
      let opened = false;
      const finish = (verdict: KeyVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        }
        catch { /* already closed */ }
        resolve(verdict);
      };
      const timer = setTimeout(() => finish('unreachable'), options.timeoutMs ?? 8000);

      socket.onopen = () => {
        opened = true;
        // DNR headers are consumed by the handshake. Do not keep live
        // dictation waiting while this verifier sends its probe and decodes the
        // reply; release is idempotent, so finally remains the safety net.
        rule.release();
        void (async () => {
          socket.send(await encodeFullClientRequest(buildSessionParams('verify')));
          socket.send(await encodeAudioPacket(new Int16Array(0), true));
        })().catch(() => finish('unreachable'));
      };
      let frameArrived = false;
      socket.onmessage = (event) => {
        const data = event.data;
        if (!(data instanceof ArrayBuffer)) return;
        frameArrived = true;
        void decodeServerMessage(data)
          .then(message => finish(verdictOf(message)))
          .catch(() => finish('unreachable'));
      };
      const rejected = () => {
        // A close chasing the final frame must not outrun its decode.
        if (settled || frameArrived) return;
        // This handshake attempt is over even if the reachability probe below
        // still needs time. Its header rule cannot help it any longer.
        rule.release();
        // Died after opening: the handshake had already authenticated, so this
        // is the connection failing, not the key.
        if (opened) {
          finish('unreachable');
          return;
        }
        void reachable().then(up => finish(up ? 'invalid' : 'unreachable'));
      };
      socket.onerror = rejected;
      socket.onclose = rejected;
    });
  }
  finally {
    rule.release();
  }
}
