import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Entry, FastIndexedDbFsController } from '../lib/fs';

class MemoryDb {
  entries = new Map<string, Entry>();
  blobs = new Map<string, ArrayBuffer>();

  async get(store: string, key: string): Promise<unknown> {
    return this.store(store).get(key);
  }

  async put(store: string, value: unknown, key?: string): Promise<void> {
    if (store === 'entries') {
      const entry = value as Entry;
      this.entries.set(entry.fullPath, entry);
      return;
    }
    this.blobs.set(key!, value as ArrayBuffer);
  }

  async delete(store: string, key: string): Promise<void> {
    this.store(store).delete(key);
  }

  async getAll(store: string): Promise<unknown[]> {
    return Array.from(this.store(store).values());
  }

  private store(store: string): Map<string, unknown> {
    if (store === 'entries') return this.entries as Map<string, unknown>;
    if (store === 'blobs') return this.blobs as Map<string, unknown>;
    throw new Error(`Unknown store: ${store}`);
  }
}

function createFs() {
  const fs = new FastIndexedDbFsController('test-fs');
  const db = new MemoryDb();
  fs.db = db as unknown as FastIndexedDbFsController['db'];
  return { fs, db };
}

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

describe('FastIndexedDbFsController post-3.0 file operations', () => {
  beforeEach(() => {
    let counter = 0;
    vi.stubGlobal('self', {
      crypto: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(counter++);
          return array;
        },
      },
    });
  });

  it('writeWholeFile recursively creates missing parent directories', async () => {
    const { fs, db } = createFs();

    await fs.writeWholeFile('/root/demo/build/demo.schema.yaml', new TextEncoder().encode('schema'));

    expect([...db.entries.keys()].sort()).toEqual([
      '',
      '/root',
      '/root/demo',
      '/root/demo/build',
      '/root/demo/build/demo.schema.yaml',
    ]);
    expect(db.entries.get('/root')?.parent).toBe('');
    expect(db.entries.get('/root/demo/build')?.isDirectory).toBe(true);
    expect(db.entries.get('/root/demo/build/demo.schema.yaml')?.parent).toBe('/root/demo/build');
    await expect(fs.readWholeFile('/root/demo/build/demo.schema.yaml')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'schema',
    );
  });

  it('writeWholeFile replaces existing file contents', async () => {
    const { fs } = createFs();

    await fs.writeWholeFile('/root/demo/build/file.txt', new TextEncoder().encode('old'));
    await fs.writeWholeFile('/root/demo/build/file.txt', new TextEncoder().encode('new'));

    await expect(fs.readWholeFile('/root/demo/build/file.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'new',
    );
  });

  it('deleteDirectory removes only the selected subtree', async () => {
    const { fs, db } = createFs();
    await fs.writeWholeFile('/root/drop/build/file.txt', new TextEncoder().encode('drop'));
    await fs.writeWholeFile('/root/keep/build/file.txt', new TextEncoder().encode('keep'));

    await fs.deleteDirectory('/root/drop');

    expect(db.entries.has('/root/drop')).toBe(false);
    expect(db.entries.has('/root/drop/build')).toBe(false);
    expect(db.entries.has('/root/drop/build/file.txt')).toBe(false);
    expect([...db.entries.keys()]).toEqual([
      '',
      '/root',
      '/root/keep',
      '/root/keep/build',
      '/root/keep/build/file.txt',
    ]);
  });

  it('does not allow writeWholeFile to overwrite a directory', async () => {
    const { fs } = createFs();
    await fs.createDirectory('/root/demo');

    await expect(fs.writeWholeFile('/root/demo', new Uint8Array())).rejects.toThrow(
      'is a directory, cannot set its size',
    );
  });

  it('move renames a file and removes the source path', async () => {
    const { fs, db } = createFs();
    await fs.writeWholeFile('/root/a.txt', new TextEncoder().encode('hello'));

    await fs.move('/root/a.txt', '/root/b.txt');

    expect(db.entries.has('/root/a.txt')).toBe(false);
    expect(db.entries.get('/root/b.txt')?.fullPath).toBe('/root/b.txt');
    await expect(fs.readWholeFile('/root/b.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'hello',
    );
  });

  it('move throws when the source path does not exist', async () => {
    const { fs } = createFs();

    await expect(fs.move('/root/missing.txt', '/root/target.txt')).rejects.toThrow(
      'does not exist, cannot move',
    );
  });
});
