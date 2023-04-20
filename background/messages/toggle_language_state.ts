// Handler for TOGGLE_LANGUAGE_STATE event from inputview

import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const isEnMode: boolean = (req as any).msg;
    console.log("Is EN mode: ", isEnMode);
}

export default handler
