import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  buildRawTableDb,
  DICT_PACK_WARNINGS_SHOWN_LIMIT,
  injectDictPacksIntoSchema,
  parseDictPackSource,
  parseDictPackSourceBytes,
  summarizeDictPackWarnings,
} from '../lib/dict-packs';

describe('parseDictPackSource', () => {
  it('keeps TSV code columns as Rime dictionary codes', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      [
        '真文韵\tzhen wen yun\t1000',
        '真文韻\tzhen wen yun\t1000',
        '测试词条\tce shi ci tiao\t900',
        '測試詞條\tce shi ci tiao\t900',
        '飞得节奏\tfei de jie zou\t800',
        '飛得節奏\tfei de jie zou\t800',
        '输入法测试\tshu ru fa ce shi\t700',
        '輸入法測試\tshu ru fa ce shi\t700',
      ].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(8);
    expect(source.dictYaml).toContain('真文韵\tzhen wen yun\t1000');
    expect(source.dictYaml).toContain('测试词条\tce shi ci tiao\t900');
    expect(source.dictYaml).toContain('飞得节奏\tfei de jie zou\t800');
    expect(source.dictYaml).toContain('输入法测试\tshu ru fa ce shi\t700');
  });

  it('does not guess how to segment compact codes', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      '你好\tnihao\t100\n',
      new Set(),
    );

    expect(source.dictYaml).toContain('你好\tnihao\t100');
  });

  it('accepts weight-less TSV rows with a default weight', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao', '世界\tshi jie\t900'].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(2);
    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 100 },
      { text: '世界', code: 'shi jie', weight: 900 },
    ]);
    expect(source.dictYaml).toContain('你好\tni hao\t100');
    expect(source.dictYaml).toContain('世界\tshi jie\t900');
  });

  it('reports zero duplicates for a TSV file without repeated entries', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t100', '世界\tshi jie\t900'].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(2);
    expect(source.duplicateCount).toBe(0);
  });

  it('merges duplicate TSV rows and keeps the highest weight', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t100', '你好\tni hao\t900'].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(1);
    expect(source.duplicateCount).toBe(1);
    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 900 }]);
    expect(source.dictYaml).toContain('你好\tni hao\t900');
    expect(source.dictYaml).not.toContain('你好\tni hao\t100');
  });

  it('keeps the earlier weight when a later duplicate is lower', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t900', '你好\tni hao\t100'].join('\n'),
      new Set(),
    );

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 900 }]);
    expect(source.duplicateCount).toBe(1);
  });

  it('counts an equal-weight duplicate as merged', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t100', '你好\tni hao\t100'].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(1);
    expect(source.duplicateCount).toBe(1);
  });

  it('counts every extra occurrence of a triplicated row', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t100', '你好\tni hao\t200', '你好\tni hao\t50'].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(1);
    expect(source.duplicateCount).toBe(2);
    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 200 }]);
  });

  it('merges weight-less duplicates against weighted rows via the default weight', () => {
    // Default weight is 100: it beats an explicit 50 but loses to 300.
    const lowThenDefault = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t50', '你好\tni hao'].join('\n'),
      new Set(),
    );
    const defaultThenHigh = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao', '你好\tni hao\t300'].join('\n'),
      new Set(),
    );

    expect(lowThenDefault.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 100 }]);
    expect(lowThenDefault.duplicateCount).toBe(1);
    expect(defaultThenHigh.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 300 }]);
  });

  it('does not merge rows that differ in text or code', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      [
        '你好\tni hao\t100',
        '拟好\tni hao\t100',
        '你好\tni hao ma\t100',
      ].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(3);
    expect(source.duplicateCount).toBe(0);
  });

  it('dedupes on the trimmed code so trailing whitespace does not split entries', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      ['你好\tni hao\t100', '你好\tni hao \t900'].join('\n'),
      new Set(),
    );

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 900 }]);
    expect(source.duplicateCount).toBe(1);
  });

  it('dedupes across CRLF and LF line endings', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      '你好\tni hao\t100\r\n你好\tni hao\t900\n',
      new Set(),
    );

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 900 }]);
    expect(source.duplicateCount).toBe(1);
  });

  it('keeps first-seen entry order even when a later duplicate wins on weight', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      [
        '你好\tni hao\t100',
        '世界\tshi jie\t500',
        '你好\tni hao\t900',
      ].join('\n'),
      new Set(),
    );

    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 900 },
      { text: '世界', code: 'shi jie', weight: 500 },
    ]);
    const bodyStart = source.dictYaml.indexOf('\n...');
    const body = source.dictYaml.slice(bodyStart);
    expect(body.indexOf('你好')).toBeLessThan(body.indexOf('世界'));
  });

  it('ignores comments and blank lines when counting duplicates', () => {
    const source = parseDictPackSource(
      'custom.tsv',
      [
        '# comment',
        '',
        '你好\tni hao\t100',
        '# 你好\tni hao\t100',
        '',
        '你好\tni hao\t100',
      ].join('\n'),
      new Set(),
    );

    expect(source.entryCount).toBe(1);
    expect(source.duplicateCount).toBe(1);
  });

  it('leaves dict yaml sources untouched and reports no duplicate count', () => {
    const source = parseDictPackSource(
      'dup.dict.yaml',
      [
        '---',
        'name: dup',
        'version: "1"',
        '...',
        '你好\tni hao\t100',
        '你好\tni hao\t900',
      ].join('\n'),
      new Set(),
    );

    // dict.yaml passes through verbatim — duplicates are left to the
    // compiler, and no duplicate count is reported.
    expect(source.duplicateCount).toBeUndefined();
    expect(source.entryCount).toBe(2);
    expect(source.dictYaml).toContain('你好\tni hao\t100');
    expect(source.dictYaml).toContain('你好\tni hao\t900');
  });

  it('uses the full Unicode display name when generating filesystem ids', () => {
    const first = parseDictPackSource('词库abc.tsv', '词\tci\t100\n', new Set());
    const second = parseDictPackSource('abc.tsv', '词\tci\t100\n', new Set([first.packName]));
    const chineseOnly = parseDictPackSource('网络流行新词.tsv', '词\tci\t100\n', new Set([first.packName, second.packName]));

    expect(first.packName).toMatch(/^dict_pack_abc_[a-z0-9]{7}$/);
    expect(second.packName).toBe('dict_pack_abc');
    expect(chineseOnly.packName).toMatch(/^dict_pack_u_[a-z0-9]{7}$/);
    expect(new Set([first.packName, second.packName, chineseOnly.packName]).size).toBe(3);
  });

  it('reuses an existing pack name for imports with the same display name', () => {
    const existingDisplayNames = new Map([['网络流行新词', 'dict_pack_u_existing']]);
    const source = parseDictPackSource(
      '网络流行新词.tsv',
      '词\tci\t100\n',
      new Set(['dict_pack_u_existing']),
      existingDisplayNames,
    );

    expect(source.packName).toBe('dict_pack_u_existing');
  });

  it('preserves dict yaml settings such as Cangjie columns, stems, and encoder rules', () => {
    const source = parseDictPackSource(
      'cangjie5.dict.yaml',
      [
        '---',
        'name: "cangjie5"',
        'version: "0.18"',
        'sort: by_weight',
        'use_preset_vocabulary: true',
        'max_phrase_length: 7',
        'min_phrase_weight: 100',
        'columns:',
        '  - text',
        '  - code',
        '  - stem',
        'encoder:',
        '  exclude_patterns:',
        "    - '^x.*$'",
        '  rules:',
        '    - length_equal: 2',
        '      formula: "AaAzBaBbBz"',
        '  tail_anchor: "\'"',
        '...',
        '日\ta',
        "晭\tabgr\tab'gr",
      ].join('\n'),
      new Set(),
    );

    expect(source.packName).toBe('dict_pack_cangjie5');
    expect(source.displayName).toBe('cangjie5');
    expect(source.entryCount).toBe(2);
    expect(source.dictYaml).toContain('name: dict_pack_cangjie5');
    expect(source.dictYaml).toContain('  - stem');
    expect(source.dictYaml).toContain('encoder:');
    expect(source.dictYaml).toContain('      formula: "AaAzBaBbBz"');
    expect(source.dictYaml).toContain("晭\tabgr\tab'gr");
  });

  it('converts Sogou SCEL binary files into Rime dict yaml', async () => {
    const source = await parseDictPackSourceBytes(
      'sample.scel',
      makeScelFixture(),
      new Set(),
    );

    expect(source.packName).toBe('dict_pack_sample');
    expect(source.entryCount).toBe(2);
    expect(source.duplicateCount).toBe(0);
    expect(source.dictYaml).toContain('你好\tni hao\t500');
    expect(source.dictYaml).toContain('测试\tce shi\t300');
  });

  it('merges duplicate Sogou SCEL words and reports the merge count', async () => {
    const source = await parseDictPackSourceBytes(
      'dup.scel',
      makeScelDuplicateFixture(),
      new Set(),
    );

    expect(source.entryCount).toBe(2);
    expect(source.duplicateCount).toBe(1);
    // Duplicate 你好 appears with weights 500 and 800 — the higher wins.
    expect(source.entries).toContainEqual({ text: '你好', code: 'ni hao', weight: 800 });
    expect(source.dictYaml).not.toContain('你好\tni hao\t500');
  });

  it('ignores trailing non-entry data in Sogou SCEL files', async () => {
    const source = await parseDictPackSourceBytes('sample.scel', makeScelFixture(true), new Set());

    expect(source.entryCount).toBe(2);
    expect(source.dictYaml).toContain('你好\tni hao\t500');
  });

  it('keeps Sogou SCEL mixed word codes intact for schema-based routing', async () => {
    const source = await parseDictPackSourceBytes('mixed.scel', makeScelMixedFixture(), new Set());

    expect(source.entryCount).toBe(2);
    expect(source.dictYaml).toContain('zig基金会\tz i g ji jin hui\t600');
    expect(source.dictYaml).toContain('阿福app\ta fu a p p\t500');
    expect(source.entries).toEqual([
      { text: 'zig基金会', code: 'z i g ji jin hui', weight: 600 },
      { text: '阿福app', code: 'a fu a p p', weight: 500 },
    ]);
  });

  it('reads scel frequencies as uint32 and caps implausible values', async () => {
    const source = await parseDictPackSourceBytes('weights.scel', makeScelWeightFixture(), new Set());

    expect(source.entries).toEqual([
      // Frequencies above 65535 must survive (they were truncated when
      // the parser read only a uint16).
      { text: '你好', code: 'ni hao', weight: 279900 },
      // Values beyond any real Sogou frequency are capped so they
      // cannot outrank everyday vocabulary.
      { text: '你', code: 'ni', weight: 10_000_000 },
      // Minimal files with a 2-byte extension block still work.
      { text: '好', code: 'hao', weight: 321 },
    ]);
  });

  it('decodes GBK-encoded text imports', async () => {
    // '你好\tni hao\t500\n' in GBK (你 = C4E3, 好 = BAC3) — invalid as
    // UTF-8, so the decoder must fall back to GBK.
    const gbk = new Uint8Array([
      0xc4, 0xe3, 0xba, 0xc3,
      ...[...'\tni hao\t500\n'].map(c => c.charCodeAt(0)),
    ]);
    const source = await parseDictPackSourceBytes('gbk-words.txt', gbk, new Set());

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });

  it('decodes UTF-16LE text imports with a BOM', async () => {
    const text = '你好\tni hao\t500\n测试\tce shi\t300\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    bytes.set(encodeUtf16Le(text), 2);
    const source = await parseDictPackSourceBytes('qq-export.txt', bytes, new Set());

    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 500 },
      { text: '测试', code: 'ce shi', weight: 300 },
    ]);
  });

  it('strips a UTF-8 BOM from text imports', async () => {
    const bytes = new Uint8Array([
      0xef, 0xbb, 0xbf,
      ...new TextEncoder().encode('你好\tni hao\t500\n'),
    ]);
    const source = await parseDictPackSourceBytes('bom.txt', bytes, new Set());

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });

  it('decodes UTF-16BE text imports with a BOM', async () => {
    const text = '你好\tni hao\t500\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xfe;
    bytes[1] = 0xff;
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) >> 8;
      bytes[2 + i * 2 + 1] = text.charCodeAt(i) & 0xff;
    }
    const source = await parseDictPackSourceBytes('be.txt', bytes, new Set());

    expect(source.entries).toEqual([{ text: '你好', code: 'ni hao', weight: 500 }]);
  });

  it('reports zero entries for an empty text import', async () => {
    const source = await parseDictPackSourceBytes('empty.txt', new Uint8Array(0), new Set());

    expect(source.entryCount).toBe(0);
  });

  it('rejects truncated SCEL files', async () => {
    await expect(parseDictPackSourceBytes('tiny.scel', new Uint8Array(16), new Set()))
      .rejects.toThrow('file is too small');
  });

  it('rejects truncated qpyd files', async () => {
    await expect(parseDictPackSourceBytes('tiny.qpyd', new Uint8Array(16), new Set()))
      .rejects.toThrow('file is too small');
  });

  it('keeps emoji entries intact through the text import path', async () => {
    const bytes = new TextEncoder().encode('🍎手机\tping guo shou ji\t500\n');
    const source = await parseDictPackSourceBytes('emoji.txt', bytes, new Set());

    expect(source.entries).toEqual([{ text: '🍎手机', code: 'ping guo shou ji', weight: 500 }]);
  });

  it('flattens scel weights when every word shares one value', async () => {
    const source = await parseDictPackSourceBytes(
      'flat.scel', makeScelCustomWeightFixture([777, 777]), new Set());

    // A constant field carries no ordering information, so the neutral
    // default applies instead of the (possibly inflated) constant.
    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 100 },
      { text: '测试', code: 'ce shi', weight: 100 },
    ]);
  });

  it('flattens scel weights when most values are implausibly large', async () => {
    const source = await parseDictPackSourceBytes(
      'garbage.scel', makeScelCustomWeightFixture([4_000_000_000, 3_000_000_000]), new Set());

    // With the majority of values beyond any real rank/frequency the
    // whole field is untrustworthy — clamping each value would pin most
    // of the pack at the cap instead.
    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 100 },
      { text: '测试', code: 'ce shi', weight: 100 },
    ]);
  });

  it('keeps distinct plausible scel weights untouched', async () => {
    const source = await parseDictPackSourceBytes(
      'ranks.scel', makeScelCustomWeightFixture([2, 1]), new Set());

    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 2 },
      { text: '测试', code: 'ce shi', weight: 1 },
    ]);
  });

  it('maps beyond-table pinyin ids to ASCII letters', async () => {
    const source = await parseDictPackSourceBytes('letters.scel', makeScelBeyondTableFixture(), new Set());

    // Table ids run 1–4, so id 5 = 'a', id 22 = 'r'.
    expect(source.entries).toEqual([
      { text: 'a测试r', code: 'a ce shi r', weight: 700 },
    ]);
  });

  it('routes .qcel files through the SCEL parser', async () => {
    const source = await parseDictPackSourceBytes('sample.qcel', makeScelFixture(), new Set());

    expect(source.packName).toBe('dict_pack_sample');
    expect(source.entryCount).toBe(2);
    expect(source.dictYaml).toContain('你好\tni hao\t500');
  });

  it('converts Baidu bdict binary files into Rime dict yaml', async () => {
    const source = await parseDictPackSourceBytes('sample.bdict', makeBdictFixture(), new Set());

    expect(source.packName).toBe('dict_pack_sample');
    expect(source.entries).toContainEqual({ text: '你好', code: 'ni hao', weight: 500 });
    // Frequency 0 falls back to the default weight.
    expect(source.entries).toContainEqual({ text: 'QQ', code: 'qq', weight: 100 });
    // Format-3 entry with explicit code text.
    expect(source.entries).toContainEqual({ text: '词组', code: 'abc', weight: 200 });
    // 0xFF initial marks a literal ASCII letter inside a Chinese word.
    expect(source.entries).toContainEqual({ text: 'a股', code: 'a gu', weight: 400 });
    expect(source.entryCount).toBe(4);
  });

  it('accepts the mobile .bcd extension for Baidu dictionaries', async () => {
    const source = await parseDictPackSourceBytes('mobile.bcd', makeBdictFixture(), new Set());

    expect(source.packName).toBe('dict_pack_mobile');
    expect(source.entryCount).toBe(4);
  });

  it('rejects Baidu dictionaries without any entries', async () => {
    await expect(parseDictPackSourceBytes('empty.bdict', new Uint8Array(0x400), new Set()))
      .rejects.toThrow('no entries found');
  });

  it('converts QQ qpyd binary files into Rime dict yaml', async () => {
    const source = await parseDictPackSourceBytes('sample.qpyd', await makeQpydFixture(), new Set());

    expect(source.packName).toBe('dict_pack_sample');
    expect(source.entryCount).toBe(2);
    // qpyd carries no frequency; every entry gets the default weight.
    expect(source.entries).toEqual([
      { text: '你好', code: 'ni hao', weight: 100 },
      { text: '测试', code: 'ce shi', weight: 100 },
    ]);
  });

  it('rejects qpyd files with a corrupt payload', async () => {
    const broken = await makeQpydFixture();
    broken[0x60] = 0x00; // destroy the zlib header
    await expect(parseDictPackSourceBytes('broken.qpyd', broken, new Set()))
      .rejects.toThrow('could not decompress');
  });

  it('builds raw table db entries with literal continuous codes', () => {
    const table = new TextDecoder().decode(buildRawTableDb('dict_pack_mixed_raw', [
      { text: 'zig基金会', code: 'z i g ji jin hui', weight: 600 },
      { text: '東京Studio', code: 'tokyo studio', weight: 500 },
    ]));

    expect(table).toContain('# Rime table');
    expect(table).toContain('#@/db_name\tdict_pack_mixed_raw.txt');
    expect(table).toContain('zig基金会\tzigjijinhui\t600');
    expect(table).toContain('東京Studio\ttokyostudio\t500');
  });

  it('injects compiled packs and raw table translators into schema config', () => {
    const schemaConfig: Record<string, unknown> = {
      engine: { translators: ['script_translator'] },
      translator: { dictionary: 'aurora_pinyin' },
    };

    injectDictPacksIntoSchema(schemaConfig, [
      {
        id: 'dict_pack_mixed',
        name: 'mixed',
        packName: 'dict_pack_mixed',
        baseDictionary: 'aurora_pinyin',
        entryCount: 2,
        compiledEntryCount: 1,
        rawEntryCount: 1,
        rawTableName: 'dict_pack_mixed_raw',
        enabled: true,
        installedAt: 1,
        updatedAt: 1,
        source: 'user',
      },
    ]);

    expect((schemaConfig.translator as { packs: string[] }).packs).toContain('dict_pack_mixed');
    expect((schemaConfig.engine as { translators: string[] }).translators).toContain('table_translator@dict_pack_mixed_raw');
    expect(schemaConfig.dict_pack_mixed_raw).toMatchObject({
      dictionary: '',
      user_dict: 'dict_pack_mixed_raw',
      db_class: 'stabledb',
    });
  });
});

describe('summarizeDictPackWarnings', () => {
  const makeWarnings = (count: number) =>
    Array.from({ length: count }, (_, i) => `warning ${i + 1}`);

  it('returns nothing to show for an empty warning list', () => {
    expect(summarizeDictPackWarnings([])).toEqual({ shown: [], hiddenCount: 0 });
  });

  it('shows every warning when below the limit', () => {
    const warnings = makeWarnings(3);
    expect(summarizeDictPackWarnings(warnings)).toEqual({ shown: warnings, hiddenCount: 0 });
  });

  it('shows every warning when exactly at the limit', () => {
    const warnings = makeWarnings(DICT_PACK_WARNINGS_SHOWN_LIMIT);
    expect(summarizeDictPackWarnings(warnings)).toEqual({ shown: warnings, hiddenCount: 0 });
  });

  it('hides a single warning past the limit', () => {
    const warnings = makeWarnings(DICT_PACK_WARNINGS_SHOWN_LIMIT + 1);
    const { shown, hiddenCount } = summarizeDictPackWarnings(warnings);
    expect(shown).toEqual(warnings.slice(0, DICT_PACK_WARNINGS_SHOWN_LIMIT));
    expect(hiddenCount).toBe(1);
  });

  it('summarizes huge warning lists down to the limit', () => {
    const warnings = makeWarnings(10_000);
    const { shown, hiddenCount } = summarizeDictPackWarnings(warnings);
    expect(shown).toHaveLength(DICT_PACK_WARNINGS_SHOWN_LIMIT);
    expect(shown[0]).toBe('warning 1');
    expect(hiddenCount).toBe(10_000 - DICT_PACK_WARNINGS_SHOWN_LIMIT);
  });

  it('honors a custom limit', () => {
    const warnings = makeWarnings(4);
    expect(summarizeDictPackWarnings(warnings, 2)).toEqual({
      shown: ['warning 1', 'warning 2'],
      hiddenCount: 2,
    });
  });

  it('treats a zero or negative limit as hide-everything', () => {
    const warnings = makeWarnings(3);
    expect(summarizeDictPackWarnings(warnings, 0)).toEqual({ shown: [], hiddenCount: 3 });
    expect(summarizeDictPackWarnings(warnings, -5)).toEqual({ shown: [], hiddenCount: 3 });
  });

  it('does not mutate the input array', () => {
    const warnings = makeWarnings(10);
    const before = [...warnings];
    summarizeDictPackWarnings(warnings);
    expect(warnings).toEqual(before);
  });
});

function makeScelFixture(withTrailingData = false): Uint8Array {
  const bytes = new Uint8Array(0x2700);
  let pinyinOffset = 0x1544;
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 1, 'ni');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 2, 'hao');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 3, 'ce');
  let wordOffset = writePinyinEntry(bytes, pinyinOffset, 4, 'shi');

  wordOffset = writeWordGroup(bytes, wordOffset, [1, 2], [{ word: '你好', weight: 500 }]);
  wordOffset = writeWordGroup(bytes, wordOffset, [3, 4], [{ word: '测试', weight: 300 }]);
  if (withTrailingData) {
    writeUint16Le(bytes, wordOffset, 35);
    writeUint16Le(bytes, wordOffset + 2, 1281);
  }
  return bytes;
}

function makeScelDuplicateFixture(): Uint8Array {
  const bytes = new Uint8Array(0x2700);
  let pinyinOffset = 0x1544;
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 1, 'ni');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 2, 'hao');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 3, 'ce');
  let wordOffset = writePinyinEntry(bytes, pinyinOffset, 4, 'shi');

  // 你好 appears twice under the same code with different weights.
  wordOffset = writeWordGroup(bytes, wordOffset, [1, 2], [
    { word: '你好', weight: 500 },
    { word: '你好', weight: 800 },
  ]);
  writeWordGroup(bytes, wordOffset, [3, 4], [{ word: '测试', weight: 300 }]);
  return bytes;
}

function makeScelMixedFixture(): Uint8Array {
  const bytes = new Uint8Array(0x2800);
  let pinyinOffset = 0x1544;
  const pinyin = ['z', 'i', 'g', 'ji', 'jin', 'hui', 'a', 'fu', 'p'];
  pinyin.forEach((value, index) => {
    pinyinOffset = writePinyinEntry(bytes, pinyinOffset, index + 1, value);
  });

  let wordOffset = pinyinOffset;
  wordOffset = writeWordGroup(bytes, wordOffset, [1, 2, 3, 4, 5, 6], [{ word: 'zig基金会', weight: 600 }]);
  writeWordGroup(bytes, wordOffset, [7, 8, 7, 9, 9], [{ word: '阿福app', weight: 500 }]);
  return bytes;
}

function makeScelCustomWeightFixture(weights: [number, number]): Uint8Array {
  const bytes = new Uint8Array(0x2700);
  let pinyinOffset = 0x1544;
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 1, 'ni');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 2, 'hao');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 3, 'ce');
  let wordOffset = writePinyinEntry(bytes, pinyinOffset, 4, 'shi');

  wordOffset = writeWordGroup(bytes, wordOffset, [1, 2], [{ word: '你好', weight: weights[0] }]);
  writeWordGroup(bytes, wordOffset, [3, 4], [{ word: '测试', weight: weights[1] }]);
  return bytes;
}

function makeScelWeightFixture(): Uint8Array {
  const bytes = new Uint8Array(0x2700);
  let pinyinOffset = 0x1544;
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 1, 'ni');
  let o = writePinyinEntry(bytes, pinyinOffset, 2, 'hao');

  o = writeWordGroup(bytes, o, [1, 2], [{ word: '你好', weight: 279900 }]);
  o = writeWordGroup(bytes, o, [1], [{ word: '你', weight: 50_000_000 }]);

  // A word with a legacy 2-byte extension holding a uint16 weight.
  writeUint16Le(bytes, o, 1);
  writeUint16Le(bytes, o + 2, 2);
  writeUint16Le(bytes, o + 4, 2); // pinyin ids: [hao]
  o += 6;
  const word = encodeUtf16Le('好');
  writeUint16Le(bytes, o, word.length);
  bytes.set(word, o + 2);
  o += 2 + word.length;
  writeUint16Le(bytes, o, 2);
  writeUint16Le(bytes, o + 2, 321);
  return bytes;
}

function makeScelBeyondTableFixture(): Uint8Array {
  const bytes = new Uint8Array(0x2700);
  let pinyinOffset = 0x1544;
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 1, 'ni');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 2, 'hao');
  pinyinOffset = writePinyinEntry(bytes, pinyinOffset, 3, 'ce');
  const wordOffset = writePinyinEntry(bytes, pinyinOffset, 4, 'shi');

  // Ids past the table encode letters: max id is 4, so 5 = 'a', 22 = 'r'.
  writeWordGroup(bytes, wordOffset, [5, 3, 4, 22], [{ word: 'a测试r', weight: 700 }]);
  return bytes;
}

function makeBdictFixture(): Uint8Array {
  const bytes = new Uint8Array(0x400);
  writeUint32Le(bytes, 0x70, 4);
  let o = 0x350;
  // Format 1: 你好 = ni (n=11, i=29) + hao (h=5, ao=13), frequency 500.
  writeUint16Le(bytes, o, 2); writeUint16Le(bytes, o + 2, 500); o += 4;
  bytes.set([11, 29, 5, 13], o); o += 4;
  bytes.set(encodeUtf16Le('你好'), o); o += 4;
  // Format 2: pure-ASCII word, frequency 0.
  writeUint16Le(bytes, o, 2); writeUint16Le(bytes, o + 2, 0); o += 4;
  bytes.set([0x51, 0x51], o); o += 2; // "QQ"
  // Format 3: explicit code text "abc" for 词组, frequency 200.
  writeUint16Le(bytes, o, 3); writeUint16Le(bytes, o + 2, 200); o += 4;
  writeUint16Le(bytes, o, 0); writeUint16Le(bytes, o + 2, 2); o += 4;
  bytes.set(encodeUtf16Le('abc'), o); o += 6;
  bytes.set(encodeUtf16Le('词组'), o); o += 4;
  // Format 1 with a 0xFF literal-ASCII marker: a股 = a + gu (g=4, u=31).
  writeUint16Le(bytes, o, 2); writeUint16Le(bytes, o + 2, 400); o += 4;
  bytes.set([0xff, 0x61, 4, 31], o); o += 4;
  bytes.set(encodeUtf16Le('a股'), o); o += 4;
  return bytes;
}

async function makeQpydFixture(): Promise<Uint8Array> {
  const entries = [
    { code: "ni'hao", word: '你好' },
    { code: "ce'shi", word: '测试' },
  ];
  const index = new Uint8Array(entries.length * 10);
  const dataParts: number[] = [];
  let position = index.length;
  entries.forEach((entry, i) => {
    const codeBytes = [...entry.code].map(c => c.charCodeAt(0));
    const wordBytes = encodeUtf16Le(entry.word);
    index[i * 10] = codeBytes.length;
    index[i * 10 + 1] = wordBytes.length;
    writeUint32Le(index, i * 10 + 6, position);
    dataParts.push(...codeBytes, ...wordBytes);
    position += codeBytes.length + wordBytes.length;
  });
  const compressed = new Uint8Array(deflateSync(Buffer.from([...index, ...dataParts])));
  const bytes = new Uint8Array(0x60 + compressed.length);
  writeUint32Le(bytes, 0x38, 0x60);
  writeUint32Le(bytes, 0x44, entries.length);
  bytes.set(compressed, 0x60);
  return bytes;
}

function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writePinyinEntry(bytes: Uint8Array, offset: number, id: number, pinyin: string): number {
  const encoded = encodeUtf16Le(pinyin);
  writeUint16Le(bytes, offset, id);
  writeUint16Le(bytes, offset + 2, encoded.length);
  bytes.set(encoded, offset + 4);
  return offset + 4 + encoded.length;
}

function writeWordGroup(
  bytes: Uint8Array,
  offset: number,
  pinyinIds: number[],
  words: Array<{ word: string; weight: number }>,
): number {
  writeUint16Le(bytes, offset, words.length);
  writeUint16Le(bytes, offset + 2, pinyinIds.length * 2);
  offset += 4;
  for (const id of pinyinIds) {
    writeUint16Le(bytes, offset, id);
    offset += 2;
  }
  for (const { word, weight } of words) {
    const encodedWord = encodeUtf16Le(word);
    writeUint16Le(bytes, offset, encodedWord.length);
    bytes.set(encodedWord, offset + 2);
    offset += 2 + encodedWord.length;
    // 10-byte extension with a uint32 frequency, as in real files.
    writeUint16Le(bytes, offset, 10);
    writeUint32Le(bytes, offset + 2, weight);
    offset += 12;
  }
  return offset;
}

function writeUint16Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >> 8;
}

function encodeUtf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    writeUint16Le(bytes, i * 2, value.charCodeAt(i));
  }
  return bytes;
}
