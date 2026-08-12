import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { extractScriptProfile, resolveZhVariant, type ScriptProfile } from '../lib/schema-script';

// Each fixture is the convention of a real schema, reduced to the keys that
// matter. The full survey lives in ADR 0002.

const kCangjie = `
engine:
  filters:
    - simplifier
    - uniquifier
`;

const kRimeIce = `
engine:
  filters:
    - simplifier@emoji
    - simplifier@traditionalize
emoji:
  option_name: emoji
  opencc_config: emoji.json
traditionalize:
  option_name: traditionalization
  opencc_config: s2t.json
`;

const kLunaRadio = `
engine:
  filters:
    - simplifier@zh_hans
    - simplifier@zh_hant_hk
    - simplifier@zh_hant_tw
zh_hans:
  option_name: zh_hans
  opencc_config: t2s.json
zh_hant_hk:
  option_name: zh_hant_hk
  opencc_config: t2hk.json
zh_hant_tw:
  option_name: zh_hant_tw
  opencc_config: t2tw.json
`;

const kJyut6ping3 = `
engine:
  filters:
    - simplifier@variants_hk
    - simplifier@trad_tw
    - simplifier
variants_hk:
  option_name: variants_hk
  opencc_config: t2hkf.json
trad_tw:
  option_name: trad_tw
  opencc_config: t2tw.json
`;

const kAurora = `
engine:
  filters:
    - uniquifier
`;

function profileOf(yaml: string): ScriptProfile {
  return extractScriptProfile(parse(yaml));
}

function reading(on: Record<string, boolean>) {
  return async (name: string) => on[name] ?? false;
}

describe('extractScriptProfile', () => {
  it('applies librime’s defaults to a bare simplifier (cangjie convention)', () => {
    // simplifier.cc defaults: option_name "simplification", opencc_config
    // "t2s.json" — so a bare declaration means a traditional-native dict.
    expect(profileOf(kCangjie)).toEqual({
      native: 'traditional',
      conversions: [{ optionName: 'simplification', target: 'simplified' }],
    });
  });

  it('reads a third-party option name and ignores non-script simplifiers (rime-ice)', () => {
    // rime-ice routes emoji through a simplifier instance; reading that as a
    // script switch would flip dictation output when the user toggles emoji.
    expect(profileOf(kRimeIce)).toEqual({
      native: 'simplified',
      conversions: [{ optionName: 'traditionalization', target: 'traditional' }],
    });
  });

  it('maps radio-group variants onto regional targets (upstream luna/bopomofo)', () => {
    expect(profileOf(kLunaRadio).conversions).toEqual([
      { optionName: 'zh_hans', target: 'simplified' },
      { optionName: 'zh_hant_hk', target: 'hk' },
      { optionName: 'zh_hant_tw', target: 'tw' },
    ]);
    expect(profileOf(kLunaRadio).native).toBe('traditional');
  });

  it('handles custom opencc configs in the script family (rime-cantonese t2hkf)', () => {
    expect(profileOf(kJyut6ping3).conversions.map(c => c.target)).toEqual(['hk', 'tw', 'simplified']);
  });

  it('yields an empty simplified profile for schemas with no conversion (aurora)', () => {
    expect(profileOf(kAurora)).toEqual({ native: 'simplified', conversions: [] });
    expect(extractScriptProfile(undefined)).toEqual({ native: 'simplified', conversions: [] });
  });
});

describe('resolveZhVariant', () => {
  it('asks for the generic traditional when a traditional-native dict converts nothing', async () => {
    // cangjie with `simplification` OFF is the default state, and it outputs
    // traditional — the case RimeStatus.isTraditional got wrong.
    expect(await resolveZhVariant(profileOf(kCangjie), reading({}))).toBe('traditional');
  });

  it('drops to simplified when the simplify switch is on', async () => {
    expect(await resolveZhVariant(profileOf(kCangjie), reading({ simplification: true }))).toBeUndefined();
  });

  it('follows a third-party traditionalize switch', async () => {
    expect(await resolveZhVariant(profileOf(kRimeIce), reading({}))).toBeUndefined();
    expect(await resolveZhVariant(profileOf(kRimeIce), reading({ traditionalization: true }))).toBe('traditional');
    expect(await resolveZhVariant(profileOf(kRimeIce), reading({ emoji: true }))).toBeUndefined();
  });

  it('names the regional standard a radio selection implies', async () => {
    expect(await resolveZhVariant(profileOf(kJyut6ping3), reading({ variants_hk: true }))).toBe('hk');
    expect(await resolveZhVariant(profileOf(kJyut6ping3), reading({ trad_tw: true }))).toBe('tw');
    expect(await resolveZhVariant(profileOf(kJyut6ping3), reading({ simplification: true }))).toBeUndefined();
    expect(await resolveZhVariant(profileOf(kJyut6ping3), reading({}))).toBe('traditional');
  });

  it('never asks the engine anything for a schema that declares nothing', async () => {
    let asked = 0;
    const spy = async () => { asked++; return true; };
    expect(await resolveZhVariant(profileOf(kAurora), spy)).toBeUndefined();
    expect(asked).toBe(0);
  });
});
