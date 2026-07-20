// virtualKeyboardPrivate is allowlisted, so it exists on FydeOS and not on stock
// ChromeOS (the Web Store build drops it; see wxt.config.webstore.ts).
export function hasInputView(): boolean {
  return (globalThis.chrome as unknown as { virtualKeyboardPrivate?: unknown } | undefined)
    ?.virtualKeyboardPrivate !== undefined;
}
