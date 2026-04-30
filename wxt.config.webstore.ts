import { defineConfig } from 'wxt';

// Chrome Web Store configuration - removes features not supported by Chrome Web Store
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'build',

  manifest: {
    name: '__MSG_extension_name__',
    description: '__MSG_description__',
    default_locale: 'zh_CN',
    version: '3.0.1',
    author: 'fydeos',

    // Icons
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      64: '/icon-64.png',
      128: '/icon-128.png'
    },

    // Action with default icon (for toolbar button)
    action: {
      default_icon: {
        16: '/icon-16.png',
        32: '/icon-32.png',
        48: '/icon-48.png',
        64: '/icon-64.png',
        128: '/icon-128.png'
      }
    },

    // Permissions - REMOVED private permissions for Chrome Web Store
    permissions: [
      'storage',
      'unlimitedStorage',
      'input'
      // NOTE: Removed virtualKeyboardPrivate and inputMethodPrivate (not available on Web Store)
    ],

    // Content Security Policy for WASM
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    },

    // IME-specific configuration - MODIFIED for Chrome Web Store
    input_components: [
      {
        name: '__MSG_input_method_name__',
        id: 'fyde-rhythm',
        // NOTE: Removed 'indicator' (not supported on Chrome Web Store)
        language: ['zh-CN', 'zh', 'en', 'jp', 'ko', 'zh-TW'],
        layouts: ['us']
        // NOTE: Removed 'input_view' (custom virtual keyboard not supported on Chrome Web Store)
      }
    ]

    // NOTE: Removed 'update_url' (managed by Chrome Web Store)
  } as any,

  // Vite configuration
  vite: () => ({
    build: {
      // Don't inline WASM files
      assetsInlineLimit: 0,
      // Increase chunk size warning limit (our options page is legitimately large)
      chunkSizeWarningLimit: 1500, // 1500 kB instead of default 500 kB
      rollupOptions: {
        output: {
          // Keep WASM file names predictable
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.wasm')) {
              return '[name].[ext]';
            }
            return 'assets/[name]-[hash].[ext]';
          }
        },
        // Suppress eval warning from lottie-web (third-party library, safe in our context)
        onwarn(warning, warn) {
          if (
            warning.code === 'EVAL' &&
            warning.id?.includes('lottie-web')
          ) {
            return; // Suppress lottie-web eval warning
          }
          warn(warning); // Show other warnings
        }
      }
    }
  })
});
