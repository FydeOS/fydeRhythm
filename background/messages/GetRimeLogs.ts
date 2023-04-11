import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    res.send({logs: self.controller.getLogs()});
}

export default handler