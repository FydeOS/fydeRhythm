import { parse } from "yaml";
import { getFs, kDefaultSettings, type ImeSettings } from "@/lib/utils";
import { InputController } from "./controller";
import { serviceWorkerKeepalive } from "./keepalive";
import { onMessage } from "@/lib/messaging";
import { listEnabledInstalledSchemas } from "./schemas";
import { resolveInstalledSchemaId } from "@/lib/schema-install";
async function buildSchemaMenuItems(activeSchema: string, enabledSchemas?: string[]): Promise<chrome.input.ime.MenuItem[]> {
  const list = await listEnabledInstalledSchemas(activeSchema, enabledSchemas);
  return list.map((entry) => ({
    id: entry.id,
    label: entry.label,
    style: "radio",
    visible: true,
    checked: entry.id === activeSchema,
    enabled: true,
  }));
}

// onActivate doesn't re-fire when the MV3 worker respawns, so cache engineId in
// storage.session to recover it on the next cold start (see restoreEngineId).
const kEngineIdSessionKey = "imeEngineId";

export async function refreshImeMenuItems() {
  const engineID = self.controller?.engineId;
  if (!engineID) return;
  const obj = await chrome.storage.sync.get(["settings"]) as { settings?: ImeSettings };
  const active = (obj.settings?.schema ? obj.settings : null) ?? self.controller?.activeSettings;
  if (!active?.schema) return;
  const items = await buildSchemaMenuItems(active.schema, active.enabledSchemas);
  try {
    chrome.input.ime.setMenuItems({ engineID, items });
  } catch (ex) {
    console.error("setMenuItems failed:", ex);
  }
}

async function persistEngineId(engineId: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [kEngineIdSessionKey]: engineId });
  } catch (ex) {
    console.error("persistEngineId failed:", ex);
  }
}

// On startup, restore a cached engineId (if onActivate hasn't re-fired) and refresh
// the menu so it populates without a click. No-op if engineId is known or uncached.
export async function restoreEngineId(): Promise<void> {
  if (!self.controller || self.controller.engineId) return;
  let cached: string | undefined;
  try {
    const obj = await chrome.storage.session.get([kEngineIdSessionKey]) as { [kEngineIdSessionKey]?: string };
    cached = obj[kEngineIdSessionKey];
  } catch (ex) {
    console.error("restoreEngineId failed:", ex);
    return;
  }
  // onActivate may have set a fresh engineId while we awaited.
  if (!cached || !self.controller || self.controller.engineId) return;
  self.controller.engineId = cached;
  await refreshImeMenuItems();
}

async function resolveStartupSettings(settings: ImeSettings): Promise<ImeSettings | null> {
  const fs = await getFs();
  const schema = resolveInstalledSchemaId(
    await fs.readAll(),
    settings.schema,
    settings.enabledSchemas,
  );
  if (!schema) {
    return null;
  }
  if (schema === settings.schema) {
    return settings;
  }

  const next = { ...settings, schema };
  console.warn(`Configured schema "${settings.schema}" is not installed in the v3 layout; using "${schema}" instead.`);
  await chrome.storage.sync.set({ settings: next });
  return next;
}

// Send the inputview's "init" message (runs its one-time setup) and return a
// cleanup fn. The init must not be sent before RIME is ready, or feedKey can't
// compose pinyin and the keyboard types raw English; so on a cold start we defer
// until the controller's "schemaSwitched" fires, bounded by a timeout in case the
// load fails and never fires. Exactly one init is sent whichever path wins.
export const kInputViewInitFallbackMs = 8000;

export function sendInputViewInit(
  controller: InputController | undefined,
  postToPort: (msg: object) => void,
  fallbackMs: number = kInputViewInitFallbackMs,
): () => void {
  let done = false;
  const send = () => {
    if (done) return;
    done = true;
    const session = controller?.session;
    if (!session) {
      postToPort({ name: "init", msg: { asciiMode: false } });
      return;
    }
    let result: unknown;
    try {
      // getOption may be missing or throw synchronously on a half-destroyed session.
      result = session.getOption("ascii_mode");
    } catch {
      postToPort({ name: "init", msg: { asciiMode: false } });
      return;
    }
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result as PromiseLike<boolean | undefined>).then((asciiMode) => {
        postToPort({ name: "init", msg: { asciiMode: asciiMode ?? false } });
      }).catch(() => postToPort({ name: "init", msg: { asciiMode: false } }));
    } else {
      postToPort({ name: "init", msg: { asciiMode: (result as boolean | undefined) ?? false } });
    }
  };

  // Warm path (or degenerate no-controller): init immediately.
  if (controller?.session || !controller) {
    send();
    return () => { };
  }

  // Cold start: defer until RIME is ready, with a timeout fallback.
  const onReady = () => {
    cleanup();
    send();
  };
  controller.addListener("schemaSwitched", onReady);
  const timer = setTimeout(() => {
    cleanup();
    send();
  }, fallbackMs);
  function cleanup() {
    controller!.removeListener("schemaSwitched", onReady);
    clearTimeout(timer);
  }
  return cleanup;
}

export default defineBackground({
  main() {
    async function fallbackDefaultSettings() {
      await chrome.storage.sync.set({ settings: kDefaultSettings });
      await chrome.storage.local.set({
        schemaList: parse(await (await fetch("/builtin/schema-list.yaml")).text())
      });
      if (!self.controller.engine && !self.controller.engineLoading) {
        const schema = kDefaultSettings.schema;
        const schemaBasePath = `/root/${schema}`;
        const fileList = ["aurora_pinyin.prism.bin", "aurora_pinyin.reverse.bin", "aurora_pinyin.table.bin", "aurora_pinyin.schema.yaml"];
        const fs = await getFs();
        for (const f of fileList) {
          const resp = await fetch(`/builtin/${f}`);
          const buf = await resp.arrayBuffer();
          await fs.writeWholeFile(`${schemaBasePath}/build/${f}`, new Uint8Array(buf));
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
          result.then((handled: boolean) => chrome.input.ime.keyEventHandled(requestId, handled));
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

      chrome.input.ime.onMenuItemActivated.addListener(async (engineID, menuId) => {
        const current = self.controller.activeSettings?.schema;
        if (current === menuId) return;
        const obj = await chrome.storage.sync.get(["settings"]) as { settings?: ImeSettings };
        const next: ImeSettings = { ...(obj.settings ?? kDefaultSettings), schema: menuId };
        await chrome.storage.sync.set({ settings: next });
        await self.controller.loadRime(true);
      });
    }

    // Initialize controller
    let rimeLoaded = false;
    self.controller = new InputController();
    self.controller.addListener("schemaSwitched", () => { refreshImeMenuItems(); });

    void restoreEngineId();

    chrome.storage.sync.get(["settings"]).then(async (obj) => {
      // Only load engine if settings exists
      if (obj.settings) {
        const settings = await resolveStartupSettings(obj.settings as ImeSettings);
        if (settings) {
          const ok = await self.controller.loadRime(false);
          rimeLoaded = ok;
        }
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
    chrome.input.ime.onActivate.addListener(async (engineId, _screen) => {
      self.controller.engineId = engineId;
      void persistEngineId(engineId);
      serviceWorkerKeepalive();
      refreshImeMenuItems();
    });

    chrome.input.ime.onDeactivated.addListener((engineId) => {
      self.controller.deactivate(engineId);
    });

    // Rebuild menu when schemas are installed/removed or active setting changes elsewhere
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.schemaList || changes.selfDefinedSchema)) {
        refreshImeMenuItems();
      } else if (area === "sync" && changes.settings) {
        refreshImeMenuItems();
      }
    });

    // Message handlers using @webext-core/messaging
    onMessage('GetEngineStatus', async () => {
      const loaded = self.controller.engine != null;
      const loading = self.controller.engineLoading;
      const schemaList: never[] = [];
      let currentSchema = "";

      if (loaded && !loading) {
        currentSchema = (await self.controller.session?.getCurrentSchema()) ?? "";
      }

      return { loading, loaded, schemaList, currentSchema };
    });

    onMessage('GetAsciiMode', async () => {
      try {
        const asciiMode = await self.controller.session?.getOption("ascii_mode") ?? false;
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

    onMessage('RefreshImeMenu', async () => {
      await refreshImeMenuItems();
    });

    onMessage('SimulateKey', () => {
      return { handled: false };
    });

    // Port listeners for inputview
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name == "inputviewMessages") {
        console.log("InputView Port Connecting");

        let inputViewDisconnected = false;
        const postToPort = (msg: object) => {
          if (inputViewDisconnected) return;
          try {
            port.postMessage(msg);
          } catch {
            inputViewDisconnected = true;
          }
        };

        const cancelInputViewInit = sendInputViewInit(self.controller, postToPort);

        port.onMessage.addListener((msg) => {
          console.log("Message from inputview:", msg);
          if (!msg || typeof msg !== "object") return;
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

        const onToggleLanguageState = function (asciiMode: boolean) {
          postToPort({ name: 'front_toggle_language_state', msg: !asciiMode });
        }

        const onCandidatesBack = function (candidates: Array<{ candidate: string, ix: number }>) {
          postToPort({ name: "candidates_back", msg: { source: "source", candidates } });
        }

        const onSchemaSwitched = function () {
          void self.controller?.session?.getOption("ascii_mode").then((asciiMode: boolean | undefined) => {
            postToPort({ name: "schema_switched", msg: { asciiMode: asciiMode ?? false } });
          }).catch(() => {
            postToPort({ name: "schema_switched", msg: { asciiMode: false } });
          });
        }

        self.controller.addListener("toggleLanguageState", onToggleLanguageState);
        self.controller.addListener("candidatesBack", onCandidatesBack);
        self.controller.addListener("schemaSwitched", onSchemaSwitched);

        port.onDisconnect.addListener(() => {
          console.log("InputView disconnected");
          inputViewDisconnected = true;
          cancelInputViewInit();
          self.controller.removeListener("toggleLanguageState", onToggleLanguageState);
          self.controller.removeListener("candidatesBack", onCandidatesBack);
          self.controller.removeListener("schemaSwitched", onSchemaSwitched);
          self.controller.handleInputViewVisibilityChanged(false);
        });
      }
    });
  }
});
