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

describe('InputView layout resolution', () => {
    it('guesses non-Latin layouts from schema id/name keywords', async () => {
        const { guessLayoutForSchema } = await import('../lib/utils');
        expect(guessLayoutForSchema('terra_zhuyin')).toBe('zhuyin');
        expect(guessLayoutForSchema('bopomofo_tw')).toBe('zhuyin');
        expect(guessLayoutForSchema('custom', '注音方案')).toBe('zhuyin');
        expect(guessLayoutForSchema('japanese_kana')).toBe('kana');
        // Store catalog ids that lack the full keyword.
        expect(guessLayoutForSchema('jap_poly', 'Poly 日文输入法')).toBe('kana');
        expect(guessLayoutForSchema('hangeul2set')).toBe('hangul');
        expect(guessLayoutForSchema('hangul_2set')).toBe('hangul');
        expect(guessLayoutForSchema('aurora_pinyin', '极光拼音')).toBeUndefined();
        expect(guessLayoutForSchema('wubi98')).toBeUndefined();
    });

    it('resolves binding > guess > Latin layout, in that order', async () => {
        const { resolveLayoutForSchema } = await import('../lib/utils');
        // Explicit binding wins over the keyword guess.
        expect(resolveLayoutForSchema(
            { schemaLayouts: { terra_zhuyin: 'qwerty' } }, 'terra_zhuyin')).toBe('qwerty');
        // Keyword guess beats the global Latin layout.
        expect(resolveLayoutForSchema({ latinLayout: 'colemak' }, 'terra_zhuyin')).toBe('zhuyin');
        // Latin-typed schemas follow the global Latin layout (跟随 rule).
        expect(resolveLayoutForSchema({ latinLayout: 'colemak' }, 'aurora_pinyin')).toBe('colemak');
        expect(resolveLayoutForSchema(undefined, 'aurora_pinyin')).toBe('qwerty');
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

describe('resolveEffectiveLatinLayout (English follows Latin schema bindings)', () => {
    it('follows a Latin per-schema binding so 中/英 never changes the arrangement', async () => {
        const { resolveEffectiveLatinLayout } = await import('../lib/utils');
        // Schema bound to Colemak → English mode is Colemak too, even though
        // the global Latin layout is qwerty.
        expect(resolveEffectiveLatinLayout(
            { schemaLayouts: { aurora_pinyin: 'colemak' } }, 'aurora_pinyin')).toBe('colemak');
    });

    it('falls back to the global Latin layout for non-Latin schema layouts', async () => {
        const { resolveEffectiveLatinLayout } = await import('../lib/utils');
        expect(resolveEffectiveLatinLayout(
            { latinLayout: 'dvorak', schemaLayouts: { terra_zhuyin: 'zhuyin' } }, 'terra_zhuyin')).toBe('dvorak');
        expect(resolveEffectiveLatinLayout(undefined, 'aurora_pinyin')).toBe('qwerty');
    });
});

describe('latinLayout "follow" is an explicit choice', () => {
    it('a pinned Latin layout is never overridden by schema bindings', async () => {
        const { resolveEffectiveLatinLayout } = await import('../lib/utils');
        expect(resolveEffectiveLatinLayout(
            { latinLayout: 'qwerty', schemaLayouts: { aurora_pinyin: 'colemak' } },
            'aurora_pinyin')).toBe('qwerty');
    });

    it('follow (and the undefined default) tracks the schema binding', async () => {
        const { resolveEffectiveLatinLayout } = await import('../lib/utils');
        expect(resolveEffectiveLatinLayout(
            { latinLayout: 'follow', schemaLayouts: { aurora_pinyin: 'colemak' } },
            'aurora_pinyin')).toBe('colemak');
        expect(resolveEffectiveLatinLayout(
            { schemaLayouts: { terra_zhuyin: 'zhuyin' } }, 'terra_zhuyin')).toBe('qwerty');
    });
});
