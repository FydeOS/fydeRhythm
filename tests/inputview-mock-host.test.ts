// @vitest-environment jsdom
//
// The dev MockHost must mirror the controller's insertLiteral contract:
// a literal insert flushes the simulated composition, so the audit and
// ?layout previews exercise the same state transitions as the device.

import { describe, expect, it } from 'vitest';

import { createHost } from '../entrypoints/inputview/chrome-shim';
import type { BackgroundToInputView } from '../lib/shared-types';

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

async function connectMock(query = '') {
  window.history.replaceState(null, '', `/${query}`);
  const host = createHost();
  expect(host.mock).toBe(true);
  const received: BackgroundToInputView[] = [];
  const post = host.connect(msg => received.push(msg));
  await nextTick(); // connect posts the initial state on a timeout
  return { host, post, received };
}

describe('MockHost literal-insert contract', () => {
  it('publishes the 大千 alphabet for the zhuyin preview and none otherwise', async () => {
    const zhuyin = await connectMock('?layout=zhuyin');
    const state = zhuyin.received.find(m => m.kind === 'state');
    expect(state?.kind === 'state' && state.state.alphabet).toContain(',');

    const qwerty = await connectMock();
    const plain = qwerty.received.find(m => m.kind === 'state');
    expect(plain?.kind === 'state' && plain.state.alphabet).toBe('');
  });

  it('flushes the simulated composition and republishes empty candidates', async () => {
    const { host, post, received } = await connectMock();

    host.typeStroke({ key: 'n', code: 'KeyN' });
    expect((window as { __mockComposition?: string }).__mockComposition).toBe('n');

    post({ kind: 'insertLiteral', text: '，' });
    expect((window as { __mockComposition?: string }).__mockComposition).toBe('');
    const last = received.at(-1);
    expect(last?.kind === 'candidates' && last.candidates).toEqual([]);
    expect(last?.kind === 'candidates' && last.highlightedIndex).toBe(-1);
  });
});
