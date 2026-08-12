import { describe, expect, it } from 'vitest';

import {
  buildHeader,
  decodeServerMessage,
  encodeAudioPacket,
  encodeFullClientRequest,
  gzip,
  hasSequence,
  isServerFault,
  kCompression,
  kErrorCode,
  kFlags,
  kMessageType,
  kSerialization,
  parseHeader,
} from '../entrypoints/inputview/voice/protocol';

/** Builds a server frame the way the documented examples describe one. */
async function serverFrame(options: {
  flags: number;
  payload: unknown;
  sequence?: number;
  compression?: number;
}): Promise<ArrayBuffer> {
  const compression = options.compression ?? kCompression.gzip;
  const json = new TextEncoder().encode(JSON.stringify(options.payload));
  const body = compression === kCompression.gzip ? await gzip(json) : json;
  const withSequence = hasSequence(options.flags);

  const out = new Uint8Array(4 + (withSequence ? 4 : 0) + 4 + body.length);
  out.set(buildHeader(kMessageType.fullServerResponse, options.flags, kSerialization.json, compression));
  const view = new DataView(out.buffer);
  let offset = 4;
  if (withSequence) {
    view.setInt32(offset, options.sequence ?? 1, false);
    offset += 4;
  }
  view.setUint32(offset, body.length, false);
  out.set(body, offset + 4);
  return out.buffer;
}

async function errorFrame(code: number, message: string): Promise<ArrayBuffer> {
  const body = new TextEncoder().encode(message);
  const out = new Uint8Array(4 + 4 + 4 + body.length);
  out.set(buildHeader(kMessageType.errorResponse, kFlags.none, kSerialization.json, kCompression.none));
  const view = new DataView(out.buffer);
  view.setUint32(4, code, false);
  view.setUint32(8, body.length, false);
  out.set(body, 12);
  return out.buffer;
}

describe('voice protocol header', () => {
  it('packs the documented bit layout', () => {
    const header = buildHeader(kMessageType.fullClientRequest, kFlags.none, kSerialization.json, kCompression.gzip);
    // version 0b0001, header size 0b0001 → 0x11; type 0b0001 flags 0b0000 → 0x10;
    // serialization 0b0001 compression 0b0001 → 0x11; reserved 0x00.
    expect([...header]).toEqual([0x11, 0x10, 0x11, 0x00]);
  });

  it('round-trips every field', () => {
    const header = parseHeader(buildHeader(
      kMessageType.fullServerResponse, kFlags.negativeSequence, kSerialization.json, kCompression.gzip,
    ));
    expect(header).toEqual({
      version: 1,
      headerBytes: 4,
      messageType: kMessageType.fullServerResponse,
      flags: kFlags.negativeSequence,
      serialization: kSerialization.json,
      compression: kCompression.gzip,
    });
  });

  it('reads header size as 4-byte units, not a byte count', () => {
    // A header declaring 2 units is 8 bytes long.
    expect(parseHeader(new Uint8Array([0x12, 0x90, 0x11, 0x00])).headerBytes).toBe(8);
  });

  it('knows which flags carry a sequence field', () => {
    expect(hasSequence(kFlags.none)).toBe(false);
    expect(hasSequence(kFlags.lastPacket)).toBe(false);
    expect(hasSequence(kFlags.positiveSequence)).toBe(true);
    expect(hasSequence(kFlags.negativeSequence)).toBe(true);
  });

  it('rejects a frame too short to hold a header', () => {
    expect(() => parseHeader(new Uint8Array([0x11, 0x10]))).toThrow(/shorter than its header/);
  });
});

describe('voice protocol client frames', () => {
  it('encodes the parameter frame as gzipped JSON with a big-endian size', async () => {
    const params = { request: { model_name: 'bigmodel' } };
    const frame = await encodeFullClientRequest(params);
    const header = parseHeader(frame);

    expect(header.messageType).toBe(kMessageType.fullClientRequest);
    expect(header.serialization).toBe(kSerialization.json);
    expect(header.compression).toBe(kCompression.gzip);

    const size = new DataView(frame.buffer, frame.byteOffset).getUint32(4, false);
    expect(size).toBe(frame.length - 8);
    // Size counts the COMPRESSED payload, so it must not equal the JSON length.
    expect(size).not.toBe(JSON.stringify(params).length);
  });

  it('marks only the final audio packet as last', async () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    expect(parseHeader(await encodeAudioPacket(pcm)).flags).toBe(kFlags.none);
    expect(parseHeader(await encodeAudioPacket(pcm, true)).flags).toBe(kFlags.lastPacket);
  });

  it('sends audio as raw bytes rather than JSON', async () => {
    const header = parseHeader(await encodeAudioPacket(new Int16Array(160)));
    expect(header.messageType).toBe(kMessageType.audioOnlyRequest);
    expect(header.serialization).toBe(kSerialization.raw);
  });
});

describe('voice protocol server frames', () => {
  const payload = {
    audio_info: { duration: 10000 },
    result: {
      text: '这是字节跳动，今日头条母公司。',
      utterances: [
        { definite: true, start_time: 0, end_time: 1705, text: '这是字节跳动，' },
        { definite: false, start_time: 2110, end_time: 3696, text: '今日头条母公司。' },
      ],
    },
  };

  it('decodes a result frame carrying a sequence', async () => {
    const message = await decodeServerMessage(await serverFrame({ flags: kFlags.positiveSequence, sequence: 2, payload }));

    expect(message.kind).toBe('result');
    if (message.kind !== 'result') return;
    expect(message.sequence).toBe(2);
    expect(message.last).toBe(false);
    expect(message.result?.text).toBe('这是字节跳动，今日头条母公司。');
    expect(message.result?.utterances?.map(u => u.definite)).toEqual([true, false]);
  });

  it('reads the final frame’s negative sequence as signed', async () => {
    const message = await decodeServerMessage(
      await serverFrame({ flags: kFlags.negativeSequence, sequence: -3, payload }),
    );

    expect(message.kind).toBe('result');
    if (message.kind !== 'result') return;
    expect(message.sequence).toBe(-3);
    expect(message.last).toBe(true);
  });

  it('decodes a frame with no sequence field', async () => {
    const message = await decodeServerMessage(await serverFrame({ flags: kFlags.none, payload }));
    if (message.kind !== 'result') throw new Error('expected a result');
    expect(message.sequence).toBeNull();
    expect(message.result?.utterances).toHaveLength(2);
  });

  it('accepts result as a list, as the field table describes it', async () => {
    const message = await decodeServerMessage(await serverFrame({
      flags: kFlags.none,
      payload: { result: [{ text: 'hello', utterances: [] }] },
    }));
    if (message.kind !== 'result') throw new Error('expected a result');
    expect(message.result?.text).toBe('hello');
  });

  it('treats an empty payload as a result with nothing in it', async () => {
    // bigmodel_async only sends a packet when something changed, but an empty
    // body must not be read as a protocol failure.
    const out = new Uint8Array(8);
    out.set(buildHeader(kMessageType.fullServerResponse, kFlags.none, kSerialization.json, kCompression.gzip));
    new DataView(out.buffer).setUint32(4, 0, false);

    const message = await decodeServerMessage(out.buffer);
    if (message.kind !== 'result') throw new Error('expected a result');
    expect(message.result).toBeNull();
    expect(message.raw).toBeNull();
  });

  it('decodes an uncompressed error frame', async () => {
    const message = await decodeServerMessage(await errorFrame(kErrorCode.invalidParams, '{"error":"bad params"}'));

    expect(message.kind).toBe('error');
    if (message.kind !== 'error') return;
    expect(message.code).toBe(45000001);
    expect(message.message).toContain('bad params');
  });

  it('recognises the 550xxxxx internal-error family', () => {
    expect(isServerFault(55000031)).toBe(true);
    expect(isServerFault(55012345)).toBe(true);
    expect(isServerFault(kErrorCode.invalidParams)).toBe(false);
    expect(isServerFault(kErrorCode.success)).toBe(false);
  });
});
