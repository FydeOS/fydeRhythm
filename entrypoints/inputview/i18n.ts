// chrome.i18n wrapper for the keyboard page. In the desktop mock (plain tab)
// chrome.i18n doesn't exist, so every key carries a fallback — which doubles
// as the reference list of the InputView's message keys.

const kFallbacks: Record<string, string> = {
    vk_delete_word_confirm: "删除「$1」?",
    vk_delete: "删除",
    vk_cancel: "取消",
    vk_candidates_announce: "$1 个候选",
    vk_alt_characters: "候选字符",
    vk_settings: "设置",
    vk_emoji: "表情符号",
    vk_switch_schema: "切换方案",
    vk_prev_page: "上一页",
    vk_next_page: "下一页",
    vk_expand_candidates: "展开候选",
    vk_collapse_candidates: "收起候选",
    vk_recent_emoji: "最近使用",
    vk_back_to_keyboard: "返回键盘",
    vk_key_shift: "Shift",
    vk_key_backspace: "退格",
    vk_key_enter: "回车",
    vk_key_space: "空格",
    vk_key_hide: "收起键盘",
    vk_key_symbols: "符号",
    vk_key_more_symbols: "更多符号",
    vk_key_letters: "字母",
    vk_key_toggle_language: "中英切换",
    vk_emoji_smileys: "表情",
    vk_emoji_gestures: "手势",
    vk_emoji_people: "人物",
    vk_emoji_hearts: "心形",
    vk_emoji_animals: "动物",
    vk_emoji_food: "食物",
    vk_emoji_activities: "活动",
    vk_emoji_travel: "旅行",
    vk_emoji_objects: "物品",
    vk_emoji_symbols: "符号",
    vk_emoji_flags: "旗帜",
};

export function t(key: string, substitutions?: string | string[]): string {
    try {
        if (typeof chrome !== "undefined" && chrome.i18n) {
            const msg = chrome.i18n.getMessage(key, substitutions);
            if (msg) return msg;
        }
    } catch { /* dev tab without extension APIs */ }
    const fallback = kFallbacks[key] ?? key;
    const sub = Array.isArray(substitutions) ? substitutions[0] : substitutions;
    return fallback.replace("$1", sub ?? "");
}
