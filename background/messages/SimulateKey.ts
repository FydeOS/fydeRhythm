import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    /*
    if (!(self as any).testSession) {
        const engine = await getEngine();
        (self as any).testSession = await engine.createSession();
    }
    const rimeSession = (self as any).testSession;
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
    */
    res.send({
        handled: false
    });
}

export default handler