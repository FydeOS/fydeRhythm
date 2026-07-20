import Box from '@mui/material/Box';
import { useEffect, useRef, useState } from 'react';

import { sendMessage } from '@/lib/messaging';
import { $$ } from '@/lib/utils';

function RimeLogDisplay() {
  const [rimeLogs, setRimeLogs] = useState<string[]>([]);
  const logTextArea = useRef<HTMLTextAreaElement | null>(null);
  // Follow new logs only while the view is at the bottom, so a user reading
  // older lines isn't yanked back down on every incoming message.
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const area = logTextArea.current;
    if (!area || !pinnedToBottom.current) return;
    area.scrollTop = area.scrollHeight;
  }, [rimeLogs]);

  async function updateRimeLogs() {
    const result = await sendMessage('GetRimeLogs');
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

  return (
    <Box
      component="textarea"
      readOnly
      aria-label={$$('rime_engine_logs')}
      value={rimeLogs.join('\n')}
      rows={10}
      ref={logTextArea}
      onScroll={(e) => {
        const t = e.currentTarget;
        pinnedToBottom.current = t.scrollHeight - t.scrollTop - t.clientHeight < 10;
      }}
      sx={{
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
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        color: 'text.primary',
        outline: 'none',
      }}
    />
  );
}

export default RimeLogDisplay;
