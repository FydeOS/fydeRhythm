import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealHost } from '../entrypoints/inputview/chrome-shim';
import { allLayouts, bottomRow, getLayerLayout } from '../entrypoints/inputview/layouts';
import type { KeyDef, KeyStroke } from '../entrypoints/inputview/layouts/types';

interface SentKey { type: string; charValue: number; keyCode: number; keyName: string; modifiers: number }

function makeVk() {
  const sent: SentKey[] = [];
  return {
    sent,
    vk: {
      sendKeyEvent: vi.fn((e: SentKey, cb?: () => void) => { sent.push(e); cb?.(); }),
      insertText: vi.fn(),
      hideKeyboard: vi.fn(),
      lockKeyboard: vi.fn(),
      keyboardLoaded: vi.fn(),
      openSettings: vi.fn(),
      setContainerBehavior: vi.fn((_o: object, cb?: () => void) => cb?.()),
      setDraggableArea: vi.fn(),
      setHitTestBounds: vi.fn(),
    },
  };
}

let resizeTo: ReturnType<typeof vi.fn>;
let moveTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resizeTo = vi.fn();
  moveTo = vi.fn();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    innerWidth: 1080,
    innerHeight: 320,
    screenX: 0,
    screenY: 0,
    screen: { width: 1080, height: 800 },
    resizeTo,
    moveTo,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('chrome', { runtime: { lastError: null }, i18n: { getMessage: (k: string) => k } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A stroke whose `code` is missing from nonAlphaNumericKeycodes gets keyCode 0.
// Chrome then delivers a key the system cannot identify, so the key does
// nothing on device while every mock-based check still passes.
function strokesOf(key: KeyDef): KeyStroke[] {
  const out: KeyStroke[] = [];
  for (const action of [key.action, key.shiftAction]) {
    if (!action) continue;
    if (action.type === 'stroke') out.push(action.stroke);
    if (action.type === 'strokes') out.push(...action.strokes);
  }
  return out;
}

function everyStroke(): Array<{ layout: string; id: string; stroke: KeyStroke }> {
  const layouts = [...allLayouts(), getLayerLayout('sym'), getLayerLayout('sym2')];
  const out: Array<{ layout: string; id: string; stroke: KeyStroke }> = [];
  for (const layout of layouts) {
    for (const row of layout.rows) {
      for (const key of row) {
        for (const stroke of strokesOf(key)) out.push({ layout: layout.id, id: key.id, stroke });
      }
    }
  }
  for (const script of ['zh', 'ja', 'ko'] as const) {
    for (const asciiMode of [false, true]) {
      for (const layer of ['main', 'sym', 'sym2'] as const) {
        const bottom = bottomRow({ layer, asciiMode, spaceLabel: '空格', script });
        for (const key of bottom) {
          for (const stroke of strokesOf(key)) {
            out.push({ layout: `bottomRow/${script}/${asciiMode ? 'ascii' : 'native'}/${layer}`, id: key.id, stroke });
          }
        }
      }
    }
  }
  return out;
}

describe('typeStroke — every key a layout can emit', () => {
  it('maps to a real virtual-key code', () => {
    const { sent, vk } = makeVk();
    const host = new RealHost(vk as never);
    const unmapped: string[] = [];

    for (const { layout, id, stroke } of everyStroke()) {
      sent.length = 0;
      host.typeStroke(stroke);
      if (sent[0].keyCode === 0) unmapped.push(`${layout}/${id} (key=${stroke.key} code=${stroke.code})`);
    }

    expect(unmapped).toEqual([]);
  });

  it('sends a keydown and a keyup for one tap', () => {
    const { sent, vk } = makeVk();
    new RealHost(vk as never).typeStroke({ key: 'a', code: 'KeyA' });

    expect(sent.map(e => e.type)).toEqual(['keydown', 'keyup']);
    expect(sent[0]).toMatchObject({ charValue: 97, keyCode: 65, keyName: 'KeyA', modifiers: 0 });
  });

  it('carries the shift modifier and drops charValue for multi-char keys', () => {
    const { sent, vk } = makeVk();
    const host = new RealHost(vk as never);

    host.typeStroke({ key: 'A', code: 'KeyA', shiftKey: true });
    expect(sent[0]).toMatchObject({ charValue: 65, keyCode: 65, modifiers: 2 });

    sent.length = 0;
    host.typeStroke({ key: 'Backspace', code: 'Backspace' });
    expect(sent[0]).toMatchObject({ charValue: 0, keyCode: 0x08 });
  });
});

describe('container placement', () => {
  it('docked: takes the full screen width and parks at the bottom', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: false, width: 1080, height: 300, draggable: false });

    expect(vk.setContainerBehavior.mock.calls[0][0]).toMatchObject({ mode: 'FULL_WIDTH' });
    expect(resizeTo).toHaveBeenCalledWith(1080, 300);
    expect(moveTo).toHaveBeenCalledWith(0, 500);
    // No handle when docked, or the region sits over the candidate bar.
    expect(vk.setDraggableArea).toHaveBeenCalledWith({ left: 0, top: 0, width: 1080, height: 0 });
    expect(vk.setHitTestBounds).toHaveBeenCalledWith([{ left: 0, top: 0, width: 1080, height: 300 }]);
  });

  it('floating: centres a card that has no stored position', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: true, width: 640, height: 260, draggable: true });

    expect(moveTo).toHaveBeenCalledWith(220, 532);
    expect(vk.setContainerBehavior.mock.calls[0][0]).toMatchObject({ mode: 'FLOATING' });
  });

  it('floating: keeps a card that would overflow inside the screen', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: true, width: 640, height: 260, left: 9000, top: 9000, draggable: true });

    expect(moveTo).toHaveBeenCalledWith(440, 540);
  });

  it('floating: a non-draggable card retires the drag region entirely', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: true, width: 400, height: 240, draggable: false });

    expect(vk.setDraggableArea).toHaveBeenCalledWith({ left: 0, top: 0, width: 400, height: 0 });
  });
});

describe('releaseContainer — the hand-back contract', () => {
  it('restores a full-width container and hit test without moving our window', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    await host.releaseContainer();

    expect(vk.setContainerBehavior.mock.calls[0][0]).toMatchObject({ mode: 'FULL_WIDTH' });
    expect(vk.setDraggableArea).toHaveBeenCalledWith({ left: 0, top: 0, width: 1080, height: 0 });
    const [bounds] = vk.setHitTestBounds.mock.calls.at(-1)![0] as Array<{ width: number; height: number }>;
    expect(bounds.width).toBe(1080);
    expect(bounds.height).toBeGreaterThan(1);
    // The whole point: setupContainer's moveTo lands after the next keyboard
    // has taken over and is read back as a user-chosen position.
    expect(resizeTo).not.toHaveBeenCalled();
    expect(moveTo).not.toHaveBeenCalled();
  });

  it('re-sends the hit test after a hand-back, even for an identical rect', async () => {
    // The docked hand-back and the docked keyboard ask for the same rect, so a
    // cache that survived the hand-back would skip re-claiming a region the
    // lock screen keyboard may have overwritten.
    const { vk } = makeVk();
    const host = new RealHost(vk as never);
    const docked = { floating: false, width: 1080, height: 372, draggable: false };

    await host.setupContainer(docked);
    await host.releaseContainer();
    const beforeRestore = vk.setHitTestBounds.mock.calls.length;
    await host.setupContainer(docked);

    expect(vk.setHitTestBounds.mock.calls.length).toBe(beforeRestore + 1);
  });

  it('does not re-send an unchanged hit test within one session', async () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);
    const docked = { floating: false, width: 1080, height: 372, draggable: false };

    await host.setupContainer(docked);
    const first = vk.setHitTestBounds.mock.calls.length;
    await host.setupContainer(docked);

    expect(vk.setHitTestBounds.mock.calls.length).toBe(first);
  });
});

describe('placement storage', () => {
  function stubStorage(stored?: unknown) {
    const set = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', {
      runtime: { lastError: null },
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve(stored === undefined ? {} : { inputViewFloating: stored })),
          set,
        },
      },
    });
    return set;
  }

  it('round-trips a stored placement', async () => {
    stubStorage({ mode: 'floating', scale: 0.7, side: 'left', left: 120, top: 240 });
    const { vk } = makeVk();

    await expect(new RealHost(vk as never).readPlacement())
      .resolves.toMatchObject({ mode: 'floating', scale: 0.7, side: 'left', left: 120, top: 240 });
  });

  it('falls back to the default when nothing is stored', async () => {
    stubStorage();
    const { vk } = makeVk();

    await expect(new RealHost(vk as never).readPlacement()).resolves.toMatchObject({ mode: 'docked' });
  });

  it('falls back when the stored value is corrupt rather than throwing', async () => {
    stubStorage('not an object');
    const { vk } = makeVk();

    await expect(new RealHost(vk as never).readPlacement()).resolves.toMatchObject({ mode: 'docked' });
  });

  it('survives storage being unavailable', async () => {
    vi.stubGlobal('chrome', {
      runtime: { lastError: null },
      storage: { local: { get: vi.fn(() => Promise.reject(new Error('no storage'))), set: vi.fn() } },
    });
    const { vk } = makeVk();

    await expect(new RealHost(vk as never).readPlacement()).resolves.toMatchObject({ mode: 'docked' });
  });

  it('writes the placement through', () => {
    const set = stubStorage();
    const { vk } = makeVk();

    new RealHost(vk as never).writePlacement({ mode: 'floating', scale: 0.6, side: 'right', left: 10, top: 20 });

    expect(set).toHaveBeenCalledWith({ inputViewFloating: { mode: 'floating', scale: 0.6, side: 'right', left: 10, top: 20 } });
  });
});

describe('keyboard commands', () => {
  it('unlocks the keyboard when hiding, or it stays up for the next field', () => {
    const { vk } = makeVk();

    new RealHost(vk as never).hideKeyboard();

    expect(vk.hideKeyboard).toHaveBeenCalled();
    expect(vk.lockKeyboard).toHaveBeenCalledWith(false);
  });

  it('forwards insertText and keyboardLoaded untouched', () => {
    const { vk } = makeVk();
    const host = new RealHost(vk as never);

    host.insertText('好');
    host.keyboardLoaded();

    expect(vk.insertText).toHaveBeenCalledWith('好');
    expect(vk.keyboardLoaded).toHaveBeenCalled();
  });
});
