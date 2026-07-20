import { describe, expect, it } from 'vitest';

import { kEmojiCategories, kSkinTones, skinVariants, withSkinTone } from '../entrypoints/inputview/emoji/data';

describe('emoji catalog', () => {
  it('has no duplicate emoji within a category (React keys)', () => {
    for (const cat of kEmojiCategories) {
      const chars = cat.emoji.map(e => e.char);
      expect(new Set(chars).size, `duplicates in ${cat.id}`).toBe(chars.length);
      expect(chars.length, `${cat.id} is empty`).toBeGreaterThan(0);
    }
  });

  it('marks skin-tone support only on modifier-capable emoji', () => {
    for (const cat of kEmojiCategories) {
      for (const e of cat.emoji) {
        if (!e.skin) continue;
        const toned = withSkinTone(e.char, kSkinTones[0]);
        // The modifier must be attached to the first component, never
        // appended after an entire ZWJ sequence.
        expect(toned.indexOf(kSkinTones[0])).toBeLessThan(
          toned.indexOf('\u200D') < 0 ? toned.length : toned.indexOf('\u200D'),
        );
        expect(toned).not.toBe(e.char);
      }
    }
  });

  it('inserts a tone before a ZWJ and preserves selectors in later components', () => {
    expect(withSkinTone('🧑‍⚕️', kSkinTones[0])).toBe('🧑🏻‍⚕️');
    expect(withSkinTone('🧑‍🤝‍🧑', kSkinTones[0])).toBe('🧑🏻‍🤝‍🧑🏻');
    expect(withSkinTone('👩‍❤️‍💋‍👨', kSkinTones[0])).toBe('👩🏻‍❤️‍💋‍👨🏻');
    expect(withSkinTone('✌️', kSkinTones[0])).toBe('✌🏻');
  });

  it('skinVariants returns the base plus five tones', () => {
    const variants = skinVariants('👍');
    expect(variants).toHaveLength(6);
    expect(variants[0]).toBe('👍');
    expect(new Set(variants).size).toBe(6);
  });
});
