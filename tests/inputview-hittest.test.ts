import { afterEach, describe, expect, it, vi } from 'vitest';

import { RealHost } from '../entrypoints/inputview/chrome-shim';

// A window stub whose `resize` handler (registered by RealHost's constructor)
// can be fired on demand, with mutable innerWidth/innerHeight so we can
// reproduce Chrome collapsing the VK window during a lock-screen teardown.
// `resizeSyncs: false` models resizeTo() NOT having updated inner* yet — used
// to prove the intentional callers report from explicit dims, not live size.
function stubWindow(init: {
  innerWidth: number;
  innerHeight: number;
  screenWidth?: number;
  screenHeight?: number;
  resizeSyncs?: boolean;
  hidden?: boolean;
}) {
  const sync = init.resizeSyncs ?? true;
  const listeners: Record<string, (() => void) | undefined> = {};
  const doc = { hidden: init.hidden ?? false };
  const win = {
    innerWidth: init.innerWidth,
    innerHeight: init.innerHeight,
    screen: { width: init.screenWidth ?? 1000, height: init.screenHeight ?? 800 },
    addEventListener(type: string, fn: () => void) { listeners[type] = fn; },
    resizeTo(w: number, h: number) { if (sync) { win.innerWidth = w; win.innerHeight = h; } },
    moveTo() {},
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  return {
    win,
    setHidden(hidden: boolean) { doc.hidden = hidden; },
    // Simulate a browser resize: apply the new size, then fire the handler.
    fireResize(innerWidth: number, innerHeight: number) {
      win.innerWidth = innerWidth;
      win.innerHeight = innerHeight;
      listeners.resize?.();
    },
  };
}

type Bounds = { left: number; top: number; width: number; height: number };
const reportedBounds = (fn: ReturnType<typeof vi.fn>): Bounds[] =>
  fn.mock.calls.map(call => (call[0] as Bounds[])[0]);

describe('InputView hit-test bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports the real window rect on a normal resize', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 400 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    env.fireResize(1000, 320);

    expect(setHitTestBounds).toHaveBeenLastCalledWith([{ left: 0, top: 0, width: 1000, height: 320 }]);
  });

  it('reports the exact rect across a range of valid sizes (docked and floating)', () => {
    const env = stubWindow({ innerWidth: 1280, innerHeight: 372 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    const sizes = [[1280, 372], [320, 205], [900, 300], [1920, 500]];
    for (const [w, h] of sizes) env.fireResize(w, h);

    expect(reportedBounds(setHitTestBounds)).toEqual(
      sizes.map(([w, h]) => ({ left: 0, top: 0, width: w, height: h })),
    );
  });

  it('does NOT report anything when the window collapses to 0x0 (lock teardown)', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 320 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    // Chrome zeroes the window as the lock screen swaps in its own keyboard.
    // The old `innerHeight || 1` reported [{width: screenW, height: 1}] here.
    env.fireResize(0, 0);

    expect(setHitTestBounds).not.toHaveBeenCalled();
  });

  it('skips the report when only one dimension collapses', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 320 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    env.fireResize(0, 320); // width gone
    env.fireResize(1200, 0); // height gone (the exact 1px-strip trigger)

    expect(setHitTestBounds).not.toHaveBeenCalled();
  });

  it('skips a reactive resize when the tab is hidden even at a valid size', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 320 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    env.setHidden(true);
    env.fireResize(1000, 320); // valid size, but the page is backgrounded

    expect(setHitTestBounds).not.toHaveBeenCalled();
  });

  it('never emits a degenerate region across a full lock teardown sequence', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 400 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    env.fireResize(1000, 320); // keyboard shown
    env.fireResize(0, 0); // lock: collapse
    env.fireResize(1200, 0); // intermediate teardown frame
    env.fireResize(1000, 300); // replacement keyboard sized

    const reported = reportedBounds(setHitTestBounds);
    // Only the two valid frames go out; every degenerate frame is skipped.
    expect(reported).toEqual([
      { left: 0, top: 0, width: 1000, height: 320 },
      { left: 0, top: 0, width: 1000, height: 300 },
    ]);
    for (const r of reported) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  it('resumes reporting once the window regains a real size after teardown', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 320 });
    const setHitTestBounds = vi.fn();
    new RealHost({ setHitTestBounds } as never);

    env.fireResize(0, 0);
    expect(setHitTestBounds).not.toHaveBeenCalled();

    env.fireResize(1000, 300);
    expect(setHitTestBounds).toHaveBeenCalledTimes(1);
    expect(setHitTestBounds).toHaveBeenLastCalledWith([{ left: 0, top: 0, width: 1000, height: 300 }]);
  });

  it('swallows a setHitTestBounds failure without throwing out of the resize handler', () => {
    const env = stubWindow({ innerWidth: 1000, innerHeight: 320 });
    const setHitTestBounds = vi.fn(() => { throw new Error('vk gone'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    new RealHost({ setHitTestBounds } as never);

    expect(() => env.fireResize(1000, 320)).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  // Intentional callers must report the size they applied even if the live
  // window looks collapsed (0x0 not yet synced, or a hidden tab) — otherwise the
  // guard could wrongly skip a legitimate show. Explicit dims bypass the check.
  it('reports the docked rect from explicit dims even when the live window looks collapsed', async () => {
    stubWindow({ innerWidth: 0, innerHeight: 0, screenWidth: 1280, resizeSyncs: false, hidden: true });
    vi.stubGlobal('chrome', { runtime: { lastError: null } });
    const setHitTestBounds = vi.fn();
    const vk = {
      setContainerBehavior: (_opts: object, cb: () => void) => cb(),
      setDraggableArea: vi.fn(),
      setHitTestBounds,
    };
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: false, width: 1280, height: 372, draggable: false });

    expect(setHitTestBounds).toHaveBeenCalledTimes(1);
    expect(setHitTestBounds).toHaveBeenCalledWith([{ left: 0, top: 0, width: 1280, height: 372 }]);
  });

  it('reports the floating rect from explicit dims even if inner* has not synced', async () => {
    stubWindow({ innerWidth: 0, innerHeight: 0, screenWidth: 1280, screenHeight: 800, resizeSyncs: false });
    vi.stubGlobal('chrome', { runtime: { lastError: null } });
    const setHitTestBounds = vi.fn();
    const vk = {
      setContainerBehavior: (_opts: object, cb: () => void) => cb(),
      setDraggableArea: vi.fn(),
      setHitTestBounds,
    };
    const host = new RealHost(vk as never);

    await host.setupContainer({ floating: true, width: 420, height: 260, draggable: true });

    expect(setHitTestBounds).toHaveBeenCalledTimes(1);
    expect(setHitTestBounds).toHaveBeenCalledWith([{ left: 0, top: 0, width: 420, height: 260 }]);
  });
});
