import { beforeEach, describe, expect, it, vi } from 'vitest';

import IMEOptions from '../entrypoints/options/utils/options';

function stubFetch(text: string) {
  const fetchMock = vi.fn(async () => ({
    text: async () => text,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('IME options HTTP client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the current schema and reports whether the service echoed it', async () => {
    const fetchMock = stubFetch('luna');

    await expect(IMEOptions.setSchema('luna')).resolves.toEqual({
      success: true,
      msg: 'luna',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:12346/schema/current', {
      method: 'PUT',
      body: 'luna',
    });
  });

  it('reports failed schema updates when the service echoes another value', async () => {
    stubFetch('aurora');

    await expect(IMEOptions.setSchema('luna')).resolves.toEqual({
      success: false,
      msg: 'aurora',
    });
  });

  it('gets the current schema', async () => {
    const fetchMock = stubFetch('aurora');

    await expect(IMEOptions.getSchema()).resolves.toBe('aurora');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:12346/schema/current', {
      method: 'GET',
    });
  });

  it('gets, adds, and removes fuzzy options with the expected HTTP methods', async () => {
    const fetchMock = stubFetch('derive/a/b/\nderive/c/d/');

    await expect(IMEOptions.getFuzzy()).resolves.toEqual(['derive/a/b/', 'derive/c/d/']);
    await expect(IMEOptions.addFuzzy('derive/e/f/')).resolves.toEqual(['derive/a/b/', 'derive/c/d/']);
    await expect(IMEOptions.removeFuzzy('derive/a/b/')).resolves.toEqual(['derive/a/b/', 'derive/c/d/']);

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:12346/algebra', {
      method: 'GET',
      body: '',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:12346/algebra', {
      method: 'POST',
      body: 'derive/e/f/',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:12346/algebra', {
      method: 'DELETE',
      body: 'derive/a/b/',
    });
  });
});
