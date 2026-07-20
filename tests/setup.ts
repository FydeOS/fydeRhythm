import { vi } from 'vitest';

vi.stubGlobal('chrome', {
  i18n: {
    getMessage: (key: string) => key,
  },
});
