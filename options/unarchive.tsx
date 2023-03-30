import { unzip } from 'unzipit';
import { kCacheBlobSizeLimit } from '~fs';
import { getFs } from "../utils"

export async function unarchiveFile(content: ArrayBuffer) {
    const fs = await getFs();
    const { entries } = await unzip(content);

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
        console.log("default.yaml found at %s", pathInFile)
        for (const [name, entry] of Object.entries(entries)) {
            if (name.startsWith(pathInFile) && !name.includes(".userdb/")) {
                const nname = name.substring(pathInFile.length);
                const fullName = (prefix + nname).replace(/\/$/, '');
                console.log("Processing %s", name)
                if (entry.isDirectory) {
                    console.log("Create dir %s", fullName);
                    await fs.createDirectory(fullName);
                } else {
                    console.log("Writing %s, size: %s", fullName, entry.size);
                    await fs.setFileSize(fullName, 0);
                    await fs.openFile(fullName, false);
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
                    const buf = await entry.arrayBuffer();
                    while (pos < buf.byteLength) {
                        const len = Math.min(buf.byteLength - pos, chunkSizeLimit);
                        pos += await fs.writeFile(fullName, new Uint8Array(await entry.arrayBuffer(), pos, len), pos);
                    }
                    await fs.closeFile(fullName);
                }
            } else {
                console.log("Skipped %s", name);
            }
        }
    }
    console.log("OK")
}