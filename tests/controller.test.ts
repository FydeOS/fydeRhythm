import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImeSettings } from '../lib/utils';

const mocks = vi.hoisted(() => ({
    listEnabledInstalledSchemas: vi.fn(),
    fs: {
        readEntryRaw: vi.fn(async () => true),
        createDirectory: vi.fn(async () => { }),
        readWholeFile: vi.fn(async () => new Uint8Array()),
        writeWholeFile: vi.fn(async () => { }),
    },
    getFs: vi.fn(),
    createSession: vi.fn((schema: string) => ({
        addListener: vi.fn(),
        destroy: vi.fn(),
        getContext: vi.fn(async () => null),
        getOption: vi.fn(async () => false),
        getOptionLabel: vi.fn(async () => ''),
        getStatus: vi.fn(async () => ({ schemaId: schema })),
        processKey: vi.fn(async () => true),
        setOption: vi.fn(async () => { }),
    })),
    createEngine: vi.fn(),
    RimeEngine: vi.fn(function () {
        return mocks.createEngine();
    }),
}));

vi.mock('../entrypoints/background/engine', () => ({
    RimeEngine: mocks.RimeEngine,
}));

// Use the real helpers (matchesSchemaSwitchKey et al.) but stub getFs and pin
// kDefaultSettings so the controller has no schemaSwitchKey by default (→ Ctrl+`).
vi.mock('@/lib/utils', async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const actual = await importOriginal<typeof import('../lib/utils')>();
    return {
        ...actual,
        getFs: mocks.getFs,
        kDefaultSettings: {
            schema: 'aurora',
            pageSize: 5,
            algebraList: [],
        },
    };
});

vi.mock('../entrypoints/background/schemas', () => ({
    listEnabledInstalledSchemas: mocks.listEnabledInstalledSchemas,
}));

const { InputController } = await import('../entrypoints/background/controller');
// Resolves to the mocked module — the same kDefaultSettings object the controller sees.
const { kDefaultSettings } = await import('../lib/utils');

function stubChrome(settings?: ImeSettings) {
    let storedSettings = settings;
    const get = vi.fn(async () => ({ settings: storedSettings }));
    const set = vi.fn(async (obj: { settings?: ImeSettings }) => {
        if (obj.settings) {
            storedSettings = obj.settings;
        }
    });
    const sendMessage = vi.fn();

    vi.stubGlobal('chrome', {
        i18n: {
            getMessage: (key: string) => key,
        },
        runtime: {
            lastError: null,
            sendMessage,
        },
        storage: {
            sync: { get, set },
        },
        input: {
            ime: {},
        },
    });

    return { get, set, sendMessage };
}

function settings(overrides: Partial<ImeSettings> = {}): ImeSettings {
    return {
        schema: 'aurora',
        pageSize: 5,
        algebraList: [],
        ...overrides,
    };
}

describe('InputController schema switching', () => {
    beforeEach(() => {
        mocks.listEnabledInstalledSchemas.mockReset();
        mocks.fs.readEntryRaw.mockClear();
        mocks.fs.createDirectory.mockClear();
        mocks.fs.readWholeFile.mockClear();
        mocks.fs.writeWholeFile.mockClear();
        mocks.getFs.mockReset();
        mocks.getFs.mockResolvedValue(mocks.fs);
        mocks.createSession.mockClear();
        mocks.createEngine.mockReset();
        mocks.createEngine.mockImplementation(() => ({
            createSession: vi.fn(async (schema: string) => mocks.createSession(schema)),
            destroy: vi.fn(),
            initialize: vi.fn(async () => { }),
            rebuildPrism: vi.fn(async () => { }),
        }));
        mocks.RimeEngine.mockClear();
    });

    it('cycles to the next enabled installed schema and reloads RIME', async () => {
        const chromeMock = stubChrome(settings({
            schema: 'aurora',
            enabledSchemas: ['aurora', 'luna'],
        }));
        mocks.listEnabledInstalledSchemas.mockResolvedValue([
            { id: 'aurora', label: 'Aurora' },
            { id: 'luna', label: 'Luna' },
        ]);
        const controller = new InputController();
        const loadRime = vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

        await controller.cycleToNextSchema();

        expect(mocks.listEnabledInstalledSchemas).toHaveBeenCalledWith('aurora', ['aurora', 'luna']);
        expect(chromeMock.set).toHaveBeenCalledWith({
            settings: {
                schema: 'luna',
                pageSize: 5,
                algebraList: [],
                enabledSchemas: ['aurora', 'luna'],
            },
        });
        expect(loadRime).toHaveBeenCalledWith(true);
    });

    it('wraps from the last schema to the first schema', async () => {
        const chromeMock = stubChrome(settings({ schema: 'luna' }));
        mocks.listEnabledInstalledSchemas.mockResolvedValue([
            { id: 'aurora', label: 'Aurora' },
            { id: 'luna', label: 'Luna' },
        ]);
        const controller = new InputController();
        vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

        await controller.cycleToNextSchema();

        expect(chromeMock.set).toHaveBeenCalledWith({
            settings: {
                schema: 'aurora',
                pageSize: 5,
                algebraList: [],
            },
        });
    });

    it('does not switch when fewer than two schemas are available', async () => {
        const chromeMock = stubChrome(settings({ schema: 'aurora' }));
        mocks.listEnabledInstalledSchemas.mockResolvedValue([{ id: 'aurora', label: 'Aurora' }]);
        const controller = new InputController();
        const loadRime = vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

        await controller.cycleToNextSchema();

        expect(chromeMock.set).not.toHaveBeenCalled();
        expect(loadRime).not.toHaveBeenCalled();
    });

    it('swallows Ctrl+Backquote keydown and cycles schemas', async () => {
        stubChrome(settings());
        mocks.listEnabledInstalledSchemas.mockResolvedValue([
            { id: 'aurora', label: 'Aurora' },
            { id: 'luna', label: 'Luna' },
        ]);
        const controller = new InputController();
        const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        const handled = await controller.feedKey({
            type: 'keydown',
            code: 'Backquote',
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(true);
        expect(cycleToNextSchema).toHaveBeenCalledTimes(1);
    });

    it('cycles from index 0 when the active schema is not in the enabled list', async () => {
        // Simulates a stale setting where the saved schema no longer exists.
        // idx = -1 → clamped to 0 → next = index 1.
        const chromeMock = stubChrome(settings({ schema: 'stale' }));
        mocks.listEnabledInstalledSchemas.mockResolvedValue([
            { id: 'aurora', label: 'Aurora' },
            { id: 'luna', label: 'Luna' },
        ]);
        const controller = new InputController();
        vi.spyOn(controller, 'loadRime').mockResolvedValue(true);

        await controller.cycleToNextSchema();

        expect(chromeMock.set).toHaveBeenCalledWith({
            settings: expect.objectContaining({ schema: 'luna' }),
        });
    });

    it('swallows the keyup of a swallowed keydown without cycling twice', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        await controller.feedKey({
            type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        const handled = controller.feedKey({
            type: 'keyup', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(true);
        expect(cycleToNextSchema).toHaveBeenCalledTimes(1);
    });

    it('swallows the keyup even when modifiers were released before the main key', async () => {
        // Press Ctrl+`, cycle fires; release Ctrl first, then `. The `Backquote`
        // keyup arrives with ctrlKey=false and must still be swallowed so the
        // page never sees a stray release without its press.
        stubChrome(settings());
        const controller = new InputController();
        vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        await controller.feedKey({
            type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        const handled = controller.feedKey({
            type: 'keyup', code: 'Backquote', ctrlKey: false, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(true);
    });

    it('does not swallow a keyup whose keydown was not intercepted', () => {
        // Binding is default Ctrl+`; a bare Ctrl+` keyup with no swallowed
        // keydown (e.g. the press happened before the IME took focus) must be
        // forwarded, not eaten.
        stubChrome(settings());
        const controller = new InputController();
        const cycleToNextSchema = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        const handled = controller.feedKey({
            type: 'keyup', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(false);
        expect(cycleToNextSchema).not.toHaveBeenCalled();
    });

    it('fires a custom schema-switch shortcut from activeSettings', async () => {
        stubChrome(settings());
        const controller = new InputController();
        controller.activeSettings = settings({ schemaSwitchKey: { code: 'F2' } });
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        const handled = await controller.feedKey({
            type: 'keydown',
            code: 'F2',
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(true);
        expect(cycle).toHaveBeenCalledTimes(1);
    });

    it('stops firing the old default once a custom shortcut is set', async () => {
        stubChrome(settings());
        const controller = new InputController();
        controller.activeSettings = settings({ schemaSwitchKey: { code: 'F2' } });
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        // Ctrl+` should now be forwarded normally, not swallowed for switching.
        const handled = await controller.feedKey({
            type: 'keydown',
            code: 'Backquote',
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(false);
        expect(cycle).not.toHaveBeenCalled();
    });

    it('does not switch schemas when the shortcut is disabled (null)', async () => {
        stubChrome(settings());
        const controller = new InputController();
        controller.activeSettings = settings({ schemaSwitchKey: null });
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        const handled = await controller.feedKey({
            type: 'keydown',
            code: 'Backquote',
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(false);
        expect(cycle).not.toHaveBeenCalled();
    });

    it('does not fire the default when an extra modifier is held (Ctrl+Alt+`)', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        const handled = await controller.feedKey({
            type: 'keydown',
            code: 'Backquote',
            ctrlKey: true,
            altKey: true,
            shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(handled).toBe(false);
        expect(cycle).not.toHaveBeenCalled();
    });

    it('applySchemaSwitchKey hot-swaps the switch key without a reload', () => {
        stubChrome(settings());
        const controller = new InputController();
        // Starts on the default (undefined → Ctrl+`).
        expect(controller.activeSettings.schemaSwitchKey).toBeUndefined();

        controller.applySchemaSwitchKey({ code: 'Digit1', ctrlKey: true, shiftKey: true });
        expect(controller.activeSettings.schemaSwitchKey).toEqual({ code: 'Digit1', ctrlKey: true, shiftKey: true });

        // Disabling also propagates.
        controller.applySchemaSwitchKey(null);
        expect(controller.activeSettings.schemaSwitchKey).toBeNull();

        // Missing settings (undefined) resets to the default.
        controller.applySchemaSwitchKey(undefined);
        expect(controller.activeSettings.schemaSwitchKey).toBeUndefined();
    });

    it('never mutates the shared kDefaultSettings constant (regression: aliasing)', () => {
        // activeSettings starts as a copy of kDefaultSettings; hot-swapping the
        // shortcut before the first loadRime must not write through to the
        // module-wide default object.
        stubChrome(settings());
        const controller = new InputController();

        controller.applySchemaSwitchKey(null);

        expect(controller.activeSettings.schemaSwitchKey).toBeNull();
        expect('schemaSwitchKey' in kDefaultSettings).toBe(false);
    });

    it('a live-updated shortcut is honored by feedKey immediately (regression: stale activeSettings)', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        // Before: Ctrl+Shift+1 conflicts with a schema binding and is NOT ours yet,
        // so it must fall through to RIME.
        const before = await controller.feedKey({
            type: 'keydown', code: 'Digit1', ctrlKey: true, altKey: false, shiftKey: true,
        } as chrome.input.ime.KeyboardEvent);
        expect(before).toBe(false);
        expect(cycle).not.toHaveBeenCalled();

        // User saves Ctrl+Shift+1 as the switch key → storage.onChanged → applySchemaSwitchKey.
        controller.applySchemaSwitchKey({ code: 'Digit1', ctrlKey: true, shiftKey: true });

        // After: the same keystroke is now intercepted for switching, not forwarded.
        const after = await controller.feedKey({
            type: 'keydown', code: 'Digit1', ctrlKey: true, altKey: false, shiftKey: true,
        } as chrome.input.ime.KeyboardEvent);
        expect(after).toBe(true);
        expect(cycle).toHaveBeenCalledTimes(1);
    });

    it('reverting to default via applySchemaSwitchKey drops the old custom key and restores Ctrl+`', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        controller.applySchemaSwitchKey({ code: 'F4' });
        controller.applySchemaSwitchKey(undefined); // reset to default

        const f4 = await controller.feedKey({
            type: 'keydown', code: 'F4', ctrlKey: false, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        expect(f4).toBe(false); // old custom key no longer ours

        const backquote = await controller.feedKey({
            type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        expect(backquote).toBe(true); // default fires again
        expect(cycle).toHaveBeenCalledTimes(1);
    });

    it('disabling (null) via applySchemaSwitchKey stops both the custom key and the old default', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        controller.applySchemaSwitchKey({ code: 'F4' });
        controller.applySchemaSwitchKey(null); // disable entirely

        const f4 = await controller.feedKey({
            type: 'keydown', code: 'F4', ctrlKey: false, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        const backquote = await controller.feedKey({
            type: 'keydown', code: 'Backquote', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);

        expect(f4).toBe(false);
        expect(backquote).toBe(false);
        expect(cycle).not.toHaveBeenCalled();
    });

    it('re-enabling from disabled to a new custom key takes effect immediately', async () => {
        stubChrome(settings());
        const controller = new InputController();
        const cycle = vi.spyOn(controller, 'cycleToNextSchema').mockResolvedValue();

        controller.applySchemaSwitchKey(null);
        controller.applySchemaSwitchKey({ code: 'F4', ctrlKey: true });

        const handled = await controller.feedKey({
            type: 'keydown', code: 'F4', ctrlKey: true, altKey: false, shiftKey: false,
        } as chrome.input.ime.KeyboardEvent);
        expect(handled).toBe(true);
        expect(cycle).toHaveBeenCalledTimes(1);
    });

    it('clears active RIME composition when deactivated', () => {
        stubChrome(settings());
        const controller = new InputController();
        const clearComposition = vi.fn();
        const candidateIterator = { destroy: vi.fn() };
        const candidatesBack = vi.fn();

        controller.engineId = 'engine';
        controller.context = { contextID: 7 } as chrome.input.ime.InputContext;
        controller.session = { clearComposition } as any;
        controller.inputCache = ['n', 'i'];
        controller.preeditEmpty = false;
        controller.candidateCache = [{ text: '你', index: 0 } as any];
        controller.candidateIterator = candidateIterator as any;
        controller.addListener('candidatesBack', candidatesBack);

        controller.deactivate('engine');

        expect(clearComposition).toHaveBeenCalledTimes(1);
        expect(controller.engineId).toBeNull();
        expect(controller.context).toBeNull();
        expect(controller.inputCache).toEqual([]);
        expect(controller.preeditEmpty).toBe(true);
        expect(controller.candidateCache).toEqual([]);
        expect(candidateIterator.destroy).toHaveBeenCalledTimes(1);
        expect(controller.candidateIterator).toBeNull();
        expect(candidatesBack).toHaveBeenCalledWith([]);
    });

    it('records the last successfully loaded schema', async () => {
        stubChrome(settings({ schema: 'aurora' }));
        const controller = new InputController();
        const schemaSwitched = vi.fn();
        controller.addListener('schemaSwitched', schemaSwitched);
        vi.spyOn(controller, 'loadRimeConfig').mockResolvedValue('schema: aurora\n');

        await expect(controller.loadRime(false)).resolves.toBe(true);

        expect(controller.lastSuccessfulSchema).toBe('aurora');
        expect(schemaSwitched).toHaveBeenCalledWith('aurora');
    });

    it('falls back to the last successfully loaded schema when a later schema fails', async () => {
        const chromeMock = stubChrome(settings({ schema: 'broken' }));
        const controller = new InputController();
        controller.lastSuccessfulSchema = 'aurora';
        const loadRimeConfig = vi.spyOn(controller, 'loadRimeConfig');
        loadRimeConfig.mockImplementation(async (activeSettings) => {
            if (activeSettings.schema === 'broken') {
                throw new Error('bad schema');
            }
            return 'schema: aurora\n';
        });

        await expect(controller.loadRime(true)).resolves.toBe(true);

        expect(chromeMock.set).toHaveBeenCalledWith({
            settings: {
                schema: 'aurora',
                pageSize: 5,
                algebraList: [],
            },
        });
        expect(loadRimeConfig).toHaveBeenCalledTimes(2);
        expect(loadRimeConfig).toHaveBeenNthCalledWith(1, expect.objectContaining({ schema: 'broken' }));
        expect(loadRimeConfig).toHaveBeenNthCalledWith(2, expect.objectContaining({ schema: 'aurora' }));
        expect(controller.lastSuccessfulSchema).toBe('aurora');
    });

    it('does not retry fallback when there is no previously successful schema', async () => {
        const chromeMock = stubChrome(settings({ schema: 'broken' }));
        const controller = new InputController();
        const loadRimeConfig = vi.spyOn(controller, 'loadRimeConfig').mockRejectedValue(new Error('bad schema'));

        await expect(controller.loadRime(false)).resolves.toBe(false);

        expect(chromeMock.set).not.toHaveBeenCalled();
        expect(loadRimeConfig).toHaveBeenCalledTimes(1);
        expect(chromeMock.sendMessage).toHaveBeenCalledWith({ rimeStatusChanged: true }, {}, expect.any(Function));
    });
});

describe('InputView candidate lifecycle (regression: zombie candidates)', () => {
    function candidateHarness() {
        stubChrome();
        // refreshContext always hides the system candidate window while the VK
        // is visible; give the stub that API.
        (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties =
            (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
        const controller = new InputController();
        controller.engineId = 'engine-1';
        controller.inputViewVisible = true;
        // No IME text field context in this harness — refreshContext skips
        // setComposition and goes straight to the candidate flow.
        controller.context = null as never;

        const state = { preedit: '', words: [] as string[] };
        controller.session = {
            getContext: async () => ({
                composition: {
                    preedit: state.preedit,
                    cursorPosition: 0,
                    selectionStart: 0,
                    selectionEnd: 0,
                    length: state.preedit.length,
                },
                menu: {
                    pageSize: 5,
                    pageNumber: 0,
                    isLastPage: true,
                    highlightedCandidateIndex: 0,
                    candidates: state.words.map((text) => ({ text, comment: '' })),
                },
                selectKeys: '',
                commitTextPreview: '',
                selectLabels: [],
            }),
            iterateCandidates: async () => {
                const snapshot = [...state.words];
                let i = -1;
                return {
                    advance: async () => { i++; },
                    current: async () => (i >= 0 && i < snapshot.length
                        ? { index: i, text: snapshot[i], comment: '' }
                        : null),
                    destroy: () => { },
                };
            },
            clearComposition: () => { },
        } as never;

        const sent: string[][] = [];
        controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
            sent.push(cands.map((c) => c.candidate));
        });
        return { controller, state, sent };
    }

    it('replaces candidates when the preedit changes (never appends across compositions)', async () => {
        const { controller, state, sent } = candidateHarness();

        state.preedit = 'p';
        state.words = ['苹', '平'];
        await controller.refreshContext();
        expect(sent.at(-1)).toEqual(['苹', '平']);

        state.preedit = 'pi';
        state.words = ['品', '拼'];
        await controller.refreshContext();
        // The zombie bug appended: ['苹','平','品','拼'].
        expect(sent.at(-1)).toEqual(['品', '拼']);
    });

    it('clears the keyboard when the composition ends', async () => {
        const { controller, state, sent } = candidateHarness();

        state.preedit = 'hao';
        state.words = ['好', '号'];
        await controller.refreshContext();
        expect(sent.at(-1)).toEqual(['好', '号']);

        state.preedit = '';
        state.words = [];
        await controller.refreshContext();
        expect(sent.at(-1)).toEqual([]);
    });

    it('clears the keyboard when it is hidden and re-shown mid-composition', async () => {
        const { controller, state, sent } = candidateHarness();

        state.preedit = 'ni';
        state.words = ['你', '尼'];
        await controller.refreshContext();
        expect(sent.at(-1)).toEqual(['你', '尼']);

        // Hiding clears the engine composition; re-showing must sync the VK.
        await controller.handleInputViewVisibilityChanged(false);
        state.preedit = '';
        state.words = [];
        await controller.handleInputViewVisibilityChanged(true);
        expect(sent.at(-1)).toEqual([]);
    });
});

describe('InputView candidate lifecycle (regression: delete + stale fetch race)', () => {
    function deleteHarness() {
        stubChrome();
        (chrome.input.ime as unknown as Record<string, unknown>).setCandidateWindowProperties =
            (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
        const controller = new InputController();
        controller.engineId = 'engine-1';
        controller.inputViewVisible = true;
        controller.context = null as never;

        const state = { preedit: 'hao', words: ['好', '号', '嚎'] };
        controller.session = {
            getContext: async () => ({
                composition: {
                    preedit: state.preedit, cursorPosition: 0,
                    selectionStart: 0, selectionEnd: 0, length: state.preedit.length,
                },
                menu: {
                    pageSize: 5, pageNumber: 0, isLastPage: true,
                    highlightedCandidateIndex: 0,
                    candidates: state.words.map((text) => ({ text, comment: '' })),
                },
                selectKeys: '', commitTextPreview: '', selectLabels: [],
            }),
            iterateCandidates: async () => {
                const snapshot = [...state.words];
                let i = -1;
                return {
                    advance: async () => { i++; },
                    current: async () => (i >= 0 && i < snapshot.length
                        ? { index: i, text: snapshot[i], comment: '' }
                        : null),
                    destroy: () => { },
                };
            },
            actionCandidate: async (index: number, op: string) => {
                if (op === 'delete') state.words.splice(index, 1);
            },
            clearComposition: () => { },
        } as never;

        const sent: string[][] = [];
        controller.addListener('candidatesBack', (cands: Array<{ candidate: string }>) => {
            sent.push(cands.map((c) => c.candidate));
        });
        return { controller, state, sent };
    }

    it('deleting a candidate removes it from the keyboard (preedit unchanged)', async () => {
        const { controller, sent } = deleteHarness();
        await controller.refreshContext();
        expect(sent.at(-1)).toEqual(['好', '号', '嚎']);

        // Long-press delete on the first candidate: the menu changes while
        // the preedit stays 'hao' — the cache must still be rebuilt.
        await controller.deleteCandidate(0, false);
        expect(sent.at(-1)).toEqual(['号', '嚎']);
    });

    it('a superseded fetchMoreCandidates loop drops its results (no zombie resurrection)', async () => {
        const { controller, sent } = deleteHarness();
        await controller.refreshContext();
        sent.length = 0;

        // Make the iterator slow and controllable.
        let releaseAdvance: (() => void) | null = null;
        const gate = () => new Promise<void>((res) => { releaseAdvance = res; });
        const slowWords = ['旧', '词'];
        let i = -1;
        controller.candidateIterator = {
            advance: async () => { await gate(); i++; },
            current: async () => (i >= 0 && i < slowWords.length
                ? { index: 100 + i, text: slowWords[i], comment: '' }
                : null),
            destroy: () => { },
        } as never;

        const fetching = controller.fetchMoreCandidates(2);
        await Promise.resolve();
        // A new keystroke supersedes the fetch mid-flight.
        await controller.invalidateCandidateCache();
        releaseAdvance!();
        await fetching;

        // The stale loop must neither pollute the cache nor re-send.
        expect(controller.candidateCache).toEqual([]);
        expect(sent).toEqual([]);
    });
});

describe('physical-key Latin layout remap', () => {
    function remapHarness(layoutSettings: Partial<ImeSettings>) {
        stubChrome();
        const commits: string[] = [];
        (chrome.input.ime as unknown as Record<string, unknown>).commitText =
            (opts: { text: string }, cb: (ok: boolean) => void) => { commits.push(opts.text); cb(true); };
        for (const api of ['setCandidateWindowProperties', 'setComposition', 'setCandidates', 'setCursorPosition']) {
            (chrome.input.ime as unknown as Record<string, unknown>)[api] =
                (_opts: unknown, cb: (ok: boolean) => void) => cb(true);
        }
        const controller = new InputController();
        controller.engineId = 'engine-1';
        controller.context = { contextID: 7 } as never;
        controller.activeSettings = { ...kDefaultSettings, ...layoutSettings } as ImeSettings;

        const fed: number[] = [];
        let handled = true;
        controller.session = {
            processKey: async (code: number) => { fed.push(code); return handled; },
            getContext: async () => null,
            getCommit: async () => null,
        } as never;
        // refreshContext hits resetUI paths; context/engine mocks above keep it quiet.
        return { controller, fed, commits, setHandled: (h: boolean) => { handled = h; } };
    }

    const keyS = { type: 'keydown', key: 's', code: 'KeyS', ctrlKey: false, altKey: false, shiftKey: false } as chrome.input.ime.KeyboardEvent;

    it('feeds the engine the remapped char while composing (dvorak KeyS → o)', async () => {
        const { controller, fed } = remapHarness({ keyboardLayout: 'dvorak' });
        await controller.feedKey(keyS);
        expect(fed).toEqual(['o'.charCodeAt(0)]);
    });

    it('commits the remapped char itself when the engine passes the key through (ASCII mode)', async () => {
        const { controller, commits, setHandled } = remapHarness({ keyboardLayout: 'dvorak' });
        setHandled(false);
        const result = await controller.feedKey(keyS);
        expect(commits).toEqual(['o']);
        expect(result).toBe(true); // swallowed — the system must not also insert 's'
    });

    it('does not remap while composing a non-Latin schema even with a global Latin layout', async () => {
        const { controller, fed } = remapHarness({
            keyboardLayout: 'colemak',
            schemaKeys: { aurora: 'zhuyin' },
        });
        await controller.feedKey(keyS);
        expect(fed).toEqual(['s'.charCodeAt(0)]); // raw stroke for the engine's own mapping
    });

    it('leaves modifier shortcuts on US positions', async () => {
        const { controller, fed, commits } = remapHarness({ keyboardLayout: 'dvorak' });
        await controller.feedKey({ ...keyS, ctrlKey: true, key: 's' } as never);
        // Pre-existing shortcut convention: Ctrl combos feed the uppercase
        // keysym from the code field (83 = 'S'). The point here: NOT dvorak 'o'.
        expect(fed).toEqual(['S'.charCodeAt(0)]);
        expect(commits).toEqual([]);
    });
});
