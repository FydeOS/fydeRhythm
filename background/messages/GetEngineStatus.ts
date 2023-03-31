import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    if (self.controller.loadMutex.isLocked()) {
        await self.controller.loadMutex.waitForUnlock();
    }
    const loaded = self.controller.engine != null;
    const list = await self.controller.engine?.getSchemaList();
    let current = await self.controller.session?.getCurrentSchema();
    res.send({ loaded, list, current });
}

export default handler