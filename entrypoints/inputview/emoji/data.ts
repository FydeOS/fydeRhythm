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

const kEmojiModifierBase = /\p{Emoji_Modifier_Base}/u;

// Apply a skin-tone modifier to the person at each edge of a compound sequence.
// Multi-person sequences tone both people, while connectors in the middle stay
// unchanged. VS16 on a toned base is redundant, but selectors on later symbols
// still matter (for example the one after ⚕ in 🧑‍⚕️).
export function withSkinTone(base: string, tone: string): string {
    const components = base.split('\u200D');
    const toneComponent = (component: string) => component.replace(/\uFE0F/g, '') + tone;
    components[0] = toneComponent(components[0]);
    const last = components.length - 1;
    if (last > 0 && kEmojiModifierBase.test(components[last])) {
        components[last] = toneComponent(components[last]);
    }
    return components.join('\u200D');
}

export function skinVariants(base: string): string[] {
    return [base, ...kSkinTones.map((t) => withSkinTone(base, t))];
}

export { kEmojiCategories } from './catalog';
