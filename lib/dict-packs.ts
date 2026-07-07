import { parse } from 'yaml';

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

export function parseDictPackSourceBytes(
    fileName: string,
    bytes: Uint8Array,
    existingPackNames: Set<string>,
    existingDisplayNames: Map<string, string> = new Map(),
): DictPackSource {
    if (fileName.toLowerCase().endsWith('.scel')) {
        return parseScelSource(fileName, bytes, existingPackNames, existingDisplayNames);
    }
    return parseDictPackSource(
        fileName,
        new TextDecoder().decode(bytes),
        existingPackNames,
        existingDisplayNames,
    );
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

    const entries: DictPackEntry[] = [];
    let entryCount = 0;
    for (let line of text.split('\n')) {
        line = line.replace(/\r$/, '');
        if (line === '' || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length !== 3) continue;
        const [word, code, weightStr] = parts;
        const normalizedCode = code.trim();
        const weight = parseInt(weightStr, 10);
        if (!word || !normalizedCode || isNaN(weight)) continue;
        entries.push({ text: word, code: normalizedCode, weight });
        entryCount++;
    }

    const dictYaml = buildDictPackYaml(packName, entries);

    return { packName, dictYaml, displayName, entryCount, entries };
}

interface ScelEntry {
    word: string;
    code: string;
    weight: number;
}

const SCEL_PINYIN_OFFSET = 0x1540;
const UTF16LE_DECODER = new TextDecoder('utf-16le');

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
    const entries = readScelEntries(bytes, pinyinTable, wordOffset);
    const dictEntries: DictPackEntry[] = [...entries.values()]
        .map(({ word, code, weight }) => ({ text: word, code, weight }));

    const dictYaml = buildDictPackYaml(packName, dictEntries);

    return { packName, dictYaml, displayName, entryCount: entries.size, entries: dictEntries };
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
): Map<string, ScelEntry> {
    const result = new Map<string, ScelEntry>();
    let offset = wordOffset;

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
            const syllable = pinyinTable.get(id);
            if (!syllable) {
                if (result.size > 0) return result;
                throw new Error(`Invalid Sogou SCEL file: unknown pinyin id ${id}`);
            }
            code.push(syllable);
            offset += 2;
        }
        for (let i = 0; i < homophoneCount; i++) {
            if (offset + 4 > bytes.length) {
                if (result.size > 0) return result;
                throw new Error('Invalid Sogou SCEL file: truncated word block');
            }
            const wordLength = readUint16Le(bytes, offset);
            offset += 2;
            if (wordLength === 0 || offset + wordLength + 2 > bytes.length) {
                if (result.size > 0) return result;
                throw new Error('Invalid Sogou SCEL file: malformed word entry');
            }

            const word = sanitizeDictText(readUtf16Le(bytes, offset, wordLength));
            offset += wordLength;

            const extraLength = readUint16Le(bytes, offset);
            offset += 2;
            if (offset + extraLength > bytes.length) {
                if (result.size > 0) return result;
                throw new Error('Invalid Sogou SCEL file: malformed word metadata');
            }

            const rawWeight = extraLength >= 2 ? readUint16Le(bytes, offset) : 100;
            const weight = Math.max(rawWeight, 1);
            offset += extraLength;

            const codeString = code.join(' ');
            if (!word || !codeString) continue;
            const key = `${word}\t${codeString}`;
            const existing = result.get(key);
            if (!existing || existing.weight < weight) {
                result.set(key, { word, code: codeString, weight });
            }
        }
    }

    return result;
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

export function normalizeToDictId(name: string): string {
    const normalizedName = name.trim().normalize('NFC');
    const normalized = normalizedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    const hasNonAscii = /[^\x00-\x7f]/.test(normalizedName);
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
    return base.replace(/\.(dict\.yaml|txt|tsv|scel)$/i, '').trim() || 'Dict Pack';
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
        initial_quality: 0.5,
        comment_format: ['xform/^.+$//'],
    };
}
