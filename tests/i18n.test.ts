import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, extname } from 'path';

const localesDir = resolve(__dirname, '../public/_locales');
const locales = readdirSync(localesDir);
const baseLocale = 'en';
const rootDir = resolve(__dirname, '..');

function loadKeys(locale: string): string[] {
    const path = resolve(localesDir, locale, 'messages.json');
    const messages = JSON.parse(readFileSync(path, 'utf-8'));
    return Object.keys(messages);
}

const SOURCE_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'public', 'tests', '.wxt', '.git']);

function walkSourceFiles(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
            walkSourceFiles(full, files);
        } else if (SOURCE_EXTS.has(extname(entry))) {
            files.push(full);
        }
    }
    return files;
}

function collectUsedKeys(): Set<string> {
    const used = new Set<string>();
    const sourceFiles = walkSourceFiles(rootDir);
    const declaredKeys = loadKeys(baseLocale);
    let hasEmojiCategoryTemplate = false;

    for (const file of sourceFiles) {
        const src = readFileSync(file, 'utf-8');
        // $$("key"), t("key"), or chrome.i18n.getMessage("key")
        for (const m of src.matchAll(/(?:getMessage|(?<!\w)t|(?<!\w)\$\$)\(\s*["']([^"']+)["']/g)) {
            used.add(m[1]);
        }
        // __MSG_key__ in manifest/wxt config
        for (const m of src.matchAll(/__MSG_([a-zA-Z0-9_]+)__/g)) {
            used.add(m[1]);
        }
        // Some components map states or key kinds to message ids before
        // passing the selected id to t(). Count those declared string values.
        for (const key of declaredKeys) {
            if (src.includes(`"${key}"`) || src.includes(`'${key}'`) || src.includes(`\`${key}\``)) {
                used.add(key);
            }
        }
        hasEmojiCategoryTemplate ||= src.includes('vk_emoji_${');
    }
    if (hasEmojiCategoryTemplate) {
        for (const key of declaredKeys) {
            if (key.startsWith('vk_emoji_')) used.add(key);
        }
    }
    return used;
}

describe('i18n', () => {
    const baseKeys = new Set(loadKeys(baseLocale));

    for (const locale of locales) {
        if (locale === baseLocale) continue;

        it(`${locale} has no missing or extra keys compared to ${baseLocale}`, () => {
            const keys = new Set(loadKeys(locale));

            const missing = [...baseKeys].filter(k => !keys.has(k));
            const extra = [...keys].filter(k => !baseKeys.has(k));

            expect(missing, `Keys missing from ${locale}`).toEqual([]);
            expect(extra, `Extra keys in ${locale} not in ${baseLocale}`).toEqual([]);
        });
    }

    it('all keys used in code are defined in en/messages.json', () => {
        const used = collectUsedKeys();
        const undeclared = [...used].filter(k => !baseKeys.has(k)).sort();
        expect(undeclared, 'Keys used in code but missing from en/messages.json').toEqual([]);
    });

    it('all keys in en/messages.json are used in code', () => {
        const used = collectUsedKeys();
        const unused = [...baseKeys].filter(k => !used.has(k)).sort();
        expect(unused, 'Keys defined in en/messages.json but never used in code').toEqual([]);
    });
});
