import type { BackgroundToInputView, InputViewCandidate } from '@/lib/shared-types';

export interface CandidateOrder {
  streamId: string;
  sequence: number;
}

type CandidatePacket = Extract<BackgroundToInputView, { kind: 'candidates' }>;

export interface AcceptedCandidatePacket {
  order: CandidateOrder;
  candidates: InputViewCandidate[];
  highlightedIndex: number;
  collapseExpanded: boolean;
}

/** Candidate packets are ordered within one background-worker stream. A new
 * worker starts a new stream and its first snapshot is authoritative. */
export function isNewCandidateOrder(current: CandidateOrder | null, next: CandidateOrder): boolean {
  return current?.streamId !== next.streamId || next.sequence > current.sequence;
}

export function acceptCandidatePacket(
  current: CandidateOrder | null,
  next: CandidatePacket,
): AcceptedCandidatePacket | null {
  if (!isNewCandidateOrder(current, next)) return null;
  return {
    order: { streamId: next.streamId, sequence: next.sequence },
    candidates: next.candidates,
    highlightedIndex: next.highlightedIndex,
    collapseExpanded: next.candidates.length === 0,
  };
}
