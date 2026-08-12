import { describe, expect, it, vi } from 'vitest';

import { readEngineScriptState } from '../entrypoints/background/inputview-state';
import { buildSessionParams, type ZhVariant } from '../entrypoints/inputview/voice/transport';

function controller(getEngineScriptState?: () => Promise<{ asciiMode: boolean; zhVariant?: ZhVariant } | undefined>) {
  return { getEngineScriptState } as never;
}

describe('asking the engine what script it emits', () => {
  it('reports the resolved script-state answer', async () => {
    const state = await readEngineScriptState(controller(() =>
      Promise.resolve({ asciiMode: false, zhVariant: 'traditional' as const })));
    expect(state?.zhVariant).toBe('traditional');
  });

  it('answers undefined rather than throwing when the engine is unavailable', async () => {
    expect(await readEngineScriptState(controller())).toBeUndefined();
    expect(await readEngineScriptState(undefined)).toBeUndefined();
    expect(await readEngineScriptState(controller(() => Promise.reject(new Error('no session'))))).toBeUndefined();
  });

  it('does not hang the state on a wedged engine', async () => {
    vi.useFakeTimers();
    const pending = readEngineScriptState(controller(() => new Promise(() => {})));
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe('matching that script in voice output', () => {
  const request = (zhVariant?: ZhVariant) =>
    (buildSessionParams('uid', zhVariant) as { request: Record<string, unknown> }).request;

  it('asks for conversion only when Rime is converting', () => {
    // Voice text bypasses Rime, so without this it lands simplified in a
    // document the user is otherwise typing in traditional.
    expect(request('traditional').output_zh_variant).toBe('traditional');
    expect('output_zh_variant' in request()).toBe(false);
  });

  it('passes the regional standards through unchanged', () => {
    expect(request('hk').output_zh_variant).toBe('hk');
    expect(request('tw').output_zh_variant).toBe('tw');
  });
});
