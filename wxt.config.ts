import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { defineConfig } from 'wxt';

import { kDefaultGateway, kDefaultIssuer, voiceEnabled } from './lib/voice-build';
import { sharedHooks, sharedInputComponent, sharedManifest, sharedVite } from './wxt.config.base';

// WXT loads .env files after importing this config, so read the key when the manifest is resolved.
const getExtensionKey = () => process.env.FYDE_RHYTHM_KEY?.trim();

const voiceBuild = () => voiceEnabled(process.env.FYDE_VOICE_INPUT);

// The same values the bundle resolves, so a build cannot be granted one host
// and dial another.
const gateway = () => process.env.FYDE_ASR_GATEWAY?.trim() || kDefaultGateway;

/** Sign-in talks to the account server directly — the extension is a public
 *  OAuth client — so that host needs access of its own; the gateway's does not
 *  cover it. */
const accountIssuer = () => process.env.FYDE_ACCOUNT_ISSUER?.trim() || kDefaultIssuer;

/** Match patterns for a configured URL, in both schemes it is used with:
 *  the socket scheme for dictation and the matching http(s) one for fetches.
 *  Derived from the URL rather than fixed, so a plain-http development
 *  deployment is granted what it actually dials. Hostname, not host: a match
 *  pattern may not carry a port, and ignores it anyway.
 *
 *  A wss:// gateway therefore yields wss:// + https://, and a ws:// one
 *  ws:// + http://. */
function hostPermissionsFor(raw: string, name: string): string[] {
  // Only reached in a voice build, where an empty host is a misconfiguration.
  if (!raw) throw new Error(`FYDE_VOICE_INPUT is set but ${name} has no value`);
  let url: URL;
  try {
    url = new URL(raw);
  }
  catch {
    throw new Error(`${name} is not a URL: ${raw}`);
  }
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  return secure
    ? [`wss://${url.hostname}/*`, `https://${url.hostname}/*`]
    : [`ws://${url.hostname}/*`, `http://${url.hostname}/*`];
}

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
        ...voiceBuild()
          ? [
              // A key of the user's own reaches Volcano directly, authenticating
              // in handshake headers a browser cannot set; a dynamic rule
              // injects them. Measured working for an extension's own request on
              // device (ADR 0002, V1).
              'declarativeNetRequestWithHostAccess',
              // launchWebAuthFlow, for FydeOS account sign-in.
              'identity',
            ]
          : [],
      ],

      // modifyHeaders only applies to hosts the extension already has access
      // to. wss:// is the request's own scheme — the probe confirmed a ws://
      // host permission is honoured for a WebSocket rule.
      //
      // The gateway host comes from the same value the code connects to, so a
      // build cannot be granted one host and dial another.
      host_permissions: voiceBuild()
        ? [
            'wss://openspeech.bytedance.com/*',
            ...hostPermissionsFor(gateway(), 'FYDE_ASR_GATEWAY'),
            // Resolved, not raw: an unset issuer still has a default the code
            // will dial, and a permission it lacked would fail at sign-in.
            ...hostPermissionsFor(accountIssuer(), 'FYDE_ACCOUNT_ISSUER'),
          ]
        : [],

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
