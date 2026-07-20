// Boundary between the keyboard UI and the ChromeOS-only APIs. On a real
// device this wraps chrome.virtualKeyboardPrivate + the background port; in a
// plain browser tab (development) it swaps in a mock so the UI runs with hot
// reload and fake candidates — the legacy keyboard could only be developed on
// device.

import {
  type BackgroundToInputView,
  type InputViewToBackground,
  kInputViewPortName,
  type LayoutId,
} from '@/lib/shared-types';

import {
  type ClipboardHistoryItem,
  type ClipboardReadResult,
  readClipboard,
} from './clipboard';
import type { KeyStroke } from './layouts/types';
import {
  type ContainerGeometry,
  kDefaultPlacement,
  kFloatingHandleHeight,
  kFloatingMargin,
  kFloatingResizeWidth,
  kPlacementPrefKey,
  normalizePlacement,
  type Placement,
} from './placement';

export interface VkHost {
  readonly mock: boolean;
  typeStroke(s: KeyStroke): void;
  insertText(text: string): void;
  readClipboard(): Promise<ClipboardReadResult>;
  pasteClipboardItem(item: ClipboardHistoryItem): Promise<boolean>;
  deleteClipboardItem(itemId: string): Promise<boolean>;
  subscribeClipboard(onChange: () => void): () => void;
  hideKeyboard(): void;
  keyboardLoaded(): void;
  // Size/place the container (docked full-width, or floating). Resolves once
  // the mode is confirmed — signal keyboardLoaded only after, or Chrome may
  // show the window with another IME's geometry.
  setupContainer(geom: ContainerGeometry): Promise<void>;
  readPlacement(): Promise<Placement>;
  writePlacement(placement: Placement): void;
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
  ArrowLeft: 0x25,
  ArrowRight: 0x27,
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
  Quote: 0xDE,
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
  getClipboardHistory?(
    options: { itemIds?: string[] },
    callback: (items: ClipboardHistoryItem[]) => void,
  ): void;
  pasteClipboardItem?(itemId: string, callback?: () => void): void;
  deleteClipboardItem?(itemId: string, callback?: () => void): void;
  onClipboardHistoryChanged?: {
    addListener(listener: (itemIds: string[]) => void): void;
    removeListener(listener: (itemIds: string[]) => void): void;
  };
  onClipboardItemUpdated?: {
    addListener(listener: (item: ClipboardHistoryItem) => void): void;
    removeListener(listener: (item: ClipboardHistoryItem) => void): void;
  };
}

function getVkPrivate(): VirtualKeyboardPrivate | undefined {
  return (globalThis.chrome as unknown as { virtualKeyboardPrivate?: VirtualKeyboardPrivate } | undefined)
    ?.virtualKeyboardPrivate;
}

export class RealHost implements VkHost {
  readonly mock = false;

  constructor(private readonly vk: VirtualKeyboardPrivate) {
    window.addEventListener('resize', () => this.updateHitTest());
  }

  private updateHitTest(): void {
    const width = window.innerWidth || window.screen.width;
    const height = window.innerHeight || 1;
    try {
      this.vk.setHitTestBounds([{ left: 0, top: 0, width, height }]);
    }
    catch (e) {
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

  readClipboard(): Promise<ClipboardReadResult> {
    const getClipboardHistory = this.vk.getClipboardHistory;
    if (!getClipboardHistory) return Promise.resolve({ status: 'unavailable' });

    return readClipboard({
      getHistory: () => new Promise((resolve, reject) => {
        try {
          getClipboardHistory.call(this.vk, {}, (items) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message));
              return;
            }
            resolve(items);
          });
        }
        catch (error) {
          reject(error);
        }
      }),
    }, { canDelete: typeof this.vk.deleteClipboardItem === 'function' });
  }

  pasteClipboardItem(item: ClipboardHistoryItem): Promise<boolean> {
    const paste = this.vk.pasteClipboardItem;
    if (!paste) {
      if (typeof item.textData !== 'string') return Promise.resolve(false);
      this.vk.insertText(item.textData);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      // Some older ChromeOS/FydeOS builds expose the command but ignore
      // its optional callback. Do not leave the tile permanently busy.
      const fallback = window.setTimeout(() => finish(true), 500);
      try {
        paste.call(this.vk, item.id, () => {
          window.clearTimeout(fallback);
          const failed = Boolean(chrome.runtime.lastError);
          if (failed && typeof item.textData === 'string') this.vk.insertText(item.textData);
          finish(!failed || typeof item.textData === 'string');
        });
      }
      catch {
        window.clearTimeout(fallback);
        // Older bindings expose the command without the optional
        // callback and throw "No matching signature" when it is passed.
        try {
          paste.call(this.vk, item.id);
          finish(true);
          return;
        }
        catch {
          // Text remains pasteable even if the history command is not.
        }
        if (typeof item.textData !== 'string') {
          finish(false);
          return;
        }
        this.vk.insertText(item.textData);
        finish(true);
      }
    });
  }

  deleteClipboardItem(itemId: string): Promise<boolean> {
    const remove = this.vk.deleteClipboardItem;
    if (!remove) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fallback = window.setTimeout(() => finish(true), 500);
      try {
        remove.call(this.vk, itemId, () => {
          window.clearTimeout(fallback);
          finish(!chrome.runtime.lastError);
        });
      }
      catch {
        window.clearTimeout(fallback);
        // FydeOS releases based on older Chromium schemas accept only
        // the item id; retry without the newer optional callback.
        try {
          remove.call(this.vk, itemId);
          finish(true);
        }
        catch {
          finish(false);
        }
      }
    });
  }

  subscribeClipboard(onChange: () => void): () => void {
    const history = this.vk.onClipboardHistoryChanged;
    const updated = this.vk.onClipboardItemUpdated;
    const onHistory = () => onChange();
    const onUpdated = () => onChange();
    history?.addListener(onHistory);
    updated?.addListener(onUpdated);
    return () => {
      history?.removeListener(onHistory);
      updated?.removeListener(onUpdated);
    };
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
      ? this.setupFloating(geom)
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
        // Retire any drag region left by a floating session. A docked
        // keyboard has no handle, so a surviving region would sit over
        // the candidate bar and swallow taps on the first candidates.
        try {
          this.vk.setDraggableArea({ left: 0, top: 0, width: window.screen.width, height: 0 });
        }
        catch (e) {
          console.warn('setDraggableArea failed', e);
        }
        this.updateHitTest();
        resolve();
      });
    });
  }

  // The window IS the card (opaque). left/top omitted centres near the bottom;
  // passing them keeps a dragged (or corner-pinned) keyboard put.
  private setupFloating({ width, height, left, top, draggable }: ContainerGeometry): Promise<void> {
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
          // Stops short of the resize button at the strip's right end,
          // which would otherwise never receive a pointer. Zero height
          // retires the region entirely: one-hand is corner-anchored, and
          // a stale drag area from a previous floating session would still
          // swallow taps on the swap bar.
          this.vk.setDraggableArea({
            left: 0,
            top: 0,
            width: draggable ? Math.max(0, width - kFloatingResizeWidth) : width,
            height: draggable ? kFloatingHandleHeight : 0,
          });
        }
        catch (e) {
          console.warn('setDraggableArea failed', e);
        }
        this.updateHitTest();
        resolve();
      });
    });
  }

  async readPlacement(): Promise<Placement> {
    try {
      const got = await chrome.storage.local.get(kPlacementPrefKey);
      return normalizePlacement(got[kPlacementPrefKey]);
    }
    catch {
      return kDefaultPlacement;
    }
  }

  writePlacement(placement: Placement): void {
    void chrome.storage.local.set({ [kPlacementPrefKey]: placement });
  }

  openSettings(): void {
    this.vk.openSettings();
  }

  connect(onMessage: (msg: BackgroundToInputView) => void): (msg: InputViewToBackground) => void {
    let port: chrome.runtime.Port | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pending: InputViewToBackground[] = [];

    const queue = (msg: InputViewToBackground) => {
      // Visibility is current state, not an action. Keep only its newest
      // value while disconnected so reconnect does not replay stale UI
      // lifecycle transitions.
      if (msg.kind === 'visibility') {
        const old = pending.findIndex(item => item.kind === 'visibility');
        if (old >= 0) pending.splice(old, 1);
      }
      pending.push(msg);
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
      }, 250);
    };

    const markDisconnected = (connectedPort: chrome.runtime.Port | null) => {
      if (connectedPort && port !== connectedPort) return;
      port = null;
      if (closed) return;
      queue({ kind: 'visibility', visible: !document.hidden });
      scheduleReconnect();
    };

    const post = (msg: InputViewToBackground) => {
      if (!port) {
        queue(msg);
        scheduleReconnect();
        return;
      }
      const connectedPort = port;
      try {
        connectedPort.postMessage(msg);
      }
      catch {
        markDisconnected(connectedPort);
        queue(msg);
      }
    };

    const open = () => {
      if (closed || port) return;
      let connectedPort: chrome.runtime.Port;
      try {
        connectedPort = chrome.runtime.connect(undefined, { name: kInputViewPortName });
      }
      catch {
        markDisconnected(null);
        return;
      }
      port = connectedPort;
      connectedPort.onMessage.addListener((raw) => {
        // A queued packet from a disconnected port must not enter the
        // new candidate stream after reconnect.
        if (port !== connectedPort) return;
        console.log('inputview: message from background', raw);
        onMessage(raw as BackgroundToInputView);
      });
      connectedPort.onDisconnect.addListener(() => {
        if (port !== connectedPort) return;
        // MV3 kills the service worker after ~30s idle, which severs
        // this port. Without reconnecting, the keyboard freezes on its
        // last candidate list forever. Reconnecting wakes the worker,
        // which re-sends state + candidates on connect.
        console.log('inputview: background port disconnected, reconnecting');
        markDisconnected(connectedPort);
      });

      while (port === connectedPort && pending.length > 0) {
        const msg = pending[0];
        try {
          connectedPort.postMessage(msg);
          pending.shift();
        }
        catch {
          markDisconnected(connectedPort);
        }
      }
    };

    window.addEventListener('pagehide', () => {
      closed = true;
      port = null;
      pending.length = 0;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    });
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
  private candidateSequence = 0;

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
    this.post({
      kind: 'candidates',
      streamId: 'mock',
      sequence: ++this.candidateSequence,
      candidates,
    });
  }

  // Mirrored to the page so the audit can assert what a gesture actually
  // typed — the mock's composition follows the same rules the mechanisms
  // assume of the engine (a–z appends, one Backspace removes one char).
  private setComposition(next: string): void {
    this.composition = next;
    (window as { __mockComposition?: string }).__mockComposition = next;
  }

  typeStroke(s: KeyStroke): void {
    console.log('[mock] typeStroke', s);
    if (this.asciiMode) return;
    if (/^[a-z]$/.test(s.key)) {
      this.setComposition(this.composition + s.key);
      this.candidateTotal = 21;
      this.postCandidates();
    }
    else if (s.code === 'Backspace' && this.composition.length > 0) {
      this.setComposition(this.composition.slice(0, -1));
      this.candidateTotal = this.composition.length > 0 ? 21 : 0;
      this.postCandidates();
    }
    else if (s.code === 'Enter' || s.code === 'Space') {
      this.setComposition('');
      this.candidateTotal = 0;
      this.postCandidates();
    }
  }

  insertText(text: string): void {
    console.log('[mock] insertText', text);
  }

  readClipboard(): Promise<ClipboardReadResult> {
    return import('./mock-clipboard').then(({ readMockClipboard }) => readMockClipboard());
  }

  pasteClipboardItem(item: ClipboardHistoryItem): Promise<boolean> {
    console.log('[mock] pasteClipboardItem', item.id);
    return Promise.resolve(true);
  }

  deleteClipboardItem(itemId: string): Promise<boolean> {
    console.log('[mock] deleteClipboardItem', itemId);
    return import('./mock-clipboard').then(({ deleteMockClipboardItem }) => deleteMockClipboardItem());
  }

  subscribeClipboard(): () => void {
    return () => undefined;
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

  async readPlacement(): Promise<Placement> {
    try {
      return normalizePlacement(JSON.parse(localStorage.getItem(kPlacementPrefKey) ?? 'null'));
    }
    catch {
      return kDefaultPlacement;
    }
  }

  writePlacement(placement: Placement): void {
    localStorage.setItem(kPlacementPrefKey, JSON.stringify(placement));
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
          this.setComposition('');
          this.candidateTotal = 0;
          this.postState();
          this.postCandidates();
          break;
        case 'selectCandidate':
        case 'deleteCandidate':
          this.setComposition('');
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
