// Shared helpers for the binary lexicon parsers in this directory. All
// formats here are little-endian.

// Fallback weight for entries that carry no usable frequency. Kept in sync
// with the TSV/SCEL paths in lib/dict-packs.ts, which import it from here.
export const DEFAULT_DICT_ENTRY_WEIGHT = 100;

export interface RawDictEntry {
  text: string;
  code: string;
  weight: number;
}

const UTF16LE_DECODER = new TextDecoder('utf-16le');

export function readUint16Le(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) {
    throw new Error('Invalid dictionary file: unexpected end of file');
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readUint32Le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) {
    throw new Error('Invalid dictionary file: unexpected end of file');
  }
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000;
}

export function readUtf16Le(bytes: Uint8Array, offset: number, length: number): string {
  return UTF16LE_DECODER
    .decode(bytes.subarray(offset, offset + length))
    .replace(/\0+$/g, '')
    .trim();
}

export function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

// Text lexicon files arrive in several encodings in the wild: Rime and
// modern exports are UTF-8, QQ's text export is UTF-16LE, and many older
// Chinese dictionary files are GBK. Sniff the BOM first, then try strict
// UTF-8, and fall back to GBK for legacy files.
export function decodeDictText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    catch {
      return new TextDecoder().decode(bytes);
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder().decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    }
    catch {
      return new TextDecoder().decode(bytes);
    }
  }
}

// Inflates a zlib (RFC 1950) stream. DecompressionStream('deflate') is the
// zlib-wrapped variant and is available in both the extension pages and the
// MV3 service worker.
export async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
