import {unzip} from 'unzipit';
import {getFs} from "../utils"
export async function unarchiveFile(content: ArrayBuffer) {
    const fs = await getFs();
    const {entries} = await unzip(content);

    const prefix = "rime-data/";
    if (!await fs.fs.exists("rime-data")) {
        await fs.fs.createDirectory("rime-data");
    }
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
            if (name.startsWith(pathInFile)) {
                const nname = name.substring(pathInFile.length);
                const fullName = (prefix + nname).replace(/\/$/, '');
                console.log("Processing %s", name)
                if (entry.isDirectory) {
                    if (!await fs.fs.exists(fullName)) {
                        console.log("Create dir %s", fullName);
                        await fs.fs.createDirectory(fullName);
                    } else {
                        console.log("Dir %s already exists", fullName);
                    }
                } else {
                    console.log("Writing %s, size: %s", fullName, entry.size);
                    const blob = await fs.createBlob(new Uint8Array(await entry.arrayBuffer()));
                    await fs.fs.writeFile(fullName, {blobs: [blob], mtime: entry.lastModDate.getTime(), mode: 0o777});
                }
            } else {
                console.log("Skipped %s", name);
            }
        }
    }
    console.log("OK")
}