import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    await self.controller.loadRime(true);
    res.send({});
}

export default handler