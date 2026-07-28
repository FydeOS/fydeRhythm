import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Entry, FastIndexedDbFsController, kCacheBlobSizeLimit } from '../lib/fs';

class MemoryDb {
  entries = new Map<string, Entry>();
  blobs = new Map<string, ArrayBuffer>();

  // Real IndexedDB structured-clones values on both sides; storing references
  // would let entry mutations leak into the "persisted" copy.
  async get(store: string, key: string): Promise<unknown> {
    return structuredClone(this.store(store).get(key));
  }

  async put(store: string, value: unknown, key?: string): Promise<void> {
    const copy = structuredClone(value);
    if (store === 'entries') {
      const entry = copy as Entry;
      this.entries.set(entry.fullPath, entry);
      return;
    }
    this.blobs.set(key!, copy as ArrayBuffer);
  }

  async delete(store: string, key: string): Promise<void> {
    this.store(store).delete(key);
  }

  async getAll(store: string): Promise<unknown[]> {
    return Array.from(this.store(store).values());
  }

  async getAllFromIndex(_store: string, _index: string, parent: string): Promise<Entry[]> {
    return Array.from(this.entries.values()).filter(e => e.parent === parent);
  }

  async countFromIndex(store: string, index: string, parent: string): Promise<number> {
    return (await this.getAllFromIndex(store, index, parent)).length;
  }

  async getAllKeys(store: string): Promise<string[]> {
    return Array.from(this.store(store).keys());
  }

  transaction(store: string, _mode: string) {
    const target = this.store(store);
    return {
      objectStore: () => ({ delete: (key: string) => void target.delete(key) }),
      done: Promise.resolve(),
    };
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

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Sequential appends: one persisted blob per piece.
async function writeParts(fs: FastIndexedDbFsController, path: string, pieces: string[]) {
  await fs.openFile(path, false);
  let pos = 0;
  for (const text of pieces) {
    await fs.writeFile(path, encode(text), pos);
    pos += text.length;
  }
  await fs.closeFile(path);
}

// generateId pulls from self.crypto, which node lacks.
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

describe('FastIndexedDbFsController post-3.0 file operations', () => {
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

  it('move refuses paths with an open handle on either end', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/a.txt', encode('a'));
    await fs.writeWholeFile('/root/b.txt', encode('b'));
    await fs.openFile('/root/a.txt', true);

    await expect(fs.move('/root/a.txt', '/root/c.txt')).rejects.toThrow('already opened');
    await expect(fs.move('/root/b.txt', '/root/a.txt')).rejects.toThrow('already opened');
  });
});

describe('open/close lifecycle', () => {
  it('openFile for read throws on a missing path', async () => {
    const { fs } = createFs();

    await expect(fs.openFile('/root/none.txt', true)).rejects.toThrow(
      'does not exist, cannot open for read',
    );
  });

  it('openFile refuses a directory', async () => {
    const { fs } = createFs();
    await fs.createDirectory('/root/dir');

    await expect(fs.openFile('/root/dir', false)).rejects.toThrow(
      'is a directory, cannot open as a file',
    );
  });

  it('openFile for write creates an empty file that closeFile persists', async () => {
    const { fs, db } = createFs();

    await fs.openFile('/root/new.bin', false);
    expect(db.entries.has('/root/new.bin')).toBe(false);

    await fs.closeFile('/root/new.bin');
    expect(db.entries.get('/root/new.bin')?.blobs).toEqual([]);
    expect(db.entries.get('/root/new.bin')?.isDirectory).toBe(false);
  });

  it('reopening as readonly blocks further writes', async () => {
    const { fs } = createFs();
    await fs.openFile('/root/f.txt', false);
    await fs.openFile('/root/f.txt', true);

    await expect(fs.writeFile('/root/f.txt', encode('x'), 0)).rejects.toThrow(
      'not opened for writing',
    );
  });

  it('an open dirty handle shadows the persisted entry until close', async () => {
    const { fs, db } = createFs();
    await fs.writeWholeFile('/root/f.txt', encode('old'));

    await fs.openFile('/root/f.txt', false);
    await fs.writeFile('/root/f.txt', encode('new!'), 0);

    await expect(fs.getFileSize('/root/f.txt')).resolves.toBe(4);
    const persisted = db.entries.get('/root/f.txt')!;
    expect(persisted.blobs.reduce((sum, b) => sum + b.size, 0)).toBe(3);

    await fs.closeFile('/root/f.txt');
    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'new!',
    );
  });

  it('closeFile on an unopened path is a no-op', async () => {
    const { fs } = createFs();

    await expect(fs.closeFile('/root/none.txt')).resolves.toBeUndefined();
  });

  it('getFileSize is 0 for a missing path', async () => {
    const { fs } = createFs();

    await expect(fs.getFileSize('/root/none.txt')).resolves.toBe(0);
  });
});

describe('positional writes', () => {
  async function writeAndClose(fs: FastIndexedDbFsController, path: string, pieces: Array<[string, number]>) {
    await fs.openFile(path, false);
    for (const [text, pos] of pieces) {
      await fs.writeFile(path, encode(text), pos);
    }
    await fs.closeFile(path);
  }

  it('sequential appends concatenate', async () => {
    const { fs } = createFs();
    await writeAndClose(fs, '/root/f.txt', [['hello', 0], [' world', 5]]);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'hello world',
    );
  });

  it('an overwrite inside one blob preserves both ends', async () => {
    const { fs } = createFs();
    await writeAndClose(fs, '/root/f.txt', [['abcdef', 0], ['XY', 2]]);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abXYef',
    );
  });

  it('an overwrite straddling a blob boundary preserves both ends', async () => {
    const { fs } = createFs();
    await writeAndClose(fs, '/root/f.txt', [['abc', 0], ['def', 3], ['XY', 2]]);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abXYef',
    );
  });

  it('a write past the end collapses the gap rather than zero-filling', async () => {
    // Pins the current sparse-write contract: emscripten never seeks past
    // EOF, so the gap is dropped, not filled.
    const { fs } = createFs();
    await writeAndClose(fs, '/root/f.txt', [['ab', 0], ['cd', 10]]);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abcd',
    );
  });
});

describe('setFileSize', () => {
  it('creates a missing file as zeroes', async () => {
    const { fs } = createFs();

    await fs.setFileSize('/root/f.bin', 3);

    await expect(fs.readWholeFile('/root/f.bin')).resolves.toSatisfy(
      (data: Uint8Array) => data.length === 3 && data.every(b => b === 0),
    );
  });

  it('extends an existing file with zeroes', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/f.bin', encode('hi'));

    await fs.setFileSize('/root/f.bin', 5);

    await expect(fs.readWholeFile('/root/f.bin')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data.slice(0, 2)) === 'hi'
        && data.length === 5 && data[2] === 0 && data[4] === 0,
    );
  });

  it('truncates whole blobs at a blob boundary', async () => {
    const { fs } = createFs();
    await writeParts(fs, '/root/f.txt', ['abc', 'def']);

    await fs.setFileSize('/root/f.txt', 3);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abc',
    );
  });

  it('truncates to the middle of a blob', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/f.txt', encode('hello world'));

    await fs.setFileSize('/root/f.txt', 5);

    await expect(fs.getFileSize('/root/f.txt')).resolves.toBe(5);
    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'hello',
    );
  });

  it('truncates into the second blob, keeping its head', async () => {
    const { fs } = createFs();
    await writeParts(fs, '/root/f.txt', ['abc', 'def']);

    await fs.setFileSize('/root/f.txt', 4);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abcd',
    );
  });

  it('truncates inside the first blob, dropping the rest', async () => {
    const { fs } = createFs();
    await writeParts(fs, '/root/f.txt', ['abc', 'def']);

    await fs.setFileSize('/root/f.txt', 2);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'ab',
    );
  });

  it('truncates to zero', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/f.txt', encode('hello'));

    await fs.setFileSize('/root/f.txt', 0);

    await expect(fs.getFileSize('/root/f.txt')).resolves.toBe(0);
    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => data.length === 0,
    );
  });

  it('leaves the file alone at its current size', async () => {
    const { fs } = createFs();
    await writeParts(fs, '/root/f.txt', ['abc', 'def']);

    await fs.setFileSize('/root/f.txt', 6);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data) === 'abcdef',
    );
  });

  it('extending after a truncation pads with zeroes, not old bytes', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/f.txt', encode('hello'));

    await fs.setFileSize('/root/f.txt', 2);
    await fs.setFileSize('/root/f.txt', 4);

    await expect(fs.readWholeFile('/root/f.txt')).resolves.toSatisfy(
      (data: Uint8Array) => decode(data.slice(0, 2)) === 'he'
        && data.length === 4 && data[2] === 0 && data[3] === 0,
    );
  });

  it('size zero on a missing path creates an empty file', async () => {
    const { fs, db } = createFs();

    await fs.setFileSize('/root/new.bin', 0);

    expect(db.entries.get('/root/new.bin')?.blobs).toEqual([]);
    await expect(fs.getFileSize('/root/new.bin')).resolves.toBe(0);
  });

  it('refuses a directory', async () => {
    const { fs } = createFs();
    await fs.createDirectory('/root/dir');

    await expect(fs.setFileSize('/root/dir', 1)).rejects.toThrow('is a directory');
  });
});

describe('positional reads and the blob cache', () => {
  async function makeFile(fs: FastIndexedDbFsController, path: string, pieces: string[]) {
    await fs.openFile(path, false);
    let pos = 0;
    for (const text of pieces) {
      await fs.writeFile(path, encode(text), pos);
      pos += text.length;
    }
    await fs.closeFile(path);
    await fs.openFile(path, true);
  }

  it('reads span blob boundaries', async () => {
    const { fs } = createFs();
    await makeFile(fs, '/root/f.txt', ['hello', ' world']);

    const buf = new Uint8Array(11);
    await expect(fs.readFile('/root/f.txt', buf, 0)).resolves.toBe(11);
    expect(decode(buf)).toBe('hello world');
  });

  it('reads honor the position and stop at EOF', async () => {
    const { fs } = createFs();
    await makeFile(fs, '/root/f.txt', ['hello', ' world']);

    const mid = new Uint8Array(5);
    await expect(fs.readFile('/root/f.txt', mid, 3)).resolves.toBe(5);
    expect(decode(mid)).toBe('lo wo');

    const tail = new Uint8Array(20);
    await expect(fs.readFile('/root/f.txt', tail, 6)).resolves.toBe(5);
    expect(decode(tail.slice(0, 5))).toBe('world');

    const past = new Uint8Array(4);
    await expect(fs.readFile('/root/f.txt', past, 100)).resolves.toBe(0);
  });

  it('readFile throws when the file is not open', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/f.txt', encode('x'));

    await expect(fs.readFile('/root/f.txt', new Uint8Array(1), 0)).rejects.toThrow(
      'not opened for reading',
    );
  });

  it('caches a small blob after three reads', async () => {
    const { fs, db } = createFs();
    await makeFile(fs, '/root/f.txt', ['cached']);
    const blobGets = vi.spyOn(db, 'get');
    const countBlobGets = () => blobGets.mock.calls.filter(c => c[0] === 'blobs').length;

    const buf = new Uint8Array(6);
    for (let i = 0; i < 3; i++) await fs.readFile('/root/f.txt', buf, 0);
    expect(countBlobGets()).toBe(3);

    await fs.readFile('/root/f.txt', buf, 0);
    expect(countBlobGets()).toBe(3);
    expect(decode(buf)).toBe('cached');
  });

  it('never caches a blob over the size limit', async () => {
    const { fs, db } = createFs();
    await fs.openFile('/root/big.bin', false);
    await fs.writeFile('/root/big.bin', new Uint8Array(kCacheBlobSizeLimit + 1), 0);
    await fs.closeFile('/root/big.bin');
    await fs.openFile('/root/big.bin', true);
    const blobGets = vi.spyOn(db, 'get');

    const buf = new Uint8Array(4);
    for (let i = 0; i < 5; i++) await fs.readFile('/root/big.bin', buf, 0);

    expect(blobGets.mock.calls.filter(c => c[0] === 'blobs').length).toBe(5);
    expect(fs.openedFiles.get('/root/big.bin')!.cachedBlobs.size).toBe(0);
  });

  it('evicts to stay within the total cache budget', async () => {
    const { fs } = createFs();
    await fs.openFile('/root/big.bin', false);
    for (let k = 0; k < 4; k++) {
      await fs.writeFile('/root/big.bin', new Uint8Array(kCacheBlobSizeLimit), k * kCacheBlobSizeLimit);
    }
    await fs.closeFile('/root/big.bin');
    await fs.openFile('/root/big.bin', true);

    // Three reads promote a blob; the budget holds three limit-sized blobs,
    // so promoting the fourth must evict one.
    const buf = new Uint8Array(4);
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 3; i++) {
        await fs.readFile('/root/big.bin', buf, k * kCacheBlobSizeLimit);
      }
    }

    expect(fs.openedFiles.get('/root/big.bin')!.cachedBlobs.size).toBe(3);
  });
});

describe('directory listing and garbage collection', () => {
  it('readDirectory lists direct children with names', async () => {
    const { fs } = createFs();
    await fs.writeWholeFile('/root/x/a.txt', encode('a'));
    await fs.writeWholeFile('/root/x/b.txt', encode('b'));
    await fs.writeWholeFile('/root/x/sub/c.txt', encode('c'));

    const listing = await fs.readDirectory('/root/x');
    expect(listing.map(e => e.name).sort()).toEqual(['a.txt', 'b.txt', 'sub']);
    await expect(fs.getDirectoryEntriesCount('/root/x')).resolves.toBe(3);
  });

  it('collectGarbage drops orphaned blobs but keeps live and open ones', async () => {
    const { fs, db } = createFs();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await fs.writeWholeFile('/root/a.txt', encode('one'));
    const orphan = db.entries.get('/root/a.txt')!.blobs[0].id;
    await fs.writeWholeFile('/root/a.txt', encode('two'));
    const live = db.entries.get('/root/a.txt')!.blobs[0].id;

    // A dirty open file's blobs exist only in its handle; GC must not eat them.
    await fs.openFile('/root/b.txt', false);
    await fs.writeFile('/root/b.txt', encode('keep'), 0);
    const open = fs.openedFiles.get('/root/b.txt')!.entry.blobs[0].id;

    await fs.collectGarbage();

    expect(db.blobs.has(orphan)).toBe(false);
    expect(db.blobs.has(live)).toBe(true);
    expect(db.blobs.has(open)).toBe(true);
  });
});
