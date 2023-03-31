import { Mutex } from "async-mutex";
import { RimeEngine, RimeSession } from "./engine";

export class InputController {
    context?: chrome.input.ime.InputContext;
    session?: RimeSession;
    engineId?: string;
    engine?: RimeEngine;
    loadMutex: Mutex;
    inputCache: string[];

    constructor() {
        this.engineId = null;
        this.engine = null;
        this.context = null;
        this.session = null;
        this.inputCache = [];
        this.loadMutex = new Mutex();
    }

    async loadRime(maintenance: boolean = false) {
        if (this.engineId) {
            this.resetUI();
        }
        if (this.loadMutex.isLocked()) {
            console.log("RIME is locked, wait for unlock");
            // If RIME is already loading, just wait for it to complete
            await this.loadMutex.waitForUnlock();
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
            }

            const engine = new RimeEngine();

            await new Promise(r => setTimeout(r, 10));

            await engine.initialize();
            if (maintenance) {
                await engine.performMaintenance();
            }
            const session = await engine.createSession();
            if (this.inputCache.length > 0) {
                const list = this.inputCache;
                this.inputCache = [];
                for (const c of list) {
                    if (c == null) // Backspace
                        await session.processKey(0xff08, 0);
                    else
                        await session.processKey(c.charCodeAt(0), 0);
                }
            }
            this.engine = engine;
            this.session = session;
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
        chrome.input.ime.setCandidateWindowProperties({
            engineID: this.engineId,
            properties: {
                visible: false,
            }
        });
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
                                auxiliaryText: `Page ${rimeContext.menu.pageNumber}` + (rimeContext.menu.isLastPage ? " (Last)" : ""),
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
                                    label: (idx + 1).toString(),
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
                            auxiliaryText: "Loading RIME...",
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
}