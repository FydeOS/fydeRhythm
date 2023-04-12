import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    const loaded = self.controller.engine != null;
    const loading = self.controller.engineLoading;
    let schemaList = [];
    let currentSchema = "";
    if (loaded && !loading) {
        currentSchema = await self.controller.session?.getCurrentSchema();
    }
    res.send({ loading, loaded, schemaList, currentSchema });
}

export default handler