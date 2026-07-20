import { afterEach, describe, expect, it, vi } from 'vitest';

import { RealHost } from '../entrypoints/inputview/chrome-shim';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputView fabricated key events', () => {
  it('uses the OEM quote virtual-key code instead of the slash code', () => {
    const events: Array<Record<string, unknown>> = [];
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      innerWidth: 1000,
      innerHeight: 400,
    });
    vi.stubGlobal('chrome', { runtime: { lastError: null } });
    const vk = {
      sendKeyEvent: vi.fn((event: Record<string, unknown>, callback?: () => void) => {
        events.push(event);
        callback?.();
      }),
    };
    const host = new RealHost(vk as never);

    host.typeStroke({ key: "'", code: 'Quote' });
    host.typeStroke({ key: '/', code: 'Slash' });

    expect(events[0].keyCode).toBe(0xDE);
    expect(events[2].keyCode).toBe(0xBF);
  });
});
