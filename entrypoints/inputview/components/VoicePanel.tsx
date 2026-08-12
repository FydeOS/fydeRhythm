import React, { useEffect, useRef, useState } from 'react';

import { kDefaultPressTiming } from '../gestures/press';
import { t } from '../i18n';
import { kMaxSessionMs } from '../voice/capture-policy';
import type { CredentialSource } from '../voice/credentials';
import { formatElapsed, meterBars } from '../voice/panel-model';
import type { VoiceErrorReason, VoiceState } from '../voice/session';
import { BackspaceOutlineIcon, ErrorIcon, KeyboardIcon, MicIcon, SettingsIcon, StopIcon } from './icons';

/** Bars in the level meter. Enough to read as a moving waveform, few enough to
 *  stay legible on a floating keyboard scaled to 0.55. */
const kMeterBars = 24;

const kErrorMessages: Record<VoiceErrorReason, string> = {
  microphone: 'vk_voice_error_microphone',
  network: 'vk_voice_error_network',
  auth: 'vk_voice_error_auth',
  quota: 'vk_voice_error_quota',
  server: 'vk_voice_error_server',
  unknown: 'vk_voice_error_unknown',
};

/** A user can replace their own key; ours they can only sign in for again. */
function refusalBody(reason: VoiceErrorReason, source: CredentialSource): string {
  if (reason === 'quota') return 'vk_voice_error_quota_body';
  return source === 'gateway' ? 'vk_voice_error_signin_body' : 'vk_voice_error_auth_body';
}

export interface VoicePanelProps {
  state: VoiceState;
  /** Which credential this session used, so a refusal can name the fix. */
  source?: CredentialSource;
  /** Audio captured so far, from the batches rather than a clock. */
  elapsedMs: number;
  /** Recent batch RMS values, oldest first. */
  levels: readonly number[];
  onStop: () => void;
  /** One backspace into the focused field. The panel covers the key grid, so
   *  without it a misrecognised word cannot be fixed without leaving. */
  onBackspace: () => void;
  /** Begin a session — from an idle panel, which is where a finished one
   *  lands. Without it the panel is a dead end after the first dictation. */
  onStart: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
  onBack: () => void;
}

function Card({ icon, title, body, actions }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="kb-voice-card">
      <div className="kb-voice-card-icon" aria-hidden="true">{icon}</div>
      <div className="kb-voice-card-title">{title}</div>
      <div className="kb-voice-card-body">{body}</div>
      <div className="kb-voice-card-actions">{actions}</div>
    </div>
  );
}

/** A panel button that presses like a key.
 *
 *  `.pressed` comes from pointer events rather than `:active` for the same
 *  reason Key does it: on a touchscreen `:active` fires late or not at all, and
 *  a control that does not visibly react is the whole complaint. The visual
 *  language is the board's — fill, hairline dropped, scale(0.98) — because a
 *  second press language on the same surface reads as a different app. */
function PressButton({ className, onRepeatPress, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Hold-to-repeat action on the keyboard's backspace timing. Like the key
   *  grid, a repeating control activates on pointer-down, not release. */
  onRepeatPress?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const delay = useRef<number | null>(null);
  const repeat = useRef<number | null>(null);
  const clear = () => {
    if (delay.current !== null) window.clearTimeout(delay.current);
    if (repeat.current !== null) window.clearInterval(repeat.current);
    delay.current = null;
    repeat.current = null;
  };
  useEffect(() => clear, []);
  const release = () => {
    setPressed(false);
    clear();
  };
  return (
    <button
      className={`${className}${pressed ? ' pressed' : ''}`}
      onPointerDown={() => {
        setPressed(true);
        if (!onRepeatPress) return;
        onRepeatPress();
        delay.current = window.setTimeout(() => {
          repeat.current = window.setInterval(onRepeatPress, kDefaultPressTiming.repeatIntervalMs);
        }, kDefaultPressTiming.repeatInitialMs);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onContextMenu={event => event.preventDefault()}
      {...rest}
    >
      {children}
    </button>
  );
}

function LevelMeter({ levels }: { levels: readonly number[] }) {
  return (
    <div className="kb-voice-meter" aria-hidden="true">
      {meterBars(levels, kMeterBars).map((level, index) => (
        <span
          key={index}
          className="kb-voice-meter-bar"
          style={{ '--level': level } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export function VoicePanel(props: VoicePanelProps) {
  const { state, onBack } = props;
  const transcript = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const pendingText = state.kind === 'listening' || state.kind === 'finalizing' ? state.pending : '';

  // Keep the newest words in view. Recognition revises the tail constantly, so
  // without this a long dictation scrolls its own latest text out of sight.
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    // The fade only means "there is more above". Applied unconditionally it
    // washes out the first line of text that fits perfectly well.
    setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, [pendingText]);

  const back = (
    <button className="kb-voice-action" onClick={onBack}>
      {t('vk_back_to_keyboard')}
    </button>
  );

  if (state.kind === 'blocked') {
    // The keyboard cannot raise Chrome's permission bubble, so the only move
    // available here is to send the user somewhere that can.
    return (
      <div className="kb-voice">
        <Card
          icon={<SettingsIcon />}
          title={t('vk_voice_permission_title')}
          body={t('vk_voice_permission_body')}
          actions={(
            <>
              {back}
              <button className="kb-voice-action primary" onClick={props.onOpenSettings}>
                {t('vk_voice_permission_open')}
              </button>
            </>
          )}
        />
      </div>
    );
  }

  if (state.kind === 'error') {
    // A refusal cannot be fixed from the keyboard, and a retry fails the same
    // way, so this card routes to the options page instead.
    const refused = state.reason === 'auth' || state.reason === 'quota';
    return (
      <div className="kb-voice">
        <Card
          icon={<ErrorIcon />}
          title={t(kErrorMessages[state.reason])}
          body={t(refused ? refusalBody(state.reason, props.source ?? 'own') : 'vk_voice_error_body')}
          actions={(
            <>
              {back}
              {refused
                ? (
                    <button className="kb-voice-action primary" onClick={props.onOpenSettings}>
                      {t('vk_voice_permission_open')}
                    </button>
                  )
                : (
                    <button className="kb-voice-action primary" onClick={props.onRetry}>
                      {t('vk_clipboard_retry')}
                    </button>
                  )}
            </>
          )}
        />
      </div>
    );
  }

  const pending = pendingText;
  const listening = state.kind === 'listening';
  // Idle with the panel open is where a finished dictation lands, so it is a
  // starting point rather than an end state.
  const idle = state.kind === 'idle';
  // The cap is not a surprise the user should discover by being cut off.
  const nearLimit = listening && props.elapsedMs >= kMaxSessionMs - 10_000;
  const status = state.kind === 'starting'
    ? t('vk_voice_connecting')
    : state.kind === 'finalizing'
      ? t('vk_voice_finalizing')
      : idle
        ? t('vk_voice_idle')
        : t('vk_voice_recording');

  return (
    <div className="kb-voice">
      {/* Committed sentences have already gone into the application; what is
          shown here is only the tail still being revised. It is the whole point
          of the panel, so it gets the space and the type size. */}
      <div
        ref={transcript}
        className={`kb-voice-transcript${pending ? '' : ' empty'}${overflowing ? ' overflowing' : ''}`}
        aria-live="polite"
      >
        {pending || (
          <span className="kb-voice-hint">{idle ? t('vk_voice_again') : t('vk_voice_hint')}</span>
        )}
      </div>

      <div className="kb-voice-bottom">
        {/* The panel covers the key grid, so the way back has to live in the
            panel — the toolbar's microphone toggle is too small to find. */}
        <PressButton className="kb-voice-side" aria-label={t('vk_back_to_keyboard')} onClick={onBack}>
          <KeyboardIcon />
        </PressButton>

        {/* Three redundant signals, because prefers-reduced-motion disables the
            pulse with !important — the label and the running timer are text and
            survive it. While listening the dot, the timer and the meter all move,
            so the word is dropped: that is also when the strip is fullest. */}
        <span className={`kb-voice-dot${listening ? ' live' : ''}`} aria-hidden="true" />
        {!listening && <span className="kb-voice-status">{status}</span>}
        {!idle && (
          <span className={`kb-voice-time${nearLimit ? ' near-limit' : ''}`}>
            {formatElapsed(props.elapsedMs)}
            <span className="kb-voice-limit">{` / ${formatElapsed(kMaxSessionMs)}`}</span>
          </span>
        )}

        {/* Only while there is audio to show. An all-zero meter renders as a
            dashed rule, which reads as a broken divider rather than silence. */}
        {listening && props.levels.some(level => level > 0)
          ? <LevelMeter levels={props.levels} />
          : <span className="kb-voice-gap" />}

        <PressButton className="kb-voice-side" aria-label={t('vk_key_backspace')} onRepeatPress={props.onBackspace}>
          <BackspaceOutlineIcon />
        </PressButton>

        <PressButton
          className="kb-voice-action-btn"
          aria-label={listening ? t('vk_voice_stop') : t('vk_voice')}
          onClick={listening ? props.onStop : props.onStart}
          disabled={state.kind === 'starting' || state.kind === 'finalizing'}
        >
          {listening ? <StopIcon /> : <MicIcon />}
        </PressButton>
      </div>
    </div>
  );
}
