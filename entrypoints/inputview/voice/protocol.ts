// Volcano Engine streaming ASR binary framing.
//
// Transcribed from 《豆包语音 — 流式语音识别WebSocket》. Every integer field is
// big-endian. A frame is a 4-byte header, an optional 4-byte sequence (present
// only when the flags say so), a 4-byte payload size, and the payload — whose
// size is measured AFTER compression.
//
//   byte 0   (version << 4) | headerSize   headerSize counts 4-byte units
//   byte 1   (messageType << 4) | flags
//   byte 2   (serialization << 4) | compression
//   byte 3   reserved
//
// Error frames replace sequence/size/payload with an error code, a message
// size, and a UTF-8 message.

export const kProtocolVersion = 0b0001;
/** 1 × 4 bytes. */
export const kHeaderSizeUnits = 0b0001;

export const kMessageType = {
  fullClientRequest: 0b0001,
  audioOnlyRequest: 0b0010,
  fullServerResponse: 0b1001,
  errorResponse: 0b1111,
} as const;

export const kFlags = {
  none: 0b0000,
  positiveSequence: 0b0001,
  /** No sequence field; marks the final audio packet. */
  lastPacket: 0b0010,
  /** Sequence field present and negative; also the final packet. */
  negativeSequence: 0b0011,
} as const;

export const kSerialization = { raw: 0b0000, json: 0b0001 } as const;
export const kCompression = { none: 0b0000, gzip: 0b0001 } as const;

export interface FrameHeader {
  version: number;
  headerBytes: number;
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
}

export function buildHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Uint8Array {
  return new Uint8Array([
    (kProtocolVersion << 4) | kHeaderSizeUnits,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);
}

export function parseHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.length < 4) throw new Error('voice: frame shorter than its header');
  return {
    version: bytes[0] >> 4,
    // The unit is 4 bytes, so a header may be longer than the 4 we assume;
    // parsing reads this rather than hard-coding 4 so a future extension does
    // not silently shift every field that follows.
    headerBytes: (bytes[0] & 0x0F) * 4,
    messageType: bytes[1] >> 4,
    flags: bytes[1] & 0x0F,
    serialization: bytes[2] >> 4,
    compression: bytes[2] & 0x0F,
  };
}

/** Bit 0 of the flags is what says a sequence field follows the header. */
export function hasSequence(flags: number): boolean {
  return (flags & 0b0001) !== 0;
}

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// The copy normalises the buffer type: CompressionStream's writable side takes
// a BufferSource, which a Uint8Array over an ArrayBufferLike (a SharedArrayBuffer,
// say) does not satisfy. At 200 ms packets this is 6.4 kB per copy.
function sourceOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  const owned = new Uint8Array(bytes);
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(owned);
      controller.close();
    },
  });
}

// Native, so no pako in the bundle.
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(sourceOf(bytes).pipeThrough(new CompressionStream('gzip')));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(sourceOf(bytes).pipeThrough(new DecompressionStream('gzip')));
}

function frame(header: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(header.length + 4 + payload.length);
  out.set(header, 0);
  new DataView(out.buffer).setUint32(header.length, payload.length, false);
  out.set(payload, header.length + 4);
  return out;
}

/** The first frame after the socket opens: the session's parameters. */
export async function encodeFullClientRequest(params: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(params));
  return frame(
    buildHeader(kMessageType.fullClientRequest, kFlags.none, kSerialization.json, kCompression.gzip),
    await gzip(json),
  );
}

/** One audio packet. `last` marks the final one, which is what makes the
 *  server flush its final result rather than waiting for more audio. */
export async function encodeAudioPacket(pcm: Int16Array, last = false): Promise<Uint8Array> {
  // The worklet already produces little-endian int16 in platform order; every
  // platform this ships on is little-endian, which is what pcm_s16le means.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return frame(
    buildHeader(
      kMessageType.audioOnlyRequest,
      last ? kFlags.lastPacket : kFlags.none,
      kSerialization.raw,
      kCompression.gzip,
    ),
    await gzip(bytes),
  );
}

export interface AsrWord {
  text: string;
  start_time?: number;
  end_time?: number;
  blank_duration?: number;
}

export interface AsrUtterance {
  text: string;
  /** Only ever true on results produced by the non-streaming pass, which is
   *  why the session must run bigmodel_async with enable_nonstream. */
  definite?: boolean;
  start_time?: number;
  end_time?: number;
  words?: AsrWord[];
}

export interface AsrResult {
  text?: string;
  utterances?: AsrUtterance[];
}

export type ServerMessage
  = | { kind: 'result'; sequence: number | null; last: boolean; result: AsrResult | null; raw: unknown }
    | { kind: 'error'; code: number; message: string };

/** The field table documents `result` as a list while the worked example shows
 *  an object; accept either rather than betting on one. */
function readResult(payload: unknown): AsrResult | null {
  const result = (payload as { result?: unknown } | null)?.result;
  if (Array.isArray(result)) return (result[0] as AsrResult) ?? null;
  if (result && typeof result === 'object') return result as AsrResult;
  return null;
}

export async function decodeServerMessage(buffer: ArrayBuffer): Promise<ServerMessage> {
  const bytes = new Uint8Array(buffer);
  const header = parseHeader(bytes);
  const view = new DataView(buffer);
  let offset = header.headerBytes;

  if (header.messageType === kMessageType.errorResponse) {
    const code = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, false);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    const text = new TextDecoder().decode(
      header.compression === kCompression.gzip ? await gunzip(body) : body,
    );
    return { kind: 'error', code, message: text };
  }

  let sequence: number | null = null;
  if (hasSequence(header.flags)) {
    // Signed: the final packet's sequence is negative by design.
    sequence = view.getInt32(offset, false);
    offset += 4;
  }

  const size = view.getUint32(offset, false);
  offset += 4;
  const body = bytes.subarray(offset, offset + size);
  // An empty body has nothing to inflate, and handing zero bytes to gzip is a
  // Z_BUF_ERROR rather than an empty result.
  const plain = body.length && header.compression === kCompression.gzip
    ? await gunzip(body)
    : body;

  // A server response can legitimately carry an empty payload (an audio packet
  // that changed nothing), so absence of JSON is not an error.
  const raw: unknown = plain.length
    ? JSON.parse(new TextDecoder().decode(plain))
    : null;

  return {
    kind: 'result',
    sequence,
    last: (header.flags & kFlags.lastPacket) !== 0,
    result: readResult(raw),
    raw,
  };
}

/** Documented error codes. 550xxxxx as a family is an internal server error. */
export const kErrorCode = {
  success: 20000000,
  invalidParams: 45000001,
  emptyAudio: 45000002,
  packetTimeout: 45000081,
  badAudioFormat: 45000151,
  serverBusy: 55000031,
} as const;

export function isServerFault(code: number): boolean {
  return Math.floor(code / 100000) === 550;
}
