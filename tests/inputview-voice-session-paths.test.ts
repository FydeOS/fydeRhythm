// Every path through the session reducer, enumerated rather than sampled.
//
// `reduce` is pure, so the whole transition table can be computed and checked:
// six states against ten events is sixty transitions, and the individual tests
// elsewhere cover perhaps a dozen of them. What this file is for is the ones
// nobody thought to write — a stale socket callback landing on a blocked panel,
// a `ready` after a failure, a `stop` while already finalizing. Those arrive in
// practice because every source of these events is asynchronous.
//
// The invariants below are the properties the side-effecting layer relies on. A
// snapshot of the full table follows them, so any deliberate change to a
// transition shows up as a reviewable diff rather than passing unnoticed.

import { describe, expect, it } from 'vitest';

import {
  isCapturing,
  kIdle,
  reduce,
  type VoiceEvent,
  type VoiceState,
} from '../entrypoints/inputview/voice/session';

/** One representative of every state kind. */
const kStates: Array<[string, VoiceState]> = [
  ['idle', kIdle],
  ['blocked', { kind: 'blocked' }],
  ['starting', { kind: 'starting' }],
  ['listening', { kind: 'listening', pending: '半句', level: 0.4 }],
  ['finalizing', { kind: 'finalizing', pending: '半句', stopped: 'silence' }],
  ['error', { kind: 'error', reason: 'network' }],
];

/** Every event kind, with a grant in place so `open`/`retry`/`prepare` are
 *  exercised on their permissive path; the blocked paths are covered below. */
const kEvents: Array<[string, VoiceEvent]> = [
  ['prepare', { type: 'prepare', permission: 'granted' }],
  ['open', { type: 'open', permission: 'granted' }],
  ['retry', { type: 'retry', permission: 'granted' }],
  ['ready', { type: 'ready' }],
  ['partial', { type: 'partial', pending: '新的' }],
  ['level', { type: 'level', level: 0.9 }],
  ['stop', { type: 'stop', reason: 'silence' }],
  ['final', { type: 'final' }],
  ['block', { type: 'block' }],
  ['fail', { type: 'fail', reason: 'server' }],
];

const kActive = new Set(['starting', 'listening', 'finalizing']);

function table(): Record<string, Record<string, string>> {
  const rows: Record<string, Record<string, string>> = {};
  for (const [stateName, state] of kStates) {
    rows[stateName] = {};
    for (const [eventName, event] of kEvents) {
      rows[stateName][eventName] = reduce(state, event).kind;
    }
  }
  return rows;
}

describe('the reducer over every state and event', () => {
  it('never produces a state outside the declared kinds', () => {
    const kinds = new Set(kStates.map(([name]) => name));
    for (const [, state] of kStates) {
      for (const [, event] of kEvents) {
        expect(kinds.has(reduce(state, event).kind)).toBe(true);
      }
    }
  });

  it('closes from every state, including ones that never started', () => {
    // The one invariant that must not depend on any other code path being
    // reached: the keyboard going away ends the session.
    for (const [, state] of kStates) {
      expect(reduce(state, { type: 'close' })).toEqual(kIdle);
    }
  });

  it('only ever captures while listening', () => {
    for (const [, state] of kStates) {
      for (const [, event] of kEvents) {
        const next = reduce(state, event);
        expect(isCapturing(next)).toBe(next.kind === 'listening');
      }
    }
  });

  it('enters listening only from starting, and only on ready', () => {
    // Otherwise a late `ready` from an abandoned attempt reopens the panel over
    // a failure the user has already been shown. Remaining in listening is not
    // entering it, so only transitions that change the kind are examined.
    for (const [stateName, state] of kStates) {
      if (state.kind === 'listening') continue;
      for (const [eventName, event] of kEvents) {
        if (reduce(state, event).kind !== 'listening') continue;
        expect({ stateName, eventName }).toEqual({ stateName: 'starting', eventName: 'ready' });
      }
    }
  });

  it('fails and blocks only out of an active session', () => {
    for (const [stateName, state] of kStates) {
      for (const type of ['fail', 'block'] as const) {
        const event = (type === 'fail'
          ? { type, reason: 'server' as const }
          : { type, reason: 'permission' as const });
        const next = reduce(state, event);
        const moved = next.kind !== state.kind || next !== state;
        if (!kActive.has(stateName)) expect({ stateName, type, moved }).toEqual({ stateName, type, moved: false });
        else expect(next.kind).toBe(type === 'fail' ? 'error' : 'blocked');
      }
    }
  });

  it('leaves every settled state untouched by a stray session event', () => {
    // idle/blocked/error are where a stale capture or socket callback lands
    // after teardown. Each must be inert there, by identity — a new object with
    // the same kind would still re-render the panel.
    for (const stateName of ['idle', 'blocked', 'error']) {
      const state = kStates.find(([name]) => name === stateName)![1];
      for (const type of ['ready', 'partial', 'level', 'stop', 'final'] as const) {
        const event = kEvents.find(([name]) => name === type)![1];
        expect({ stateName, type, same: reduce(state, event) === state })
          .toEqual({ stateName, type, same: true });
      }
    }
  });

  it('routes a missing grant to a blocked card from anywhere it can start', () => {
    for (const type of ['prepare', 'open', 'retry'] as const) {
      expect(reduce(kIdle, { type, permission: 'denied' })).toEqual({ kind: 'blocked' });
    }
  });

  it('cannot restart an active session out from under its own capture', () => {
    // `prepare` fires whenever the panel opens, and the panel can be reopened
    // while a session runs. Dropping to idle there would leave the microphone
    // open with the UI claiming the session had finished.
    for (const stateName of kActive) {
      const state = kStates.find(([name]) => name === stateName)![1];
      expect(reduce(state, { type: 'prepare', permission: 'granted' })).toBe(state);
    }
  });

  it('holds the whole transition table', () => {
    expect(table()).toMatchInlineSnapshot(`
      {
        "blocked": {
          "block": "blocked",
          "fail": "blocked",
          "final": "blocked",
          "level": "blocked",
          "open": "starting",
          "partial": "blocked",
          "prepare": "idle",
          "ready": "blocked",
          "retry": "starting",
          "stop": "blocked",
        },
        "error": {
          "block": "error",
          "fail": "error",
          "final": "error",
          "level": "error",
          "open": "starting",
          "partial": "error",
          "prepare": "idle",
          "ready": "error",
          "retry": "starting",
          "stop": "error",
        },
        "finalizing": {
          "block": "blocked",
          "fail": "error",
          "final": "idle",
          "level": "finalizing",
          "open": "starting",
          "partial": "finalizing",
          "prepare": "finalizing",
          "ready": "finalizing",
          "retry": "starting",
          "stop": "finalizing",
        },
        "idle": {
          "block": "idle",
          "fail": "idle",
          "final": "idle",
          "level": "idle",
          "open": "starting",
          "partial": "idle",
          "prepare": "idle",
          "ready": "idle",
          "retry": "starting",
          "stop": "idle",
        },
        "listening": {
          "block": "blocked",
          "fail": "error",
          "final": "listening",
          "level": "listening",
          "open": "starting",
          "partial": "listening",
          "prepare": "listening",
          "ready": "listening",
          "retry": "starting",
          "stop": "finalizing",
        },
        "starting": {
          "block": "blocked",
          "fail": "error",
          "final": "starting",
          "level": "starting",
          "open": "starting",
          "partial": "starting",
          "prepare": "starting",
          "ready": "listening",
          "retry": "starting",
          "stop": "idle",
        },
      }
    `);
  });
});
