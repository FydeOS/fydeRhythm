import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    self.controller.clearContext();
    await self.controller.session?.selectSchema(req.body.id);
    res.send({ });
}

export default handler