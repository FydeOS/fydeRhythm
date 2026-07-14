import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface LocaleMessage {
    message: string;
    placeholders?: Record<string, { content: string }>;
}

const repoRoot = join(__dirname, '..');
const localesDir = join(repoRoot, 'public', '_locales');
const locales = readdirSync(localesDir);

function loadMessages(locale: string): Record<string, LocaleMessage> {
    return JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));
}

const reference = 'en';
const referenceMessages = loadMessages(reference);

describe('locale message files', () => {
    it('includes the expected locales', () => {
        expect(locales).toEqual(expect.arrayContaining(['en', 'ja', 'ko', 'zh_CN', 'zh_TW']));
    });

    it.each(locales)('%s has exactly the same keys as en', (locale) => {
        const keys = Object.keys(loadMessages(locale)).sort();
        expect(keys).toEqual(Object.keys(referenceMessages).sort());
    });

    it.each(locales)('%s uses the ellipsis character instead of three dots', (locale) => {
        for (const [key, { message }] of Object.entries(loadMessages(locale))) {
            expect(message, `${locale}/${key}`).not.toContain('...');
        }
    });

    it.each(locales)('%s declares a placeholder for every $token$ used in a message', (locale) => {
        for (const [key, entry] of Object.entries(loadMessages(locale))) {
            // $TOKEN$ placeholders, ignoring literal "$$" escapes.
            const tokens = [...entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map(m => m[1].toLowerCase());
            const declared = Object.keys(entry.placeholders ?? {}).map(p => p.toLowerCase());
            for (const token of tokens) {
                expect(declared, `${locale}/${key} uses $${token}$`).toContain(token);
            }
        }
    });

    it.each(locales)('%s placeholder contents reference numbered substitutions', (locale) => {
        for (const [key, entry] of Object.entries(loadMessages(locale))) {
            for (const [name, def] of Object.entries(entry.placeholders ?? {})) {
                expect(def.content, `${locale}/${key} placeholder ${name}`).toMatch(/^\$\d+$/);
            }
        }
    });

    it('has no message nothing references', () => {
        const source = sourceFiles(repoRoot).map((f) => readFileSync(f, 'utf8')).join('\n');
        const orphans = Object.keys(referenceMessages).filter((key) => !isReferenced(key, source));
        expect(orphans).toEqual([]);
    });
});

// .wxt holds a GENERATED i18n.d.ts listing every key, which would make any
// message look used.
const kSkip = ['node_modules', '.git', '.wxt', '.output', 'build', 'public', 'media', 'dist'];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (kSkip.includes(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
        else if (/\.(ts|tsx|html)$/.test(entry)) out.push(path);
    }
    return out;
}

// The emoji tabs do t(`vk_emoji_${id}`), so only the prefix appears in source.
const kTemplateBuilt = /^vk_emoji_/;

function isReferenced(key: string, source: string): boolean {
    if (kTemplateBuilt.test(key)) return source.includes('vk_emoji_${');
    return source.includes(`"${key}"`)
        || source.includes(`'${key}'`)
        || source.includes(`\`${key}\``)
        || source.includes(`__MSG_${key}__`);
}
