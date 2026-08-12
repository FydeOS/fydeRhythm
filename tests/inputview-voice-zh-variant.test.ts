import { describe, expect, it } from 'vitest';

import { buildSessionParams, type ZhVariant } from '../entrypoints/inputview/voice/transport';

function request(zhVariant?: ZhVariant) {
  return (buildSessionParams('uid', zhVariant) as { request: Record<string, unknown> }).request;
}

describe('traditional Chinese output', () => {
  it('is not requested unless a caller asks for it', () => {
    // The model only emits simplified, and nothing tells us which script the
    // user is writing. Two candidate signals were tried and rejected: the
    // browser UI language says nothing about what is being typed, and Rime's
    // `simplification` option means the opposite of what its name suggests
    // (true = simplified) and is absent from the bundled schema entirely.
    expect('output_zh_variant' in request()).toBe(false);
  });

  it('passes the regional standard through when one is supplied', () => {
    for (const variant of ['traditional', 'tw', 'hk'] as const) {
      expect(request(variant).output_zh_variant).toBe(variant);
    }
  });
});
