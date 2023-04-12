import React, { useEffect, useState, useRef } from "react";
import theme from "./theme"
import { ThemeProvider } from '@mui/material/styles';
import { FormControl, FormControlLabel, Radio, RadioGroup, FormGroup, Button, Snackbar, Stack } from "@mui/material";
import * as styles from "./styles.module.less";
import "./global.css";
import Animation from "./utils/animation";
import { sendToBackground } from "@plasmohq/messaging";
import type { RimeSchema } from "~shared-types";
import FileEditorButton from "./fileEditor";
import RimeLogDisplay from "./rimeLogDisplay";
import SchemaPackDownloader from "./schemaPackDownloader";
import type { ImeSettings } from "~utils";

const schemaList = [
    { id: "rime_ice", name: "雾凇拼音" },
    { id: "double_pinyin", name: "自然码双拼" },
    { id: "double_pinyin_flypy", name: "小鹤双拼" },
    { id: "double_pinyin_mspy", name: "微软双拼" },
];

function OptionsPage() {
    let snackbarOpen = false;
    let snackbarText = "";

    const [engineStatus, setEngineStatus] = useState({ loading: false, loaded: false, currentSchema: "" as string });
    const [imeSettings, setImeSettings] = useState<ImeSettings>({schema: null, pageSize: 5, algebraList: []});

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
        await sendToBackground({
            name: "ReloadRime",
        });
    }

    async function changeSchema(id: string) {
        const newSettings = Object.assign({}, imeSettings, {schema: id});
        await chrome.storage.sync.set({settings: newSettings});
        setImeSettings(newSettings);
        await loadRime();
    }

    const engineStatusDisplay = engineStatus;

    let engineStatusString: string = "未启动";
    if (engineStatus.loading) {
        engineStatusString = "启动中";
        snackbarText = "正在启动 RIME 引擎...";
        snackbarOpen = true;
    } else if (engineStatus.loaded) {
        engineStatusString = "就绪";
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
                            <Button variant="contained" onClick={() => loadRime()} disabled={engineStatus.loading}>重新启动 RIME 引擎</Button>
                            <FileEditorButton />
                        </Stack>
                    </FormControl>
                </div>
            </div>
            <div className={styles.formGroup}>
                <div className={styles.formBox}>
                    <FormControl className={styles.formControl}>
                        <div className={styles.formLabel}>选择输入方案</div>
                        <FormGroup>
                            <RadioGroup
                                value={imeSettings.schema}
                                onChange={async (e) => changeSchema(e.target.value)}
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