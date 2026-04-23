import React, { useEffect, useState, useRef } from "react";
import _, { set } from "lodash";
import { parse, stringify } from 'yaml'
import JSZip from 'jszip';
import { ThemeProvider } from '@mui/material/styles';

import theme from "./theme"
import * as styles from "./styles.module.less";
import "./global.css";

import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import FormControl from "@mui/material/FormControl";
import TextField from "@mui/material/TextField";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import RadioGroup from '@mui/material/RadioGroup'
import ListItem from '@mui/material/ListItem';
import List from '@mui/material/List';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import Animation from "./utils/animation";
import FileEditorButton from "./fileEditor";
import RimeLogDisplay from "./rimeLogDisplay";
import { $$, getFs, type ImeSettings, kDefaultSettings } from "@/lib/utils";
import { sendMessage } from "@/lib/messaging";
import Link from "@mui/material/Link";
import { CompressTwoTone, Settings, Visibility } from "@mui/icons-material";
import { Input } from "@mui/material";

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
    user: boolean | undefined;
    realName: string | undefined;
    extra_data: boolean | undefined;
    fuzzy_pinyin: boolean | undefined;
}

interface SchemaListFile {
    schemas: SchemaDescription[];
}

const kRepoUrl = "https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm";
const kConventerUrl = 'https://rime-conf-translator.fydeos.io'

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

    const [schemaList, setSchemaList] = useState<SchemaListFile>({ schemas: [] });
    const [fetchingList, setFetchingList] = useState<boolean>(false);
    const [fetchListError, setFetchListError] = useState<string>(null);

    const [localSchemaList, setLocalSchemaList] = useState<string[]>([]);

    const kTotalProgress = 100;
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadSchemaId, setDownloadSchemaId] = useState(null);

    const [personalRepoURL, setPersonalRepoURL] = useState<string>(null);
    const [personalRepoSchemaId, setPersonalRepoSchemaId] = useState<string>(null);

    const fydeosUserDefinedSchema = "fydeosUserDefinedSchema";

    // chrome.storage.local.get

    async function updateRimeStatus() {
        const result = await sendMessage("GetEngineStatus");
        setEngineStatus(result);
    }

    async function loadSettings() {
        const obj = await chrome.storage.sync.get(["settings"]);
        if (obj.settings) {
            setImeSettings(obj.settings);
            setSettingsDirty(SettingsDirtyStatus.NotDirty);
        }
    }

    async function loadLocalSchemaList(): Promise<string[]> {
        const fs = await getFs();
        const content = await fs.readAll();
        // Recognize schemas by directory name under /root/
        const schemaDirRegex = /^\/root\/([^/]+)$/;
        const list = content
            .filter(c => c.isDirectory && schemaDirRegex.test(c.fullPath))
            .map(c => c.fullPath.match(schemaDirRegex)[1]);
        setLocalSchemaList(list);
        console.log("Local schema list:", list);
        return list;
    }

    async function loadSchemaList() {
        const l = await chrome.storage.local.get(["schemaList"]);
        console.log("loadSchemaList:", l.schemaList);
        setFetchingList(true);
        let newData: SchemaListFile;
        try {
            const text = await fetch(`${kRepoUrl}/schema-list.yaml`, {
                method: "GET",
                mode: "cors",
                cache: "no-cache",
            }).then(x => x.text());
            newData = parse(text);
        } catch (error) {
            setFetchListError($$("error_fetch_schema_list") + error.toString());
            return;
        } finally {
            setFetchingList(false);
        }
        console.log("fetch", newData);
        const selfDefinedSchema = await getSelfDefinedSchemaList();
        newData.schemas = newData.schemas.concat(selfDefinedSchema);
        console.log(newData);
        setSchemaList(newData);
        await chrome.storage.local.set({ schemaList: newData });
    }

    useEffect(() => {
        // update RIME status upon loading
        updateRimeStatus();
        loadSettings();
        loadSchemaList();
        loadLocalSchemaList();

        const listener = (m, s, resp) => {
            if (m.rimeStatusChanged) {
                updateRimeStatus();
            }
        }
        chrome.runtime.onMessage.addListener(listener)

        const settingsChangeListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.settings) {
                setImeSettings(changes.settings.newValue);
            }
        };
        chrome.storage.sync.onChanged.addListener(settingsChangeListener);

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
            chrome.storage.sync.onChanged.removeListener(settingsChangeListener);
        }
    }, []);

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
        const newSettings = Object.assign({}, imeSettings, change);
        setSettingsDirty(SettingsDirtyStatus.Dirty);
        setImeSettings(newSettings);
    }

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

    // Called at the end of each install path (download / convert / import).
    // Auto-enables the new schema only if the user has already opted into explicit enable lists.
    function setActiveSchemaOnInstall(id: string) {
        const nextEnabled = imeSettings.enabledSchemas
            ? _.uniq([...imeSettings.enabledSchemas, id])
            : undefined;
        changeSettings({ schema: id, ...(nextEnabled ? { enabledSchemas: nextEnabled } : {}) });
    }

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
        return schemaList.schemas.filter(x => x.id == imeSettings.schema)[0] || null;
    }

    async function addSelfDefinedSchema(id: string, name: string, description: string, website: string, realName: string) {
        const selfDefinedSchema = await getSelfDefinedSchemaList();
        const user = true;
        const item = {id, name, description, website, realName, user};
        let result = selfDefinedSchema.filter( el => (el.id != id) );
        result.push(item);
        chrome.storage.local.set({ "selfDefinedSchema": result });
        loadSchemaList();
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
            const wasSelfDefined = selfDefinedSchema.some(el => el.id === id);
            if (wasSelfDefined) {
                let result = selfDefinedSchema.filter(el => (el.id != id));
                chrome.storage.local.set({ "selfDefinedSchema": result });
            }

            const strippedEnabled = imeSettings.enabledSchemas?.filter(x => x !== id);
            const enabledChange = (strippedEnabled && strippedEnabled.length !== imeSettings.enabledSchemas!.length)
                ? { enabledSchemas: strippedEnabled }
                : {};

            await loadLocalSchemaList();
            if (Object.keys(enabledChange).length > 0) {
                changeSettings(enabledChange);
            }
            await loadSchemaList();
        } catch (ex) {
            console.error("Error removing schema:", ex);
            setFetchListError($$("error_removing_schema") + ex.toString());
        }
    }

    async function getSelfDefinedSchemaList() {
        const l = await chrome.storage.local.get(["selfDefinedSchema"]);
        console.log("selfDefinedSchema", l.selfDefinedSchema);
        if (l.selfDefinedSchema) {
            return l.selfDefinedSchema;
        } else {
            return [];
        } 
    }

    async function convertPersonalSchema(repo: string='', schema_id: string='', force: boolean=false, convert_schema_id: string='') {
        setFetchListError('');
        try {
            if (convert_schema_id) {
                setDownloadSchemaId(convert_schema_id);
            } else {
                setDownloadSchemaId(fydeosUserDefinedSchema);
            }

            setDownloadProgress(5);

            const fetchInit: RequestInit = { cache: "no-cache" };
            
            let postData = {repo, schema_id, force};

            if (postData.repo == '') {
                postData.repo = personalRepoURL;
            }

            if (postData.schema_id == '') {
                postData.schema_id = personalRepoSchemaId;
            }

            if (!(postData.repo && postData.schema_id)) {
                setFetchListError($$("error_form"));
                return;
            }

            const data = await fetch(kConventerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData),
            }).then(x => x.json())

            if (data['status'] != 'complete') {
                setFetchListError($$("error_downloading_schema") + data['message']);
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
                        const config = JSON.parse(opencc_config);

                        function parseDict(dict) {
                            if (dict.type === 'ocd2' || dict.type === 'text') {
                                dependencies.add(`shared/opencc/${dict.file}`);
                            } else if (dict.type === 'group') {
                                dict.dicts.forEach(d => parseDict(d));
                            }
                        }

                        if (config.segmentation && config.segmentation.dict) {
                            parseDict(config.segmentation.dict);
                        }

                        if (config.conversion_chain) {
                            config.conversion_chain.forEach(step => {
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
                    let controller = new AbortController();
                    const res = await fetch(`${kRepoUrl}/${f}`, { signal: controller.signal, ...fetchInit });
                    const size = parseInt(res.headers.get('Content-Length'));
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
            let phase2TotalSize = _.sum(phase2Sizes);
            for (let i = 0; i < phase2Files.length; i++) {
                const f = phase2Files[i];
                const res = await fetch(`${kRepoUrl}/${f}`, fetchInit);
                const reader = res.body.getReader();
                const buf = new ArrayBuffer(phase2Sizes[i]);
                let offset = 0;
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = new Uint8Array(buf, offset, value.length);
                    chunk.set(new Uint8Array(value));
                    offset += value.length;
                    downloadedSize += value.length;
                    let newProgress = kPhase1Weight + (kTotalProgress - kPhase1Weight) * downloadedSize / phase2TotalSize;
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
            await addSelfDefinedSchema(id, schema.schema.name, schema.schema.description, data['repo'], postData.schema_id);
            setActiveSchemaOnInstall(id);
        } catch (ex) {
            console.log(ex);
            setFetchListError($$("error_downloading_schema") + 'repo conf error');
        } finally {
            await loadLocalSchemaList();
            setDownloadSchemaId(null);
        }
    }

    async function downloadSchema(id: string, update: boolean = false) {
        setFetchListError('');
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
                        const config = JSON.parse(opencc_config);

                        function parseDict(dict) {
                            if (dict.type === 'ocd2' || dict.type === 'text') {
                                dependencies.add(`shared/opencc/${dict.file}`);
                            } else if (dict.type === 'group') {
                                dict.dicts.forEach(d => parseDict(d));
                            }
                        }

                        if (config.segmentation && config.segmentation.dict) {
                            parseDict(config.segmentation.dict);
                        }

                        if (config.conversion_chain) {
                            config.conversion_chain.forEach(step => {
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
                    let controller = new AbortController();
                    const res = await fetch(`${kRepoUrl}/${f}`, { signal: controller.signal, ...fetchInit });
                    const size = parseInt(res.headers.get('Content-Length'));
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
            let phase2TotalSize = _.sum(phase2Sizes);
            for (let i = 0; i < phase2Files.length; i++) {
                const f = phase2Files[i];
                const res = await fetch(`${kRepoUrl}/${f}`, fetchInit);
                const reader = res.body.getReader();
                const buf = new ArrayBuffer(phase2Sizes[i]);
                let offset = 0;
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = new Uint8Array(buf, offset, value.length);
                    chunk.set(new Uint8Array(value));
                    offset += value.length;
                    downloadedSize += value.length;
                    let newProgress = kPhase1Weight + (kTotalProgress - kPhase1Weight) * downloadedSize / phase2TotalSize;
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
            setFetchListError($$("error_downloading_schema") + ex.toString());
        } finally {
            await loadLocalSchemaList();
            setDownloadSchemaId(null);
        }
    }

    // Helper function to map server file paths to virtual filesystem paths
    function mapToVfsPath(serverPath: string): string {
        // Lua files need to be in shared/lua/ for librime to find them
        if (serverPath.startsWith('lua/')) {
            return 'shared/' + serverPath;
        }
        return serverPath;
    }

    // Validate imported schema
    async function validateImportedSchema(schemaId: string): Promise<{ schemaConfig: any }> {
        const fs = await getFs();

        // Check for required files
        const schemaBasePath = `/root/${schemaId}`;
        const requiredFile = `${schemaBasePath}/build/${schemaId}.schema.yaml`;
        const schemaYaml = await fs.readEntry(requiredFile);

        if (!schemaYaml) {
            throw new Error(`Missing required file: ${schemaId}.schema.yaml`);
        }

        // Parse and validate schema.yaml
        const content = await fs.readWholeFile(requiredFile);
        const textDecoder = new TextDecoder();
        const schemaConfig = parse(textDecoder.decode(content));

        if (!schemaConfig.schema || !schemaConfig.schema.schema_id) {
            throw new Error('Invalid schema.yaml format - missing schema.schema_id');
        }

        console.log(`Schema ${schemaId} validated successfully`);
        return { schemaConfig };
    }

    // Import compiled schema from ZIP file
    async function importCompiledSchema(zipFile: File) {
        setFetchListError('');
        try {
            setDownloadSchemaId('importing');
            setDownloadProgress(10);

            const fs = await getFs();
            const zip = await JSZip.loadAsync(zipFile);

            let schemaId = null;
            const files: string[] = [];
            const totalFiles = Object.keys(zip.files).length;
            let processedFiles = 0;

            // First pass: detect schema ID
            for (const [filename, zipEntry] of Object.entries(zip.files)) {
                if (zipEntry.dir) continue;

                // Detect schema ID from .schema.yaml filename in build/ directory
                const match = filename.match(/(?:^|\/|build\/)([^/]+)\.schema\.yaml$/);
                if (match) {
                    schemaId = match[1];
                    console.log(`Detected schema ID: ${schemaId}`);
                    break;
                }
            }

            if (!schemaId) {
                throw new Error('Could not detect schema ID. ZIP must contain a .schema.yaml file.');
            }

            const schemaBasePath = `/root/${schemaId}`;
            setDownloadProgress(20);

            // Second pass: extract all files
            for (const [filename, zipEntry] of Object.entries(zip.files)) {
                if (zipEntry.dir) continue;

                const content = await zipEntry.async('uint8array');

                // Determine the virtual filesystem path
                let vfsPath: string;

                // Only strip leading directory if it's a wrapper (not build/, shared/, lua/, opencc/)
                let cleanFilename = filename;
                const knownDirs = ['build/', 'shared/', 'lua/', 'opencc/'];
                const startsWithKnownDir = knownDirs.some(dir => filename.startsWith(dir));

                if (!startsWithKnownDir && filename.includes('/')) {
                    const parts = filename.split('/');
                    // Strip first directory if it's a wrapper (e.g., "schema-name/build/file.yaml" → "build/file.yaml")
                    if (parts.length > 2 && !parts[0].includes('.')) {
                        cleanFilename = parts.slice(1).join('/');
                    }
                }

                // Map to virtual filesystem path
                vfsPath = mapToVfsPath(cleanFilename);

                // Write to virtual filesystem
                await fs.writeWholeFile(`${schemaBasePath}/${vfsPath}`, content);
                files.push(vfsPath);
                console.log(`Imported: ${vfsPath}`);

                processedFiles++;
                setDownloadProgress(20 + (70 * processedFiles / totalFiles));
            }

            setDownloadProgress(90);

            // Create .rime.lua initialization file if Lua files were imported
            const hasLuaFiles = files.some(f => f.startsWith('shared/lua/') && f.endsWith('.lua'));
            if (hasLuaFiles) {
                const rimeluaContent = `-- Auto-generated initialization file for ${schemaId}
-- This file is required by librime's Lua plugin
return {}
`;
                const encoder = new TextEncoder();
                await fs.writeWholeFile(`${schemaBasePath}/shared/${schemaId}.rime.lua`, encoder.encode(rimeluaContent));
                console.log(`Created initialization file: ${schemaBasePath}/shared/${schemaId}.rime.lua`);
            }

            // Validate the imported schema and get schema info
            const { schemaConfig } = await validateImportedSchema(schemaId);

            setDownloadProgress(90);

            // Add schema to self-defined schema list so it appears in UI
            const schemaName = schemaConfig.schema?.name || '';
            const schemaDescription = schemaConfig.schema?.description || 'Imported from ZIP';
            await addSelfDefinedSchema(
                schemaId,
                schemaName,
                schemaDescription,
                '', // no website for imported schemas
                schemaId // realName = schemaId for imported schemas
            );

            setDownloadProgress(95);

            console.log(`Schema ${schemaId} imported successfully! Total files: ${files.length}`);

            // Update local schema list
            await loadLocalSchemaList();

            // Set as active schema
            setActiveSchemaOnInstall(schemaId);

            setDownloadProgress(100);

            // Show success message temporarily
            setTimeout(() => {
                setFetchListError('');
            }, 3000);

        } catch (ex) {
            console.error('Import error:', ex);
            setFetchListError($$("error_importing_schema") + ': ' + ex.toString());
        } finally {
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

    return <ThemeProvider theme={theme}>
        <div className={styles.content}>
            <div style={{ position: 'absolute', top: 30, left: 30 }}>
                <object type="image/svg+xml" data="/logo.svg"></object>
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
                        <div className={styles.formLabel}>{$$("select_schema")}{fetchingList ? $$("fetching_schema_list") : ""}</div>
                        <RadioGroup
                            value={imeSettings.schema}
                            onChange={(e, v) => changeSettings({ schema: v })}
                        >
                            <List>
                                {schemaList.schemas.map((schema) =>
                                    <ListItem 
                                        key={schema.id} 
                                        alignItems="flex-start"
                                        style={{ paddingTop: '8px', paddingBottom: '8px' }}
                                    >
                                        <ListItemIcon>
                                            {downloadSchemaId == schema.id ? <CircularProgress variant="determinate" value={downloadProgress} /> :
                                                localSchemaList.includes(schema.id) ?
                                                    <Radio value={schema.id} /> :
                                                    <IconButton onClick={() =>downloadSchema(schema.id)} disabled={downloadSchemaId != null}>
                                                        <CloudDownloadIcon />
                                                    </IconButton>}
                                        </ListItemIcon>
                                        <ListItemText
                                            disableTypography
                                            primary={<div style={{ fontSize: '1rem', fontWeight: localSchemaList.includes(schema.id) ? 500 : 400 }}>
                                                {schema.user ? schema.realName : schema.id } { schema.name }
                                                {localSchemaList.includes(schema.id) && (!schema.user || schema.website) &&
                                                    <Link component="button" underline="hover"
                                                        onClick={() =>  {
                                                            schema.user  ? convertPersonalSchema(schema.website, schema.realName, true, schema.id) : downloadSchema(schema.id, true)
                                                        }}
                                                        style={{ marginLeft: "8px", fontSize: "0.85rem" }}
                                                        disabled={downloadSchemaId != null}>
                                                        {$$("update_schema")}
                                                    </Link>
                                                }
                                                {localSchemaList.includes(schema.id) && (() => {
                                                    const isActive = schema.id === imeSettings.schema;
                                                    return <Link
                                                        component="button"
                                                        underline="hover"
                                                        onClick={() => removeSchema(schema.id)}
                                                        style={{
                                                            marginLeft: "8px",
                                                            fontSize: "0.85rem",
                                                            opacity: isActive ? 0.45 : 1,
                                                            cursor: isActive ? "not-allowed" : undefined,
                                                        }}
                                                        color={isActive ? "primary.main" : "error"}
                                                        disabled={downloadSchemaId != null || isActive}>
                                                        {$$("remove_schema")}
                                                    </Link>;
                                                })()}
                                            </div>}
                                            secondary={<Stack direction="column" spacing={0.5} sx={{ mt: 0.5 }}>
                                                <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                                                    {schema.description}
                                                    {schema.website &&
                                                        <Link href={schema.website} target="_blank" underline="hover" style={{ marginLeft: "8px" }}>
                                                            {$$("schema_home_page")}
                                                        </Link>
                                                    }
                                                </Box>
                                                {localSchemaList.includes(schema.id) && (
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                size="small"
                                                                checked={isSchemaEnabled(schema.id)}
                                                                disabled={schema.id === imeSettings.schema}
                                                                onChange={(_, checked) => toggleSchemaEnabled(schema.id, checked)}
                                                                color="primary"
                                                            />
                                                        }
                                                        label={
                                                            <span style={{ fontSize: '0.85rem', color: 'var(--mui-palette-text-secondary, gray)' }}>
                                                                {$$("enable_schema_hint")}
                                                            </span>
                                                        }
                                                    />
                                                )}
                                            </Stack>}
                                        />
                                    </ListItem>)}
                                <ListItem key="1000" disablePadding>
                                    <ListItemIcon>
                                    {downloadSchemaId == fydeosUserDefinedSchema ? <CircularProgress variant="determinate" value={downloadProgress} /> : <></>}
                                    </ListItemIcon>
                                    <TextField
                                        className={styles.input}
                                        id="filled"
                                        label="GitHub Repo URL"
                                        variant="filled"
                                        onChange={e => {
                                            let v = e.target.value;
                                            setPersonalRepoURL(v);
                                        }}
                                        style={{ width: "400px" }}
                                    />
                                
                                    <TextField
                                        className={styles.input}
                                        id="filled"
                                        label="schema Id"
                                        variant="filled"
                                        onChange={e => {
                                            let v = e.target.value;
                                            setPersonalRepoSchemaId(v);
                                        }}
                                        style={{ width: "150px", marginLeft: "8px" }}
                                    />
                                    <Link component="button" underline="hover"
                                        onClick={() => convertPersonalSchema()}
                                        style={{ marginLeft: "8px" }}
                                        disabled={downloadSchemaId != null}>
                                        {$$("add_schema")}
                                    </Link>
                                </ListItem>
                                <ListItem disablePadding style={{ marginTop: "16px" }}>
                                    <ListItemIcon>
                                        {downloadSchemaId == 'importing' ? <CircularProgress variant="determinate" value={downloadProgress} /> : <></>}
                                    </ListItemIcon>
                                    <input
                                        type="file"
                                        accept=".zip"
                                        id="schema-import-input"
                                        style={{ display: 'none' }}
                                        onChange={async (e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                await importCompiledSchema(e.target.files[0]);
                                                // Reset the input so the same file can be selected again
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
                                    <Box sx={{ fontSize: '0.85rem', color: 'text.secondary', marginLeft: '12px' }}>
                                        {$$("import_compiled_schema_hint")}
                                    </Box>
                                </ListItem>
                            </List>
                        </RadioGroup>
                        <p>{fetchListError && <Box sx={{ color: "error.main" }}>{fetchListError}</Box>}</p>
                    </FormControl>
                </div>
            </div>

            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.pageSize}>
                            <div className={styles.formLabel}>{$$("candidate_count")}</div>

                            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
                                <IconButton onClick={() => {
                                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                                    if (s > kMinPageSize) { changeSettings({ pageSize: s - 1 }) }
                                }}>
                                    <RemoveIcon />
                                </IconButton>

                                <TextField
                                    className={styles.input}
                                    id="outlined-basic"
                                    variant="outlined"
                                    value={imeSettings.pageSize?.toString() ?? ""}
                                    onChange={e => {
                                        let v = e.target.value;
                                        if (v.length >= 2) {
                                            v = v.substring(v.length - 1);
                                        }
                                        let val = parseInt(v);
                                        if (!isNaN(val) && val >= kMinPageSize && val <= kMaxPageSize) {
                                            changeSettings({ pageSize: val });
                                        } else if (v.length == 0) {
                                            changeSettings({ pageSize: null });
                                        }
                                    }}
                                />

                                <IconButton onClick={() => {
                                    const s = imeSettings.pageSize ?? kDefaultSettings.pageSize;
                                    if (s < kMaxPageSize) { changeSettings({ pageSize: s + 1 }) }
                                }}>
                                    <AddIcon />
                                </IconButton>
                            </div>
                        </div>
                    </FormControl>

                    <FormControl className={styles.formControl} style={{ display: "none" }}>
                        <div className={styles.formLabel}>{$$("candidates_layout")}</div>
                        <FormGroup>
                            <RadioGroup
                                value={imeSettings.horizontal ?? false}
                                onChange={(e) => changeSettings({ horizontal: e.target.value === "true" ? true : false })}
                                name="layoutHorizontal"
                                row
                            >
                                <FormControlLabel
                                    control={<Radio />}
                                    value={false}
                                    label={$$("layout_vertical")}
                                />
                                <FormControlLabel
                                    control={<Radio />}
                                    value={true}
                                    label={$$("layout_horizontal")}
                                />
                            </RadioGroup>
                        </FormGroup>
                    </FormControl>
                </div>
            </div>

            {currentSchemaInfo()?.fuzzy_pinyin && <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>{$$("fuzzy_pinyin")}</div>
                        <FormGroup row>
                            {
                                kFuzzyMap.map((fuzzy) =>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                value={fuzzy.value}
                                                name={fuzzy.label}
                                                checked={imeSettings.algebraList.includes(fuzzy.value)}
                                                onChange={async (e) => changeFuzzy(e.target.checked, e.target.value)}
                                            />
                                        }
                                        label={fuzzy.label}
                                        key={fuzzy.value}
                                    />
                                )
                            }
                        </FormGroup>
                    </FormControl>
                </div>
            </div>}

            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>{$$("rime_engine_logs")}</div>
                        <div className={styles.formLabel}>{$$("rime_engine_status")}
                            <Box sx={{ color: engineColor, display: 'inline' }}> {engineStatusString}</Box>
                        </div>
                        <RimeLogDisplay />
                        <div className={styles.formLabel} style={{ marginTop: "10px" }}>
                            <FileEditorButton onEdit={() => setSettingsDirty(SettingsDirtyStatus.Dirty)} />
                        </div>
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
        </div>
    </ThemeProvider>
}

export default OptionsPage;
