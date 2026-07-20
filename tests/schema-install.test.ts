import { describe, expect, it } from 'vitest';

import type { Entry } from '../lib/fs';
import { getInstalledSchemaIds, resolveInstalledSchemaId } from '../lib/schema-install';

function entry(fullPath: string, isDirectory = false): Entry {
  return {
    isDirectory,
    mtime: 0,
    mode: 0o777,
    blobs: [],
    parent: null,
    fullPath,
  };
}

describe('schema install detection', () => {
  it('detects only completed v3 schema installs', () => {
    expect(getInstalledSchemaIds([
      entry('/root/aurora/build/aurora.schema.yaml'),
      entry('/root/build/luna.schema.yaml'),
      entry('/root/partial/build', true),
      entry('/root/mismatch/build/other.schema.yaml'),
      entry('/not-root/demo/build/demo.schema.yaml'),
    ])).toEqual(['aurora']);
  });

  it('keeps the preferred schema when it is installed', () => {
    const entries = [
      entry('/root/aurora/build/aurora.schema.yaml'),
      entry('/root/luna/build/luna.schema.yaml'),
    ];

    expect(resolveInstalledSchemaId(entries, 'luna')).toBe('luna');
  });

  it('falls back to an enabled installed schema before any installed schema', () => {
    const entries = [
      entry('/root/aurora/build/aurora.schema.yaml'),
      entry('/root/luna/build/luna.schema.yaml'),
    ];

    expect(resolveInstalledSchemaId(entries, 'stale', ['luna'])).toBe('luna');
  });

  it('returns null when only legacy flat-layout files exist', () => {
    expect(resolveInstalledSchemaId([
      entry('/root/build/aurora.schema.yaml'),
      entry('/root/build/aurora.table.bin'),
    ], 'aurora')).toBeNull();
  });
});
