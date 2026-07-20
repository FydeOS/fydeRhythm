import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { defineConfig } from 'wxt';

import { sharedHooks, sharedInputComponent, sharedManifest, sharedVite } from './wxt.config.base';

// WXT loads .env files after importing this config, so read the key when the manifest is resolved.
const getExtensionKey = () => process.env.FYDE_RHYTHM_KEY?.trim();

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'build',
  imports: {
    eslintrc: {
      enabled: 9,
    },
  },

  manifest: () => {
    const extensionKey = getExtensionKey();

    return {
      ...sharedManifest,
      ...(extensionKey && { key: extensionKey }),

      permissions: [
        'storage',
        'unlimitedStorage',
        'input',
        'virtualKeyboardPrivate',
        'inputMethodPrivate',
      ],

      input_components: [
        {
          ...sharedInputComponent,
          indicator: '真',
          // Must stay at the legacy path: ChromeOS caches the input_view URL
          // from the IME registration, so devices that ever ran an older build
          // keep loading this exact URL after upgrades. The WXT entrypoint
          // emits /inputview.html; the build:done hook below copies it here
          // (all asset references in the page are absolute, so the copy works
          // from any directory).
          input_view: 'inputview/inputview.html',
        },
      ],

      update_url: 'https://store.fydeos.com/update/nfglebjgiflmmcdddkbcbgmdkomlfcpa/updates.xml',
    } as any;
  },

  vite: sharedVite,
  hooks: {
    ...sharedHooks,
    'build:done': async (wxt) => {
      // See input_view above: serve the new keyboard page at the legacy URL.
      const outDir = wxt.config.outDir;
      await mkdir(join(outDir, 'inputview'), { recursive: true });
      await copyFile(join(outDir, 'inputview.html'), join(outDir, 'inputview', 'inputview.html'));
    },
  },
});
