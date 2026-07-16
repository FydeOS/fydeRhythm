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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import Icons from 'unplugin-icons/vite';
import { chromium } from 'playwright';
import { placements, screens, states } from './matrix.mjs';
import { applyStep, inspectKeyboard, inspectPopovers, inspectPress, installInkHelpers, matchedSelectors, matchedWhilePressed } from './checks.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '/entrypoints/inputview/index.html';
const kPlacementPrefKey = 'inputViewFloating'; // chrome-shim.ts

// Every selector the stylesheet defines, so the sweep can report the ones that
// match nothing. Interaction pseudo-classes are stripped rather than skipped:
// `.kb-key:hover` is the same element as `.kb-key`, and we want to know that the
// ELEMENT exists — a hover rule for a component that no longer renders is just
// as dead as any other.
function stylesheetSelectors() {
    const css = readFileSync(`${repo}/entrypoints/inputview/md3.css`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = new Set();
    for (const [, group] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const raw of group.split(',')) {
            const sel = raw
                .trim()
                // State and generated content: the rule targets an element that
                // must exist; the state itself is the component's business.
                // (focus-visible BEFORE focus, or the alternation eats the stem
                // and leaves "-visible" behind as a selector of its own.)
                .replace(/::?(hover|active|focus-visible|focus|before|after|-webkit-[\w-]+)\b(\([^)]*\))?/g, '')
                .trim();
            // Skip at-rules, the root/global rules, and anything left empty.
            if (!sel || sel.startsWith('@') || /^[*]$/.test(sel)) continue;
            if (/^(html|body|:root|#root)/.test(sel)) continue;
            // Animation steps are declarations inside @keyframes, not DOM
            // selectors. The lightweight parser intentionally does not build a
            // full CSS AST, so discard their selector-like tokens here.
            if (sel === 'from' || sel === 'to' || /^\d+%$/.test(sel)) continue;
            selectors.add(sel);
        }
    }
    return [...selectors];
}

// A var() pointing at a custom property nobody defines computes to nothing, and
// the whole declaration is thrown away — silently. That is how the schema menu
// lost its shadow: the Keyline palette dropped --kb-popup-shadow and two rules
// kept referencing it, so they computed to `box-shadow: none` and the menu
// became a slab the same colour as the keys under it. Nothing in CSS complains.
function undefinedCustomProperties(publishedByTs) {
    const css = readFileSync(`${repo}/entrypoints/inputview/md3.css`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set(publishedByTs);
    for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(name);
    const missing = new Set();
    for (const [, name] of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!defined.has(name)) missing.add(name);
    }
    return [...missing];
}

// Press each kind of key with a real mouse and check that it actually LOOKS
// pressed. A selector can match, its rule can be live, and the cascade can still
// throw the declaration away: the press was declared before `.kb-key.fn` at the
// same specificity, so every function key and space silently never changed
// colour under the finger. Only the computed style can see that — and only a
// real pointer, since a dispatched PointerEvent never sets :active.
async function inspectFeedback(page, label, report) {
    const kinds = {
        letter: '.kb-key:not(.spacer):not(.fn):not(.enter):not(.space)',
        function: '.kb-key.fn:not(.enter):not(.space):not(.kb-emoji-side)',
        space: '.kb-key.space',
        enter: '.kb-key.enter',
        'emoji side': '.kb-emoji-side',
    };
    for (const [kind, sel] of Object.entries(kinds)) {
        const el = await page.$(sel);
        if (!el) continue;
        const box = await el.boundingBox();
        if (!box) continue;

        // A real mouse hits whatever is on top. Panels (the expanded candidate
        // list, the emoji grid) legitimately cover the keys — pressing "through"
        // one would measure the panel, not the key.
        const reachable = await el.evaluate((e) => {
            const r = e.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return e === top || e.contains(top);
        });
        if (!reachable) continue;

        // Let any in-flight 90ms transition finish before reading the rest state.
        await page.waitForTimeout(140);
        const style = () => el.evaluate((e) => {
            const cs = getComputedStyle(e);
            return { bg: cs.backgroundColor, shadow: cs.boxShadow, transform: cs.transform };
        });
        const resting = await style();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(160);
        const pressed = await style();
        await page.mouse.up();
        await page.mouse.move(0, 0);

        const anything = pressed.bg !== resting.bg || pressed.shadow !== resting.shadow || pressed.transform !== resting.transform;
        if (!anything) {
            report.push(`${label}: pressing the ${kind} key changes nothing (${resting.bg}) — the press is invisible`);
        } else if (pressed.bg === resting.bg) {
            // The fill is the load-bearing half of the press: the hairline it
            // drops is nearly invisible on a dark ground, and under
            // prefers-reduced-motion the fill is the ONLY feedback left. A key
            // that keeps its colour under the finger is the bug that hid behind
            // "well, something changed" — the shadow and the scale still worked.
            report.push(`${label}: pressing the ${kind} key does not change its fill (${resting.bg}) — a later rule of equal specificity is overwriting the press`);
        }
    }
}

async function serve() {
    const server = await createServer({
        configFile: false,
        root: repo,
        // Same `~icons/...` compilation as the extension build; esbuild covers
        // the automatic JSX runtime, so no React plugin is needed.
        plugins: [Icons({ compiler: 'jsx', jsx: 'react' })],
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@': repo } },
        // strictPort, because Vite otherwise slides to the next free port when
        // something else holds this one — and the configured port we'd then
        // navigate to belongs to that other server, so the audit would quietly
        // measure a stale keyboard.
        server: { port: 5199, strictPort: true },
        logLevel: 'warn',
    });
    await server.listen();
    const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '');
    if (!origin) throw new Error('vite did not report a local URL');
    return { server, origin };
}

async function main() {
    const { server, origin } = await serve();
    if (process.argv.includes('--serve')) {
        console.log(`mock keyboard: ${origin}${PAGE}  (ctrl-c to stop)`);
        return;
    }

    // The keyboard's own geometry function, from source.
    const report0 = [];
    const { geometryFor } = await server.ssrLoadModule('/entrypoints/inputview/placement.ts');
    const { applyMetrics, kMetrics } = await server.ssrLoadModule('/entrypoints/inputview/metrics.ts');
    const publishedVars = [];
    applyMetrics({ style: { setProperty: (name) => publishedVars.push(name) } });

    // Fails fast: a var() with no definition silently deletes its declaration.
    const orphans = undefinedCustomProperties(publishedVars);

    for (const name of orphans) {
        report0.push(`md3.css references ${name}, which nothing defines — every declaration using it is silently dropped`);
    }

    const browser = await chromium.launch();
    const report = report0;
    let renders = 0;
    let keys = 0;

    // Dead-CSS sweep: start with every selector, strike off the ones that match
    // something in any render. What survives, nothing on the keyboard uses.
    const selectors = stylesheetSelectors();
    const unmatched = new Set(selectors);

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
                    metrics: kMetrics,
                });
                found.push(...await page.evaluate(inspectPopovers));

                // Read-only, so it runs while the state is still the one the
                // matrix asked for: the emoji panel open, the menu up, the
                // candidates on screen. Everything below this line PRESSES keys,
                // and a press commits — it closes panels and dismisses popovers.
                if (unmatched.size) {
                    for (const sel of await page.evaluate(matchedSelectors, [...unmatched])) unmatched.delete(sel);
                }

                // Press a key and check the preview it raises — the only part of
                // the keyboard that doesn't exist until a finger is down.
                const press = await page.evaluate(inspectPress);
                found.push(...press.findings);

                for (const f of found) report.push(`${label}: ${f}`);
                found.length = 0;

                // The pressed-state selectors (.kb-key.pressed, .kb-preview) only
                // exist under a finger, so they are swept with one held down.
                if (unmatched.size) {
                    for (const sel of await page.evaluate(matchedWhilePressed, [...unmatched])) unmatched.delete(sel);
                }

                // Last: a real mouse, which activates what it presses.
                await inspectFeedback(page, label, report);

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

    // Dark: a separate palette AND a separate elevation ladder, none of which any
    // render above has ever entered. One pass per placement.
    for (const placement of placements) {
        const label = `dark/${placement.name}`;
        const card = geometryFor(placement.pref, screens[1], 4);
        const context = await browser.newContext({
            screen: { width: screens[1].width, height: screens[1].height },
            viewport: { width: card.width, height: card.height },
            colorScheme: 'dark',
        });
        await context.addInitScript(([k, pref]) => {
            window.localStorage.setItem(k, JSON.stringify(pref));
            window.localStorage.setItem('mui-mode', 'dark');
        }, [kPlacementPrefKey, placement.pref]);
        await context.addInitScript(installInkHelpers);
        const page = await context.newPage();
        await page.goto(`${origin}${PAGE}`);
        await page.waitForSelector('.kb-key');
        if (!(await page.evaluate(() => document.documentElement.classList.contains('dark')))) {
            report.push(`${label}: asked for the dark theme and got the light one`);
        }
        const { findings } = await page.evaluate(inspectKeyboard, {
            rows: 4, card: { width: card.width, height: card.height }, metrics: kMetrics,
        });
        for (const f of findings) report.push(`${label}: ${f}`);
        for (const f of await page.evaluate(inspectPopovers)) report.push(`${label}: ${f}`);
        await inspectFeedback(page, label, report);
        renders++;
        await context.close();
    }

    // Reduced motion is its own rendering of the keyboard, and a defect can live
    // there and nowhere else: the override that drops the pressed scale(.98) was
    // declared BEFORE the rule it had to beat, so it lost on source order and the
    // key still scaled — invisible to every render above, which all run with
    // motion on.
    {
        const context = await browser.newContext({
            screen: { width: 1280, height: 800 },
            viewport: { width: 1280, height: 372 },
            reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto(`${origin}${PAGE}`);
        await page.waitForSelector('.kb-key');
        const still = await page.evaluate(async () => {
            const key = [...document.querySelectorAll('.kb-key:not(.spacer)')].find((k) => k.querySelector('.glyph'));
            const b = key.getBoundingClientRect();
            const opts = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 };
            key.dispatchEvent(new PointerEvent('pointerdown', opts));
            await new Promise((r) => setTimeout(r, 80));
            const t = getComputedStyle(key).transform;
            key.dispatchEvent(new PointerEvent('pointerup', opts));
            return t;
        });
        if (still !== 'none' && still !== 'matrix(1, 0, 0, 1, 0, 0)') {
            report.push(`reduced-motion: a pressed key still transforms (${still}) — the press has motion the user asked not to see`);
        }
        renders++;
        await context.close();
    }

    await browser.close();
    await server.close();

    // Nothing on the keyboard, in any placement or state, matched these.
    for (const sel of unmatched) {
        report.push(`dead CSS: "${sel}" matched nothing in any of the ${renders} renders`);
    }

    console.log(`\n${renders} renders, ${keys} keys checked, `
        + `${selectors.length - unmatched.size}/${selectors.length} selectors live, ${report.length} findings`);
    for (const line of report) console.log(`  ✖ ${line}`);
    process.exit(report.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
