import { InputController } from "./controller";
import { RimeContext, RimeEngine, RimeSession } from "./engine";
import { serviceWorkerKeepalive } from "./keepalive";


self.controller = new InputController();
// Load engine (no need to wait for it to complete)
self.controller.loadRime();

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

chrome.input.ime.onKeyEvent.addListener((engineID: string, keyData: chrome.input.ime.KeyboardEvent, requestId: string) => {
    console.log("Processing key: ", keyData);
    const result = self.controller.feedKey(keyData);
    if (result === false || result === true) {
        return result;
    } else {
        result.then((handled) => chrome.input.ime.keyEventHandled(requestId, handled));
        return undefined;
    }
});

export { }