// What script a Rime schema emits, read from the schema's own declarations.
//
// librime's RimeStatus.isTraditional keys on an option literally named
// `traditional`, which no surveyed schema uses (they use `simplification`,
// `traditionalization`, `zh_hant`, `variants_hk`, ...). The reliable spec is
// the schema's simplifier filters: each names its switch (`option_name`,
// default `simplification`) and its OpenCC conversion (`opencc_config`,
// default `t2s.json`), whose `<source>2<target>` name gives both the
// dictionary's native script and what the switch converts to.

import type { ZhVariant } from './shared-types';

/** One declared script conversion: `optionName` on makes the output `target`. */
export interface ScriptConversion {
  optionName: string;
  target: ZhVariant | 'simplified';
}

export interface ScriptProfile {
  /** What the dictionary emits with every conversion off. */
  native: 'traditional' | 'simplified';
  conversions: ScriptConversion[];
}

type ScriptSide = ZhVariant | 'simplified';

// OpenCC tokens. `twp`/`hkf` are the phrase/full variants some schemas ship
// (rime-cantonese uses t2hkf). `jp` and anything unrecognised is not a
// Chinese-script conversion — schemas also run emoji and 拆字 through
// simplifier instances, and those must not read as script switches.
const kScriptTokens: Record<string, ScriptSide> = {
  s: 'simplified',
  sp: 'simplified',
  t: 'traditional',
  tw: 'tw',
  twp: 'tw',
  hk: 'hk',
  hkf: 'hk',
};

function conversionSides(openccConfig: string): { source: ScriptSide; target: ScriptSide } | undefined {
  const match = /^([a-z]+)2([a-z]+)\.json$/.exec(openccConfig);
  if (!match) return undefined;
  const source = kScriptTokens[match[1]];
  const target = kScriptTokens[match[2]];
  return source && target ? { source, target } : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Reads the simplifier declarations out of a parsed *.schema.yaml. */
export function extractScriptProfile(schema: unknown): ScriptProfile {
  const doc = asRecord(schema) ?? {};
  const filters = asRecord(doc.engine)?.filters;
  const conversions: ScriptConversion[] = [];
  let native: ScriptProfile['native'] | undefined;

  for (const entry of Array.isArray(filters) ? filters : []) {
    if (typeof entry !== 'string') continue;
    if (entry !== 'simplifier' && !entry.startsWith('simplifier@')) continue;
    const namespace = entry.includes('@') ? entry.split('@')[1] : 'simplifier';
    const config = asRecord(doc[namespace]);
    const openccConfig = typeof config?.opencc_config === 'string' ? config.opencc_config : 't2s.json';
    const sides = conversionSides(openccConfig);
    if (!sides) continue;
    const optionName = typeof config?.option_name === 'string' ? config.option_name : 'simplification';
    conversions.push({ optionName, target: sides.target });
    native ??= sides.source === 'simplified' ? 'simplified' : 'traditional';
  }

  return { native: native ?? 'simplified', conversions };
}

/** The variant to request from the voice server right now; undefined means
 *  simplified, i.e. no conversion. First active switch wins — radio-style
 *  schemas keep at most one on. */
export async function resolveZhVariant(
  profile: ScriptProfile,
  readOption: (name: string) => Promise<boolean>,
): Promise<ZhVariant | undefined> {
  for (const conversion of profile.conversions) {
    if (await readOption(conversion.optionName)) {
      return conversion.target === 'simplified' ? undefined : conversion.target;
    }
  }
  return profile.native === 'traditional' ? 'traditional' : undefined;
}
