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

function OptionsPage() {
    let snackbarOpen = false;
    let snackbarText = "";

    const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: "" as string });
    const [imeSettings, setImeSettings] = useState<ImeSettings>(kDefaultSettings);
    const [settingsDirty, setSettingsDirty] = useState(false);

    const [schemaList, setSchemaList] = useState<SchemaListFile>({schemas: []});
    const [fetchingList, setFetchingList] = useState<boolean>(false);
    const [fetchListError, setFetchListError] = useState<string>(null);

    const [localSchemaList, setLocalSchemaList] = useState<string[]>([]);

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
        console.log(content.map(c=>c.fullPath));
        console.log(content.map(c=>[...c.fullPath.matchAll(schemaRegex)]));
        const list = content.map(c => [...c.fullPath.matchAll(schemaRegex)]).filter(c => c.length == 1).map(c => c[0][1].toString());
        console.log("Local schema: ",list);
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
            const text = (await axios.get('https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm/schema-list.yaml', {
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
    function getArray(start, end) {
        return Array.from(Array(end - start + 1).keys()).map(i => ({
            value: i + start,
            label: (i + start).toString()
        }))
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
                        <List>
                            {schemaList.schemas.map((schema) =>
                                <ListItem key={schema.id} disablePadding>
                                    <ListItemIcon>
                                        {localSchemaList.includes(schema.id) ?
                                            <Radio
                                                checked={imeSettings.schema == schema.id}
                                                tabIndex={-1}
                                            /> :
                                            <IconButton>
                                                <CloudDownloadIcon />
                                            </IconButton>}
                                    </ListItemIcon>
                                    <ListItemText primary={schema.name} secondary={schema.description} />
                                </ListItem>)}
                        </List>
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


            <div className={styles.formGroup}>
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
            </div>

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