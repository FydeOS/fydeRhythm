import { defineConfig } from 'wxt';
import { sharedManifest, sharedInputComponent, sharedVite, sharedHooks } from './wxt.config.base';

// Chrome Web Store configuration - removes features not supported by Chrome Web Store
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'build',

  manifest: {
    ...sharedManifest,

    // Removed virtualKeyboardPrivate and inputMethodPrivate (not available on Web Store)
    permissions: [
      'storage',
      'unlimitedStorage',
      'input'
    ],

    input_components: [
      {
        ...sharedInputComponent
        // Removed indicator (not supported on Web Store)
        // Removed input_view (custom virtual keyboard not supported on Web Store)
      }
    ]

    // update_url is managed by Chrome Web Store
  } as any,

  vite: sharedVite,
  hooks: sharedHooks
});
