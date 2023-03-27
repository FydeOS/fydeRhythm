import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const mutex = (self as any).rimeMutex;
    await mutex.runExclusive(async () => {
        const rimeSession = (self as any).rimeSession;
        const handled = await rimeSession.processKey(req.body.keyCode, 0);
        if (handled) {
            const context = await rimeSession.getContext();
            const commit = await rimeSession.getCommit();
            const status = await rimeSession.getCommit();
            res.send({
                handled: true,
                context: context,
                commit: commit,
                status: status
            });
        } else {
            res.send({
                handled: false
            });
        }
    })
}

export default handler