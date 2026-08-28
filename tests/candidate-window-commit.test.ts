import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RimeContext } from '../lib/shared-types';

vi.mock('../entrypoints/background/engine', () => ({
  RimeEngine: vi.fn(),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../lib/utils')>();
  return {
    ...actual,
    getFs: vi.fn(),
    kDefaultSettings: {
      schema: 'aurora',
      pageSize: 5,
      algebraList: [],
    },
  };
});

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(async () => []),
}));

const { InputController } = await import('../entrypoints/background/controller');

function rimeContext(preedit: string, candidateCount: number, label = '词'): RimeContext {
  return {
    composition: {
      length: preedit.length,
      cursorPosition: preedit.length,
      selectionStart: 0,
      selectionEnd: 0,
      preedit,
    },
    menu: {
      pageSize: 5,
      pageNumber: 0,
      isLastPage: true,
      highlightedCandidateIndex: 0,
      candidates: Array.from({ length: candidateCount }, (_, i) => ({
        text: `${label}${i}`,
        comment: '',
      })),
    },
    selectKeys: '12345',
    commitTextPreview: preedit,
    selectLabels: ['1', '2', '3', '4', '5'],
  };
}

const composing = rimeContext('nihao', 5);
const idle = rimeContext('', 0);

// Every chrome.input.ime surface the system-candidate-window path writes to,
// recorded in call order so a test can assert what the LAST paint said.
function stubIme() {
  const windows: chrome.input.ime.CandidateWindowParameterProperties[] = [];
  const commits: string[] = [];
  const commitTargets: number[] = [];
  const compositions: string[] = [];
  const candidateLists: string[][] = [];
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => key },
    runtime: { lastError: null, sendMessage: vi.fn() },
    input: {
      ime: {
        setCandidateWindowProperties: vi.fn((
          opts: { properties: chrome.input.ime.CandidateWindowParameterProperties },
          cb: (ok: boolean) => void,
        ) => {
          windows.push(opts.properties);
          cb(true);
        }),
        setCandidates: vi.fn((
          opts: { candidates: Array<{ candidate: string }> },
          cb: (ok: boolean) => void,
        ) => {
          candidateLists.push(opts.candidates.map(c => c.candidate));
          cb(true);
        }),
        setCursorPosition: vi.fn((_opts: unknown, cb: (ok: boolean) => void) => cb(true)),
        setComposition: vi.fn((opts: { text: string }, cb: (ok: boolean) => void) => {
          compositions.push(opts.text);
          cb(true);
        }),
        commitText: vi.fn((
          opts: { contextID: number; text: string },
          cb: (ok: boolean) => void,
        ) => {
          commits.push(opts.text);
          commitTargets.push(opts.contextID);
          cb(true);
        }),
      },
    },
  });
  return {
    windows,
    commits,
    commitTargets,
    compositions,
    candidateLists,
    lastWindow: () => windows[windows.length - 1],
    lastCandidates: () => candidateLists[candidateLists.length - 1],
  };
}

// Physical-keyboard shape: an engine and a focused field, virtual keyboard
// hidden, so candidates go to the system candidate window.
function makeController() {
  const session = {
    processKey: vi.fn(async () => false),
    getCommit: vi.fn(async () => null as { text: string } | null),
    getContext: vi.fn(async () => composing),
    actionCandidate: vi.fn(async () => { }),
    // Faithful: clearing the composition empties what the engine reports next.
    clearComposition: vi.fn(async () => { session.getContext.mockResolvedValue(idle); }),
    iterateCandidates: vi.fn(async () => ({
      destroy: vi.fn(async () => { }),
      advance: vi.fn(async () => { }),
      current: vi.fn(async () => null),
    })),
  };
  const controller = new InputController();
  controller.engineId = 'engine';
  controller.inputViewVisible = false;
  controller.session = session as never;
  controller.setContext({ contextID: 1 } as chrome.input.ime.InputContext);
  return { controller, session };
}

function key(overrides: Partial<chrome.input.ime.KeyboardEvent>): chrome.input.ime.KeyboardEvent {
  return {
    type: 'keydown',
    key: 'a',
    code: 'KeyA',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    capsLock: false,
    ...overrides,
  } as chrome.input.ime.KeyboardEvent;
}

describe('committing clears the system candidate window', () => {
  let ime: ReturnType<typeof stubIme>;

  beforeEach(() => {
    ime = stubIme();
  });

  it('hides the window when Shift commits the code on key RELEASE', async () => {
    // The reported bug. default.yaml pins ascii_composer switch_key to
    // commit_code and librime runs a switch key on RELEASE, so the commit
    // lands on the last event of the sequence — nothing follows to repaint.
    const { controller, session } = makeController();
    await controller.refreshContext();
    expect(ime.lastWindow()).toMatchObject({ visible: true });

    session.getCommit.mockResolvedValueOnce({ text: 'nihao' });
    session.getContext.mockResolvedValue(idle);
    await controller.feedKey(key({ type: 'keyup', key: 'Shift', code: 'ShiftLeft' }));

    expect(ime.commits).toEqual(['nihao']);
    expect(ime.lastWindow()).toMatchObject({ visible: false });
    expect(controller.candidateWindowShown).toBe(false);
  });

  it('hides the window on the Enter that commits, not on the release after it', async () => {
    // Same defect, faster exposure: Enter commits on keydown and the keyup
    // ~100ms later did the repaint, so the committed word flashed.
    const { controller, session } = makeController();
    await controller.refreshContext();

    session.getCommit.mockResolvedValueOnce({ text: '你好' });
    session.getContext.mockResolvedValue(idle);
    const compositionsBefore = ime.compositions.length;
    await controller.feedKey(key({ key: 'Enter', code: 'Enter' }));

    expect(ime.commits).toEqual(['你好']);
    expect(ime.lastWindow()).toMatchObject({ visible: false });
    // …and only the window. commitText already dropped Chrome's composition,
    // so the empty setComposition behind it is the call that kills omnibox
    // autofill — the one preeditEmpty exists to dedup away.
    expect(ime.compositions).toHaveLength(compositionsBefore);
  });

  it('hides the window when a candidate is committed by click', async () => {
    // Third entrance, no key events involved at all: onCandidateClicked.
    const { controller, session } = makeController();
    await controller.refreshContext();

    session.getCommit.mockResolvedValueOnce({ text: '词0' });
    session.getContext.mockResolvedValue(idle);
    await controller.selectCandidate(0);

    expect(session.actionCandidate).toHaveBeenCalledWith(0, 'select', true);
    expect(ime.commits).toEqual(['词0']);
    expect(controller.candidateWindowShown).toBe(false);
  });

  it('leaves the window up for a key that edits without committing', async () => {
    const { controller, session } = makeController();

    await controller.feedKey(key({ key: 'o', code: 'KeyO' }));

    expect(ime.commits).toEqual([]);
    expect(ime.lastWindow()).toMatchObject({ visible: true });
    // One repaint per key, not two: the commit path must not double up.
    expect(session.getContext).toHaveBeenCalledTimes(1);
  });

  it('repaints once per committing key', async () => {
    const { controller, session } = makeController();
    session.getCommit.mockResolvedValueOnce({ text: 'nihao' });
    session.getContext.mockResolvedValue(idle);

    await controller.feedKey(key({ key: 'Enter', code: 'Enter' }));

    expect(session.getContext).toHaveBeenCalledTimes(1);
  });

  it('goes hide-then-show across a commit, never the reverse', async () => {
    // A commit invalidates the candidate cache on its way out; that must not
    // read as "a newer key owns the screen" and cost the commit its repaint.
    const { controller, session } = makeController();
    session.getCommit.mockImplementationOnce(async () => {
      await controller.invalidateCandidateCache();
      return { text: 'nihao' };
    });
    session.getContext.mockResolvedValue(idle);

    await controller.feedKey(key({ key: 'Enter', code: 'Enter' }));
    expect(ime.lastWindow()).toMatchObject({ visible: false });

    session.getContext.mockResolvedValue(composing);
    await controller.feedKey(key({ key: 'w', code: 'KeyW' }));
    expect(ime.lastWindow()).toMatchObject({ visible: true });
  });

  it('keeps a committed key handled when the repaint fails', async () => {
    // A rejection out of feedKey makes settleKeyEventResult answer Chrome with
    // handled=false, which delivers the key to the page — on top of text this
    // commit already put there.
    const { controller, session } = makeController();
    session.processKey.mockResolvedValueOnce(true);
    session.getCommit.mockResolvedValueOnce({ text: 'nihao' });
    session.getContext.mockRejectedValueOnce(new Error('engine gone'));

    await expect(controller.feedKey(key({ key: 'Enter', code: 'Enter' }))).resolves.toBe(true);
    expect(ime.commits).toEqual(['nihao']);
  });

  it('neither commits nor repaints when a reload replaces the session mid-read', async () => {
    // The repaint now lives behind commitIfAvailable's epoch checks; a session
    // swapped under a tap must still abort before either side effect.
    const { controller, session } = makeController();
    session.getCommit.mockImplementationOnce(async () => {
      controller.sessionEpoch++;
      return { text: 'nihao' };
    });

    await controller.selectCandidate(0);

    expect(ime.commits).toEqual([]);
    expect(session.getContext).not.toHaveBeenCalled();
  });

  it('keeps the system window hidden when the virtual keyboard is the visible one', async () => {
    // Why this was never seen in-house: with the InputView up, the commit path
    // already cleared its candidates through invalidateCandidateCache.
    const { controller, session } = makeController();
    controller.inputViewVisible = true;
    session.getCommit.mockResolvedValueOnce({ text: '你好' });
    session.getContext.mockResolvedValue(idle);

    await controller.feedKey(key({ key: 'Enter', code: 'Enter' }));

    expect(controller.candidateWindowShown).toBe(false);
  });
  it('an older key does not repaint over the key queued behind it', async () => {
    // The ownership guard: keySequence, not candidateGeneration — the latter is
    // bumped by commits too, which is what made every commit skip its repaint.
    const { controller, session } = makeController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    session.processKey.mockImplementationOnce(async () => { await gate; return true; });

    const first = controller.feedKey(key({ key: 'n', code: 'KeyN' })) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    const second = controller.feedKey(key({ key: 'i', code: 'KeyI' })) as Promise<boolean>;
    release();
    await Promise.all([first, second]);

    expect(session.getContext).toHaveBeenCalledTimes(1);
  });

  it('sends the first hide with nothing known on screen, then dedups', async () => {
    // A restarted worker inherits whatever Chrome is still showing, so the
    // window starts unknown and the first hide has to go out.
    const { controller } = makeController();
    expect(controller.candidateWindowShown).toBe(true);

    await controller.setCandidateWindowProperties('engine', { visible: false });
    await controller.setCandidateWindowProperties('engine', { visible: false });

    expect(ime.windows).toHaveLength(1);
    expect(controller.candidateWindowShown).toBe(false);
  });

  it('does not dedup after a hide Chrome refused', async () => {
    const { controller } = makeController();
    chrome.input.ime.setCandidateWindowProperties = vi.fn((
      _opts: unknown,
      cb: (ok: boolean) => void,
    ) => cb(false)) as never;

    await expect(controller.setCandidateWindowProperties('engine', { visible: false }))
      .rejects.toThrow('setCandidateWindowProperties failed');

    expect(controller.candidateWindowShown).toBe(true);
  });

  it('repaints the composition a partial commit left behind', async () => {
    // RIME can commit one word and keep composing the rest. The repaint has to
    // follow the new menu, or the on-screen list belongs to the consumed word
    // and the next selection picks something the user never saw.
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    session.getCommit.mockResolvedValueOnce({ text: '你好' });
    session.getContext.mockResolvedValue(rimeContext('shijie', 5, '残'));

    await controller.feedKey(key({ key: 'Enter', code: 'Enter' }));

    expect(ime.commits).toEqual(['你好']);
    // A second paint, carrying the residual word's own menu — not the seed one
    // still on screen from before the commit.
    expect(ime.windows).toHaveLength(seedWindows + 1);
    expect(ime.lastWindow()).toMatchObject({ visible: true });
    expect(ime.lastCandidates()).toEqual(['残0', '残1', '残2', '残3', '残4']);
    expect(ime.compositions[ime.compositions.length - 1]).toBe('shijie');
  });

  it('does not paint into a context the key no longer belongs to', async () => {
    // Focus moves while the key waits on the session mutex. Its repaint would
    // otherwise put the old field's preedit and candidates into the new one.
    const { controller, session } = makeController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    session.processKey.mockImplementationOnce(async () => { await gate; return true; });

    const pending = controller.feedKey(key({ key: 'n', code: 'KeyN' })) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    release();
    await pending;

    expect(session.getContext).not.toHaveBeenCalled();
    expect(ime.windows).toEqual([]);
  });

  it('never shows the window without a context to compose into', async () => {
    // A blur hides the window and never repaints; a show issued behind it by an
    // in-flight key would stick there with nothing to select into.
    const { controller } = makeController();
    controller.context = null;

    await controller.refreshContext();

    expect(ime.windows.filter(w => w.visible)).toEqual([]);
  });

  it('swallows PageDown while a candidate window is still on screen', async () => {
    // Chrome crashes on PageUp/PageDown with the box up, and a commit now
    // empties preeditEmpty — so the window, not the preedit, has to gate it.
    const { controller, session } = makeController();
    await controller.refreshContext();
    controller.preeditEmpty = true;
    // A newer key takes the repaint, so nothing hides the window on this one.
    session.processKey.mockImplementationOnce(async () => {
      controller.keySequence++;
      return false;
    });

    const handled = await controller.feedKey(key({ key: 'PageDown', code: 'PageDown' }));

    expect(handled).toBe(true);
    expect(controller.candidateWindowShown).toBe(true);
  });

  it('does not publish the loading candidate to a keyboard that is not up', async () => {
    // The loading branch's else means "the virtual keyboard is visible"; a
    // hidden keyboard with no context must fall through it, not into it.
    const { controller } = makeController();
    controller.session = null;
    controller.context = null;
    controller.inputCache = ['n', 'i'];
    const candidatesBack = vi.fn();
    controller.addListener('candidatesBack', candidatesBack);

    await controller.refreshContext();

    expect(candidatesBack).not.toHaveBeenCalled();
    expect(ime.windows.filter(w => w.visible)).toEqual([]);
  });

  it('a hide that lands after a later show does not latch hidden', async () => {
    // Chrome applies these in call order, so the flag follows the last one
    // ISSUED. Recording completion instead would latch "hidden" here — and then
    // dedup away every hide that could have fixed it.
    const { controller } = makeController();
    const pending: Array<(ok: boolean) => void> = [];
    chrome.input.ime.setCandidateWindowProperties = vi.fn((
      _opts: unknown,
      cb: (ok: boolean) => void,
    ) => { pending.push(cb); }) as never;

    const hide = controller.setCandidateWindowProperties('engine', { visible: false });
    const show = controller.setCandidateWindowProperties('engine', { visible: true });
    pending[1](true);
    pending[0](true);
    await Promise.all([hide, show]);

    expect(controller.candidateWindowShown).toBe(true);
  });

  it('does not repaint a clicked candidate into a field that took focus mid-commit', async () => {
    // commitIfAvailable checks the context before commitText, so a focus move
    // inside that round trip gets past it. What follows must not paint.
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    session.getCommit.mockResolvedValueOnce({ text: '你好' });
    session.getContext.mockResolvedValue(rimeContext('shijie', 5, '残'));
    chrome.input.ime.commitText = vi.fn((
      opts: { text: string },
      cb: (ok: boolean) => void,
    ) => {
      ime.commits.push(opts.text);
      controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
      cb(true);
    }) as never;

    await controller.selectCandidate(0);

    expect(ime.commits).toEqual(['你好']);
    expect(ime.windows).toHaveLength(seedWindows);
    expect(ime.compositions).not.toContain('shijie');
  });

  it('does not repaint over a teardown that landed while the key was queued', async () => {
    // onReset means Chrome ended the input session and committed the preedit
    // itself; resetUI blanks both surfaces from outside the session mutex. The
    // key still holding that mutex must not put them back.
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    session.processKey.mockImplementationOnce(async () => { await gate; return true; });

    const pending = controller.feedKey(key({ key: 'o', code: 'KeyO' })) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    const reset = controller.resetComposition();
    release();
    await Promise.all([pending, reset]);

    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
    expect(ime.compositions.slice(-1)).toEqual(['']);
  });

  it('does not repaint a click over a teardown that landed mid-flight', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    session.actionCandidate.mockImplementationOnce(async () => { controller.resetUI(); });

    await controller.selectCandidate(0);

    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
  });

  it('does not repaint a delete over a teardown that landed mid-flight', async () => {
    // Right-click delete on the system candidate window. Deleting keeps the
    // preedit, so this repaint always has a full composition to put back.
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    session.actionCandidate.mockImplementationOnce(async () => { controller.resetUI(); });

    await controller.deleteCandidate(0);

    expect(session.actionCandidate).toHaveBeenCalledWith(0, 'delete', true);
    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
  });

  it('does not repaint a delete into a field that took focus mid-flight', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    session.actionCandidate.mockImplementationOnce(async () => {
      controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    });

    await controller.deleteCandidate(0);

    expect(ime.windows).toHaveLength(seedWindows);
  });

  // The capture point itself: presentationEpoch exists to catch teardowns that
  // run outside the session mutex, and the widest window for one is while the
  // operation is still WAITING for that mutex. Capturing after acquisition
  // snapshots the bump and reads as ownership.
  async function queuedBehindAKey(
    controller: ReturnType<typeof makeController>['controller'],
    session: ReturnType<typeof makeController>['session'],
  ) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    session.processKey.mockImplementationOnce(async () => { await gate; return true; });
    const pending = controller.feedKey(key({ key: 'o', code: 'KeyO' })) as Promise<boolean>;
    await vi.waitFor(() => expect(session.processKey).toHaveBeenCalledTimes(1));
    return { pending, release };
  }

  const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

  it('does not repaint a key that was already queued when a teardown landed', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    const { pending, release } = await queuedBehindAKey(controller, session);

    const second = controller.feedKey(key({ key: 'w', code: 'KeyW' })) as Promise<boolean>;
    await settle();
    const reset = controller.resetComposition();
    release();
    await Promise.all([pending, second, reset]);

    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
  });

  it('does not repaint a delete that was already queued when a teardown landed', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    const { pending, release } = await queuedBehindAKey(controller, session);

    const deleting = controller.deleteCandidate(0);
    await settle();
    const reset = controller.resetComposition();
    release();
    await Promise.all([pending, deleting, reset]);

    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
  });

  it('does not repaint a selection that was already queued when a teardown landed', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const seedWindows = ime.windows.length;
    const { pending, release } = await queuedBehindAKey(controller, session);

    const selecting = controller.selectCandidate(0);
    await settle();
    const reset = controller.resetComposition();
    release();
    await Promise.all([pending, selecting, reset]);

    expect(ime.windows.slice(seedWindows).filter(w => w.visible)).toEqual([]);
  });

  it('still clears the window for a literal that flushed behind a teardown', async () => {
    // insertLiteral awaits invalidateCandidateCache() — and with it the standing
    // iterator disposal — BEFORE queueing, while feedKey takes the mutex
    // synchronously. With an engine call already in flight off the session mutex
    // (a candidate-strip scroll's fetch loop), the tap parks across tasks and a
    // later key runs first and repaints. The tap's own repaint is then the only
    // thing that can clear that, and it can only ever blank — the flush emptied
    // the engine — so nothing may gate it.
    const { controller, session } = makeController();
    await controller.refreshContext();
    let releaseDisposal!: () => void;
    controller.candidateDisposal = new Promise<void>((resolve) => { releaseDisposal = resolve; });

    const inserting = controller.insertLiteral('。');
    await settle();
    const reset = controller.resetComposition();
    await settle();
    session.getContext.mockResolvedValue(composing);
    const down = controller.feedKey(key({ key: 'o', code: 'KeyO' }));
    await settle();
    releaseDisposal();
    await Promise.all([inserting, reset, down]);

    expect(ime.lastWindow()).toMatchObject({ visible: false });
    expect(controller.candidateWindowShown).toBe(false);
  });

  it('does not commit a clicked candidate into a field that took focus while it queued', async () => {
    // The commit path has to use the same request-time view the repaint does,
    // or the word lands in whatever field happens to be focused when the mutex
    // frees up — which can be a password box.
    const { controller, session } = makeController();
    await controller.refreshContext();
    const { pending, release } = await queuedBehindAKey(controller, session);
    session.getCommit.mockResolvedValue({ text: '你好' });

    const selecting = controller.selectCandidate(0);
    await settle();
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    release();
    await Promise.all([pending, selecting]);

    expect(ime.commitTargets).not.toContain(2);
  });

  it('does not flush a literal anywhere once the field moved', async () => {
    const { controller, session } = makeController();
    await controller.refreshContext();
    const { pending, release } = await queuedBehindAKey(controller, session);

    const inserting = controller.insertLiteral('，');
    await settle();
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    release();
    await Promise.all([pending, inserting]);

    // Not into the new field, and not into the old one either: onBlur has
    // already invalidated that contextID, so a write there is a dead handle.
    expect(ime.commits).toEqual([]);
  });

  it('does not call into a session destroyed while the literal queued', async () => {
    // Hoisting the capture to request time means holding a session reference
    // across the mutex wait. RimeSession.destroy() is a bare embind delete with
    // no guard, and calling into a deleted handle aborts the whole worker.
    const { controller, session } = makeController();
    const release = await controller.sessionMutex.acquire();

    const inserting = controller.insertLiteral('，');
    await settle();
    // The reload holding the mutex destroys the session and installs a new one.
    session.getContext = vi.fn(() => { throw new Error('destroyed session'); }) as never;
    controller.session = { ...session, getContext: vi.fn(async () => idle) } as never;
    controller.sessionEpoch++;
    release();
    await inserting;

    expect(session.getContext).not.toHaveBeenCalled();
  });

  it('still inserts the glyph when only the session moved', async () => {
    // insertLiteral commits a literal with no session at all, so a session
    // REPLACED while the tap queued cannot be the thing that cancels it — the
    // field is untouched and still the user's. Only the flush is lost, and the
    // composition it would have flushed died with the old session anyway.
    const { controller, session } = makeController();
    const release = await controller.sessionMutex.acquire();

    const inserting = controller.insertLiteral('，');
    await settle();
    controller.session = { ...session, getContext: vi.fn(async () => idle) } as never;
    controller.sessionEpoch++;
    release();
    await inserting;

    expect(ime.commits).toEqual(['，']);
    expect(ime.commitTargets).toEqual([1]);
  });

  it('does not commit a remapped ASCII char into a field that took focus while it queued', async () => {
    // The remap inserts the character itself and swallows the key. It read the
    // context live, so a focus move while it queued put the character in the
    // new field — a password box in the worst case — with handled=true hiding
    // where it went.
    const { controller, session } = makeController();
    controller.activeSettings = { ...controller.activeSettings, keyboardLayout: 'dvorak' };
    session.processKey.mockResolvedValue(false);
    const { pending, release } = await queuedBehindAKey(controller, session);

    const remapped = controller.feedKey(key({ key: 'o', code: 'KeyO' })) as Promise<boolean>;
    await settle();
    controller.setContext({ contextID: 2 } as chrome.input.ime.InputContext);
    release();
    const [, handled] = await Promise.all([pending, remapped]);

    expect(ime.commitTargets).not.toContain(2);
    // Still swallowed: letting it through would type the unremapped US char
    // into the new field instead.
    expect(handled).toBe(true);
  });

  it('keeps a key handled when the commit itself fails', async () => {
    // Same reason the repaint is caught: processKey already consumed the key,
    // so rejecting here would have Chrome type it into the page as well — and
    // would skip the repaint that hides the candidate window.
    const { controller, session } = makeController();
    await controller.refreshContext();
    session.processKey.mockResolvedValueOnce(true);
    session.getCommit.mockRejectedValueOnce(new Error('engine gone'));
    session.getContext.mockResolvedValue(idle);

    await expect(controller.feedKey(key({ key: 'Enter', code: 'Enter' }))).resolves.toBe(true);
    expect(ime.lastWindow()).toMatchObject({ visible: false });
  });
});
