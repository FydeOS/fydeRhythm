export type ClipboardReadResult
  = | { status: 'items'; items: readonly ClipboardHistoryItem[]; canDelete: boolean }
    | { status: 'empty' }
    | { status: 'unavailable' }
    | { status: 'error' };

// The subset of chrome.virtualKeyboardPrivate.ClipboardItem used by the
// InputView. Keeping this boundary local avoids leaking a ChromeOS-private API
// through the React components.
export interface ClipboardHistoryItem {
  id: string;
  displayFormat: 'text' | 'png' | 'html' | 'file';
  timeCopied: number;
  textData?: string;
  imageData?: string;
}

export interface ClipboardHistoryGateway {
  getHistory(): Promise<readonly ClipboardHistoryItem[]>;
}

const kMaxPreviewCodeUnits = 2_000;

export function clipboardPreview(text: string): string {
  if (text.length <= kMaxPreviewCodeUnits) return text;
  let preview = text.slice(0, kMaxPreviewCodeUnits);
  // Avoid cutting an emoji/supplementary character between its UTF-16 pair.
  if (/\p{Surrogate}$/u.test(preview)) preview = preview.slice(0, -1);
  return preview + '…';
}

// ChromeOS owns access control, retention, ordering and deletion for clipboard
// history (and returns no history on the lock screen). We only normalize the
// displayable items while the panel is open; the extension stores no copy.
export async function readClipboard(
  gateway: ClipboardHistoryGateway,
  options: { canDelete?: boolean } = {},
): Promise<ClipboardReadResult> {
  try {
    const items = await gateway.getHistory();
    const displayable = [...items]
      .filter(item =>
        (typeof item.textData === 'string' && item.textData.length > 0)
        || (typeof item.imageData === 'string' && item.imageData.length > 0))
      .sort((a, b) => b.timeCopied - a.timeCopied);

    if (displayable.length === 0) return { status: 'empty' };
    return { status: 'items', items: displayable, canDelete: options.canDelete ?? false };
  }
  catch {
    return { status: 'error' };
  }
}
