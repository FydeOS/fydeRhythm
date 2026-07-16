import { parse } from 'yaml';

import { getFs } from '@/lib/utils';

type OpenCcDictionary =
    | { type: 'ocd2' | 'text'; file: string }
    | { type: 'group'; dicts: OpenCcDictionary[] };

interface OpenCcConfig {
    segmentation?: { dict?: OpenCcDictionary };
    conversion_chain?: Array<{ dict?: OpenCcDictionary }>;
}

export interface RemoteSchemaDocument extends Record<string, unknown> {
    schema: {
        name: string;
        description: string;
    };
    engine?: {
        filters?: string[];
        translators?: string[];
    };
    grammar?: {
        language?: string;
    };
}

interface InstallRemoteSchemaOptions {
    id: string;
    repoUrl: string;
    update: boolean;
    onProgress(progress: number): void;
}

interface RemoteDependency {
    installPath: string;
    required: boolean;
}

type RemoteDependencies = Map<string, RemoteDependency>;

const SMALL_FILE_LIMIT = 70 * 1024;
const DISCOVERY_PROGRESS_WEIGHT = 30;
const COMPLETE_PROGRESS = 100;
const MAX_LUA_MODULES = 128;

export async function installRemoteSchema({
    id,
    repoUrl,
    update,
    onProgress,
}: InstallRemoteSchemaOptions): Promise<RemoteSchemaDocument> {
    const fetchInit: RequestInit = { cache: 'no-cache' };
    const schemaBasePath = `/root/${id}`;
    const schemaFile = `build/${id}.schema.yaml`;
    const schemaYaml = await fetchRequiredFile(repoUrl, schemaFile, fetchInit)
        .then(response => response.text());
    const schema = parse(schemaYaml) as RemoteSchemaDocument;
    const dependencies = await discoverDependencies(id, repoUrl, schemaYaml, schema, fetchInit);
    const fs = await getFs();
    const largeFiles: Array<{
        remotePath: string;
        installPath: string;
        required: boolean;
        size: number;
    }> = [];
    let discoveredFiles = 0;

    for (const [remotePath, dependency] of dependencies) {
        const { installPath, required } = dependency;
        if (await fs.readEntry(`${schemaBasePath}/${installPath}`) && !update) {
            console.log(`${installPath} already exists, skipped`);
        } else {
            const controller = new AbortController();
            const response = await fetchDependencyFile(
                repoUrl,
                remotePath,
                { signal: controller.signal, ...fetchInit },
                required,
            );
            if (!response) {
                discoveredFiles++;
                onProgress(DISCOVERY_PROGRESS_WEIGHT * discoveredFiles / dependencies.size);
                continue;
            }
            const sizeHeader = response.headers.get('Content-Length');
            const size = sizeHeader ? Number.parseInt(sizeHeader, 10) : Number.NaN;
            if (size < SMALL_FILE_LIMIT || Number.isNaN(size)) {
                const buffer = await response.arrayBuffer();
                await fs.writeWholeFile(`${schemaBasePath}/${installPath}`, new Uint8Array(buffer));
                console.log('Downloaded', installPath);
            } else {
                largeFiles.push({ remotePath, installPath, required, size });
                controller.abort();
                console.log('Checked', remotePath, `Size = ${size}`);
            }
        }
        discoveredFiles++;
        onProgress(DISCOVERY_PROGRESS_WEIGHT * discoveredFiles / dependencies.size);
    }

    const totalLargeSize = largeFiles.reduce((sum, file) => sum + file.size, 0);
    let downloadedSize = 0;
    let lastProgress = 0;
    for (const file of largeFiles) {
        const response = await fetchDependencyFile(repoUrl, file.remotePath, fetchInit, file.required);
        if (!response) continue;
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error(`Missing response body for ${file.remotePath}`);
        }
        const buffer = new ArrayBuffer(file.size);
        let offset = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (offset + value.length > file.size) {
                throw new Error(`Downloaded ${file.remotePath} exceeds its declared size of ${file.size} bytes`);
            }
            new Uint8Array(buffer, offset, value.length).set(value);
            offset += value.length;
            downloadedSize += value.length;
            const progress = DISCOVERY_PROGRESS_WEIGHT
                + (COMPLETE_PROGRESS - DISCOVERY_PROGRESS_WEIGHT) * downloadedSize / totalLargeSize;
            if (progress - lastProgress > 0.5) {
                onProgress(progress);
                lastProgress = progress;
            }
        }
        if (offset !== file.size) {
            throw new Error(`Downloaded ${file.remotePath} is truncated: expected ${file.size} bytes, received ${offset}`);
        }
        await fs.writeWholeFile(`${schemaBasePath}/${file.installPath}`, new Uint8Array(buffer));
        console.log('Downloaded', file.installPath);
    }

    // The Schema is the durable install marker. Write it only after every
    // dependency has completed so a failed download cannot look installed.
    await fs.writeWholeFile(`${schemaBasePath}/${schemaFile}`, new TextEncoder().encode(schemaYaml));
    onProgress(COMPLETE_PROGRESS);
    return schema;
}

async function discoverDependencies(
    id: string,
    repoUrl: string,
    schemaYaml: string,
    schema: RemoteSchemaDocument,
    fetchInit: RequestInit,
): Promise<RemoteDependencies> {
    // Remote artifacts and runtime VFS paths usually match. Lua modules are the
    // exception: the CDN keeps them under shared/, while librime-lua only adds
    // shared/lua/ and user/lua/ to package.path.
    const dependencies: RemoteDependencies = new Map();
    if (schemaYaml.includes('lua_')) {
        await collectLuaDependencies(id, repoUrl, dependencies, fetchInit);
    }

    for (const filter of schema.engine?.filters ?? []) {
        const [kind, namespace] = filter.split('@');
        if (kind !== 'simplifier') continue;
        const simplifier = schema[namespace ?? 'simplifier'] as { opencc_config?: string } | undefined;
        const configPath = `shared/opencc/${simplifier?.opencc_config ?? 't2s.json'}`;
        addDependency(dependencies, configPath);
        const config = await fetchRequiredFile(repoUrl, configPath, fetchInit)
            .then(response => response.json()) as OpenCcConfig;
        collectOpenCcFiles(config.segmentation?.dict, dependencies);
        for (const step of config.conversion_chain ?? []) {
            collectOpenCcFiles(step.dict, dependencies);
        }
    }

    const dictionaryTranslators = new Set([
        'script_translator',
        'table_translator',
        'r10n_translator',
        'reverse_lookup_translator',
    ]);
    for (const translator of schema.engine?.translators ?? []) {
        const [kind, namespace] = translator.split('@');
        if (!dictionaryTranslators.has(kind)) continue;
        const defaultNamespace = kind === 'reverse_lookup_translator' ? 'reverse_lookup' : 'translator';
        const config = schema[namespace ?? defaultNamespace] as {
            dictionary?: string;
            prism?: string;
            target?: string;
        } | undefined;
        if (!config?.dictionary) continue;
        const prismName = config.prism ?? config.dictionary;
        if (kind === 'reverse_lookup_translator') {
            // Reverse lookup is an auxiliary feature. Its lookup dictionary
            // needs a table and prism; the reverse.bin belongs to the target
            // translator namespace, which defaults to `translator`.
            addDependency(dependencies, `build/${config.dictionary}.table.bin`, undefined, false);
            addDependency(dependencies, `build/${prismName}.prism.bin`, undefined, false);
            const target = schema[config.target ?? 'translator'] as { dictionary?: string } | undefined;
            if (target?.dictionary) {
                addDependency(dependencies, `build/${target.dictionary}.reverse.bin`, undefined, false);
            }
        } else {
            addDependency(dependencies, `build/${config.dictionary}.table.bin`);
            addDependency(dependencies, `build/${config.dictionary}.reverse.bin`);
            addDependency(dependencies, `build/${prismName}.prism.bin`);
        }
    }

    if (schema.grammar?.language) {
        addDependency(dependencies, `shared/${schema.grammar.language}.gram`);
    }
    return dependencies;
}

async function fetchRequiredFile(
    repoUrl: string,
    path: string,
    fetchInit: RequestInit,
): Promise<Response> {
    const response = await fetch(`${repoUrl}/${path}`, fetchInit);
    if (!response.ok) {
        throw new HttpDownloadError(path, response.status, response.statusText);
    }
    return response;
}

class HttpDownloadError extends Error {
    constructor(
        readonly path: string,
        readonly status: number,
        statusText: string,
    ) {
        const statusLabel = [status, statusText].filter(Boolean).join(' ');
        super(`Failed to download ${path}: HTTP ${statusLabel || 'error'}`);
    }
}

async function fetchDependencyFile(
    repoUrl: string,
    path: string,
    fetchInit: RequestInit,
    required: boolean,
): Promise<Response | undefined> {
    try {
        return await fetchRequiredFile(repoUrl, path, fetchInit);
    } catch (error) {
        if (!required && error instanceof HttpDownloadError && error.status === 404) {
            console.warn(`Optional reverse-lookup dependency ${path} is unavailable, skipped`);
            return undefined;
        }
        throw error;
    }
}

function addDependency(
    dependencies: RemoteDependencies,
    remotePath: string,
    installPath = remotePath,
    required = true,
): void {
    const existing = dependencies.get(remotePath);
    dependencies.set(remotePath, {
        installPath: existing?.installPath ?? installPath,
        required: required || existing?.required === true,
    });
}

async function collectLuaDependencies(
    id: string,
    repoUrl: string,
    dependencies: RemoteDependencies,
    fetchInit: RequestInit,
): Promise<void> {
    const entrypoint = `shared/${id}.rime.lua`;
    const pending = [{ remotePath: entrypoint, installPath: entrypoint }];
    const visited = new Set<string>();

    while (pending.length > 0) {
        const dependency = pending.pop()!;
        if (visited.has(dependency.remotePath)) continue;
        visited.add(dependency.remotePath);
        addDependency(dependencies, dependency.remotePath, dependency.installPath);

        if (visited.size > MAX_LUA_MODULES) {
            throw new Error(`Schema ${id} has too many Lua dependencies`);
        }

        const source = await fetchRequiredFile(repoUrl, dependency.remotePath, fetchInit)
            .then(response => response.text());
        for (const moduleName of extractLuaRequireModules(source)) {
            const modulePaths = luaModulePaths(moduleName);
            if (!visited.has(modulePaths.remotePath)) {
                pending.push(modulePaths);
            }
        }
    }
}

function luaModulePaths(moduleName: string): { remotePath: string; installPath: string } {
    const normalized = moduleName.replaceAll('.', '/');
    const parts = normalized.split('/');
    if (!normalized
        || normalized.startsWith('/')
        || parts.some(part => !part || part === '..')
        || !/^[A-Za-z0-9_/-]+$/.test(normalized)) {
        throw new Error(`Unsafe Lua module dependency: ${moduleName}`);
    }
    return {
        remotePath: `shared/${normalized}.lua`,
        installPath: `shared/lua/${normalized}.lua`,
    };
}

function extractLuaRequireModules(source: string): Set<string> {
    const modules = new Set<string>();
    let index = 0;

    while (index < source.length) {
        if (source.startsWith('--', index)) {
            const longCommentEnd = source[index + 2] === '['
                ? findLuaLongBlockEnd(source, index + 2)
                : null;
            if (longCommentEnd !== null) {
                index = longCommentEnd;
            } else {
                const newline = source.indexOf('\n', index + 2);
                index = newline === -1 ? source.length : newline + 1;
            }
            continue;
        }

        const longStringEnd = source[index] === '['
            ? findLuaLongBlockEnd(source, index)
            : null;
        if (longStringEnd !== null) {
            index = longStringEnd;
            continue;
        }

        const char = source[index];
        if (char === '"' || char === "'") {
            index = readLuaQuotedString(source, index).end;
            continue;
        }

        if (source.startsWith('require', index)
            && !isLuaIdentifierChar(source[index - 1])
            && !isLuaIdentifierChar(source[index + 'require'.length])) {
            let cursor = skipWhitespace(source, index + 'require'.length);
            if (source[cursor] === '(') {
                cursor = skipWhitespace(source, cursor + 1);
            }
            if (source[cursor] === '"' || source[cursor] === "'") {
                const required = readLuaQuotedString(source, cursor);
                modules.add(required.value);
                index = required.end;
                continue;
            }
        }

        index++;
    }

    return modules;
}

function findLuaLongBlockEnd(source: string, start: number): number | null {
    const opening = source.slice(start).match(/^\[(=*)\[/);
    if (!opening) return null;
    const closing = `]${opening[1]}]`;
    const closingIndex = source.indexOf(closing, start + opening[0].length);
    return closingIndex === -1 ? source.length : closingIndex + closing.length;
}

function readLuaQuotedString(source: string, start: number): { value: string; end: number } {
    const quote = source[start];
    let value = '';
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === '\\' && index + 1 < source.length) {
            value += source[index + 1];
            index += 2;
        } else if (source[index] === quote) {
            return { value, end: index + 1 };
        } else {
            value += source[index];
            index++;
        }
    }
    return { value, end: source.length };
}

function skipWhitespace(source: string, start: number): number {
    let index = start;
    while (/\s/.test(source[index] ?? '')) index++;
    return index;
}

function isLuaIdentifierChar(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function collectOpenCcFiles(dictionary: OpenCcDictionary | undefined, dependencies: RemoteDependencies): void {
    if (!dictionary) return;
    if (dictionary.type === 'group') {
        for (const child of dictionary.dicts) {
            collectOpenCcFiles(child, dependencies);
        }
    } else {
        const path = `shared/opencc/${dictionary.file}`;
        addDependency(dependencies, path);
    }
}
