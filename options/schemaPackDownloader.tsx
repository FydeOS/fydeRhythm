import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import TextField from "@mui/material/TextField";
import { useRef, useState } from "react";
import * as styles from "./styles.module.less";
import { unzip, setOptions, HTTPRangeReader } from "unzipit";
import axios, { isCancel, AxiosError } from 'axios';
import { formatBytes, getFs } from "~utils";
import { kCacheBlobSizeLimit } from "~fs";
import Stack from "@mui/material/Stack";

setOptions({ workerURL: '/assets/unzipit-worker.min.js' });

const kDefaultUrl = "https://fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm/rime-ice.zip";
function SchemaPackDownloader() {
    const [ready, setReady] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [statusText, setStatusText] = useState("");
    const textFieldRef = useRef<HTMLInputElement>();

    async function download() {
        setDownloading(true);
        try {
            const url = textFieldRef.current.value;
            const blob = await axios.get(url, {
                onDownloadProgress: (p) => {
                    setStatusText(`下载中 (${formatBytes(p.loaded)}/${formatBytes(p.total)})`);
                },
                responseType: 'arraybuffer',
            });
            setStatusText(`Reading file list from archive`);
            const { entries } = await unzip(blob.data);
            const fs = await getFs();
            const prefix = "/root/";
            await fs.createDirectory("/root");
            let pathInFile: string | null = null;
            for (const [name] of Object.entries(entries)) {
                const path = name.split('/');
                const filename = path.pop();
                const dir = path.join('/');
                if (filename === 'default.yaml' && !dir.includes("build")) {
                    pathInFile = dir;
                    break;
                }
            }
            if (pathInFile != null && pathInFile != "") {
                pathInFile += "/";
            }
            if (pathInFile != null) {
                // setStatusText(`default.yaml found at '${pathInFile}', will extract from this directory`);
                for (const [name, entry] of Object.entries(entries)) {
                    if (name.startsWith(pathInFile) && !name.includes(".userdb/")) {
                        const nname = name.substring(pathInFile.length);
                        const fullName = (prefix + nname).replace(/\/$/, '');
                        // setStatusText(`Processing '${name}'`);
                        if (entry.isDirectory) {
                            setStatusText(`Create directory '${fullName}'`);
                            await fs.createDirectory(fullName);
                        } else {
                            let chunkSizeLimit;
                            if (name.endsWith(".bin")) {
                                // .bin files are read as a whole using mapped_file when RIME session is being
                                // loaded, so don't split them into chunks.
                                chunkSizeLimit = 9999999999999;
                            } else {
                                // The remaining files (especially .txt and .yaml files) will be read 
                                // in small parts when scheme is being deployed, so they need to be split into
                                // cachable chunks to accelerate loading.
                                chunkSizeLimit = kCacheBlobSizeLimit;
                            }
                            let pos = 0;
                            setStatusText(`Extracting '${fullName}' (${formatBytes(entry.size)})`)
                            const buf = await entry.arrayBuffer();
                            setStatusText(`Writing '${fullName}' to filesystem (${formatBytes(entry.size)})`);
                            try {
                                await fs.setFileSize(fullName, 0);
                                await fs.openFile(fullName, false);
                                while (pos < buf.byteLength) {
                                    const len = Math.min(buf.byteLength - pos, chunkSizeLimit);
                                    pos += await fs.writeFile(fullName, new Uint8Array(await entry.arrayBuffer(), pos, len), pos);
                                }
                            }
                            finally {
                                await fs.closeFile(fullName);
                            }
                        }
                    } else {
                        // log(`Skipped '${name}'`);
                    }
                }
                setStatusText("解压完成，请重新启动 RIME 引擎");
            } else {
                setStatusText("未找到 default.yaml 文件，无法解压");
            }
        } catch (ex) {
            setStatusText(`错误：${ex.toString()}`);
        } finally {
            setDownloading(false);
        }
    }

    return <div className={styles.formGroup}>
        <div className={styles.formBox}>
            <FormControl className={styles.formControl}>
                <div className={styles.formLabel}>方案包</div>
                <Stack direction="row" spacing={2}>
                    <TextField
                        style={{ flexGrow: 1 }}
                        label="方案包 URL"
                        variant="outlined"
                        inputRef={textFieldRef}
                        disabled={downloading}
                        defaultValue={kDefaultUrl} />
                    <Button variant="contained" onClick={() => download()} disabled={downloading}>下载方案包</Button>
                </Stack>
                <div>{statusText}</div>
            </FormControl>
        </div>
    </div>;
}

export default SchemaPackDownloader;