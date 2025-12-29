const INTERNAL_STAYALIVE_PORT = "sfv23i9t4gju8v23vtgn23gv3y"
var alivePort = null;
var wakeup = null;

export function serviceWorkerKeepalive() {
    var lastCall = Date.now();
    if (!wakeup) {
        wakeup = setInterval(() => {

            const now = Date.now();
            const age = now - lastCall;

            console.log(`(DEBUG StayAlive) ----------------------- time elapsed: ${age}`)
            if (alivePort == null) {
                alivePort = chrome.runtime.connect({ name: INTERNAL_STAYALIVE_PORT })

                alivePort.onDisconnect.addListener((p) => {
                    if (chrome.runtime.lastError) {
                        console.log(`(DEBUG StayAlive) Disconnected due to an error: ${chrome.runtime.lastError.message}`);
                    } else {
                        console.log(`(DEBUG StayAlive): port disconnected`);
                    }

                    alivePort = null;
                });
            }

            if (alivePort) {

                alivePort.postMessage({ content: "ping" });

                if (chrome.runtime.lastError) {
                    console.log(`(DEBUG StayAlive): postMessage error: ${chrome.runtime.lastError.message}`)
                } else {
                    console.log(`(DEBUG StayAlive): "ping" sent through ${alivePort.name} port`)
                }

            }
        }, 25000);
    }
}
