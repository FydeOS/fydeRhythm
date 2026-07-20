import type { Entry } from './fs';

type FsEntryLike = Pick<Entry, 'fullPath' | 'isDirectory'>;

const INSTALLED_SCHEMA_FILE_RE = /^\/root\/([^/]+)\/build\/([^/]+)\.schema\.yaml$/;

export function getInstalledSchemaIds(entries: FsEntryLike[]): string[] {
  const installed = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const match = entry.fullPath.match(INSTALLED_SCHEMA_FILE_RE);
    if (!match) continue;

    const [, dirId, fileId] = match;
    if (dirId === fileId) {
      installed.add(dirId);
    }
  }

  return [...installed];
}

export function resolveInstalledSchemaId(
  entries: FsEntryLike[],
  preferredSchemaId: string,
  enabledSchemaIds?: string[],
): string | null {
  const installed = getInstalledSchemaIds(entries);
  if (installed.includes(preferredSchemaId)) {
    return preferredSchemaId;
  }

  if (enabledSchemaIds) {
    const enabled = new Set(enabledSchemaIds);
    const enabledInstalled = installed.find(schemaId => enabled.has(schemaId));
    if (enabledInstalled) {
      return enabledInstalled;
    }
  }

  return installed[0] ?? null;
}
