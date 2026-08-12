import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import React, { useEffect, useRef, useState } from 'react';

import { $$ } from '@/lib/utils';

import {
  credentialsFrom,
  type CredentialSource,
  kVoiceOffered,
  readStoredCredentials,
  type StoredCredentials,
  writeStoredCredentials,
} from '../inputview/voice/credentials';
import { signIn } from '../inputview/voice/signin';
import { useMicPermission } from '../inputview/voice/use-mic-permission';
import { type KeyVerdict, verifyCredentials } from '../inputview/voice/verify';
import styles from './styles.module.less';

/** Raises the prompt; the watcher reports the answer. */
async function request(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Holding it open would leave the recording indicator on for this tab.
    stream.getTracks().forEach(track => track.stop());
  }
  catch { /* nothing to read here */ }
}

/** Voice input's settings, and — more importantly — the only place in this
 *  extension where the microphone can actually be granted.
 *
 *  Extensions cannot declare `audioCapture` (Chrome reserves it for platform
 *  apps) and an IME window cannot display a permission bubble, so the grant has
 *  to be made from a page that can: this one, which is an ordinary tab. Turning
 *  the switch on is what asks for it, because "enable voice input" is the
 *  intent the user actually has — being sent here to perform a permission
 *  errand is not. The switch never waits on the answer: an unanswered bubble
 *  leaves getUserMedia pending forever, with no rejection and no timeout. */
export function VoiceSection({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const mic = useMicPermission();
  // Both sources at once: switching is then local, with nothing to re-fetch.
  const [record, setRecord] = useState<StoredCredentials | null>(null);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<KeyVerdict | 'checking' | null>(null);
  // Verification is async and removing one key can be followed immediately by
  // saving another — or by switching source. Only the newest user action may
  // publish a verdict.
  const verificationRequest = useRef(0);

  useEffect(() => {
    void readStoredCredentials().then(setRecord);
  }, []);

  const source = record?.source ?? 'own';
  const field = source === 'gateway' ? 'gatewayToken' : 'apiKey';
  // Enter-once, then locked: after saving, the credential is never echoed back
  // into the page — only its tail, for recognition. Changing it means removing
  // it and entering a new one, like every service that issues keys.
  const saved = record?.[field] ?? '';
  const locked = saved !== '';

  const update = async (change: Partial<StoredCredentials>) => {
    setRecord(current => (current ? { ...current, ...change } : current));
    await writeStoredCredentials(change);
  };

  const pick = async (next: CredentialSource) => {
    if (next === source) return;
    // The other source's verdict says nothing about this one.
    ++verificationRequest.current;
    setVerdict(null);
    setDraft('');
    await update({ source: next });
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const requestId = ++verificationRequest.current;
    await update({ [field]: trimmed });
    if (requestId !== verificationRequest.current) return;
    setDraft('');
    // Saving is never blocked on the check: a key entered offline still keeps.
    setVerdict('checking');
    const credentials = credentialsFrom(source, trimmed);
    // Null: this source cannot connect in this build, so nothing to blame on
    // the network.
    const result = credentials
      ? await verifyCredentials(credentials).catch((): KeyVerdict => 'unreachable')
      : 'invalid' as KeyVerdict;
    if (requestId === verificationRequest.current) setVerdict(result);
  };
  const removeKey = async () => {
    const requestId = ++verificationRequest.current;
    // Clearing the token clears whose it was: a stale name on the next sign-in
    // screen would name an account that is no longer connected.
    await update(source === 'gateway' ? { gatewayToken: '', gatewayAccount: '' } : { apiKey: '' });
    if (requestId !== verificationRequest.current) return;
    setVerdict(null);
  };

  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const startSignIn = async () => {
    setSigningIn(true);
    setSignInFailed(false);
    const result = await signIn();
    setSigningIn(false);
    // Cancelling is a decision, not an error.
    if (!result.ok) {
      setSignInFailed(result.reason === 'failed');
      return;
    }
    ++verificationRequest.current;
    setVerdict(null);
    // The exchange only succeeds against a live session; no verification needed.
    await update({ gatewayToken: result.token, gatewayAccount: result.name ?? '' });
  };

  const toggle = (next: boolean) => {
    onChange(next);
    if (next && mic !== 'granted') void request();
  };

  return (
    <div className={styles.formGroup}>
      <div className={styles.formBox} style={{ padding: '8px 0' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2.5 }}>
          <Box>
            <Box component="h2" sx={{ m: 0, fontSize: '15px', fontWeight: 600, color: 'text.primary', letterSpacing: '-0.01em' }}>
              {$$('voice_input')}
            </Box>
            <Box sx={{ mt: 0.5, fontSize: '13px', color: 'text.secondary', maxWidth: 560 }}>
              {$$('voice_input_desc')}
            </Box>
            {/* Reference rather than decision: what the switch costs belongs
                above, what it can hear belongs here. */}
            <Box sx={{ mt: 0.5, fontSize: '12px', color: 'text.disabled', maxWidth: 560 }}>
              {$$('voice_input_langs')}
            </Box>
          </Box>
          <Switch
            checked={enabled}
            onChange={event => toggle(event.target.checked)}
            // MUI 7 drops inputProps, and slotProps replaces the defaults.
            slotProps={{ input: { 'role': 'switch', 'aria-label': $$('voice_input') } }}
          />
        </Box>

        {enabled && mic !== 'granted' && (
          <Box sx={{ px: 4, pb: 2.5 }}>
            {/* No retry once denied: no prompt will ever appear again there. */}
            <Alert
              severity={mic === 'denied' ? 'error' : 'warning'}
              action={mic === 'denied'
                ? undefined
                : (
                    <Button color="inherit" size="small" onClick={() => void request()}>
                      {$$('voice_mic_retry')}
                    </Button>
                  )}
            >
              {mic === 'denied' ? $$('voice_mic_denied') : $$('voice_mic_needed')}
            </Alert>
          </Box>
        )}

        {/* Setup appears once the feature is on: progressive disclosure, and
            a keyless build's first run reads switch → key → dictate. */}
        {enabled && (
          <>
            <Box sx={{ height: '1px', bgcolor: 'divider', mx: 4 }} />
            <Box sx={{ px: 4, py: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box>
                <Box component="h3" sx={{ m: 0, fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>
                  {$$('voice_key_title')}
                </Box>
                <Box sx={{ mt: 0.5, fontSize: '12px', color: 'text.disabled', maxWidth: 560 }}>
                  {source === 'gateway' ? $$('voice_key_desc_gateway') : $$('voice_key_desc')}
                </Box>
              </Box>
              {/* A picker with one option is furniture. */}
              {kVoiceOffered && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={source}
                  onChange={(_, next: CredentialSource | null) => next && void pick(next)}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  <ToggleButton value="gateway">
                    {$$('voice_key_source_gateway')}
                  </ToggleButton>
                  <ToggleButton value="own">
                    {$$('voice_key_source_own')}
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
              {/* Our own service asks for no credential: the token behind it is
                  ours to fetch, and nobody outside this repo can obtain one. */}
              {source === 'gateway'
                ? (
                    // Same geometry as the key form below: the status fills the
                    // row and the action keeps the right edge, so the button
                    // sits in one place whatever the account is called.
                    <>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                        <Box
                          // The visible text may be cut short; the tooltip is not.
                          title={locked ? record?.gatewayAccount : undefined}
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: '13px',
                            color: 'text.secondary',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {locked
                            ? (
                                <>
                                  {$$('voice_key_signed_in_as')}
                                  <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                                    {record?.gatewayAccount || $$('voice_key_signed_in')}
                                  </Box>
                                </>
                              )
                            : $$('voice_key_signed_out')}
                        </Box>
                        {locked
                          ? (
                              <Button variant="outlined" onClick={() => void removeKey()}>
                                {$$('voice_key_signout')}
                              </Button>
                            )
                          : (
                              <Button
                                variant="contained"
                                disableElevation
                                disabled={signingIn}
                                onClick={() => void startSignIn()}
                              >
                                {$$('voice_key_signin')}
                              </Button>
                            )}
                      </Box>
                      {/* Below the row, not inside it: an error must not move
                          the controls it is about. */}
                      {signInFailed && (
                        <Box sx={{ fontSize: '12px', color: 'error.main' }}>
                          {$$('voice_key_signin_failed')}
                        </Box>
                      )}
                    </>
                  )
                : (
                    // Locked and entry states share one geometry: the field keeps
                    // its footprint and the action button its place, so saving or
                    // removing the key never makes the controls jump.
                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <TextField
                        label={$$('voice_key_api')}
                        variant="filled"
                        size="small"
                        type={locked ? 'text' : 'password'}
                        InputProps={{ readOnly: locked }}
                        autoComplete="new-password"
                        spellCheck={false}
                        value={locked ? `············${saved.slice(-4)}` : draft}
                        onChange={event => setDraft(event.target.value)}
                        sx={{ flex: 1, minWidth: 280 }}
                      />
                      {locked
                        ? (
                            <Button variant="outlined" onClick={() => void removeKey()}>
                              {$$('voice_key_remove')}
                            </Button>
                          )
                        : (
                            <Button variant="contained" disableElevation disabled={draft.trim() === ''} onClick={() => void save()}>
                              {$$('voice_key_save')}
                            </Button>
                          )}
                    </Box>
                  )}
              {verdict !== null && (
                <Box sx={{ fontSize: '12px', color: 'text.secondary' }}>
                  {verdict === 'checking' && $$('voice_key_checking')}
                  {verdict === 'valid' && $$('voice_key_valid')}
                  {verdict === 'invalid' && $$('voice_key_invalid')}
                  {verdict === 'unreachable' && $$('voice_key_unreachable')}
                </Box>
              )}
            </Box>
          </>
        )}
      </div>
    </div>
  );
}
