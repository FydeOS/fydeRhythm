// @vitest-environment jsdom
//
// The container is shared with the next keyboard and outlives this page, so
// these drive the real App through a lock/unlock cycle in every mode.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContainerGeometry, Placement } from '../entrypoints/inputview/placement';

// RealHost resizes and moves the window to the geometry it applies; the
// container's "did my placement land" check reads that back.
const setupContainer = vi.fn<(g: ContainerGeometry) => Promise<void>>((g) => {
  setWindowSize(g.width, g.height);
  setWindowPos(g.left ?? 0, g.top ?? 0);
  return Promise.resolve();
});
const writePlacement = vi.fn<(p: Placement) => void>();
const releaseContainer = vi.fn<() => Promise<void>>(() => Promise.resolve());
let storedPlacement: Placement;

const fakeHost = {
  mock: true,
  typeStroke: vi.fn(),
  insertText: vi.fn(),
  readClipboard: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
  pasteClipboardItem: vi.fn(() => Promise.resolve(true)),
  deleteClipboardItem: vi.fn(() => Promise.resolve(true)),
  subscribeClipboard: vi.fn(() => () => {}),
  hideKeyboard: vi.fn(),
  keyboardLoaded: vi.fn(),
  openSettings: vi.fn(),
  setupContainer,
  releaseContainer,
  writePlacement,
  readPlacement: vi.fn(() => Promise.resolve(storedPlacement)),
  connect: vi.fn(() => vi.fn()),
};

vi.mock('../entrypoints/inputview/chrome-shim', () => ({
  createHost: () => fakeHost,
  RealHost: class {},
}));

const App = (await import('../entrypoints/inputview/App')).default;

// jsdom's screen/position are read-only getters; the lock screen moves our
// window, so tests must be able to move it too.
function setWindowPos(left: number, top: number) {
  Object.defineProperty(window, 'screenX', { value: left, configurable: true });
  Object.defineProperty(window, 'screenY', { value: top, configurable: true });
}
function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}
let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
}

const flush = () => act(async () => { await Promise.resolve(); });
const fire = (target: EventTarget, type: string) => act(async () => {
  target.dispatchEvent(new Event(type));
  await Promise.resolve();
});

async function mount(placement: Placement) {
  storedPlacement = placement;
  setWindowSize(1080, 320);
  setWindowPos(356, 285);
  render(<App />);
  await flush();
  setupContainer.mockClear();
  releaseContainer.mockClear();
  writePlacement.mockClear();
}

// Chrome collapses the window and the replacement keyboard moves it.
async function lock({ collapse = true }: { collapse?: boolean } = {}) {
  setHidden(true);
  if (collapse) setWindowSize(1080, 0);
  await fire(document, 'visibilitychange');
  if (collapse) {
    setWindowPos(0, 0); // the lock screen parks our window at the origin
    await fire(window, 'resize');
  }
  await flush();
}

async function unlock() {
  setHidden(false);
  setWindowSize(1080, 320);
  await fire(document, 'visibilitychange');
  await flush();
  await fire(window, 'resize');
  await flush();
}

const calls = () => setupContainer.mock.calls.map(c => c[0]);

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(window, 'screen', {
    value: { width: 1080, height: 800 },
    configurable: true,
  });
  setHidden(false);
});

afterEach(() => {
  // Without this the previous App stays mounted and its window/document
  // listeners keep writing into the shared setupContainer mock.
  cleanup();
  vi.clearAllMocks();
});

const docked: Placement = { mode: 'docked', scale: 0.6, side: 'right' };
const floating: Placement = { mode: 'floating', scale: 0.6, side: 'right', left: 356, top: 285 };
const onehand: Placement = { mode: 'onehand', scale: 0.6, side: 'right' };

describe('VK container state machine — hide (lock) handback', () => {
  it('I1 floating: hands the container back full-width, never floating', async () => {
    await mount(floating);
    await lock();

    // Handed back via releaseContainer (which never moves our window), and no
    // floating container is left behind for the lock screen to inherit.
    expect(releaseContainer).toHaveBeenCalled();
    for (const g of calls()) expect(g.floating).toBe(false);
  });

  it('I1 onehand: hands the container back full-width too (it is a FLOATING container)', async () => {
    await mount(onehand);
    await lock();

    expect(releaseContainer).toHaveBeenCalled();
    for (const g of calls()) expect(g.floating).toBe(false);
  });

  it('I1 docked: already full-width, so it never writes a floating container', async () => {
    await mount(docked);
    await lock();

    for (const g of calls()) expect(g.floating).toBe(false);
  });

  it('I1 the handback never re-runs setupContainer: its moveTo lands late and is read back as user intent', async () => {
    await mount(floating);
    await lock();

    expect(releaseContainer).toHaveBeenCalled();
    expect(setupContainer).not.toHaveBeenCalled();
  });

  it('I2 does not persist a position read from the collapsed window', async () => {
    await mount(floating);
    await lock();

    for (const [p] of writePlacement.mock.calls) {
      expect(p.left).not.toBe(0);
      expect(p.top).not.toBe(0);
    }
  });
});

describe('VK container state machine — restore (unlock)', () => {
  it('I3 floating: re-places at the saved position, not where the lock screen moved us', async () => {
    await mount(floating);
    await lock();
    setupContainer.mockClear();
    await unlock();

    const restored = calls().filter(g => g.floating);
    expect(restored.length).toBeGreaterThan(0);
    for (const g of restored) {
      expect(g.left).toBe(356);
      expect(g.top).toBe(285);
    }
  });

  it('I3 onehand: returns to its corner, not the origin', async () => {
    await mount(onehand);
    await lock();
    setupContainer.mockClear();
    await unlock();

    const restored = calls().filter(g => g.floating);
    expect(restored.length).toBeGreaterThan(0);
    // Corner-pinned: right-aligned and above the bottom edge.
    for (const g of restored) {
      expect(g.left).toBeGreaterThan(0);
      expect(g.top).toBeGreaterThan(0);
    }
  });

  it('I4 floating: placement does not drift across repeated lock/unlock cycles', async () => {
    await mount(floating);
    const seen: Array<{ left?: number; top?: number }> = [];
    for (let i = 0; i < 3; i++) {
      await lock();
      setupContainer.mockClear();
      await unlock();
      const g = calls().filter(c => c.floating).at(-1);
      seen.push({ left: g?.left, top: g?.top });
      setupContainer.mockClear();
    }
    expect(seen).toEqual([
      { left: 356, top: 285 },
      { left: 356, top: 285 },
      { left: 356, top: 285 },
    ]);
  });

  it('I4 floating: a real user drag is still honoured after a cycle', async () => {
    await mount(floating);
    // User drags the card; the OS moves the window, we learn on the next resize.
    setWindowPos(120, 500);
    await fire(window, 'resize');
    await flush();

    await lock();
    setupContainer.mockClear();
    await unlock();

    const g = calls().filter(c => c.floating).at(-1);
    expect({ left: g?.left, top: g?.top }).toEqual({ left: 120, top: 500 });
  });
});

describe('VK container state machine — collapsed frames', () => {
  it('I5 a resize while hidden/collapsed drives no floating container write', async () => {
    await mount(floating);
    setHidden(true);
    setWindowSize(1080, 0);
    setWindowPos(0, 0);

    await fire(window, 'resize');
    await flush();

    for (const g of calls()) expect(g.floating).toBe(false);
  });
});
