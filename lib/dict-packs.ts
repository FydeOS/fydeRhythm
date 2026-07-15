import { parse } from 'yaml';
import { DEFAULT_DICT_ENTRY_WEIGHT, RawDictEntry, decodeDictText, readUint32Le } from './dict-formats/binary';
import { parseBdictEntries } from './dict-formats/bdict';
import { parseQpydEntries } from './dict-formats/qpyd';

export const DICT_PACKS_MANIFEST_FILENAME = 'dict-packs.json';
export const DICT_PACK_ID_PREFIX = 'dict_pack_';

export interface DictPackMetadata {
    id: string;
    name: string;
    packName: string;
    baseDictionary: string;
    entryCount: number;
    compiledEntryCount?: number;
    rawEntryCount?: number;
    rawTableName?: string;
    enabled: boolean;
    installedAt: number;
    updatedAt: number;
    source: 'user' | 'catalog';
    catalogId?: string;
}

export interface DictPackManifest {
    version: 1;
    packs: DictPackMetadata[];
}

export interface DictPackSource {
    packName: string;
    dictYaml: string;
    displayName: string;
    entryCount: number;
    entries?: DictPackEntry[];
    // Rows merged away because they repeated an earlier (text, code) pair.
    // Only set for formats we parse entry-by-entry (TSV and the binary
    // lexicon formats); dict.yaml sources pass through verbatim and never
    // report duplicates.
    duplicateCount?: number;
}

export interface DictPackEntry {
    text: string;
    code: string;
    weight: number;
}

export function dictPacksManifestPath(schemaId: string): string {
    return `/root/${schemaId}/user/${DICT_PACKS_MANIFEST_FILENAME}`;
}

export function dictPackArtifactPath(schemaId: string, packName: string): string {
    return `/root/${schemaId}/build/${packName}.table.bin`;
}

export function dictPackRawTablePath(schemaId: string, tableName: string): string {
    return `/root/${schemaId}/user/${tableName}.txt`;
}

export function parseDictPackSource(
    fileName: string,
    text: string,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string> = new Map(),
): DictPackSource {
    if (fileName.toLowerCase().endsWith('.dict.yaml') || (text.startsWith('---') && text.includes('name:'))) {
        return parseDictYamlSource(fileName, text, existingPackNames, existingDisplayNames);
    }
    return parseTsvSource(fileName, text, existingPackNames, existingDisplayNames);
}

export async function parseDictPackSourceBytes(
    fileName: string,
    bytes: Uint8Array,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string> = new Map(),
): Promise<DictPackSource> {
    const lowerName = fileName.toLowerCase();
    // .qcel (QQ拼音 6.0+) shares the Sogou SCEL layout.
    if (lowerName.endsWith('.scel') || lowerName.endsWith('.qcel')) {
        return parseScelSource(fileName, bytes, existingPackNames, existingDisplayNames);
    }
    if (lowerName.endsWith('.bdict') || lowerName.endsWith('.bcd')) {
        return buildSourceFromBinaryEntries(
            fileName, parseBdictEntries(bytes), existingPackNames, existingDisplayNames);
    }
    if (lowerName.endsWith('.qpyd')) {
        return buildSourceFromBinaryEntries(
            fileName, await parseQpydEntries(bytes), existingPackNames, existingDisplayNames);
    }
    return parseDictPackSource(
        fileName,
        decodeDictText(bytes),
        existingPackNames,
        existingDisplayNames,
    );
}

function buildSourceFromBinaryEntries(
    fileName: string,
    rawEntries: RawDictEntry[],
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string>,
): DictPackSource {
    const displayName = displayNameFromFileName(fileName);
    const packName = resolvePackName(displayName, existingPackNames, existingDisplayNames);

    // Same duplicate policy as the TSV/SCEL paths: merge repeated
    // (text, code) pairs keeping the highest weight.
    const entryMap = new Map<string, DictPackEntry>();
    let acceptedCount = 0;
    for (const raw of rawEntries) {
        const text = sanitizeDictText(raw.text);
        const code = sanitizeDictText(raw.code);
        if (!text || !code) continue;
        acceptedCount++;
        const key = `${text}\t${code}`;
        const existing = entryMap.get(key);
        if (!existing || existing.weight < raw.weight) {
            entryMap.set(key, { text, code, weight: raw.weight });
        }
    }

    const entries = [...entryMap.values()];
    return {
        packName,
        dictYaml: buildDictPackYaml(packName, entries),
        displayName,
        entryCount: entries.length,
        entries,
        duplicateCount: acceptedCount - entries.length,
    };
}

function parseDictYamlSource(
    fileName: string,
    text: string,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string>,
): DictPackSource {
    const headerEnd = text.indexOf('\n...');
    const headerText = headerEnd >= 0 ? text.slice(0, headerEnd) : text;

    const nameMatch = headerText.match(/^name\s*:\s*.*$/m);
    const rawName = readDictYamlName(headerText) ?? displayNameFromFileName(fileName);
    const packName = resolvePackName(rawName, existingPackNames, existingDisplayNames);

    // Replace name in YAML with the (possibly deduplicated) packName
    let dictYaml = text;
    if (nameMatch) {
        dictYaml = text.replace(/^name\s*:\s*.*$/m, `name: ${packName}`);
    }

    const entryCount = countEntries(text);
    return { packName, dictYaml, displayName: rawName, entryCount };
}

function readDictYamlName(headerText: string): string | null {
    try {
        const header = parse(headerText) as { name?: unknown } | null;
        if (typeof header?.name === 'string' && header.name.trim()) {
            return header.name.trim();
        }
    } catch {
        // Fall back to the file name if the imported header is malformed.
    }
    return null;
}

function parseTsvSource(
    fileName: string,
    text: string,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string>,
): DictPackSource {
    const displayName = displayNameFromFileName(fileName);
    const packName = resolvePackName(displayName, existingPackNames, existingDisplayNames);

    // Merge duplicate (text, code) rows up front — the RIME compiler emits a
    // warning per duplicate, which for big community dictionaries turns the
    // import result into thousands of warning lines. Keep the highest weight,
    // matching the SCEL path.
    const entryMap = new Map<string, DictPackEntry>();
    let rowCount = 0;
    for (let line of text.split('\n')) {
        line = line.replace(/\r$/, '');
        if (line === '' || line.startsWith('#')) continue;
        const parts = line.split('\t');
        // Rime dictionaries store entries as text<tab>code<tab>weight, but the
        // weight column is optional — plain text<tab>code rows are valid and
        // common, so accept them with a default weight instead of dropping them.
        if (parts.length < 2 || parts.length > 3) continue;
        const [word, code, weightStr] = parts;
        const normalizedCode = code.trim();
        const parsedWeight = weightStr === undefined ? DEFAULT_DICT_ENTRY_WEIGHT : parseInt(weightStr, 10);
        const weight = isNaN(parsedWeight) ? DEFAULT_DICT_ENTRY_WEIGHT : parsedWeight;
        if (!word || !normalizedCode) continue;
        rowCount++;
        const key = `${word}\t${normalizedCode}`;
        const existing = entryMap.get(key);
        if (!existing || existing.weight < weight) {
            entryMap.set(key, { text: word, code: normalizedCode, weight });
        }
    }

    const entries = [...entryMap.values()];
    const dictYaml = buildDictPackYaml(packName, entries);

    return {
        packName,
        dictYaml,
        displayName,
        entryCount: entries.length,
        entries,
        duplicateCount: rowCount - entries.length,
    };
}

interface ScelEntry {
    word: string;
    code: string;
    weight: number;
}

const SCEL_PINYIN_OFFSET = 0x1540;
const UTF16LE_DECODER = new TextDecoder('utf-16le');

// Real Sogou/QQ frequencies stay well below this. On librime's absolute
// scale (weight 1e8 ≈ the most common word in the language) the cap keeps a
// corrupt or hostile uint32 from pinning imported words above everyday
// vocabulary, while preserving relative order for genuine values.
const MAX_SCEL_ENTRY_WEIGHT = 10_000_000;

function parseScelSource(
    fileName: string,
    bytes: Uint8Array,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string>,
): DictPackSource {
    if (bytes.length <= SCEL_PINYIN_OFFSET + 4) {
        throw new Error('Invalid Sogou SCEL file: file is too small');
    }

    const displayName = displayNameFromFileName(fileName);
    const packName = resolvePackName(displayName, existingPackNames, existingDisplayNames);
    const { pinyinTable, wordOffset } = readScelPinyinTable(bytes);
    const { entries, duplicateCount } = readScelEntries(bytes, pinyinTable, wordOffset);
    sanitizeScelWeights(entries);
    const dictEntries: DictPackEntry[] = [...entries.values()]
        .map(({ word, code, weight }) => ({ text: word, code, weight }));

    const dictYaml = buildDictPackYaml(packName, dictEntries);

    return { packName, dictYaml, displayName, entryCount: entries.size, entries: dictEntries, duplicateCount };
}

function readScelPinyinTable(bytes: Uint8Array): { pinyinTable: Map<number, string>; wordOffset: number } {
    const result = new Map<number, string>();
    let offset = SCEL_PINYIN_OFFSET + 4;
    while (offset + 4 <= bytes.length) {
        const entryStart = offset;
        const id = readUint16Le(bytes, entryStart);
        const length = readUint16Le(bytes, entryStart + 2);
        const textStart = entryStart + 4;
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

function readScelEntries(
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
        for (let i = 0; i < pinyinTableLength / 2; i++) {
            const id = readUint16Le(bytes, offset);
            const syllable = pinyinTable.get(id) ?? asciiLetterForPinyinId(id, maxPinyinId);
            if (!syllable) {
                if (result.size > 0) return done();
                throw new Error(`Invalid Sogou SCEL file: unknown pinyin id ${id}`);
            }
            code.push(syllable);
            offset += 2;
        }
        for (let i = 0; i < homophoneCount; i++) {
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

            const word = sanitizeDictText(readUtf16Le(bytes, offset, wordLength));
            offset += wordLength;

            const extraLength = readUint16Le(bytes, offset);
            offset += 2;
            if (offset + extraLength > bytes.length) {
                if (result.size > 0) return done();
                throw new Error('Invalid Sogou SCEL file: malformed word metadata');
            }

            // The first 4 bytes of the extension block hold the word's
            // frequency as a uint32 (values above 65535 are common in
            // official Sogou dicts); tolerate short blocks from minimal or
            // hand-made files.
            let rawWeight = DEFAULT_DICT_ENTRY_WEIGHT;
            if (extraLength >= 4) {
                rawWeight = readUint32Le(bytes, offset);
            } else if (extraLength >= 2) {
                rawWeight = readUint16Le(bytes, offset);
            }
            const weight = Math.min(Math.max(rawWeight, 1), MAX_SCEL_ENTRY_WEIGHT);
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

// The extension field is trusted only as a relative ordering between the
// pack's words (official dicts store a frequency rank there). Two degenerate
// shapes carry no usable signal and fall back to the neutral default weight:
// every word sharing a single value (no ordering info — and a large constant
// would uniformly inflate the whole pack), or a majority of values beyond any
// real rank/frequency (the field is not credible for this file, so per-value
// clamping alone would pin most of the pack at the cap).
function sanitizeScelWeights(entries: Map<string, ScelEntry>): void {
    if (entries.size < 2) return;
    let min = Infinity;
    let max = -Infinity;
    let cappedCount = 0;
    for (const entry of entries.values()) {
        min = Math.min(min, entry.weight);
        max = Math.max(max, entry.weight);
        if (entry.weight >= MAX_SCEL_ENTRY_WEIGHT) cappedCount++;
    }
    const allEqual = min === max;
    const mostlyImplausible = cappedCount * 2 > entries.size;
    if (!allEqual && !mostlyImplausible) return;
    for (const entry of entries.values()) {
        entry.weight = DEFAULT_DICT_ENTRY_WEIGHT;
    }
}

// Pinyin ids past the end of the pinyin table encode ASCII letters
// (maxId + 1 = 'a', maxId + 2 = 'b', …) — that is how Latin characters
// inside words are stored, in both Sogou .scel and QQ .qcel files.
function asciiLetterForPinyinId(id: number, maxPinyinId: number): string | undefined {
    const letterIndex = id - maxPinyinId - 1;
    if (letterIndex < 0 || letterIndex >= 26) return undefined;
    return String.fromCharCode(0x61 + letterIndex);
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

function sanitizeDictText(text: string): string {
    return text.replace(/[\t\r\n]/g, '').trim();
}

function countEntries(dictYaml: string): number {
    const bodyStart = dictYaml.indexOf('\n...');
    if (bodyStart < 0) return 0;
    const body = dictYaml.slice(bodyStart + 4);
    let count = 0;
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) count++;
    }
    return count;
}

// The RIME compiler reports one warning per problematic entry, so a large
// dictionary can produce thousands of lines. Callers display `shown` and a
// "…and N more" hint instead of the full list.
export const DICT_PACK_WARNINGS_SHOWN_LIMIT = 5;

export function summarizeDictPackWarnings(
    warnings: string[],
    limit: number = DICT_PACK_WARNINGS_SHOWN_LIMIT,
): { shown: string[]; hiddenCount: number } {
    const shown = warnings.slice(0, Math.max(0, limit));
    return { shown, hiddenCount: warnings.length - shown.length };
}

export function normalizeToDictId(name: string): string {
    const normalizedName = name.trim().normalize('NFC');
    const normalized = normalizedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    const hasNonAscii = /[\u0080-\uffff]/.test(normalizedName);
    if (normalized && !hasNonAscii) {
        return DICT_PACK_ID_PREFIX + normalized;
    }
    const hash = hashDisplayName(normalizedName || 'custom');
    return DICT_PACK_ID_PREFIX + (normalized ? `${normalized}_${hash}` : `u_${hash}`);
}

export function buildDictPackYaml(packName: string, entries: DictPackEntry[] | string[]): string {
    const lines = entries.map(entry => typeof entry === 'string' ? entry : formatDictEntry(entry));
    return [
        '---',
        `name: ${packName}`,
        'version: "1"',
        'sort: by_weight',
        'use_preset_vocabulary: false',
        'columns:',
        '  - text',
        '  - code',
        '  - weight',
        '...',
        ...lines,
    ].join('\n') + '\n';
}

export function buildRawTableDb(tableName: string, entries: DictPackEntry[]): Uint8Array {
    const lines = entries.map(entry => {
        const code = rawTableCodeFromDictCode(entry.code);
        return `${sanitizeTableCell(entry.text)}\t${sanitizeTableCell(code)}\t${Math.max(1, Math.floor(entry.weight))}`;
    }).filter(line => {
        const [text, code] = line.split('\t');
        return Boolean(text && code);
    });
    const content = [
        '# Rime table',
        '# coding: utf-8',
        `#@/db_name\t${tableName}.txt`,
        '#@/db_type\ttabledb',
        ...lines,
    ].join('\n') + '\n';
    return new TextEncoder().encode(content);
}

export function rawTableCodeFromDictCode(code: string): string {
    return code.replace(/\s+/g, '');
}

function formatDictEntry(entry: DictPackEntry): string {
    return `${sanitizeTableCell(entry.text)}\t${sanitizeTableCell(entry.code)}\t${Math.max(1, Math.floor(entry.weight))}`;
}

function sanitizeTableCell(value: string): string {
    return value.replace(/[\t\r\n]/g, '').trim();
}

export function displayNameFromFileName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? fileName;
    return base.replace(/\.(dict\.yaml|txt|tsv|scel|qcel|qpyd|bdict|bcd)$/i, '').trim() || 'Dict Pack';
}

function uniquePackName(base: string, existing: Set<string>): string {
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}_${suffix}`)) suffix++;
    return `${base}_${suffix}`;
}

function resolvePackName(
    displayName: string,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string>,
): string {
    const existing = existingDisplayNames.get(displayNameKey(displayName));
    if (existing) return existing;
    return uniquePackName(normalizeToDictId(displayName), existingPackNames);
}

function displayNameKey(displayName: string): string {
    return displayName.trim().normalize('NFC');
}

function hashDisplayName(value: string): string {
    let hash = 0x811c9dc5;
    for (const ch of value) {
        hash ^= ch.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).padStart(7, '0').slice(0, 7);
}

export function emptyDictPackManifest(): DictPackManifest {
    return { version: 1, packs: [] };
}

export function decodeDictPackManifest(buffer: Uint8Array): DictPackManifest {
    if (buffer.length === 0) return emptyDictPackManifest();
    return normalizeDictPackManifest(JSON.parse(new TextDecoder().decode(buffer)));
}

export function encodeDictPackManifest(manifest: DictPackManifest): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(normalizeDictPackManifest(manifest), null, 2));
}

export function normalizeDictPackManifest(value: unknown): DictPackManifest {
    const candidate = value as Partial<DictPackManifest> | undefined;
    const packs = Array.isArray(candidate?.packs) ? candidate.packs : [];
    return {
        version: 1,
        packs: packs
            .map(normalizeDictPackMetadata)
            .filter((p): p is DictPackMetadata => p !== null),
    };
}

function normalizeDictPackMetadata(value: unknown): DictPackMetadata | null {
    const c = value as Partial<DictPackMetadata> | undefined;
    if (!c) return null;
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) return null;
    const packName = typeof c.packName === 'string' ? c.packName.trim() : id;
    if (!/^[A-Za-z0-9_.-]+$/.test(packName)) return null;
    const now = Date.now();
    return {
        id,
        name: typeof c.name === 'string' && c.name.trim() ? c.name : id,
        packName,
        baseDictionary: typeof c.baseDictionary === 'string' && c.baseDictionary.trim()
            ? c.baseDictionary
            : 'aurora_pinyin',
        entryCount: typeof c.entryCount === 'number' && isFinite(c.entryCount)
            ? Math.max(0, Math.floor(c.entryCount))
            : 0,
        compiledEntryCount: typeof c.compiledEntryCount === 'number' && isFinite(c.compiledEntryCount)
            ? Math.max(0, Math.floor(c.compiledEntryCount))
            : undefined,
        rawEntryCount: typeof c.rawEntryCount === 'number' && isFinite(c.rawEntryCount)
            ? Math.max(0, Math.floor(c.rawEntryCount))
            : undefined,
        rawTableName: typeof c.rawTableName === 'string' && /^[A-Za-z0-9_.-]+$/.test(c.rawTableName)
            ? c.rawTableName
            : undefined,
        enabled: c.enabled !== false,
        installedAt: typeof c.installedAt === 'number' && isFinite(c.installedAt) ? c.installedAt : now,
        updatedAt: typeof c.updatedAt === 'number' && isFinite(c.updatedAt) ? c.updatedAt : now,
        source: c.source === 'catalog' ? 'catalog' : 'user',
        catalogId: typeof c.catalogId === 'string' ? c.catalogId : undefined,
    };
}

export function injectDictPacksIntoSchema(schemaConfig: Record<string, unknown>, enabledPacks: DictPackMetadata[]): void {
    if (enabledPacks.length === 0) return;
    const compiledPackNames = enabledPacks
        .filter(pack => (pack.compiledEntryCount ?? pack.entryCount) > 0)
        .map(pack => pack.packName);
    if (compiledPackNames.length > 0) {
        if (!schemaConfig.translator || typeof schemaConfig.translator !== 'object') {
            schemaConfig.translator = {};
        }
        const translator = schemaConfig.translator as Record<string, unknown>;
        if (!Array.isArray(translator.packs)) {
            translator.packs = [];
        }
        for (const packName of compiledPackNames) {
            if (!(translator.packs as string[]).includes(packName)) {
                (translator.packs as string[]).push(packName);
            }
        }
    }

    for (const pack of enabledPacks) {
        if (!pack.rawTableName || !pack.rawEntryCount) continue;
        injectRawTableIntoSchema(schemaConfig, pack.rawTableName);
    }
}

function injectRawTableIntoSchema(schemaConfig: Record<string, unknown>, tableName: string): void {
    if (!schemaConfig.engine || typeof schemaConfig.engine !== 'object') {
        schemaConfig.engine = {};
    }
    const engine = schemaConfig.engine as Record<string, unknown>;
    if (!Array.isArray(engine.translators)) {
        engine.translators = [];
    }
    const translatorId = `table_translator@${tableName}`;
    if (!(engine.translators as string[]).includes(translatorId)) {
        (engine.translators as string[]).push(translatorId);
    }
    schemaConfig[tableName] = {
        dictionary: '',
        user_dict: tableName,
        db_class: 'stabledb',
        enable_completion: true,
        enable_sentence: false,
        // table_translator adds +0.5 for user_dict-backed entries; offset it so
        // raw-table matches rank near mid-frequency words instead of above
        // every candidate from the main translator (quality scale: top word ~1.0).
        initial_quality: -0.45,
        comment_format: ['xform/^.+$//'],
    };
}
