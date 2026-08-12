import { describe, expect, it } from 'vitest';

import {
  type VoiceAvailability,
  voiceAvailable,
} from '../entrypoints/inputview/voice/availability';

const kOffered: VoiceAvailability = {
  configured: true,
  enabled: true,
  schemaId: 'luna_pinyin',
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

  it('hides it when no credentials are stored', () => {
    expect(voiceAvailable({ ...kOffered, configured: false })).toBe(false);
  });

  it('hides it when the setting is off', () => {
    expect(voiceAvailable({ ...kOffered, enabled: false })).toBe(false);
  });

  it('hides it on a schema the endpoint cannot transcribe', () => {
    // 客语 and 中古拼音 are Chinese and still unservable; 河童五笔 is Japanese
    // with 五笔 in its name. None of the three is separable by keyword.
    expect(voiceAvailable({ ...kOffered, schemaId: 'hakka' })).toBe(false);
    expect(voiceAvailable({ ...kOffered, schemaId: 'zyenpheng' })).toBe(false);
    expect(voiceAvailable({ ...kOffered, schemaId: 'KappaJP' })).toBe(false);
  });

  it('hides it on a schema nobody has classified', () => {
    // The default answer, and the reason this is an allowlist: a schema we have
    // never seen gets no microphone rather than a Mandarin one.
    expect(voiceAvailable({ ...kOffered, schemaId: 'telex_vn' })).toBe(false);
    expect(voiceAvailable({ ...kOffered, schemaId: '' })).toBe(false);
  });

  it('offers it on the dialects the model names', () => {
    // 粤语 and 上海话 are in the model's own list and must not be mistaken for
    // languages it cannot serve.
    expect(voiceAvailable({ ...kOffered, schemaId: 'jyut6ping3' })).toBe(true);
    expect(voiceAvailable({ ...kOffered, schemaId: 'wugniu' })).toBe(true);
  });

  it('keeps a password field hidden even on a supported schema', () => {
    // Ordering guard: no clause may be reachable only when another passes.
    expect(voiceAvailable({
      configured: true,
      enabled: true,
      schemaId: 'luna_pinyin',
      passwordField: true,
    })).toBe(false);
  });

  it('requires every clause, not any of them', () => {
    const clauses: Array<Partial<VoiceAvailability>> = [
      { configured: false },
      { enabled: false },
      { schemaId: 'hakka' },
      { passwordField: true },
    ];
    for (const clause of clauses) {
      // Reported per clause so a regression names the one that stopped hiding.
      expect({ clause, offered: voiceAvailable({ ...kOffered, ...clause }) })
        .toEqual({ clause, offered: false });
    }
  });
});
