import { describe, expect, it } from 'vitest';

import {
  advanceCommit,
  type CommitState,
  kInitialCommit,
} from '../entrypoints/inputview/voice/commit-cursor';
import type { AsrUtterance } from '../entrypoints/inputview/voice/protocol';

function u(text: string, definite = false): AsrUtterance {
  return { text, definite };
}

/** Replays a sequence of cumulative packets, collecting everything committed. */
function replay(packets: readonly (readonly AsrUtterance[])[]): { committed: string; pending: string; state: CommitState } {
  let state = kInitialCommit;
  let committed = '';
  let pending = '';
  for (const packet of packets) {
    const outcome = advanceCommit(state, packet);
    state = outcome.state;
    committed += outcome.commit;
    pending = outcome.pending;
  }
  return { committed, pending, state };
}

describe('voice commit cursor', () => {
  it('commits nothing while the first sentence is still being revised', () => {
    const result = replay([
      [u('这是')],
      [u('这是字节')],
      [u('这是字节跳动')],
    ]);

    expect(result.committed).toBe('');
    expect(result.pending).toBe('这是字节跳动');
  });

  it('commits a sentence once it is marked definite', () => {
    const result = replay([
      [u('这是字节跳动')],
      [u('这是字节跳动，', true)],
    ]);

    expect(result.committed).toBe('这是字节跳动，');
    expect(result.pending).toBe('');
  });

  it('never re-commits a sentence that keeps arriving in later packets', () => {
    // The cumulative list repeats the finished sentence in every packet.
    const done = u('这是字节跳动，', true);
    const result = replay([
      [done],
      [done, u('今日')],
      [done, u('今日头条')],
      [done, u('今日头条母公司。', true)],
    ]);

    expect(result.committed).toBe('这是字节跳动，今日头条母公司。');
    expect(result.pending).toBe('');
    expect(result.state.committed).toBe(2);
  });

  it('is idempotent when the same packet is processed twice', () => {
    const packet = [u('一句话。', true)];
    const first = advanceCommit(kInitialCommit, packet);
    const second = advanceCommit(first.state, packet);

    expect(first.commit).toBe('一句话。');
    expect(second.commit).toBe('');
  });

  it('commits several sentences that finalise in one packet', () => {
    const outcome = advanceCommit(kInitialCommit, [
      u('第一句。', true),
      u('第二句。', true),
      u('第三句'),
    ]);

    expect(outcome.commit).toBe('第一句。第二句。');
    expect(outcome.pending).toBe('第三句');
    expect(outcome.state.committed).toBe(2);
  });

  it('holds back a definite sentence while an earlier one is still open', () => {
    // Committing index 1 here would put the second sentence into the field
    // ahead of the first, and the first could never be placed correctly after.
    const outcome = advanceCommit(kInitialCommit, [
      u('还在改的第一句'),
      u('已经定稿的第二句。', true),
    ]);

    expect(outcome.commit).toBe('');
    expect(outcome.pending).toBe('还在改的第一句已经定稿的第二句。');
    expect(outcome.state.committed).toBe(0);
  });

  it('flushes the open tail on the final response', () => {
    const packet = [u('定稿的。', true), u('没来得及定稿的')];

    const normal = advanceCommit(kInitialCommit, packet);
    expect(normal.commit).toBe('定稿的。');
    expect(normal.pending).toBe('没来得及定稿的');

    const flushed = advanceCommit(kInitialCommit, packet, { flush: true });
    expect(flushed.commit).toBe('定稿的。没来得及定稿的');
    expect(flushed.pending).toBe('');
  });

  it('flushes nothing that was already committed', () => {
    const packet = [u('第一句。', true), u('第二句')];
    const first = advanceCommit(kInitialCommit, packet);
    const flushed = advanceCommit(first.state, packet, { flush: true });

    expect(flushed.commit).toBe('第二句');
    expect(flushed.state.committed).toBe(2);
  });

  it('handles a session with no utterances at all', () => {
    expect(advanceCommit(kInitialCommit, [])).toEqual({
      state: { committed: 0 }, commit: '', pending: '',
    });
    expect(advanceCommit(kInitialCommit, undefined)).toEqual({
      state: { committed: 0 }, commit: '', pending: '',
    });
    expect(advanceCommit(kInitialCommit, [], { flush: true }).commit).toBe('');
  });

  it('does not re-insert text if the list unexpectedly shrinks', () => {
    const state: CommitState = { committed: 3 };
    const outcome = advanceCommit(state, [u('只剩一句。', true)]);

    expect(outcome.commit).toBe('');
    // The mark stays at 3. Lowering it to 1 would make utterances 1 and 2 look
    // new the moment the list grew back, and insert them twice.
    expect(outcome.state.committed).toBe(3);
  });

  it('inserts nothing twice when a shrunken list grows back', () => {
    const three = [u('一。', true), u('二。', true), u('三。', true)];
    const first = advanceCommit(kInitialCommit, three);
    expect(first.commit).toBe('一。二。三。');

    const shrunk = advanceCommit(first.state, [u('一。', true)]);
    expect(shrunk.commit).toBe('');

    const restored = advanceCommit(shrunk.state, [...three, u('四。', true)]);
    expect(restored.commit).toBe('四。');
  });

  it('tolerates an utterance with no text field', () => {
    const outcome = advanceCommit(kInitialCommit, [
      { definite: true } as AsrUtterance,
      u('有文本的。', true),
    ]);

    expect(outcome.commit).toBe('有文本的。');
  });
});
