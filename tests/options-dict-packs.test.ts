import { createRequire } from 'node:module';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// WXT owns the DOM shim used by its own Node-side tooling. Resolve from WXT's
// dependency context so pnpm's strict, non-hoisted layout works in clean clones.
const requireFromHere = createRequire(import.meta.url);
const requireFromWxt = createRequire(requireFromHere.resolve('wxt'));
const { parseHTML } = requireFromWxt('linkedom') as {
  parseHTML: (html: string) => { window: unknown };
};

const harness = vi.hoisted(() => ({
  getFs: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/lib/utils', async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  getFs: harness.getFs,
}));

vi.mock('@/lib/messaging', () => ({
  sendMessage: harness.sendMessage,
}));

vi.mock('@mui/material/styles', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useColorScheme: () => ({ mode: 'system', setMode: vi.fn() }),
}));

for (const name of [
  'FormControl', 'Snackbar', 'Box', 'Dialog', 'DialogTitle', 'DialogContent',
  'DialogContentText', 'DialogActions', 'Tooltip',
]) {
  vi.doMock(`@mui/material/${name}`, () => ({ default: 'div' }));
}
for (const name of ['IconButton', 'Button']) {
  vi.doMock(`@mui/material/${name}`, () => ({ default: 'button' }));
}
for (const name of ['Radio', 'Switch', 'TextField']) {
  vi.doMock(`@mui/material/${name}`, () => ({ default: 'input' }));
}
vi.mock('@mui/material/CircularProgress', () => ({ default: 'span' }));
vi.mock('@mui/material/MenuItem', () => ({ default: 'option' }));
vi.mock('@mui/material/Select', () => ({ default: 'select' }));
vi.mock('@mui/material/Divider', () => ({ default: 'hr' }));
vi.mock('@mui/material/Link', () => ({ default: 'a' }));

for (const name of [
  'Add', 'Remove', 'CloudDownload', 'CloudUpload', 'LightModeOutlined',
  'DarkModeOutlined', 'SettingsBrightnessOutlined', 'DeleteOutline',
]) {
  vi.doMock(`@mui/icons-material/${name}`, () => ({ default: 'span' }));
}

vi.mock('../entrypoints/options/theme', () => ({ default: {} }));
vi.mock('../entrypoints/options/utils/animation', () => ({ default: 'div' }));
vi.mock('../entrypoints/options/fileEditor', () => ({ default: 'button' }));
vi.mock('../entrypoints/options/rimeLogDisplay', () => ({ default: 'div' }));
vi.mock('../entrypoints/options/SegmentedPill', () => ({ SegmentedPill: () => null }));
vi.mock('../entrypoints/options/styles.module.less', () => ({ default: {} }));
vi.mock('../entrypoints/options/global.css', () => ({}));
vi.mock('@/lib/import-schema', () => ({
  detectSchemaInZip: vi.fn(),
  importSchemaFromZip: vi.fn(),
}));
vi.mock('@/lib/platform', () => ({ hasInputView: () => true }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function manifest(schema: string, id: string, name: string) {
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    packs: [{
      id,
      name,
      packName: id,
      baseDictionary: schema,
      entryCount: 1,
      compiledEntryCount: 1,
      rawEntryCount: 0,
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      source: 'user',
    }],
  }));
}

function manifestWithPacks(schema: string, packs: Array<{ id: string; name: string }>) {
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    packs: packs.map(({ id, name }) => ({
      id,
      name,
      packName: id,
      baseDictionary: schema,
      entryCount: 1,
      compiledEntryCount: 1,
      rawEntryCount: 0,
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      source: 'user',
    })),
  }));
}

function decodeManifest(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    version: number;
    packs: Array<{ id: string; packName: string; enabled: boolean }>;
  };
}

const dom = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
const browserWindow = dom.window as unknown as Window & typeof globalThis;
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  Node: browserWindow.Node,
  Element: browserWindow.Element,
  HTMLElement: browserWindow.HTMLElement,
  MutationObserver: browserWindow.MutationObserver,
  getComputedStyle: () => ({}),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.assign(browserWindow, {
  matchMedia: () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const storageChanged = { addListener: vi.fn(), removeListener: vi.fn() };
const runtimeMessages = { addListener: vi.fn(), removeListener: vi.fn() };
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: (key: string, substitutions?: string | string[]) =>
      substitutions ? `${key}:${Array.isArray(substitutions) ? substitutions.join(',') : substitutions}` : key,
  },
  runtime: {
    getManifest: () => ({ version: 'test' }),
    onMessage: runtimeMessages,
    lastError: null,
  },
  storage: {
    sync: {
      get: vi.fn(async () => ({
        settings: { schema: 'schema_b', pageSize: 5, algebraList: [] },
      })),
      set: vi.fn(async () => {}),
      onChanged: storageChanged,
    },
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
});
vi.stubGlobal('fetch', vi.fn(async () => ({
  text: async () => 'schemas: []',
})));

const OptionsPage = (await import('../entrypoints/options/App')).default;
let root: Root | null = null;

async function renderOptions() {
  const container = document.getElementById('root')!;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(OptionsPage));
  });
  return container;
}

async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
});

describe('dictionary pack schema load ordering', () => {
  it('keeps the selected schema packs when an old default-schema read finishes late', async () => {
    const oldReads = deferred<Uint8Array>();
    const fs = {
      readAll: vi.fn(async () => []),
      readEntryRaw: vi.fn(async () => ({})),
      readWholeFile: vi.fn((path: string) =>
        path.includes('/schema_b/') ? Promise.resolve(manifest('schema_b', 'pack_b', 'Pack B')) : oldReads.promise),
      writeWholeFile: vi.fn(async () => {}),
      delPath: vi.fn(async () => {}),
    };
    harness.getFs.mockResolvedValue(fs);
    harness.sendMessage.mockImplementation(async (name: string) =>
      name === 'GetEngineStatus'
        ? { loading: false, loaded: true, currentSchema: 'schema_b' }
        : undefined);

    const container = await renderOptions();
    await vi.waitFor(() => expect(container.textContent).toContain('Pack B'));

    oldReads.resolve(manifest('default', 'pack_a', 'Pack A'));
    await settle();

    expect(container.textContent).not.toContain('Pack A');
    expect(container.textContent).toContain('Pack B');
  });
});

describe('dictionary pack manifest mutation', () => {
  it('serializes overlapping removals so neither deleted pack is resurrected', async () => {
    let persisted = decodeManifest(manifestWithPacks('schema_b', [
      { id: 'pack_a', name: 'Pack A' },
      { id: 'pack_b', name: 'Pack B' },
    ]));
    let operationMode = false;
    let activeReads = 0;
    let maxConcurrentReads = 0;
    const deleted: string[] = [];
    const fs = {
      readAll: vi.fn(async () => []),
      readEntryRaw: vi.fn(async () => ({})),
      readWholeFile: vi.fn(async () => {
        const snapshot = new TextEncoder().encode(JSON.stringify(persisted));
        if (operationMode) {
          activeReads++;
          maxConcurrentReads = Math.max(maxConcurrentReads, activeReads);
          await new Promise(resolve => setTimeout(resolve, 0));
          activeReads--;
        }
        return snapshot;
      }),
      writeWholeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
        if (path.includes('dict-packs')) persisted = decodeManifest(bytes);
      }),
      delPath: vi.fn(async (path: string) => { deleted.push(path); }),
    };
    harness.getFs.mockResolvedValue(fs);
    harness.sendMessage.mockImplementation(async (name: string) =>
      name === 'GetEngineStatus'
        ? { loading: false, loaded: true, currentSchema: 'schema_b' }
        : undefined);

    const container = await renderOptions();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Pack A');
      expect(container.textContent).toContain('Pack B');
    });
    await settle();

    operationMode = true;
    const removeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="dict_pack_remove_button"]',
    ));
    expect(removeButtons).toHaveLength(2);
    await act(async () => {
      removeButtons[0].click();
      removeButtons[1].click();
    });
    await vi.waitFor(() => expect(
      harness.sendMessage.mock.calls.filter(([name]) => name === 'ReloadRime'),
    ).toHaveLength(2));
    await settle();

    expect(deleted.some(path => path.includes('pack_a'))).toBe(true);
    expect(deleted.some(path => path.includes('pack_b'))).toBe(true);
    expect(maxConcurrentReads).toBe(1);
    expect(persisted.packs).toHaveLength(0);
  });

  it('keeps the installed artifact consistent with its manifest when reload fails', async () => {
    let persisted = { version: 1, packs: [] as Array<{ id: string; packName: string; enabled: boolean }> };
    const deleted: string[] = [];
    const fs = {
      readAll: vi.fn(async () => []),
      readEntryRaw: vi.fn(async () => ({})),
      readWholeFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify(persisted))),
      writeWholeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
        if (path.includes('dict-packs')) persisted = decodeManifest(bytes);
      }),
      delPath: vi.fn(async (path: string) => { deleted.push(path); }),
    };
    harness.getFs.mockResolvedValue(fs);
    harness.sendMessage.mockImplementation(async (name: string) => {
      if (name === 'GetEngineStatus') {
        return { loading: false, loaded: true, currentSchema: 'schema_b' };
      }
      if (name === 'CompileDictPack') return { ok: true, warnings: [] };
      if (name === 'ReloadRime') throw new Error('worker restarted');
      return undefined;
    });

    const container = await renderOptions();
    const input = container.querySelector<HTMLInputElement>('#dict-pack-import-input')!;
    expect(input).toBeTruthy();
    const yaml = [
      '---',
      'name: Test Pack',
      'version: "1.0"',
      'sort: by_weight',
      '...',
      '词\tci\t1',
      '',
    ].join('\n');
    const bytes = new TextEncoder().encode(yaml);
    const file = {
      name: 'test-pack.dict.yaml',
      arrayBuffer: async () => bytes.buffer,
    };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new browserWindow.Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(harness.sendMessage).toHaveBeenCalledWith('ReloadRime'));
    await settle();

    expect(persisted.packs).toHaveLength(1);
    expect(persisted.packs[0].enabled).toBe(true);
    expect(deleted.some(path =>
      path.endsWith(`/build/${persisted.packs[0].packName}.table.bin`),
    )).toBe(false);
    expect(container.textContent).toContain('dict_pack_import_error');
  });
});
