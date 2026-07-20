import { describe, expect, it } from 'vitest';

import {
  type ClipboardHistoryGateway,
  type ClipboardHistoryItem,
  clipboardPreview,
  readClipboard,
} from '../entrypoints/inputview/clipboard';

function item(overrides: Partial<ClipboardHistoryItem> = {}): ClipboardHistoryItem {
  return {
    id: 'item',
    displayFormat: 'text',
    timeCopied: 1,
    textData: 'clipboard text',
    ...overrides,
  };
}

function gateway(items: readonly ClipboardHistoryItem[]): ClipboardHistoryGateway {
  return { getHistory: async () => items };
}

describe('InputView clipboard access', () => {
  it('returns every displayable item, newest first', async () => {
    const result = await readClipboard(gateway([
      item({ id: 'older', timeCopied: 10, textData: 'older text' }),
      item({ id: 'newer', timeCopied: 30, textData: 'newer text' }),
      item({ id: 'middle', timeCopied: 20, textData: 'middle text' }),
    ]));

    expect(result.status).toBe('items');
    if (result.status === 'items') {
      expect(result.items.map(({ id }) => id)).toEqual(['newer', 'middle', 'older']);
      expect(result.canDelete).toBe(false);
    }
  });

  it('keeps image entries and ignores entries with no preview data', async () => {
    const result = await readClipboard(gateway([
      item({ id: 'image', displayFormat: 'png', timeCopied: 20, textData: undefined }),
      item({ id: 'rendered-image', displayFormat: 'png', timeCopied: 15, textData: undefined, imageData: 'data:image/png;base64,a' }),
      item({ id: 'text', timeCopied: 10, textData: 'hello' }),
    ]));

    expect(result.status).toBe('items');
    if (result.status === 'items') {
      expect(result.items.map(({ id }) => id)).toEqual(['rendered-image', 'text']);
    }
  });

  it('distinguishes empty history from an API failure', async () => {
    expect(await readClipboard(gateway([]))).toEqual({ status: 'empty' });
    expect(await readClipboard({ getHistory: async () => { throw new Error('failed'); } }))
      .toEqual({ status: 'error' });
  });

  it('treats an empty text item as an empty clipboard', async () => {
    expect(await readClipboard(gateway([item({ textData: '' })])))
      .toEqual({ status: 'empty' });
  });

  it('preserves whitespace because it can be intentional paste content', async () => {
    const result = await readClipboard(gateway([item({ textData: '  \n' })]), { canDelete: true });
    expect(result.status).toBe('items');
    if (result.status === 'items') {
      expect(result.items[0].textData).toBe('  \n');
      expect(result.canDelete).toBe(true);
    }
  });
});

describe('clipboard preview', () => {
  it('leaves ordinary text unchanged', () => {
    expect(clipboardPreview('short text')).toBe('short text');
  });

  it('caps rendered content without splitting a surrogate pair', () => {
    const text = 'a'.repeat(1_999) + '😀' + 'tail';
    const preview = clipboardPreview(text);
    expect(preview).toBe('a'.repeat(1_999) + '…');
    expect(preview).not.toContain('\uFFFD');
  });
});
