import {
  DEFAULT_DICT_ENTRY_WEIGHT,
  type RawDictEntry,
  readAscii,
  readUint16Le,
  readUint32Le,
  readUtf16Le,
} from './binary';

// Baidu cell dictionary (.bdict — desktop, .bcd — mobile; identical layout).
// Implemented from the publicly documented format analysis at
// https://nopdan.com/2022/05/04-baidu-bdict/ — not derived from any GPL
// converter source.
//
// Layout: header (entry count as uint32 at 0x70, name/author/description
// blocks after it), then packed word records from 0x350. Each record starts
// with `u16 length, u16 frequency` followed by one of three body shapes:
//   1. Chinese (common): `length` pairs of (initial idx, final idx) bytes —
//      0xFF as the initial marks a literal ASCII letter in the final byte —
//      then the word as `length` UTF-16LE chars.
//   2. Pure ASCII word: `length` ASCII bytes; recognized because the first
//      byte is neither 0xFF nor a valid initial index.
//   3. Explicit code text: `u16 0, u16 wordLen`, then the code as `length`
//      UTF-16LE chars and the word as `wordLen` UTF-16LE chars.

const BDICT_ENTRY_COUNT_OFFSET = 0x70;
const BDICT_ENTRY_TABLE_OFFSET = 0x350;

const BDICT_INITIALS = [
  'c', 'd', 'b', 'f', 'g', 'h', 'ch', 'j', 'k', 'l', 'm', 'n',
  '', 'p', 'q', 'r', 's', 't', 'sh', 'zh', 'w', 'x', 'y', 'z',
];

const BDICT_FINALS = [
  'uang', 'iang', 'iong', 'ang', 'eng', 'ian', 'iao', 'ing', 'ong',
  'uai', 'uan', 'ai', 'an', 'ao', 'ei', 'en', 'er', 'ua', 'ie', 'in',
  'iu', 'ou', 'ia', 'ue', 'ui', 'un', 'uo', 'a', 'e', 'i', 'o', 'u', 'v',
];

export function parseBdictEntries(bytes: Uint8Array): RawDictEntry[] {
  if (bytes.length <= BDICT_ENTRY_TABLE_OFFSET) {
    throw new Error('Invalid Baidu dictionary file: file is too small');
  }
  const declaredCount = readUint32Le(bytes, BDICT_ENTRY_COUNT_OFFSET);
  const entries: RawDictEntry[] = [];
  let offset = BDICT_ENTRY_TABLE_OFFSET;

  while (entries.length < declaredCount && offset + 4 <= bytes.length) {
    const length = readUint16Le(bytes, offset);
    const frequency = readUint16Le(bytes, offset + 2);
    offset += 4;
    if (length === 0) break;
    const weight = frequency > 0 ? frequency : DEFAULT_DICT_ENTRY_WEIGHT;

    // A (0, 0) first pinyin pair would decode to the nonexistent syllable
    // "cuang", so a zero u16 here reliably marks format 3.
    if (offset + 2 <= bytes.length && readUint16Le(bytes, offset) === 0) {
      const wordLength = readUint16Le(bytes, offset + 2);
      offset += 4;
      if (offset + (length + wordLength) * 2 > bytes.length) break;
      const code = readUtf16Le(bytes, offset, length * 2);
      offset += length * 2;
      const word = readUtf16Le(bytes, offset, wordLength * 2);
      offset += wordLength * 2;
      pushEntry(entries, word, normalizeLooseCode(code), weight);
      continue;
    }

    const firstByte = bytes[offset];
    if (firstByte !== 0xff && firstByte >= BDICT_INITIALS.length) {
      if (offset + length > bytes.length) break;
      const word = readAscii(bytes, offset, length);
      offset += length;
      pushEntry(entries, word, word.toLowerCase(), weight);
      continue;
    }

    if (offset + length * 4 > bytes.length) break;
    const syllables: string[] = [];
    let valid = true;
    for (let i = 0; i < length; i++) {
      const initialIdx = bytes[offset];
      const finalIdx = bytes[offset + 1];
      offset += 2;
      if (initialIdx === 0xff) {
        syllables.push(String.fromCharCode(finalIdx).toLowerCase());
        continue;
      }
      const initial = BDICT_INITIALS[initialIdx];
      const final = BDICT_FINALS[finalIdx];
      if (initial === undefined || final === undefined) {
        valid = false;
        break;
      }
      syllables.push(initial + final);
    }
    // An out-of-range index means we lost the record boundary; stop
    // instead of emitting garbage from the rest of the file.
    if (!valid) break;
    const word = readUtf16Le(bytes, offset, length * 2);
    offset += length * 2;
    pushEntry(entries, word, syllables.join(' '), weight);
  }

  if (entries.length === 0) {
    throw new Error('Invalid Baidu dictionary file: no entries found');
  }
  return entries;
}

function pushEntry(entries: RawDictEntry[], text: string, code: string, weight: number): void {
  if (!text || !code) return;
  entries.push({ text, code, weight });
}

// Format-3 codes are free text; map separator characters to the space that
// RIME expects between syllables.
function normalizeLooseCode(code: string): string {
  return code.toLowerCase().replace(/['\s]+/g, ' ').trim();
}
