// Emoji catalog for the InputView emoji panel. The category data itself lives
// in catalog.ts (generated from emojibase-data by scripts/gen-emoji.mjs); this
// file holds the shared types and skin-tone helpers. Rendered with the system
// emoji font. `skin: true` marks emoji that take Fitzpatrick modifiers.

export interface EmojiDef {
    char: string;
    skin?: boolean;
}

export interface EmojiCategory {
    // Tab names resolve via i18n as vk_emoji_<id>.
    id: string;
    icon: string;
    emoji: EmojiDef[];
}

export const kSkinTones = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

// Apply a skin-tone modifier: strip an existing VS16 (U+FE0F) first — a
// modifier already implies emoji presentation.
export function withSkinTone(base: string, tone: string): string {
    return base.replace(/️/g, '') + tone;
}

export function skinVariants(base: string): string[] {
    return [base, ...kSkinTones.map((t) => withSkinTone(base, t))];
}

export { kEmojiCategories } from './catalog';
