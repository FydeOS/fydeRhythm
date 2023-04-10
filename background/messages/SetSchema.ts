import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    await self.controller.selectSchema(req.body.id);
    res.send({ });
}

export default handler