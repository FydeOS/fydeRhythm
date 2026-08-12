// @vitest-environment jsdom
//
// The panel is the only surface a user has while dictating, so what matters
// here is which control it offers in each state — the layout audit measures how
// it fits, and the modules under voice/ decide what it says.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoicePanel, type VoicePanelProps } from '../entrypoints/inputview/components/VoicePanel';
import { kDefaultPressTiming } from '../entrypoints/inputview/gestures/press';
import type { VoiceState } from '../entrypoints/inputview/voice/session';

// setup.ts stubs getMessage to echo the key back, which would make every
// assertion here a tautology about key names. Returning nothing instead sends
// t() to the fallback table in i18n.ts — the copy the dev tab actually renders.
beforeEach(() => vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The card's primary action; found by role rather than by copy, which changes. */
function primaryAction(): HTMLButtonElement {
  return document.querySelector('.kb-voice-action.primary') as HTMLButtonElement;
}

function backAction(): HTMLButtonElement {
  return document.querySelector('.kb-voice-action:not(.primary)') as HTMLButtonElement;
}

function draw(state: VoiceState, overrides: Partial<VoicePanelProps> = {}) {
  const handlers = {
    onStop: vi.fn(),
    onStart: vi.fn(),
    onBackspace: vi.fn(),
    onConsent: vi.fn(),
    onOpenSettings: vi.fn(),
    onRetry: vi.fn(),
    onBack: vi.fn(),
  };
  render(
    <VoicePanel
      state={state}
      elapsedMs={12_400}
      levels={[0.02, 0.2, 0.4]}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

/** The single control in the status strip, whatever it currently means. */
function actionButton(): HTMLButtonElement {
  return document.querySelector('.kb-voice-action-btn') as HTMLButtonElement;
}

describe('voice panel controls', () => {
  it('offers stop while listening', () => {
    const handlers = draw({ kind: 'listening', pending: '你好', level: 0.3 });
    fireEvent.click(actionButton());

    expect(handlers.onStop).toHaveBeenCalledOnce();
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('offers start again once a session has finished', () => {
    // Idle with the panel open is where every completed dictation lands. The
    // panel used to render a disabled stop button here, which made it a dead
    // end: no way back to recording without closing and reopening.
    const handlers = draw({ kind: 'idle' });
    const button = actionButton();

    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(handlers.onStart).toHaveBeenCalledOnce();
    expect(handlers.onStop).not.toHaveBeenCalled();
  });

  it('offers a way back to the keyboard from the recording view', () => {
    // The panel covers the key grid; the toolbar toggle is too small to be the
    // only exit, and the cards' back button is not reachable while listening.
    const handlers = draw({ kind: 'listening', pending: '', level: 0.3 });
    fireEvent.click(document.querySelectorAll('.kb-voice-side')[0]);
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it('offers a backspace, the one repair a dictating user needs', () => {
    const handlers = draw({ kind: 'listening', pending: '', level: 0.3 });
    const backspace = document.querySelectorAll('.kb-voice-side')[1];
    // Like the key grid's backspace, it acts on pointer-down, not release.
    fireEvent.pointerDown(backspace);
    fireEvent.pointerUp(backspace);
    expect(handlers.onBackspace).toHaveBeenCalledOnce();
  });

  it('repeats backspace while held, on the key grid’s own timing', () => {
    vi.useFakeTimers();
    try {
      const handlers = draw({ kind: 'listening', pending: '', level: 0.3 });
      const backspace = document.querySelectorAll('.kb-voice-side')[1];
      fireEvent.pointerDown(backspace);
      expect(handlers.onBackspace).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(kDefaultPressTiming.repeatInitialMs + 10 * kDefaultPressTiming.repeatIntervalMs);
      expect(handlers.onBackspace).toHaveBeenCalledTimes(11);
      fireEvent.pointerUp(backspace);
      vi.advanceTimersByTime(1000);
      expect(handlers.onBackspace).toHaveBeenCalledTimes(11);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('disables the control while connecting and while finalising', () => {
    for (const state of [
      { kind: 'starting' } as const,
      { kind: 'finalizing', pending: 'x', stopped: 'silence' } as const,
    ]) {
      cleanup();
      draw(state);
      expect(actionButton().disabled, state.kind).toBe(true);
    }
  });
});

describe('voice panel press feedback', () => {
  it('marks a pressed control, rather than leaning on :active', () => {
    // :active fires late or not at all under a finger, which is why Key drives
    // its own class — a control that does not visibly react is the complaint.
    draw({ kind: 'listening', pending: '', level: 0.3 });
    const button = actionButton();

    expect(button.className).not.toContain('pressed');
    fireEvent.pointerDown(button);
    expect(button.className).toContain('pressed');
    fireEvent.pointerUp(button);
    expect(button.className).not.toContain('pressed');
  });

  it('releases when the finger slides off instead of sticking down', () => {
    draw({ kind: 'listening', pending: '', level: 0.3 });
    const button = actionButton();

    fireEvent.pointerDown(button);
    fireEvent.pointerLeave(button);
    expect(button.className).not.toContain('pressed');

    fireEvent.pointerDown(button);
    fireEvent.pointerCancel(button);
    expect(button.className).not.toContain('pressed');
  });

  it('gives the side keys the same press as the main action', () => {
    draw({ kind: 'listening', pending: '', level: 0.3 });
    const sideKeys = Array.from(document.querySelectorAll('.kb-voice-side'));
    expect(sideKeys).toHaveLength(2);
    for (const key of sideKeys) {
      fireEvent.pointerDown(key);
      expect(key.className).toContain('pressed');
      fireEvent.pointerUp(key);
    }
  });
});

describe('voice panel states', () => {
  it('shows the live transcript, not the committed text', () => {
    draw({ kind: 'listening', pending: '还没有定稿的部分', level: 0.3 });
    expect(screen.getByText('还没有定稿的部分')).toBeTruthy();
  });

  it('keeps showing the tail while finalising', () => {
    draw({ kind: 'finalizing', pending: '最后半句', stopped: 'caller' });
    expect(screen.getByText('最后半句')).toBeTruthy();
  });

  it('fades the top edge only when text is actually out of view', () => {
    // jsdom reports zero heights, so nothing overflows — which is exactly the
    // case that must NOT be faded: an unconditional mask washes out the first
    // line of a transcript that fits.
    draw({ kind: 'listening', pending: '短短一句', level: 0.3 });
    expect(document.querySelector('.kb-voice-transcript')?.className)
      .not.toContain('overflowing');
  });

  it('draws the level meter only while audio is flowing', () => {
    draw({ kind: 'listening', pending: '', level: 0.3 });
    expect(document.querySelectorAll('.kb-voice-meter-bar').length).toBeGreaterThan(0);

    cleanup();
    draw({ kind: 'finalizing', pending: '', stopped: 'silence' });
    // An all-zero meter renders as a dashed rule, which reads as a broken
    // divider rather than as silence.
    expect(document.querySelectorAll('.kb-voice-meter-bar')).toHaveLength(0);
  });

  it('marks the recording dot live only while listening', () => {
    draw({ kind: 'listening', pending: '', level: 0.3 });
    expect(document.querySelector('.kb-voice-dot.live')).toBeTruthy();

    cleanup();
    draw({ kind: 'idle' });
    expect(document.querySelector('.kb-voice-dot.live')).toBeNull();
  });

  it('hides the timer when no session is running', () => {
    draw({ kind: 'idle' });
    expect(document.querySelector('.kb-voice-time')).toBeNull();
  });

  it('states the session cap next to the elapsed time', () => {
    // The 60 s ceiling stops recording on its own; a user who never saw it
    // coming reads that as the feature breaking.
    draw({ kind: 'listening', pending: '', level: 0 });
    expect(document.querySelector('.kb-voice-time')?.textContent).toBe('0:12 / 1:00');
  });

  it('emphasises the timer in the last ten seconds', () => {
    draw({ kind: 'listening', pending: '', level: 0 }, { elapsedMs: 45_000 });
    expect(document.querySelector('.kb-voice-time.near-limit')).toBeNull();

    cleanup();
    draw({ kind: 'listening', pending: '', level: 0 }, { elapsedMs: 52_000 });
    expect(document.querySelector('.kb-voice-time.near-limit')).toBeTruthy();
  });

  it('drops the status word only while listening, when three things already move', () => {
    // The dot pulses, the timer runs and the meter moves — and the strip is at
    // its fullest. In every other state none of those move, so the word stays.
    draw({ kind: 'listening', pending: '', level: 0 });
    expect(document.querySelector('.kb-voice-status')).toBeNull();

    for (const state of [
      { kind: 'starting' } as const,
      { kind: 'finalizing', pending: '', stopped: 'silence' } as const,
      { kind: 'idle' } as const,
    ]) {
      cleanup();
      draw(state);
      expect(document.querySelector('.kb-voice-status')?.textContent, state.kind).toBeTruthy();
    }
  });
});

describe('voice panel cards', () => {
  it('asks for consent before anything else, and names who receives the audio', () => {
    const handlers = draw({ kind: 'blocked', reason: 'consent' });
    // Chrome's own prompt covers the microphone, not where the audio goes, so
    // the recipient has to be named here.
    expect(screen.getByText(/火山引擎/)).toBeTruthy();

    fireEvent.click(primaryAction());
    expect(handlers.onConsent).toHaveBeenCalledOnce();
  });

  it('routes a missing grant to the options page, the only place that can prompt', () => {
    const handlers = draw({ kind: 'blocked', reason: 'permission' });
    fireEvent.click(primaryAction());

    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
    // Never a getUserMedia call from here: the bubble cannot be shown in an IME
    // window and would be auto-dismissed, leaving a button that does nothing.
    expect(actionButton()).toBeNull();
  });

  it('offers a retry on failure and says the keyboard still works', () => {
    const handlers = draw({ kind: 'error', reason: 'network' });
    expect(screen.getByText('网络连接中断')).toBeTruthy();
    expect(screen.getByText('可以先用键盘继续输入。')).toBeTruthy();

    fireEvent.click(primaryAction());
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it('routes a rejected key to the options page instead of a doomed retry', () => {
    const handlers = draw({ kind: 'error', reason: 'auth' });
    expect(screen.getByText('语音服务拒绝了连接')).toBeTruthy();
    expect(screen.getByText('请在设置页检查 API Key。')).toBeTruthy();

    fireEvent.click(primaryAction());
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
    // A retry must fail the same way until the key is fixed over there.
    expect(handlers.onRetry).not.toHaveBeenCalled();
  });

  it('names the failure rather than reporting a generic error', () => {
    const seen = new Set<string>();
    for (const reason of ['microphone', 'network', 'auth', 'server', 'unknown'] as const) {
      cleanup();
      draw({ kind: 'error', reason });
      seen.add(document.querySelector('.kb-voice-card-title')?.textContent ?? '');
    }
    // 'permission' deliberately shares the microphone wording; the other five
    // must stay distinguishable.
    expect(seen.size).toBe(5);
  });

  it('lets every card get back to the keyboard', () => {
    for (const state of [
      { kind: 'blocked', reason: 'consent' } as const,
      { kind: 'blocked', reason: 'permission' } as const,
      { kind: 'error', reason: 'server' } as const,
    ]) {
      cleanup();
      const handlers = draw(state);
      fireEvent.click(backAction());
      expect(handlers.onBack, JSON.stringify(state)).toHaveBeenCalledOnce();
    }
  });
});
