import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { Mutex } from 'async-mutex';
import { useEffect, useRef, useState } from 'react';

import {
  buildDictPackYaml,
  buildRawTableDb,
  decodeDictPackManifest,
  dictPackArtifactPath,
  type DictPackEntry,
  type DictPackManifest,
  type DictPackMetadata,
  dictPackRawTablePath,
  dictPacksManifestPath,
  type DictPackSource,
  encodeDictPackManifest,
  parseDictPackSourceBytes,
  summarizeDictPackWarnings,
} from '@/lib/dict-packs';
import { sendMessage } from '@/lib/messaging';
import { $$, getFs } from '@/lib/utils';

import styles from './styles.module.less';

interface DictionaryPacksProps {
  schemaId: string;
}

export function DictionaryPacks({ schemaId }: DictionaryPacksProps) {
  const [packs, setPacks] = useState<DictPackMetadata[]>([]);
  const [importing, setImporting] = useState(false);
  const [manifestMutex] = useState(() => new Mutex());
  const loadRequestId = useRef(0);
  const [alert, setAlert] = useState<{ severity: 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    void loadPacks(schemaId);
    // loadPacks deliberately reads the latest request id and state setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaId]);

  async function readManifest(targetSchemaId: string): Promise<DictPackManifest> {
    const fs = await getFs();
    const manifestPath = dictPacksManifestPath(targetSchemaId);
    if (await fs.readEntryRaw(manifestPath)) {
      try {
        return decodeDictPackManifest(await fs.readWholeFile(manifestPath));
      }
      catch {
        // Fall through to an empty manifest.
      }
    }
    return { version: 1, packs: [] };
  }

  async function writeManifest(targetSchemaId: string, manifest: DictPackManifest) {
    const fs = await getFs();
    await fs.writeWholeFile(dictPacksManifestPath(targetSchemaId), encodeDictPackManifest(manifest));
  }

  async function mutateManifest<T>(targetSchemaId: string, operation: () => Promise<T>): Promise<T> {
    // Web Locks coordinate separate Options tabs. The local mutex is also
    // required for test/non-browser environments without navigator.locks.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(
        `fyde-rhythm:dict-pack-manifest:${targetSchemaId}`,
        operation,
      );
    }
    return await manifestMutex.runExclusive(operation);
  }

  function publishMutatedPacks(nextPacks: DictPackMetadata[]) {
    // A manifest read that started before this mutation must not repaint
    // the UI with its stale snapshot when it eventually completes.
    loadRequestId.current++;
    setPacks(nextPacks);
  }

  async function loadPacks(targetSchemaId: string) {
    const requestId = ++loadRequestId.current;
    try {
      const manifest = await readManifest(targetSchemaId);
      if (requestId !== loadRequestId.current) return;
      setPacks(manifest.packs);
      setAlert(null);
    }
    catch (error) {
      if (requestId !== loadRequestId.current) return;
      setAlert({ severity: 'error', text: $$('dict_pack_import_error') + String(error) });
      setPacks([]);
    }
  }

  function warningLines(warnings: string[]): string[] {
    const { shown, hiddenCount } = summarizeDictPackWarnings(warnings);
    const lines = [...shown];
    if (hiddenCount > 0) {
      lines.push($$('dict_pack_more_warnings', String(hiddenCount)));
    }
    return lines;
  }

  function showFailure(prefix: string, warnings: string[]) {
    if (warnings.length > 0) {
      console.error('Dict pack import failed:', warnings);
    }
    setAlert({ severity: 'error', text: prefix + warningLines(warnings).join('\n') });
  }

  function showImportNotice(source: DictPackSource, warnings: string[]) {
    const lines: string[] = [];
    if ((source.duplicateCount ?? 0) > 0) {
      lines.push($$('dict_pack_duplicates_merged', String(source.duplicateCount)));
    }
    if (warnings.length > 0) {
      console.warn('Dict pack import warnings:', warnings);
      lines.push($$('dict_pack_import_warning_summary', String(warnings.length)));
      lines.push(...warningLines(warnings));
    }
    setAlert(lines.length > 0 ? { severity: 'warning', text: lines.join('\n') } : null);
  }

  async function importPack(file: File) {
    setAlert(null);
    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const manifest = await readManifest(schemaId);
      const existingPackNames = new Set(manifest.packs.map(pack => pack.packName));
      const existingDisplayNames = new Map(
        manifest.packs.map(pack => [pack.name.trim().normalize('NFC'), pack.packName]),
      );
      const source = await parseDictPackSourceBytes(
        file.name,
        bytes,
        existingPackNames,
        existingDisplayNames,
      );
      if (source.entryCount === 0) {
        setAlert({ severity: 'error', text: $$('dict_pack_empty') });
        return;
      }
      await installSource(source);
    }
    catch (error) {
      setAlert({ severity: 'error', text: $$('dict_pack_import_error') + String(error) });
    }
    finally {
      setImporting(false);
    }
  }

  async function cleanupSharedYaml(packName: string) {
    try {
      const fs = await getFs();
      await fs.delPath(`/root/${schemaId}/shared/${packName}.dict.yaml`);
    }
    catch {
      // File may not have been written.
    }
  }

  async function installSource(source: DictPackSource) {
    if (!source.entries || source.entries.length === 0) {
      const compileWarnings = await compileAndInstall(source.packName, source.dictYaml);
      if (compileWarnings === null) return;
      try {
        await upsertManifestEntry({
          packName: source.packName,
          displayName: source.displayName,
          entryCount: source.entryCount,
          compiledEntryCount: source.entryCount,
          rawEntryCount: 0,
        });
      }
      catch (error) {
        await deleteIfExists(dictPackArtifactPath(schemaId, source.packName));
        await cleanupSharedYaml(source.packName);
        throw error;
      }
      // The manifest and compiled artifact are now a consistent durable
      // install. A transient worker/reload failure must not delete either.
      await sendMessage('ReloadRime');
      showImportNotice(source, compileWarnings);
      return;
    }

    const classified = await sendMessage('ClassifyDictPackEntries', {
      schemaId,
      packName: source.packName,
      packDictYaml: source.dictYaml,
    });
    if (!classified.ok) {
      showFailure($$('dict_pack_compile_error'), classified.warnings);
      return;
    }

    const validKeys = new Set(classified.entries.map(entry => entryKey(entry.text, entry.code)));
    const compiledEntries = source.entries.filter(entry => validKeys.has(entryKey(entry.text, entry.code)));
    const rawEntries = source.entries.filter(entry => !validKeys.has(entryKey(entry.text, entry.code)));
    const rawTableName = rawEntries.length > 0 ? `${source.packName}_raw` : undefined;

    let compileWarnings: string[] = [];
    if (compiledEntries.length > 0) {
      const warnings = await compileAndInstall(
        source.packName,
        buildDictPackYaml(source.packName, compiledEntries),
      );
      if (warnings === null) return;
      compileWarnings = warnings;
    }
    else {
      await cleanupSharedYaml(source.packName);
    }

    try {
      if (rawEntries.length > 0 && rawTableName) {
        await installRawTable(rawTableName, rawEntries);
      }
      await upsertManifestEntry({
        packName: source.packName,
        displayName: source.displayName,
        entryCount: compiledEntries.length + rawEntries.length,
        compiledEntryCount: compiledEntries.length,
        rawEntryCount: rawEntries.length,
        rawTableName,
      });
    }
    catch (error) {
      if (compiledEntries.length > 0) {
        await deleteIfExists(dictPackArtifactPath(schemaId, source.packName));
        await cleanupSharedYaml(source.packName);
      }
      if (rawTableName) {
        await deleteIfExists(dictPackRawTablePath(schemaId, rawTableName));
      }
      throw error;
    }
    await sendMessage('ReloadRime');
    showImportNotice(source, [...classified.warnings, ...compileWarnings]);
  }

  async function compileAndInstall(packName: string, dictYaml: string): Promise<string[] | null> {
    let result;
    try {
      result = await sendMessage('CompileDictPack', {
        schemaId,
        packName,
        packDictYaml: dictYaml,
      });
    }
    catch (error) {
      await cleanupSharedYaml(packName);
      throw error;
    }
    if (!result.ok) {
      await cleanupSharedYaml(packName);
      showFailure($$('dict_pack_compile_error'), result.warnings);
      return null;
    }
    return result.warnings;
  }

  async function installRawTable(tableName: string, entries: DictPackEntry[]) {
    const fs = await getFs();
    await fs.writeWholeFile(
      dictPackRawTablePath(schemaId, tableName),
      buildRawTableDb(tableName, entries),
    );
  }

  async function upsertManifestEntry(request: {
    packName: string;
    displayName: string;
    entryCount: number;
    compiledEntryCount: number;
    rawEntryCount: number;
    rawTableName?: string;
  }) {
    await mutateManifest(schemaId, async () => {
      const manifest = await readManifest(schemaId);
      const now = Date.now();
      const existingIndex = manifest.packs.findIndex(pack => pack.packName === request.packName);
      const existing = existingIndex >= 0 ? manifest.packs[existingIndex] : undefined;
      const entry: DictPackMetadata = {
        id: request.packName,
        name: request.displayName,
        packName: request.packName,
        baseDictionary: schemaId,
        entryCount: request.entryCount,
        compiledEntryCount: request.compiledEntryCount,
        rawEntryCount: request.rawEntryCount,
        rawTableName: request.rawTableName,
        enabled: true,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        source: 'user',
      };
      const nextPacks = existingIndex >= 0
        ? manifest.packs.map((pack, index) => index === existingIndex ? entry : pack)
        : [...manifest.packs, entry];
      const nextManifest: DictPackManifest = { version: 1, packs: nextPacks };
      await writeManifest(schemaId, nextManifest);
      publishMutatedPacks(nextManifest.packs);

      if (existing?.rawTableName && existing.rawTableName !== request.rawTableName) {
        await deleteIfExists(dictPackRawTablePath(schemaId, existing.rawTableName));
      }
      if (existing && request.compiledEntryCount === 0
        && (existing.compiledEntryCount ?? existing.entryCount) > 0) {
        await deleteIfExists(dictPackArtifactPath(schemaId, existing.packName));
        await cleanupSharedYaml(existing.packName);
      }
    });
  }

  async function deleteIfExists(path: string) {
    try {
      const fs = await getFs();
      await fs.delPath(path);
    }
    catch {
      // File may not exist.
    }
  }

  function entryKey(text: string, code: string): string {
    return `${text}\t${code.trim()}`;
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setAlert(null);
    try {
      await mutateManifest(schemaId, async () => {
        const manifest = await readManifest(schemaId);
        const nextManifest: DictPackManifest = {
          version: 1,
          packs: manifest.packs.map(pack =>
            pack.id === id ? { ...pack, enabled, updatedAt: Date.now() } : pack),
        };
        await writeManifest(schemaId, nextManifest);
        publishMutatedPacks(nextManifest.packs);
      });
      await sendMessage('ReloadRime');
    }
    catch (error) {
      setAlert({ severity: 'error', text: $$('dict_pack_import_error') + String(error) });
    }
  }

  async function removePack(id: string) {
    setAlert(null);
    try {
      await mutateManifest(schemaId, async () => {
        const manifest = await readManifest(schemaId);
        const pack = manifest.packs.find(candidate => candidate.id === id);
        const nextManifest: DictPackManifest = {
          version: 1,
          packs: manifest.packs.filter(candidate => candidate.id !== id),
        };
        await writeManifest(schemaId, nextManifest);
        publishMutatedPacks(nextManifest.packs);
        if (pack) {
          await deleteIfExists(dictPackArtifactPath(schemaId, pack.packName));
          await deleteIfExists(`/root/${schemaId}/shared/${pack.packName}.dict.yaml`);
          if (pack.rawTableName) {
            await deleteIfExists(dictPackRawTablePath(schemaId, pack.rawTableName));
          }
        }
      });
      await sendMessage('ReloadRime');
    }
    catch (error) {
      setAlert({ severity: 'error', text: $$('dict_pack_import_error') + String(error) });
    }
  }

  const activeEntryCount = packs
    .filter(pack => pack.enabled)
    .reduce((sum, pack) => sum + pack.entryCount, 0);

  return (
    <div className={styles.formGroup}>
      <div className={styles.formBox}>
        <FormControl className={styles.formControl}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
            <h2 className={styles.formLabel} style={{ marginBottom: 0 }}>{$$('dict_pack_section_title')}</h2>
            {packs.length > 0 ? (
              <Box sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                {$$('dict_pack_active_entry_count', String(activeEntryCount))}
              </Box>
            ) : null}
          </Box>
          <Box sx={{ fontSize: '0.875rem', color: 'text.secondary', lineHeight: 1.45, mb: 2 }}>
            {$$('dict_pack_hint')}
          </Box>
          {packs.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {packs.map(pack => (
                <Box
                  key={pack.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: pack.enabled ? 'rgba(228, 0, 70, 0.18)' : 'divider',
                    bgcolor: pack.enabled ? 'rgba(228, 0, 70, 0.02)' : 'transparent',
                    transition: 'background-color 0.15s, border-color 0.15s',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ fontSize: '0.9375rem', fontWeight: pack.enabled ? 500 : 400, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pack.name}
                    </Box>
                    <Box sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.25 }}>
                      {$$('dict_pack_entry_count', String(pack.entryCount))}
                    </Box>
                  </Box>
                  <Switch
                    size="small"
                    checked={pack.enabled}
                    onChange={(_, checked) => toggleEnabled(pack.id, checked)}
                    disabled={importing}
                    inputProps={{ 'aria-label': pack.enabled ? $$('dict_pack_enabled') : $$('dict_pack_disabled') }}
                  />
                  <Tooltip title={$$('dict_pack_remove_button')}>
                    <span>
                      <IconButton
                        aria-label={$$('dict_pack_remove_button')}
                        onClick={() => removePack(pack.id)}
                        disabled={importing}
                        color="error"
                        size="small"
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Box>
          ) : (
            <Box
              sx={{
                mb: 2,
                px: 2,
                py: 2,
                borderRadius: '12px',
                border: '1px dashed',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                fontSize: '0.875rem',
                color: 'text.secondary',
              }}
            >
              <CloudUploadIcon fontSize="small" />
              {$$('dict_pack_empty_list')}
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <input
              type="file"
              accept=".txt,.tsv,.yaml,.dict.yaml,.scel,.qcel,.qpyd,.bdict,.bcd"
              id="dict-pack-import-input"
              style={{ display: 'none' }}
              onChange={async (event) => {
                if (event.target.files?.[0]) {
                  await importPack(event.target.files[0]);
                  event.target.value = '';
                }
              }}
            />
            <Button
              variant={packs.length > 0 ? 'outlined' : 'contained'}
              startIcon={importing ? <CircularProgress size={16} /> : <CloudUploadIcon />}
              onClick={() => document.getElementById('dict-pack-import-input')?.click()}
              disabled={importing}
              size="small"
            >
              {importing ? $$('dict_pack_compiling') : $$('dict_pack_import_button')}
            </Button>
          </Box>
          {alert ? (
            <Box
              role="alert"
              sx={{
                color: alert.severity === 'error' ? 'error.main' : 'warning.main',
                fontSize: '0.85rem',
                mt: 1.5,
                whiteSpace: 'pre-line',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {alert.text}
            </Box>
          ) : null}
        </FormControl>
      </div>
    </div>
  );
}
