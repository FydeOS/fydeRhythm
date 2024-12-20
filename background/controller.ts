import { Mutex } from "async-mutex";
import { getFs, type ImeSettings } from "~utils";
import { RimeCandidateIterator, RimeEngine, RimeSession } from "./engine";
import { parse, stringify } from 'yaml'
import type { RimeCandidate } from "~shared-types";
import EventEmitter from "events";
import { ConstructionOutlined } from "@mui/icons-material";

const kShiftMask = 1 << 0;
const kControlMask = 1 << 2;
const kMod1Mask = 1 << 3;
const kAltMask = kMod1Mask;
const kReleaseMask = 1 << 30;

// Definitions from librime/include/X11/keysymdef.h
const kSpecialKeys = {
    'ArrowUp': 0xff52,
    'ArrowDown': 0xff54,
    'PageUp': 0xff55,
    'PageDown': 0xff56,
    'Enter': 0xff0d, // Return
    'Backspace': 0xff08,
    'ArrowRight': 0xff53,
    'ArrowLeft': 0xff51,
    'Escape': 0xff1b,
    'ShiftLeft': 0xffe1,
    'ShiftRight': 0xffe2,
    'CapsLock': 0xffe5,
    'ControlLeft': 0xffe3,
    'ControlRight': 0xffe4,
    'AltLeft': 0xffe9,
    'AltRight': 0xffea,
}

const kConventionalKeys = {};
for (let i = 0; i <= 9; i++) {
    kConventionalKeys[`Digit${i}`] = i.toString().charCodeAt(0);
}

for (let i = 'A'.charCodeAt(0); i <= 'Z'.charCodeAt(0); i++) {
    kConventionalKeys[`Key${String.fromCharCode(i)}`] = i;
}

export class InputController extends EventEmitter {
    context?: chrome.input.ime.InputContext;
    session?: RimeSession;
    engineId?: string;
    engine?: RimeEngine;
    loadMutex: Mutex;
    inputCache: string[];

    rimeLogBuffer: string[];
    rimeLogBufferPos: number;
    activeSettings: ImeSettings;

    constructor() {
        super();
        this.rimeLogBuffer = new Array<string>(400);
        this.rimeLogBufferPos = 0;
        this.engineId = null;
        this.engine = null;
        this.context = null;
        this.session = null;
        this.inputCache = [];
        this.loadMutex = new Mutex();
        this.candidateCache = [];
        this.candidateIterator = null;
    }

    get engineLoading(): boolean {
        return this.loadMutex.isLocked();
    }

    notifyRimeStatusChanged() {
        chrome.runtime.sendMessage({ rimeStatusChanged: true }, {}, () => {
            // Prevent printing "Could not establish connection. Receiving end does not exist." 
            // error message when options page is not open
            chrome.runtime.lastError;
        });
    }

    async unloadRime() {
        if (this.engineId) {
            this.resetUI();
        }
        await this.loadMutex.runExclusive(async () => {
            if (this.engine) {
                if (this.session) {
                    this.session.destroy();
                    this.session = null;
                }
                this.engine.destroy();
                this.engine = null;
                this.notifyRimeStatusChanged();
            }
        });
    }

    printErr(err: string) {
        this.rimeLogBuffer[this.rimeLogBufferPos] = err;
        this.rimeLogBufferPos++;
        this.rimeLogBufferPos %= this.rimeLogBuffer.length;
        chrome.runtime.sendMessage({ rimeLog: err }, {}, () => {
            // Prevent printing "Could not establish connection. Receiving end does not exist." 
            // error message when options page is not open
            chrome.runtime.lastError;
        });
    }

    getLogs(): string[] {
        const result = [];
        let i = this.rimeLogBufferPos;
        do {
            if (this.rimeLogBuffer[i] != undefined) {
                result.push(this.rimeLogBuffer[i]);
            }
            i = (i + 1) % this.rimeLogBuffer.length;
        } while (i != this.rimeLogBufferPos);
        return result;
    }

    inputCacheToString() {
        const list = [];
        for (const s of this.inputCache) {
            if (s == null) {
                list.pop();
            } else {
                list.push(s);
            }
        }
        return list.join("");
    }

    async flushInputCacheToSession(session: RimeSession) {
        if (this.inputCache.length > 0) {
            this.invalidateCandidateCache();
            const list = this.inputCache;
            this.inputCache = [];
            for (const c of list) {
                if (c == null) // Backspace
                    await session.processKey(kSpecialKeys['Backspace'], 0);
                else
                    await session.processKey(c.charCodeAt(0), 0);
            }
        }
    }

    async loadRimeConfig(settings: ImeSettings): Promise<string> {
        const fs = await getFs();
        const schemaConfigBuffer = await fs.readWholeFile(`/root/build/${settings.schema}.schema.yaml`);
        const schemaConfigString = new TextDecoder().decode(schemaConfigBuffer);
        const schemaConfig = parse(schemaConfigString);
        if (!schemaConfig.menu) {
            schemaConfig.menu = {};
        }
        schemaConfig.menu.page_size = settings.pageSize;
        if (settings.algebraList.length > 0) {
            if (!schemaConfig.speller) {
                schemaConfig.speller = {};
            }
            if (!schemaConfig.speller.algebra) {
                schemaConfig.speller.algebra = [];
            }
            for (const a of settings.algebraList) {
                schemaConfig.speller.algebra.push(a);
            }
        }
        return stringify(schemaConfig);
    }

    onToggleLanguageState(asciiMode: boolean) {
        this.emit("toggleLanguageState", asciiMode);
    }

    async loadRime(maintenance: boolean): Promise<boolean> {
        if (this.engineId) {
            this.resetUI();
        }
        if (this.loadMutex.isLocked()) {
            console.log("RIME loading mutex is locked, wait for unlock");
            // If RIME is already loading, just wait for it to complete
            await this.loadMutex.waitForUnlock();
            // Engine is loaded. If we want to run maintenance, we should reload the engine; or else just exit because engine is loaded.
            if (!maintenance) {
                return true;
            }
        }
        try {
            console.log(">>>Loading RIME engine...");
            const configObj = await chrome.storage.sync.get(["settings"]);
            if (!configObj.settings) {
                throw Error("Could not find RIME settings, refusing to launch.");
            }
            this.activeSettings = configObj.settings as ImeSettings;
            console.log(">>>Settings: ", JSON.stringify(this.activeSettings));
            await this.loadMutex.runExclusive(async () => {
                console.log("this.loadMutex.runExclusive");
                let asciiMode = false;
                if (this.engine) {
                    if (this.session) {
                        asciiMode = await this.session?.getOption("ascii_mode");
                        this.session.destroy();
                        this.session = null;
                    }
                    this.engine.destroy();
                    this.engine = null;
                    this.notifyRimeStatusChanged();
                }

                await new Promise(r => setTimeout(r, 10));
                console.log("loadRimeConfig");
                const config = await this.loadRimeConfig(this.activeSettings);
                const fs = await getFs();
                const dirs = ['/root/build', '/root/shared', '/root/user', '/root/shared/opencc'];
                for (const d of dirs) {
                    if (!await fs.readEntryRaw(d)) {
                        await fs.createDirectory(d);
                    }
                }
                if (maintenance) {
                    if (config.includes("lua_")) {
                        const luaContent = await fs.readWholeFile(`/root/shared/${this.activeSettings.schema}.rime.lua`);
                        await fs.writeWholeFile("/root/user/rime.lua", luaContent);
                    }
                }
                // TODO: add GUI for switch key config
                await fs.writeWholeFile("/root/build/default.yaml", new TextEncoder().encode(stringify(
                    { ascii_composer: { good_old_caps_lock: true, switch_key: { Caps_Lock: "clear", Shift_L: "commit_code" } } }
                )));
                console.log("new RimeEngine()");
                const engine = new RimeEngine();
                await engine.initialize(this.printErr.bind(this), fs);
                if (maintenance) {
                    await engine.rebuildPrism(this.activeSettings.schema, config);
                }
                console.log("engine.createSession");
                const session = await engine.createSession(this.activeSettings.schema, config);
                await this.flushInputCacheToSession(session);
                this.engine = engine;
                this.session = session;
                await this.session.setOption("ascii_mode", asciiMode);
                this.session.addListener('optionChanged', (name: string, val: boolean) => {
                    if (name == "ascii_mode") {
                        this.onToggleLanguageState(val);
                    }
                    // Send status to fyde
                    const fydeLanguageStateFunction: (string) => void = (chrome.input.ime as any).showFydeLanguageState;
                    if (fydeLanguageStateFunction) {
                        if (this.session) {
                            this.session.getOptionLabel(name, val).then((v) => {
                                const empty = v == null || v.trim() == "";
                                if (!empty) {
                                    fydeLanguageStateFunction(v);
                                } else if (name == "ascii_mode") {
                                    fydeLanguageStateFunction(val ? "EN" : "中");
                                } else {
                                    fydeLanguageStateFunction(`${name}: ${val}`);
                                }
                            })
                        }
                    }
                });
                this.notifyRimeStatusChanged();
            });
            await this.refreshContext();
            return true;
        } catch (ex) {
            console.error("Error while loading RIME engine: ", ex);
            this.printErr(`Error while loading RIME engine: ${ex.toString()}`);
            return false;
        }
    }

    resetUI() {
        if (this.context != null) {
            this.setComposition({
                contextID: this.context.contextID,
                cursor: 0,
                selectionEnd: 0,
                selectionStart: 0,
                text: ""
            });
        }
        if (this.engineId != null) {
            chrome.input.ime.setCandidateWindowProperties({
                engineID: this.engineId,
                properties: {
                    visible: false,
                }
            });
        }
        if (this.inputViewVisible) {
        }
        this.invalidateCandidateCache();
        this.sendCandidatesToInputView([]);
    }

    async clearContext() {
        this.session?.clearComposition();
        this.context = null;
        this.resetUI();
    }

    preeditEmpty: boolean;
    setComposition(param: chrome.input.ime.CompositionParameters): Promise<void> {
        return new Promise((res, rej) => {
            // Check if param and param.text are valid
            if (!param || (typeof param.text !== 'string')) {
                rej(new Error('Invalid param or param.text is not a string'));
                return;
            }
              // Replace all spaces in param.text with underscore
              // Using spaces may cause problems with Chinese character input within some Linux applications (such as QQ).
            param.text = param.text.replace(/\s+/g, '_');
            if (param.text.length == 0 && this.preeditEmpty) {
                //  If preedit is already empty, and new preedit is also empty, then do not call
                // setComposition. This will mostly happen in ASCII mode (e.g. input method is 
                // switched off by pressing Shift). If we still call setComposition in this case,
                // Chrome omnibar autofill text will disappear, resulting in bad user experience
                res(null);
            } else {
                this.preeditEmpty = param.text.length == 0;
                try {
                    chrome.input.ime.setComposition(param, (ok) => {
                        if (chrome.runtime.lastError) {
                            rej(new Error(chrome.runtime.lastError.message));
                        } else {
                            ok ? res(null) : rej();
                        }
                    });
                } catch (err) {
                    rej(err);
                }
            }
        });
    }


    sendCandidatesToInputView(candidates: Array<{ candidate: string, ix: number }>) {
        this.emit("candidatesBack", candidates);
    }

    sendCandidateCacheToInputView() {
        this.sendCandidatesToInputView(this.candidateCache.map((v) => ({
            candidate: v.text,
            ix: v.index
        })));
    }

    async refreshContext(): Promise<void> {
        if (!this.engineId)
            return;
        const promises = [];
        if (this.session != null && !this.loadMutex.isLocked()) {
            const rimeContext = await this.session?.getContext();
            if (rimeContext) {
                if (this.context != null) {
                    const c = {
                        contextID: this.context.contextID,
                        cursor: rimeContext.composition.cursorPosition,
                        /* Showing selection will result in incorrect cursor display under Linux apps
                         * As showing selection doesn't provide much value, do not show selection for now */
                        // selectionEnd: rimeContext.composition.selectionEnd,
                        // selectionStart: rimeContext.composition.selectionStart,
                        text: rimeContext.composition.preedit
                    };
                    promises.push(this.setComposition(c));
                }
                if (!this.inputViewVisible) {
                    // Virtual keyboard is not visible, candidiates are displayed in system candidate window
                    if (rimeContext.menu.candidates.length > 0) {
                        promises.push(new Promise((res, rej) => {
                            console.log("S", this.activeSettings);
                            console.log("V:", !this.activeSettings.horizontal);
                            chrome.input.ime.setCandidateWindowProperties({
                                engineID: this.engineId,
                                properties: {
                                    visible: true,
                                    cursorVisible: true,
                                    auxiliaryTextVisible: true,
                                    pageSize: rimeContext.menu.pageSize,
                                    auxiliaryText: chrome.i18n.getMessage("candidate_page", (rimeContext.menu.pageNumber + 1).toString())
                                        + (rimeContext.menu.isLastPage ? chrome.i18n.getMessage("candidate_page_last") : ""),
                                    windowPosition: 'composition',
                                    vertical: !this.activeSettings.horizontal
                                }
                            }, (ok) => ok ? res(null) : rej());
                        }));
                        if (this.context != null) {
                            promises.push(new Promise((res, rej) => {
                                chrome.input.ime.setCandidates({
                                    contextID: this.context.contextID,
                                    candidates: rimeContext.menu.candidates.map((v, idx) => ({
                                        candidate: v.text,
                                        id: idx,
                                        label: rimeContext.selectLabels[idx] || (idx + 1).toString(),
                                        annotation: v.comment
                                    })),
                                }, (ok) => ok ? res(null) : rej());
                            }));
                            promises.push(new Promise((res, rej) => {
                                chrome.input.ime.setCursorPosition({
                                    contextID: this.context.contextID,
                                    candidateID: rimeContext.menu.highlightedCandidateIndex
                                }, (ok) => ok ? res(null) : rej());
                            }));
                        }
                    } else {
                        promises.push(new Promise((res, rej) => {
                            chrome.input.ime.setCandidateWindowProperties({
                                engineID: this.engineId,
                                properties: {
                                    visible: false,
                                }
                            }, (ok) => ok ? res(null) : rej());
                        }));
                    }
                } else {
                    // Virtual keyboard is visible, send candidates to display them in virtual keyboard
                    if (!this.candidateIterator) {
                        this.candidateIterator = await this.session.iterateCandidates(0);
                        await this.fetchMoreCandidates(10);
                    }
                    this.sendCandidateCacheToInputView();
                }
            } else {
                this.resetUI();
            }
        } else {
            if (this.inputCache.length > 0) {
                if (this.context != null) {
                    const preedit = this.inputCacheToString();
                    const c = {
                        contextID: this.context.contextID,
                        cursor: preedit.length,
                        text: preedit,
                    };
                    promises.push(this.setComposition(c));
                }
                if (!this.inputViewVisible) {
                    // Virtual keyboard is not visible, candidiates are displayed in system candidate window
                    promises.push(new Promise((res, rej) => {
                        chrome.input.ime.setCandidateWindowProperties({
                            engineID: this.engineId,
                            properties: {
                                visible: true,
                                cursorVisible: false,
                                auxiliaryTextVisible: true,
                                pageSize: 1,
                                auxiliaryText: chrome.i18n.getMessage("loading_engine"),
                                windowPosition: 'composition',
                                vertical: true
                            }
                        }, (ok) => ok ? res(null) : rej());
                    }));
                    if (this.context != null) {
                        promises.push(new Promise((res, rej) => {
                            chrome.input.ime.setCandidates({
                                contextID: this.context.contextID,
                                candidates: []
                            }, (ok) => ok ? res(null) : rej());
                        }));
                    }
                } else {
                    // Virtual keyboard is visible, send candidates to display them in virtual keyboard
                    this.sendCandidatesToInputView([{
                        candidate: chrome.i18n.getMessage("loading_engine"),
                        ix: 1,
                    }]);
                }
            } else {
                this.resetUI();
            }
        }
        if (this.inputViewVisible) {
            chrome.input.ime.setCandidateWindowProperties({
                engineID: this.engineId,
                properties: {
                    visible: false,
                }
            });
        }
        await Promise.all(promises);
    }

    async commitIfAvailable() {
        let commit = await this.session.getCommit();
        if (commit) {
            await new Promise((res, rej) => {
                chrome.input.ime.commitText({
                    contextID: this.context.contextID,
                    text: commit.text
                }, (ok) => ok ? res(null) : rej());
            });
            this.invalidateCandidateCache();
            this.sendCandidatesToInputView([]);
        }
    }

    feedKey(keyData: chrome.input.ime.KeyboardEvent): Promise<boolean> | boolean {
        const release = keyData.type == 'keyup';
        if (this.session) {
            let mask = 0;
            if (keyData.altKey)
                mask ^= kAltMask;
            if (keyData.shiftKey)
                mask ^= kShiftMask;
            if (keyData.ctrlKey)
                mask ^= kControlMask;
            if (release)
                mask ^= kReleaseMask;
            let code: number;
            if (keyData.key.length > 1) {
                if (keyData.code in kSpecialKeys) {
                    code = kSpecialKeys[keyData.code];
                } else {
                    this.printErr("Unhandled key " + keyData.key);
                    return false;
                }
            } else {
                // If Alt key or Ctrl key is pressed, then it should be a shortcut key,
                // and we should pass the original key to RIME, instead of modified key.
                // For example, if user pressed Ctrl+Shift+3, key is '#' (because shift is
                // pressed) and code is 'Digit3'. In order for RIME to recognize this shortcut, 
                // the value sent to RIME should be 51 ('3') instead of 35 ('#'). So we get code
                // from the 'code' field instead of 'key' field.
                if ((keyData.altKey || keyData.ctrlKey) && keyData.code in kConventionalKeys) {
                    code = kConventionalKeys[keyData.code];
                } else {
                    code = keyData.key.charCodeAt(0);
                }
            }
            this.invalidateCandidateCache();
            return (async () => {
                let handled = false;
                try {
                    handled = await this.session.processKey(code, mask);
                } catch (ex) {
                    this.printErr("Error while processing key " + ex.toString());
                    console.error(ex);
                    handled = false;
                }
                await this.refreshContext();
                await this.commitIfAvailable();
                if (!this.preeditEmpty && (keyData.code == "PageUp" || keyData.code == "PageDown")) {
                    // Chrome will crash if PageUp or PageDown is sent while user is typing in OmniBar and candidate box is shown
                    // So we always return handled = true in this case, to prevent key event being sent to Chrome
                    return true;
                }
                return handled;
            })();
        } else {
            if (!release && this.loadMutex.isLocked()) {
                // RIME is loading
                if (keyData.key.length > 1 && this.inputCache.length > 0) {
                    if (keyData.code == "Backspace") {
                        this.inputCache.push(null);
                    } else if (keyData.code == "Enter") {
                        if (this.context) {
                            chrome.input.ime.commitText({
                                contextID: this.context.contextID,
                                text: this.inputCacheToString()
                            });
                            this.inputCache = [];
                        }
                    } else if (keyData.code == "Escape") {
                        this.inputCache = [];
                    } else {
                        return false;
                    }
                } else {
                    const char = keyData.key;
                    if (this.inputCache.length == 0 && !(/^[a-z]$/.test(char))) {
                        // If buffer is empty and input is not letter, just put it to screen directly
                        return false;
                    }
                    this.inputCache.push(char);
                }
                return this.refreshContext().then(() => true);
            } else {
                return false;
            }
        }
    }

    async selectCandidate(index: number, currentPage: boolean = true) {
        this.invalidateCandidateCache();
        await this.session?.actionCandidate(index, 'select', currentPage);
        await this.commitIfAvailable();
        await this.refreshContext();
    }

    async deleteCandidate(index: number, currentPage: boolean = true) {
        await this.session?.actionCandidate(index, 'delete', currentPage);
        await this.refreshContext();
    }

    lastRightClickItem: number;
    lastRightClickTime: number;

    rightClick(index: number) {
        const curTime = (new Date()).getTime();
        if (this.lastRightClickItem == index && curTime - this.lastRightClickTime < 3000) {
            console.log("Del candidate");
            this.deleteCandidate(index);
            this.lastRightClickItem = -1;
        } else {
            console.log("Ready Del candidate");
            this.deleteCandidate(index);
            this.lastRightClickItem = index;
            this.lastRightClickTime = curTime;
        }
    }

    inputViewVisible: boolean;

    async setAsciiMode(isAscii: boolean) {
        await this.session?.setOption("ascii_mode", isAscii);
    }

    async handleInputViewVisibilityChanged(visible: boolean) {
        this.inputViewVisible = visible;
        if (!visible) {
            this.session?.clearComposition();
        }
        this.refreshContext();
    }

    // Only used in input view
    candidateCache: RimeCandidate[];
    candidateIterator?: RimeCandidateIterator;

    async fetchMoreCandidates(count: number) {
        if (this.candidateIterator) {
            for (let i = 0; i < count; i++) {
                await this.candidateIterator.advance();
                const c = await this.candidateIterator.current();
                if (c == null)
                    break;
                this.candidateCache.push(c);
            }
            this.sendCandidateCacheToInputView();
        }
    }

    async invalidateCandidateCache() {
        this.candidateCache = [];
        this.candidateIterator?.destroy();
        this.candidateIterator = null;
    }
}
