import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHeader, gzip, kCompression, kErrorCode, kMessageType, kSerialization } from '../entrypoints/inputview/voice/protocol';
import type { SocketLike } from '../entrypoints/inputview/voice/transport';
import { verifyCredentials } from '../entrypoints/inputview/voice/verify';

const kCredentials = { apiKey: 'k', resourceId: 'r' };

/** A full-server-response frame carrying the given JSON payload. */
async function resultFrame(payload: object = {}): Promise<ArrayBuffer> {
  const header = buildHeader(kMessageType.fullServerResponse, 0, kSerialization.json, kCompression.gzip);
  const body = await gzip(new TextEncoder().encode(JSON.stringify(payload)));
  const out = new Uint8Array(header.length + 4 + body.length);
  out.set(header, 0);
  new DataView(out.buffer).setUint32(header.length, body.length, false);
  out.set(body, header.length + 4);
  return out.buffer;
}

/** An error frame with the given documented code. */
function errorFrame(code: number): ArrayBuffer {
  const header = buildHeader(kMessageType.errorResponse, 0, kSerialization.json, kCompression.none);
  const message = new TextEncoder().encode('probe');
  const out = new Uint8Array(header.length + 8 + message.length);
  out.set(header, 0);
  const view = new DataView(out.buffer);
  view.setUint32(header.length, code, false);
  view.setUint32(header.length + 4, message.length, false);
  out.set(message, header.length + 8);
  return out.buffer;
}

function fakeSocket(): SocketLike {
  return {
    binaryType: '',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
}

/** Starts a verification and hands back the socket once it exists. */
async function begin(options: { probeReachability?: () => Promise<boolean>; timeoutMs?: number } = {}) {
  const socket = fakeSocket();
  const promise = verifyCredentials(kCredentials, { connect: () => socket, ...options });
  // The lease first waits for its extension-wide lock and DNR installation.
  // Drain those continuations before driving the socket.
  for (let turn = 0; turn < 8 && socket.onopen === null; turn++) {
    await Promise.resolve();
  }
  expect(socket.onopen).not.toBeNull();
  return { socket, promise };
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    declarativeNetRequest: { updateDynamicRules: vi.fn(() => Promise.resolve()) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('verifying a key against the live endpoint', () => {
  it('reads a recognition result as a fully working key and plan', async () => {
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: await resultFrame() });
    await expect(promise).resolves.toBe('valid');
  });

  it('reads the empty-audio complaint as success — it is this probe’s expected reply', async () => {
    // The probe sends no audio on purpose; a server complaining about that has
    // already accepted the key, the plan, and the session parameters.
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: errorFrame(kErrorCode.emptyAudio) });
    await expect(promise).resolves.toBe('valid');
  });

  it('reads any decoded client-class error as proof the key authenticated', async () => {
    // The exact probe may evolve independently of the credential contract.
    // Receiving this decoded frame proves the authenticated handshake passed.
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: errorFrame(kErrorCode.invalidParams) });
    await expect(promise).resolves.toBe('valid');
  });

  it('does not blame the key for a server fault', async () => {
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: errorFrame(kErrorCode.serverBusy) });
    await expect(promise).resolves.toBe('unreachable');
  });

  it('does not treat an undecodable frame as proof of a valid key', async () => {
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: new Uint8Array([0xff, 0x00]).buffer });
    await expect(promise).resolves.toBe('unreachable');
  });

  it('reads a rejected handshake as an invalid key when the host is up', async () => {
    const { socket, promise } = await begin({ probeReachability: async () => true });
    socket.onclose?.call(null, {});
    await expect(promise).resolves.toBe('invalid');
  });

  it('blames the network when the host cannot be reached at all', async () => {
    const { socket, promise } = await begin({ probeReachability: async () => false });
    socket.onerror?.call(null, {});
    await expect(promise).resolves.toBe('unreachable');
  });

  it('does not call a key invalid for a connection that died after opening', async () => {
    const probe = vi.fn(async () => true);
    const { socket, promise } = await begin({ probeReachability: probe });
    socket.onopen?.call(null, {});
    socket.onclose?.call(null, {});
    await expect(promise).resolves.toBe('unreachable');
    expect(probe).not.toHaveBeenCalled();
  });

  it('releases the header lease at open without waiting for the verdict frame', async () => {
    const updateDynamicRules = chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>;
    const { socket, promise } = await begin();

    socket.onopen?.call(null, {});
    await vi.waitUntil(() => updateDynamicRules.mock.calls.some(
      ([change]) => change.removeRuleIds?.[0] === 1,
    ));
    expect(socket.close).not.toHaveBeenCalled();

    socket.onmessage?.call(null, { data: await resultFrame() });
    await expect(promise).resolves.toBe('valid');
  });

  it('times out to a network verdict rather than hanging', async () => {
    vi.useFakeTimers();
    try {
      const { promise } = await begin();
      await vi.advanceTimersByTimeAsync(9000);
      await expect(promise).resolves.toBe('unreachable');
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('settles once and closes the socket', async () => {
    const { socket, promise } = await begin({ probeReachability: async () => true });
    socket.onmessage?.call(null, { data: await resultFrame() });
    socket.onclose?.call(null, {});
    await expect(promise).resolves.toBe('valid');
    expect(socket.close).toHaveBeenCalled();
  });

  it('installs the header rule for the handshake and takes it down after', async () => {
    const updateDynamicRules = chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>;
    const { socket, promise } = await begin();
    socket.onopen?.call(null, {});
    socket.onmessage?.call(null, { data: await resultFrame() });
    await promise;
    await Promise.resolve();
    const calls = updateDynamicRules.mock.calls;
    expect(calls[0]?.[0]).toMatchObject({ addRules: [{ id: 1 }] });
    expect(calls.at(-1)?.[0]).toEqual({ removeRuleIds: [1] });
  });
});
