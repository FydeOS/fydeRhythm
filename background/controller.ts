import { Mutex } from "async-mutex";
import { RimeEngine, RimeSession } from "./engine";

const kShiftMask = 1 << 0;
const kControlMask = 1 << 2;
const kMod1Mask = 1 << 3;
const kAltMask = kMod1Mask;
const kReleaseMask = 1 << 30;

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
    'ShiftRight': 0xffe2
}

export class InputController {
    context?: chrome.input.ime.InputContext;
    session?: RimeSession;
    engineId?: string;
    engine?: RimeEngine;
    loadMutex: Mutex;
    inputCache: string[];

    rimeLogBuffer: string[];
    rimeLogBufferPos: number;

    constructor() {
        this.rimeLogBuffer = new Array<string>(400);
        this.rimeLogBufferPos = 0;
        this.engineId = null;
        this.engine = null;
        this.context = null;
        this.session = null;
        this.inputCache = [];
        this.loadMutex = new Mutex();
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

    async loadRime(maintenance: boolean = false) {
        if (this.engineId) {
            this.resetUI();
        }
        if (this.loadMutex.isLocked()) {
            console.log("RIME loading mutex is locked, wait for unlock");
            // If RIME is already loading, just wait for it to complete
            await this.loadMutex.waitForUnlock();
            // Engine is loaded. If we want to run maintenance, we should reload the engine; or else just exit because engine is loaded.
            if (!maintenance) {
                return;
            }
        }
        console.log("Loading RIME engine...");
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

            const engine = new RimeEngine();

            await new Promise(r => setTimeout(r, 10));

            await engine.initialize(this.printErr.bind(this));
            if (maintenance) {
                await engine.performMaintenance();
            }
            const session = await engine.createSession();
            if (this.inputCache.length > 0) {
                const list = this.inputCache;
                this.inputCache = [];
                for (const c of list) {
                    if (c == null) // Backspace
                        await session.processKey(kSpecialKeys['Backspace'], 0);
                    else
                        await session.processKey(c.charCodeAt(0), 0);
                }
            }
            this.engine = engine;
            this.session = session;
            this.notifyRimeStatusChanged();
        });
        await this.refreshContext();
    }

    resetUI() {
        if (this.context != null) {
            chrome.input.ime.setComposition({
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
    }

    async clearContext() {
        this.session?.clearComposition();
        this.context = null;
        this.resetUI();
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

    async refreshContext(): Promise<void> {
        console.log("Engine id = ", this.engineId);
        if (!this.engineId)
            return;
        const promises = [];
        if (this.session != null) {
            const rimeContext = await this.session?.getContext();
            if (rimeContext) {
                if (this.context != null) {
                    promises.push(new Promise((res, rej) => {
                        const c = {
                            contextID: this.context.contextID,
                            cursor: rimeContext.composition.cursorPosition,
                            selectionEnd: rimeContext.composition.selectionEnd,
                            selectionStart: rimeContext.composition.selectionStart,
                            text: rimeContext.composition.preedit
                        };
                        console.log(c);
                        chrome.input.ime.setComposition(c, (ok) => ok ? res(null) : rej());
                    }));
                }
                if (rimeContext.menu.candidates.length > 0) {
                    promises.push(new Promise((res, rej) => {
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
                                vertical: true
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
                this.resetUI();
            }
        } else {
            if (this.inputCache.length > 0) {
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
                    const preedit = this.inputCacheToString();
                    promises.push(new Promise((res, rej) => {
                        chrome.input.ime.setComposition({
                            contextID: this.context.contextID,
                            cursor: preedit.length,
                            selectionStart: 0,
                            selectionEnd: preedit.length,
                            text: preedit,
                        }, (ok) => ok ? res(null) : rej());
                    }));
                    promises.push(new Promise((res, rej) => {
                        chrome.input.ime.setCandidates({
                            contextID: this.context.contextID,
                            candidates: []
                        }, (ok) => ok ? res(null) : rej());
                    }));
                }
            } else {
                this.resetUI();
            }
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
                    console.log("Unhandled key %s", keyData.key);
                    return false;
                }
            } else {
                code = keyData.key.toLowerCase().charCodeAt(0);
            }
            return (async () => {
                let handled = false;
                handled = await this.session.processKey(code, mask);
                await this.refreshContext();
                await this.commitIfAvailable();
                return handled;
            })();
        } else {
            if (!release) {
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
                    const char = keyData.key.toLowerCase();
                    if (this.inputCache.length == 0 && !(/^[a-z]$/.test(char))) {
                        // If buffer is empty and input is not letter, just put it to screen directly
                        return false;
                    }
                    this.inputCache.push(char);
                }
                return this.refreshContext().then(() => true);
            }
        }
    }

    async selectSchema(id: string): Promise<void> {
        this.resetUI();
        await this.loadMutex.runExclusive(async () => {
            this.notifyRimeStatusChanged();
            await this.session?.selectSchema(id);
            this.notifyRimeStatusChanged();
        });
    }

    async selectCandidate(index: number) {
        await this.session?.actionCandidateOnCurrentPage(index, 'select');
        await this.commitIfAvailable();
        await this.refreshContext();
    }

    async deleteCandidate(index: number) {
        await this.session?.actionCandidateOnCurrentPage(index, 'delete');
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
}