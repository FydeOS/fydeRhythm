import { getInstalledSchemaIds } from '@/lib/schema-install';
import { getFs } from '@/lib/utils';

interface SchemaMetadata {
  id: string;
  name?: string;
}

export interface EnabledSchemaEntry {
  id: string;
  label: string;
}

// Returns enabled+installed schemas in catalog order, followed by uncatalogued installed dirs.
// The active schema is always implicitly included so it cannot disappear from the menu/cycle.
export async function listEnabledInstalledSchemas(
  activeSchema: string,
  enabledSchemas?: string[],
): Promise<EnabledSchemaEntry[]> {
  const fs = await getFs();
  const entries = await fs.readAll();
  const installed = new Set<string>(getInstalledSchemaIds(entries));

  // Legacy (undefined) = all installed are enabled. Active schema is always implicitly enabled.
  const enabledSet = enabledSchemas
    ? new Set<string>([...enabledSchemas, activeSchema])
    : null;
  const isEnabled = (id: string) => enabledSet === null || enabledSet.has(id);

  const stored = await chrome.storage.local.get(['schemaList']) as { schemaList?: { schemas?: SchemaMetadata[] } };
  const catalog: SchemaMetadata[] = stored.schemaList?.schemas ?? [];
  const byId = new Map<string, SchemaMetadata>();
  for (const s of catalog) byId.set(s.id, s);

  const result: EnabledSchemaEntry[] = [];
  for (const s of catalog) {
    if (installed.has(s.id) && isEnabled(s.id)) {
      result.push({ id: s.id, label: s.name || s.id });
    }
  }
  // Synthesize entries for directories not in the cached catalog (e.g. ZIP import)
  for (const id of installed) {
    if (!byId.has(id) && isEnabled(id)) {
      result.push({ id, label: id });
    }
  }
  return result;
}
