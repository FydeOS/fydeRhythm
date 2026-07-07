import { describe, expect, it } from 'vitest';
import {
    buildRawTableDb,
    injectDictPacksIntoSchema,
    parseDictPackSource,
    parseDictPackSourceBytes,
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
                '晭\tabgr\tab\'gr',
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

    it('converts Sogou SCEL binary files into Rime dict yaml', () => {
        const source = parseDictPackSourceBytes(
            'sample.scel',
            makeScelFixture(),
            new Set(),
        );

        expect(source.packName).toBe('dict_pack_sample');
        expect(source.entryCount).toBe(2);
        expect(source.dictYaml).toContain('你好\tni hao\t500');
        expect(source.dictYaml).toContain('测试\tce shi\t300');
    });

    it('ignores trailing non-entry data in Sogou SCEL files', () => {
        const source = parseDictPackSourceBytes('sample.scel', makeScelFixture(true), new Set());

        expect(source.entryCount).toBe(2);
        expect(source.dictYaml).toContain('你好\tni hao\t500');
    });

    it('keeps Sogou SCEL mixed word codes intact for schema-based routing', () => {
        const source = parseDictPackSourceBytes('mixed.scel', makeScelMixedFixture(), new Set());

        expect(source.entryCount).toBe(2);
        expect(source.dictYaml).toContain('zig基金会\tz i g ji jin hui\t600');
        expect(source.dictYaml).toContain('阿福app\ta fu a p p\t500');
        expect(source.entries).toEqual([
            { text: 'zig基金会', code: 'z i g ji jin hui', weight: 600 },
            { text: '阿福app', code: 'a fu a p p', weight: 500 },
        ]);
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
        writeUint16Le(bytes, offset, 2);
        writeUint16Le(bytes, offset + 2, weight);
        offset += 4;
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
