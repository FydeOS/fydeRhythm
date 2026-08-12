import { describe, expect, it } from 'vitest';

import {
  type VoiceAvailability,
  voiceAvailable,
  voiceSupportsScript,
} from '../entrypoints/inputview/voice/availability';

const kOffered: VoiceAvailability = {
  configured: true,
  enabled: true,
  script: 'zh',
  passwordField: false,
};

describe('voice availability', () => {
  it('offers the microphone when everything lines up', () => {
    expect(voiceAvailable(kOffered)).toBe(true);
  });

  it('never offers it in a password field', () => {
    // The one clause with a security consequence rather than a quality one.
    expect(voiceAvailable({ ...kOffered, passwordField: true })).toBe(false);
  });

  it('hides it in a build with no credentials', () => {
    // A release build made without .env has no voice feature at all, by
    // construction rather than by remembering to switch it off.
    expect(voiceAvailable({ ...kOffered, configured: false })).toBe(false);
  });

  it('hides it when the setting is off', () => {
    expect(voiceAvailable({ ...kOffered, enabled: false })).toBe(false);
  });

  it('hides it for scripts the streaming endpoint cannot transcribe', () => {
    expect(voiceAvailable({ ...kOffered, script: 'ja' })).toBe(false);
    expect(voiceAvailable({ ...kOffered, script: 'ko' })).toBe(false);
    expect(voiceSupportsScript('zh')).toBe(true);
    expect(voiceSupportsScript('ja')).toBe(false);
    expect(voiceSupportsScript('ko')).toBe(false);
  });

  it('keeps a password field hidden even when the script is supported', () => {
    // Ordering guard: no clause may be reachable only when another passes.
    expect(voiceAvailable({ configured: true, enabled: true, script: 'zh', passwordField: true }))
      .toBe(false);
  });

  it('requires every clause, not any of them', () => {
    const clauses: Array<Partial<VoiceAvailability>> = [
      { configured: false },
      { enabled: false },
      { script: 'ja' },
      { passwordField: true },
    ];
    for (const clause of clauses) {
      // Reported per clause so a regression names the one that stopped hiding.
      expect({ clause, offered: voiceAvailable({ ...kOffered, ...clause }) })
        .toEqual({ clause, offered: false });
    }
  });
});
