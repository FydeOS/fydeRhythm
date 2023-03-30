import { InputController } from "./controller";
import { RimeContext, RimeEngine, RimeSession } from "./engine";
import { serviceWorkerKeepalive } from "./keepalive";


// Preload engine
async function go() {
    self.controller = new InputController();
    await self.controller.loadRime();


    chrome.input.ime.onActivate.addListener(async (engineId, screen) => {
        self.controller.engineId = engineId;
        serviceWorkerKeepalive();
    });

    chrome.input.ime.onDeactivated.addListener((engineId) => { });

    chrome.input.ime.onFocus.addListener(async (context) => {
        // Todo: in incoginto tab, context.shouldDoLearning = false, 
        // we should disable rime learning in such context
        console.log("Got focus event, context = ", context);
        self.controller.context = context;
    });

    chrome.input.ime.onBlur.addListener((ctxId) => {
        if (self.controller.context?.contextID == ctxId) {
            self.controller.clearContext();
        }
    });

    const kShiftMask = 1 << 0;
    const kControlMask = 1 << 2;
    const kMod1Mask = 1 << 3;
    const kAltMask = kMod1Mask;

    const keys = {
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
                    if (keyData.code in keys) {
                        code = keys[keyData.code];
                    } else {
                        console.log("Unhandled key %s", keyData.key);
                        return false;
                    }
                } else {
                    code = keyData.key.toLowerCase().charCodeAt(0);
                }
                (async () => {
                    console.log("Send event to RIME: code = %d, mask = %d", code, mask);
                    let handled = false;
                    handled = await self.controller.session.processKey(code, mask);
                    console.log("Rime handled: ", handled);
                    if (handled) {
                        await self.controller.refreshContext();

                        let commit = await self.controller.session.getCommit();
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
    });
}


go();
export { }