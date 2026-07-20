import { DEFAULT_DICT_ENTRY_WEIGHT, readUint32Le } from './binary';

interface ScelEntry {
  word: string;
  code: string;
  weight: number;
}

export interface ScelParseResult {
  entries: Array<{ text: string; code: string; weight: number }>;
  duplicateCount: number;
}

const PINYIN_OFFSET = 0x1540;
const UTF16LE_DECODER = new TextDecoder('utf-16le');
const MAX_ENTRY_WEIGHT = 10_000_000;

export function parseScelEntries(bytes: Uint8Array): ScelParseResult {
  if (bytes.length <= PINYIN_OFFSET + 4) {
    throw new Error('Invalid Sogou SCEL file: file is too small');
  }
  const { pinyinTable, wordOffset } = readPinyinTable(bytes);
  const { entries, duplicateCount } = readEntries(bytes, pinyinTable, wordOffset);
  sanitizeWeights(entries);
  return {
    entries: [...entries.values()].map(({ word, code, weight }) => ({ text: word, code, weight })),
    duplicateCount,
  };
}

function readPinyinTable(bytes: Uint8Array): { pinyinTable: Map<number, string>; wordOffset: number } {
  const result = new Map<number, string>();
  let offset = PINYIN_OFFSET + 4;
  while (offset + 4 <= bytes.length) {
    const id = readUint16Le(bytes, offset);
    const length = readUint16Le(bytes, offset + 2);
    const textStart = offset + 4;
    if (length === 0 || length % 2 !== 0 || textStart + length > bytes.length) break;

    const pinyin = readUtf16Le(bytes, textStart, length);
    if (!/^[A-Za-z]+$/.test(pinyin)) break;

    result.set(id, pinyin.toLowerCase());
    offset = textStart + length;
  }
  if (result.size === 0) {
    throw new Error('Invalid Sogou SCEL file: no pinyin table found');
  }
  return { pinyinTable: result, wordOffset: offset };
}

function readEntries(
  bytes: Uint8Array,
  pinyinTable: Map<number, string>,
  wordOffset: number,
): { entries: Map<string, ScelEntry>; duplicateCount: number } {
  const result = new Map<string, ScelEntry>();
  let acceptedWords = 0;
  const done = () => ({ entries: result, duplicateCount: acceptedWords - result.size });
  let offset = wordOffset;
  const maxPinyinId = Math.max(...pinyinTable.keys());

  while (offset + 4 <= bytes.length) {
    const homophoneCount = readUint16Le(bytes, offset);
    const pinyinTableLength = readUint16Le(bytes, offset + 2);
    offset += 4;
    if (homophoneCount === 0 || pinyinTableLength === 0) break;
    if (pinyinTableLength % 2 !== 0 || offset + pinyinTableLength > bytes.length) {
      if (result.size > 0) break;
      throw new Error('Invalid Sogou SCEL file: malformed pinyin index block');
    }

    const code: string[] = [];
    for (let index = 0; index < pinyinTableLength / 2; index++) {
      const id = readUint16Le(bytes, offset);
      const syllable = pinyinTable.get(id) ?? asciiLetterForPinyinId(id, maxPinyinId);
      if (!syllable) {
        if (result.size > 0) return done();
        throw new Error(`Invalid Sogou SCEL file: unknown pinyin id ${id}`);
      }
      code.push(syllable);
      offset += 2;
    }

    for (let index = 0; index < homophoneCount; index++) {
      if (offset + 4 > bytes.length) {
        if (result.size > 0) return done();
        throw new Error('Invalid Sogou SCEL file: truncated word block');
      }
      const wordLength = readUint16Le(bytes, offset);
      offset += 2;
      if (wordLength === 0 || offset + wordLength + 2 > bytes.length) {
        if (result.size > 0) return done();
        throw new Error('Invalid Sogou SCEL file: malformed word entry');
      }

      const word = sanitizeText(readUtf16Le(bytes, offset, wordLength));
      offset += wordLength;
      const extraLength = readUint16Le(bytes, offset);
      offset += 2;
      if (offset + extraLength > bytes.length) {
        if (result.size > 0) return done();
        throw new Error('Invalid Sogou SCEL file: malformed word metadata');
      }

      let rawWeight = DEFAULT_DICT_ENTRY_WEIGHT;
      if (extraLength >= 4) rawWeight = readUint32Le(bytes, offset);
      else if (extraLength >= 2) rawWeight = readUint16Le(bytes, offset);
      const weight = Math.min(Math.max(rawWeight, 1), MAX_ENTRY_WEIGHT);
      offset += extraLength;

      const codeString = code.join(' ');
      if (!word || !codeString) continue;
      acceptedWords++;
      const key = `${word}\t${codeString}`;
      const existing = result.get(key);
      if (!existing || existing.weight < weight) {
        result.set(key, { word, code: codeString, weight });
      }
    }
  }
  return done();
}

function sanitizeWeights(entries: Map<string, ScelEntry>): void {
  if (entries.size < 2) return;
  let min = Infinity;
  let max = -Infinity;
  let cappedCount = 0;
  for (const entry of entries.values()) {
    min = Math.min(min, entry.weight);
    max = Math.max(max, entry.weight);
    if (entry.weight >= MAX_ENTRY_WEIGHT) cappedCount++;
  }
  if (min !== max && cappedCount * 2 <= entries.size) return;
  for (const entry of entries.values()) {
    entry.weight = DEFAULT_DICT_ENTRY_WEIGHT;
  }
}

function asciiLetterForPinyinId(id: number, maxPinyinId: number): string | undefined {
  const index = id - maxPinyinId - 1;
  if (index < 0 || index >= 26) return undefined;
  return String.fromCharCode(0x61 + index);
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) {
    throw new Error('Invalid Sogou SCEL file: unexpected end of file');
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUtf16Le(bytes: Uint8Array, offset: number, length: number): string {
  return UTF16LE_DECODER
    .decode(bytes.subarray(offset, offset + length))
    .replace(/\0+$/g, '')
    .trim();
}

function sanitizeText(text: string): string {
  return text.replace(/[\t\r\n]/g, '').trim();
}
