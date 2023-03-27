import { createFs } from 'indexeddb-fs';
const { BrowserLevel } = require('browser-level')

function dec2hex(dec) {
    return dec.toString(16).padStart(2, "0")
}

function generateId(len) {
    var arr = new Uint8Array((len || 40) / 2)
    self.crypto.getRandomValues(arr)
    return Array.from(arr, dec2hex).join('')
}

export async function getFs() {
    const fs = await createFs({
        databaseName: "rime-files",
        databaseVersion: 1,
        objectStoreName: "files",
        rootDirectoryName: "emm"
    });

   const db = new BrowserLevel('rime-blobs', {
    keyEncoding: 'utf8',
    valueEncoding: 'buffer'
   });
    async function createBlob(data: Uint8Array) {
        const id = generateId(16)
        await db.put(id, data);
        return { id: id, size: data.length };
    }
    async function readBlob(ident: any) {
        const buf = await db.get(ident.id);
        return buf;
    }
    return { fs, createBlob, readBlob };
}