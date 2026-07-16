import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    getFs: vi.fn(),
}));

vi.mock('@/lib/utils', async importOriginal => ({
    ...(await importOriginal() as Record<string, unknown>),
    getFs: harness.getFs,
}));

const { installRemoteSchema } = await import('../entrypoints/options/schema-installer');

function response(body: string | Uint8Array, status = 200): Response {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Not Found',
        headers: { get: () => String(bytes.byteLength) },
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        arrayBuffer: async () => buffer,
    } as unknown as Response;
}

function streamedResponse(body: Uint8Array, declaredSize: number): Response {
    return {
        ...response(body),
        headers: { get: () => String(declaredSize) },
        body: new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(body);
                controller.close();
            },
        }),
    } as unknown as Response;
}

describe('remote Schema installation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        harness.getFs.mockReset();
    });

    it('finishes every dependency write before committing the Schema file', async () => {
        const writes: string[] = [];
        const fs = {
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => {
                if (!path.endsWith('.schema.yaml')) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                writes.push(path);
            }),
        };
        harness.getFs.mockResolvedValue(fs);

        const schemaYaml = [
            'schema:',
            '  name: Demo',
            '  description: Demo Schema',
            'engine:',
            '  translators:',
            '    - r10n_translator',
            'translator:',
            '  dictionary: demo',
            '',
        ].join('\n');
        const payload = new TextEncoder().encode('bin');
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/build/demo.schema.yaml')) {
                return response(schemaYaml);
            }
            return response(payload);
        }));

        const progress: number[] = [];
        const schema = await installRemoteSchema({
            id: 'demo',
            repoUrl: 'https://schemas.example/demo',
            update: false,
            onProgress: value => progress.push(value),
        });

        expect(schema.schema.name).toBe('Demo');
        expect(writes.slice(0, -1).sort()).toEqual([
            '/root/demo/build/demo.prism.bin',
            '/root/demo/build/demo.reverse.bin',
            '/root/demo/build/demo.table.bin',
        ]);
        expect(writes.at(-1)).toBe('/root/demo/build/demo.schema.yaml');
        expect(progress.at(-1)).toBe(100);
    });

    it('downloads the Lua modules required by hangeul_hnc before marking it installed', async () => {
        const writes: string[] = [];
        const fs = {
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => {
                writes.push(path);
            }),
        };
        harness.getFs.mockResolvedValue(fs);

        const schemaYaml = [
            'schema:',
            '  name: Hangeul HNC',
            '  description: Korean HNC',
            '  dependencies:',
            '    - cangjie5',
            'engine:',
            '  filters:',
            '    - lua_filter@kr_hnc_1m_filter',
            '  translators:',
            '    - reverse_lookup_translator',
            '    - script_translator',
            'reverse_lookup:',
            '  dictionary: cangjie5',
            'translator:',
            '  dictionary: hangeul_hnc.extended',
            '',
        ].join('\n');
        const assets = new Map<string, string>([
            ['build/hangeul_hnc.schema.yaml', schemaYaml],
            ['shared/hangeul_hnc.rime.lua', [
                '-- require("ignored_comment")',
                '--[=[ require("ignored_long_comment") ]=]',
                'local documentation = [==[ require("ignored_long_string") ]==]',
                'kr_hnc_1m_filter = require("filter_kr_hnc_1m_filter")',
                "kr_2set_0m_choice = require 'processor_kr_2set_0m_choice'",
                'kr_nested_filter = require("filters.kr.main")',
            ].join('\n')],
            ['shared/filter_kr_hnc_1m_filter.lua', 'return require("helpers.kr_common")'],
            ['shared/processor_kr_2set_0m_choice.lua', 'return {}'],
            ['shared/helpers/kr_common.lua', 'return {}'],
            ['shared/filters/kr/main.lua', 'return require("filters.kr.common")'],
            // A cycle must terminate rather than repeatedly fetching modules.
            ['shared/filters/kr/common.lua', 'return require("filters.kr.main")'],
        ]);
        const fetchedPaths: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            const path = url.split('/fyderhythm/').at(-1)!;
            fetchedPaths.push(path);
            return response(assets.get(path) ?? 'bin');
        }));

        await installRemoteSchema({
            id: 'hangeul_hnc',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        });

        expect(new Set(writes.slice(0, -1))).toEqual(new Set([
            '/root/hangeul_hnc/shared/hangeul_hnc.rime.lua',
            '/root/hangeul_hnc/shared/lua/filter_kr_hnc_1m_filter.lua',
            '/root/hangeul_hnc/shared/lua/processor_kr_2set_0m_choice.lua',
            '/root/hangeul_hnc/shared/lua/helpers/kr_common.lua',
            '/root/hangeul_hnc/shared/lua/filters/kr/main.lua',
            '/root/hangeul_hnc/shared/lua/filters/kr/common.lua',
            '/root/hangeul_hnc/build/cangjie5.table.bin',
            '/root/hangeul_hnc/build/cangjie5.prism.bin',
            '/root/hangeul_hnc/build/hangeul_hnc.extended.table.bin',
            '/root/hangeul_hnc/build/hangeul_hnc.extended.reverse.bin',
            '/root/hangeul_hnc/build/hangeul_hnc.extended.prism.bin',
        ]));
        expect(writes.at(-1)).toBe('/root/hangeul_hnc/build/hangeul_hnc.schema.yaml');
        expect(writes).not.toContain('/root/hangeul_hnc/shared/filter_kr_hnc_1m_filter.lua');
        expect(fetchedPaths).toContain('shared/filter_kr_hnc_1m_filter.lua');
        expect(fetchedPaths).not.toContain('shared/ignored_comment.lua');
        expect(fetchedPaths).not.toContain('shared/ignored_long_comment.lua');
        expect(fetchedPaths).not.toContain('shared/ignored_long_string.lua');
        expect(fetchedPaths.filter(path => path === 'shared/filters/kr/main.lua')).toHaveLength(2);
    });

    it('rejects a missing schema document before opening the local filesystem', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response('not found', 404)));

        await expect(installRemoteSchema({
            id: 'missing',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        })).rejects.toThrow('Failed to download build/missing.schema.yaml: HTTP 404 Not Found');
        expect(harness.getFs).not.toHaveBeenCalled();
    });

    it('loads the primary schema when an optional reverse-lookup artifact is not published', async () => {
        const writes: string[] = [];
        harness.getFs.mockResolvedValue({
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => writes.push(path)),
        });
        const schemaYaml = [
            'schema:',
            '  name: Optional Reverse Lookup',
            '  description: Primary table remains usable',
            'engine:',
            '  translators:',
            '    - reverse_lookup_translator',
            '    - table_translator',
            'reverse_lookup:',
            '  dictionary: optional_pinyin',
            '  prism: optional_quanpin',
            'translator:',
            '  dictionary: primary_table',
            '',
        ].join('\n');
        const assets = new Map<string, string>([
            ['build/optional.schema.yaml', schemaYaml],
            ['build/optional_pinyin.table.bin', 'optional table'],
            // optional_quanpin.prism.bin deliberately mirrors the catalog's
            // missing reverse-lookup artifacts and returns 404.
            ['build/primary_table.table.bin', 'primary table'],
            ['build/primary_table.reverse.bin', 'primary reverse'],
            ['build/primary_table.prism.bin', 'primary prism'],
        ]);
        const fetchedPaths: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const path = String(input).split('/fyderhythm/').at(-1)!;
            fetchedPaths.push(path);
            const body = assets.get(path);
            return body === undefined ? response('not found', 404) : response(body);
        }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await installRemoteSchema({
            id: 'optional',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        });

        expect(writes).toContain('/root/optional/build/optional_pinyin.table.bin');
        expect(writes).not.toContain('/root/optional/build/optional_pinyin.reverse.bin');
        expect(fetchedPaths).not.toContain('build/optional_pinyin.reverse.bin');
        expect(writes).not.toContain('/root/optional/build/optional_quanpin.prism.bin');
        expect(writes).toContain('/root/optional/build/primary_table.table.bin');
        expect(writes).toContain('/root/optional/build/primary_table.reverse.bin');
        expect(writes).toContain('/root/optional/build/primary_table.prism.bin');
        expect(writes.at(-1)).toBe('/root/optional/build/optional.schema.yaml');
        expect(warn).toHaveBeenCalledWith(
            'Optional reverse-lookup dependency build/optional_quanpin.prism.bin is unavailable, skipped',
        );
    });

    it('still rejects a missing primary dictionary without writing the schema marker', async () => {
        const writes: string[] = [];
        harness.getFs.mockResolvedValue({
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => writes.push(path)),
        });
        const schemaYaml = [
            'schema:',
            '  name: Missing Primary',
            '  description: Required table is absent',
            'engine:',
            '  translators:',
            '    - table_translator',
            'translator:',
            '  dictionary: missing_primary',
            '',
        ].join('\n');
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            if (String(input).endsWith('/build/required.schema.yaml')) return response(schemaYaml);
            return response('not found', 404);
        }));

        await expect(installRemoteSchema({
            id: 'required',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        })).rejects.toThrow('Failed to download build/missing_primary.table.bin: HTTP 404 Not Found');
        expect(writes).not.toContain('/root/required/build/required.schema.yaml');
    });

    it('does not hide a server failure for an optional reverse-lookup dependency', async () => {
        const writes: string[] = [];
        harness.getFs.mockResolvedValue({
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => writes.push(path)),
        });
        const schemaYaml = [
            'schema:',
            '  name: Server Failure',
            '  description: Optional assets may only ignore a definite 404',
            'engine:',
            '  translators:',
            '    - reverse_lookup_translator',
            'reverse_lookup:',
            '  dictionary: unavailable_lookup',
            '',
        ].join('\n');
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            if (String(input).endsWith('/build/server_failure.schema.yaml')) return response(schemaYaml);
            return response('server failure', 500);
        }));

        await expect(installRemoteSchema({
            id: 'server_failure',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        })).rejects.toThrow('Failed to download build/unavailable_lookup.table.bin: HTTP 500 Not Found');
        expect(writes).not.toContain('/root/server_failure/build/server_failure.schema.yaml');
    });

    it('rejects a truncated streamed dependency without writing the install marker', async () => {
        const writes: string[] = [];
        harness.getFs.mockResolvedValue({
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(async (path: string) => writes.push(path)),
        });
        const schemaYaml = [
            'schema:',
            '  name: Large Demo',
            '  description: Truncated dependency',
            'engine:',
            '  translators:',
            '    - table_translator',
            'translator:',
            '  dictionary: large_demo',
            '',
        ].join('\n');
        const payload = new Uint8Array(70 * 1024);
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            if (String(input).endsWith('/build/large_demo.schema.yaml')) return response(schemaYaml);
            return streamedResponse(payload, payload.byteLength + 1);
        }));

        await expect(installRemoteSchema({
            id: 'large_demo',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        })).rejects.toThrow(`is truncated: expected ${payload.byteLength + 1} bytes, received ${payload.byteLength}`);
        expect(writes).not.toContain('/root/large_demo/build/large_demo.schema.yaml');
    });

    it('rejects a missing Lua dependency without writing an install marker', async () => {
        const fs = {
            readEntry: vi.fn(async () => undefined),
            writeWholeFile: vi.fn(),
        };
        harness.getFs.mockResolvedValue(fs);
        const schemaYaml = [
            'schema:',
            '  name: Broken Lua',
            '  description: Missing module',
            'engine:',
            '  filters:',
            '    - lua_filter@missing_filter',
            '',
        ].join('\n');

        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/build/broken.schema.yaml')) return response(schemaYaml);
            if (url.endsWith('/shared/broken.rime.lua')) return response('missing_filter = require("missing_filter")');
            return response('not found', 404);
        }));

        await expect(installRemoteSchema({
            id: 'broken',
            repoUrl: 'https://schemas.example/fyderhythm',
            update: false,
            onProgress: vi.fn(),
        })).rejects.toThrow('Failed to download shared/missing_filter.lua: HTTP 404 Not Found');
        expect(fs.writeWholeFile).not.toHaveBeenCalled();
    });
});
