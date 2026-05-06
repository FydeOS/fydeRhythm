import type { UserConfig } from 'wxt';

const icons = {
  16: '/icon-16.png',
  32: '/icon-32.png',
  48: '/icon-48.png',
  64: '/icon-64.png',
  128: '/icon-128.png'
};

export const sharedManifest = {
  name: '__MSG_extension_name__',
  description: '__MSG_description__',
  default_locale: 'zh_CN',
  author: 'fydeos',
  icons,
  action: { default_icon: icons },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
};

export const sharedInputComponent = {
  name: '__MSG_input_method_name__',
  id: 'fyde-rhythm',
  language: ['zh-CN', 'zh', 'en', 'jp', 'ko', 'zh-TW'],
  layouts: ['us']
};

export const sharedVite: UserConfig['vite'] = () => ({
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return '[name].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        }
      },
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.includes('lottie-web')) {
          return;
        }
        warn(warning);
      }
    }
  }
});
