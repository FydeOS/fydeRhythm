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

const SMALL_FILE_LIMIT = 70 * 1024;
const DISCOVERY_PROGRESS_WEIGHT = 30;
const COMPLETE_PROGRESS = 100;

export async function installRemoteSchema({
    id,
    repoUrl,
    update,
    onProgress,
}: InstallRemoteSchemaOptions): Promise<RemoteSchemaDocument> {
    const fetchInit: RequestInit = { cache: 'no-cache' };
    const schemaBasePath = `/root/${id}`;
    const schemaFile = `build/${id}.schema.yaml`;
    const schemaYaml = await fetch(`${repoUrl}/${schemaFile}`, fetchInit).then(response => response.text());
    const schema = parse(schemaYaml) as RemoteSchemaDocument;
    const dependencies = await discoverDependencies(id, repoUrl, schemaYaml, schema, fetchInit);
    const fs = await getFs();
    const largeFiles: Array<{ path: string; size: number }> = [];
    let discoveredFiles = 0;

    for (const path of dependencies) {
        if (await fs.readEntry(`${schemaBasePath}/${path}`) && !update) {
            console.log(`${path} already exists, skipped`);
        } else {
            const controller = new AbortController();
            const response = await fetch(`${repoUrl}/${path}`, { signal: controller.signal, ...fetchInit });
            const sizeHeader = response.headers.get('Content-Length');
            const size = sizeHeader ? Number.parseInt(sizeHeader, 10) : Number.NaN;
            if ((size && size < SMALL_FILE_LIMIT) || Number.isNaN(size)) {
                const buffer = await response.arrayBuffer();
                await fs.writeWholeFile(`${schemaBasePath}/${path}`, new Uint8Array(buffer));
                console.log('Downloaded', path);
            } else {
                largeFiles.push({ path, size });
                controller.abort();
                console.log('Checked', path, `Size = ${size}`);
            }
        }
        discoveredFiles++;
        onProgress(DISCOVERY_PROGRESS_WEIGHT * discoveredFiles / dependencies.size);
    }

    const totalLargeSize = largeFiles.reduce((sum, file) => sum + file.size, 0);
    let downloadedSize = 0;
    let lastProgress = 0;
    for (const file of largeFiles) {
        const response = await fetch(`${repoUrl}/${file.path}`, fetchInit);
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error(`Missing response body for ${file.path}`);
        }
        const buffer = new ArrayBuffer(file.size);
        let offset = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
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
        await fs.writeWholeFile(`${schemaBasePath}/${file.path}`, new Uint8Array(buffer));
        console.log('Downloaded', file.path);
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
): Promise<Set<string>> {
    const dependencies = new Set<string>();
    if (schemaYaml.includes('lua_')) {
        dependencies.add(`shared/${id}.rime.lua`);
    }

    for (const filter of schema.engine?.filters ?? []) {
        const [kind, namespace] = filter.split('@');
        if (kind !== 'simplifier') continue;
        const simplifier = schema[namespace ?? 'simplifier'] as { opencc_config?: string } | undefined;
        const configPath = `shared/opencc/${simplifier?.opencc_config ?? 't2s.json'}`;
        dependencies.add(configPath);
        const config = await fetch(`${repoUrl}/${configPath}`, fetchInit)
            .then(response => response.json()) as OpenCcConfig;
        collectOpenCcFiles(config.segmentation?.dict, dependencies);
        for (const step of config.conversion_chain ?? []) {
            collectOpenCcFiles(step.dict, dependencies);
        }
    }

    const dictionaryTranslators = new Set([
        'script_translator',
        'table_translator',
        'reverse_lookup_translator',
    ]);
    for (const translator of schema.engine?.translators ?? []) {
        const [kind, namespace] = translator.split('@');
        if (!dictionaryTranslators.has(kind)) continue;
        const config = schema[namespace ?? 'translator'] as { dictionary?: string; prism?: string } | undefined;
        if (!config?.dictionary) continue;
        const prismName = config.prism ?? config.dictionary;
        dependencies.add(`build/${config.dictionary}.table.bin`);
        dependencies.add(`build/${config.dictionary}.reverse.bin`);
        dependencies.add(`build/${prismName}.prism.bin`);
    }

    if (schema.grammar?.language) {
        dependencies.add(`shared/${schema.grammar.language}.gram`);
    }
    return dependencies;
}

function collectOpenCcFiles(dictionary: OpenCcDictionary | undefined, dependencies: Set<string>): void {
    if (!dictionary) return;
    if (dictionary.type === 'group') {
        for (const child of dictionary.dicts) {
            collectOpenCcFiles(child, dependencies);
        }
    } else {
        dependencies.add(`shared/opencc/${dictionary.file}`);
    }
}
