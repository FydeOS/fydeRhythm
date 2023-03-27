import { useState } from "react"
import { sendToBackground } from "@plasmohq/messaging"
import { useFilePicker } from 'use-file-picker';

function IndexPopup() {
  const [data, setData] = useState("16")
  const [log, setLog] = useState("");

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

      <p>{ log }</p>
    </div>
  )
}

export default IndexPopup
