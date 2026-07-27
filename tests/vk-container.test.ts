// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContainerGeometry, Placement } from '../entrypoints/inputview/placement';
import { type PlacementBase, VkContainer } from '../entrypoints/inputview/vk-container';

const floatingPrefs: Placement = { mode: 'floating', scale: 0.6, side: 'right', left: 356, top: 285 };

function harness(base: PlacementBase, prefs: Placement = floatingPrefs) {
  // RealHost resizes and moves the window to the geometry it applies; the
  // container's "did my placement land" check reads that back.
  const setupContainer = vi.fn<(g: ContainerGeometry) => Promise<void>>((g) => {
    setWindow(g.width, g.height, g.left ?? 0, g.top ?? 0);
    return Promise.resolve();
  });
  const releaseContainer = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const writePlacement = vi.fn<(p: Placement) => void>();
  const host = {
    setupContainer,
    releaseContainer,
    writePlacement,
    readPlacement: () => Promise.resolve(prefs),
  };
  const current = { ...base };
  const container = new VkContainer(host, () => current, () => 4);
  return {
    container,
    current,
    setupContainer,
    releaseContainer,
    writePlacement,
    placed: () => setupContainer.mock.calls.map(c => c[0]),
  };
}

let hidden = false;
// A user drag moves the window; it does not resize it.
function moveWindow(left: number, top: number) {
  Object.defineProperty(window, 'screenX', { value: left, configurable: true });
  Object.defineProperty(window, 'screenY', { value: top, configurable: true });
}
function setWindow(width: number, height: number, left = 0, top = 0) {
  for (const [k, v] of Object.entries({ innerWidth: width, innerHeight: height, screenX: left, screenY: top })) {
    Object.defineProperty(window, k, { value: v, configurable: true });
  }
}

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(window, 'screen', { value: { width: 1080, height: 800 }, configurable: true });
  setWindow(1080, 320, 356, 285);
});

afterEach(() => vi.restoreAllMocks());

describe('VkContainer.load', () => {
  it('adopts the stored position', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();

    expect(h.container.placement()).toMatchObject({ left: 356, top: 285 });
  });

  it('leaves the position unset when the prefs carry none (centre on first show)', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' }, { mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();

    expect(h.container.placement().left).toBeUndefined();
  });

  it('ignores every transition until loaded', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.hide();
    await h.container.restore();
    await h.container.rotate();
    await h.container.resized();
    await h.container.sync();

    expect(h.setupContainer).not.toHaveBeenCalled();
    expect(h.releaseContainer).not.toHaveBeenCalled();
  });
});

describe('VkContainer.hide — handing the container to the next keyboard', () => {
  it('releases full-width for a floating card, without re-running setup', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.hide();

    expect(h.releaseContainer).toHaveBeenCalledTimes(1);
    expect(h.setupContainer).not.toHaveBeenCalled();
  });

  it('releases for one-hand too — it is a FLOATING container despite the mode name', async () => {
    const h = harness({ mode: 'onehand', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.hide();

    expect(h.releaseContainer).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a docked keyboard: the container is already full-width', async () => {
    const h = harness({ mode: 'docked', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.hide();

    expect(h.releaseContainer).not.toHaveBeenCalled();
  });

  it('persists the live position while the window still holds our placement', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    moveWindow(120, 500); // user dragged the card
    await h.container.hide();

    expect(h.writePlacement).toHaveBeenCalledWith(expect.objectContaining({ left: 120, top: 500 }));
  });

  it('keeps the saved position when the window has already collapsed', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    setWindow(1080, 0, 0, 0); // lock teardown: collapsed and parked at the origin
    await h.container.hide();

    expect(h.writePlacement).not.toHaveBeenCalled();
    expect(h.container.placement()).toMatchObject({ left: 356, top: 285 });
  });
});

describe('VkContainer.restore — coming back from the lock screen', () => {
  it('re-places at the saved position, ignoring where we were parked', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    setWindow(1080, 0, 0, 0);
    await h.container.hide();
    setWindow(1080, 320, 0, 0); // still parked at the origin when we come back
    await h.container.restore();

    expect(h.placed().at(-1)).toMatchObject({ left: 356, top: 285 });
  });

  it('does not place while still hidden', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    hidden = true;
    await h.container.restore();

    expect(h.setupContainer).not.toHaveBeenCalled();
  });

  it('lets the first resize after a restore settle instead of adopting the parked spot', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    setWindow(1080, 0, 0, 0);
    await h.container.hide();
    setWindow(1080, 320, 0, 0);
    await h.container.restore();

    await h.container.resized(); // still reads the parked origin — must be ignored
    expect(h.container.placement()).toMatchObject({ left: 356, top: 285 });

    // Once settled, a genuine move is adopted again.
    moveWindow(200, 400);
    await h.container.resized();
    expect(h.container.placement()).toMatchObject({ left: 200, top: 400 });
  });

  it('survives repeated cycles without drifting', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    for (let i = 0; i < 3; i++) {
      setWindow(1080, 0, 0, 0);
      await h.container.hide();
      setWindow(1080, 320, 0, 0);
      await h.container.restore();
      await h.container.resized();
    }

    expect(h.container.placement()).toMatchObject({ left: 356, top: 285 });
  });
});

// Each of these was reachable in the first version of the extraction.
describe('VkContainer — released phase closes the gaps a review found', () => {
  it('a rows change after the handback does not re-take the container', async () => {
    // The background broadcasts state to hidden ports too, so a schema switch
    // while locked flips the row count and reaches sync().
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    setWindow(1080, 0, 0, 0);
    hidden = true;
    await h.container.hide();
    h.setupContainer.mockClear();

    await h.container.sync();

    expect(h.setupContainer).not.toHaveBeenCalled();
  });

  it('a queued drag frame after the handback does not re-take the container', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    h.container.beginDrag();
    hidden = true;
    await h.container.hide();
    h.setupContainer.mockClear();
    // Unlocked again, but restore() has not run yet: the container is still the
    // next keyboard's until we take it back deliberately.
    hidden = false;

    await h.container.dragTo(); // the rAF queued before the lock finally runs

    expect(h.setupContainer).not.toHaveBeenCalled();
  });

  it('rotating on a collapsed frame does not adopt the origin', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    setWindow(1080, 0, 0, 0); // visible but mid-teardown

    await h.container.rotate();

    expect(h.container.placement()).toMatchObject({ left: 356, top: 285 });
  });

  it('hiding in one-hand does not arm a distrust that a later floating drag pays for', async () => {
    const h = harness({ mode: 'onehand', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    setWindow(1080, 0, 0, 0);
    await h.container.hide();

    // Back in floating mode later, a genuine drag must still be adopted.
    hidden = false;
    h.current.mode = 'floating';
    await h.container.restore();
    moveWindow(240, 360);
    await h.container.resized();

    expect(h.container.placement()).toMatchObject({ left: 240, top: 360 });
  });

  it('starts a drag from the live window when no position was ever stored', async () => {
    const bare: Placement = { mode: 'floating', scale: 0.6, side: 'right' };
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' }, bare);
    await h.container.load();
    moveWindow(70, 90);

    expect(h.container.beginDrag()).toEqual({ left: 70, top: 90 });
  });

  it('ending a drag that never started persists nothing', () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    h.container.endDrag();

    expect(h.writePlacement).not.toHaveBeenCalled();
  });

  it('a drag ends cleanly and persists once', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    h.container.beginDrag();
    await h.container.resized(); // suppressed while dragging
    const during = h.setupContainer.mock.calls.length;
    await h.container.dragTo();
    h.container.endDrag();

    expect(h.setupContainer.mock.calls.length).toBe(during + 1);
    expect(h.writePlacement).toHaveBeenCalledTimes(1);
  });
});

describe('VkContainer.resized / sync', () => {
  it('skips a collapsed window entirely', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    setWindow(1080, 0, 0, 0);
    await h.container.resized();

    expect(h.setupContainer).not.toHaveBeenCalled();
  });

  it('does not re-place when the geometry is unchanged', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    const first = h.setupContainer.mock.calls.length;
    await h.container.sync();

    expect(h.setupContainer.mock.calls.length).toBe(first);
  });

  it('re-places when the mode changes', async () => {
    const h = harness({ mode: 'floating', scale: 0.6, side: 'right' });
    await h.container.load();
    await h.container.sync();
    h.current.mode = 'docked';
    await h.container.sync();

    expect(h.placed().at(-1)?.floating).toBe(false);
  });

  it('never adopts a window position for a docked keyboard', async () => {
    const h = harness({ mode: 'docked', scale: 0.6, side: 'right' });
    await h.container.load();
    setWindow(1080, 320, 999, 999);
    await h.container.resized();

    expect(h.placed().every(g => !g.floating)).toBe(true);
  });
});
