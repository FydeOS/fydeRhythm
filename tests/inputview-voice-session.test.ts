import { describe, expect, it } from 'vitest';

import {
  isCapturing,
  kIdle,
  reduce,
  type VoiceEvent,
  type VoiceGate,
  type VoiceState,
} from '../entrypoints/inputview/voice/session';

const kAllowed: VoiceGate = { consent: true, permission: 'granted' };

function run(events: readonly VoiceEvent[], from: VoiceState = kIdle): VoiceState {
  return events.reduce(reduce, from);
}

/** Every state the machine can be in, for the invariants that must hold in all
 *  of them. */
const kAllStates: VoiceState[] = [
  kIdle,
  { kind: 'blocked', reason: 'consent' },
  { kind: 'blocked', reason: 'permission' },
  { kind: 'starting' },
  { kind: 'listening', pending: '正在说', level: 0.4 },
  { kind: 'finalizing', pending: '正在说', stopped: 'silence' },
  { kind: 'error', reason: 'network' },
];

describe('voice session gating', () => {
  it('asks for consent before anything else', () => {
    expect(reduce(kIdle, { type: 'open', gate: { consent: false, permission: 'granted' } }))
      .toEqual({ kind: 'blocked', reason: 'consent' });
  });

  it('asks for consent even when the microphone is not granted either', () => {
    // Sending someone to Chrome's settings first would be asking them to grant
    // something nobody has explained yet.
    expect(reduce(kIdle, { type: 'open', gate: { consent: false, permission: 'prompt' } }))
      .toEqual({ kind: 'blocked', reason: 'consent' });
  });

  it('blocks on a missing microphone grant once consent is in place', () => {
    for (const permission of ['prompt', 'denied'] as const) {
      expect(reduce(kIdle, { type: 'open', gate: { consent: true, permission } }))
        .toEqual({ kind: 'blocked', reason: 'permission' });
    }
  });

  it('starts when both gates are open', () => {
    expect(reduce(kIdle, { type: 'open', gate: kAllowed })).toEqual({ kind: 'starting' });
  });

  it('tries anyway when the Permissions API cannot answer', () => {
    // 'unknown' means the query failed, not that permission is missing —
    // blocking there would disable voice input on a browser that would allow it.
    expect(reduce(kIdle, { type: 'open', gate: { consent: true, permission: 'unknown' } }))
      .toEqual({ kind: 'starting' });
  });

  it('re-evaluates the gates on retry, so a fresh grant takes effect', () => {
    const blocked = reduce(kIdle, { type: 'open', gate: { consent: true, permission: 'prompt' } });
    expect(reduce(blocked, { type: 'retry', gate: kAllowed })).toEqual({ kind: 'starting' });
  });
});

describe('opening the panel', () => {
  it('does not start recording — the toolbar button is a toggle', () => {
    // A mis-tap on the toolbar would otherwise begin uploading audio, and the
    // panel's round button would mean "stop" on arrival but "start" after a
    // session ended. One thing starts recording, and it is that button.
    expect(reduce(kIdle, { type: 'prepare', gate: kAllowed })).toEqual(kIdle);
  });

  it('surfaces a blocker immediately rather than after a failed tap', () => {
    expect(reduce(kIdle, { type: 'prepare', gate: { consent: false, permission: 'granted' } }))
      .toEqual({ kind: 'blocked', reason: 'consent' });
    expect(reduce(kIdle, { type: 'prepare', gate: { consent: true, permission: 'prompt' } }))
      .toEqual({ kind: 'blocked', reason: 'permission' });
  });

  it('leaves a running session alone', () => {
    // Resolving to idle here would show "finished" while the microphone was
    // still open: only teardown stops capture, and prepare does not tear down.
    for (const state of [
      { kind: 'starting' } as const,
      { kind: 'listening', pending: '在录', level: 0.3 } as const,
      { kind: 'finalizing', pending: '在录', stopped: 'caller' } as const,
    ]) {
      expect({ kind: state.kind, next: reduce(state, { type: 'prepare', gate: kAllowed }) })
        .toEqual({ kind: state.kind, next: state });
    }
  });
});

describe('voice session lifecycle', () => {
  it('runs the ordinary path: open, listen, stop, finalise', () => {
    const listening = run([{ type: 'open', gate: kAllowed }, { type: 'ready' }]);
    expect(listening).toEqual({ kind: 'listening', pending: '', level: 0 });
    expect(isCapturing(listening)).toBe(true);

    const speaking = run([{ type: 'partial', pending: '你好' }, { type: 'level', level: 0.3 }], listening);
    expect(speaking).toEqual({ kind: 'listening', pending: '你好', level: 0.3 });

    const finalizing = reduce(speaking, { type: 'stop', reason: 'silence' });
    expect(finalizing).toEqual({ kind: 'finalizing', pending: '你好', stopped: 'silence' });
    expect(isCapturing(finalizing)).toBe(false);

    expect(reduce(finalizing, { type: 'final' })).toEqual(kIdle);
  });

  it('keeps applying results while finalising', () => {
    // The wait exists precisely so the second pass can revise the tail.
    const finalizing: VoiceState = { kind: 'finalizing', pending: '你好', stopped: 'caller' };
    expect(reduce(finalizing, { type: 'partial', pending: '你好世界' }))
      .toEqual({ kind: 'finalizing', pending: '你好世界', stopped: 'caller' });
  });

  it('goes straight to idle when stopped before any audio flowed', () => {
    expect(reduce({ kind: 'starting' }, { type: 'stop', reason: 'caller' })).toEqual(kIdle);
  });

  it('records why capture ended', () => {
    const listening: VoiceState = { kind: 'listening', pending: 'x', level: 0 };
    for (const reason of ['silence', 'timeout', 'caller'] as const) {
      expect(reduce(listening, { type: 'stop', reason })).toMatchObject({ stopped: reason });
    }
  });
});

describe('voice session invariants', () => {
  it('closes from every state', () => {
    // The keyboard being dismissed must always stop the microphone, whatever
    // the session was doing.
    for (const state of kAllStates) {
      expect(reduce(state, { type: 'close' })).toEqual(kIdle);
    }
  });

  it('never resurrects a closed session from a late callback', () => {
    const late: VoiceEvent[] = [
      { type: 'ready' },
      { type: 'partial', pending: '迟到的结果' },
      { type: 'level', level: 0.9 },
      { type: 'final' },
      { type: 'stop', reason: 'silence' },
    ];
    for (const event of late) {
      expect(reduce(kIdle, event)).toEqual(kIdle);
    }
  });

  it('does not start listening on a ready that arrives after a failure', () => {
    const failed: VoiceState = { kind: 'error', reason: 'microphone' };
    expect(reduce(failed, { type: 'ready' })).toEqual(failed);
  });

  it('only fails out of an active session', () => {
    for (const state of kAllStates) {
      const result = reduce(state, { type: 'fail', reason: 'network' });
      const active = ['starting', 'listening', 'finalizing'].includes(state.kind);
      expect(result).toEqual(active ? { kind: 'error', reason: 'network' } : state);
    }
  });

  it('only blocks out of an active session', () => {
    // Same rule as fail: a late permission result must not drag an idle or
    // already-closed panel into a card the user never asked for.
    for (const state of kAllStates) {
      const result = reduce(state, { type: 'block', reason: 'permission' });
      const active = ['starting', 'listening', 'finalizing'].includes(state.kind);
      expect(result).toEqual(active ? { kind: 'blocked', reason: 'permission' } : state);
    }
  });

  it('reports capture only while listening', () => {
    for (const state of kAllStates) {
      expect(isCapturing(state)).toBe(state.kind === 'listening');
    }
  });

  it('leaves an error in place until an explicit retry', () => {
    const failed: VoiceState = { kind: 'error', reason: 'server' };
    expect(reduce(failed, { type: 'partial', pending: 'x' })).toEqual(failed);
    expect(reduce(failed, { type: 'retry', gate: kAllowed })).toEqual({ kind: 'starting' });
  });
});
