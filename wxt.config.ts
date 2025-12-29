import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: '__MSG_extension_name__',
    description: '__MSG_description__',
    default_locale: 'zh_CN',
    version: '2.1.5',
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

    // Permissions
    permissions: [
      'storage',
      'unlimitedStorage',
      'input',
      'virtualKeyboardPrivate',
      'inputMethodPrivate'
    ],

    // Content Security Policy for WASM
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    },

    // Web accessible resources
    web_accessible_resources: [
      {
        resources: [
          'rime_emscripten.wasm',
          'lz4_wasm_bg.wasm',
          'monaco/**',
          'logo.svg',
          'builtin/**'
        ],
        matches: ['https://www.plasmo.com/*']
      }
    ],

    // IME-specific configuration (Chrome private API)
    input_components: [
      {
        name: '__MSG_input_method_name__',
        id: 'fyde-rhythm',
        indicator: '真',
        language: ['zh-CN', 'zh', 'en', 'jp', 'ko', 'zh-TW'],
        layouts: ['us'],
        input_view: 'inputview/inputview.html'
      }
    ],

    // Update URL
    update_url: 'https://store.fydeos.com/update/nfglebjgiflmmcdddkbcbgmdkomlfcpa/updates.xml'
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
