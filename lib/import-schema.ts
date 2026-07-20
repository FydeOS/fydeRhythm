import JSZip from 'jszip';
import { parse } from 'yaml';

import type { FastIndexedDbFsController } from './fs';

const SCHEMA_CONFIG_SUFFIX = '.schema.yaml';

// Top-level dirs that already match the on-disk VFS layout. Files here are kept as-is.
const CANONICAL_DIRS = ['build', 'shared'] as const;

// Top-level dirs that get a "shared/" prefix prepended (e.g. "lua/foo.lua" -> "shared/lua/foo.lua").
const SHARED_PREFIX_DIRS = ['lua', 'opencc'] as const;

// Routing for files dropped loose at the archive root (or under an unknown wrapper dir).
const LOOSE_EXT_TO_DIR: Record<string, string> = {
  '.lua': 'shared/lua/',
  '.bin': 'build/',
  '.gram': 'shared/',
  '.json': 'shared/opencc/',
  '.ocd2': 'shared/opencc/',
  '.txt': 'shared/opencc/',
};

const KNOWN_TOP_DIRS = new Set<string>([...CANONICAL_DIRS, ...SHARED_PREFIX_DIRS]);

const MB = 1024 * 1024;

// Limits sized from measured CDN files: rime_ice.table.bin is 67 MB (the largest
// single file we ship); a rime_ice ZIP therefore reaches ~70 MB compressed since
// .bin files are already binary and compress poorly. 100 MB / 100 MB / 200 MB
// comfortably covers every current schema while keeping peak memory safe for a
// Chrome extension service worker (JSZip holds the full zip + one decompressed
// entry in RAM at the same time, so worst-case peak ≈ compressed + per-file cap).
// The per-file cap is checked against JSZip's declared uncompressed size BEFORE
// we allocate, so a crafted zip bomb never reaches the decompressor.
const MAX_COMPRESSED_BYTES = 100 * MB;
const MAX_UNCOMPRESSED_PER_FILE_BYTES = 100 * MB;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * MB;
const MAX_FILE_COUNT = 2_000;

export interface ImportResult {
  schemaId: string;
  schemaName: string;
  schemaDescription: string;
  fileCount: number;
}

export interface DetectedSchemaInfo {
  schemaId: string;
  schemaName: string;
  schemaDescription: string;
}

export interface ImportSchemaOptions {
  /** Receives import progress as a percentage in [0, 100]. */
  onProgress?: (percent: number) => void;
}

interface NormalizedEntry {
  entry: JSZip.JSZipObject;
  path: string;
}

interface LoadedSchemaZip extends DetectedSchemaInfo {
  normalized: NormalizedEntry[];
}

export async function detectSchemaInZip(zipFile: Blob): Promise<DetectedSchemaInfo> {
  const loaded = await loadSchemaZip(zipFile);
  return {
    schemaId: loaded.schemaId,
    schemaName: loaded.schemaName,
    schemaDescription: loaded.schemaDescription,
  };
}

/**
 * Imports a compiled-schema ZIP into the VFS at /root/{schemaId}/.
 *
 * Files are routed automatically by directory or extension, so users can hand us
 * a wrapped folder, a flat ZIP, or anything in between without thinking about layout.
 * If the import fails partway through, any files written under the new schema are
 * cleaned up so the VFS is left as we found it.
 */
export async function importSchemaFromZip(
  zipFile: Blob,
  fs: FastIndexedDbFsController,
  options: ImportSchemaOptions = {},
): Promise<ImportResult> {
  const report = (p: number) => options.onProgress?.(p);

  const loaded = await loadSchemaZip(zipFile, report);
  const { normalized, schemaId, schemaName, schemaDescription } = loaded;
  const schemaBase = `/root/${schemaId}`;

  if (await fs.readEntry(schemaBase)) {
    throw new Error(
      `Schema "${schemaId}" already exists. Remove it first before importing again.`,
    );
  }

  const planned = normalized.map(({ path, entry }) => ({
    entry,
    vfsPath: route(path, schemaId),
  }));

  const seen = new Set<string>();
  for (const { vfsPath } of planned) {
    if (seen.has(vfsPath)) {
      throw new Error(
        `ZIP contains duplicate files that map to the same destination: ${vfsPath}`,
      );
    }
    seen.add(vfsPath);
  }

  // Past this point we start writing — anything thrown must trigger cleanup.
  let createdAnything = false;
  try {
    report(20);
    let written = 0;
    let totalUncompressed = 0;
    for (const { entry, vfsPath } of planned) {
      const data = await readEntry(entry, vfsPath);
      totalUncompressed += data.byteLength;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(
          `ZIP expands to more than ${formatMB(MAX_TOTAL_UNCOMPRESSED_BYTES)} MB — refusing to import.`,
        );
      }
      await fs.writeWholeFile(`${schemaBase}/${vfsPath}`, data);
      createdAnything = true;
      written++;
      report(20 + (70 * written) / planned.length);
    }

    // librime's Lua plugin expects a per-schema entrypoint module; an empty
    // table is enough to satisfy the loader for schemas that just require()
    // individual modules.
    const hasLua = planned.some(({ vfsPath }) =>
      vfsPath.startsWith('shared/lua/') && vfsPath.endsWith('.lua'),
    );
    if (hasLua) {
      const init = `-- Auto-generated initialization file for ${schemaId}\n-- This file is required by librime's Lua plugin\nreturn {}\n`;
      await fs.writeWholeFile(
        `${schemaBase}/shared/${schemaId}.rime.lua`,
        new TextEncoder().encode(init),
      );
    }

    report(95);

    return {
      schemaId,
      schemaName,
      schemaDescription,
      fileCount: planned.length,
    };
  }
  catch (err) {
    if (createdAnything) {
      try {
        await fs.deleteDirectory(schemaBase);
        await fs.collectGarbage();
      }
      catch (cleanupErr) {
        console.error('Failed to clean up after import error:', cleanupErr);
      }
    }
    throw err;
  }
}

async function loadSchemaZip(
  zipFile: Blob,
  report: (percent: number) => void = () => { },
): Promise<LoadedSchemaZip> {
  if (zipFile.size > MAX_COMPRESSED_BYTES) {
    throw new Error(
      `ZIP is too large: ${formatMB(zipFile.size)} MB (max ${formatMB(MAX_COMPRESSED_BYTES)} MB).`,
    );
  }

  report(5);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  }
  catch (err) {
    throw new Error(
      `Could not read ZIP file: it may be corrupted or not a ZIP archive (${errorMessage(err)}).`,
    );
  }

  const rawEntries = Object.entries(zip.files).filter(([, e]) => !e.dir);
  if (rawEntries.length === 0) {
    throw new Error('ZIP is empty.');
  }
  if (rawEntries.length > MAX_FILE_COUNT) {
    throw new Error(
      `ZIP contains too many files: ${rawEntries.length} (max ${MAX_FILE_COUNT}).`,
    );
  }

  report(10);

  const normalized = rawEntries
    .map(([name, entry]) => ({ entry, path: stripWrapper(name) }))
    .filter(({ path }) => isRoutable(path));

  const schemaCandidates = normalized.filter(({ path }) =>
    basename(path).endsWith(SCHEMA_CONFIG_SUFFIX),
  );
  if (schemaCandidates.length === 0) {
    throw new Error(
      `Could not detect schema config. ZIP must contain exactly one ${SCHEMA_CONFIG_SUFFIX} file.`,
    );
  }
  if (schemaCandidates.length > 1) {
    throw new Error(
      'ZIP contains multiple schema YAML files. Please keep only one schema in the archive.',
    );
  }

  const schemaConfig = parse(
    new TextDecoder().decode(await readEntry(schemaCandidates[0].entry, schemaCandidates[0].path)),
  ) as { schema?: { schema_id?: string; name?: string; description?: string } } | null;

  const detectedId = schemaConfig?.schema?.schema_id;
  if (typeof detectedId !== 'string' || detectedId.trim() === '') {
    throw new Error('Invalid schema.yaml format: missing schema.schema_id');
  }
  const schemaId = detectedId.trim();

  return {
    normalized,
    schemaId,
    schemaName: schemaConfig?.schema?.name ?? '',
    schemaDescription: schemaConfig?.schema?.description ?? 'Imported from ZIP',
  };
}

// Read a ZIP entry into memory, translating JSZip's internal errors into
// actionable user-facing messages. Uses the entry's reported uncompressed
// size (when available) to reject zip bombs BEFORE allocating the buffer.
async function readEntry(entry: JSZip.JSZipObject, label: string): Promise<Uint8Array> {
  const declared = uncompressedSizeOf(entry);
  if (declared !== null && declared > MAX_UNCOMPRESSED_PER_FILE_BYTES) {
    throw new Error(
      `File "${label}" expands to ${formatMB(declared)} MB — exceeds ${formatMB(MAX_UNCOMPRESSED_PER_FILE_BYTES)} MB per-file limit.`,
    );
  }
  let data: Uint8Array;
  try {
    data = await entry.async('uint8array');
  }
  catch (err) {
    const msg = errorMessage(err);
    if (/encrypt/i.test(msg)) {
      throw new Error(`Password-protected ZIPs are not supported (file "${label}").`);
    }
    throw new Error(`Could not read "${label}" from ZIP: ${msg}`);
  }
  // Redundant guard for JSZip versions that don't expose uncompressedSize,
  // so a bomb still fails here rather than filling storage.
  if (data.byteLength > MAX_UNCOMPRESSED_PER_FILE_BYTES) {
    throw new Error(
      `File "${label}" decompressed to ${formatMB(data.byteLength)} MB — exceeds per-file limit.`,
    );
  }
  return data;
}

// JSZip stores the decoded header on a private _data field. We read it
// defensively — if a future version renames it, we just lose the pre-decompression
// guard but still catch oversize via the post-decompress check above.
function uncompressedSizeOf(entry: JSZip.JSZipObject): number | null {
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  return typeof size === 'number' ? size : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatMB(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function topDir(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? path : path.slice(0, i);
}

// Some package authors wrap everything in an outer directory like "my-pkg-1.0/".
// Peel off leading single-segment dirs that don't look like schema content,
// stopping as soon as we hit a known dir or something filename-shaped.
function stripWrapper(filename: string): string {
  let p = filename;
  while (p.includes('/')) {
    const head = topDir(p);
    if (!head || KNOWN_TOP_DIRS.has(head) || head.includes('.')) break;
    p = p.slice(head.length + 1);
  }
  return p;
}

function isRoutable(path: string): boolean {
  if (KNOWN_TOP_DIRS.has(topDir(path))) return true;
  const name = basename(path);
  if (name.endsWith(SCHEMA_CONFIG_SUFFIX)) return true;
  return Object.keys(LOOSE_EXT_TO_DIR).some(ext => name.endsWith(ext));
}

function route(path: string, schemaId: string): string {
  const name = basename(path);

  // Schema config always lands in build/, renamed to match schema_id so
  // librime can find it deterministically regardless of the source filename.
  if (name.endsWith(SCHEMA_CONFIG_SUFFIX)) {
    return `build/${schemaId}.schema.yaml`;
  }

  const head = topDir(path);
  if ((CANONICAL_DIRS as readonly string[]).includes(head)) {
    return path;
  }
  if ((SHARED_PREFIX_DIRS as readonly string[]).includes(head)) {
    return `shared/${path}`;
  }

  for (const [ext, dir] of Object.entries(LOOSE_EXT_TO_DIR)) {
    if (name.endsWith(ext)) return `${dir}${name}`;
  }

  return path;
}
