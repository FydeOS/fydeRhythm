const INTERNAL_STAYALIVE_PORT = "sfv23i9t4gju8v23vtgn23gv3y"
let alivePort: chrome.runtime.Port | null = null;
let wakeup: ReturnType<typeof setInterval> | null = null;

export function serviceWorkerKeepalive() {
    const lastCall = Date.now();
    if (!wakeup) {
        wakeup = setInterval(() => {

            const now = Date.now();
            const age = now - lastCall;

            console.log(`(DEBUG StayAlive) ----------------------- time elapsed: ${age}`)
            if (alivePort == null) {
                alivePort = chrome.runtime.connect({ name: INTERNAL_STAYALIVE_PORT })

                alivePort.onDisconnect.addListener((_p) => {
                    if (chrome.runtime.lastError) {
                        console.log(`(DEBUG StayAlive) Disconnected due to an error: ${chrome.runtime.lastError.message}`);
                    } else {
                        console.log(`(DEBUG StayAlive): port disconnected`);
                    }

                    alivePort = null;
                });
            }

            if (alivePort) {
                // postMessage throws synchronously on a dead port (it does not
                // set runtime.lastError); an uncaught throw here would kill
                // the interval tick.
                try {
                    alivePort.postMessage({ content: "ping" });
                    console.log(`(DEBUG StayAlive): "ping" sent through ${alivePort.name} port`)
                } catch (e) {
                    console.log(`(DEBUG StayAlive): postMessage failed: ${e}`)
                    alivePort = null;
                }
            }
        }, 25000);
    }
}
