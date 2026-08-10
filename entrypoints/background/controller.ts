import { Mutex } from 'async-mutex';
import EventEmitter from 'events';
import { parse, stringify } from 'yaml';

import {
  decodeDictPackManifest,
  dictPacksManifestPath,
  injectDictPacksIntoSchema,
} from '@/lib/dict-packs';
import { remapPhysicalKey } from '@/lib/latin-remap';
import { clampCandidateWindow, kDefaultCandidateWindow, type LatinLayoutId, type RimeCandidate } from '@/lib/shared-types';
import { getFs, type ImeSettings, kDefaultSettings, matchesSchemaSwitchKey, migrateLayoutSettings, resolveKeyboardLayout, resolveSchemaKeys, type SchemaSwitchKey } from '@/lib/utils';

import { type RimeCandidateIterator, RimeEngine, type RimeSession } from './engine';
import { listEnabledInstalledSchemas } from './schemas';

const kShiftMask = 1 << 0;
const kControlMask = 1 << 2;
const kMod1Mask = 1 << 3;
const kAltMask = kMod1Mask;
const kReleaseMask = 1 << 30;

// Definitions from librime/include/X11/keysymdef.h
const kSpecialKeys: Record<string, number> = {
  ArrowUp: 0xff52,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  Enter: 0xff0d, // Return
  Backspace: 0xff08,
  ArrowRight: 0xff53,
  ArrowLeft: 0xff51,
  Escape: 0xff1b,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  CapsLock: 0xffe5,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
};

const kConventionalKeys: Record<string, number> = {};
for (let i = 0; i <= 9; i++) {
  kConventionalKeys[`Digit${i}`] = i.toString().charCodeAt(0);
}

for (let i = 'A'.charCodeAt(0); i <= 'Z'.charCodeAt(0); i++) {
  kConventionalKeys[`Key${String.fromCharCode(i)}`] = i;
}

// The Unicode fullwidth mapping librime's own shaper applies: U+0021–U+007E
// shift into the fullwidth block, space becomes ideographic space. A fixed
// character-set table, not schema behavior — so it cannot drift per schema.
function toFullShape(text: string): string {
  return [...text].map((c) => {
    const cp = c.codePointAt(0)!;
    if (cp === 0x20) return '　';
    return cp >= 0x21 && cp <= 0x7E ? String.fromCodePoint(cp + 0xFEE0) : c;
  }).join('');
}

export class InputController extends EventEmitter {
  context: chrome.input.ime.InputContext | null;
  session: RimeSession | null;
  engineId: string | null;
  engine: RimeEngine | null;
  loadMutex: Mutex;
  // One owner for every operation that reads/mutates/replaces a RIME session.
  sessionMutex: Mutex;
  refreshMutex: Mutex;
  candidateFetchMutex: Mutex;
  inputCache: Array<string | null>;
  sessionEpoch = 0;
  contextEpoch = 0;
  visibilityEpoch = 0;

  rimeLogBuffer: string[];
  rimeLogBufferPos: number;
  // Copy, not alias: applySchemaSwitchKey patches this object in place, which
  // must never write through to the shared kDefaultSettings constant.
  activeSettings: ImeSettings = { ...kDefaultSettings };
  lastSuccessfulSchema: string | null = null;
  // Code of a swallowed schema-switch keydown whose keyup we still owe a swallow.
  pendingSwitchKeyUp: string | null = null;

  constructor() {
    super();
    this.rimeLogBuffer = new Array<string>(400);
    this.rimeLogBufferPos = 0;
    this.engineId = null;
    this.engine = null;
    this.context = null;
    this.session = null;
    this.inputCache = [];
    this.loadMutex = new Mutex();
    this.sessionMutex = new Mutex();
    this.refreshMutex = new Mutex();
    this.candidateFetchMutex = new Mutex();
    this.candidateCache = [];
    this.candidateIterator = null;
  }

  get engineLoading(): boolean {
    return this.loadMutex.isLocked();
  }

  notifyRimeStatusChanged() {
    chrome.runtime.sendMessage({ rimeStatusChanged: true }, {}, () => {
      // Prevent printing "Could not establish connection. Receiving end does not exist."
      // error message when options page is not open
      chrome.runtime.lastError;
    });
  }

  async unloadRime() {
    if (this.engineId) {
      this.resetUI();
    }
    await this.loadMutex.runExclusive(async () => {
      await this.sessionMutex.runExclusive(async () => {
        await this.invalidateCandidateCache();
        if (this.engine) {
          if (this.session) {
            this.session.destroy();
            this.session = null;
          }
          await this.engine.destroy();
          this.engine = null;
          this.sessionEpoch++;
          this.notifyRimeStatusChanged();
        }
      });
    });
  }

  printErr(err: string) {
    this.rimeLogBuffer[this.rimeLogBufferPos] = err;
    this.rimeLogBufferPos++;
    this.rimeLogBufferPos %= this.rimeLogBuffer.length;
    chrome.runtime.sendMessage({ rimeLog: err }, {}, () => {
      // Prevent printing "Could not establish connection. Receiving end does not exist."
      // error message when options page is not open
      chrome.runtime.lastError;
    });
  }

  getLogs(): string[] {
    const result = [];
    let i = this.rimeLogBufferPos;
    do {
      if (this.rimeLogBuffer[i] != undefined) {
        result.push(this.rimeLogBuffer[i]);
      }
      i = (i + 1) % this.rimeLogBuffer.length;
    } while (i != this.rimeLogBufferPos);
    return result;
  }

  inputCacheToString() {
    const list: string[] = [];
    for (const s of this.inputCache) {
      if (s == null) {
        list.pop();
      }
      else {
        list.push(s);
      }
    }
    return list.join('');
  }

  async flushInputCacheToSession(session: RimeSession) {
    // Drain until stable. New keys can be buffered at any await while the
    // engine is loading; a single snapshot can strand late keys forever.
    while (this.inputCache.length > 0) {
      await this.invalidateCandidateCache();
      const list = this.inputCache;
      this.inputCache = [];
      for (const c of list) {
        if (c == null) // Backspace
          await session.processKey(kSpecialKeys['Backspace'], 0);
        else
          await session.processKey(c.charCodeAt(0), 0);
      }
    }
  }

  async listEnabledDictPacks(
    fs: Awaited<ReturnType<typeof getFs>>,
    schemaId: string,
  ): Promise<ReturnType<typeof decodeDictPackManifest>['packs']> {
    const manifestPath = dictPacksManifestPath(schemaId);
    if (!await fs.readEntryRaw(manifestPath)) return [];
    try {
      const manifest = decodeDictPackManifest(await fs.readWholeFile(manifestPath));
      return manifest.packs
        .filter(pack => pack.enabled);
    }
    catch (ex) {
      console.warn(`Could not read dict pack manifest for schema ${schemaId}:`, ex);
      return [];
    }
  }

  async compileDictPack(
    schemaId: string,
    packName: string,
    packDictYaml: string,
  ): Promise<{ ok: boolean; warnings: string[] }> {
    return await this.sessionMutex.runExclusive(async () => {
      const engine = this.engine;
      if (!engine) throw new Error('Engine not loaded');
      const fs = await getFs();
      const schemaYamlBuffer = await fs.readWholeFile(
        `/root/${schemaId}/build/${schemaId}.schema.yaml`,
      );
      const schemaYaml = new TextDecoder().decode(schemaYamlBuffer);
      const schemaConfig = parse(schemaYaml);
      const baseDictionary: string
        = (schemaConfig?.translator?.dictionary as string | undefined) ?? schemaId;
      return await engine.compileDictionaryPack({
        schemaId,
        schemaConfigYaml: schemaYaml,
        baseDictionary,
        packName,
        packDictYaml,
      });
    });
  }

  async classifyDictPackEntries(
    schemaId: string,
    packName: string,
    packDictYaml: string,
  ): Promise<{ ok: boolean; warnings: string[]; entries: Array<{ text: string; code: string; weight: number }> }> {
    return await this.sessionMutex.runExclusive(async () => {
      const engine = this.engine;
      if (!engine) throw new Error('Engine not loaded');
      const fs = await getFs();
      const schemaYamlBuffer = await fs.readWholeFile(
        `/root/${schemaId}/build/${schemaId}.schema.yaml`,
      );
      const schemaYaml = new TextDecoder().decode(schemaYamlBuffer);
      const schemaConfig = parse(schemaYaml);
      const baseDictionary: string
        = (schemaConfig?.translator?.dictionary as string | undefined) ?? schemaId;
      return await engine.collectValidDictionaryEntries({
        baseDictionary,
        packName,
        packDictYaml,
      });
    });
  }

  // speller/alphabet of the loaded schema, sent to the InputView so char keys
  // can tell composition chars from literal ones. '' until a schema loads.
  schemaAlphabet = '';

  // Live full_shape state of the session (librime's standard full-width
  // switch, toggled by schema hotkeys). Literal inserts must convert the
  // same way the engine's own output does.
  fullShape = false;

  async loadRimeConfig(settings: ImeSettings): Promise<string> {
    const fs = await getFs();
    const schemaBasePath = `/root/${settings.schema}`;
    const schemaConfigBuffer = await fs.readWholeFile(`${schemaBasePath}/build/${settings.schema}.schema.yaml`);
    const schemaConfigString = new TextDecoder().decode(schemaConfigBuffer);
    const schemaConfig = parse(schemaConfigString);
    this.schemaAlphabet = typeof schemaConfig?.speller?.alphabet === 'string'
      ? schemaConfig.speller.alphabet
      : '';
    if (!schemaConfig.menu) {
      schemaConfig.menu = {};
    }
    schemaConfig.menu.page_size = settings.pageSize;
    if (settings.algebraList.length > 0) {
      if (!schemaConfig.speller) {
        schemaConfig.speller = {};
      }
      if (!Array.isArray(schemaConfig.speller.algebra)) {
        schemaConfig.speller.algebra = [];
      }
      for (const a of settings.algebraList) {
        schemaConfig.speller.algebra.push(a);
      }
    }
    const enabledDictPacks = await this.listEnabledDictPacks(fs, settings.schema);
    injectDictPacksIntoSchema(schemaConfig, enabledDictPacks);
    return stringify(schemaConfig);
  }

  onToggleLanguageState(asciiMode: boolean) {
    this.emit('toggleLanguageState', asciiMode);
  }

  async loadRime(maintenance: boolean): Promise<boolean> {
    const showFydeLanguageState = (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || !this.engineId) return;
      const fn: ((message: string) => void) | undefined = (chrome.input.ime as any).showFydeLanguageState;
      if (typeof fn === 'function') {
        try {
          fn(trimmed);
        }
        catch (ex) {
          console.error('showFydeLanguageState failed', ex);
        }
      }
    };

    if (this.engineId) {
      this.resetUI();
    }
    if (this.loadMutex.isLocked()) {
      console.log('RIME loading mutex is locked, wait for unlock');
      // If RIME is already loading, just wait for it to complete
      await this.loadMutex.waitForUnlock();
      // Engine is loaded. If we want to run maintenance, we should reload the engine; or else just exit because engine is loaded.
      if (!maintenance) {
        // Unlock means the other attempt finished, not that it
        // succeeded. Never report a phantom ready engine after the
        // attempt we were waiting on failed.
        return this.engine !== null && this.session !== null;
      }
    }
    try {
      console.log('>>>Loading RIME engine...');
      const configObj = await chrome.storage.sync.get(['settings']);
      if (!configObj.settings) {
        throw Error('Could not find RIME settings, refusing to launch.');
      }
      this.activeSettings = migrateLayoutSettings(configObj.settings as ImeSettings);
      console.log('>>>Settings: ', JSON.stringify(this.activeSettings));
      await this.loadMutex.runExclusive(async () => {
        console.log('this.loadMutex.runExclusive');
        // Publish the loading transition only after the mutex is held,
        // so GetEngineStatus observes loading=true.
        this.notifyRimeStatusChanged();
        await this.sessionMutex.runExclusive(async () => {
          await this.invalidateCandidateCache();
          let asciiMode = false;
          if (this.engine) {
            if (this.session) {
              asciiMode = await this.session.getOption('ascii_mode');
              this.session.destroy();
              this.session = null;
              // Both are per-schema: carrying the old schema's values into
              // the load window would pair them with the NEW schema id in
              // the state snapshot. Empty degrades to librime defaults.
              this.fullShape = false;
              this.schemaAlphabet = '';
            }
            await this.engine.destroy();
            this.engine = null;
            this.sessionEpoch++;
          }

          await new Promise(r => setTimeout(r, 10));
          console.log('loadRimeConfig');
          const config = await this.loadRimeConfig(this.activeSettings);
          const fs = await getFs();
          const schemaBasePath = `/root/${this.activeSettings.schema}`;
          const dirs = [`${schemaBasePath}/build`, `${schemaBasePath}/shared`, `${schemaBasePath}/user`, `${schemaBasePath}/shared/opencc`];
          for (const d of dirs) {
            if (!await fs.readEntryRaw(d)) {
              await fs.createDirectory(d);
            }
          }
          if (maintenance && config.includes('lua_')) {
            const luaContent = await fs.readWholeFile(`${schemaBasePath}/shared/${this.activeSettings.schema}.rime.lua`);
            await fs.writeWholeFile(`${schemaBasePath}/user/rime.lua`, luaContent);
          }
          // TODO: add GUI for switch key config
          await fs.writeWholeFile(`${schemaBasePath}/build/default.yaml`, new TextEncoder().encode(stringify(
            { ascii_composer: { good_old_caps_lock: true, switch_key: { Caps_Lock: 'clear', Shift_L: 'commit_code', Shift_R: 'commit_code' } } },
          )));

          console.log('new RimeEngine()');
          const engine = new RimeEngine();
          let session: RimeSession | null = null;
          try {
            await engine.initialize(this.printErr.bind(this), fs, schemaBasePath);
            if (maintenance) {
              await engine.rebuildPrism(this.activeSettings.schema, config);
            }
            console.log('engine.createSession');
            session = await engine.createSession(this.activeSettings.schema, config);
            await session.setOption('ascii_mode', asciiMode);
            // Schemas may declare full_shape with reset: 1 (on by default),
            // so the live value must be read, not assumed off.
            this.fullShape = await session.getOption('full_shape');
            const installedSession = session;
            session.addListener('optionChanged', (name: string, val: boolean) => {
              if (this.session !== installedSession) return;
              if (name == 'ascii_mode') {
                this.onToggleLanguageState(val);
              }
              if (name == 'full_shape') {
                this.fullShape = val;
              }
              void installedSession.getOptionLabel(name, val).then((v) => {
                const empty = v == null || v.trim() == '';
                if (!empty) {
                  showFydeLanguageState(v);
                }
                else if (name == 'ascii_mode') {
                  showFydeLanguageState(val ? 'EN' : '中');
                }
                else {
                  showFydeLanguageState(`${name}: ${val}`);
                }
              }).catch((ex) => {
                console.error('Error while showing option language state', ex);
              });
            });

            // Publish only a fully initialized session. New key
            // events now queue behind sessionMutex while the cached
            // loading-time input is replayed in order.
            this.engine = engine;
            this.session = session;
            this.sessionEpoch++;
            await this.flushInputCacheToSession(session);
          }
          catch (error) {
            if (this.session === session) this.session = null;
            if (this.engine === engine) this.engine = null;
            this.fullShape = false;
            session?.destroy();
            await engine.destroy();
            this.sessionEpoch++;
            throw error;
          }
        });
      });
      // runExclusive releases the mutex before resolving.  This terminal
      // notification must live outside it: when it was sent from inside
      // the critical section, GetEngineStatus still returned
      // loading=true and the options page stayed on "Starting" forever.
      this.notifyRimeStatusChanged();
      await this.refreshContext();
      try {
        const status = await this.getRimeStatus();
        showFydeLanguageState(status?.schemaName || status?.schemaId || this.activeSettings.schema);
      }
      catch (ex) {
        console.error('Error while showing schema language state', ex);
      }
      this.emit('schemaSwitched', this.activeSettings.schema);
      this.lastSuccessfulSchema = this.activeSettings.schema;
      return true;
    }
    catch (ex) {
      console.error('Error while loading RIME engine: ', ex);
      this.printErr(`Error while loading RIME engine: ${String(ex)}`);
      const failedSchema = this.activeSettings?.schema;
      const fallback = this.lastSuccessfulSchema;
      if (fallback && fallback !== failedSchema) {
        this.printErr(`Schema "${failedSchema}" failed to load, falling back to "${fallback}"`);
        try {
          const configObj = await chrome.storage.sync.get(['settings']);
          const settings = (configObj.settings ?? kDefaultSettings) as ImeSettings;
          await chrome.storage.sync.set({ settings: { ...settings, schema: fallback } });
          return await this.loadRime(maintenance);
        }
        catch (fallbackEx) {
          this.printErr(`Fallback to "${fallback}" also failed: ${String(fallbackEx)}`);
        }
      }
      // Loading text is presentation state, not engine state.  Every
      // terminal failure must remove it from both candidate surfaces and
      // discard the preedit buffer that produced it.
      this.inputCache = [];
      this.resetUI();
      this.notifyRimeStatusChanged();
      return false;
    }
  }

  resetUI() {
    if (this.context != null) {
      void this.setComposition({
        contextID: this.context.contextID,
        cursor: 0,
        selectionEnd: 0,
        selectionStart: 0,
        text: '',
      }).catch((error) => {
        if (!this.isInactiveImeError(error)) this.printErr(`resetUI composition: ${String(error)}`);
      });
    }
    if (this.engineId != null) {
      void this.setCandidateWindowProperties(this.engineId, { visible: false })
        .catch(err => console.warn('resetUI: hiding candidate window failed:', err));
    }
    void this.invalidateCandidateCache();
  }

  async deactivate(engineId?: string): Promise<void> {
    if (engineId && this.engineId !== engineId) return;
    const session = this.session;
    const sessionEpoch = this.sessionEpoch;
    this.engineId = null;
    this.context = null;
    const contextEpoch = ++this.contextEpoch;
    this.inputCache = [];
    this.preeditEmpty = true;
    void this.invalidateCandidateCache();
    await this.sessionMutex.runExclusive(async () => {
      if (this.session === session && this.sessionEpoch === sessionEpoch
        && this.contextEpoch === contextEpoch && this.engineId === null) {
        try {
          await session?.clearComposition();
        }
        catch (error) {
          if (!this.isInactiveImeError(error)) {
            this.printErr(`deactivate composition: ${String(error)}`);
          }
        }
      }
    });
  }

  setContext(context: chrome.input.ime.InputContext): void {
    this.context = context;
    this.contextEpoch++;
    void this.invalidateCandidateCache();
  }

  async clearContext(contextId?: number) {
    if (contextId !== undefined && this.context?.contextID !== contextId) return;
    const session = this.session;
    const sessionEpoch = this.sessionEpoch;
    this.context = null;
    const contextEpoch = ++this.contextEpoch;
    this.resetUI();
    await this.sessionMutex.runExclusive(async () => {
      // A newer focus owns the shared RIME composition; an old blur must
      // never clear it after waiting for the operation queue.
      if (this.session === session && this.sessionEpoch === sessionEpoch
        && this.contextEpoch === contextEpoch && this.context === null) {
        try {
          await session?.clearComposition();
        }
        catch (error) {
          if (!this.isInactiveImeError(error)) {
            this.printErr(`clearContext composition: ${String(error)}`);
          }
        }
      }
    });
  }

  // onReset means Chrome ended the input session (e.g. suspend) and committed the
  // pending preedit itself; clear RIME's surviving copy or it repaints on wake.
  async resetComposition(): Promise<void> {
    const session = this.session;
    const sessionEpoch = this.sessionEpoch;
    const context = this.context;
    const contextEpoch = this.contextEpoch;
    this.inputCache = [];
    this.resetUI();
    await this.sessionMutex.runExclusive(async () => {
      if (this.session === session && this.sessionEpoch === sessionEpoch
        && this.context === context && this.contextEpoch === contextEpoch) {
        try {
          await session?.clearComposition();
        }
        catch (error) {
          if (!this.isInactiveImeError(error)) {
            this.printErr(`resetComposition: ${String(error)}`);
          }
        }
      }
    });
  }

  preeditEmpty = false;
  setComposition(param: chrome.input.ime.CompositionParameters): Promise<void> {
    return new Promise((res, rej) => {
      // Check if param and param.text are valid
      if (!param || (typeof param.text !== 'string')) {
        rej(new Error('Invalid param or param.text is not a string'));
        return;
      }
      // Replace all spaces in param.text with underscore
      // Using spaces may cause problems with Chinese character input within some Linux applications (such as QQ).
      param.text = param.text.replace(/\s+/g, '_');
      if (param.text.length == 0 && this.preeditEmpty) {
        //  If preedit is already empty, and new preedit is also empty, then do not call
        // setComposition. This will mostly happen in ASCII mode (e.g. input method is
        // switched off by pressing Shift). If we still call setComposition in this case,
        // Chrome omnibar autofill text will disappear, resulting in bad user experience
        res();
      }
      else {
        this.preeditEmpty = param.text.length == 0;
        try {
          chrome.input.ime.setComposition(param, (ok) => {
            if (chrome.runtime.lastError) {
              rej(new Error(chrome.runtime.lastError.message));
            }
            else {
              ok ? res() : rej(new Error('setComposition failed'));
            }
          });
        }
        catch (err) {
          rej(err instanceof Error ? err : new Error('setComposition failed'));
        }
      }
    });
  }

  // Completion callback for callback-style chrome.input.ime calls: reads
  // runtime.lastError (Chrome logs an unread value as "Unchecked
  // runtime.lastError") and rejects with a real Error instead of undefined.
  private imeCallDone(what: string, res: () => void, rej: (e: Error) => void): (ok: boolean) => void {
    return (ok) => {
      const error = chrome.runtime.lastError;
      if (error) {
        rej(new Error(`${what}: ${error.message}`));
      }
      else if (ok) {
        res();
      }
      else {
        rej(new Error(`${what} failed`));
      }
    };
  }

  isInactiveImeError(error: unknown): boolean {
    const message = typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
    return message.includes('IME is not active');
  }

  setCandidateWindowProperties(
    engineId: string,
    properties: chrome.input.ime.CandidateWindowParameterProperties,
  ): Promise<void> {
    if (this.engineId !== engineId) return Promise.resolve();
    return new Promise((res, rej) => {
      try {
        chrome.input.ime.setCandidateWindowProperties({
          engineID: engineId,
          properties,
        }, (ok) => {
          const error = chrome.runtime.lastError;
          if (ok) {
            res();
          }
          else if (error && this.isInactiveImeError(error.message)) {
            res();
          }
          else {
            rej(error ? new Error(error.message) : new Error('setCandidateWindowProperties failed'));
          }
        });
      }
      catch (error) {
        if (this.isInactiveImeError(error)) {
          res();
        }
        else {
          rej(error instanceof Error ? error : new Error('setCandidateWindowProperties failed'));
        }
      }
    });
  }

  sendCandidatesToInputView(candidates: Array<{ candidate: string; ix: number }>, highlightedIndex = -1) {
    this.lastPublishedCandidates = candidates.map(candidate => ({ ...candidate }));
    this.lastPublishedHighlight = highlightedIndex;
    const sequence = ++this.candidateSequence;
    this.emit('candidatesBack', candidates, sequence, this.candidateStreamId, highlightedIndex);
  }

  getCandidateSnapshot() {
    return {
      streamId: this.candidateStreamId,
      sequence: this.candidateSequence,
      candidates: this.lastPublishedCandidates.map(candidate => ({ ...candidate })),
      highlightedIndex: this.lastPublishedHighlight,
    };
  }

  // Default keeps the current highlight across a load-more.
  sendCandidateCacheToInputView(highlightedIndex = this.lastPublishedHighlight) {
    this.sendCandidatesToInputView(this.candidateCache.map(v => ({
      candidate: v.text,
      ix: v.index,
    })), highlightedIndex);
  }

  async refreshContext(): Promise<void> {
    await this.sessionMutex.runExclusive(() => this.refreshContextInSessionOperation());
  }

  private async refreshContextInSessionOperation(): Promise<void> {
    await this.refreshMutex.runExclusive(() => this.refreshContextExclusive());
  }

  private async refreshLoadingContext(): Promise<void> {
    await this.refreshMutex.runExclusive(() => this.refreshContextExclusive());
  }

  private async refreshContextExclusive(): Promise<void> {
    const engineId = this.engineId;
    if (!engineId) return;
    const session = this.session;
    const sessionEpoch = this.sessionEpoch;
    const contextEpoch = this.contextEpoch;
    const visibilityEpoch = this.visibilityEpoch;
    let generation = this.candidateGeneration;
    const promises: Array<Promise<void>> = [];
    if (session != null && !this.loadMutex.isLocked()) {
      const rimeContext = await session.getContext();
      // A newer keystroke invalidates candidates before processing it.
      // If that happened while getContext was pending, this snapshot is
      // older than the UI state already being built and must be dropped.
      if (this.engineId !== engineId || this.session !== session
        || this.sessionEpoch !== sessionEpoch || this.contextEpoch !== contextEpoch
        || this.visibilityEpoch !== visibilityEpoch
        || generation !== this.candidateGeneration) return;
      if (rimeContext) {
        if (this.context != null) {
          const c = {
            contextID: this.context.contextID,
            cursor: rimeContext.composition.cursorPosition,
            /* Showing selection will result in incorrect cursor display under Linux apps
                         * As showing selection doesn't provide much value, do not show selection for now */
            // selectionEnd: rimeContext.composition.selectionEnd,
            // selectionStart: rimeContext.composition.selectionStart,
            text: rimeContext.composition.preedit,
          };
          promises.push(this.setComposition(c));
        }
        if (!this.inputViewVisible) {
          // Virtual keyboard is not visible, candidiates are displayed in system candidate window
          if (rimeContext.menu.candidates.length > 0) {
            promises.push(this.setCandidateWindowProperties(engineId, {
              visible: true,
              cursorVisible: true,
              auxiliaryTextVisible: true,
              pageSize: rimeContext.menu.pageSize,
              auxiliaryText: chrome.i18n.getMessage('candidate_page', (rimeContext.menu.pageNumber + 1).toString())
                + (rimeContext.menu.isLastPage ? chrome.i18n.getMessage('candidate_page_last') : ''),
              windowPosition: 'composition',
              // 7a03c1a made this configurable and hid the control in the same
              // commit ("chromium bug"), so horizontal was never reachable and
              // is untested. Don't re-expose it without a real device.
              vertical: true,
            }));
            if (this.context != null) {
              const contextId = this.context.contextID;
              promises.push(new Promise<void>((res, rej) => {
                chrome.input.ime.setCandidates({
                  contextID: contextId,
                  candidates: rimeContext.menu.candidates.map((v, idx) => ({
                    candidate: v.text,
                    id: idx,
                    label: rimeContext.selectLabels[idx] || (idx + 1).toString(),
                  })),
                }, this.imeCallDone('setCandidates', res, rej));
              }));
              promises.push(new Promise<void>((res, rej) => {
                chrome.input.ime.setCursorPosition({
                  contextID: contextId,
                  candidateID: rimeContext.menu.highlightedCandidateIndex,
                }, this.imeCallDone('setCursorPosition', res, rej));
              }));
            }
          }
          else {
            promises.push(this.setCandidateWindowProperties(engineId, { visible: false }));
          }
        }
        else {
          // Virtual keyboard is visible, send candidates to display them in virtual keyboard
          const preedit = rimeContext.composition.preedit;
          if (this.candidateIterator && this.candidateIteratorPreedit !== preedit) {
            // A stale iterator keeps serving — and fetchMoreCandidates keeps
            // appending — the previous composition's candidates. Rebuild it
            // whenever the preedit changes, and send an empty list when the
            // composition ended so the keyboard returns to its idle toolbar.
            await this.invalidateCandidateCache();
            generation = this.candidateGeneration;
          }
          // Rime's highlight is page-relative; fold to the flat list's global
          // index before the fetch, so its publish uses it.
          const menu = rimeContext.menu;
          const highlighted = menu.candidates.length > 0
            ? menu.pageNumber * menu.pageSize + menu.highlightedCandidateIndex
            : -1;
          if (!this.candidateIterator && preedit.length > 0) {
            const iterator = await session.iterateCandidates(0);
            // Do not install an iterator obtained for a composition
            // superseded while iterateCandidates was pending. This
            // was the remaining gap in the generation protection.
            if (this.engineId !== engineId || this.session !== session
              || this.sessionEpoch !== sessionEpoch || this.contextEpoch !== contextEpoch
              || this.visibilityEpoch !== visibilityEpoch
              || generation !== this.candidateGeneration) {
              await iterator.destroy();
              return;
            }
            this.candidateIteratorPreedit = preedit;
            this.candidateIterator = iterator;
            await this.fetchMoreCandidates(this.candidateWindow, highlighted);
          }
          if (generation !== this.candidateGeneration) return;
          this.sendCandidateCacheToInputView(highlighted);
        }
      }
      else {
        this.resetUI();
      }
    }
    else {
      // inputCache is an event log, so it can be non-empty while its
      // effective preedit is empty (for example ['a', null] after the
      // user types a and then Backspace).  Presentation must follow the
      // effective text, not the number of historical events, otherwise
      // the loading candidate remains above an empty keyboard.
      const bufferedPreedit = this.inputCacheToString();
      if (bufferedPreedit.length > 0) {
        if (this.context != null) {
          const c = {
            contextID: this.context.contextID,
            cursor: bufferedPreedit.length,
            text: bufferedPreedit,
          };
          promises.push(this.setComposition(c));
        }
        if (!this.inputViewVisible) {
          // Virtual keyboard is not visible, candidiates are displayed in system candidate window
          promises.push(this.setCandidateWindowProperties(engineId, {
            visible: true,
            cursorVisible: false,
            auxiliaryTextVisible: true,
            pageSize: 1,
            auxiliaryText: chrome.i18n.getMessage('loading_engine'),
            windowPosition: 'composition',
            vertical: true,
          }));
          if (this.context != null) {
            const contextId = this.context.contextID;
            promises.push(new Promise<void>((res, rej) => {
              chrome.input.ime.setCandidates({
                contextID: contextId,
                candidates: [],
              }, this.imeCallDone('setCandidates', res, rej));
            }));
          }
        }
        else {
          // Virtual keyboard is visible, send candidates to display them in virtual keyboard
          this.sendCandidatesToInputView([{
            candidate: chrome.i18n.getMessage('loading_engine'),
            ix: 1,
          }], 1);
        }
      }
      else {
        this.resetUI();
      }
    }
    if (this.inputViewVisible) {
      promises.push(this.setCandidateWindowProperties(engineId, { visible: false }));
    }
    await Promise.all(promises);
  }

  async commitIfAvailable(
    session = this.session,
    context = this.context,
    sessionEpoch = this.sessionEpoch,
    contextEpoch = this.contextEpoch,
  ): Promise<boolean> {
    if (!session || !context) return false;
    const commit = await session.getCommit();
    if (this.session !== session || this.sessionEpoch !== sessionEpoch
      || this.context !== context || this.contextEpoch !== contextEpoch) return false;
    if (commit) {
      const contextId = context.contextID;
      await new Promise<void>((res, rej) => {
        chrome.input.ime.commitText({
          contextID: contextId,
          text: commit.text,
        }, this.imeCallDone('commitText', res, rej));
      });
      await this.invalidateCandidateCache();
      return true;
    }
    return false;
  }

  // feedKey reads activeSettings.schemaSwitchKey on the hot path, so the
  // storage.onChanged listener pushes shortcut changes here the moment they
  // are saved (otherwise the shortcut would stay stale until the next
  // loadRime()). Deliberately single-purpose: every other setting takes
  // effect through a full loadRime().
  applySchemaSwitchKey(key: SchemaSwitchKey | null | undefined): void {
    this.activeSettings.schemaSwitchKey = key;
  }

  // Same hot-path treatment for the layout settings: feedKey remaps physical
  // keys through these, and they must not stay stale until the next loadRime().
  applyLayoutSettings(settings?: Pick<ImeSettings, 'keyboardLayout' | 'schemaKeys'>): void {
    this.activeSettings.keyboardLayout = settings?.keyboardLayout;
    this.activeSettings.schemaKeys = settings?.schemaKeys;
  }

  // A schema that paints its own script (注音, かな) expects the raw QWERTY
  // strokes its Rime mapping is written against, so composing is never remapped.
  remapLayouts(): { composing: LatinLayoutId; ascii: LatinLayoutId } {
    const arrangement = resolveKeyboardLayout(this.activeSettings);
    const script = resolveSchemaKeys(this.activeSettings, this.activeSettings.schema);
    return { composing: script ? 'qwerty' : arrangement, ascii: arrangement };
  }

  // Whether a key event is a plain printable keystroke eligible for layout
  // remapping (modifier combos are shortcuts and must keep US positions).
  private isPlainPrintable(keyData: chrome.input.ime.KeyboardEvent): boolean {
    return keyData.key.length === 1 && !keyData.altKey && !keyData.ctrlKey;
  }

  async cycleToNextSchema(): Promise<void> {
    const obj = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    const settings = obj.settings ?? kDefaultSettings;
    const list = await listEnabledInstalledSchemas(settings.schema, settings.enabledSchemas);
    if (list.length < 2) return;
    let idx = list.findIndex(e => e.id === settings.schema);
    if (idx < 0) idx = 0;
    const next = list[(idx + 1) % list.length].id;
    if (next === settings.schema) return;
    const updated: ImeSettings = { ...settings, schema: next };
    await chrome.storage.sync.set({ settings: updated });
    await this.loadRime(true);
  }

  feedKey(keyData: chrome.input.ime.KeyboardEvent): Promise<boolean> | boolean {
    const release = keyData.type == 'keyup';
    // The schema-switch shortcut (default Ctrl+`, user-configurable, possibly
    // disabled) cycles to the next enabled schema. A keyup is swallowed iff its
    // keydown was swallowed — tracked by key code rather than by re-matching
    // modifiers, so the keystroke is never partially leaked even when the user
    // releases the modifiers before the main key (and a keyup whose keydown
    // went to the page is never eaten).
    if (release) {
      if (this.pendingSwitchKeyUp === keyData.code) {
        this.pendingSwitchKeyUp = null;
        return true;
      }
    }
    else if (matchesSchemaSwitchKey(keyData, this.activeSettings.schemaSwitchKey)) {
      this.pendingSwitchKeyUp = keyData.code;
      return (async () => {
        try {
          await this.cycleToNextSchema();
        }
        catch (ex) {
          this.printErr('cycleToNextSchema: ' + String(ex));
        }
        return true;
      })();
    }
    if (this.session) {
      const session = this.session;
      let mask = 0;
      if (keyData.altKey)
        mask ^= kAltMask;
      if (keyData.shiftKey)
        mask ^= kShiftMask;
      if (keyData.ctrlKey)
        mask ^= kControlMask;
      if (release)
        mask ^= kReleaseMask;
      let code: number;
      if (keyData.key.length > 1) {
        if (keyData.code in kSpecialKeys) {
          code = kSpecialKeys[keyData.code];
        }
        else {
          this.printErr('Unhandled key ' + keyData.key);
          return false;
        }
      }
      else {
        // If Alt key or Ctrl key is pressed, then it should be a shortcut key,
        // and we should pass the original key to RIME, instead of modified key.
        // For example, if user pressed Ctrl+Shift+3, key is '#' (because shift is
        // pressed) and code is 'Digit3'. In order for RIME to recognize this shortcut,
        // the value sent to RIME should be 51 ('3') instead of 35 ('#'). So we get code
        // from the 'code' field instead of 'key' field.
        if ((keyData.altKey || keyData.ctrlKey) && keyData.code in kConventionalKeys) {
          code = kConventionalKeys[keyData.code];
        }
        else {
          // Physical keyboards always report US chars (the manifest
          // pins the system layout); remap by key POSITION so the
          // chosen Latin layout applies to external keyboards too.
          const composed = this.isPlainPrintable(keyData)
            ? remapPhysicalKey(
                this.remapLayouts().composing,
                keyData.code,
                !!keyData.shiftKey,
                !!keyData.capsLock,
              )
            : null;
          code = (composed ?? keyData.key).charCodeAt(0);
        }
      }
      void this.invalidateCandidateCache();
      const keyGeneration = this.candidateGeneration;
      const sessionEpoch = this.sessionEpoch;
      const context = this.context;
      const contextEpoch = this.contextEpoch;
      return this.sessionMutex.runExclusive(async () => {
        // A reload may replace the session while this key is queued.
        if (this.session !== session || this.sessionEpoch !== sessionEpoch) return false;
        let handled = false;
        try {
          handled = await session.processKey(code, mask);
        }
        catch (ex) {
          this.printErr('Error while processing key ' + String(ex));
          console.error(ex);
          handled = false;
        }
        // The engine passed the key through (ASCII mode / plain text):
        // the system would insert the ORIGINAL US char, so under a
        // non-QWERTY Latin layout we must insert the remapped char
        // ourselves and swallow the event. keydown only — the system
        // inserts nothing on keyup.
        if (!handled && !release && this.isPlainPrintable(keyData) && this.context) {
          const asciiChar = remapPhysicalKey(
            this.remapLayouts().ascii,
            keyData.code,
            !!keyData.shiftKey,
            !!keyData.capsLock,
          );
          if (asciiChar !== null && asciiChar !== keyData.key) {
            const contextId = this.context.contextID;
            await new Promise<void>((res) => {
              chrome.input.ime.commitText({ contextID: contextId, text: asciiChar }, () => {
                const error = chrome.runtime.lastError;
                if (error) console.warn('commitText (ascii remap) failed:', error.message);
                res();
              });
            });
            handled = true;
          }
        }
        const committed = await this.commitIfAvailable(session, context, sessionEpoch, contextEpoch);
        // Newer queued input owns presentation. Processing still runs
        // in order, but an intermediate key must not repaint over the
        // candidate state requested by a later key.
        if (!committed && keyGeneration === this.candidateGeneration) {
          await this.refreshContextInSessionOperation();
        }
        if (!this.preeditEmpty && (keyData.code == 'PageUp' || keyData.code == 'PageDown')) {
          // Chrome will crash if PageUp or PageDown is sent while user is typing in OmniBar and candidate box is shown
          // So we always return handled = true in this case, to prevent key event being sent to Chrome
          return true;
        }
        return handled;
      });
    }
    else {
      if (!release && this.loadMutex.isLocked()) {
        // RIME is loading
        // inputCache is a replay log; bufferedInput is its visible
        // value. All editing decisions must use the latter. Using the
        // log length here makes ['a', null] behave like non-empty text.
        const bufferedInput = this.inputCacheToString();
        if (keyData.key.length > 1 && bufferedInput.length > 0) {
          if (keyData.code == 'Backspace') {
            this.inputCache.push(null);
            // A fully cancelled preedit has nothing useful to
            // replay into the new session. Compact it so the core
            // invariant holds: empty visible input => empty log.
            if (this.inputCacheToString().length === 0) {
              this.inputCache = [];
            }
          }
          else if (keyData.code == 'Enter') {
            if (this.context) {
              chrome.input.ime.commitText({
                contextID: this.context.contextID,
                text: bufferedInput,
              }, () => {
                const error = chrome.runtime.lastError;
                if (error) console.warn('commitText (input cache) failed:', error.message);
              });
              this.inputCache = [];
            }
          }
          else if (keyData.code == 'Escape') {
            this.inputCache = [];
          }
          else {
            return false;
          }
        }
        else {
          const char = (this.isPlainPrintable(keyData)
            ? remapPhysicalKey(
                this.remapLayouts().composing,
                keyData.code,
                !!keyData.shiftKey,
                !!keyData.capsLock,
              )
            : null) ?? keyData.key;
          if (bufferedInput.length == 0 && !(/^[a-z]$/.test(char))) {
            // If buffer is empty and input is not letter, just put it to screen directly
            return false;
          }
          this.inputCache.push(char);
        }
        return this.refreshLoadingContext().then(() => true);
      }
      else {
        return false;
      }
    }
  }

  // A literal glyph from the InputView (symbol layers, ，。 under 大千,
  // emoji). Serialized with key processing. An open composition is flushed
  // first — committing what RIME itself would commit (commitTextPreview) —
  // so the glyph lands after the text, never inside the preedit. While
  // full_shape is on, ASCII glyphs convert to their full-width forms —
  // except into numeric fields, which reject full-width characters. The
  // flushed text is never re-shaped: the engine already shaped its own.
  async insertLiteral(text: string) {
    await this.invalidateCandidateCache();
    await this.sessionMutex.runExclusive(async () => {
      const session = this.session;
      const context = this.context;
      const sessionEpoch = this.sessionEpoch;
      const contextEpoch = this.contextEpoch;
      if (!context) return;
      const stale = () => this.session !== session || this.sessionEpoch !== sessionEpoch
        || this.context !== context || this.contextEpoch !== contextEpoch;
      let flushed = '';
      if (session) {
        const rimeContext = await session.getContext();
        if (stale()) return;
        const preedit = rimeContext?.composition?.preedit ?? '';
        if (preedit.length > 0) {
          flushed = rimeContext.commitTextPreview || preedit;
          await session.clearComposition();
          if (stale()) return;
        }
      }
      const numeric = context.type === 'number' || context.type === 'tel';
      const literal = this.fullShape && !numeric ? toFullShape(text) : text;
      await new Promise<void>((res, rej) => {
        chrome.input.ime.commitText({
          contextID: context.contextID,
          text: flushed + literal,
        }, this.imeCallDone('commitText', res, rej));
      });
      if (flushed) await this.refreshContextInSessionOperation();
    });
  }

  async selectCandidate(index: number, currentPage: boolean = true) {
    await this.invalidateCandidateCache();
    await this.sessionMutex.runExclusive(async () => {
      const session = this.session;
      const context = this.context;
      const sessionEpoch = this.sessionEpoch;
      const contextEpoch = this.contextEpoch;
      if (!session) return;
      await session.actionCandidate(index, 'select', currentPage);
      const committed = await this.commitIfAvailable(session, context, sessionEpoch, contextEpoch);
      if (!committed && this.session === session && this.sessionEpoch === sessionEpoch) {
        await this.refreshContextInSessionOperation();
      }
    });
  }

  async deleteCandidate(index: number, currentPage: boolean = true) {
    // Invalidate before the action so an active pagination loop cannot
    // publish the candidate being deleted while the action is pending.
    await this.invalidateCandidateCache();
    await this.sessionMutex.runExclusive(async () => {
      const session = this.session;
      const sessionEpoch = this.sessionEpoch;
      if (!session) return;
      await session.actionCandidate(index, 'delete', currentPage);
      if (this.session !== session || this.sessionEpoch !== sessionEpoch) return;
      await this.refreshContextInSessionOperation();
    });
    // Deleting rewrites the menu WITHOUT changing the preedit, so the
    // preedit-based staleness check in refreshContext won't fire — without
    // an explicit invalidation the deleted word is re-sent from the old
    // cache and appears to survive deletion.
  }

  lastRightClickItem = -1;
  lastRightClickTime = 0;

  rightClick(index: number) {
    // A late click can reference a composition that RIME already committed
    // or cleared; the engine rejects it, which is benign here.
    const deleteQuietly = (ix: number) => this.deleteCandidate(ix).catch((err) => {
      console.log('Candidate delete ignored (composition already gone):', err);
    });
    const curTime = (new Date()).getTime();
    if (this.lastRightClickItem == index && curTime - this.lastRightClickTime < 3000) {
      console.log('Del candidate');
      void deleteQuietly(index);
      this.lastRightClickItem = -1;
    }
    else {
      console.log('Ready Del candidate');
      void deleteQuietly(index);
      this.lastRightClickItem = index;
      this.lastRightClickTime = curTime;
    }
  }

  inputViewVisible = false;

  async setAsciiMode(isAscii: boolean) {
    await this.sessionMutex.runExclusive(async () => {
      await this.session?.setOption('ascii_mode', isAscii);
    });
  }

  async getAsciiMode(): Promise<boolean> {
    return await this.sessionMutex.runExclusive(async () =>
      await this.session?.getOption('ascii_mode') ?? false);
  }

  async getCurrentSchema(): Promise<string> {
    return await this.sessionMutex.runExclusive(async () =>
      await this.session?.getCurrentSchema() ?? '');
  }

  async getRimeStatus() {
    return await this.sessionMutex.runExclusive(async () =>
      await this.session?.getStatus());
  }

  async handleInputViewVisibilityChanged(visible: boolean) {
    const visibilityEpoch = ++this.visibilityEpoch;
    this.inputViewVisible = visible;
    await this.invalidateCandidateCache();
    // Await both: fire-and-forget here let refreshContext read the engine
    // context before the composition was actually cleared, resurrecting
    // stale candidates when the keyboard was re-shown.
    await this.sessionMutex.runExclusive(async () => {
      if (visibilityEpoch !== this.visibilityEpoch || this.inputViewVisible !== visible) return;
      if (!visible) {
        try {
          await this.session?.clearComposition();
        }
        catch (error) {
          if (!this.isInactiveImeError(error)) {
            this.printErr(`visibility composition: ${String(error)}`);
          }
        }
      }
      if (visibilityEpoch !== this.visibilityEpoch || this.inputViewVisible !== visible) return;
      await this.refreshContextInSessionOperation();
    });
  }

  // Only used in input view
  candidateCache: RimeCandidate[];
  candidateIterator: RimeCandidateIterator | null;
  candidateStreamId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  candidateSequence = 0;
  lastPublishedCandidates: Array<{ candidate: string; ix: number }> = [];
  lastPublishedHighlight = -1;
  // Preedit the iterator was created for; a mismatch means the iterator is stale.
  candidateIteratorPreedit: string | null = null;
  // Bumped on every invalidation. fetchMoreCandidates is a slow async loop;
  // when a new keystroke/selection supersedes it mid-flight, the stale loop
  // must drop its results instead of pushing old-composition candidates into
  // the fresh cache and re-sending them AFTER the list was cleared.
  candidateGeneration = 0;
  candidateDisposal: Promise<void> = Promise.resolve();
  // Per-composition seed size, reported by the keyboard's width measurement.
  // Default covers the first composition before that report arrives; erring
  // high only over-fetches once and never under-fills (which would flicker).
  candidateWindow = kDefaultCandidateWindow;

  async setCandidateWindow(count: number) {
    this.candidateWindow = clampCandidateWindow(count);
    // Fill a widened viewport now, not on the next keystroke.
    const deficit = this.candidateWindow - this.candidateCache.length;
    if (deficit > 0 && this.candidateIterator) {
      await this.fetchMoreCandidates(deficit);
    }
  }

  async fetchMoreCandidates(count: number, highlightedIndex = this.lastPublishedHighlight) {
    await this.candidateFetchMutex.runExclusive(async () => {
      const generation = this.candidateGeneration;
      const iterator = this.candidateIterator;
      if (!iterator) return;
      for (let i = 0; i < count; i++) {
        await iterator.advance();
        if (generation !== this.candidateGeneration || iterator !== this.candidateIterator) return;
        const c = await iterator.current();
        if (generation !== this.candidateGeneration || iterator !== this.candidateIterator) return;
        if (c == null)
          break;
        this.candidateCache.push(c);
      }
      if (generation !== this.candidateGeneration || iterator !== this.candidateIterator) return;
      this.sendCandidateCacheToInputView(highlightedIndex);
    });
  }

  async invalidateCandidateCache() {
    this.candidateGeneration++;
    this.candidateCache = [];
    const iterator = this.candidateIterator;
    this.candidateIterator = null;
    this.candidateIteratorPreedit = null;
    // Clear the actual UI at the same moment as internal invalidation. If
    // any later RIME/Chrome call fails, stale words still cannot remain.
    this.sendCandidatesToInputView([]);
    if (iterator) {
      this.candidateDisposal = this.candidateDisposal
        .then(() => iterator.destroy())
        .catch(error => this.printErr(`candidate iterator disposal: ${String(error)}`));
    }
    await this.candidateDisposal;
  }
}
