// Whether this device shows OUR keyboard. input_view and virtualKeyboardPrivate
// are both allowlisted, so they exist on FydeOS and not on stock ChromeOS (the
// Web Store build drops them from the manifest; see wxt.config.webstore.ts).
// Gates the on-screen half only — the physical remap runs everywhere.
export function hasInputView(): boolean {
    return (globalThis.chrome as unknown as { virtualKeyboardPrivate?: unknown } | undefined)
        ?.virtualKeyboardPrivate !== undefined;
}
