// chrome.i18n wrapper for the keyboard page. In the desktop mock (plain tab)
// chrome.i18n doesn't exist, so every key carries a fallback — which doubles
// as the reference list of the InputView's message keys.

const kFallbacks: Record<string, string> = {
  vk_delete_word_confirm: '删除「$1」?',
  vk_delete: '删除',
  vk_cancel: '取消',
  vk_candidates_announce: '$1 个候选',
  vk_alt_characters: '候选字符',
  vk_settings: '设置',
  vk_emoji: '表情符号',
  vk_clipboard: '剪贴板',
  vk_clipboard_current: '当前剪贴板',
  vk_clipboard_paste_short: '粘贴',
  vk_clipboard_loading: '正在读取剪贴板…',
  vk_clipboard_empty: '剪贴板中没有文本',
  vk_clipboard_unavailable: '剪贴板不可用',
  vk_clipboard_error: '无法读取剪贴板',
  vk_clipboard_retry: '重试',
  vk_clipboard_paste: '粘贴剪贴板文本',
  vk_clipboard_close: '关闭剪贴板',
  vk_clipboard_delete: '删除剪贴板项目',
  vk_clipboard_delete_error: '未能删除，请重试',
  vk_switch_schema: '切换方案',
  vk_prev_page: '上一页',
  vk_next_page: '下一页',
  vk_expand_candidates: '展开候选',
  vk_collapse_candidates: '收起候选',
  vk_recent_emoji: '最近使用',
  vk_back_to_keyboard: '返回键盘',
  vk_key_shift: 'Shift',
  vk_key_backspace: '退格',
  vk_key_enter: '回车',
  vk_key_space: '空格',
  vk_key_hide: '收起键盘',
  vk_kbmode_docked: '停靠键盘',
  vk_kbmode_floating: '浮动键盘',
  vk_kbmode_onehand: '单手键盘',
  vk_resize_keyboard: '调整键盘大小',
  vk_pin_left: '固定到左下角',
  vk_pin_right: '固定到右下角',
  vk_exit_onehand: '退出单手模式',
  vk_key_symbols: '符号键盘',
  vk_key_more_symbols: '更多符号',
  vk_key_letters: '字母键盘',
  vk_key_toggle_language: '中英切换',
  vk_emoji_smileys: '表情',
  vk_emoji_gestures: '手势',
  vk_emoji_people: '人物',
  vk_emoji_hearts: '心形',
  vk_emoji_animals: '动物',
  vk_emoji_food: '食物',
  vk_emoji_activities: '活动',
  vk_emoji_travel: '旅行',
  vk_emoji_objects: '物品',
  vk_emoji_symbols: '符号',
  vk_emoji_flags: '旗帜',
  vk_voice: '语音输入',
  vk_voice_hint: '开始说话',
  vk_voice_idle: '已结束',
  vk_voice_again: '轻触麦克风继续',
  vk_voice_recording: '正在录音',
  vk_voice_connecting: '正在连接…',
  vk_voice_finalizing: '正在整理…',
  vk_voice_stop: '停止',
  vk_voice_permission_title: '需要麦克风权限',
  vk_voice_permission_body: '要使用语音输入，请到设置页开启并选择“每次访问时允许”。',
  vk_voice_permission_open: '前往设置',
  vk_voice_error_microphone: '无法使用麦克风',
  vk_voice_error_network: '网络连接中断',
  vk_voice_error_server: '语音服务暂时不可用',
  vk_voice_error_unknown: '语音输入出错了',
  vk_voice_error_auth: '语音服务拒绝了连接',
  vk_voice_error_auth_body: '请到设置页检查 API 密钥。',
  vk_voice_error_signin_body: '请到设置页重新登录，或改用自己的密钥。',
  vk_voice_error_quota: '语音服务额度已用完',
  vk_voice_error_quota_body: '可到设置页改用自己的密钥。',
  vk_voice_error_body: '可以先用键盘继续输入。',
};

/** The browser UI language, or an empty string in a dev tab. Callers treat an
 *  unknown language as "no regional preference". */
export function uiLanguage(): string {
  try {
    return chrome.i18n.getUILanguage();
  }
  catch {
    return '';
  }
}

export function t(key: string, substitutions?: string | string[]): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
  }
  catch { /* dev tab without extension APIs */ }
  const fallback = kFallbacks[key] ?? key;
  const sub = Array.isArray(substitutions) ? substitutions[0] : substitutions;
  return fallback.replace('$1', sub ?? '');
}
