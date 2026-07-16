import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    getFs: vi.fn(),
}));

vi.mock('@/lib/utils', async importOriginal => ({
    ...(await importOriginal() as Record<string, unknown>),
    getFs: harness.getFs,
}));

const { installRemoteSchema } = await import('../entrypoints/options/schema-installer');

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
            '    - script_translator',
            'translator:',
            '  dictionary: demo',
            '',
        ].join('\n');
        const payload = new TextEncoder().encode('bin');
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/build/demo.schema.yaml')) {
                return { text: async () => schemaYaml };
            }
            return {
                headers: { get: () => String(payload.byteLength) },
                arrayBuffer: async () => payload.buffer,
            };
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
});
