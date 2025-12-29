import { parse } from "yaml";
import { getFs, kDefaultSettings } from "@/lib/utils";
import { InputController } from "./controller";
import { serviceWorkerKeepalive } from "./keepalive";
import { onMessage } from "@/lib/messaging";

export default defineBackground({
  main() {
    async function fallbackDefaultSettings() {
      await chrome.storage.sync.set({ settings: kDefaultSettings });
      await chrome.storage.local.set({
        schemaList: parse(await (await fetch("/builtin/schema-list.yaml")).text())
      });
      if (!self.controller.engine && !self.controller.engineLoading) {
        const fileList = ["aurora_pinyin.prism.bin", "aurora_pinyin.reverse.bin", "aurora_pinyin.table.bin", "aurora_pinyin.schema.yaml"];
        const fs = await getFs();
        for (const f of fileList) {
          const resp = await fetch(`/builtin/${f}`);
          const buf = await resp.arrayBuffer();
          await fs.writeWholeFile(`/root/build/${f}`, new Uint8Array(buf));
        }
        await self.controller.loadRime(true);
      }
    }

    const postLoad = async () => {
      chrome.input.ime.onFocus.addListener(async (context) => {
        // Todo: in incognito tab, context.shouldDoLearning = false,
        // we should disable rime learning in such context
        console.log("Got focus event, context = ", context);
        self.controller.context = context;
      });

      chrome.input.ime.onBlur.addListener((ctxId) => {
        if (self.controller.context?.contextID == ctxId) {
          self.controller.clearContext();
        }
      });

      chrome.input.ime.onKeyEvent.addListener((engineID: string, keyData: chrome.input.ime.KeyboardEvent, requestId: string) => {
        console.log("Processing key: ", JSON.stringify(keyData));
        const result = self.controller.feedKey(keyData);
        if (result === false || result === true) {
          return result;
        } else {
          result.then((handled) => chrome.input.ime.keyEventHandled(requestId, handled));
          return undefined;
        }
      });

      chrome.input.ime.onCandidateClicked.addListener((engineId, candidateId, button) => {
        console.log(candidateId, button);
        if (button == 'left') {
          self.controller.selectCandidate(candidateId);
          self.controller.lastRightClickItem = -1;
        } else if (button == 'right') {
          self.controller.rightClick(candidateId);
        }
      });
    }

    // Initialize controller
    let rimeLoaded = false;
    self.controller = new InputController();

    chrome.storage.sync.get(["settings"]).then(async (obj) => {
      // Only load engine if settings exists
      if (obj.settings) {
        const ok = await self.controller.loadRime(false);
        rimeLoaded = ok;
      }
    }).catch((e) => {
      console.error('load settings error', e);
    }).finally(async () => {
      if (!rimeLoaded) {
        await fallbackDefaultSettings();
      }
      await postLoad();
    });

    // IME activation listener
    chrome.input.ime.onActivate.addListener(async (engineId, screen) => {
      self.controller.engineId = engineId;
      serviceWorkerKeepalive();
    });

    // Message handlers using @webext-core/messaging
    onMessage('GetEngineStatus', async () => {
      const loaded = self.controller.engine != null;
      const loading = self.controller.engineLoading;
      let schemaList = [];
      let currentSchema = "";

      if (loaded && !loading) {
        currentSchema = await self.controller.session?.getCurrentSchema();
      }

      return { loading, loaded, schemaList, currentSchema };
    });

    onMessage('GetAsciiMode', async () => {
      try {
        const asciiMode = await self.controller.session?.getOption("ascii_mode");
        return { asciiMode };
      } catch (ex) {
        console.error("Error while getting ascii mode", ex);
        return { asciiMode: true };
      }
    });

    onMessage('GetRimeLogs', () => {
      return { logs: self.controller.getLogs() };
    });

    onMessage('ReloadRime', async () => {
      await self.controller.loadRime(true);
    });

    onMessage('SimulateKey', () => {
      return { handled: false };
    });

    // Port listeners for inputview
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name == "inputviewMessages") {
        console.log("InputView Port Connecting");

        port.onMessage.addListener((msg) => {
          console.log("Message from inputview:", msg);
          if (msg.name == "visibility_change") {
            self.controller.handleInputViewVisibilityChanged(msg.visibility);
          } else if (msg.name == "toggle_language_state") {
            self.controller.setAsciiMode(!msg.msg);
          } else if (msg.name == "select_candidate") {
            self.controller.selectCandidate(msg.candidate.ix, false);
          } else if (msg.name == "load_more_candidate") {
            self.controller.fetchMoreCandidates(msg.more_candidate_count);
          }
        });

        const onToggleLanguageState = function(asciiMode: boolean) {
          port.postMessage({ name: 'front_toggle_language_state', msg: !asciiMode });
        }

        const onCandidatesBack = function(candidates: Array<{ candidate: string, ix: number }>) {
          port.postMessage({ name: "candidates_back", msg: { source: "source", candidates }});
        }

        self.controller.addListener("toggleLanguageState", onToggleLanguageState);
        self.controller.addListener("candidatesBack", onCandidatesBack);

        port.onDisconnect.addListener(() => {
          console.log("InputView disconnected");
          self.controller.removeListener("toggleLanguageState", onToggleLanguageState);
          self.controller.removeListener("candidatesBack", onCandidatesBack);
          self.controller.handleInputViewVisibilityChanged(false);
        });
      }
    });
  }
});
