import './global.css';

import AddIcon from '@mui/icons-material/Add';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Snackbar from '@mui/material/Snackbar';
import { ThemeProvider, useColorScheme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import _ from 'lodash';
import React, { useEffect, useRef, useState } from 'react';
import { parse } from 'yaml';

import { detectSchemaInZip, importSchemaFromZip } from '@/lib/import-schema';
import { sendMessage } from '@/lib/messaging';
import { hasInputView } from '@/lib/platform';
import { getInstalledSchemaIds } from '@/lib/schema-install';
import { kLatinLayoutIds, type LatinLayoutId, type LayoutId } from '@/lib/shared-types';
import { $$, formatSchemaSwitchKey, getFs, type ImeSettings, interpretRecordingKey, kDefaultSettings, migrateLayoutSettings, resolveKeyboardLayout, resolveSchemaKeys, type SchemaKeys, type SchemaSwitchKey } from '@/lib/utils';

import { DictionaryPacks } from './DictionaryPacks';
import FileEditorButton from './fileEditor';
import RimeLogDisplay from './rimeLogDisplay';
import { installRemoteSchema } from './schema-installer';
import type { SchemaDescription, SchemaListFile } from './schema-types';
import { SchemaSection } from './SchemaSection';
import { SegmentedPill } from './SegmentedPill';
import styles from './styles.module.less';
import theme from './theme';
import Animation from './utils/animation';
import { VoiceSection } from './VoiceSection';

const kFuzzyMap = [
  {
    value: 'derive/^([zcs])h/$1/',
    label: 'zh, ch, sh => z, c, s',
  },
  {
    value: 'derive/^([zcs])([^h])/$1h$2/',
    label: 'z, c, s => zh, ch, sh',
  },
  {
    value: 'derive/^n/l/',
    label: 'n => l',
  },
  {
    value: 'derive/^l/n/',
    label: 'l => n',
  },
  {
    value: 'derive/([ei])n$/$1ng/',
    label: 'en => eng, in => ing',
  },
  {
    value: 'derive/([ei])ng$/$1n/',
    label: 'eng => en, ing => in',
  },
];

interface ConverterResponse {
  status: string;
  message?: string;
  schema_id: string;
  repo: string;
}

const kRepoUrl = 'https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm';
const kConventerUrl = 'https://rime-conf-translator.fydeos.io';

// Light / System / Dark pill in the top-right corner. Persistence and the
// <html> class are handled by MUI's useColorScheme, so it renders inside the
// ThemeProvider. Supports click, keyboard, and drag/swipe.
function AppearanceToggle() {
  const { mode, setMode } = useColorScheme();
  const current = mode ?? 'system';
  // System sits at the edge: light↔dark form a natural continuum, and a
  // "follow system" wedged between them breaks it.
  const options = [
    { value: 'system' as const, label: $$('theme_system'), content: <SettingsBrightnessIcon sx={{ fontSize: 18 }} /> },
    { value: 'light' as const, label: $$('theme_light'), content: <LightModeIcon sx={{ fontSize: 18 }} /> },
    { value: 'dark' as const, label: $$('theme_dark'), content: <DarkModeIcon sx={{ fontSize: 18 }} /> },
  ];

  return (
    <Box sx={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
      <SegmentedPill
        options={options}
        value={current}
        onChange={setMode}
        ariaLabel={$$('appearance')}
        tooltips
      />
    </Box>
  );
}

function OptionsPage() {
  const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: '' as string });
  // Status notifications can arrive in a burst around a reload. Only the
  // newest request may update the badge; otherwise a slow, stale "Starting"
  // response can overwrite the terminal "Ready" response.
  const engineStatusRequestId = useRef(0);
  const [imeSettings, setImeSettings] = useState<ImeSettings>(kDefaultSettings);
  // Present only in a build made with FYDE_ASR_KEY, and only where the keyboard
  // exists to host the button.
  const voiceConfigured = Boolean(import.meta.env.FYDE_ASR_KEY)
    && Boolean(chrome.runtime.getManifest().input_components?.[0]?.input_view);
  enum SettingsDirtyStatus {
    NotDirty = 0,
    Dirty = 1,
    Reloading = 2,
  }
  // Settings dirty = 0: not dirty, = 1: dirty, = 2: reloading
  const [settingsDirty, setSettingsDirty] = useState(SettingsDirtyStatus.NotDirty);

  // Schema-switch shortcut capture state.
  const [recordingSwitchKey, setRecordingSwitchKey] = useState(false);
  const [switchKeyError, setSwitchKeyError] = useState<string | null>(null);
  const recordButtonRef = useRef<HTMLButtonElement | null>(null);

  const [schemaList, setSchemaList] = useState<SchemaListFile>({ schemas: [] });
  const [fetchingList, setFetchingList] = useState<boolean>(false);
  // Errors are surfaced next to the UI they originate from: the schema list,
  // the personal-repo form, and the ZIP import row each have their own slot.
  const [fetchListError, setFetchListError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const repoUrlInputRef = useRef<HTMLInputElement | null>(null);
  const repoSchemaIdInputRef = useRef<HTMLInputElement | null>(null);

  const [importPredefinedCandidate, setImportPredefinedCandidate] = useState<string | null>(null);
  const [importPredefinedDialogOpen, setImportPredefinedDialogOpen] = useState(false);

  const [localSchemaList, setLocalSchemaList] = useState<string[]>([]);

  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSchemaId, setDownloadSchemaId] = useState<string | null>(null);

  const [personalRepoURL, setPersonalRepoURL] = useState<string | null>(null);
  const [personalRepoSchemaId, setPersonalRepoSchemaId] = useState<string | null>(null);

  // Each confirm dialog keeps its data in a separate state from its `open`
  // flag: clearing the data on close would empty the dialog while the fade-out
  // is still playing, visibly shrinking it. Data is cleared in onExited.
  const [removeCandidate, setRemoveCandidate] = useState<SchemaDescription | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const fydeosUserDefinedSchema = 'fydeosUserDefinedSchema';

  // chrome.storage.local.get

  async function updateRimeStatus() {
    const requestId = ++engineStatusRequestId.current;
    try {
      const result = await sendMessage('GetEngineStatus');
      if (requestId === engineStatusRequestId.current) {
        setEngineStatus(result);
      }
    }
    catch (ex) {
      console.error('Error while refreshing RIME status', ex);
    }
  }

  async function loadSettings() {
    const obj = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    if (obj.settings) {
      setImeSettings(migrateLayoutSettings(obj.settings));
      setSettingsDirty(SettingsDirtyStatus.NotDirty);
    }
  }

  async function loadLocalSchemaList(): Promise<string[]> {
    const fs = await getFs();
    const content = await fs.readAll();
    const list = getInstalledSchemaIds(content);
    setLocalSchemaList(list);
    console.log('Local schema list:', list);
    return list;
  }

  async function loadSchemaList() {
    const { schemaList: storedSchemaList } = await chrome.storage.local.get(['schemaList']) as { schemaList?: SchemaListFile };
    console.log('loadSchemaList:', storedSchemaList);
    // Stale-while-revalidate: the cached copy (already merged with the
    // self-defined schemas when it was written) renders immediately, so
    // the page never waits on — or requires — the network round-trip.
    const cached = storedSchemaList?.schemas?.length ? storedSchemaList : null;
    if (cached) {
      setSchemaList(cached);
    }
    setFetchingList(true);
    let newData: SchemaListFile;
    try {
      const text = await fetch(`${kRepoUrl}/schema-list.yaml`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
      }).then(x => x.text());
      newData = parse(text) as SchemaListFile;
    }
    catch (error) {
      // A failed refresh with a usable cached list is not worth an
      // error banner; only a first run with nothing to show is.
      if (cached) {
        console.warn('Schema list refresh failed; keeping cached copy:', error);
      }
      else {
        setFetchListError($$('error_fetch_schema_list') + String(error));
      }
      return;
    }
    finally {
      setFetchingList(false);
    }
    console.log('fetch', newData);
    const selfDefinedSchema = await getSelfDefinedSchemaList();
    newData.schemas = mergeSchemaList(newData.schemas, selfDefinedSchema);
    console.log(newData);
    setSchemaList(newData);
    await chrome.storage.local.set({ schemaList: newData });
  }

  function mergeSchemaList(predefinedSchemas: SchemaDescription[], selfDefinedSchemas: SchemaDescription[]) {
    const seen = new Set(predefinedSchemas.map(schema => schema.id));
    const uniqueSelfDefinedSchemas = selfDefinedSchemas.filter((schema) => {
      if (seen.has(schema.id)) {
        return false;
      }
      seen.add(schema.id);
      return true;
    });
    return predefinedSchemas.concat(uniqueSelfDefinedSchemas);
  }

  function getPredefinedSchema(id: string): SchemaDescription | null {
    return schemaList.schemas.find(schema => schema.id === id && !schema.user) ?? null;
  }

  useEffect(() => {
    // update RIME status upon loading
    void updateRimeStatus();
    void loadSettings();
    void loadSchemaList();
    void loadLocalSchemaList();

    const listener = (m: { rimeStatusChanged?: boolean }) => {
      if (m.rimeStatusChanged) {
        void updateRimeStatus();
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    const settingsChangeListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.settings) {
        setImeSettings(changes.settings.newValue as ImeSettings);
      }
    };
    chrome.storage.sync.onChanged.addListener(settingsChangeListener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.sync.onChanged.removeListener(settingsChangeListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settingsDirty == SettingsDirtyStatus.NotDirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsDirty]);

  async function loadRime() {
    await chrome.storage.sync.set({ settings: imeSettings });
    if (!engineStatus.loading) {
      setSettingsDirty(SettingsDirtyStatus.Reloading);
      try {
        await sendMessage('ReloadRime');
      }
      catch (ex) {
        console.error('Error while reloading RIME', ex);
      }
      finally {
        // A dead/restarting service worker can reject the message.
        // Reloading is transient UI state and must not survive either
        // success or failure of that request.
        setSettingsDirty(SettingsDirtyStatus.NotDirty);
        void updateRimeStatus();
      }
    }
  }

  function changeSettings(change: any) {
    console.log('Change:', change);
    // Functional update: long-lived callbacks (the shortcut-recording listener,
    // beforeunload) call this from closures armed on an earlier render; merging
    // onto prev instead of the captured imeSettings snapshot keeps them from
    // reverting settings that changed in the meantime (e.g. via storage sync).
    setSettingsDirty(SettingsDirtyStatus.Dirty);
    setImeSettings(prev => Object.assign({}, prev, change));
  }

  // Stop recording (if armed), clear any validation error, and write the new
  // shortcut value — shared by the recorder and the Disable/Reset buttons.
  function stopRecordingAndSetSwitchKey(value: SchemaSwitchKey | null | undefined) {
    setRecordingSwitchKey(false);
    setSwitchKeyError(null);
    changeSettings({ schemaSwitchKey: value });
  }

  // While recording, capture the next non-modifier keystroke as the new
  // schema-switch shortcut (see interpretRecordingKey for the decision table).
  // Recording must never get stuck armed: it also cancels when the user clicks
  // anywhere outside the record button or the window loses focus, and the
  // record button itself toggles recording off (handled via the ref check —
  // pointerdown inside the button is ignored here so onClick can toggle).
  useEffect(() => {
    if (!recordingSwitchKey) return;
    const cancelRecording = () => {
      setRecordingSwitchKey(false);
      setSwitchKeyError(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const result = interpretRecordingKey(e);
      if (result.kind === 'cancel') {
        cancelRecording();
      }
      else if (result.kind === 'invalid') {
        setSwitchKeyError($$('schema_switch_key_invalid'));
      }
      else if (result.kind === 'accept') {
        stopRecordingAndSetSwitchKey(result.binding);
      } // 'pending': keep waiting for the final key
    };
    const onPointerDown = (e: PointerEvent) => {
      // Clicks on the record button are handled by its onClick toggle.
      if (recordButtonRef.current?.contains(e.target as Node)) return;
      cancelRecording();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', cancelRecording);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', cancelRecording);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingSwitchKey]);

  // Single source of truth for the shortcut row's display state:
  // "" means no binding is in effect (disabled or a defensive empty-code value).
  const switchKeyLabel = formatSchemaSwitchKey(imeSettings.schemaSwitchKey);

  function changeFuzzy(chk: boolean, val: string) {
    if (chk) {
      changeSettings({ algebraList: _.uniq([...imeSettings.algebraList, val]) });
    }
    else {
      changeSettings({ algebraList: imeSettings.algebraList.filter(a => a != val) });
    }
  }

  // Legacy (undefined) = all downloaded schemas are enabled.
  // Active schema is always implicitly enabled regardless of the list.
  function isSchemaEnabled(id: string): boolean {
    if (id === imeSettings.schema) return true;
    if (!imeSettings.enabledSchemas) return true;
    return imeSettings.enabledSchemas.includes(id);
  }

  function toggleSchemaEnabled(id: string, enabled: boolean) {
    // Materialize the list from current local schemas on first toggle-off.
    const base = imeSettings.enabledSchemas ?? localSchemaList.slice();
    const next = enabled
      ? _.uniq([...base, id])
      : base.filter(x => x !== id);
    changeSettings({ enabledSchemas: next });
  }

  const layoutNames: Record<LayoutId, string> = {
    qwerty: 'QWERTY',
    colemak: 'Colemak',
    dvorak: 'Dvorak',
    zhuyin: $$('layout_zhuyin'),
    kana: $$('layout_kana'),
    hangul: $$('layout_hangul'),
  };
  const schemaKeysNames: Record<SchemaKeys, string> = {
    latin: $$('layout_letters'),
    zhuyin: layoutNames.zhuyin,
    kana: layoutNames.kana,
    hangul: layoutNames.hangul,
  };

  const showsInputView = hasInputView();

  const arrangement = resolveKeyboardLayout(imeSettings);
  const activeSchemaName = currentSchemaInfo()?.name;
  const activeScript = resolveSchemaKeys(imeSettings, imeSettings.schema, activeSchemaName);

  function setSchemaKeys(id: string, keys: SchemaKeys) {
    changeSettings({ schemaKeys: { ...(imeSettings.schemaKeys ?? {}), [id]: keys } });
  }

  // Called at the end of each install path (download / convert / import).
  // Auto-enables the new schema only if the user has already opted into explicit enable lists.
  function setActiveSchemaOnInstall(id: string) {
    const nextEnabled = imeSettings.enabledSchemas
      ? _.uniq([...imeSettings.enabledSchemas, id])
      : undefined;
    changeSettings({ schema: id, ...(nextEnabled ? { enabledSchemas: nextEnabled } : {}) });
  }

  let engineStatusString: string = $$('rime_engine_not_started');
  let engineColor = 'error.main';
  if (engineStatus.loading) {
    engineStatusString = $$('rime_engine_starting');
    engineColor = 'warning.main';
  }
  else if (engineStatus.loaded) {
    engineStatusString = $$('rime_engine_ready');
    engineColor = 'success.main';
  }

  const kMinPageSize = 3, kMaxPageSize = 9;
  function currentSchemaInfo(): SchemaDescription | null {
    return schemaList.schemas.find(x => x.id == imeSettings.schema) ?? null;
  }

  async function addSelfDefinedSchema(id: string, name: string, description: string, website: string, realName: string) {
    const selfDefinedSchema = await getSelfDefinedSchemaList();
    const item: SchemaDescription = { id, name, description, website, realName, user: true };
    const result = selfDefinedSchema.filter(el => el.id != id);
    result.push(item);
    await chrome.storage.local.set({ selfDefinedSchema: result });
    await loadSchemaList();
  }

  async function removeSchema(id: string) {
    try {
      if (localSchemaList.length < 2) {
        setFetchListError($$('error_last_schema'));
        return;
      }

      if (imeSettings.schema === id) {
        return;
      }

      // Delete the schema directory and all its contents
      const fs = await getFs();
      const schemaPath = `/root/${id}`;
      await fs.deleteDirectory(schemaPath);

      // Run garbage collection to remove unused blobs
      await fs.collectGarbage();

      // Remove from self-defined schema list if it exists there
      const selfDefinedSchema = await getSelfDefinedSchemaList();
      if (selfDefinedSchema.some(el => el.id === id)) {
        await chrome.storage.local.set({ selfDefinedSchema: selfDefinedSchema.filter(el => el.id !== id) });
      }

      // Persist the enabledSchemas update immediately (bypassing the dirty-snackbar
      // path) so the tray refresh triggered below sees the correct state.
      if (imeSettings.enabledSchemas) {
        const next = imeSettings.enabledSchemas.filter(x => x !== id);
        if (next.length !== imeSettings.enabledSchemas.length) {
          const updated = { ...imeSettings, enabledSchemas: next };
          await chrome.storage.sync.set({ settings: updated });
          setImeSettings(updated);
        }
      }

      // Request an immediate tray refresh. This covers all paths – including
      // non-self-defined schemas and legacy mode (enabledSchemas: undefined) –
      // without waiting for the loadSchemaList() network round-trip.
      // Fire-and-forget: the deletion already happened, so the UI refresh
      // below must not be blocked by an unresponsive background worker.
      sendMessage('RefreshImeMenu').catch(ex => console.error('RefreshImeMenu failed:', ex));

      await loadLocalSchemaList();
      await loadSchemaList();
    }
    catch (ex) {
      console.error('Error removing schema:', ex);
      setFetchListError($$('error_removing_schema') + String(ex));
    }
  }

  async function getSelfDefinedSchemaList(): Promise<SchemaDescription[]> {
    const l = await chrome.storage.local.get(['selfDefinedSchema']) as { selfDefinedSchema?: SchemaDescription[] };
    console.log('selfDefinedSchema', l.selfDefinedSchema);
    return l.selfDefinedSchema ?? [];
  }

  async function convertPersonalSchema(repo: string = '', schema_id: string = '', force: boolean = false, convert_schema_id: string = '') {
    setRepoError(null);
    try {
      if (convert_schema_id) {
        setDownloadSchemaId(convert_schema_id);
      }
      else {
        setDownloadSchemaId(fydeosUserDefinedSchema);
      }

      setDownloadProgress(5);

      const finalRepo = repo || personalRepoURL;
      const finalSchemaId = schema_id || personalRepoSchemaId;

      if (!finalRepo || !finalSchemaId) {
        setRepoError($$('error_form'));
        (!finalRepo ? repoUrlInputRef : repoSchemaIdInputRef).current?.focus();
        return;
      }

      const data = await fetch(kConventerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repo: finalRepo, schema_id: finalSchemaId, force }),
      }).then(x => x.json()) as ConverterResponse;

      if (data['status'] != 'complete') {
        setRepoError($$('error_downloading_schema') + data['message']);
        return;
      }

      const id = data['schema_id'];
      setDownloadProgress(10);
      const schema = await installRemoteSchema({
        id,
        repoUrl: `${kConventerUrl}/schema/${id}`,
        update: true,
        onProgress: setDownloadProgress,
      });
      await addSelfDefinedSchema(id, schema.schema.name, schema.schema.description, data['repo'], finalSchemaId);
      setActiveSchemaOnInstall(id);
    }
    catch (ex) {
      console.log(ex);
      setRepoError($$('error_downloading_schema') + 'repo conf error');
    }
    finally {
      await loadLocalSchemaList();
      setDownloadSchemaId(null);
    }
  }

  async function downloadSchema(id: string, update: boolean = false) {
    setFetchListError(null);
    try {
      setDownloadSchemaId(id);
      setDownloadProgress(0);
      await installRemoteSchema({
        id,
        repoUrl: kRepoUrl,
        update,
        onProgress: setDownloadProgress,
      });
      setActiveSchemaOnInstall(id);
    }
    catch (ex) {
      console.log(ex);
      setFetchListError($$('error_downloading_schema') + String(ex));
    }
    finally {
      await loadLocalSchemaList();
      setDownloadSchemaId(null);
    }
  }

  async function importCompiledSchema(zipFile: File) {
    setImportError(null);
    try {
      setDownloadSchemaId('importing');
      setDownloadProgress(0);

      const detectedSchema = await detectSchemaInZip(zipFile);
      const predefinedSchema = getPredefinedSchema(detectedSchema.schemaId);
      if (predefinedSchema) {
        setDownloadSchemaId(null);
        setDownloadProgress(0);
        // Ask via dialog; the confirm handler continues the import.
        setImportPredefinedCandidate(detectedSchema.schemaId);
        setImportPredefinedDialogOpen(true);
        return;
      }

      const fs = await getFs();
      const result = await importSchemaFromZip(zipFile, fs, {
        onProgress: setDownloadProgress,
      });

      await addSelfDefinedSchema(
        result.schemaId,
        result.schemaName,
        result.schemaDescription,
        '',
        result.schemaId,
      );

      await loadLocalSchemaList();
      setActiveSchemaOnInstall(result.schemaId);
      setDownloadProgress(100);
      console.log(`Schema ${result.schemaId} imported successfully! Total files: ${result.fileCount}`);

      setTimeout(() => setImportError(null), 3000);
    }
    catch (ex) {
      console.error('Import error:', ex);
      setImportError($$('error_importing_schema') + ': ' + String(ex));
    }
    finally {
      await loadLocalSchemaList();
      setDownloadSchemaId(null);
      setDownloadProgress(0);
    }
  }

  const settingsDirtySnackbarActions = (
    <div style={{ padding: '8px' }}>
      <Button color="primary" variant="contained" size="small" onClick={() => loadRime()}>
        {(settingsDirty == SettingsDirtyStatus.Reloading
        // Generally, the snackbar should be invisible if settingsDirty == SettingsDirtyStatus.NotDirty,
        // so it may seem to be needless to check for NotDirty here.
        // However, when the settings is just applied, and the disappearance animation is being
        // played, it will be visible. In this case, we continue to display restarting status to maintain a
        // consistent user experience (i.e. the button won't jump back to "Save" in animation).
          || settingsDirty == SettingsDirtyStatus.NotDirty)
          ? $$('rime_engine_starting_button')
          : $$('save_settings_and_apply_button')}
      </Button>
    </div>
  );

  const manifest = chrome.runtime.getManifest();

  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <div className={styles.content}>
        <h1 className={styles.visuallyHidden}>{$$('setting_page')}</h1>
        <AppearanceToggle />
        <div style={{ position: 'absolute', top: 30, left: 30 }}>
          <img src="/logo.svg" alt="" width={146} height={42} />
        </div>
        <div className={styles.bgBlock}>
          <div className={styles.leftTop1} />
          <div className={styles.leftTop2} />
          <div className={styles.leftTop3} />
          <div className={styles.rightMid1} />
          <div className={styles.rightMid2} />
        </div>
        <div className={styles.topAnimation}>
          <Animation
            loop={true}
            width={500}
            height={180}
          />
        </div>
        <SchemaSection
          schemas={schemaList.schemas}
          fetching={fetchingList}
          localSchemaIds={localSchemaList}
          settings={imeSettings}
          downloadSchemaId={downloadSchemaId}
          downloadProgress={downloadProgress}
          fetchError={fetchListError}
          repoError={repoError}
          importError={importError}
          personalRepoUrl={personalRepoURL}
          personalRepoSchemaId={personalRepoSchemaId}
          repoUrlInputRef={repoUrlInputRef}
          repoSchemaIdInputRef={repoSchemaIdInputRef}
          userDefinedSchemaId={fydeosUserDefinedSchema}
          showsInputView={showsInputView}
          schemaKeyNames={schemaKeysNames}
          onSettingsChange={changeSettings}
          onDownloadSchema={downloadSchema}
          onConvertPersonalSchema={convertPersonalSchema}
          onRemoveRequest={(schema) => {
            setRemoveCandidate(schema);
            setRemoveDialogOpen(true);
          }}
          isSchemaEnabled={isSchemaEnabled}
          onToggleSchemaEnabled={toggleSchemaEnabled}
          onSetSchemaKeys={setSchemaKeys}
          onRepoUrlChange={setPersonalRepoURL}
          onRepoSchemaIdChange={setPersonalRepoSchemaId}
          onImportCompiledSchema={importCompiledSchema}
        />
        {/* Voice input needs a build that carries an ASR key and a keyboard to
            put the microphone button on — the Web Store build has neither, so
            the section would be a switch that does nothing. */}
        {voiceConfigured && (
          <VoiceSection
            enabled={imeSettings.voiceInput ?? false}
            onChange={enabled => changeSettings({ voiceInput: enabled })}
          />
        )}
        <div className={styles.formGroup}>
          <div className={styles.formBox} style={{ padding: '8px 0' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2.5 }}>
              <Box component="h2" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                {$$('candidate_count')}
              </Box>
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                bgcolor: 'action.hover',
                borderRadius: '24px',
                padding: '4px',
              }}
              >
                <IconButton
                  size="small"
                  aria-label={$$('decrease_candidate_count')}
                  disabled={(imeSettings.pageSize ?? kDefaultSettings.pageSize) <= kMinPageSize}
                  onClick={() => {
                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                    if (s > kMinPageSize) { changeSettings({ pageSize: s - 1 }); }
                  }}
                  sx={{
                    'width': 36, 'height': 36,
                    'borderRadius': '18px',
                    'color': 'text.secondary',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>

                <Box sx={{ width: 44, textAlign: 'center', fontWeight: 500, fontSize: '15px', color: 'text.primary' }}>
                  {(imeSettings.pageSize ?? kDefaultSettings.pageSize).toString()}
                </Box>

                <IconButton
                  size="small"
                  aria-label={$$('increase_candidate_count')}
                  disabled={(imeSettings.pageSize ?? kDefaultSettings.pageSize) >= kMaxPageSize}
                  onClick={() => {
                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                    if (s < kMaxPageSize) { changeSettings({ pageSize: s + 1 }); }
                  }}
                  sx={{
                    'width': 36, 'height': 36,
                    'borderRadius': '18px',
                    'color': 'text.secondary',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>

            <Divider sx={{ mx: 4 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2.5 }}>
              <Box sx={{ pr: 2 }}>
                <Box component="h2" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                  {$$('schema_switch_key')}
                </Box>
                {/* State-aware hint: the disabled state must always carry its own
                                way back (how to re-enable), and recording explains how to bail. */}
                <Box sx={{ fontSize: '13px', color: 'text.secondary', mt: 0.5 }}>
                  {recordingSwitchKey
                    ? $$('schema_switch_key_hint_recording')
                    : (switchKeyLabel
                        ? $$('schema_switch_key_hint')
                        : $$('schema_switch_key_hint_disabled'))}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                <Button
                  ref={recordButtonRef}
                  variant="outlined"
                  size="small"
                  onClick={() => { setSwitchKeyError(null); setRecordingSwitchKey(r => !r); }}
                  sx={{ minWidth: 120, textTransform: 'none', fontFamily: 'monospace', fontWeight: 600 }}
                >
                  {recordingSwitchKey
                    ? $$('schema_switch_key_recording')
                    : (switchKeyLabel || $$('schema_switch_key_set'))}
                </Button>
                <Button
                  size="small"
                  disabled={!switchKeyLabel}
                  onClick={() => stopRecordingAndSetSwitchKey(null)}
                  sx={{ textTransform: 'none' }}
                >
                  {$$('schema_switch_key_disable')}
                </Button>
                <Button
                  size="small"
                  disabled={imeSettings.schemaSwitchKey === undefined}
                  onClick={() => stopRecordingAndSetSwitchKey(undefined)}
                  sx={{ textTransform: 'none' }}
                >
                  {$$('schema_switch_key_reset')}
                </Button>
              </Box>
            </Box>
            {switchKeyError && (
              <Box role="alert" sx={{ px: 4, pb: 2, color: 'error.main', fontSize: '0.85rem' }}>{switchKeyError}</Box>
            )}

            <Divider sx={{ mx: 4 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2.5 }}>
              <Box sx={{ pr: 2 }}>
                <Box component="h2" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                  {$$('keyboard_arrangement')}
                </Box>
                <Box sx={{ fontSize: '13px', color: 'text.secondary', mt: 0.5 }}>
                  {activeScript && showsInputView
                    ? $$('keyboard_script_note', activeSchemaName || imeSettings.schema)
                    : showsInputView
                      ? $$('keyboard_arrangement_hint')
                      : $$('keyboard_arrangement_hint_physical')}
                </Box>
              </Box>
              <SegmentedPill
                options={kLatinLayoutIds.map(id => ({ value: id, label: layoutNames[id], content: layoutNames[id] }))}
                value={arrangement}
                onChange={(id: LatinLayoutId) => changeSettings({ keyboardLayout: id })}
                ariaLabel={$$('keyboard_arrangement')}
                width={92}
                height={32}
              />
            </Box>
          </div>
        </div>

        {currentSchemaInfo()?.fuzzy_pinyin && (
          <div className={styles.formGroup}>
            <div className={styles.formBox} style={{ padding: '8px 0' }}>
              <Box component="h2" sx={{ m: 0, px: 4, py: 2.5, pb: 1.5, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                {$$('fuzzy_pinyin')}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', px: 2, pb: 2 }}>
                {kFuzzyMap.map((fuzzy) => {
                  const isChecked = imeSettings.algebraList.includes(fuzzy.value);
                  return (
                    <Box
                      key={fuzzy.value}
                      component="label"
                      sx={{
                        'display': 'flex',
                        'alignItems': 'center',
                        'justifyContent': 'space-between',
                        'px': 2,
                        'py': 1.25,
                        'borderRadius': '10px',
                        'cursor': 'pointer',
                        'transition': 'background 0.15s',
                        '&:hover': { bgcolor: 'action.hover' },
                        '&:active': { bgcolor: 'action.selected' },
                      }}
                    >
                      <Box sx={{ fontSize: '14px', fontWeight: 400, color: 'text.primary' }}>
                        {fuzzy.label}
                      </Box>
                      <Switch
                        size="small"
                        checked={isChecked}
                        onChange={() => changeFuzzy(!isChecked, fuzzy.value)}
                      />
                    </Box>
                  );
                })}
              </Box>
            </div>
          </div>
        )}

        <DictionaryPacks schemaId={imeSettings.schema} />

        <div className={styles.formGroup}>
          <div className={styles.formBox}>
            <FormControl className={styles.formControl}>
              {/* Header: section title + engine status badge */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <h2 className={styles.formLabel} style={{ marginBottom: 0 }}>{$$('rime_engine_logs')}</h2>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: '20px',
                  bgcolor: engineStatus.loaded
                    ? 'rgba(34, 197, 94, 0.1)'
                    : engineStatus.loading
                      ? 'rgba(234, 179, 8, 0.1)'
                      : 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid',
                  borderColor: engineStatus.loaded
                    ? 'rgba(34, 197, 94, 0.3)'
                    : engineStatus.loading
                      ? 'rgba(234, 179, 8, 0.3)'
                      : 'rgba(239, 68, 68, 0.25)',
                }}
                >
                  <Box sx={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    bgcolor: engineColor,
                  }}
                  />
                  <Box sx={{ fontSize: '0.75rem', fontWeight: 500, color: engineColor, whiteSpace: 'nowrap' }}>
                    {engineStatusString}
                  </Box>
                </Box>
              </Box>
              <RimeLogDisplay />
              <Box sx={{ mt: 2 }}>
                <FileEditorButton onEdit={() => setSettingsDirty(SettingsDirtyStatus.Dirty)} />
              </Box>
            </FormControl>
          </div>
        </div>

        <div className={styles.footer}>
          {manifest.name}
          {' '}
          v
          {manifest.version}
          <Link href={$$('privacy_statement_url')} target="_blank" underline="hover" style={{ marginLeft: '5px' }}>
            {$$('privacy_statement')}
          </Link>
          <Link href="https://github.com/FydeOS/fydeRhythm" target="_blank" underline="hover" style={{ marginLeft: '5px' }}>
            {$$('open_source')}
          </Link>
          <br />
          {/* Brand tagline — intentionally shown in English in every locale. */}
          FydeOS is made possible by gentle souls with real ❤️
        </div>

        <Snackbar
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'center',
          }}
          open={settingsDirty == SettingsDirtyStatus.Dirty || settingsDirty == SettingsDirtyStatus.Reloading}
          message={$$('settings_changed_snackbar')}
          action={settingsDirtySnackbarActions}
        />

        <Dialog
          open={removeDialogOpen}
          onClose={() => setRemoveDialogOpen(false)}
          slotProps={{ transition: { onExited: () => setRemoveCandidate(null) } }}
          aria-labelledby="remove-schema-dialog-title"
          aria-describedby="remove-schema-dialog-desc"
        >
          <DialogTitle id="remove-schema-dialog-title">{$$('remove_schema_confirm_title')}</DialogTitle>
          <DialogContent>
            <DialogContentText id="remove-schema-dialog-desc">
              {removeCandidate && $$('remove_schema_confirm_body', removeCandidate.name || removeCandidate.id)}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={() => setRemoveDialogOpen(false)}>
              {$$('cancel_button')}
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                const id = removeCandidate!.id;
                setRemoveDialogOpen(false);
                void removeSchema(id);
              }}
            >
              {$$('remove_schema')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={importPredefinedDialogOpen}
          onClose={() => setImportPredefinedDialogOpen(false)}
          slotProps={{ transition: { onExited: () => setImportPredefinedCandidate(null) } }}
          aria-labelledby="import-predefined-dialog-title"
          aria-describedby="import-predefined-dialog-desc"
        >
          <DialogTitle id="import-predefined-dialog-title">{$$('import_predefined_schema_title')}</DialogTitle>
          <DialogContent>
            <DialogContentText id="import-predefined-dialog-desc">
              {importPredefinedCandidate && $$('import_predefined_schema_confirm', importPredefinedCandidate)}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={() => setImportPredefinedDialogOpen(false)}>
              {$$('cancel_button')}
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                const id = importPredefinedCandidate!;
                setImportPredefinedDialogOpen(false);
                if (!localSchemaList.includes(id)) {
                  void downloadSchema(id);
                }
                else if (id !== imeSettings.schema) {
                  setActiveSchemaOnInstall(id);
                }
              // Already installed and active: nothing to do — don't
              // mark the settings dirty for a no-op.
              }}
            >
              {$$('import_button')}
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </ThemeProvider>
  );
}

export default OptionsPage;
