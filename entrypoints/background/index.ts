import { parse } from "yaml";
import { getFs, guessScriptForSchema, kDefaultSettings, resolveEffectiveLatinLayout, resolveLayoutForSchema, type ImeSettings } from "@/lib/utils";
import { kInputViewPortName, type BackgroundToInputView, type InputViewState, type InputViewToBackground } from "@/lib/shared-types";
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

// Reject if the promise doesn't settle within ms. Used around engine/fs reads
// that can stall for seconds while RIME is loading on a cold start.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// Read the engine's ascii_mode, defaulting to false when the session isn't
// ready, the read fails, or the engine is too busy loading to answer promptly.
async function readAsciiMode(controller: InputController | undefined): Promise<boolean> {
  try {
    const read = controller?.session?.getOption("ascii_mode");
    if (!read) return false;
    return (await withTimeout(read, 3000)) ?? false;
  } catch {
    return false;
  }
}

// Settings as stored (options-page writes land there first), falling back to the
// controller's active copy. Read fresh on every state build so layout-binding
// edits reach the InputView without an engine reload.
async function readSettings(controller: InputController | undefined): Promise<ImeSettings | undefined> {
  try {
    const obj = await chrome.storage.sync.get(["settings"]) as { settings?: ImeSettings };
    return obj.settings ?? controller?.activeSettings;
  } catch {
    return controller?.activeSettings;
  }
}

// Fast snapshot: reads ONLY chrome.storage — never the engine or the schema
// catalog. Both can stall for seconds on a cold start while RIME loads, and
// the InputView cannot render any keys until it receives a state, so this
// must always resolve promptly (asciiMode=false, name=id are acceptable
// placeholders that the refined snapshot corrects).
export async function buildFastInputViewState(controller: InputController | undefined): Promise<InputViewState> {
  const settings = await readSettings(controller);
  const schemaId = settings?.schema ?? "";
  const layout = resolveLayoutForSchema(settings, schemaId);
  return {
    asciiMode: false,
    layout,
    latinLayout: resolveEffectiveLatinLayout(settings, schemaId),
    script: guessScriptForSchema(schemaId, undefined, layout),
    schemaId,
    schemaName: schemaId,
  };
}

// Fill in the engine/fs-dependent fields (real asciiMode, catalog label),
// each guarded by a timeout so a busy engine degrades to the fast values.
export async function refineInputViewState(
  controller: InputController | undefined,
  base: InputViewState,
): Promise<InputViewState> {
  let schemaName = base.schemaName;
  try {
    const settings = await readSettings(controller);
    const list = await withTimeout(listEnabledInstalledSchemas(base.schemaId, settings?.enabledSchemas), 3000);
    schemaName = list.find((s) => s.id === base.schemaId)?.label ?? schemaName;
  } catch {
    // fs not readable yet — the schema id is an acceptable label.
  }
  return {
    ...base,
    asciiMode: await readAsciiMode(controller),
    schemaName,
    // The catalog label often carries the language signal the id lacks
    // (e.g. an id like "custom_ime" with the name "日本語ローマ字").
    script: guessScriptForSchema(base.schemaId, schemaName, base.layout),
  };
}

// On connect: post the fast snapshot immediately so the keyboard paints, then
// the refined one if it differs.
export async function postInputViewState(
  controller: InputController | undefined,
  postToPort: (msg: BackgroundToInputView) => void,
): Promise<void> {
  const fast = await buildFastInputViewState(controller);
  postToPort({ kind: "state", state: fast });
  const refined = await refineInputViewState(controller, fast);
  if (JSON.stringify(refined) !== JSON.stringify(fast)) {
    postToPort({ kind: "state", state: refined });
  }
}

// On engine events (ascii toggled, schema switched): the engine is up, so post
// a single refined snapshot — a fast-first pair would flash stale asciiMode.
export async function postRefinedInputViewState(
  controller: InputController | undefined,
  postToPort: (msg: BackgroundToInputView) => void,
): Promise<void> {
  const fast = await buildFastInputViewState(controller);
  postToPort({ kind: "state", state: await refineInputViewState(controller, fast) });
}

async function postSchemaList(
  controller: InputController | undefined,
  postToPort: (msg: BackgroundToInputView) => void,
): Promise<void> {
  const settings = await readSettings(controller);
  const active = settings?.schema ?? "";
  const schemas = await listEnabledInstalledSchemas(active, settings?.enabledSchemas);
  postToPort({ kind: "schemaList", schemas, activeSchema: active });
}

// One poster per connected InputView, so global events (settings edits in the
// options page) can push fresh state without the page asking.
const inputViewPosters = new Set<(msg: BackgroundToInputView) => void>();

// Change the active schema and reload the engine. Shared by the IME tray menu
// and the InputView's long-press schema menu.
async function activateSchema(schemaId: string): Promise<void> {
  const current = self.controller.activeSettings?.schema;
  if (current === schemaId) return;
  const obj = await chrome.storage.sync.get(["settings"]) as { settings?: ImeSettings };
  const next: ImeSettings = { ...(obj.settings ?? kDefaultSettings), schema: schemaId };
  await chrome.storage.sync.set({ settings: next });
  await self.controller.loadRime(true);
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
        await activateSchema(menuId);
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
        // Keep the schema-switch shortcut live on the hot key path without waiting
        // for a full engine reload — feedKey reads activeSettings.schemaSwitchKey,
        // which would otherwise stay stale until the next loadRime().
        self.controller?.applySchemaSwitchKey((changes.settings.newValue as ImeSettings | undefined)?.schemaSwitchKey);
        refreshImeMenuItems();
        // Layout bindings / Latin layout may have changed — push fresh state to
        // any connected InputView.
        for (const poster of inputViewPosters) {
          void postRefinedInputViewState(self.controller, poster);
        }
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

    // Port listener for the InputView (protocol types in lib/shared-types.ts)
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name == kInputViewPortName) {
        console.log("InputView Port Connecting");

        let inputViewDisconnected = false;
        const postToPort = (msg: BackgroundToInputView) => {
          if (inputViewDisconnected) return;
          try {
            port.postMessage(msg);
          } catch {
            inputViewDisconnected = true;
          }
        };
        inputViewPosters.add(postToPort);

        void postInputViewState(self.controller, postToPort);
        // Sync the candidate list too: after an MV3 worker restart the page
        // reconnects holding whatever it displayed last — usually this posts
        // an empty list and unfreezes a stale candidate bar.
        postToPort({
          kind: "candidates",
          candidates: (self.controller?.candidateCache ?? []).map(
            (c: { text: string; index: number }) => ({ text: c.text, index: c.index }),
          ),
        });

        port.onMessage.addListener((raw) => {
          console.log("Message from inputview:", raw);
          if (!raw || typeof raw !== "object" || typeof (raw as { kind?: unknown }).kind !== "string") return;
          const msg = raw as InputViewToBackground;
          switch (msg.kind) {
            case "visibility":
              self.controller.handleInputViewVisibilityChanged(msg.visible);
              break;
            case "setAsciiMode":
              self.controller.setAsciiMode(msg.asciiMode);
              break;
            case "selectCandidate":
              self.controller.selectCandidate(msg.index, false);
              break;
            case "deleteCandidate":
              self.controller.deleteCandidate(msg.index, false);
              break;
            case "loadMoreCandidates":
              self.controller.fetchMoreCandidates(msg.count);
              break;
            case "switchSchema":
              void activateSchema(msg.schemaId);
              break;
            case "getSchemaList":
              void postSchemaList(self.controller, postToPort);
              break;
          }
        });

        const onStateChanged = function () {
          void postRefinedInputViewState(self.controller, postToPort);
        }

        const onCandidatesBack = function (candidates: Array<{ candidate: string, ix: number }>) {
          postToPort({ kind: "candidates", candidates: candidates.map((c) => ({ text: c.candidate, index: c.ix })) });
        }

        self.controller.addListener("toggleLanguageState", onStateChanged);
        self.controller.addListener("candidatesBack", onCandidatesBack);
        self.controller.addListener("schemaSwitched", onStateChanged);

        port.onDisconnect.addListener(() => {
          console.log("InputView disconnected");
          inputViewDisconnected = true;
          inputViewPosters.delete(postToPort);
          self.controller.removeListener("toggleLanguageState", onStateChanged);
          self.controller.removeListener("candidatesBack", onCandidatesBack);
          self.controller.removeListener("schemaSwitched", onStateChanged);
          self.controller.handleInputViewVisibilityChanged(false);
        });
      }
    });
  }
});
