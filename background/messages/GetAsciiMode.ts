import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    let asciiMode: boolean = true;
    try {
        asciiMode = await self.controller.session.getOption("ascii_mode");
    } catch(ex) {
        // Still send response when error is encountered
        console.error("Error while getting ascii mode", ex);
    }
    res.send({ asciiMode });
}

export default handler