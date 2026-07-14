import type { ClipboardHistoryItem, ClipboardReadResult } from './clipboard';

const kTransparentPixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAADUlEQVR42mNk+M/wHwAF/gL+XzNfWQAAAABJRU5ErkJggg==';

const kDefaultItems: readonly ClipboardHistoryItem[] = [
    { id: 'mock-1', displayFormat: 'text', timeCopied: 30, textData: 'Clipboard text stays local and is read only when you open this panel.' },
    { id: 'mock-2', displayFormat: 'text', timeCopied: 20, textData: 'Multiple history items stay compact instead of stretching.' },
    { id: 'mock-3', displayFormat: 'text', timeCopied: 10, textData: 'Tap any card to paste it.' },
    { id: 'mock-4', displayFormat: 'png', timeCopied: 5, imageData: kTransparentPixel },
];

function fixtureMode(): string | null {
    return new URLSearchParams(window.location.search).get('clipboard');
}

// Deterministic states for browser development and the InputView layout audit.
// Real ChromeOS/FydeOS sessions never construct MockHost and never read these.
export function readMockClipboard(): Promise<ClipboardReadResult> {
    const mode = fixtureMode();
    if (mode === 'loading') return new Promise(() => undefined);
    if (mode === 'empty') return Promise.resolve({ status: 'empty' });
    if (mode === 'unavailable') return Promise.resolve({ status: 'unavailable' });

    const usesDefaultItems = mode === null || mode === 'delete-fails' || mode === 'delete-pending';
    return Promise.resolve({
        status: 'items',
        canDelete: true,
        items: usesDefaultItems ? kDefaultItems : [{
            id: 'mock-1',
            displayFormat: 'text',
            timeCopied: Date.now(),
            textData: mode,
        }],
    });
}

export function deleteMockClipboardItem(): Promise<boolean> {
    const mode = fixtureMode();
    if (mode === 'delete-pending') return new Promise(() => undefined);
    return Promise.resolve(mode !== 'delete-fails');
}
