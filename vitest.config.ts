import { fileURLToPath } from 'node:url';

import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Component tests import the icon set through `~icons/*`, same as the build.
  plugins: [Icons({ compiler: 'jsx', jsx: 'react' })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Component tests are .tsx and opt into jsdom with a per-file
    // `@vitest-environment` docblock; everything else stays on node.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
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
