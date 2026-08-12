// Turning cumulative recognition results into text that only ever grows.
//
// Responses are cumulative (`result_type: "full"`), so each packet carries
// every utterance so far and the same sentence appears again and again, revised
// each time, until the second pass marks it `definite`. Committing means
// tracking how far we have advanced through that list — never appending a
// packet's contents.
//
// The rule the host application depends on: text goes in once and is never
// rewritten. There is no un-commit, because taking characters back would mean
// deleteSurroundingText against a live text field, which this design rejects.

import type { AsrUtterance } from './protocol';

export interface CommitState {
  /** Utterances already inserted. Indexes into the cumulative list. */
  committed: number;
}

export const kInitialCommit: CommitState = { committed: 0 };

export interface CommitOutcome {
  state: CommitState;
  /** Text to insert now — empty when nothing became final in this packet. */
  commit: string;
  /** The tail that is still being revised, for the panel to display. */
  pending: string;
}

export interface CommitOptions {
  /** Set on the final response: commit the tail even if the server never
   *  marked it definite, so a session that ends mid-sentence does not silently
   *  discard the user's last words. */
  flush?: boolean;
}

function textOf(utterances: readonly AsrUtterance[], from: number, to: number): string {
  let text = '';
  for (let i = from; i < to; i++) text += utterances[i]?.text ?? '';
  return text;
}

export function advanceCommit(
  state: CommitState,
  utterances: readonly AsrUtterance[] | undefined,
  options: CommitOptions = {},
): CommitOutcome {
  const list = utterances ?? [];

  // The cursor is a high-water mark, never a position: a cumulative list should
  // not shrink, but if it does, LOWERING the cursor to fit would mean that when
  // the list grows back, everything past the shorter length looks new and is
  // inserted a second time. Reads are clamped to what exists; the mark is not.
  const committed = Math.min(state.committed, list.length);

  let next = committed;
  if (options.flush) {
    next = list.length;
  }
  else {
    // Advance only across a definite PREFIX. Committing a later sentence while
    // an earlier one is still open would insert the two out of order, and the
    // earlier one could never be placed correctly afterwards.
    while (next < list.length && list[next]?.definite) next++;
  }

  return {
    state: { committed: Math.max(state.committed, next) },
    commit: textOf(list, committed, next),
    pending: textOf(list, next, list.length),
  };
}
