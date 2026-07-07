// Boundary between the keyboard UI and the ChromeOS-only APIs. On a real
// device this wraps chrome.virtualKeyboardPrivate + the background port; in a
// plain browser tab (development) it swaps in a mock so the UI runs with hot
// reload and fake candidates — the legacy keyboard could only be developed on
// device.

import {
    kInputViewPortName,
    type BackgroundToInputView,
    type InputViewToBackground,
    type LayoutId,
} from '@/lib/shared-types';
import type { KeyStroke } from './layouts/types';

// Floating window = docked keyboard scaled uniformly; `scale` is the fraction
// of docked size. kFloatingHandleHeight matches `.kb-handle` in md3.css.
export const kFloatingHandleHeight = 22;
const kFloatingMargin = 8;
export const kFloatingScaleMin = 0.4;
export const kFloatingScaleMax = 0.85;
export const kFloatingDefaultScale = 0.6;

// `width`/`height` are the card size (docked ignores them, spans the screen);
// `left`/`top` place a floating window (omitted → centre).
export interface ContainerGeometry {
    floating: boolean;
    width: number;
    height: number;
    left?: number;
    top?: number;
}

// Persisted placement: floating size (scale) and dragged position.
export interface FloatingPrefs {
    floating: boolean;
    scale: number;
    left?: number;
    top?: number;
}

export const kDefaultFloatingPrefs: FloatingPrefs = { floating: false, scale: kFloatingDefaultScale };

export interface VkHost {
    readonly mock: boolean;
    typeStroke(s: KeyStroke): void;
    insertText(text: string): void;
    hideKeyboard(): void;
    keyboardLoaded(): void;
    // Size/place the container (docked full-width, or floating). Resolves once
    // the mode is confirmed — signal keyboardLoaded only after, or Chrome may
    // show the window with another IME's geometry.
    setupContainer(geom: ContainerGeometry): Promise<void>;
    readFloatingPrefs(): Promise<FloatingPrefs>;
    writeFloatingPrefs(prefs: FloatingPrefs): void;
    openSettings(): void;
    // Connect the background port; returns the poster for VK→background messages.
    connect(onMessage: (msg: BackgroundToInputView) => void): (msg: InputViewToBackground) => void;
}

// Flag values for ctrl, alt and shift as defined by EventFlags in
// "event_constants.h" (ui::KeyEvent).
const Modifier = {
    NONE: 0,
    ALT: 8,
    CONTROL: 4,
    SHIFT: 2,
    CAPSLOCK: 256,
};

// Mapping from W3C code to ui::KeyEvent keyCode for non-alphanumeric keys.
const nonAlphaNumericKeycodes: Record<string, number> = {
    Backquote: 0xC0,
    Backslash: 0xDC,
    Backspace: 0x08,
    BracketLeft: 0xDB,
    BracketRight: 0xDD,
    Comma: 0xBC,
    Enter: 0x0D,
    Minus: 0xBD,
    Equal: 0xBB,
    Period: 0xBE,
    Quote: 0xBF,
    Semicolon: 0xBA,
    Slash: 0xBF,
    Space: 0x20,
    Tab: 0x09,
};

function getKeyCode(keyChar: string, keyName: string): number {
    const keyCode = nonAlphaNumericKeycodes[keyName];
    if (keyCode) return keyCode;

    let match = /Key([A-Z])/.exec(keyName);
    if (match) return match[1].charCodeAt(0);

    match = /Digit([0-9])/.exec(keyName);
    if (match) return match[1].charCodeAt(0);

    if (keyChar.length == 1) {
        if (keyChar >= 'a' && keyChar <= 'z') return keyChar.charCodeAt(0) - 32;
        if (keyChar >= 'A' && keyChar <= 'Z') return keyChar.charCodeAt(0);
        if (keyChar >= '0' && keyChar <= '9') return keyChar.charCodeAt(0);
    }
    return 0;
}

interface VirtualKeyboardPrivate {
    sendKeyEvent(event: object, callback?: () => void): void;
    insertText(text: string): void;
    hideKeyboard(): void;
    lockKeyboard(lock: boolean): void;
    keyboardLoaded(): void;
    setContainerBehavior(options: object, callback?: () => void): void;
    setDraggableArea(bounds: object): void;
    setHitTestBounds(bounds: object[]): void;
    openSettings(): void;
}

const kFloatingPrefKey = "inputViewFloating";

// Clamp the persisted scale and tolerate a missing/legacy value (an older
// build stored a bare boolean under this key).
export function normalizeFloatingPrefs(raw: unknown): FloatingPrefs {
    if (raw === true) return { floating: true, scale: kFloatingDefaultScale };
    if (!raw || typeof raw !== "object") return kDefaultFloatingPrefs;
    const o = raw as Partial<FloatingPrefs>;
    const scale = typeof o.scale === "number" && isFinite(o.scale)
        ? Math.min(kFloatingScaleMax, Math.max(kFloatingScaleMin, o.scale))
        : kFloatingDefaultScale;
    const coord = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
    return { floating: o.floating === true, scale, left: coord(o.left), top: coord(o.top) };
}

function getVkPrivate(): VirtualKeyboardPrivate | undefined {
    return (globalThis.chrome as unknown as { virtualKeyboardPrivate?: VirtualKeyboardPrivate } | undefined)
        ?.virtualKeyboardPrivate;
}

class RealHost implements VkHost {
    readonly mock = false;

    constructor(private readonly vk: VirtualKeyboardPrivate) {
        window.addEventListener('resize', () => this.updateHitTest());
    }

    private updateHitTest(): void {
        const width = window.innerWidth || window.screen.width;
        const height = window.innerHeight || 1;
        try {
            this.vk.setHitTestBounds([{ left: 0, top: 0, width, height }]);
        } catch (e) {
            console.warn('setHitTestBounds failed', e);
        }
    }

    typeStroke(s: KeyStroke): void {
        const charValue = s.key.length == 1 ? s.key.charCodeAt(0) : 0;
        const keyCode = getKeyCode(s.key, s.code);
        const modifiers = s.shiftKey ? Modifier.SHIFT : Modifier.NONE;
        for (const type of ['keydown', 'keyup']) {
            this.vk.sendKeyEvent({
                type,
                charValue,
                keyCode,
                keyName: s.code,
                modifiers,
            }, () => {
                if (chrome.runtime.lastError) console.log(chrome.runtime.lastError);
            });
        }
    }

    insertText(text: string): void {
        this.vk.insertText(text);
    }

    hideKeyboard(): void {
        this.vk.hideKeyboard();
        this.vk.lockKeyboard(false);
    }

    keyboardLoaded(): void {
        this.vk.keyboardLoaded();
    }

    setupContainer(geom: ContainerGeometry): Promise<void> {
        return geom.floating
            ? this.setupFloating(geom.width, geom.height, geom.left, geom.top)
            : this.setupDocked(geom.height);
    }

    private setupDocked(height: number): Promise<void> {
        // Same call sequence as the legacy adapter, which handled stale
        // container state (another IME leaving the shared VK container in
        // floating mode) correctly: confirm FULL_WIDTH first, then size.
        return new Promise((resolve) => {
            this.vk.setContainerBehavior({
                mode: 'FULL_WIDTH',
                bounds: { left: 0, top: 0, width: window.screen.width, height: 0 },
            }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('setContainerBehavior:', chrome.runtime.lastError.message);
                }
                window.resizeTo(window.screen.width, height);
                window.moveTo(0, window.screen.height - height);
                this.updateHitTest();
                resolve();
            });
        });
    }

    // The window IS the card (opaque). left/top omitted centres near the bottom;
    // passing them keeps a dragged keyboard put.
    private setupFloating(width: number, height: number, left?: number, top?: number): Promise<void> {
        const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
        const winLeft = left !== undefined
            ? clamp(left, window.screen.width - width)
            : Math.round((window.screen.width - width) / 2);
        const winTop = top !== undefined
            ? clamp(top, window.screen.height - height)
            : window.screen.height - height - kFloatingMargin;
        return new Promise((resolve) => {
            this.vk.setContainerBehavior({
                mode: 'FLOATING',
                bounds: { left: winLeft, top: winTop, width, height },
            }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('setContainerBehavior:', chrome.runtime.lastError.message);
                }
                window.resizeTo(width, height);
                window.moveTo(winLeft, winTop);
                try {
                    this.vk.setDraggableArea({ left: 0, top: 0, width, height: kFloatingHandleHeight });
                } catch (e) {
                    console.warn('setDraggableArea failed', e);
                }
                this.updateHitTest();
                resolve();
            });
        });
    }

    async readFloatingPrefs(): Promise<FloatingPrefs> {
        try {
            const got = await chrome.storage.local.get(kFloatingPrefKey);
            return normalizeFloatingPrefs(got[kFloatingPrefKey]);
        } catch {
            return kDefaultFloatingPrefs;
        }
    }

    writeFloatingPrefs(prefs: FloatingPrefs): void {
        void chrome.storage.local.set({ [kFloatingPrefKey]: prefs });
    }

    openSettings(): void {
        this.vk.openSettings();
    }

    connect(onMessage: (msg: BackgroundToInputView) => void): (msg: InputViewToBackground) => void {
        let port: chrome.runtime.Port | null = null;
        let closed = false;

        const post = (msg: InputViewToBackground) => {
            try {
                port?.postMessage(msg);
            } catch {
                console.warn('inputview: port not connected, dropping message', msg.kind);
            }
        };

        const open = () => {
            port = chrome.runtime.connect(undefined, { name: kInputViewPortName });
            port.onMessage.addListener((raw) => {
                console.log('inputview: message from background', raw);
                onMessage(raw as BackgroundToInputView);
            });
            port.onDisconnect.addListener(() => {
                // MV3 kills the service worker after ~30s idle, which severs
                // this port. Without reconnecting, the keyboard freezes on its
                // last candidate list forever. Reconnecting wakes the worker,
                // which re-sends state + candidates on connect.
                port = null;
                if (closed) return;
                console.warn('inputview: background port disconnected, reconnecting');
                setTimeout(() => {
                    if (closed) return;
                    open();
                    post({ kind: 'visibility', visible: !document.hidden });
                }, 250);
            });
        };

        window.addEventListener('pagehide', () => { closed = true; });
        open();
        return post;
    }
}

// Development mock: logs injected keys and simulates a composition session so
// the candidate bar and expanded panel are exercisable in a desktop browser.
class MockHost implements VkHost {
    readonly mock = true;

    private onMessage: ((msg: BackgroundToInputView) => void) | null = null;
    private composition = '';
    private candidateTotal = 0;
    private asciiMode = false;

    private post(msg: BackgroundToInputView): void {
        this.onMessage?.(msg);
    }

    private postState(): void {
        // Dev nicety: ?layout=zhuyin previews any layout, ?type=number|tel
        // previews the numberpad, all in a plain tab.
        const params = new URLSearchParams(window.location.search);
        const layout = (params.get('layout') ?? 'qwerty') as LayoutId;
        const type = params.get('type');
        const numericField = type === 'number' || type === 'tel' ? type : null;
        this.post({
            kind: 'state',
            state: {
                asciiMode: this.asciiMode,
                layout,
                latinLayout: 'qwerty',
                script: layout === 'kana' ? 'ja' : layout === 'hangul' ? 'ko' : 'zh',
                schemaId: 'aurora_pinyin',
                schemaName: '极光拼音',
                numericField,
            },
        });
    }

    private postCandidates(): void {
        const words = ['键盘', '测试', '候选', '拼音', '输入', '现代', '设计', '样式', '滚动', '加载'];
        const candidates = Array.from({ length: this.candidateTotal }, (_, i) => ({
            text: `${words[i % words.length]}${i >= words.length ? i : ''}`,
            index: i,
        }));
        this.post({ kind: 'candidates', candidates });
    }

    typeStroke(s: KeyStroke): void {
        console.log('[mock] typeStroke', s);
        if (this.asciiMode) return;
        if (/^[a-z]$/.test(s.key)) {
            this.composition += s.key;
            this.candidateTotal = 21;
            this.postCandidates();
        } else if (s.code === 'Backspace' && this.composition.length > 0) {
            this.composition = this.composition.slice(0, -1);
            this.candidateTotal = this.composition.length > 0 ? 21 : 0;
            this.postCandidates();
        } else if (s.code === 'Enter' || s.code === 'Space') {
            this.composition = '';
            this.candidateTotal = 0;
            this.postCandidates();
        }
    }

    insertText(text: string): void {
        console.log('[mock] insertText', text);
    }

    hideKeyboard(): void {
        console.log('[mock] hideKeyboard');
    }

    keyboardLoaded(): void {
        console.log('[mock] keyboardLoaded');
    }

    setupContainer(geom: ContainerGeometry): Promise<void> {
        console.log('[mock] setupContainer', geom);
        return Promise.resolve();
    }

    async readFloatingPrefs(): Promise<FloatingPrefs> {
        try {
            return normalizeFloatingPrefs(JSON.parse(localStorage.getItem(kFloatingPrefKey) ?? 'null'));
        } catch {
            return kDefaultFloatingPrefs;
        }
    }

    writeFloatingPrefs(prefs: FloatingPrefs): void {
        localStorage.setItem(kFloatingPrefKey, JSON.stringify(prefs));
    }

    openSettings(): void {
        console.log('[mock] openSettings');
    }

    connect(onMessage: (msg: BackgroundToInputView) => void): (msg: InputViewToBackground) => void {
        this.onMessage = onMessage;
        setTimeout(() => this.postState(), 0);
        return (msg) => {
            console.log('[mock] toBackground', msg);
            switch (msg.kind) {
                case 'setAsciiMode':
                    this.asciiMode = msg.asciiMode;
                    this.composition = '';
                    this.candidateTotal = 0;
                    this.postState();
                    this.postCandidates();
                    break;
                case 'selectCandidate':
                case 'deleteCandidate':
                    this.composition = '';
                    this.candidateTotal = 0;
                    this.postCandidates();
                    break;
                case 'loadMoreCandidates':
                    this.candidateTotal += msg.count;
                    this.postCandidates();
                    break;
                case 'switchSchema':
                    this.postState();
                    break;
                case 'getSchemaList':
                    this.post({
                        kind: 'schemaList',
                        schemas: [
                            { id: 'aurora_pinyin', label: '极光拼音' },
                            { id: 'rime_ice', label: '雾凇拼音' },
                            { id: 'terra_zhuyin', label: '注音' },
                        ],
                        activeSchema: 'aurora_pinyin',
                    });
                    break;
            }
        };
    }
}

export function createHost(): VkHost {
    const vk = getVkPrivate();
    return vk ? new RealHost(vk) : new MockHost();
}
