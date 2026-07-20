import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { FastIndexedDbFsController } from '../lib/fs';
import { detectSchemaInZip, importSchemaFromZip } from '../lib/import-schema';

class MemoryFs {
  files = new Map<string, Uint8Array>();
  deleted: string[] = [];
  garbageCollected = false;

  async readEntry(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null;
  }

  async writeWholeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async deleteDirectory(path: string): Promise<void> {
    this.deleted.push(path);
    for (const filePath of Array.from(this.files.keys())) {
      if (filePath === path || filePath.startsWith(`${path}/`)) {
        this.files.delete(filePath);
      }
    }
  }

  async collectGarbage(): Promise<void> {
    this.garbageCollected = true;
  }
}

class FailingMemoryFs extends MemoryFs {
  private writes = 0;

  async writeWholeFile(path: string, data: Uint8Array): Promise<void> {
    this.writes++;
    if (this.writes > 1) {
      throw new Error('simulated write failure');
    }
    await super.writeWholeFile(path, data);
  }
}

function schemaYaml(id = 'demo', extra = ''): string {
  return [
    'schema:',
    `  schema_id: ${id}`,
    '  name: Demo Schema',
    extra,
    '',
  ].join('\n');
}

async function zipBlob(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'blob' });
}

function asFs(fs: MemoryFs): FastIndexedDbFsController {
  return fs as unknown as FastIndexedDbFsController;
}

function decode(data: Uint8Array | undefined): string {
  return new TextDecoder().decode(data);
}

describe('schema ZIP import', () => {
  it('detects schema metadata from a wrapped ZIP archive', async () => {
    await expect(detectSchemaInZip(await zipBlob({
      'rime-demo/build/demo.schema.yaml': schemaYaml('demo', '  description: Test schema'),
    }))).resolves.toEqual({
      schemaId: 'demo',
      schemaName: 'Demo Schema',
      schemaDescription: 'Test schema',
    });
  });

  it('routes imported files into the schema VFS layout', async () => {
    const fs = new MemoryFs();
    const result = await importSchemaFromZip(
      await zipBlob({
        'demo.schema.yaml': schemaYaml(),
        'demo.table.bin': 'table-data',
        'lua/helper.lua': 'return {}',
      }),
      asFs(fs),
    );

    expect(result).toEqual({
      schemaId: 'demo',
      schemaName: 'Demo Schema',
      schemaDescription: 'Imported from ZIP',
      fileCount: 3,
    });
    expect([...fs.files.keys()].sort()).toEqual([
      '/root/demo/build/demo.schema.yaml',
      '/root/demo/build/demo.table.bin',
      '/root/demo/shared/demo.rime.lua',
      '/root/demo/shared/lua/helper.lua',
    ]);
    expect(decode(fs.files.get('/root/demo/shared/demo.rime.lua'))).toContain('return {}');
  });

  it('routes canonical, shared-prefix, and loose files while ignoring unrelated files', async () => {
    const fs = new MemoryFs();

    await importSchemaFromZip(
      await zipBlob({
        'package/build/demo.schema.yaml': schemaYaml('demo'),
        'package/build/demo.prism.bin': 'prism',
        'package/shared/user.yaml': 'shared',
        'package/opencc/demo.json': '{}',
        'package/demo.gram': 'grammar',
        'package/notes.md': 'ignored',
      }),
      asFs(fs),
    );

    expect([...fs.files.keys()].sort()).toEqual([
      '/root/demo/build/demo.prism.bin',
      '/root/demo/build/demo.schema.yaml',
      '/root/demo/shared/demo.gram',
      '/root/demo/shared/opencc/demo.json',
      '/root/demo/shared/user.yaml',
    ]);
  });

  it('routes loose opencc extension files to shared/opencc', async () => {
    const fs = new MemoryFs();

    await importSchemaFromZip(
      await zipBlob({
        'demo.schema.yaml': schemaYaml('demo'),
        'emoji.ocd2': 'ocd2-binary',
        'emoji.json': '{}',
      }),
      asFs(fs),
    );

    expect([...fs.files.keys()].sort()).toEqual([
      '/root/demo/build/demo.schema.yaml',
      '/root/demo/shared/opencc/emoji.json',
      '/root/demo/shared/opencc/emoji.ocd2',
    ]);
  });

  it('reports import progress at each major phase', async () => {
    const fs = new MemoryFs();
    const progress: number[] = [];

    await importSchemaFromZip(
      await zipBlob({
        'demo.schema.yaml': schemaYaml(),
        'demo.table.bin': 'table-data',
      }),
      asFs(fs),
      { onProgress: percent => progress.push(percent) },
    );

    expect(progress).toEqual([5, 10, 20, 55, 90, 95]);
  });

  it('rejects an import when the schema already exists', async () => {
    const fs = new MemoryFs();
    fs.files.set('/root/demo', new Uint8Array());

    await expect(importSchemaFromZip(
      await zipBlob({ 'demo.schema.yaml': schemaYaml() }),
      asFs(fs),
    )).rejects.toThrow('Schema "demo" already exists');
  });

  it('rejects duplicate files that route to the same VFS path', async () => {
    await expect(importSchemaFromZip(
      await zipBlob({
        'demo.schema.yaml': schemaYaml(),
        'demo.table.bin': 'loose',
        'build/demo.table.bin': 'canonical',
      }),
      asFs(new MemoryFs()),
    )).rejects.toThrow('duplicate files that map to the same destination: build/demo.table.bin');
  });

  it('cleans up schema files if a write fails after import starts', async () => {
    const fs = new FailingMemoryFs();

    await expect(importSchemaFromZip(
      await zipBlob({
        'demo.schema.yaml': schemaYaml(),
        'demo.table.bin': 'table-data',
      }),
      asFs(fs),
    )).rejects.toThrow('simulated write failure');

    expect(fs.deleted).toEqual(['/root/demo']);
    expect(fs.garbageCollected).toBe(true);
    expect([...fs.files.keys()]).toEqual([]);
  });

  it('rejects an empty ZIP archive', async () => {
    await expect(detectSchemaInZip(await new JSZip().generateAsync({ type: 'blob' }))).rejects.toThrow(
      'ZIP is empty.',
    );
  });

  it('rejects a corrupt ZIP archive', async () => {
    await expect(detectSchemaInZip(new Blob(['not a zip']))).rejects.toThrow('Could not read ZIP file');
  });

  it('rejects archives without a schema config', async () => {
    await expect(detectSchemaInZip(await zipBlob({
      'build/demo.table.bin': 'table',
    }))).rejects.toThrow('Could not detect schema config');
  });

  it('rejects archives with multiple schema configs', async () => {
    await expect(detectSchemaInZip(await zipBlob({
      'demo.schema.yaml': schemaYaml('demo'),
      'other.schema.yaml': schemaYaml('other'),
    }))).rejects.toThrow('multiple schema YAML files');
  });

  it('rejects schema configs without a schema id', async () => {
    await expect(detectSchemaInZip(await zipBlob({
      'demo.schema.yaml': 'schema:\n  name: Missing Id\n',
    }))).rejects.toThrow('missing schema.schema_id');
  });

  it('rejects compressed files that are larger than the import limit', async () => {
    const oversizeBlob = {
      size: 101 * 1024 * 1024,
      arrayBuffer: async () => {
        throw new Error('arrayBuffer should not be called for oversize blobs');
      },
    } as unknown as Blob;

    await expect(detectSchemaInZip(oversizeBlob)).rejects.toThrow('ZIP is too large: 101.0 MB');
  });
});
