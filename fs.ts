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

interface OpenedFile {
    entry: Entry;
    cachedBlobs: Map<string, ArrayBuffer>;
    accessedBlobs: Map<string, number>;
    dirty: boolean;
    readonly: boolean;
}

// Compress blobs larger than 64KB
const kCompressSizeLimit = 65536;

// Cache blobs smaller than 512K, if it's read for more than
// 3 times in a single session
//
// This mainly optimizes reading speed of yaml-cpp and opencc files,
// which read files in small 4K chunks, and thus very slow.
// 
// In librime, larger files (like table.bin, prism.bin)
// have been optimized to read once into memory, so there's 
// no need for caching big files.
const kCacheSizeLimit = 524288;
const kCacheFrequency = 3;

// If a file took more than 50ms to read, warn about it
const kTimeWarning = 50;

export class FastIndexedDbFsController {
    dbName: string;
    openedFiles: Map<String, OpenedFile>;

    constructor(name) {
        this.dbName = name;
        this.openedFiles = new Map();
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

    async readEntryRaw(path: string): Promise<Entry> {
        return await this.db.get("entries", path);
    }

    async readEntry(path: string): Promise<Entry> {
        if (this.openedFiles.has(path)) {
            return this.openedFiles.get(path).entry;
        } else {
            return await this.readEntryRaw(path);
        }
    }

    async getFileSize(path: string): Promise<number> {
        const details: Entry = await this.readEntry(path);
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
        if (data.byteLength > kCompressSizeLimit) {
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
        if (this.openedFiles.has(entry.fullPath)) {
            const o = this.openedFiles.get(entry.fullPath);
            o.entry = entry;
            o.dirty = false;
        }
        await this.db.put("entries", entry);
    }

    async delPath(path: string): Promise<void> {
        await this.db.delete("entries", path);
    }

    async setFileSize(path: string, size: number): Promise<void> {
        let curEntry = await this.readEntry(path);
        if (!curEntry) {
            curEntry = {
                isDirectory: false,
                mtime: 0,
                mode: 0o777,
                blobs: [],
                parent: getParentPath(path),
                fullPath: path
            };
        }
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

    async openFile(path: string, readonly: boolean): Promise<void> {
        console.log(`Open ${path}`);
        if (this.openedFiles.has(path)) {
            // already opened
            const inst = this.openedFiles.get(path);
            inst.readonly = readonly;
        } else {
            let entry = await this.readEntryRaw(path);
            let created = false;
            if (!entry) {
                if (!readonly) {
                    created = true;
                    entry = {
                        isDirectory: false,
                        mtime: 0,
                        mode: 0o777,
                        blobs: [],
                        parent: getParentPath(path),
                        fullPath: path
                    };
                } else {
                    throw new Error("Path " + path + " does not exist, cannot open for read");
                }
            }
            if (entry.isDirectory) {
                throw new Error("Path " + path + " is a directory, cannot open as a file");
            }
            this.openedFiles.set(path, {
                entry,
                cachedBlobs: new Map(),
                accessedBlobs: new Map(),
                readonly: readonly,
                dirty: created
            });
        }
    }

    async writeFile(path: string, data: Uint8Array, pos: number): Promise<number> {
        const handle = this.openedFiles.get(path);
        if (!handle || handle.readonly) {
            throw Error(`File ${path} is not opened for writing, cannot write to it`);
        }
        const curFile = handle.entry;
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
        handle.dirty = true;
        return data.length;
    }

    async readFile(path: string, data: Uint8Array, pos: number): Promise<number> {
        const start = performance.now();

        const handle = this.openedFiles.get(path);
        if (!handle) {
            throw Error(`File ${path} is not opened for reading, cannot read from it`);
        }
        const curBlobs = handle.entry.blobs;
        let seek = 0;
        let read = 0;
        for (let i = 0; i < curBlobs.length; i++) {
            let curBlob = curBlobs[i];

            let start = pos - seek + read;
            let end = pos + data.length - seek;

            if (end > curBlob.size)
                end = curBlob.size;

            if (start >= 0 && start < curBlob.size && end > 0) {
                let blobData = handle.cachedBlobs.get(curBlob.id);
                if (blobData === undefined) {
                    // blobData not in cache, read it from DB
                    blobData = await this.readBlob(curBlob);
                    if (blobData.byteLength < kCacheSizeLimit) {
                        let readCount = handle.accessedBlobs.get(curBlob.id) || 1;
                        if (readCount >= kCacheFrequency) {
                            // If it's read for more than 3 times, cache it
                            handle.cachedBlobs.set(curBlob.id, blobData);
                        } else {
                            handle.accessedBlobs.set(curBlob.id, readCount + 1);
                        }
                    }
                }
                data.set(new Uint8Array(blobData, start, end - start), read);
                read += (end - start);
                if (read >= data.length)
                    break;
            }

            seek += curBlob.size;
        }

        const end = performance.now();
        if (end - start > kTimeWarning) {
            console.warn(`Slow read: took ${end - start} to read ${read} bytes from file ${path}`);
        }

        return read;
    }

    async closeFile(path: string): Promise<void> {
        console.log(`Close ${path}`);
        let f = this.openedFiles.get(path);
        if (f.dirty) {
            await this.writeEntry(f.entry);
        }
        this.openedFiles.delete(path);
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        if (this.openedFiles.has(oldPath)) {
            throw new Error(`${oldPath} already opened, cannot move`);
        }
        if (this.openedFiles.has(newPath)) {
            throw new Error(`${newPath} already opened, cannot move`);
        }
        let curEntry = await this.readEntry(oldPath);
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
        const r2 = r.map(x => ({ ...x, name: getFileName(x.fullPath) }));
        return {
            files: r2.filter(x => !x.isDirectory),
            directories: r2.filter(x => x.isDirectory),
        };
    }
}