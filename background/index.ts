import { getEngine, RimeEngine, RimeSession } from "./engine";

export class InputController {
    context: chrome.input.ime.InputContext;
    session: RimeSession;
    engineId: string;
    engine: RimeEngine;

    constructor(eid: string, e: RimeEngine) {
        this.engineId = eid;
        this.engine = e;
        this.context = null;
        this.session = null;
    }
}

// Preload engine
async function preheatEngine() {
    await getEngine();
}

preheatEngine();

chrome.input.ime.onActivate.addListener(async (engineId, screen) => {
    self.controller = new InputController(engineId, await getEngine());
    self.controller.session = await self.controller.engine.createSession();
});

chrome.input.ime.onDeactivated.addListener((engineId) => {
    if (self.controller.engineId == engineId) {
        self.controller = null;
    }
});

chrome.input.ime.onFocus.addListener(async (context) => {
    // Todo: in incoginto tab, should do learning = false, disable rime learning in such context
    console.log("Got focus event, context = ", context);
    self.controller.context = context;
})

chrome.input.ime.onBlur.addListener((ctxId) => {
    if (self.controller.context?.contextID == ctxId) {
        self.controller.context = null;
    }
})

const kShiftMask = 1 << 0;
const kControlMask = 1 << 2;
const kMod1Mask = 1 << 3;
const kAltMask = kMod1Mask;

const keys = {
    'Up': 0xff52,
    'Down': 0xff54,
    'Page_up': 0xff55,
    'Page_down': 0xff56,
    'Enter': 0xff0d, // Return
    'Backspace': 0xff08,
    'Right': 0xff53,
    'Left': 0xff51,
    'Esc': 0xff1b,
}

chrome.input.ime.onKeyEvent.addListener((engineID: string, keyData: chrome.input.ime.KeyboardEvent, requestId: string) => {
    console.log("Processing key: ", keyData);
    if (keyData.type == 'keydown') {
        if (self.controller.session) {
            let mask = 0;
            if (keyData.altKey)
                mask ^= kAltMask;
            if (keyData.shiftKey)
                mask ^= kShiftMask;
            if (keyData.ctrlKey)
                mask ^= kControlMask;
            let code: number;
            if (keyData.key.length > 1) {
                if (keyData.key in keys) {
                    code = keys[keyData.key];
                } else {
                    console.log("Unhandled key %s", keyData.key);
                    return false;
                }
            } else {
                code = keyData.key.toLowerCase().charCodeAt(0);
            }
            (async () => {
                console.log("Send event to RIME: code = %d, mask = %d", code, mask);
                let handled = await self.controller.session.processKey(code, mask);
                console.log("Rime handled: ", handled);
                if (handled) {
                    let commit = await self.controller.session.getCommit();
                    let context = await self.controller.session.getContext();
                    if (context) {
                        console.log("Got context", context);
                        try {
                            await new Promise((res, rej) => {
                                chrome.input.ime.setComposition({
                                    contextID: self.controller.context.contextID,
                                    cursor: context.composition.cursorPosition,
                                    selectionEnd: context.composition.selectionEnd,
                                    selectionStart: context.composition.selectionStart,
                                    text: context.composition.preedit
                                }, (ok) => ok ? res(null) : rej());
                            });
                            if (context.menu.candidates.length > 0) {
                                await new Promise((res, rej) => {
                                    chrome.input.ime.setCandidates({
                                        contextID: self.controller.context.contextID,
                                        candidates: context.menu.candidates.map((v, idx) => ({
                                            candidate: v.text,
                                            id: idx,
                                            label: (idx + 1).toString(),
                                            annotation: v.comment
                                        })),
                                    }, (ok) => ok ? res(null) : rej());
                                });
                                await new Promise((res, rej) => {
                                    chrome.input.ime.setCandidateWindowProperties({
                                        engineID: self.controller.engineId,
                                        properties: {
                                            currentCandidateIndex: context.menu.highlightedCandidateIndex,
                                            visible: true,
                                            cursorVisible: true,
                                            auxiliaryTextVisible: false,
                                            pageSize: context.menu.pageSize,
                                            auxiliaryText: `Page ${context.menu.pageNumber}` + (context.menu.isLastPage ? " (Last)" : ""),
                                            windowPosition: 'composition',
                                            vertical: true
                                        }
                                    }, (ok) => ok ? res(null) : rej());
                                });
                            } else {
                                await new Promise((res, rej) => {
                                    chrome.input.ime.setCandidateWindowProperties({
                                        engineID: self.controller.engineId,
                                        properties: {
                                            visible: false,
                                        }
                                    }, (ok) => ok ? res(null) : rej());
                                });
                            }
                        } catch(ex) {
                            console.error(ex);
                        }
                    }
                    if (commit) {
                        console.log("Got commit");
                        await new Promise((res, rej) => {
                            chrome.input.ime.commitText({
                                contextID: self.controller.context.contextID,
                                text: commit.text
                            }, (ok) => ok ? res(null) : rej());
                        });
                    }
                }
                chrome.input.ime.keyEventHandled(requestId, handled);
            })();
            return undefined;
        }

    }
    return false;
})

export { }