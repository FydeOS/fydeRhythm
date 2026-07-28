import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseBdictEntries } from '../lib/dict-formats/bdict';
import { readUint16Le, readUint32Le } from '../lib/dict-formats/binary';
import { parseQpydEntries } from '../lib/dict-formats/qpyd';
import { parseScelEntries } from '../lib/dict-formats/scel';

// These parsers take user-downloaded binaries; the tests here pin the
// rejection contract for corrupt files — the happy paths live in
// dict-packs.test.ts.

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >> 8;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function utf16(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) writeU16(bytes, i * 2, value.charCodeAt(i));
  return bytes;
}

// A minimal pinyin table at the fixed SCEL offset: ids 1='ni', 2='hao'.
// Returns the offset where word groups start.
function writeScelTable(bytes: Uint8Array): number {
  let o = 0x1544;
  for (const [id, pinyin] of [[1, 'ni'], [2, 'hao']] as const) {
    const encoded = utf16(pinyin);
    writeU16(bytes, o, id);
    writeU16(bytes, o + 2, encoded.length);
    bytes.set(encoded, o + 4);
    o += 4 + encoded.length;
  }
  return o;
}

// One word group: header, pinyin ids, then each word with a 4-byte
// uint32-weight extension.
function writeScelGroup(bytes: Uint8Array, offset: number, ids: number[], words: string[]): number {
  writeU16(bytes, offset, words.length);
  writeU16(bytes, offset + 2, ids.length * 2);
  offset += 4;
  for (const id of ids) {
    writeU16(bytes, offset, id);
    offset += 2;
  }
  for (const word of words) {
    const encoded = utf16(word);
    writeU16(bytes, offset, encoded.length);
    bytes.set(encoded, offset + 2);
    offset += 2 + encoded.length;
    writeU16(bytes, offset, 4);
    writeU32(bytes, offset + 2, 500);
    offset += 6;
  }
  return offset;
}

describe('SCEL corruption handling', () => {
  it('rejects a file shorter than the pinyin table offset', () => {
    expect(() => parseScelEntries(new Uint8Array(0x1544)))
      .toThrow('file is too small');
  });

  it('rejects a file with no pinyin table', () => {
    expect(() => parseScelEntries(new Uint8Array(0x1600)))
      .toThrow('no pinyin table found');
  });

  it('rejects an odd-length pinyin index block', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelTable(bytes);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 3);
    expect(() => parseScelEntries(bytes)).toThrow('malformed pinyin index block');
  });

  it('rejects an unknown pinyin id when nothing parsed yet', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelTable(bytes);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    // A CJK codepoint: unknown as an id, and not a letter — so the pinyin
    // table reader cannot mistake this group header for a table entry.
    writeU16(bytes, o + 4, 20000);
    expect(() => parseScelEntries(bytes)).toThrow('unknown pinyin id 20000');
  });

  it('keeps parsed entries when a later group has an unknown pinyin id', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelGroup(bytes, writeScelTable(bytes), [1, 2], ['你好']);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    writeU16(bytes, o + 4, 99);

    const result = parseScelEntries(bytes);
    expect(result.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });

  it('rejects a word block cut off by end of file', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelTable(bytes);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    writeU16(bytes, o + 4, 1);
    // The group promises one word but the file ends after the pinyin ids.
    expect(() => parseScelEntries(bytes.subarray(0, o + 6)))
      .toThrow('truncated word block');
  });

  it('keeps parsed entries when the file is cut mid-group', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelGroup(bytes, writeScelTable(bytes), [1, 2], ['你好']);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    writeU16(bytes, o + 4, 1);

    const result = parseScelEntries(bytes.subarray(0, o + 6));
    expect(result.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });

  it('rejects a word length that overruns the file', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelTable(bytes);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    writeU16(bytes, o + 4, 1);
    writeU16(bytes, o + 6, 0x7ff0);
    expect(() => parseScelEntries(bytes)).toThrow('malformed word entry');
  });

  it('rejects word metadata that overruns the file', () => {
    const bytes = new Uint8Array(0x1600);
    const o = writeScelTable(bytes);
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 2);
    writeU16(bytes, o + 4, 1);
    const word = utf16('你');
    writeU16(bytes, o + 6, word.length);
    bytes.set(word, o + 8);
    writeU16(bytes, o + 8 + word.length, 0x7ff0);
    expect(() => parseScelEntries(bytes.subarray(0, o + 10 + word.length)))
      .toThrow('malformed word metadata');
  });
});

describe('binary read helpers', () => {
  it('readUint16Le rejects reads past the end', () => {
    expect(() => readUint16Le(new Uint8Array(1), 0)).toThrow('unexpected end of file');
    expect(() => readUint16Le(new Uint8Array(4), 3)).toThrow('unexpected end of file');
  });

  it('readUint32Le rejects reads past the end', () => {
    expect(() => readUint32Le(new Uint8Array(3), 0)).toThrow('unexpected end of file');
    expect(() => readUint32Le(new Uint8Array(8), 6)).toThrow('unexpected end of file');
  });
});

describe('QPYD corruption handling', () => {
  it('rejects a file shorter than the header', async () => {
    await expect(parseQpydEntries(new Uint8Array(0x48)))
      .rejects.toThrow('file is too small');
  });

  it('rejects a zero or out-of-range payload offset', async () => {
    const zero = new Uint8Array(0x60);
    await expect(parseQpydEntries(zero)).rejects.toThrow('bad payload offset');

    const outOfRange = new Uint8Array(0x60);
    writeU32(outOfRange, 0x38, 0x100);
    await expect(parseQpydEntries(outOfRange)).rejects.toThrow('bad payload offset');
  });

  it('rejects a payload that is not a zlib stream', async () => {
    const bytes = new Uint8Array(0x60);
    writeU32(bytes, 0x38, 0x50);
    writeU32(bytes, 0x44, 1);
    bytes.set([1, 2, 3, 4], 0x50);
    await expect(parseQpydEntries(bytes)).rejects.toThrow('could not decompress payload');
  });

  it('rejects a valid stream that yields no entries', async () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from([])));
    const bytes = new Uint8Array(0x60 + compressed.length);
    writeU32(bytes, 0x38, 0x60);
    writeU32(bytes, 0x44, 0);
    bytes.set(compressed, 0x60);
    await expect(parseQpydEntries(bytes)).rejects.toThrow('no entries found');
  });

  it('keeps parsed entries when the index is cut short of the declared count', async () => {
    // One full index record + data, but the header declares two entries.
    const code = [...'ni'].map(c => c.charCodeAt(0));
    const word = utf16('你');
    const index = new Uint8Array(10);
    index[0] = code.length;
    index[1] = word.length;
    writeU32(index, 6, index.length);
    const payload = Buffer.from([...index, ...code, ...word]);
    const compressed = new Uint8Array(deflateSync(payload));
    const bytes = new Uint8Array(0x60 + compressed.length);
    writeU32(bytes, 0x38, 0x60);
    writeU32(bytes, 0x44, 2);
    bytes.set(compressed, 0x60);

    await expect(parseQpydEntries(bytes)).resolves.toEqual([
      { text: '你', code: 'ni', weight: 100 },
    ]);
  });
});

describe('BDICT corruption handling', () => {
  it('rejects a file shorter than the entry table offset', () => {
    expect(() => parseBdictEntries(new Uint8Array(0x350)))
      .toThrow('file is too small');
  });

  it('rejects a record with an out-of-range syllable index', () => {
    const bytes = new Uint8Array(0x400);
    writeU32(bytes, 0x70, 1);
    let o = 0x350;
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 100);
    o += 4;
    bytes.set([5, 200], o); // final index 200 does not exist
    expect(() => parseBdictEntries(bytes)).toThrow('no entries found');
  });

  it('stops at a corrupt record instead of emitting garbage after it', () => {
    const bytes = new Uint8Array(0x400);
    writeU32(bytes, 0x70, 2);
    let o = 0x350;
    // Valid record: 你好 = ni (11,29) + hao (5,13).
    writeU16(bytes, o, 2);
    writeU16(bytes, o + 2, 500);
    o += 4;
    bytes.set([11, 29, 5, 13], o);
    o += 4;
    bytes.set(utf16('你好'), o);
    o += 4;
    // Corrupt record: syllable index past the finals table.
    writeU16(bytes, o, 1);
    writeU16(bytes, o + 2, 100);
    bytes.set([5, 200], o + 4);

    expect(parseBdictEntries(bytes)).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });
});
