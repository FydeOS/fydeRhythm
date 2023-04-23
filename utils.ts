import { FastIndexedDbFsController } from '~fs'

export function dec2hex(dec) {
    return dec.toString(16).padStart(2, "0")
}

export function generateId(len) {
    var arr = new Uint8Array((len || 40) / 2)
    self.crypto.getRandomValues(arr)
    return Array.from(arr, dec2hex).join('')
}

export async function getFs() {
    const fs = new FastIndexedDbFsController("rime-files");
    await fs.open();
    return fs;
}

export function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 Bytes'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function getParentPath(path) {
    const regex = /^(.*)\/[^/]*$/;
    const match = regex.exec(path);
    return match ? match[1] : "/";
}

export function getFileName(path) {
    const regex = /\/([^/]+)$/;
    const match = regex.exec(path);
    return match ? match[1] : null;
}

export interface ImeSettings {
    schema: string;
    pageSize: number;
    algebraList: string[];
}

export const kDefaultSettings = { schema: "aurora_pinyin", pageSize: 5, algebraList: [] };

export const $$ = chrome.i18n.getMessage;