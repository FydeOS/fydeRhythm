// Handler for TOGGLE_LANGUAGE_STATE event from inputview

import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const isEnMode: boolean = (req as any).msg;
    console.log("Keyboard notify ascii", !isEnMode);
    self.controller.setAsciiMode(!isEnMode);
}

export default handler
