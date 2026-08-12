// The voice panel's state machine.
//
// A reducer rather than a tangle of flags because the important properties are
// about what CANNOT happen: reaching `listening` without both consent and a
// microphone grant, and staying in `listening` after the keyboard is gone.
// Both are one line here and would be scattered assertions otherwise.

import type { CaptureEnd } from './audio';
import type { MicPermission } from './permission';

export type VoiceBlock = 'consent' | 'permission';

/** No 'permission' member, deliberately: a permission problem is recoverable
 *  and has its own card, so routing it here would offer a retry of something
 *  that must fail again. It is a `block`, not a `fail`. */
export type VoiceErrorReason
  = | 'microphone'
    | 'network'
    | 'server'
    | 'unknown';

export type VoiceState
  = | { kind: 'idle' }
  /** Nothing can start; the panel shows a card that routes to the options page. */
    | { kind: 'blocked'; reason: VoiceBlock }
  /** Acquiring the microphone and opening the socket. */
    | { kind: 'starting' }
    | { kind: 'listening'; pending: string; level: number }
  /** The last audio packet is away; waiting for the server's final result. */
    | { kind: 'finalizing'; pending: string; stopped: CaptureEnd }
    | { kind: 'error'; reason: VoiceErrorReason };

export const kIdle: VoiceState = { kind: 'idle' };

export interface VoiceGate {
  consent: boolean;
  permission: MicPermission;
}

export type VoiceEvent
  /** The panel opened. Shows a blocker if there is one; otherwise waits. */
  = | { type: 'prepare'; gate: VoiceGate }
  /** Begin recording now. */
    | { type: 'open'; gate: VoiceGate }
    | { type: 'retry'; gate: VoiceGate }
  /** Microphone and socket are both up. */
    | { type: 'ready' }
    | { type: 'partial'; pending: string }
    | { type: 'level'; level: number }
  /** A recoverable obstacle discovered after the session started — the
   *  microphone prompt was raised into a window that cannot show it, so it was
   *  dismissed unseen. The user needs the settings route, not a retry. */
    | { type: 'block'; reason: VoiceBlock }
    | { type: 'stop'; reason: CaptureEnd }
    | { type: 'final' }
    | { type: 'fail'; reason: VoiceErrorReason }
  /** Panel closed, keyboard dismissed, page hidden. */
    | { type: 'close' };

/** Consent is asked before the permission card because it is the one that
 *  explains why a microphone is wanted at all; sending someone to Chrome's
 *  settings first would be asking them to grant something unexplained. */
function gateOf(gate: VoiceGate): VoiceState {
  if (!gate.consent) return { kind: 'blocked', reason: 'consent' };
  if (gate.permission !== 'granted' && gate.permission !== 'unknown') {
    return { kind: 'blocked', reason: 'permission' };
  }
  return { kind: 'starting' };
}

function isActive(state: VoiceState): boolean {
  return state.kind === 'starting' || state.kind === 'listening' || state.kind === 'finalizing';
}

export function reduce(state: VoiceState, event: VoiceEvent): VoiceState {
  // Closing wins over everything, from every state. Capture callbacks and
  // socket messages are asynchronous, so a stale one can always arrive after
  // the keyboard is gone; nothing below may resurrect a closed session.
  if (event.type === 'close') return kIdle;

  switch (event.type) {
    case 'prepare': {
      // Opening the panel must not start recording: the toolbar button is a
      // toggle, so a mis-tap would begin uploading audio. The panel's own round
      // button starts a session — and it is the only thing that does, which is
      // also what makes its meaning constant.
      //
      // Nor may it end one. Preparing an already-running session would drop it
      // to idle while the microphone stayed open, since only teardown stops
      // capture — a state the panel would render as "finished" while recording.
      if (isActive(state)) return state;
      const gated = gateOf(event.gate);
      return gated.kind === 'blocked' ? gated : kIdle;
    }

    case 'open':
    case 'retry':
      return gateOf(event.gate);

    case 'ready':
      // Only a session that is starting can begin listening. A late 'ready'
      // after a failure or a close must not reopen the microphone panel.
      return state.kind === 'starting' ? { kind: 'listening', pending: '', level: 0 } : state;

    case 'partial':
      if (state.kind === 'listening') return { ...state, pending: event.pending };
      // Results keep arriving while finalizing — that is the point of the wait.
      if (state.kind === 'finalizing') return { ...state, pending: event.pending };
      return state;

    case 'level':
      return state.kind === 'listening' ? { ...state, level: event.level } : state;

    case 'stop':
      if (state.kind === 'listening') {
        return { kind: 'finalizing', pending: state.pending, stopped: event.reason };
      }
      // Stopping while still starting has no audio to finalise.
      return state.kind === 'starting' ? kIdle : state;

    case 'final':
      return state.kind === 'finalizing' ? kIdle : state;

    case 'block':
      return isActive(state) ? { kind: 'blocked', reason: event.reason } : state;

    case 'fail':
      return isActive(state) ? { kind: 'error', reason: event.reason } : state;
  }
}

/** Whether audio should be flowing — the one question the capture layer asks. */
export function isCapturing(state: VoiceState): boolean {
  return state.kind === 'listening';
}
