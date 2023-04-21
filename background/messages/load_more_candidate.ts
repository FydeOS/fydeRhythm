// Handler for LOAD_MORE_CANDIDATE event from inputview

import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const count = (req as any).more_candidate_count;
    console.log("Load more candidates: ", count);
    self.controller.fetchMoreCandidates(count);
}

export default handler
