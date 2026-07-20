import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'entrypoints/**/*.{ts,tsx}',
        'lib/**/*.ts',
      ],
      exclude: [
        'entrypoints/options/main.tsx',
        'entrypoints/options/utils/animation.tsx',
        'entrypoints/background/rime_emscripten.d.ts',
        'entrypoints/background/types/**',
        '**/*.d.ts',
      ],
    },
  },
});
