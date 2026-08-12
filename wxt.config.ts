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
        // Voice input authenticates in the WebSocket handshake headers, which a
        // browser cannot set; a dynamic rule injects them. Measured working for
        // an extension's own request on device (ADR 0002, V1).
        'declarativeNetRequestWithHostAccess',
      ],

      // modifyHeaders only applies to hosts the extension already has access
      // to. wss:// is the request's own scheme — the probe confirmed a ws://
      // host permission is honoured for a WebSocket rule.
      host_permissions: ['wss://openspeech.bytedance.com/*'],

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
