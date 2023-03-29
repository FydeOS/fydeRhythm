import { openDB, IDBPDatabase } from "idb";
import lz4, { type InitOutput, decompress, compress } from "./lz4/lz4_wasm";

interface BlobInfo {
    id: string;
    size: number;
    compressed: boolean;
}

interface Entry {
    isDirectory: boolean;
    mtime: number;
    mode: number;
    blobs: Array<BlobInfo>;
    parent: string;
    fullPath: string;
}

function dec2hex(dec) {
    return dec.toString(16).padStart(2, "0")
}

function generateId(len) {
    var arr = new Uint8Array((len || 40) / 2)
    self.crypto.getRandomValues(arr)
    return Array.from(arr, dec2hex).join('')
}


function getParentPath(path) {
    const regex = /^(.*)\/[^/]*$/;
    const match = regex.exec(path);
    return match ? match[1] : "/";
}

function getFileName(path) {
  const regex = /\/([^/]+)$/;
  const match = regex.exec(path);
  return match ? match[1] : null;
}

function typedArrayToBuffer(array: Uint8Array): ArrayBuffer {
    return array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset)
}

export class FastIndexedDbFsController {
    dbName: string;
    lz4: InitOutput;

    constructor(name) {
        this.dbName = name;
    }

    db: IDBPDatabase
    async open() {
        this.db = await openDB(this.dbName, 1, {
            upgrade(db) {
                db.createObjectStore("blobs");
                const entryStore = db.createObjectStore("entries", { keyPath: "fullPath" });
                entryStore.createIndex("parent", "parent");
                entryStore.createIndex("type", "type");
            }
        });
        await lz4("./assets/lz4_wasm_bg.wasm");
    }

    async readEntry(path: string, create: boolean): Promise<Entry> {
        let curEntry: Entry = await this.db.get("entries", path);
        if (!curEntry && create) {
            curEntry = {
                isDirectory: false,
                mtime: 0,
                mode: 0o777,
                blobs: [],
                parent: getParentPath(path),
                fullPath: path
            };
        }
        return curEntry;
    }

    async getFileSize(path: string): Promise<number> {
        const details: Entry = await this.readEntry(path, false);
        if (details) {
            return details.blobs.map(b => b.size).reduce((partialSum, a) => partialSum + a, 0);
        } else {
            return 0;
        }
    }

    async createBlob(rawData: ArrayBuffer): Promise<BlobInfo> {
        const id = generateId(16);
        let data = rawData;
        let compressed = false;
        if (data.byteLength > 65536) {
            const start = performance.now();
            data = compress(new Uint8Array(data)).buffer;
            const end = performance.now();
            compressed = true;
            console.log(`Compress ${id} from ${rawData.byteLength} to ${data.byteLength}, took ${end - start} ms`);
        }
        await this.db.put("blobs", data, id);
        return { id: id, size: rawData.byteLength, compressed };
    }
    async readBlob(ident: BlobInfo): Promise<ArrayBuffer> {
        let buf = await this.db.get("blobs", ident.id) as ArrayBuffer;
        let rawBuf = buf;
        if (ident.compressed) {
            const start = performance.now();
            buf = decompress(new Uint8Array(buf)).buffer;
            const end = performance.now();
            console.log(`Decompress blob ${ident.id} from ${rawBuf.byteLength} to ${buf.byteLength} took ${end - start} ms`);
        }
        return buf;
    }

    async writeEntry(entry: Entry): Promise<void> {
        entry.parent = getParentPath(entry.fullPath);
        await this.db.put("entries", entry);
    }

    async delPath(path: string): Promise<void> {
        await this.db.delete("entries", path);
    }

    async setFileSize(path: string, size: number): Promise<void> {
        const curEntry = await this.readEntry(path, true);
        if (curEntry.isDirectory) {
            throw new Error("Path " + path + " is a directory, cannot set its size.");
        }
        const curBlobs = curEntry.blobs;
        let newBlobs = [];
        let seek = 0;
        for (let i = 0; i < curBlobs.length; i++) {
            let curBlob = curBlobs[i];
            if (size >= seek + curBlob.size) {
                // not arrived yet
                newBlobs.push(curBlob);
            } else {
                const preserve = size - seek;
                if (preserve > 0) {
                    const cutBlobData = (await this.readBlob(curBlob)).slice(0, preserve);
                    const cutBlob = await this.createBlob(cutBlobData);
                    newBlobs.push(cutBlob);
                }
                break;
            }
            seek += curBlob.size;
        }

        if (seek < size) {
            let stubData = new ArrayBuffer(size - seek);
            const stubBlob = await this.createBlob(stubData);
            newBlobs.push(stubBlob);
        }

        curEntry.blobs = newBlobs;
        curEntry.mtime = new Date().getTime();
        await this.writeEntry(curEntry);
    }

    async writeFile(path: string, data: Uint8Array, pos: number): Promise<number> {
        const curFile = await this.readEntry(path, true);
        if (curFile.isDirectory) {
            throw new Error("Path " + path + " is a directory, cannot write.");
        }
        const curBlobs = curFile.blobs;
        let newBlobs = [];
        let seek = 0;
        for (let i = 0; i < curBlobs.length; i++) {
          let curBlob = curBlobs[i];
          if (pos >= seek + curBlob.size) {
            // not arrived yet
            newBlobs.push(curBlob);
          } else {
            const preserve = pos - seek;
            if (preserve > 0) {
              const cutBlobData = (await this.readBlob(curBlob)).slice(0, preserve);
              const cutBlob = await this.createBlob(cutBlobData);
              newBlobs.push(cutBlob);
            }
            break;
          }
          seek += curBlob.size;
        }
    
        const contentBlob = await this.createBlob(typedArrayToBuffer(data));
        newBlobs.push(contentBlob);
    
        seek = 0;
        const end = pos + data.length;
        for (let i = 0; i < curBlobs.length; i++) {
          let curBlob = curBlobs[i];
          if (end <= seek) {
            newBlobs.push(curBlob);
          } else if (end > seek && end <= seek + curBlob.size) {
            const preserveStart = end - seek;
            if (preserveStart != curBlob.size) {
              const cutBlobData = (await this.readBlob(curBlob)).slice(preserveStart, curBlob.size);
              const cutBlob = await this.createBlob(cutBlobData);
              newBlobs.push(cutBlob);
            }
          }
          seek += curBlob.size;
        }
    
        curFile.blobs = newBlobs;
        curFile.mtime = new Date().getTime();
        this.writeEntry(curFile);
        return data.length;
    }

    async readFile(path: string, data: Uint8Array, pos: number): Promise<number> {
        let curFile = await this.readEntry(path, false);
        if (!curFile) {
            throw new Error("Path " + path + " does not exist, cannot read.");
        }
        if (curFile.isDirectory) {
            throw new Error("Path " + path + " is a directory, cannot read.");
        }
        const curBlobs = curFile.blobs;
        let seek = 0;
        let read = 0;
        for (let i = 0; i < curBlobs.length; i++) {
          let curBlob = curBlobs[i];
    
          let start = pos - seek + read;
          let end = pos + data.length - seek;
    
          if (end > curBlob.size)
            end = curBlob.size;
    
          if (start >= 0 && start < curBlob.size && end > 0) {
            const cutBlobData = await this.readBlob(curBlob);
            data.set(new Uint8Array(cutBlobData, start, end - start), read);
            read += (end - start);
            if (read >= data.length)
              break;
          }
    
          seek += curBlob.size;
        }
    
        return read;
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        let curEntry = await this.readEntry(oldPath, false);
        if (curEntry == null) {
            throw new Error("Path " + oldPath + " does not exist, cannot move.");
        }
        curEntry.fullPath = newPath;
        await this.writeEntry(curEntry);
        await this.delPath(oldPath);
    }

    async createDirectory(path: string): Promise<void> {
        let newEntry: Entry = {
            isDirectory: true,
            mode: 0o777,
            mtime: 0,
            blobs: [],
            fullPath: path,
            parent: null
        };
        await this.writeEntry(newEntry);
    }

    async getDirectoryEntriesCount(path: string): Promise<number> {
        return await this.db.countFromIndex("entries", "parent", path);
    }

    async readDirectory(path: string): Promise<any> {
        const r: Array<Entry> = await this.db.getAllFromIndex("entries", "parent", path);
        const r2 = r.map(x => ({...x, name: getFileName(x.fullPath)}));
        return {
            files: r2.filter(x => !x.isDirectory),
            directories: r2.filter(x => x.isDirectory),
        };
    }
}