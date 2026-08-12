import { vi } from 'vitest';

vi.stubGlobal('chrome', {
  i18n: {
    getMessage: (key: string) => key,
  },
  // Present in every extension context; rules that scope themselves to
  // extension-initiated requests read it.
  runtime: {
    id: 'test-extension-id',
  },
});
