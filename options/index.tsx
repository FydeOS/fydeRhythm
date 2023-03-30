
import { useEffect, useState, useRef } from "react"
import { sendToBackground } from "@plasmohq/messaging"
import { useFilePicker } from 'use-file-picker';
import {unarchiveFile} from './unarchive'
import {getFs} from "../utils"

function OptionsPage() {
  const [data, setData] = useState("nihao")
  const [rimeLoaded, setRimeLoaded] = useState(false)
  const [log, setLog] = useState("");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
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

  async function unarchive() {
    const fileContent = await plainFiles[0].arrayBuffer();
    await unarchiveFile(fileContent)
  }

  async function loadRime() {
    appendLog("Loading RIME");
    setRimeLoaded(false);
    await sendToBackground({
      name: "ReloadRime",
    });
    appendLog("Rime Loaded");
    setRimeLoaded(true);
  }

  async function loadRimeWithMaintenance() {
    appendLog("Loading RIME");
    setRimeLoaded(false);
    await sendToBackground({
      name: "ReloadRime",
      body: {
        maintenance: true
      }
    });
    appendLog("Rime Loaded");
    setRimeLoaded(true);
  }

  async function filesystemGarbageCollect() {
    const fs = await getFs();
    await fs.collectGarbage();
  }

  async function simulateKey(keyCode: number) {
    if (rimeLoaded) {
      appendLog("Pressed " + keyCode);
      const resp = await sendToBackground({
        name: "SimulateKey",
        body: {
          keyCode
        }
      })
      if (resp.handled) {
        appendLog("Handled!");
        if (resp.context) {
           setContext(resp.context);
        }
        if (resp.commit) {
          commitText(resp.commit.text);
          appendLog("Commit " + resp.commit.text);
        }
      } else {
        appendLog("Not handled!");
        if (keyCode == 65288) {
          setTyped((prev) => prev.slice(0, -1));
        }
      }
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.code == "Backspace") {
      simulateKey(0xff08);
    } else if (event.code == "Enter") {
      simulateKey(0xff0d);
    } else {
      simulateKey(event.key.charCodeAt(0));
    }
  }

  useEffect(() => {
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
    }
  });

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
        <p>Have file content: { plainFiles.length }</p>
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
            <p key={idx + 100}>{idx+1}. {cur.text}</p>
          )
        }
      </>}
      <p>Text: {text}</p>
      <textarea value={log} rows={10} style={{height: 'auto'}} ref={textArea}/>
    </div>
  )
}

export default OptionsPage
