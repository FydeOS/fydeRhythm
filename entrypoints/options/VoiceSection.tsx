import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { $$ } from '@/lib/utils';

import { kDefaultResourceId, readStoredKey, writeStoredKey } from '../inputview/voice/credentials';
import { type KeyVerdict, verifyCredentials } from '../inputview/voice/verify';
import styles from './styles.module.less';

type MicState = 'granted' | 'prompt' | 'denied' | 'unknown';

async function queryMic(): Promise<MicState> {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state as MicState;
  }
  catch {
    return 'unknown';
  }
}

/** Voice input's settings, and — more importantly — the only place in this
 *  extension where the microphone can actually be granted.
 *
 *  Extensions cannot declare `audioCapture` (Chrome reserves it for platform
 *  apps) and an IME window cannot display a permission bubble, so the grant has
 *  to be made from a page that can: this one, which is an ordinary tab. Turning
 *  the switch on is what asks for it, because "enable voice input" is the
 *  intent the user actually has — being sent here to perform a permission
 *  errand is not. */
export function VoiceSection({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [mic, setMic] = useState<MicState>('unknown');
  const [failed, setFailed] = useState(false);
  // Enter-once, then locked: after saving, the key is never echoed back into
  // the page — only its tail, for recognition. Changing it means removing it
  // and entering a new one, like every service that issues keys.
  const [key, setKey] = useState<{ present: boolean; tail: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<KeyVerdict | 'checking' | null>(null);
  // Verification is async and removing one key can be followed immediately by
  // saving another. Only the newest user action may publish a verdict.
  const verificationRequest = useRef(0);

  useEffect(() => {
    void readStoredKey().then((value) => {
      const trimmed = value.trim();
      setKey({ present: trimmed !== '', tail: trimmed.slice(-4) });
    });
  }, []);

  const locked = key?.present === true;
  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const requestId = ++verificationRequest.current;
    await writeStoredKey(trimmed);
    if (requestId !== verificationRequest.current) return;
    setKey({ present: true, tail: trimmed.slice(-4) });
    setDraft('');
    // Saving is never blocked on the check: a key entered offline still keeps.
    setVerdict('checking');
    const result = await verifyCredentials({ apiKey: trimmed, resourceId: kDefaultResourceId })
      .catch((): KeyVerdict => 'unreachable');
    if (requestId === verificationRequest.current) setVerdict(result);
  };
  const removeKey = async () => {
    const requestId = ++verificationRequest.current;
    await writeStoredKey('');
    if (requestId !== verificationRequest.current) return;
    setKey({ present: false, tail: '' });
    setVerdict(null);
  };

  const refresh = useCallback(() => { void queryMic().then(setMic); }, []);
  useEffect(refresh, [refresh]);

  const request = async () => {
    setFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The grant is what was wanted, not the stream; holding it open would
      // leave the recording indicator on for as long as this tab lives.
      stream.getTracks().forEach(track => track.stop());
      refresh();
      onChange(true);
    }
    catch {
      setFailed(true);
      refresh();
      onChange(false);
    }
  };

  const toggle = (next: boolean) => {
    if (!next) {
      onChange(false);
      return;
    }
    if (mic === 'granted') {
      onChange(true);
      return;
    }
    void request();
  };

  // 'granted' can also mean a one-time grant that dies with this tab, and the
  // Permissions API cannot tell the two apart. Nothing is said about that here:
  // the switch being on with no warning IS the success state, and a note about
  // a future failure is unusable at the moment it would be read. The guidance
  // lives in the warning below, which appears exactly when it can be acted on.
  const warn = enabled && mic !== 'granted';

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
            {/* Before the prompt, not after it fails: "allow this time" stops
                working the moment this page closes. A denied origin gets no
                prompt at all, so the advice would be unfollowable there. */}
            {!enabled && (mic === 'prompt' || mic === 'unknown') && (
              <Box sx={{ mt: 0.5, fontSize: '12px', color: 'text.disabled', maxWidth: 560 }}>
                {$$('voice_mic_choose')}
              </Box>
            )}
          </Box>
          <Switch
            checked={enabled}
            onChange={event => toggle(event.target.checked)}
            inputProps={{ 'aria-label': $$('voice_input') }}
          />
        </Box>

        {(warn || failed) && (
          <Box sx={{ px: 4, pb: 2.5 }}>
            <Alert severity={failed || mic === 'denied' ? 'error' : 'warning'}>
              {failed || mic === 'denied' ? $$('voice_mic_denied') : $$('voice_mic_needed')}
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
                  {$$('voice_key_desc')}
                </Box>
              </Box>
              {/* Locked and entry states share one geometry: the field keeps its
              footprint and the action button its place, so saving or removing
              the key never makes the controls jump. */}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                  label={$$('voice_key_api')}
                  variant="filled"
                  size="small"
                  type={locked ? 'text' : 'password'}
                  InputProps={{ readOnly: locked }}
                  autoComplete="new-password"
                  spellCheck={false}
                  value={locked ? `············${key?.tail ?? ''}` : draft}
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
              <Box sx={{ fontSize: '12px', color: 'text.secondary' }}>
                {verdict === 'checking' && $$('voice_key_checking')}
                {verdict === 'valid' && $$('voice_key_valid')}
                {verdict === 'invalid' && $$('voice_key_invalid')}
                {verdict === 'unreachable' && $$('voice_key_unreachable')}
                {verdict === null && (locked ? $$('voice_key_using_own') : $$('voice_key_missing'))}
              </Box>
            </Box>
          </>
        )}
      </div>
    </div>
  );
}
