import { FastIndexedDbFsController } from '~fs'

function dec2hex(dec) {
    return dec.toString(16).padStart(2, "0")
}

function generateId(len) {
    var arr = new Uint8Array((len || 40) / 2)
    self.crypto.getRandomValues(arr)
    return Array.from(arr, dec2hex).join('')
}

export async function getFs() {
    const fs = new FastIndexedDbFsController("rime-files");
    await fs.open();
    return fs;
}