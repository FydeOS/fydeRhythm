
import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const maintenance = !!req.body?.maintenance;
    await self.controller.loadRime(maintenance);
    res.send({});
}

export default handler