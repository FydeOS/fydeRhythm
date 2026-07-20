import { afterEach, describe, expect, it, vi } from 'vitest';

const { serviceWorkerKeepalive } = await import('../entrypoints/background/keepalive');

// serviceWorkerKeepalive guards on a module-level interval, so the whole
// lifecycle is exercised in a single test.
describe('service worker keepalive', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('survives a dead port and reconnects on the next tick', () => {
    vi.useFakeTimers();
    const ports: Array<{ postMessage: ReturnType<typeof vi.fn> }> = [];
    const connect = vi.fn(() => {
      const port = {
        name: 'keepalive',
        postMessage: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      };
      ports.push(port);
      return port;
    });
    vi.stubGlobal('chrome', { runtime: { connect, lastError: null } });

    serviceWorkerKeepalive();

    // Tick 1: connect and ping.
    vi.advanceTimersByTime(25000);
    expect(ports).toHaveLength(1);
    expect(ports[0].postMessage).toHaveBeenCalledWith({ content: 'ping' });

    // Tick 2: the worker restarted, the port is dead — postMessage throws
    // synchronously. An uncaught throw would kill the interval tick.
    ports[0].postMessage.mockImplementation(() => { throw new Error('port closed'); });
    expect(() => vi.advanceTimersByTime(25000)).not.toThrow();

    // Tick 3: a fresh port is connected and pinged.
    vi.advanceTimersByTime(25000);
    expect(ports).toHaveLength(2);
    expect(ports[1].postMessage).toHaveBeenCalledWith({ content: 'ping' });
  });
});
