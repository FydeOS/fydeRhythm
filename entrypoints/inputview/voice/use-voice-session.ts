// Wires the pieces of a dictation session together: capture → transport →
// commit cursor → the keyboard's insertText.
//
// The reducer in session.ts owns what may happen; this owns the side effects
// that go with it. Everything here is deliberately thin — the decisions live in
// the tested modules it calls.

import { useCallback, useEffect, useRef, useState } from 'react';

import { type CaptureHandle, MicPermissionError, startCapture } from './audio';
import { advanceCommit, type CommitState, kInitialCommit } from './commit-cursor';
import { readCredentials } from './credentials';
import { pushLevel } from './panel-model';
import { micPermission, watchMicPermission } from './permission';
import type { AsrUtterance } from './protocol';
import { kIdle, reduce, type VoiceErrorReason, type VoiceEvent, type VoiceGate, type VoiceState } from './session';
import { acquireHeaderRule, type HeaderRuleLease, newSessionIds, openTransport, type Transport, type ZhVariant } from './transport';

/** Level samples kept for the meter — one per 200 ms batch, so ~5 s of history. */
const kLevelHistory = 24;
const kBatchMs = 200;
/** How long to wait for the server's final response after the last audio packet.
 *
 *  The API doc puts the non-streaming pass at 300–400 ms for five seconds of
 *  audio, so this is generous. Without it a server that never answers leaves the
 *  panel saying "finishing up" for as long as the keyboard is open. */
const kFinalizeTimeoutMs = 5000;

export interface VoiceSessionOptions {
  /** Insert finalised text into the focused field. */
  onCommit: (text: string) => void;
  /** Whether the user has agreed to audio leaving the device. */
  consent: boolean;
  onConsentGiven: () => void;
  /** Stable per-installation id, for Volcano's server-side log filtering. */
  uid: string;
  /** Set when Rime is emitting traditional Chinese, so voice output matches. */
  zhVariant?: ZhVariant;
}

export function useVoiceSession(options: VoiceSessionOptions) {
  const [state, setState] = useState<VoiceState>(kIdle);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  const capture = useRef<CaptureHandle | null>(null);
  const transport = useRef<Transport | null>(null);
  const cursor = useRef<CommitState>(kInitialCommit);
  /** The last cumulative utterance list the server sent. bigmodel_async only
   *  emits a packet when something CHANGED, so an empty one means "no change" —
   *  reading it as "the transcript is now empty" would blank the panel, and on
   *  the final packet would discard the tail that was about to be flushed. */
  const snapshot = useRef<AsrUtterance[] | undefined>(undefined);
  /** Characters already inserted this session; gates the safe auto-retry. */
  const committed = useRef(0);
  const retried = useRef(0);
  /** Audio captured before the socket was ready, replayed in order once it is.
   *  Everything goes here until onReady drains it: the transport exists from the
   *  moment the socket starts connecting, so switching to it on assignment would
   *  put newer audio — and a stop's final packet — ahead of this backlog. */
  const queued = useRef<Int16Array[]>([]);
  const ready = useRef(false);
  /** Stop requested before the transport existed, so the final packet — the one
   *  that makes the server emit its last sentence — is not silently dropped. */
  const endPending = useRef(false);
  /** The microphone is no longer collecting — the user tapped stop, or capture
   *  ended by itself. Kept here rather than read off the rendered state because
   *  the retry decision can run in the same React batch as the stop that
   *  precedes it, and would then still see `listening`: measured as a second
   *  startCapture, a microphone reopening on someone who had just stopped. */
  const stopped = useRef(false);
  /** Bumped by every teardown. Each attempt captures the value it started with
   *  and abandons itself if it no longer matches: without this, a start() that
   *  is awaiting permission or capture when the panel closes goes on to open a
   *  microphone that nothing will ever close. */
  const generation = useRef(0);
  // Effects read the latest state without re-subscribing to it.
  const current = useRef<VoiceState>(kIdle);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const dispatch = useCallback((event: VoiceEvent) => {
    setState((previous) => {
      const next = reduce(previous, event);
      current.current = next;
      return next;
    });
  }, []);

  const teardown = useCallback(() => {
    generation.current++;
    void capture.current?.stop();
    capture.current = null;
    transport.current?.close();
    transport.current = null;
    cursor.current = kInitialCommit;
    snapshot.current = undefined;
    queued.current = [];
    ready.current = false;
    endPending.current = false;
    stopped.current = false;
    setElapsedMs(0);
    setLevels([]);
  }, []);

  const close = useCallback(() => {
    teardown();
    dispatch({ type: 'close' });
  }, [dispatch, teardown]);

  const start = useCallback(async (granted?: Partial<VoiceGate>) => {
    const credentials = readCredentials();
    if (!credentials) return;
    committed.current = 0;

    // Everything below awaits, and the panel can close during any of it.
    const mine = ++generation.current;
    const current$ = () => generation.current === mine;

    const gate: VoiceGate = {
      consent: optionsRef.current.consent,
      permission: await micPermission(),
      ...granted,
    };
    if (!current$()) return;
    dispatch({ type: 'open', gate });
    if (!gate.consent || (gate.permission !== 'granted' && gate.permission !== 'unknown')) return;

    let rule: HeaderRuleLease | undefined;
    try {
      // Open the microphone BEFORE the socket. Building the connection takes a
      // TLS handshake plus a parameters frame, and audio that arrives during it
      // is audio the user already spoke — waiting for the socket first clips
      // their opening words. Packets queue locally until the socket is up.
      const handle = await startCapture({
        // Capture setup awaits too, and only this lets it stop before the
        // microphone is opened for a panel that has already gone.
        cancelled: () => !current$(),
        onBatch: (pcm) => {
          if (!current$()) return;
          if (ready.current) void transport.current?.sendAudio(pcm);
          else queued.current.push(pcm);
        },
        onLevel: (rms) => {
          if (!current$()) return;
          setLevels(history => pushLevel(history, rms, kLevelHistory));
          setElapsedMs(ms => ms + kBatchMs);
        },
        onEnd: (reason) => {
          // A previous attempt's capture can end long after this one began; its
          // stop must not flush or fail the session that replaced it.
          if (!current$()) return;
          stopped.current = true;
          if (reason === 'error') {
            teardown();
            dispatch({ type: 'fail', reason: 'microphone' });
            return;
          }
          // Flush the server: an empty final packet is what makes it emit the
          // last definite sentence rather than waiting for more audio. If the
          // transport is not up yet, remember to send it once it is.
          if (ready.current) void transport.current?.sendAudio(new Int16Array(0), true);
          else endPending.current = true;
          dispatch({ type: 'stop', reason });
        },
      });
      // The panel may have closed while the microphone was being acquired.
      if (!current$()) {
        void handle.stop();
        return;
      }
      capture.current = handle;
      // Recording has started, so say so — the socket is an implementation
      // detail the user is not waiting on.
      dispatch({ type: 'ready' });

      const ids = newSessionIds();
      rule = await acquireHeaderRule(credentials, ids);
      if (!current$()) {
        rule.release();
        return;
      }

      const failTransport = (reason: VoiceErrorReason) => {
        if (!current$()) return;
        // Restarting is only appropriate while the user is still talking. Once
        // capture has ended, reopening the microphone after a late network
        // failure would record again without a new intent.
        const retryablePhase = !stopped.current;
        teardown();
        // Retrying is only safe before anything has been inserted. Once text
        // is in the user's document a fresh session would start its cursor at
        // zero and commit the same sentences again. A rejected key is never
        // retried: the second handshake fails identically, and the fix lives
        // on the options page.
        if (reason !== 'auth' && retryablePhase && committed.current === 0 && retried.current === 0) {
          retried.current = 1;
          void start();
          return;
        }
        dispatch({ type: 'fail', reason });
      };

      transport.current = openTransport({
        uid: optionsRef.current.uid,
        zhVariant: optionsRef.current.zhVariant,
        headerRuleLease: rule,
        callbacks: {
          onReady: () => {
            if (!current$()) return;
            // Ordered by the transport's own send queue, so the backlog lands
            // ahead of whatever the microphone produces next.
            for (const pcm of queued.current) void transport.current?.sendAudio(pcm);
            queued.current = [];
            ready.current = true;
            // A stop that arrived before the socket did.
            if (endPending.current) {
              endPending.current = false;
              void transport.current?.sendAudio(new Int16Array(0), true);
            }
          },
          onResult: (result, last) => {
            if (!current$()) return;
            if (result?.utterances) snapshot.current = result.utterances;
            else if (!last) return;
            const outcome = advanceCommit(cursor.current, snapshot.current, { flush: last });
            cursor.current = outcome.state;
            if (outcome.commit) {
              committed.current += outcome.commit.length;
              optionsRef.current.onCommit(outcome.commit);
            }
            dispatch({ type: 'partial', pending: outcome.pending });
            if (last) {
              teardown();
              dispatch({ type: 'final' });
            }
          },
          onError: (reason) => {
            failTransport(reason);
          },
          onClosed: () => {
            if (!current$()) return;
            // A close during either active network phase is the far end going
            // away. Finalizing uses the same error path but is not retryable.
            if (current.current.kind === 'listening' || current.current.kind === 'finalizing') {
              failTransport('network');
            }
          },
        },
      });
    }
    catch (error) {
      // A failure here leaves no transport for teardown to close the rule with.
      rule?.release();
      if (!current$()) return;
      const captureBegan = capture.current !== null;
      teardown();
      // A prompt raised into an IME window is dismissed unseen, so this is not
      // a broken device and a retry would fail identically. It routes to the
      // options page — the only place that can actually ask.
      if (error instanceof MicPermissionError) {
        dispatch({ type: 'block', reason: 'permission' });
        return;
      }
      // NotFoundError, NotReadableError, AbortError: the microphone really is
      // unusable, and retrying is a reasonable thing to offer. A failure past
      // capture — the header rule, the socket — is not the microphone's fault.
      dispatch({ type: 'fail', reason: captureBegan ? 'network' : 'microphone' });
    }
  }, [dispatch, teardown]);

  const stop = useCallback(() => {
    // Recorded before the capture layer gets a chance to end asynchronously: a
    // socket failure in between must not be read as "still talking".
    stopped.current = true;
    void capture.current?.stop();
  }, []);

  /** Panel opened: surface a missing consent or grant straight away, but do not
   *  touch the microphone until the user asks for it. */
  const prepare = useCallback(async () => {
    if (!readCredentials()) return;
    dispatch({
      type: 'prepare',
      gate: { consent: optionsRef.current.consent, permission: await micPermission() },
    });
  }, [dispatch]);

  const consent = useCallback(() => {
    optionsRef.current.onConsentGiven();
    // The App's state update is scheduled, not applied, so optionsRef still
    // holds consent: false — starting without saying so would show the consent
    // card again and cost the user a second tap on their very first use.
    void start({ consent: true });
  }, [start]);

  // A server that never answers must not strand the panel in "finishing up".
  useEffect(() => {
    if (state.kind !== 'finalizing') return;
    const timer = setTimeout(() => {
      // An unconfirmed tail is dropped rather than guessed, so whether this is a
      // failure depends on whether there was one. With nothing pending, every
      // definite sentence is already in the document and the session did finish;
      // reporting a network error there would invent a loss. Read from the ref
      // rather than the closure so a partial that arrived while finalizing
      // counts, without restarting the deadline on every packet.
      const pending = current.current.kind === 'finalizing' ? current.current.pending : '';
      teardown();
      dispatch(pending === '' ? { type: 'final' } : { type: 'fail', reason: 'network' });
    }, kFinalizeTimeoutMs);
    return () => clearTimeout(timer);
  }, [state.kind, dispatch, teardown]);

  // A grant revoked mid-session must stop the microphone at once rather than
  // surfacing as a failure on the next attempt.
  useEffect(() => watchMicPermission((permission) => {
    if (permission !== 'granted' && current.current.kind !== 'idle') close();
  }), [close]);

  // The keyboard going away always ends the session — the one invariant that
  // must not depend on any code path being reached.
  useEffect(() => {
    const onHidden = () => { if (document.hidden) close(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      teardown();
    };
  }, [close, teardown]);

  return {
    state,
    elapsedMs,
    levels,
    prepare: () => { void prepare(); },
    open: () => { retried.current = 0; void start(); },
    retry: () => { retried.current = 0; void start(); },
    consent,
    stop,
    close,
  };
}
