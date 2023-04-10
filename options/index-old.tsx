
import { useEffect, useState, useRef } from "react"
import { sendToBackground } from "@plasmohq/messaging"
import { useFilePicker } from 'use-file-picker';
import { unarchiveFile } from './unarchive'
import { getFs } from "../utils"
import FileEditor from "./fileEditor";

function OptionsPage() {
  const [data, setData] = useState("nihao")
  const [rimeLoading, setRimeLoaded] = useState(false)
  const [log, setLog] = useState("");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [rimeStatus, setRimeStatus] = useState({ current: null, list: [], loaded: false });
  const textArea = useRef<HTMLTextAreaElement>();

  const [context, setContext] = useState(null);

  const [openFileSelector, { plainFiles, loading }] = useFilePicker({
    accept: '.zip',
    multiple: false,
    readAs: "DataURL",
    readFilesContent: false
  });

  function appendLog(content: string) {
    setLog((prevLog) => prevLog + content + "\n");
  }

  function commitText(content: string) {
    setTyped((prev) => prev + content);
  }

  useEffect(() => {
    const area = textArea.current;
    area.scrollTop = area.scrollHeight;
  });

  async function updateStatus() {
    console.log("Before get status")
    const result = await sendToBackground({
      name: "GetEngineStatus"
    });
    setRimeStatus(result);
    console.log("End get status")
  }

  useEffect(() => {
    updateStatus();
  }, []);

  useEffect(() => {
    if (!rimeLoading) {
      updateStatus();
    } else {
      setRimeStatus({ current: null, list: [], loaded: false });
    }
  }, [rimeLoading]);

  async function unarchive() {
    const file = plainFiles[0];
    appendLog(`Loading ${file.name}`);
    const fileContent = await file.arrayBuffer();
    await unarchiveFile(fileContent, appendLog);
    appendLog(`Successfully unarchived ${file.name} to filesystem. Please reload RIME engine.`);
  }

  async function loadRime() {
    appendLog("Loading RIME");
    setRimeLoaded(true);
    await sendToBackground({
      name: "ReloadRime",
    });
    appendLog("Rime Loaded");
    setRimeLoaded(false);
  }

  async function loadRimeWithMaintenance() {
    appendLog("Loading RIME");
    setRimeLoaded(true);
    await sendToBackground({
      name: "ReloadRime",
      body: {
        maintenance: true
      }
    });
    appendLog("Rime Loaded");
    setRimeLoaded(false);
  }

  async function filesystemGarbageCollect() {
    const fs = await getFs();
    await fs.collectGarbage();
  }

  async function setSchema(id: string) {
    await sendToBackground({
      name: "SetSchema",
      body: {
        id
      }
    });
    await updateStatus();
  }

  // Usage
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 16
      }}>
      <h2>
        Welcome to your{" "}
        <a href="https://www.plasmo.com" target="_blank">
          Plasmo
        </a>{" "}
        Extension!
      </h2>
      <input onChange={(e) => setData(e.target.value)} value={data} />
      <p>Have file content: {plainFiles.length}</p>
      <button onClick={openFileSelector}>Select .zip</button>
      <button onClick={unarchive}>Unarchive</button>
      <button onClick={loadRime}>Reload RIME Engine</button>
      <button onClick={loadRimeWithMaintenance}>Reload RIME Engine With Maintenance</button>
      <button onClick={filesystemGarbageCollect}>GC</button>
      <p>{typed}</p>
      {context && <>
        <p>Preedit: {context.composition.preedit}</p>
        {
          context.menu.candidates.map((cur, idx) =>
            <p key={idx + 100}>{idx + 1}. {cur.text}</p>
          )
        }
      </>}
      <p>Text: {text}</p>
      <textarea value={log} rows={10} style={{ height: 'auto' }} ref={textArea} readOnly />
      <p>schema: {JSON.stringify(rimeStatus)}</p>
      <div>
        <>
          {rimeStatus.list.map(l => 
            <button onClick={() => setSchema(l.id)} key={"schema-btn-" + l.id}>
              {l.name}
            </button>
          )}
        </>
      </div>
      <FileEditor/>
    </div>
  )
}

export default OptionsPage
