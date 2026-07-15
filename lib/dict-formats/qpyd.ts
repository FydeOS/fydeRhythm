import {
    DEFAULT_DICT_ENTRY_WEIGHT,
    RawDictEntry,
    inflateZlib,
    readAscii,
    readUint32Le,
    readUtf16Le,
} from './binary';

// QQ Pinyin classified dictionary (.qpyd, used by QQ拼音 before 6.0).
// Implemented from the publicly documented format analysis at
// https://nopdan.com/2022/05/06-qq-qpyd/ — not derived from any GPL
// converter source.
//
// Layout: fixed header with `u32 payload offset` at 0x38 and `u32 entry
// count` at 0x44, a UTF-16LE description block, then a zlib stream. The
// inflated payload is a 10-byte index record per entry (`u8 pinyin byte
// length, u8 word byte length, 4 unknown bytes, u32 data position`)
// followed by the packed data section: ASCII pinyin with `'` between
// syllables, then the word in UTF-16LE.

const QPYD_PAYLOAD_OFFSET_POS = 0x38;
const QPYD_ENTRY_COUNT_POS = 0x44;
const QPYD_INDEX_RECORD_SIZE = 10;

export async function parseQpydEntries(bytes: Uint8Array): Promise<RawDictEntry[]> {
    if (bytes.length <= QPYD_ENTRY_COUNT_POS + 4) {
        throw new Error('Invalid QQ dictionary file: file is too small');
    }
    const payloadOffset = readUint32Le(bytes, QPYD_PAYLOAD_OFFSET_POS);
    const entryCount = readUint32Le(bytes, QPYD_ENTRY_COUNT_POS);
    if (payloadOffset === 0 || payloadOffset >= bytes.length) {
        throw new Error('Invalid QQ dictionary file: bad payload offset');
    }

    let data: Uint8Array;
    try {
        data = await inflateZlib(bytes.subarray(payloadOffset));
    } catch (ex) {
        throw new Error(`Invalid QQ dictionary file: could not decompress payload (${ex})`);
    }

    const entries: RawDictEntry[] = [];
    for (let i = 0; i < entryCount; i++) {
        const base = i * QPYD_INDEX_RECORD_SIZE;
        if (base + QPYD_INDEX_RECORD_SIZE > data.length) break;
        const pinyinLength = data[base];
        const wordLength = data[base + 1];
        const position = readUint32Le(data, base + 6);
        if (position + pinyinLength + wordLength > data.length) break;

        const code = readAscii(data, position, pinyinLength).split("'").join(' ').trim();
        const word = readUtf16Le(data, position + pinyinLength, wordLength);
        if (!word || !code) continue;
        entries.push({ text: word, code, weight: DEFAULT_DICT_ENTRY_WEIGHT });
    }

    if (entries.length === 0) {
        throw new Error('Invalid QQ dictionary file: no entries found');
    }
    return entries;
}
