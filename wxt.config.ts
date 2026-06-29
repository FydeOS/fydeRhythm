import { defineConfig } from 'wxt';
import { sharedManifest, sharedInputComponent, sharedVite, sharedHooks } from './wxt.config.base';

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
        'inputMethodPrivate'
      ],

      input_components: [
        {
          ...sharedInputComponent,
          indicator: '真',
          input_view: 'inputview/inputview.html'
        }
      ],

      update_url: 'https://store.fydeos.com/update/nfglebjgiflmmcdddkbcbgmdkomlfcpa/updates.xml'
    } as any;
  },

  vite: sharedVite,
  hooks: sharedHooks
});
