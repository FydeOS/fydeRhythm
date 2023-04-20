// Handler for SELECT_CANDIDATE event from inputview

import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const candidate = (req as any).candidate;
    console.log("Select candidate: ", candidate);
}

export default handler
