import React, { useEffect, useRef, useState } from "react";
import _ from "lodash";
import { parse } from 'yaml'
import { ThemeProvider, useColorScheme } from '@mui/material/styles';

import theme from "./theme"
import styles from "./styles.module.less";
import "./global.css";

import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import FormControl from "@mui/material/FormControl";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightnessOutlined';

import Animation from "./utils/animation";
import FileEditorButton from "./fileEditor";
import RimeLogDisplay from "./rimeLogDisplay";
import { $$, getFs, type ImeSettings, kDefaultSettings, type SchemaSwitchKey, formatSchemaSwitchKey, interpretRecordingKey, migrateLayoutSettings, resolveKeyboardLayout, resolveSchemaKeys, type SchemaKeys } from "@/lib/utils";
import { kLatinLayoutIds, kScriptLayoutIds, type LatinLayoutId, type LayoutId } from "@/lib/shared-types";
import { hasInputView } from "@/lib/platform";
import { SegmentedPill } from "./SegmentedPill";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Divider from "@mui/material/Divider";
import { detectSchemaInZip, importSchemaFromZip } from "@/lib/import-schema";
import { getInstalledSchemaIds } from "@/lib/schema-install";
import { sendMessage } from "@/lib/messaging";
import Link from "@mui/material/Link";

const kFuzzyMap = [
    {
        value: "derive/^([zcs])h/$1/",
        label: "zh, ch, sh => z, c, s"
    },
    {
        value: "derive/^([zcs])([^h])/$1h$2/",
        label: "z, c, s => zh, ch, sh"
    },
    {
        value: "derive/^n/l/",
        label: "n => l"
    },
    {
        value: "derive/^l/n/",
        label: "l => n"
    },
    {
        value: "derive/([ei])n$/$1ng/",
        label: "en => eng, in => ing"
    },
    {
        value: "derive/([ei])ng$/$1n/",
        label: "eng => en, ing => in"
    }
];

interface SchemaDescription {
    id: string;
    name: string;
    description: string;
    website: string;
    user?: boolean;
    realName?: string;
    extra_data?: boolean;
    fuzzy_pinyin?: boolean;
}

interface SchemaListFile {
    schemas: SchemaDescription[];
}

interface ConverterResponse {
    status: string;
    message?: string;
    schema_id: string;
    repo: string;
}

type OpenCcDict =
    | { type: 'ocd2' | 'text'; file: string }
    | { type: 'group'; dicts: OpenCcDict[] };

interface OpenCcConfig {
    segmentation?: { dict?: OpenCcDict };
    conversion_chain?: Array<{ dict?: OpenCcDict }>;
}

const kRepoUrl = "https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm";
const kConventerUrl = 'https://rime-conf-translator.fydeos.io'

// Light / System / Dark pill in the top-right corner. Persistence and the
// <html> class are handled by MUI's useColorScheme, so it renders inside the
// ThemeProvider. The pill itself is shared with the arrangement picker below.
function AppearanceToggle() {
    const { mode, setMode } = useColorScheme();
    const current = mode ?? 'system';
    // System sits at the edge: light↔dark form a natural continuum, and a
    // "follow system" wedged between them breaks it.
    const options = [
        { value: 'system' as const, label: $$("theme_system"), content: <SettingsBrightnessIcon sx={{ fontSize: 18 }} /> },
        { value: 'light' as const, label: $$("theme_light"), content: <LightModeIcon sx={{ fontSize: 18 }} /> },
        { value: 'dark' as const, label: $$("theme_dark"), content: <DarkModeIcon sx={{ fontSize: 18 }} /> },
    ];

    return (
        <Box sx={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
            <SegmentedPill
                options={options}
                value={current}
                onChange={setMode}
                ariaLabel={$$("appearance")}
                tooltips
            />
        </Box>
    );
}

function OptionsPage() {
    const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: "" as string });
    const [imeSettings, setImeSettings] = useState<ImeSettings>(kDefaultSettings);
    enum SettingsDirtyStatus {
        NotDirty = 0,
        Dirty = 1,
        Reloading = 2
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

    const kTotalProgress = 100;
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadSchemaId, setDownloadSchemaId] = useState<string | null>(null);

    const [personalRepoURL, setPersonalRepoURL] = useState<string | null>(null);
    const [personalRepoSchemaId, setPersonalRepoSchemaId] = useState<string | null>(null);

    // Each confirm dialog keeps its data in a separate state from its `open`
    // flag: clearing the data on close would empty the dialog while the fade-out
    // is still playing, visibly shrinking it. Data is cleared in onExited.
    const [removeCandidate, setRemoveCandidate] = useState<SchemaDescription | null>(null);
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

    const fydeosUserDefinedSchema = "fydeosUserDefinedSchema";

    // chrome.storage.local.get

    async function updateRimeStatus() {
        const result = await sendMessage("GetEngineStatus");
        setEngineStatus(result);
    }

    async function loadSettings() {
        const obj = await chrome.storage.sync.get(["settings"]) as { settings?: ImeSettings };
        if (obj.settings) {
            // The page only ever edits the current shape; saving rewrites it.
            setImeSettings(migrateLayoutSettings(obj.settings));
            setSettingsDirty(SettingsDirtyStatus.NotDirty);
        }
    }

    async function loadLocalSchemaList(): Promise<string[]> {
        const fs = await getFs();
        const content = await fs.readAll();
        const list = getInstalledSchemaIds(content);
        setLocalSchemaList(list);
        console.log("Local schema list:", list);
        return list;
    }

    async function loadSchemaList() {
        const { schemaList: storedSchemaList } = await chrome.storage.local.get(["schemaList"]) as { schemaList?: SchemaListFile };
        console.log("loadSchemaList:", storedSchemaList);
        setFetchingList(true);
        let newData: SchemaListFile;
        try {
            const text = await fetch(`${kRepoUrl}/schema-list.yaml`, {
                method: "GET",
                mode: "cors",
                cache: "no-cache",
            }).then(x => x.text());
            newData = parse(text) as SchemaListFile;
        } catch (error) {
            setFetchListError($$("error_fetch_schema_list") + String(error));
            return;
        } finally {
            setFetchingList(false);
        }
        console.log("fetch", newData);
        const selfDefinedSchema = await getSelfDefinedSchemaList();
        newData.schemas = mergeSchemaList(newData.schemas, selfDefinedSchema);
        console.log(newData);
        setSchemaList(newData);
        await chrome.storage.local.set({ schemaList: newData });
    }

    function mergeSchemaList(predefinedSchemas: SchemaDescription[], selfDefinedSchemas: SchemaDescription[]) {
        const seen = new Set(predefinedSchemas.map(schema => schema.id));
        const uniqueSelfDefinedSchemas = selfDefinedSchemas.filter(schema => {
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
        updateRimeStatus();
        loadSettings();
        loadSchemaList();
        loadLocalSchemaList();

        const listener = (m: { rimeStatusChanged?: boolean }) => {
            if (m.rimeStatusChanged) {
                updateRimeStatus();
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
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settingsDirty]);

    async function loadRime() {
        await chrome.storage.sync.set({ settings: imeSettings });
        if (!engineStatus.loading) {
            setSettingsDirty(SettingsDirtyStatus.Reloading);
            await sendMessage("ReloadRime");
            setSettingsDirty(SettingsDirtyStatus.NotDirty);
        }
    }

    function changeSettings(change: any) {
        console.log("Change:", change)
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
            } else if (result.kind === 'invalid') {
                setSwitchKeyError($$("schema_switch_key_invalid"));
            } else if (result.kind === 'accept') {
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
        } else {
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

    // Latin arrangements are proper nouns; the scripts are localized.
    const layoutNames: Record<LayoutId, string> = {
        qwerty: "QWERTY",
        colemak: "Colemak",
        dvorak: "Dvorak",
        zhuyin: $$("layout_zhuyin"),
        kana: $$("layout_kana"),
        hangul: $$("layout_hangul"),
    };

    const arrangement = resolveKeyboardLayout(imeSettings);
    const activeSchemaName = currentSchemaInfo()?.name;
    const activeScript = resolveSchemaKeys(imeSettings, imeSettings.schema, activeSchemaName);

    // Correct a schema whose key set was guessed wrong.
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

    const schemaKeysNames: Record<SchemaKeys, string> = {
        latin: $$("layout_letters"),
        zhuyin: layoutNames.zhuyin,
        kana: layoutNames.kana,
        hangul: layoutNames.hangul,
    };

    // No on-screen keyboard means a schema's key set has no surface to appear
    // on, so we neither ask about it nor preview it.
    const showsInputView = hasInputView();
    let engineStatusString: string = $$("rime_engine_not_started");
    let engineColor = "error.main";
    if (engineStatus.loading) {
        engineStatusString = $$("rime_engine_starting");
        engineColor = "warning.main";
    } else if (engineStatus.loaded) {
        engineStatusString = $$("rime_engine_ready");
        engineColor = "success.main";
    }

    const kMinPageSize = 3, kMaxPageSize = 9;
    function currentSchemaInfo(): SchemaDescription | null {
        return schemaList.schemas.find((x) => x.id == imeSettings.schema) ?? null;
    }

    async function addSelfDefinedSchema(id: string, name: string, description: string, website: string, realName: string) {
        const selfDefinedSchema = await getSelfDefinedSchemaList();
        const item: SchemaDescription = { id, name, description, website, realName, user: true };
        const result = selfDefinedSchema.filter(el => el.id != id);
        result.push(item);
        await chrome.storage.local.set({ "selfDefinedSchema": result });
        await loadSchemaList();
    }

    async function removeSchema(id: string) {
        try {
            if (localSchemaList.length < 2) {
                setFetchListError($$("error_last_schema"));
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
            sendMessage("RefreshImeMenu").catch((ex) => console.error("RefreshImeMenu failed:", ex));

            await loadLocalSchemaList();
            await loadSchemaList();
        } catch (ex) {
            console.error("Error removing schema:", ex);
            setFetchListError($$("error_removing_schema") + String(ex));
        }
    }

    async function getSelfDefinedSchemaList(): Promise<SchemaDescription[]> {
        const l = await chrome.storage.local.get(["selfDefinedSchema"]) as { selfDefinedSchema?: SchemaDescription[] };
        console.log("selfDefinedSchema", l.selfDefinedSchema);
        return l.selfDefinedSchema ?? [];
    }

    async function convertPersonalSchema(repo: string='', schema_id: string='', force: boolean=false, convert_schema_id: string='') {
        setRepoError(null);
        try {
            if (convert_schema_id) {
                setDownloadSchemaId(convert_schema_id);
            } else {
                setDownloadSchemaId(fydeosUserDefinedSchema);
            }

            setDownloadProgress(5);

            const fetchInit: RequestInit = { cache: "no-cache" };

            const finalRepo = repo || personalRepoURL;
            const finalSchemaId = schema_id || personalRepoSchemaId;

            if (!finalRepo || !finalSchemaId) {
                setRepoError($$("error_form"));
                (!finalRepo ? repoUrlInputRef : repoSchemaIdInputRef).current?.focus();
                return;
            }

            const data = await fetch(kConventerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ repo: finalRepo, schema_id: finalSchemaId, force }),
            }).then(x => x.json()) as ConverterResponse;

            if (data['status'] != 'complete') {
                setRepoError($$("error_downloading_schema") + data['message']);
                return;
            }

            const update = true;
            const id = data['schema_id'];
            // [to-do] do not with merge with downloadSchema, there will be more features soon.
            setDownloadProgress(10);

            const schemaBasePath = `/root/${id}`;
            const kRepoUrl = kConventerUrl + "/schema/"+id;
            const schemaFile = `build/${id}.schema.yaml`;
            const schemaYaml: string = await fetch(`${kRepoUrl}/${schemaFile}`, fetchInit).then(x => x.text());
            const schema = parse(schemaYaml);

            const dependencies: Set<string> = new Set();

            if (schemaYaml.includes("lua_")) {
                dependencies.add(`shared/${id}.rime.lua`);
            }
            
            if (schema.engine?.filters) {
                for (const t of schema.engine.filters) {
                    const tn = t.split("@");
                    if (tn[0] == "simplifier") {
                        const opencc = schema[tn[1] ?? "simplifier"];
                        const configPath = `shared/opencc/${opencc?.opencc_config ?? "t2s.json"}`;
                        dependencies.add(configPath);
                        const opencc_config = await fetch(`${kRepoUrl}/${configPath}`, fetchInit).then(x => x.text());
                        const config = JSON.parse(opencc_config) as OpenCcConfig;

                        function parseDict(dict: OpenCcDict) {
                            if (dict.type === 'ocd2' || dict.type === 'text') {
                                dependencies.add(`shared/opencc/${dict.file}`);
                            } else if (dict.type === 'group') {
                                dict.dicts.forEach(parseDict);
                            }
                        }

                        if (config.segmentation && config.segmentation.dict) {
                            parseDict(config.segmentation.dict);
                        }

                        if (config.conversion_chain) {
                            config.conversion_chain.forEach((step: { dict?: OpenCcDict }) => {
                                if (step.dict) {
                                    parseDict(step.dict);
                                }
                            });
                        }
                    }
                }
            }

            if (schema.engine?.translators) {
                for (const t of schema.engine.translators) {
                    const tn = t.split("@");
                    // Only these two use a dictionary
                    const translators = ["script_translator", "table_translator", "reverse_lookup_translator"];
                    if (translators.includes(tn[0])) {
                        const ns = tn[1] ?? "translator";
                        const dictName: string = schema[ns].dictionary;
                        if (!dictName) {
                            continue;
                        }
                        const prismName: string = schema[ns].prism ?? dictName;

                        dependencies.add(`build/${dictName}.table.bin`);
                        dependencies.add(`build/${dictName}.reverse.bin`);
                        dependencies.add(`build/${prismName}.prism.bin`);
                    }
                }
            }
            if (schema.grammar?.language) {
                dependencies.add(`shared/${schema.grammar.language}.gram`);
            }

            const kPhase1Weight = 30;
            const phase2Files = [];
            const phase2Sizes = [];
            let phase1Progress = 0;

            const fs = await getFs();
            // Phase 1: Download small files and get size of big files
            for (const f of dependencies) {
                if (await fs.readEntry(`${schemaBasePath}/${f}`) && !update) {
                    // file already exists
                    console.log(`${f} already exists, skipped`);
                } else {
                    const controller = new AbortController();
                    const res = await fetch(`${kRepoUrl}/${f}`, { signal: controller.signal, ...fetchInit });
                    const sizeHeader = res.headers.get('Content-Length');
                    const size = sizeHeader ? parseInt(sizeHeader, 10) : Number.NaN;
                    if ((size && size < 70 * 1024) ||
                        // If response is gzipped, size = NaN
                        isNaN(size)
                    ) {
                        const buf = await res.arrayBuffer();
                        fs.writeWholeFile(`${schemaBasePath}/${f}`, new Uint8Array(buf));
                        console.log("Downloaded", f);
                    } else {
                        phase2Files.push(f);
                        phase2Sizes.push(size);
                        controller.abort();
                        console.log("Checked", f, `Size = ${size}`);
                    }
                }
                phase1Progress++;
                setDownloadProgress(kPhase1Weight * phase1Progress / dependencies.size);
            }

            // Phase 2: Download big files
            let downloadedSize = 0;
            let phase2LastProgress = 0;
            const phase2TotalSize = _.sum(phase2Sizes);
            for (let i = 0; i < phase2Files.length; i++) {
                const f = phase2Files[i];
                const res = await fetch(`${kRepoUrl}/${f}`, fetchInit);
                const reader = res.body?.getReader();
                if (!reader) {
                    throw new Error(`Missing response body for ${f}`);
                }
                const buf = new ArrayBuffer(phase2Sizes[i]);
                let offset = 0;
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = new Uint8Array(buf, offset, value.length);
                    chunk.set(new Uint8Array(value));
                    offset += value.length;
                    downloadedSize += value.length;
                    const newProgress = kPhase1Weight + (kTotalProgress - kPhase1Weight) * downloadedSize / phase2TotalSize;
                    if (newProgress - phase2LastProgress > 0.5) {
                        setDownloadProgress(newProgress);
                        phase2LastProgress = newProgress;
                    }
                }
                fs.writeWholeFile(`${schemaBasePath}/${f}`, new Uint8Array(buf));
                console.log("Downloaded", f);
            }

            // Schema should be the last file to be written, in case an error is encountered while downloading
            await fs.writeWholeFile(`${schemaBasePath}/${schemaFile}`, new TextEncoder().encode(schemaYaml));
            await addSelfDefinedSchema(id, schema.schema.name, schema.schema.description, data['repo'], finalSchemaId);
            setActiveSchemaOnInstall(id);
        } catch (ex) {
            console.log(ex);
            setRepoError($$("error_downloading_schema") + 'repo conf error');
        } finally {
            await loadLocalSchemaList();
            setDownloadSchemaId(null);
        }
    }

    async function downloadSchema(id: string, update: boolean = false) {
        setFetchListError(null);
        try {
            const fetchInit: RequestInit = { cache: "no-cache" };
            setDownloadSchemaId(id);
            setDownloadProgress(0);

            const schemaBasePath = `/root/${id}`;
            const schemaFile = `build/${id}.schema.yaml`;
            const schemaYaml: string = await fetch(`${kRepoUrl}/${schemaFile}`, fetchInit).then(x => x.text());
            const schema = parse(schemaYaml);


            const dependencies: Set<string> = new Set();

            if (schemaYaml.includes("lua_")) {
                dependencies.add(`shared/${id}.rime.lua`);
            }

            if (schema.engine?.filters) {
                for (const t of schema.engine.filters) {
                    const tn = t.split("@");
                    if (tn[0] == "simplifier") {
                        const opencc = schema[tn[1] ?? "simplifier"];
                        const configPath = `shared/opencc/${opencc?.opencc_config ?? "t2s.json"}`;
                        dependencies.add(configPath);
                        const opencc_config = await fetch(`${kRepoUrl}/${configPath}`, fetchInit).then(x => x.text());
                        const config = JSON.parse(opencc_config) as OpenCcConfig;

                        function parseDict(dict: OpenCcDict) {
                            if (dict.type === 'ocd2' || dict.type === 'text') {
                                dependencies.add(`shared/opencc/${dict.file}`);
                            } else if (dict.type === 'group') {
                                dict.dicts.forEach(parseDict);
                            }
                        }

                        if (config.segmentation && config.segmentation.dict) {
                            parseDict(config.segmentation.dict);
                        }

                        if (config.conversion_chain) {
                            config.conversion_chain.forEach((step: { dict?: OpenCcDict }) => {
                                if (step.dict) {
                                    parseDict(step.dict);
                                }
                            });
                        }
                    }
                }
            }

            if (schema.engine?.translators) {
                for (const t of schema.engine.translators) {
                    const tn = t.split("@");
                    // Only these two use a dictionary
                    const translators = ["script_translator", "table_translator", "reverse_lookup_translator"];
                    if (translators.includes(tn[0])) {
                        const ns = tn[1] ?? "translator";
                        const dictName: string = schema[ns].dictionary;
                        if (!dictName) {
                            continue;
                        }
                        const prismName: string = schema[ns].prism ?? dictName;

                        dependencies.add(`build/${dictName}.table.bin`);
                        dependencies.add(`build/${dictName}.reverse.bin`);
                        dependencies.add(`build/${prismName}.prism.bin`);
                    }
                }
            }
            if (schema.grammar?.language) {
                dependencies.add(`shared/${schema.grammar.language}.gram`);
            }

            const kPhase1Weight = 30;
            const phase2Files = [];
            const phase2Sizes = [];
            let phase1Progress = 0;

            const fs = await getFs();
            // Phase 1: Download small files and get size of big files
            for (const f of dependencies) {
                if (await fs.readEntry(`${schemaBasePath}/${f}`) && !update) {
                    // file already exists
                    console.log(`${f} already exists, skipped`);
                } else {
                    const controller = new AbortController();
                    const res = await fetch(`${kRepoUrl}/${f}`, { signal: controller.signal, ...fetchInit });
                    const sizeHeader = res.headers.get('Content-Length');
                    const size = sizeHeader ? parseInt(sizeHeader, 10) : Number.NaN;
                    if ((size && size < 70 * 1024) ||
                        // If response is gzipped, size = NaN
                        isNaN(size)
                    ) {
                        const buf = await res.arrayBuffer();
                        fs.writeWholeFile(`${schemaBasePath}/${f}`, new Uint8Array(buf));
                        console.log("Downloaded", f);
                    } else {
                        phase2Files.push(f);
                        phase2Sizes.push(size);
                        controller.abort();
                        console.log("Checked", f, `Size = ${size}`);
                    }
                }
                phase1Progress++;
                setDownloadProgress(kPhase1Weight * phase1Progress / dependencies.size);
            }

            // Phase 2: Download big files
            let downloadedSize = 0;
            let phase2LastProgress = 0;
            const phase2TotalSize = _.sum(phase2Sizes);
            for (let i = 0; i < phase2Files.length; i++) {
                const f = phase2Files[i];
                const res = await fetch(`${kRepoUrl}/${f}`, fetchInit);
                const reader = res.body?.getReader();
                if (!reader) {
                    throw new Error(`Missing response body for ${f}`);
                }
                const buf = new ArrayBuffer(phase2Sizes[i]);
                let offset = 0;
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = new Uint8Array(buf, offset, value.length);
                    chunk.set(new Uint8Array(value));
                    offset += value.length;
                    downloadedSize += value.length;
                    const newProgress = kPhase1Weight + (kTotalProgress - kPhase1Weight) * downloadedSize / phase2TotalSize;
                    if (newProgress - phase2LastProgress > 0.5) {
                        setDownloadProgress(newProgress);
                        phase2LastProgress = newProgress;
                    }
                }
                fs.writeWholeFile(`${schemaBasePath}/${f}`, new Uint8Array(buf));
                console.log("Downloaded", f);
            }
            // Schema should be the last file to be written, in case an error is encountered while downloading
            await fs.writeWholeFile(`${schemaBasePath}/${schemaFile}`, new TextEncoder().encode(schemaYaml));
            setActiveSchemaOnInstall(id);
        } catch (ex) {
            console.log(ex);
            setFetchListError($$("error_downloading_schema") + String(ex));
        } finally {
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
        } catch (ex) {
            console.error('Import error:', ex);
            setImportError($$("error_importing_schema") + ': ' + String(ex));
        } finally {
            await loadLocalSchemaList();
            setDownloadSchemaId(null);
            setDownloadProgress(0);
        }
    }

    const settingsDirtySnackbarActions = (
        <div style={{ padding: '8px' }}>
            <Button color="primary" variant="contained" size="small" onClick={() => loadRime()}>
                {(settingsDirty == SettingsDirtyStatus.Reloading ||
                    // Generally, the snackbar should be invisible if settingsDirty == SettingsDirtyStatus.NotDirty,
                    // so it may seem to be needless to check for NotDirty here.
                    // However, when the settings is just applied, and the disappearance animation is being
                    // played, it will be visible. In this case, we continue to display restarting status to maintain a
                    // consistent user experience (i.e. the button won't jump back to "Save" in animation).
                    settingsDirty == SettingsDirtyStatus.NotDirty) ?
                    $$("rime_engine_starting_button") :
                    $$("save_settings_and_apply_button")
                }
            </Button>
        </div>
    );

    const manifest = chrome.runtime.getManifest();

    return <ThemeProvider theme={theme} defaultMode="system">
        <div className={styles.content}>
            <h1 className={styles.visuallyHidden}>{$$("setting_page")}</h1>
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
            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
                            <h2 className={styles.formLabel} style={{ marginBottom: 0 }}>{$$("select_schema")}</h2>
                            {fetchingList && (
                                <Box sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{$$("fetching_schema_list")}</Box>
                            )}
                        </Box>

                        {/* Schema cards */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {schemaList.schemas.map((schema) => {
                                const isInstalled = localSchemaList.includes(schema.id);
                                const isActive = schema.id === imeSettings.schema;
                                return (
                                    <Box
                                        key={schema.id}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 1.5,
                                            px: 2,
                                            py: 1.5,
                                            borderRadius: '12px',
                                            border: '1px solid',
                                            borderColor: isActive ? 'rgba(228, 0, 70, 0.18)' : 'divider',
                                            bgcolor: isActive ? 'rgba(228, 0, 70, 0.02)' : 'transparent',
                                            cursor: isInstalled && !isActive ? 'pointer' : 'default',
                                            transition: 'background-color 0.15s',
                                            position: 'relative',
                                            overflow: 'hidden',
                                            '&::after': isInstalled && !isActive ? {
                                                content: '""',
                                                position: 'absolute',
                                                inset: 0,
                                                borderRadius: '12px',
                                                bgcolor: 'transparent',
                                                transition: 'background-color 0.15s',
                                                pointerEvents: 'none',
                                            } : {},
                                            '&:hover::after': isInstalled && !isActive ? {
                                                bgcolor: 'action.hover',
                                            } : {},
                                            '&:active::after': isInstalled && !isActive ? {
                                                bgcolor: 'action.selected',
                                            } : {},
                                        }}
                                        onClick={isInstalled && !isActive ? () => changeSettings({ schema: schema.id }) : undefined}
                                    >
                                        {/* Leading: radio / download / progress — fixed 36px column */}
                                        <Box sx={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>
                                            {downloadSchemaId === schema.id
                                                ? <CircularProgress variant="determinate" value={downloadProgress} size={22} />
                                                : isInstalled
                                                    ? <Radio
                                                        checked={isActive}
                                                        onChange={() => changeSettings({ schema: schema.id })}
                                                        onClick={(e) => e.stopPropagation()}
                                                        size="small"
                                                        sx={{ p: 0 }}
                                                        inputProps={{ 'aria-label': `${schema.id} ${schema.name}` }}
                                                      />
                                                    : <IconButton
                                                        size="small"
                                                        onClick={(e) => { e.stopPropagation(); downloadSchema(schema.id); }}
                                                        disabled={downloadSchemaId != null}
                                                        sx={{ p: 0.5 }}
                                                        aria-label={`${$$("download_schema")} ${schema.name}`}
                                                      >
                                                        <CloudDownloadIcon fontSize="small" />
                                                      </IconButton>
                                            }
                                        </Box>

                                        {/* Content */}
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            {/* Title + action links */}
                                            <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px', mb: 0.5 }}>
                                                <Box sx={{ fontSize: '0.9375rem', fontWeight: isInstalled ? 500 : 400, color: 'text.primary' }}>
                                                    {schema.user ? schema.realName : schema.id} {schema.name}
                                                </Box>
                                                {isInstalled && (!schema.user || schema.website) && (
                                                    <Link component="button" underline="hover"
                                                        onClick={(e) => { e.stopPropagation(); schema.user ? convertPersonalSchema(schema.website, schema.realName, true, schema.id) : downloadSchema(schema.id, true); }}
                                                        sx={{ fontSize: '0.8rem' }}
                                                        disabled={downloadSchemaId != null}>
                                                        {$$("update_schema")}
                                                    </Link>
                                                )}
                                                {isInstalled && (
                                                    <Link component="button" underline="hover"
                                                        onClick={(e) => { e.stopPropagation(); setRemoveCandidate(schema); setRemoveDialogOpen(true); }}
                                                        sx={{
                                                            fontSize: '0.8rem',
                                                            opacity: isActive ? 0.4 : 1,
                                                            cursor: isActive ? 'not-allowed' : undefined,
                                                            color: isActive ? 'primary.main' : 'error.main',
                                                        }}
                                                        disabled={downloadSchemaId != null || isActive}>
                                                        {$$("remove_schema")}
                                                    </Link>
                                                )}
                                            </Box>

                                            {/* Description */}
                                            <Box sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.45, mb: isInstalled ? 1.25 : 0 }}>
                                                {schema.description}
                                                {schema.website && (
                                                    <Link href={schema.website} target="_blank" underline="hover"
                                                        onClick={(e) => e.stopPropagation()}
                                                        sx={{ ml: 1 }}>
                                                        {$$("schema_home_page")}
                                                    </Link>
                                                )}
                                            </Box>

                                            {/* Sub-controls (installed schemas only) */}
                                            {isInstalled && (
                                                <Box
                                                    sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 20px' }}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: isActive ? 'default' : 'pointer' }}>
                                                        <Switch
                                                            size="small"
                                                            checked={isSchemaEnabled(schema.id)}
                                                            disabled={isActive}
                                                            onChange={(_, checked) => toggleSchemaEnabled(schema.id, checked)}
                                                            color="primary"
                                                            sx={{ ml: -0.75 }}
                                                        />
                                                        <Box sx={{ fontSize: '0.8rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                            {$$("enable_schema_hint")}
                                                        </Box>
                                                    </Box>

                                                    {/* The keys this schema paints — a fact about the schema, so
                                                        it lives on the schema. The arrangement is global and lives
                                                        in the keyboard card. */}
                                                    {showsInputView && (
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <Box sx={{ fontSize: '0.8rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                                {$$("vk_keys")}
                                                            </Box>
                                                            <Select
                                                                size="small"
                                                                variant="standard"
                                                                disableUnderline
                                                                // Resolved: correction → guess → letters.
                                                                value={resolveSchemaKeys(imeSettings, schema.id, schema.name) ?? "latin"}
                                                                onChange={(e) => setSchemaKeys(schema.id, e.target.value as SchemaKeys)}
                                                                inputProps={{ 'aria-label': `${$$("vk_keys")} — ${schema.name || schema.id}` }}
                                                                sx={{ fontSize: '0.8rem', color: 'text.secondary', '& .MuiSelect-select': { py: 0.25 } }}
                                                            >
                                                                <MenuItem value="latin">{schemaKeysNames.latin}</MenuItem>
                                                                {kScriptLayoutIds.map((id) => (
                                                                    <MenuItem key={id} value={id}>{schemaKeysNames[id]}</MenuItem>
                                                                ))}
                                                            </Select>
                                                        </Box>
                                                    )}

                                                </Box>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>

                        {fetchListError && (
                            <Box role="alert" sx={{ mt: 1.5, color: 'error.main', fontSize: '0.85rem' }}>{fetchListError}</Box>
                        )}

                        {/* Personal repo import */}
                        <Box sx={{
                            mt: 2,
                            pt: 2,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            alignItems: { xs: 'stretch', sm: 'stretch' },
                            gap: 1.5,
                        }}>
                            {downloadSchemaId === fydeosUserDefinedSchema && (
                                <CircularProgress variant="determinate" value={downloadProgress} size={22} sx={{ flexShrink: 0 }} />
                            )}
                            <TextField
                                label="GitHub Repo URL"
                                variant="filled"
                                type="url"
                                name="repoUrl"
                                autoComplete="off"
                                spellCheck={false}
                                inputRef={repoUrlInputRef}
                                error={repoError != null && !personalRepoURL}
                                onChange={e => setPersonalRepoURL(e.target.value)}
                                sx={{ flex: 1, minWidth: 0 }}
                            />
                            <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1.5, flexWrap: 'wrap' }}>
                                <TextField
                                    label="Schema Id"
                                    variant="filled"
                                    name="schemaId"
                                    autoComplete="off"
                                    spellCheck={false}
                                    inputRef={repoSchemaIdInputRef}
                                    error={repoError != null && !personalRepoSchemaId}
                                    onChange={e => setPersonalRepoSchemaId(e.target.value)}
                                    sx={{ width: { xs: '100%', sm: '150px' } }}
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => convertPersonalSchema()}
                                    disabled={downloadSchemaId != null}
                                >
                                    {$$("add_schema")}
                                </Button>
                            </Box>
                        </Box>

                        {repoError && (
                            <Box role="alert" sx={{ mt: 1, color: 'error.main', fontSize: '0.85rem' }}>{repoError}</Box>
                        )}

                        {/* ZIP import */}
                        <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                            {downloadSchemaId === 'importing' && (
                                <CircularProgress variant="determinate" value={downloadProgress} size={22} sx={{ flexShrink: 0 }} />
                            )}
                            <input
                                type="file"
                                accept=".zip"
                                id="schema-import-input"
                                style={{ display: 'none' }}
                                onChange={async (e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        await importCompiledSchema(e.target.files[0]);
                                        e.target.value = '';
                                    }
                                }}
                            />
                            <Button
                                variant="outlined"
                                startIcon={<CloudUploadIcon />}
                                onClick={() => document.getElementById('schema-import-input')?.click()}
                                disabled={downloadSchemaId != null}
                                size="small"
                            >
                                {$$("import_compiled_schema")}
                            </Button>
                            <Box sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                                {$$("import_compiled_schema_hint")}
                            </Box>
                        </Box>

                        {importError && (
                            <Box role="alert" sx={{ mt: 1, color: 'error.main', fontSize: '0.85rem' }}>{importError}</Box>
                        )}
                    </FormControl>
                </div>
            </div>

            <div className={styles.formGroup}>
                <div className={styles.formBox} style={{ padding: '8px 0' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2.5 }}>
                        <Box component="h2" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                            {$$("candidate_count")}
                        </Box>
                        <Box sx={{
                            display: 'flex',
                            alignItems: 'center',
                            bgcolor: 'action.hover',
                            borderRadius: '24px',
                            padding: '4px'
                        }}>
                            <IconButton
                                size="small"
                                aria-label={$$("decrease_candidate_count")}
                                disabled={(imeSettings.pageSize ?? kDefaultSettings.pageSize) <= kMinPageSize}
                                onClick={() => {
                                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                                    if (s > kMinPageSize) { changeSettings({ pageSize: s - 1 }) }
                                }}
                                sx={{
                                    width: 36, height: 36,
                                    borderRadius: '18px',
                                    color: 'text.secondary',
                                    '&:hover': { bgcolor: 'action.hover' }
                                }}
                            >
                                <RemoveIcon fontSize="small" />
                            </IconButton>

                            <Box sx={{ width: 44, textAlign: 'center', fontWeight: 500, fontSize: '15px', color: 'text.primary' }}>
                                {(imeSettings.pageSize ?? kDefaultSettings.pageSize).toString()}
                            </Box>

                            <IconButton
                                size="small"
                                aria-label={$$("increase_candidate_count")}
                                disabled={(imeSettings.pageSize ?? kDefaultSettings.pageSize) >= kMaxPageSize}
                                onClick={() => {
                                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                                    if (s < kMaxPageSize) { changeSettings({ pageSize: s + 1 }) }
                                }}
                                sx={{ 
                                    width: 36, height: 36,
                                    borderRadius: '18px', 
                                    color: 'text.secondary',
                                    '&:hover': { bgcolor: 'action.hover' }
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
                                {$$("schema_switch_key")}
                            </Box>
                            {/* State-aware hint: the disabled state must always carry its own
                                way back (how to re-enable), and recording explains how to bail. */}
                            <Box sx={{ fontSize: '13px', color: 'text.secondary', mt: 0.5 }}>
                                {recordingSwitchKey
                                    ? $$("schema_switch_key_hint_recording")
                                    : (switchKeyLabel
                                        ? $$("schema_switch_key_hint")
                                        : $$("schema_switch_key_hint_disabled"))}
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
                                    ? $$("schema_switch_key_recording")
                                    : (switchKeyLabel || $$("schema_switch_key_set"))}
                            </Button>
                            <Button
                                size="small"
                                disabled={!switchKeyLabel}
                                onClick={() => stopRecordingAndSetSwitchKey(null)}
                                sx={{ textTransform: 'none' }}
                            >
                                {$$("schema_switch_key_disable")}
                            </Button>
                            <Button
                                size="small"
                                disabled={imeSettings.schemaSwitchKey === undefined}
                                onClick={() => stopRecordingAndSetSwitchKey(undefined)}
                                sx={{ textTransform: 'none' }}
                            >
                                {$$("schema_switch_key_reset")}
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
                                {$$("keyboard_arrangement")}
                            </Box>
                            <Box sx={{ fontSize: '13px', color: 'text.secondary', mt: 0.5 }}>
                                {activeScript && showsInputView
                                    ? $$("keyboard_script_note", activeSchemaName || imeSettings.schema)
                                    : showsInputView
                                        ? $$("keyboard_arrangement_hint")
                                        : $$("keyboard_arrangement_hint_physical")}
                            </Box>
                        </Box>
                        <SegmentedPill
                            options={kLatinLayoutIds.map((id) => ({ value: id, label: layoutNames[id], content: layoutNames[id] }))}
                            value={arrangement}
                            onChange={(id: LatinLayoutId) => changeSettings({ keyboardLayout: id })}
                            ariaLabel={$$("keyboard_arrangement")}
                            width={92}
                            height={32}
                        />
                    </Box>
                </div>
            </div>

            {currentSchemaInfo()?.fuzzy_pinyin && <div className={styles.formGroup}>
                <div className={styles.formBox} style={{ padding: '8px 0' }}>
                    <Box component="h2" sx={{ m: 0, px: 4, py: 2.5, pb: 1.5, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
                        {$$("fuzzy_pinyin")}
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', px: 2, pb: 2 }}>
                        {kFuzzyMap.map((fuzzy) => {
                            const isChecked = imeSettings.algebraList.includes(fuzzy.value);
                            return (
                                <Box
                                    key={fuzzy.value}
                                    component="label"
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        px: 2,
                                        py: 1.25,
                                        borderRadius: '10px',
                                        cursor: 'pointer',
                                        transition: 'background 0.15s',
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
            </div>}

            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        {/* Header: section title + engine status badge */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <h2 className={styles.formLabel} style={{ marginBottom: 0 }}>{$$("rime_engine_logs")}</h2>
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
                            }}>
                                <Box sx={{
                                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                    bgcolor: engineColor,
                                }} />
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
                {manifest.name} v{manifest.version}
                <Link href={$$("privacy_statement_url")} target="_blank" underline="hover" style={{ marginLeft: "5px" }}>
                    {$$("privacy_statement")}
                </Link>
                <Link href="https://github.com/FydeOS/fydeRhythm" target="_blank" underline="hover" style={{ marginLeft: "5px" }}>
                    {$$("open_source")}
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
                message={$$("settings_changed_snackbar")}
                action={settingsDirtySnackbarActions}
            />

            <Dialog
                open={removeDialogOpen}
                onClose={() => setRemoveDialogOpen(false)}
                slotProps={{ transition: { onExited: () => setRemoveCandidate(null) } }}
                aria-labelledby="remove-schema-dialog-title"
                aria-describedby="remove-schema-dialog-desc"
            >
                <DialogTitle id="remove-schema-dialog-title">{$$("remove_schema_confirm_title")}</DialogTitle>
                <DialogContent>
                    <DialogContentText id="remove-schema-dialog-desc">
                        {removeCandidate && $$("remove_schema_confirm_body", removeCandidate.name || removeCandidate.id)}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button variant="outlined" onClick={() => setRemoveDialogOpen(false)}>
                        {$$("cancel_button")}
                    </Button>
                    <Button variant="contained" onClick={() => {
                        const id = removeCandidate!.id;
                        setRemoveDialogOpen(false);
                        void removeSchema(id);
                    }}>
                        {$$("remove_schema")}
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
                <DialogTitle id="import-predefined-dialog-title">{$$("import_predefined_schema_title")}</DialogTitle>
                <DialogContent>
                    <DialogContentText id="import-predefined-dialog-desc">
                        {importPredefinedCandidate && $$("import_predefined_schema_confirm", importPredefinedCandidate)}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button variant="outlined" onClick={() => setImportPredefinedDialogOpen(false)}>
                        {$$("cancel_button")}
                    </Button>
                    <Button variant="contained" onClick={() => {
                        const id = importPredefinedCandidate!;
                        setImportPredefinedDialogOpen(false);
                        if (!localSchemaList.includes(id)) {
                            void downloadSchema(id);
                        } else if (id !== imeSettings.schema) {
                            setActiveSchemaOnInstall(id);
                        }
                        // Already installed and active: nothing to do — don't
                        // mark the settings dirty for a no-op.
                    }}>
                        {$$("import_button")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    </ThemeProvider>
}

export default OptionsPage;
