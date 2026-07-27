import { afterEach, describe, expect, it, vi } from 'vitest';

import { windowCollapsed } from '../entrypoints/inputview/window-state';

function stub(hidden: boolean, innerWidth: number, innerHeight: number) {
  vi.stubGlobal('document', { hidden });
  vi.stubGlobal('window', { innerWidth, innerHeight });
}

describe('windowCollapsed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false for a visible, sized window', () => {
    stub(false, 1000, 320);
    expect(windowCollapsed()).toBe(false);
  });

  it('is true when the tab is hidden, whatever the size', () => {
    stub(true, 1000, 320);
    expect(windowCollapsed()).toBe(true);
  });

  it('is true when either dimension is zero', () => {
    stub(false, 0, 320);
    expect(windowCollapsed()).toBe(true);
    stub(false, 1000, 0);
    expect(windowCollapsed()).toBe(true);
    stub(false, 0, 0);
    expect(windowCollapsed()).toBe(true);
  });
});
