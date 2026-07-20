import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatBytes, generateId, getFileName, getParentPath } from '../lib/utils';

describe('utility helpers', () => {
  it('formats byte counts with stable units', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024, 2)).toBe('1 MB');
  });

  it('gets parent paths for root and nested paths', () => {
    expect(getParentPath('/root/demo/file.txt')).toBe('/root/demo');
    expect(getParentPath('/root')).toBe('');
    expect(getParentPath('relative.txt')).toBe('/');
  });

  it('gets file names from absolute paths', () => {
    expect(getFileName('/root/demo/file.txt')).toBe('file.txt');
    expect(getFileName('/root/demo/')).toBe(null);
    expect(getFileName('relative.txt')).toBe(null);
  });
});

describe('generateId', () => {
  beforeEach(() => {
    vi.stubGlobal('self', {
      crypto: {
        getRandomValues: (array: Uint8Array) => {
          for (let i = 0; i < array.length; i++) array[i] = i;
          return array;
        },
      },
    });
  });

  it('produces a lowercase hex string of the correct length', () => {
    // default len=40 → 20 bytes → 40 hex chars
    expect(generateId()).toBe('000102030405060708090a0b0c0d0e0f10111213');
    // custom len=16 → 8 bytes → 16 hex chars
    expect(generateId(16)).toBe('0001020304050607');
  });
});

const base = { schema: 'aurora_pinyin', pageSize: 5, algebraList: [] };

describe('schema key sets (a fact about the schema, not a preference)', () => {
  it('guesses the script a schema paints from its id/name keywords', async () => {
    const { guessSchemaKeys } = await import('../lib/utils');
    expect(guessSchemaKeys('terra_zhuyin')).toBe('zhuyin');
    expect(guessSchemaKeys('bopomofo_tw')).toBe('zhuyin');
    expect(guessSchemaKeys('custom', '注音方案')).toBe('zhuyin');
    expect(guessSchemaKeys('japanese_kana')).toBe('kana');
    // Store catalog ids that lack the full keyword.
    expect(guessSchemaKeys('jap_poly', 'Poly 日文输入法')).toBe('kana');
    expect(guessSchemaKeys('hangeul2set')).toBe('hangul');
    expect(guessSchemaKeys('hangul_2set')).toBe('hangul');
    expect(guessSchemaKeys('custom', '표준 두벌식')).toBe('hangul');
    // Korean schemas that accept romanized or shape codes must keep
    // letter key caps instead of inheriting the standard 2-set board.
    expect(guessSchemaKeys('hangeul_hnc')).toBeUndefined();
    expect(guessSchemaKeys('hangeul')).toBeUndefined();
    expect(guessSchemaKeys('korean_hanja')).toBeUndefined();
    // Latin-typed schemas paint letters.
    expect(guessSchemaKeys('aurora_pinyin', '极光拼音')).toBeUndefined();
    expect(guessSchemaKeys('wubi98')).toBeUndefined();
  });

  it('lets a correction override a wrong guess, in both directions', async () => {
    const { resolveSchemaKeys } = await import('../lib/utils');
    expect(resolveSchemaKeys(
      { schemaKeys: { my_bopomofo_fork: 'latin' } }, 'my_bopomofo_fork')).toBeUndefined();
    expect(resolveSchemaKeys({ schemaKeys: { mystery: 'kana' } }, 'mystery')).toBe('kana');
    expect(resolveSchemaKeys({}, 'terra_zhuyin')).toBe('zhuyin');
  });

  it('assigns every current catalog schema a compatible key set', async () => {
    const { resolveSchemaKeys } = await import('../lib/utils');
    const expected = {
      aurora_pinyin: 'latin',
      rime_ice: 'latin',
      double_pinyin_flypy: 'latin',
      double_pinyin_mspy: 'latin',
      double_pinyin: 'latin',
      wubi86_jidian: 'latin',
      cangjie5: 'latin',
      cangjie3: 'latin',
      luna_pinyin: 'latin',
      stroke: 'latin',
      wubi98_dz: 'latin',
      wubi98_ci: 'latin',
      bopomofo: 'zhuyin',
      jyut6ping3: 'latin',
      jap_poly: 'kana',
      korean_hanja: 'latin',
      hangeul2set: 'hangul',
      hangeul_hnc: 'latin',
      hangeul: 'latin',
    } as const;

    for (const [schemaId, keySet] of Object.entries(expected)) {
      expect(resolveSchemaKeys({}, schemaId) ?? 'latin').toBe(keySet);
    }
  });
});

describe('one arrangement, everywhere', () => {
  it('draws a schema with its own script, else with the chosen arrangement', async () => {
    const { resolveLayoutForSchema } = await import('../lib/utils');
    expect(resolveLayoutForSchema({ keyboardLayout: 'colemak' }, 'terra_zhuyin')).toBe('zhuyin');
    expect(resolveLayoutForSchema({ keyboardLayout: 'colemak' }, 'aurora_pinyin')).toBe('colemak');
    expect(resolveLayoutForSchema(
      { keyboardLayout: 'dvorak', schemaKeys: { terra_zhuyin: 'latin' } }, 'terra_zhuyin')).toBe('dvorak');
    expect(resolveLayoutForSchema(undefined, 'aurora_pinyin')).toBe('qwerty');
  });

  it('never varies the arrangement by schema', async () => {
    const { resolveKeyboardLayout } = await import('../lib/utils');
    expect(resolveKeyboardLayout({ keyboardLayout: 'dvorak' })).toBe('dvorak');
    expect(resolveKeyboardLayout({})).toBe('qwerty');
    expect(resolveKeyboardLayout(undefined)).toBe('qwerty');
  });
});

describe('guessScriptForSchema', () => {
  it('detects Japanese and Korean schemas from id/name keywords', async () => {
    const { guessScriptForSchema } = await import('../lib/utils');
    expect(guessScriptForSchema('japanese', undefined, 'qwerty')).toBe('ja');
    expect(guessScriptForSchema('custom_ime', '日本語ローマ字', 'qwerty')).toBe('ja');
    expect(guessScriptForSchema('hangul_2set', undefined, 'qwerty')).toBe('ko');
    expect(guessScriptForSchema('aurora_pinyin', '极光拼音', 'qwerty')).toBe('zh');
    expect(guessScriptForSchema('terra_zhuyin', '注音', 'zhuyin')).toBe('zh');
  });

  it('falls back to the bound layout when keywords are silent', async () => {
    const { guessScriptForSchema } = await import('../lib/utils');
    expect(guessScriptForSchema('mystery', undefined, 'kana')).toBe('ja');
    expect(guessScriptForSchema('mystery', undefined, 'hangul')).toBe('ko');
    expect(guessScriptForSchema('mystery', undefined, 'qwerty')).toBe('zh');
  });
});

describe('guessScriptForSchema (poly regression)', () => {
  it('recognizes the poly Japanese schema and 日语-named catalogs', async () => {
    const { guessScriptForSchema } = await import('../lib/utils');
    expect(guessScriptForSchema('poly', undefined, 'qwerty')).toBe('ja');
    expect(guessScriptForSchema('custom', '日语输入', 'qwerty')).toBe('ja');
    expect(guessScriptForSchema('custom', '日文', 'qwerty')).toBe('ja');
  });
});

describe('migrating the pre-unification layout config', () => {
  it('keeps script bindings as corrections and drops the Latin ones', async () => {
    const { migrateLayoutSettings } = await import('../lib/utils');
    const next = migrateLayoutSettings({
      ...base,
      schema: 'aurora_pinyin',
      latinLayout: 'follow',
      schemaLayouts: { terra_zhuyin: 'zhuyin', jap_poly: 'kana', aurora_pinyin: 'colemak' },
    });
    expect(next.keyboardLayout).toBe('colemak');
    expect(next.schemaKeys).toEqual({ terra_zhuyin: 'zhuyin', jap_poly: 'kana' });
    expect(next.latinLayout).toBeUndefined();
    expect(next.schemaLayouts).toBeUndefined();
  });

  it('carries a pinned Latin layout over verbatim', async () => {
    const { migrateLayoutSettings } = await import('../lib/utils');
    const next = migrateLayoutSettings({
      ...base,
      schema: 'terra_zhuyin',
      latinLayout: 'dvorak',
      schemaLayouts: { terra_zhuyin: 'zhuyin' },
    });
    expect(next.keyboardLayout).toBe('dvorak');
    expect(next.schemaKeys).toEqual({ terra_zhuyin: 'zhuyin' });
  });

  it('defaults to QWERTY when the old config said nothing concrete', async () => {
    const { migrateLayoutSettings } = await import('../lib/utils');
    const next = migrateLayoutSettings({ ...base, latinLayout: 'follow' });
    expect(next.keyboardLayout).toBe('qwerty');
  });

  it('leaves an already-migrated profile untouched (same object)', async () => {
    const { migrateLayoutSettings } = await import('../lib/utils');
    const settings = { ...base, keyboardLayout: 'colemak' as const, schemaKeys: { x: 'kana' as const } };
    expect(migrateLayoutSettings(settings)).toBe(settings);
  });
});
