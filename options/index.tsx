import React, { useEffect, useState, useRef } from "react";
import _ from "lodash";
import axios from "axios";
import { parse, stringify } from 'yaml'
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
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import RadioGroup from '@mui/material/RadioGroup'
import ListItem from '@mui/material/ListItem';
import List from '@mui/material/List';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';

import Animation from "./utils/animation";
import { sendToBackground } from "@plasmohq/messaging";
import FileEditorButton from "./fileEditor";
import RimeLogDisplay from "./rimeLogDisplay";
import SchemaPackDownloader from "./schemaPackDownloader";
import { getFs, ImeSettings } from "~utils";
import CircularProgress from "@mui/material/CircularProgress";

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

const kDefaultSettings = { schema: null, pageSize: 5, algebraList: [] };

interface SchemaDescription {
    id: string;
    name: string;
    description: string;
    website: string;
    extra_data: boolean | undefined;
    fuzzy_pinyin: boolean | undefined;
}

interface SchemaListFile {
    schemas: SchemaDescription[];
}

const kRepoUrl = "https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm";

function OptionsPage() {
    let snackbarOpen = false;
    let snackbarText = "";

    const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: "" as string });
    const [imeSettings, setImeSettings] = useState<ImeSettings>(kDefaultSettings);
    const [settingsDirty, setSettingsDirty] = useState(false);

    const [schemaList, setSchemaList] = useState<SchemaListFile>({ schemas: [] });
    const [fetchingList, setFetchingList] = useState<boolean>(false);
    const [fetchListError, setFetchListError] = useState<string>(null);

    const [localSchemaList, setLocalSchemaList] = useState<string[]>([]);

    const kTotalProgress = 100;
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadSchemaId, setDownloadSchemaId] = useState(null);

    // chrome.storage.local.get

    async function updateRimeStatus() {
        const result = await sendToBackground({
            name: "GetEngineStatus"
        });
        setEngineStatus(result);
    }

    async function loadSettings() {
        const obj = await chrome.storage.sync.get(["settings"]);
        if (obj.settings) {
            setImeSettings(obj.settings);
        }
    }

    async function loadLocalSchemaList(): Promise<void> {
        const fs = await getFs();
        const content = await fs.readAll();
        const schemaRegex = /\/root\/build\/(\w+)\.schema\.yaml/g;
        console.log(content.map(c => c.fullPath));
        console.log(content.map(c => [...c.fullPath.matchAll(schemaRegex)]));
        const list = content.map(c => [...c.fullPath.matchAll(schemaRegex)]).filter(c => c.length == 1).map(c => c[0][1].toString());
        console.log("Local schema: ", list);
        setLocalSchemaList(list);
    }

    async function loadSchemaList() {
        const l = await chrome.storage.local.get(["schemaList"]);
        if (l.schemaList) {
            setSchemaList(l.schemaList);
        }
        setFetchingList(true);
        let newData: SchemaListFile;
        try {
            const text = (await axios.get(`${kRepoUrl}/schema-list.yaml`, {
                responseType: 'text',
            })).data;
            newData = parse(text);
        } catch (error) {
            console.log(error.toString());
            setFetchListError(error.toString());
            return;
        } finally {
            setFetchingList(false);
        }
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
        setSettingsDirty(false);
        await chrome.storage.sync.set({ settings: imeSettings });
        await sendToBackground({
            name: "ReloadRime",
        });
    }

    function changeSettings(change: any) {
        const newSettings = Object.assign({}, imeSettings, change);
        setSettingsDirty(true);
        setImeSettings(newSettings);
    }

    function changeFuzzy(chk: boolean, val: string) {
        if (chk) {
            changeSettings({ algebraList: _.uniq([...imeSettings.algebraList, val]) });
        } else {
            changeSettings({ algebraList: imeSettings.algebraList.filter(a => a != val) });
        }
    }

    let engineStatusString: string = "未启动";
    if (engineStatus.loading) {
        engineStatusString = "启动中";
        snackbarText = "正在启动 RIME 引擎...";
        snackbarOpen = true;
    } else if (engineStatus.loaded) {
        engineStatusString = "就绪";
    }

    const kMinPageSize = 3, kMaxPageSize = 9;
    function currentSchemaInfo(): SchemaDescription | null {
        return schemaList.schemas.filter(x => x.id == imeSettings.schema)[0] || null;
    }

    async function downloadSchema(id: string) {
        try {
            setDownloadSchemaId(id);
            setDownloadProgress(0);
            const schemaFile = `build/${id}.schema.yaml`;
            const schemaYaml: string = (await axios.get(`${kRepoUrl}/${schemaFile}`, {
                responseType: 'text',
            })).data;
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
                        const opencc_config = (await axios.get(`${kRepoUrl}/${configPath}`, {
                            responseType: 'text',
                        })).data;
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
                    if (tn[0] == "script_translator" || tn[0] == "table_translator") {
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
                if (await fs.readEntry(`/root/${f}`)) {
                    // file already exists
                    console.log(`${f} already exists, skipped`);
                } else {
                    let controller = new AbortController();
                    const res = await fetch(`${kRepoUrl}/${f}`, { signal: controller.signal });
                    const size = parseInt(res.headers.get('Content-Length'));
                    if ((size && size < 70 * 1024) ||
                        // If response is gzipped, size = NaN
                        isNaN(size)
                    ) {
                        const buf = await res.arrayBuffer();
                        fs.writeWholeFile(`/root/${f}`, new Uint8Array(buf));
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
                const res = await fetch(`${kRepoUrl}/${f}`);
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
                fs.writeWholeFile(`/root/${f}`, new Uint8Array(buf));
                console.log("Downloaded", f);
            }
            // Schema should be the last file to be written, in case an error is encountered while downloading
            await fs.writeWholeFile(`/root/${schemaFile}`, new TextEncoder().encode(schemaYaml));
        } catch (ex) {
            console.log(ex);
        } finally {
            await loadLocalSchemaList();
            setDownloadSchemaId(null);
        }
    }

    return <ThemeProvider theme={theme}>
        <div className={styles.content}>
            <div style={{ position: 'absolute', top: 30, left: 30 }}>
                <object type="image/svg+xml" data="/assets/logo.svg"></object>
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
            <SchemaPackDownloader />
            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>RIME 引擎状态：{engineStatusString}</div>
                        <Stack spacing={2} direction="row">
                            <Button variant="contained" onClick={() => loadRime()} disabled={engineStatus.loading}>保存设置，重新启动 RIME 引擎</Button>
                            <FileEditorButton />
                        </Stack>
                    </FormControl>
                    {settingsDirty && <p style={{ color: "red" }}>设置已经修改，请点击保存按钮（这个后面可以改成这样：修改设置后在页面底部弹出一条提示保存的横条，把保存按钮移动到里面去）</p>}
                </div>
            </div>
            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>选择输入方案{fetchingList ? "（正在刷新列表）" : ""}</div>
                        <RadioGroup
                            value={imeSettings.schema}
                            onChange={(e, v) => changeSettings({ schema: v })}
                        >
                            <List>
                                {schemaList.schemas.map((schema) =>
                                    <ListItem key={schema.id} disablePadding>
                                        <ListItemIcon>
                                            {localSchemaList.includes(schema.id) ? <Radio value={schema.id} /> :
                                                downloadSchemaId == schema.id ? <CircularProgress variant="determinate" value={downloadProgress} /> :
                                                    <IconButton onClick={() => downloadSchema(schema.id)}>
                                                        <CloudDownloadIcon />
                                                    </IconButton>}
                                        </ListItemIcon>
                                        <ListItemText primary={schema.name} secondary={schema.description} />
                                    </ListItem>)}
                            </List>
                        </RadioGroup>
                    </FormControl>
                </div>
            </div>

            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.pageSize}>
                            <div className={styles.formLabel}>单页候选词数量</div>

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
                </div>
            </div>

            {currentSchemaInfo()?.fuzzy_pinyin && <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>设置模糊音</div>
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

            <RimeLogDisplay />

            <div className={styles.footer}>FydeOS is made possible by gentle souls with real ❤️</div>
            <Snackbar
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'center',
                }}
                open={snackbarOpen}
                autoHideDuration={3000}
                ContentProps={{
                    'aria-describedby': 'message-id',
                }}
                onClose={() => this.setState({ snackbarOpen: false, snackbarText: "" })}
                message={<span id="message-id">{snackbarText}</span>}
            />
        </div>
    </ThemeProvider>
}

export default OptionsPage;