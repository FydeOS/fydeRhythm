import FormControl from "@mui/material/FormControl";
import { sendToBackground } from "@plasmohq/messaging";
import { useEffect, useRef, useState } from "react";
import * as styles from "./styles.module.less";

function RimeLogDisplay() {
    const [rimeLogs, setRimeLogs] = useState<string[]>([]);
    const logTextArea = useRef<HTMLTextAreaElement>();

    useEffect(() => {
        // Scroll textarea to bottom on log update
        const area = logTextArea.current;
        area.scrollTop = area.scrollHeight;
    }, [rimeLogs]);

    async function updateRimeLogs() {
        const result = await sendToBackground({
            name: "GetRimeLogs"
        });
        setRimeLogs(result.logs);
    }
    
    useEffect(() => {
        updateRimeLogs();

        const listener = (m) => {
            if (m.rimeLog) {
                setRimeLogs(rimeLogs => [...rimeLogs, m.rimeLog]);
            }
        }
        chrome.runtime.onMessage.addListener(listener)

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        }
    }, []);

    return <div className={styles.formGroup}>
        <div className={styles.formBox}>
            <FormControl className={styles.formControl}>
                <div className={styles.formLabel}>{chrome.i18n.getMessage("rime_logs")}</div>
                <textarea readOnly value={rimeLogs.join("\n")} rows={14} ref={logTextArea}></textarea>
            </FormControl>
        </div>
    </div>;
}

export default RimeLogDisplay