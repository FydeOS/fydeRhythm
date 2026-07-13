// Layout audit for the InputView keyboard.
//
//   pnpm audit:inputview            sweep every placement x keyboard state
//   pnpm audit:inputview --serve    leave the mock server up to poke at by hand
//   VERBOSE=1 pnpm audit:inputview  print the card and key sizes per render
//
// The keyboard's geometry only exists once it is laid out, so this drives the
// real page: it serves the InputView mock (chrome-shim falls back to MockHost
// outside the extension), loads it at each placement and state, and measures
// every key. Exits non-zero on any finding, so it can gate a change.
//
// Fidelity: on ChromeOS the keyboard IS its own OS window, so the viewport
// equals the card and window.screen is the device screen. The window is sized
// from geometryFor() — the SAME function the keyboard uses, loaded from source
// through Vite — so the audit cannot drift from the thing it audits, and it can
// never measure a card size the device would not produce.

import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import Icons from 'unplugin-icons/vite';
import { chromium } from 'playwright';
import { placements, screens, states } from './matrix.mjs';
import { applyStep, inspectKeyboard, inspectPress, installInkHelpers } from './checks.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '/entrypoints/inputview/index.html';
const kPlacementPrefKey = 'inputViewFloating'; // chrome-shim.ts

async function serve() {
    const server = await createServer({
        configFile: false,
        root: repo,
        // Same `~icons/...` compilation as the extension build; esbuild covers
        // the automatic JSX runtime, so no React plugin is needed.
        plugins: [Icons({ compiler: 'jsx', jsx: 'react' })],
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@': repo } },
        server: { port: 5199 },
        logLevel: 'warn',
    });
    await server.listen();
    return { server, origin: `http://localhost:${server.config.server.port}` };
}

async function main() {
    const { server, origin } = await serve();
    if (process.argv.includes('--serve')) {
        console.log(`mock keyboard: ${origin}${PAGE}  (ctrl-c to stop)`);
        return;
    }

    // The keyboard's own geometry function, from source.
    const { geometryFor } = await server.ssrLoadModule('/entrypoints/inputview/chrome-shim.ts');

    const browser = await chromium.launch();
    const report = [];
    let renders = 0;
    let keys = 0;

    for (const screen of screens) {
        for (const placement of placements) {
            const before = report.length;

            for (const state of states) {
                const label = `${screen.name}/${placement.name}/${state.name}`;
                const card = geometryFor(placement.pref, screen, state.rows);
                if (!card.width || !card.height) {
                    report.push(`${label}: geometryFor returned no card`);
                    continue;
                }

                // The window IS the card; the screen stays the device's. Set both
                // at creation — setViewportSize() would also rewrite window.screen,
                // and the keyboard recomputes its card from that on every render.
                const context = await browser.newContext({
                    screen: { width: screen.width, height: screen.height },
                    viewport: { width: card.width, height: card.height },
                    deviceScaleFactor: screen.dsf,
                });
                await context.addInitScript(
                    ([key, pref]) => window.localStorage.setItem(key, JSON.stringify(pref)),
                    [kPlacementPrefKey, placement.pref],
                );
                // The checks are serialized one function at a time, so their
                // shared ink helpers have to already be in the page.
                await context.addInitScript(installInkHelpers);

                const page = await context.newPage();
                page.on('pageerror', (err) => report.push(`${label}: page error — ${err.message.split('\n')[0]}`));
                page.on('console', (msg) => {
                    if (msg.type() === 'error') report.push(`${label}: console error — ${msg.text().slice(0, 120)}`);
                });

                await page.goto(`${origin}${PAGE}${state.query ?? ''}`);
                await page.waitForSelector('.kb-key', { timeout: 5000 });

                // Every step says what it expects to appear. A step that taps the
                // right element and achieves nothing (a click handler where we
                // sent pointer events) would otherwise re-audit the plain
                // keyboard and pass.
                for (const step of state.steps ?? []) {
                    const miss = await page.evaluate(applyStep, step);
                    if (miss) report.push(`${label}: ${miss}`);
                    if (step.expect) {
                        try {
                            await page.waitForSelector(step.expect, { timeout: 2000, state: 'attached' });
                        } catch {
                            report.push(`${label}: step did nothing — "${step.expect}" never appeared`);
                        }
                    } else {
                        await page.waitForTimeout(120);
                    }
                }

                const { findings: found, stats } = await page.evaluate(inspectKeyboard, {
                    rows: state.rows,
                    card: { width: card.width, height: card.height },
                });
                // Press a key and check the preview it raises — the only part of
                // the keyboard that doesn't exist until a finger is down.
                const press = await page.evaluate(inspectPress);
                found.push(...press.findings);

                renders++;
                keys += stats?.keys ?? 0;
                for (const f of found) report.push(`${label}: ${f}`);
                if (process.env.VERBOSE && stats) {
                    console.log(`  ${label.padEnd(40)} card ${stats.card.padEnd(9)} ${String(stats.keys).padStart(2)} keys, min ${stats.minKey.padEnd(7)} ${press.previewed ?? ''}`);
                }
                await page.close();
                await context.close();
            }

            const failed = report.length - before;
            console.log(`  ${screen.name}/${placement.name}`.padEnd(34)
                + `${states.length} states  ${failed ? `✖ ${failed}` : '✓'}`);
        }
    }

    await browser.close();
    await server.close();

    console.log(`\n${renders} renders, ${keys} keys checked, ${report.length} findings`);
    for (const line of report) console.log(`  ✖ ${line}`);
    process.exit(report.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
