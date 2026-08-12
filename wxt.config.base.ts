import { fileURLToPath } from 'node:url';

import Icons from 'unplugin-icons/vite';
import type { UserConfig, WxtHooks } from 'wxt';

const licensePath = fileURLToPath(new URL('./LICENSE', import.meta.url));

// Bundle the repo's BSD LICENSE into every build output, without keeping a
// duplicate copy in public/.
export const sharedHooks: Partial<WxtHooks> = {
  'build:publicAssets': (_wxt, assets) => {
    assets.push({ absoluteSrc: licensePath, relativeDest: 'LICENSE' });
  },
};

const icons = {
  16: '/icon-16.png',
  32: '/icon-32.png',
  48: '/icon-48.png',
  64: '/icon-64.png',
  128: '/icon-128.png',
};

export const sharedManifest = {
  name: '__MSG_extension_name__',
  description: '__MSG_description__',
  default_locale: 'zh_CN',
  author: 'fydeos',
  icons,
  action: { default_icon: icons },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
};

export const sharedInputComponent = {
  name: '__MSG_input_method_name__',
  id: 'fyde-rhythm',
  language: ['zh-CN', 'zh', 'en', 'jp', 'ko', 'zh-TW'],
  layouts: ['us'],
};

// FYDE_ASR_KEY is not WXT_-prefixed, so it is not exposed to the bundle
// automatically; injecting it here keeps the .env variable name as the one the
// team already uses. Absent on a machine without .env, which is exactly what
// makes such a build carry no voice feature at all.
export const asrDefine = () => ({
  'import.meta.env.FYDE_ASR_KEY': JSON.stringify(process.env.FYDE_ASR_KEY?.trim() ?? ''),
  'import.meta.env.FYDE_ASR_RESOURCE_ID': JSON.stringify(
    process.env.FYDE_ASR_RESOURCE_ID?.trim() ?? 'volc.bigasr.sauc.duration',
  ),
});

export const sharedVite: UserConfig['vite'] = () => ({
  define: asrDefine(),
  // `~icons/<set>/<name>` imports compile to inline SVG React components at
  // build time — no runtime dependency or network fetch, so they stay within
  // the extension's strict CSP. Only imported icons are bundled.
  plugins: [Icons({ compiler: 'jsx', jsx: 'react' })],
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
        },
      },
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.includes('lottie-web')) {
          return;
        }
        warn(warning);
      },
    },
  },
});
