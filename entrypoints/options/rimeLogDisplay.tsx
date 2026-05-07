import { sendMessage } from "@/lib/messaging";
import { useEffect, useRef, useState } from "react";

function RimeLogDisplay() {
    const [rimeLogs, setRimeLogs] = useState<string[]>([]);
    const logTextArea = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        // Scroll textarea to bottom on log update
        const area = logTextArea.current;
        if (!area) return;
        area.scrollTop = area.scrollHeight;
    }, [rimeLogs]);

    async function updateRimeLogs() {
        const result = await sendMessage("GetRimeLogs");
        setRimeLogs(result.logs);
    }
    
    useEffect(() => {
        updateRimeLogs();

        const listener = (m: { rimeLog?: string }) => {
            if (m.rimeLog) {
                setRimeLogs(rimeLogs => [...rimeLogs, m.rimeLog!]);
            }
        };
        chrome.runtime.onMessage.addListener(listener);

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        };
    }, []);

    return <textarea
        readOnly
        value={rimeLogs.join("\n")}
        rows={10}
        ref={logTextArea}
        style={{
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            maxWidth: '100%',
            fontFamily: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", monospace',
            fontSize: '12px',
            lineHeight: '1.6',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(0, 0, 0, 0.09)',
            backgroundColor: 'rgba(0, 0, 0, 0.025)',
            color: '#333',
            outline: 'none',
        }}
    />;
}

export default RimeLogDisplay
