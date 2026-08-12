import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// The keyboard carries its own copy of every string for the dev mock, where
// chrome.i18n does not exist. Two tables of the same text drift silently, and
// the layout audit reads the mock — so it would be reading the stale one.
const source = readFileSync('entrypoints/inputview/i18n.ts', 'utf8');
const table = source.slice(source.indexOf('kFallbacks'));
const fallbacks = Object.fromEntries(
  [...table.slice(0, table.indexOf('\n};')).matchAll(/^ {2}([a-z0-9_]+): '((?:[^'\\]|\\.)*)',$/gm)]
    .map(([, key, value]) => [key, value.replace(/\\'/g, '\'')]),
);
const messages = JSON.parse(
  readFileSync('public/_locales/zh_CN/messages.json', 'utf8'),
) as Record<string, { message: string }>;

describe('the keyboard\'s fallback copy', () => {
  it('is the table this test thinks it is', () => {
    // Without this the drift check passes vacuously the day the table is
    // reformatted out of the regex's reach.
    expect(Object.keys(fallbacks).length).toBeGreaterThan(50);
  });

  it('says exactly what zh_CN says', () => {
    const drifted = Object.entries(fallbacks)
      .filter(([key, message]) => messages[key]?.message !== message)
      .map(([key, message]) => ({ key, fallback: message, zh_CN: messages[key]?.message }));
    expect(drifted).toEqual([]);
  });
});
