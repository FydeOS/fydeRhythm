import React, { useEffect, useState, useRef } from "react";
import theme from "./theme"
import { ThemeProvider } from '@mui/material/styles';
import { FormControl, FormControlLabel, Radio, RadioGroup, FormGroup, Button, Snackbar, Stack, Slider, Checkbox } from "@mui/material";
import * as styles from "./styles.module.less";
import "./global.css";
import Animation from "./utils/animation";
import { sendToBackground } from "@plasmohq/messaging";
import type { RimeSchema } from "~shared-types";
import FileEditorButton from "./fileEditor";
import RimeLogDisplay from "./rimeLogDisplay";
import SchemaPackDownloader from "./schemaPackDownloader";
import type { ImeSettings } from "~utils";
import _ from "lodash";

const schemaList = [
    { id: "rime_ice", name: "雾凇拼音" },
    { id: "double_pinyin", name: "自然码双拼" },
    { id: "double_pinyin_flypy", name: "小鹤双拼" },
    { id: "double_pinyin_mspy", name: "微软双拼" },
];

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

function OptionsPage() {
    let snackbarOpen = false;
    let snackbarText = "";

    const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: "" as string });
    const [imeSettings, setImeSettings] = useState<ImeSettings>(kDefaultSettings);
    const [settingsDirty, setSettingsDirty] = useState(false);

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

    useEffect(() => {
        // update RIME status upon loading
        updateRimeStatus();
        loadSettings();

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
                    {settingsDirty && <p style={{color: "red"}}>设置已经修改，请点击保存按钮</p>}
                </div>
            </div>
            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>选择输入方案</div>
                        <FormGroup>
                            <RadioGroup
                                value={imeSettings.schema}
                                onChange={async (e) => changeSettings({ schema: e.target.value })}
                                name="schema"
                                row
                            >
                                {
                                    schemaList.map((schema) =>
                                        <FormControlLabel
                                            control={<Radio />}
                                            value={schema.id}
                                            label={schema.name}
                                            key={"schema" + schema.id}
                                        />
                                    )
                                }
                            </RadioGroup>
                        </FormGroup>
                    </FormControl>
                </div>
            </div>

            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>每页候选词个数 {imeSettings.pageSize}</div>
                        <Slider
                            value={imeSettings.pageSize}
                            onChange={(e, v) => changeSettings({ pageSize: v })}
                            valueLabelDisplay="auto"
                            step={1}
                            marks={getArray(kMinPageSize, kMaxPageSize)}
                            min={kMinPageSize}
                            max={kMaxPageSize}
                        />
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