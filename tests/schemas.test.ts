import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entry } from '../lib/fs';

const mocks = vi.hoisted(() => ({
  entries: [] as Entry[],
  getFs: vi.fn(async () => ({
    readAll: async () => mocks.entries,
  })),
}));

vi.mock('@/lib/utils', () => ({
  getFs: mocks.getFs,
}));

const { listEnabledInstalledSchemas } = await import('../entrypoints/background/schemas');

function directory(path: string): Entry {
  return {
    isDirectory: true,
    mtime: 0,
    mode: 0o777,
    blobs: [],
    parent: null,
    fullPath: path,
  };
}

function file(path: string): Entry {
  return {
    ...directory(path),
    isDirectory: false,
  };
}

function installedSchema(id: string): Entry[] {
  return [
    directory(`/root/${id}`),
    directory(`/root/${id}/build`),
    file(`/root/${id}/build/${id}.schema.yaml`),
  ];
}

function stubSchemaCatalog(schemas: Array<{ id: string; name?: string }> = []) {
  const get = vi.fn(async () => ({ schemaList: { schemas } }));
  vi.stubGlobal('chrome', {
    storage: {
      local: { get },
    },
  });
  return get;
}

describe('enabled installed schemas', () => {
  beforeEach(() => {
    mocks.entries = [];
    mocks.getFs.mockClear();
    stubSchemaCatalog();
  });

  it('lists installed schemas in catalog order with catalog labels', async () => {
    mocks.entries = [
      ...installedSchema('luna'),
      ...installedSchema('aurora'),
      directory('/root'),
      file('/root/not-a-schema/file.txt'),
    ];
    stubSchemaCatalog([
      { id: 'aurora', name: 'Aurora Pinyin' },
      { id: 'luna', name: 'Luna Pinyin' },
    ]);

    await expect(listEnabledInstalledSchemas('aurora')).resolves.toEqual([
      { id: 'aurora', label: 'Aurora Pinyin' },
      { id: 'luna', label: 'Luna Pinyin' },
    ]);
  });

  it('synthesizes labels for installed schemas missing from the catalog', async () => {
    mocks.entries = [
      ...installedSchema('catalogued'),
      ...installedSchema('imported_zip'),
    ];
    stubSchemaCatalog([{ id: 'catalogued', name: 'Catalogued Schema' }]);

    await expect(listEnabledInstalledSchemas('catalogued')).resolves.toEqual([
      { id: 'catalogued', label: 'Catalogued Schema' },
      { id: 'imported_zip', label: 'imported_zip' },
    ]);
  });

  it('filters to enabled schemas while always including the active schema', async () => {
    mocks.entries = [
      ...installedSchema('active'),
      ...installedSchema('enabled'),
      ...installedSchema('disabled'),
    ];
    stubSchemaCatalog([
      { id: 'active', name: 'Active' },
      { id: 'enabled', name: 'Enabled' },
      { id: 'disabled', name: 'Disabled' },
    ]);

    await expect(listEnabledInstalledSchemas('active', ['enabled'])).resolves.toEqual([
      { id: 'active', label: 'Active' },
      { id: 'enabled', label: 'Enabled' },
    ]);
  });

  it('ignores non-schema entries under /root and enabled schemas that are not installed', async () => {
    mocks.entries = [
      ...installedSchema('installed'),
      file('/root/file.schema.yaml'),
      directory('/not-root/other'),
      directory('/not-root/other/build'),
      file('/not-root/other/build/other.schema.yaml'),
    ];
    stubSchemaCatalog([
      { id: 'installed', name: 'Installed' },
      { id: 'missing', name: 'Missing' },
    ]);

    await expect(listEnabledInstalledSchemas('installed', ['installed', 'missing'])).resolves.toEqual([
      { id: 'installed', label: 'Installed' },
    ]);
  });

  it('returns all installed schemas when enabledSchemas is undefined (legacy mode)', async () => {
    mocks.entries = [
      ...installedSchema('aurora'),
      ...installedSchema('luna'),
      ...installedSchema('rime_ice'),
    ];
    stubSchemaCatalog([
      { id: 'aurora', name: 'Aurora' },
      { id: 'luna', name: 'Luna' },
      { id: 'rime_ice', name: 'Rime Ice' },
    ]);

    // No enabledSchemas argument — all installed schemas must be returned.
    await expect(listEnabledInstalledSchemas('aurora')).resolves.toEqual([
      { id: 'aurora', label: 'Aurora' },
      { id: 'luna', label: 'Luna' },
      { id: 'rime_ice', label: 'Rime Ice' },
    ]);
  });

  it('uses the schema id as label when the catalog entry has no name', async () => {
    mocks.entries = installedSchema('noname');
    stubSchemaCatalog([{ id: 'noname' }]);

    await expect(listEnabledInstalledSchemas('noname')).resolves.toEqual([
      { id: 'noname', label: 'noname' },
    ]);
  });

  it('ignores legacy v2 top-level directories left over after upgrading', async () => {
    // v2 stored a single Rime tree at /root/{build,shared,user}. After an
    // in-place upgrade to v3 those dirs would otherwise surface as ghost
    // schemas named "build", "shared", "user".
    mocks.entries = [
      directory('/root/build'),
      file('/root/build/luna.schema.yaml'),
      directory('/root/shared'),
      directory('/root/user'),
      ...installedSchema('luna'),
    ];
    stubSchemaCatalog([
      { id: 'luna', name: 'Luna' },
    ]);

    await expect(listEnabledInstalledSchemas('luna')).resolves.toEqual([
      { id: 'luna', label: 'Luna' },
    ]);
  });

  it('returns uncatalogued installed schemas when schemaList is absent from storage', async () => {
    mocks.entries = installedSchema('imported');
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({})) },
      },
    });

    await expect(listEnabledInstalledSchemas('imported')).resolves.toEqual([
      { id: 'imported', label: 'imported' },
    ]);
  });

  it('ignores v3 schema directories until their schema YAML marker exists', async () => {
    mocks.entries = [
      directory('/root/partial'),
      directory('/root/partial/build'),
    ];
    stubSchemaCatalog([{ id: 'partial', name: 'Partial' }]);

    await expect(listEnabledInstalledSchemas('partial')).resolves.toEqual([]);
  });
});
