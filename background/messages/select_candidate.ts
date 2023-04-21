// Handler for SELECT_CANDIDATE event from inputview

import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const candidate = (req as any).candidate;
    self.controller.selectCandidate(candidate.ix, false);
}

export default handler
