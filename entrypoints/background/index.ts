import { parse } from 'yaml';

import { onMessage } from '@/lib/messaging';
import { resolveInstalledSchemaId } from '@/lib/schema-install';
import { type BackgroundToInputView, type InputViewToBackground, kInputViewPortName, type NumericFieldKind } from '@/lib/shared-types';
import { getFs, type ImeSettings, kDefaultSettings, migrateLayoutSettings } from '@/lib/utils';

import { InputController } from './controller';
import {
  isPasswordField,
  numericFieldFor,
  postFieldState,
  postInputViewState,
  postRefinedInputViewState,
  readInputViewSettings,
  settleKeyEventResult,
  updateVisibleInputViewConnections,
} from './inputview-state';
import { serviceWorkerKeepalive } from './keepalive';
import { listEnabledInstalledSchemas } from './schemas';
async function buildSchemaMenuItems(activeSchema: string, enabledSchemas?: string[]): Promise<chrome.input.ime.MenuItem[]> {
  const list = await listEnabledInstalledSchemas(activeSchema, enabledSchemas);
  return list.map(entry => ({
    id: entry.id,
    label: entry.label,
    style: 'radio',
    visible: true,
    checked: entry.id === activeSchema,
    enabled: true,
  }));
}

// onActivate doesn't re-fire when the MV3 worker respawns, so cache engineId in
// storage.session to recover it on the next cold start (see restoreEngineId).
const kEngineIdSessionKey = 'imeEngineId';

// Never throws: it is fired unawaited from several listeners (onActivate,
// storage.onChanged, schemaSwitched), where a rejection would be uncaught.
export async function refreshImeMenuItems() {
  try {
    const engineID = self.controller?.engineId;
    if (!engineID) return;
    const obj = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    const active = (obj.settings?.schema ? obj.settings : null) ?? self.controller?.activeSettings;
    if (!active?.schema) return;
    const items = await buildSchemaMenuItems(active.schema, active.enabledSchemas);
    chrome.input.ime.setMenuItems({ engineID, items }, () => {
      const error = chrome.runtime.lastError;
      // "The engine is not active" is expected during a lock/teardown handoff.
      if (error && !/not active/i.test(error.message ?? '')) {
        console.warn('setMenuItems failed:', error.message);
      }
    });
  }
  catch (ex) {
    console.error('refreshImeMenuItems failed:', ex);
  }
}

async function persistEngineId(engineId: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [kEngineIdSessionKey]: engineId });
  }
  catch (ex) {
    console.error('persistEngineId failed:', ex);
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
  }
  catch (ex) {
    console.error('restoreEngineId failed:', ex);
    return;
  }
  // onActivate may have set a fresh engineId while we awaited.
  if (!cached || !self.controller || self.controller.engineId) return;
  self.controller.engineId = cached;
  await refreshImeMenuItems();
}

async function resolveStartupSettings(stored: ImeSettings): Promise<ImeSettings | null> {
  const settings = migrateLayoutSettings(stored);
  const migrated = settings !== stored;

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
    if (migrated) {
      await chrome.storage.sync.set({ settings });
    }
    return settings;
  }

  const next = { ...settings, schema };
  console.warn(`Configured schema "${settings.schema}" is not installed in the v3 layout; using "${schema}" instead.`);
  await chrome.storage.sync.set({ settings: next });
  return next;
}

async function postSchemaList(
  controller: InputController | undefined,
  postToPort: (msg: BackgroundToInputView) => void,
): Promise<void> {
  const settings = await readInputViewSettings(controller);
  const active = settings?.schema ?? '';
  const schemas = await listEnabledInstalledSchemas(active, settings?.enabledSchemas);
  postToPort({ kind: 'schemaList', schemas, activeSchema: active });
}

// One poster per connected InputView, so global events (settings edits in the
// options page) can push fresh state without the page asking.
const inputViewPosters = new Set<(msg: BackgroundToInputView) => void>();
const visibleInputViewConnections = new Set<symbol>();

function reportInputViewError(operation: string, error: unknown): void {
  console.error(`InputView ${operation} failed:`, error);
  self.controller?.printErr(`InputView ${operation} failed: ${String(error)}`);
}

function setInputViewConnectionVisible(connection: symbol, visible: boolean): void {
  const transition = updateVisibleInputViewConnections(visibleInputViewConnections, connection, visible);
  if (transition === null) return;
  void self.controller.handleInputViewVisibilityChanged(transition)
    .catch((error: unknown) => reportInputViewError('visibility', error));
}

// Last numberpad routing pushed to the InputView. Focus moves between ordinary
// text fields must NOT re-push state (it would flash the schema label); we only
// re-push when the numeric routing actually flips (text↔number/tel).
let lastNumericField: NumericFieldKind | null = null;
let lastPasswordField = false;

// Change the active schema and reload the engine. Shared by the IME tray menu
// and the InputView's long-press schema menu.
async function activateSchema(schemaId: string): Promise<void> {
  const current = self.controller.activeSettings?.schema;
  if (current === schemaId) return;
  const obj = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
  const next: ImeSettings = { ...(obj.settings ?? kDefaultSettings), schema: schemaId };
  await chrome.storage.sync.set({ settings: next });
  await self.controller.loadRime(true);
}

export default defineBackground({
  main() {
    async function fallbackDefaultSettings() {
      await chrome.storage.sync.set({ settings: kDefaultSettings });
      await chrome.storage.local.set({
        schemaList: parse(await (await fetch('/builtin/schema-list.yaml')).text()),
      });
      if (!self.controller.engine && !self.controller.engineLoading) {
        const schema = kDefaultSettings.schema;
        const schemaBasePath = `/root/${schema}`;
        const fileList = ['aurora_pinyin.prism.bin', 'aurora_pinyin.reverse.bin', 'aurora_pinyin.table.bin', 'aurora_pinyin.schema.yaml'];
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
      chrome.input.ime.onFocus.addListener((context) => {
        // Todo: in incognito tab, context.shouldDoLearning = false,
        // we should disable rime learning in such context
        console.log('Got focus event, context = ', context);
        self.controller.setContext(context);

        // Swap the keyboard into (or out of) the numberpad when the focused
        // field's numeric-ness changes, and withdraw the microphone when focus
        // moves into a password box. Both are derived from the same context
        // type, so one re-post covers them — but the password half must be in
        // the condition, or moving from a text field to a password field would
        // leave the voice button on screen.
        const nf = numericFieldFor(context.type);
        const password = isPasswordField(context.type);
        if (nf !== lastNumericField || password !== lastPasswordField) {
          lastNumericField = nf;
          lastPasswordField = password;
          for (const poster of inputViewPosters) {
            // The security half goes out now; the refined snapshot behind it
            // waits on reads that can take seconds, and a running dictation
            // would keep inserting into the newly focused password box.
            postFieldState(poster, { numericField: nf, passwordField: password });
            void postRefinedInputViewState(self.controller, poster)
              .catch((error: unknown) => reportInputViewError('focusStateChanged', error));
          }
        }
      });

      chrome.input.ime.onBlur.addListener((ctxId) => {
        if (self.controller.context?.contextID == ctxId) {
          void self.controller.clearContext(ctxId)
            .catch((error: unknown) => self.controller.printErr(`clearContext: ${String(error)}`));
        }
      });

      // Chrome committed the pending preedit on session end; drop RIME's stale copy.
      chrome.input.ime.onReset.addListener(() => {
        void self.controller.resetComposition()
          .catch((error: unknown) => self.controller.printErr(`resetComposition: ${String(error)}`));
      });

      chrome.input.ime.onKeyEvent.addListener((engineID: string, keyData: chrome.input.ime.KeyboardEvent, requestId: string) => {
        // console.log('Processing key: ', JSON.stringify(keyData));
        let result: boolean | Promise<boolean>;
        try {
          result = self.controller.feedKey(keyData);
        }
        catch (error) {
          self.controller.printErr(`feedKey: ${String(error)}`);
          return false;
        }
        return settleKeyEventResult(
          result,
          requestId,
          error => self.controller.printErr(`feedKey: ${String(error)}`),
        );
      });

      chrome.input.ime.onCandidateClicked.addListener((engineId, candidateId, button) => {
        console.log(candidateId, button);
        if (button == 'left') {
          void self.controller.selectCandidate(candidateId).catch((error: unknown) => {
            // A late click on a composition RIME already committed/cleared;
            // benign, so log instead of surfacing an uncaught rejection.
            console.log('Stale candidate click ignored:', error);
          });
          self.controller.lastRightClickItem = -1;
        }
        else if (button == 'right') {
          self.controller.rightClick(candidateId);
        }
      });

      chrome.input.ime.onMenuItemActivated.addListener((_engineID, menuId) => {
        void activateSchema(menuId)
          .catch((error: unknown) => self.controller.printErr(`activateSchema: ${String(error)}`));
      });
    };

    // Initialize controller
    let rimeLoaded = false;
    self.controller = new InputController();
    self.controller.addListener('schemaSwitched', () => { void refreshImeMenuItems(); });

    void restoreEngineId();

    chrome.storage.sync.get(['settings']).then(async (obj) => {
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
    chrome.input.ime.onActivate.addListener((engineId, _screen) => {
      self.controller.engineId = engineId;
      void persistEngineId(engineId);
      serviceWorkerKeepalive();
      void refreshImeMenuItems();
    });

    chrome.input.ime.onDeactivated.addListener((engineId) => {
      void self.controller.deactivate(engineId)
        .catch((error: unknown) => self.controller.printErr(`deactivate: ${String(error)}`));
    });

    // Rebuild menu when schemas are installed/removed or active setting changes elsewhere
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.schemaList || changes.selfDefinedSchema)) {
        void refreshImeMenuItems();
      }
      else if (area === 'sync' && changes.settings) {
        // Keep the schema-switch shortcut live on the hot key path without waiting
        // for a full engine reload — feedKey reads activeSettings.schemaSwitchKey,
        // which would otherwise stay stale until the next loadRime().
        const next = changes.settings.newValue as ImeSettings | undefined;
        self.controller?.applySchemaSwitchKey(next?.schemaSwitchKey);
        self.controller?.applyLayoutSettings(next && migrateLayoutSettings(next));
        void refreshImeMenuItems();
        // Layout bindings / Latin layout may have changed — push fresh state to
        // any connected InputView.
        for (const poster of inputViewPosters) {
          void postRefinedInputViewState(self.controller, poster)
            .catch((error: unknown) => reportInputViewError('settingsStateChanged', error));
        }
      }
    });

    // Message handlers using @webext-core/messaging
    onMessage('GetEngineStatus', async () => {
      const loaded = self.controller.engine != null;
      const loading = self.controller.engineLoading;
      const schemaList: never[] = [];
      let currentSchema = '';

      if (loaded && !loading) {
        currentSchema = await self.controller.getCurrentSchema();
      }

      return { loading, loaded, schemaList, currentSchema };
    });

    onMessage('GetAsciiMode', async () => {
      try {
        const asciiMode = await self.controller.getAsciiMode();
        return { asciiMode };
      }
      catch (ex) {
        console.error('Error while getting ascii mode', ex);
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

    onMessage('CompileDictPack', async ({ data }) => {
      return await self.controller.compileDictPack(data.schemaId, data.packName, data.packDictYaml);
    });

    onMessage('ClassifyDictPackEntries', async ({ data }) => {
      return await self.controller.classifyDictPackEntries(data.schemaId, data.packName, data.packDictYaml);
    });

    // Port listener for the InputView (protocol types in lib/shared-types.ts)
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name == kInputViewPortName) {
        console.log('InputView Port Connecting');

        const connection = Symbol('inputview-connection');
        let inputViewDisconnected = false;
        const postToPort = (msg: BackgroundToInputView) => {
          if (inputViewDisconnected) return;
          try {
            port.postMessage(msg);
          }
          catch {
            inputViewDisconnected = true;
          }
        };
        inputViewPosters.add(postToPort);

        void postInputViewState(self.controller, postToPort)
          .catch((error: unknown) => reportInputViewError('connectState', error));
        // Sync the candidate list too: after an MV3 worker restart the page
        // reconnects holding whatever it displayed last — usually this posts
        // an empty list and unfreezes a stale candidate bar.
        const snapshot = self.controller.getCandidateSnapshot();
        postToPort({
          kind: 'candidates',
          streamId: snapshot.streamId,
          sequence: snapshot.sequence,
          candidates: snapshot.candidates.map((candidate: { candidate: string; ix: number }) => ({
            text: candidate.candidate,
            index: candidate.ix,
          })),
          highlightedIndex: snapshot.highlightedIndex,
        });

        port.onMessage.addListener((raw) => {
          console.log('Message from inputview:', raw);
          if (!raw || typeof raw !== 'object' || typeof (raw as { kind?: unknown }).kind !== 'string') return;
          const msg = raw as InputViewToBackground;
          switch (msg.kind) {
            case 'visibility':
              if (typeof msg.visible !== 'boolean') break;
              setInputViewConnectionVisible(connection, msg.visible);
              break;
            case 'setAsciiMode':
              if (typeof msg.asciiMode !== 'boolean') break;
              void self.controller.setAsciiMode(msg.asciiMode)
                .catch((error: unknown) => reportInputViewError('setAsciiMode', error));
              break;
            case 'selectCandidate':
              if (!Number.isSafeInteger(msg.index) || msg.index < 0) break;
              void self.controller.selectCandidate(msg.index, false)
                .catch((error: unknown) => reportInputViewError('selectCandidate', error));
              break;
            case 'deleteCandidate':
              if (!Number.isSafeInteger(msg.index) || msg.index < 0) break;
              void self.controller.deleteCandidate(msg.index, false)
                .catch((error: unknown) => reportInputViewError('deleteCandidate', error));
              break;
            case 'loadMoreCandidates':
              if (!Number.isSafeInteger(msg.count) || msg.count <= 0) break;
              void self.controller.fetchMoreCandidates(msg.count)
                .catch((error: unknown) => reportInputViewError('loadMoreCandidates', error));
              break;
            case 'setCandidateWindow':
              if (!Number.isSafeInteger(msg.count) || msg.count <= 0) break;
              void self.controller.setCandidateWindow(msg.count)
                .catch((error: unknown) => reportInputViewError('setCandidateWindow', error));
              break;
            case 'switchSchema':
              if (typeof msg.schemaId !== 'string' || msg.schemaId.trim().length === 0) break;
              void activateSchema(msg.schemaId)
                .catch((error: unknown) => reportInputViewError('switchSchema', error));
              break;
            case 'getSchemaList':
              void postSchemaList(self.controller, postToPort)
                .catch((error: unknown) => reportInputViewError('getSchemaList', error));
              break;
            case 'insertLiteral':
              if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 64) break;
              void self.controller.insertLiteral(msg.text)
                .catch((error: unknown) => reportInputViewError('insertLiteral', error));
              break;
          }
        });

        const onStateChanged = function () {
          void postRefinedInputViewState(self.controller, postToPort)
            .catch((error: unknown) => reportInputViewError('inputViewStateChanged', error));
        };

        const onCandidatesBack = function (
          candidates: Array<{ candidate: string; ix: number }>,
          sequence: number,
          streamId: string,
          highlightedIndex: number,
        ) {
          postToPort({
            kind: 'candidates',
            streamId,
            sequence,
            candidates: candidates.map(c => ({ text: c.candidate, index: c.ix })),
            highlightedIndex,
          });
        };

        self.controller.addListener('toggleLanguageState', onStateChanged);
        self.controller.addListener('scriptChanged', onStateChanged);
        self.controller.addListener('candidatesBack', onCandidatesBack);
        self.controller.addListener('schemaSwitched', onStateChanged);

        port.onDisconnect.addListener(() => {
          console.log('InputView disconnected');
          inputViewDisconnected = true;
          inputViewPosters.delete(postToPort);
          self.controller.removeListener('toggleLanguageState', onStateChanged);
          self.controller.removeListener('scriptChanged', onStateChanged);
          self.controller.removeListener('candidatesBack', onCandidatesBack);
          self.controller.removeListener('schemaSwitched', onStateChanged);
          setInputViewConnectionVisible(connection, false);
        });
      }
    });
  },
});
