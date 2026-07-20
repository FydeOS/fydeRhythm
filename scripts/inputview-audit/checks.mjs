// The invariants, run inside the page. Playwright serializes these functions
// into the browser one at a time, so they can close over nothing — shared
// helpers are installed separately by installInkHelpers().
//
// Every check here exists because the thing it catches actually shipped: keys
// crammed by a type scale calibrated for a differently-shaped card, hints
// colliding with glyphs on a short key, icons spilling out of a scaled-down
// key, round buttons drawn as ellipses because border-radius: 50% was applied
// to a box that wasn't square, and the tail of a "g" sheared off by an
// overflow: hidden meant for long labels.

export function installInkHelpers() {
  // Ink metrics for text as it is actually PAINTED. Boxes are not enough: a
  // descender paints outside the line box, so it is paint overflow, not layout
  // overflow — scrollHeight doesn't grow and no box comparison can see it.
  // Only the glyph outline can, which is why the sheared "g" got through.
  window.__inkOf = (text, cs) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    // A font shorthand the canvas won't parse silently leaves ctx.font at
    // "10px sans-serif" — every ink check would then pass on a measurement
    // of the wrong size. Refuse to measure rather than lie.
    if (!ctx.font.includes(cs.fontSize)) {
      throw new Error(`canvas rejected the font "${cs.fontSize} ${cs.fontFamily}" (got "${ctx.font}")`);
    }
    const m = ctx.measureText(text);
    return {
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      fontAscent: m.fontBoundingBoxAscent,
      fontDescent: m.fontBoundingBoxDescent,
    };
  };

  // Where the text's ink actually lands, in viewport coordinates. The line box
  // is centred in the element by half-leading, so the baseline — and with it
  // the ink — follows from the font's own ascent/descent.
  window.__inkBox = (el) => {
    const text = el.textContent;
    if (!text) return null;
    const cs = getComputedStyle(el);
    const ink = window.__inkOf(text, cs);
    const r = el.getBoundingClientRect();
    const halfLeading = (r.height - (ink.fontAscent + ink.fontDescent)) / 2;
    const baseline = r.top + halfLeading + ink.fontAscent;
    const centre = r.left + r.width / 2;
    return {
      top: baseline - ink.ascent,
      bottom: baseline + ink.descent,
      // Ink is centred in the box by the flex/text centring above it.
      left: centre - (ink.left + ink.right) / 2,
      right: centre + (ink.left + ink.right) / 2,
    };
  };
}

export function inspectKeyboard(expected) {
  // Smallest key you can reliably hit. Material's target is 48dp; this
  // keyboard's own floors are argued from ~32px, so under that is a defect.
  // (Declared inside: Playwright serializes this function alone, without its
  // module scope.)
  const kMinKeyHeight = 32;

  const findings = [];
  const rect = el => el.getBoundingClientRect();
  const root = document.querySelector('.kb-root');
  if (!root) return { findings: ['no keyboard rendered'], stats: null };

  const card = rect(root);
  const bad = msg => findings.push(msg);
  const keyRects = [];

  // The window IS the card on device. If the keyboard drew itself at a size
  // other than the one it asked the OS for, everything measured below is
  // measured against the wrong keyboard.
  if (Math.abs(card.width - expected.card.width) > 1 || Math.abs(card.height - expected.card.height) > 1) {
    bad(`card is ${card.width.toFixed(0)}x${card.height.toFixed(0)} but the window is ${expected.card.width}x${expected.card.height}`);
  }
  const rows = document.querySelectorAll('.kb-row').length;
  if (rows && expected.rows && rows !== expected.rows) {
    bad(`layout renders ${rows} rows, the matrix says ${expected.rows} — the card was sized for the wrong row count`);
  }

  // What CSS actually spent the card's height on, against what metrics.ts
  // reserved. This is the half of the contract nothing else can see: if CSS
  // spends MORE than TS budgeted, the keys get crushed (and the key-height
  // check catches it) — but if it spends LESS, the keys just get bigger and
  // everything passes, while the OS drag region (sized from the same numbers)
  // now overhangs the candidate bar and eats taps on the first candidates.
  const m = expected.metrics;
  const one = root.classList.contains('onehand');
  const px = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? parseFloat(getComputedStyle(el)[prop]) : null;
  };
  const agrees = (got, want, what) => {
    if (got !== null && Math.abs(got - want) > 0.5) {
      bad(`${what} renders at ${got}px, metrics.ts says ${want}px — the card and the window it lives in disagree`);
    }
  };
  agrees(px('.kb-root', 'paddingBottom'), one ? m.onehand.edge : m.edge, 'the board edge');
  agrees(px('.kb-cell', 'paddingTop'), one ? m.onehand.cellPad : m.cellPad, 'the cell padding');
  agrees(document.querySelector('.kb-handle') && rect(document.querySelector('.kb-handle')).height, m.handleHeight, 'the drag handle');
  agrees(document.querySelector('.kb-onehand-bar') && rect(document.querySelector('.kb-onehand-bar')).height, m.onehand.controlBar, 'the one-hand control bar');
  agrees(document.querySelector('.kb-resize-grip') && rect(document.querySelector('.kb-resize-grip')).width, m.resizeWidth, 'the resize button');

  const barEl = document.querySelector('.kb-bar');
  if (barEl) {
    const bar = rect(barEl).height;
    const want = one ? m.onehand.bar : null;
    if (want !== null) agrees(bar, want, 'the candidate bar');
    else if (bar < m.barMin - 0.5 || bar > m.barMax + 0.5) {
      bad(`the candidate bar is ${bar.toFixed(1)}px, outside the [${m.barMin}, ${m.barMax}] metrics.ts reserves`);
    }
    // The drag strip is carved out of the window by the OS from the same
    // numbers; if the rendered strip is shorter, the region overhangs the bar.
    const handle = document.querySelector('.kb-handle');
    if (handle && rect(handle).bottom > rect(barEl).top + 0.5) {
      bad('the drag strip overlaps the candidate bar — the OS drag region will swallow taps on the first candidates');
    }
  }

  if (root.scrollWidth > root.clientWidth + 1) bad('card scrolls horizontally');
  if (root.scrollHeight > root.clientHeight + 1) bad('card scrolls vertically');

  let minW = Infinity;
  let minH = Infinity;
  let keys = 0;
  let smallKeys = 0;

  for (const key of document.querySelectorAll('.kb-key')) {
    if (key.classList.contains('spacer')) continue;
    keys++;
    const k = rect(key);
    keyRects.push(k);
    const name = key.getAttribute('aria-label') || key.textContent.trim();
    minW = Math.min(minW, k.width);
    minH = Math.min(minH, k.height);
    // A held key is mid-press (scale .98), so its rect is feedback, not
    // the target — the finger aimed at the resting key. States that keep
    // a pointer down (flick preview, alt bubble) must not trip the floor.
    if (k.height < kMinKeyHeight && !key.classList.contains('pressed')) smallKeys++;

    if (k.left < card.left - 1 || k.right > card.right + 1 || k.top < card.top - 1 || k.bottom > card.bottom + 1) {
      bad(`key "${name}" escapes the card`);
    }

    const glyph = key.querySelector('.glyph');
    if (glyph && glyph.textContent) {
      if (glyph.scrollWidth > glyph.clientWidth + 1) {
        bad(`key "${name}" glyph is clipped (${glyph.scrollWidth} > ${glyph.clientWidth})`);
      }
      // A label far too small for its key is what a container-query unit
      // looks like when it loses its container: the clamp collapses onto
      // its floor and the text is legible only in the abstract. The space
      // key's schema name sat at 8px on a 73px key that way.
      const size = parseFloat(getComputedStyle(key).fontSize);
      if (size < k.height * 0.18) {
        bad(`key "${name}" label is ${size.toFixed(0)}px on a ${k.height.toFixed(0)}px key — too small for it (a clamp on its floor?)`);
      }
      // Ink against the KEY, on both axes. The glyph's own box is useless
      // here: it is a flex item with max-width:100%, so it is always inside
      // the key no matter how far the text spills out of it. This is the
      // check that sees both a sheared descender and a type scale too big
      // for its key.
      const ink = window.__inkBox(glyph);
      if (ink) {
        if (ink.bottom > k.bottom + 0.5) bad(`key "${name}" glyph ink is cut off at the bottom (${(ink.bottom - k.bottom).toFixed(1)}px past the key)`);
        if (ink.top < k.top - 0.5) bad(`key "${name}" glyph ink is cut off at the top (${(k.top - ink.top).toFixed(1)}px past the key)`);
        if (ink.right > k.right + 0.5 || ink.left < k.left - 0.5) bad(`key "${name}" glyph ink spills out the side of the key`);
      }
      // The clip that shears descenders, wherever it is applied.
      const cs = getComputedStyle(glyph);
      if (cs.overflow !== 'visible') {
        const g = rect(glyph);
        const gi = window.__inkBox(glyph);
        if (gi && gi.bottom > g.bottom + 0.5) bad(`key "${name}" glyph descender is sheared by its own clip (${(gi.bottom - g.bottom).toFixed(1)}px)`);
      }
    }

    // Icon keys (backspace/enter/shift/hide) scale with the card; at small
    // sizes the icon's clamp floor can outgrow the key it sits in.
    const svg = key.querySelector('svg');
    if (svg) {
      const s = rect(svg);
      if (s.width > k.width - 2 || s.height > k.height - 2) {
        bad(`key "${name}" icon overflows the key (${s.height.toFixed(0)}px icon in a ${k.height.toFixed(0)}px key)`);
      }
    }

    const hint = key.querySelector('.hint');
    // A hint that isn't rendered at all is a choice, not a defect — the
    // one-hand board hides them (no room on a 31px key, and long-press still
    // reaches the alternates). Its rect is 0x0 at the origin, which would
    // otherwise read as "escapes the key".
    if (hint && hint.textContent && rect(hint).width > 0) {
      const h = rect(hint);
      if (h.right > k.right - 1 || h.top < k.top - 1 || h.left < k.left) {
        bad(`key "${name}" hint escapes the key`);
      }
      if (glyph) {
        const g = rect(glyph);
        const clear = h.right <= g.left || h.left >= g.right || h.bottom <= g.top || h.top >= g.bottom;
        if (!clear) bad(`key "${name}" hint overlaps its glyph`);
      }
    }
  }

  if (smallKeys) {
    bad(`${smallKeys}/${keys} keys are under ${kMinKeyHeight}px tall (smallest ${minH.toFixed(0)}px) — too small to hit`);
  }

  for (const row of document.querySelectorAll('.kb-row')) {
    if (row.scrollWidth > row.clientWidth + 1) bad('a key row overflows its width');
  }

  // A percentage border-radius only draws a circle on a square box — on any
  // other box it renders as an ellipse, which is what the hover/press fill
  // then looks like.
  for (const btn of document.querySelectorAll('.icon-btn, .kb-emoji-tabs .tab')) {
    if (!getComputedStyle(btn).borderRadius.includes('%')) continue;
    const b = rect(btn);
    if (!b.width || !b.height) continue;
    const ratio = b.width / b.height;
    if (Math.abs(ratio - 1) > 0.04) {
      const name = btn.getAttribute('aria-label') || btn.className;
      bad(`round button "${name}" is ${b.width.toFixed(0)}x${b.height.toFixed(0)} — its hover fill is an ellipse`);
    }
  }

  // The keyboard's own chrome must sit BESIDE the keys, never on top of them:
  // anything floating over a key covers it and can never look aligned.
  for (const sel of ['.kb-resize-grip', '.kb-handle', '.kb-onehand-bar']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const c = rect(el);
    for (const k of keyRects) {
      const clear = c.right <= k.left || c.left >= k.right || c.bottom <= k.top || c.top >= k.bottom;
      if (!clear) { bad(`${sel} overlaps a key`); break; }
    }
  }

  // Popovers and panels live in the same OS window as the keys, so anything
  // past the window edge is cut off by the window — that is how a 426px alt
  // bubble ended up inside a 420px one-hand keyboard.
  //
  // Only elements that are NOT inside a scroller: a candidate chip or an emoji
  // cell scrolled out of view is doing its job, and flagging those would drown
  // the real findings.
  const scrolled = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflow;
      if (o.includes('auto') || o.includes('scroll')) return true;
    }
    return false;
  };
  const floats = '.kb-bubble, .kb-menu, .kb-confirm, .kb-preview, .kb-expanded, .kb-emoji-grid, .kb-emoji-bottom, .kb-candidates';
  for (const el of document.querySelectorAll(floats)) {
    const r = rect(el);
    if (!r.width || !r.height || scrolled(el)) continue;
    if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) {
      const name = el.className.split(' ')[0];
      bad(`"${name}" (${r.width.toFixed(0)}x${r.height.toFixed(0)}) is cut off by the keyboard window (${window.innerWidth}x${window.innerHeight})`);
    }
  }

  return {
    findings,
    stats: {
      card: `${card.width.toFixed(0)}x${card.height.toFixed(0)}`,
      keys,
      minKey: keys ? `${minW.toFixed(0)}x${minH.toFixed(0)}` : '-',
    },
  };
}

// Hold a key down and inspect the press preview. The preview has to be visibly
// BIGGER than the key it covers — a key-sized one looks like the key itself, so
// it reads as a glitch rather than as "this is the letter you're typing" — and
// its glyph needs clearance from its own rounded border.
export async function inspectPress() {
  const findings = [];
  const rect = el => el.getBoundingClientRect();
  // A letter with a descender if the layout has one: those are the keys whose
  // glyph gets sheared by a clip. Match on the GLYPH, not the key's
  // textContent — that also contains the hint ("g&", "q1").
  const keys = [...document.querySelectorAll('.kb-key:not(.spacer)')].filter(k => k.querySelector('.glyph'));
  const key = keys.find(k => /^[gjpqy]$/.test(k.querySelector('.glyph').textContent)) ?? keys[0];
  if (!key) return { findings, previewed: null };

  const label = key.querySelector('.glyph').textContent;
  const k = rect(key);
  const opts = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: k.left + k.width / 2, clientY: k.top + k.height / 2 };
  key.dispatchEvent(new PointerEvent('pointerdown', opts));
  await new Promise(r => setTimeout(r, 80));

  const preview = document.querySelector('.kb-preview');
  if (!preview) {
    key.dispatchEvent(new PointerEvent('pointerup', opts));
    // Only normal keys preview; a function/space key legitimately doesn't.
    const normal = !key.classList.contains('fn') && !key.classList.contains('space') && !key.classList.contains('enter');
    if (normal) findings.push(`pressing "${label}" raised no preview`);
    return { findings, previewed: null };
  }

  const p = rect(preview);

  // The preview's job is to show the letter your finger is covering. It is
  // NOT a fixed multiple of the key — a finger is one size and a key is not,
  // so the glyph grows to a legible size and stops. What must always hold is
  // that it never prints the letter SMALLER than the key already does: the
  // magnification is capped in absolute px, and the docked board grows to
  // 440px on a tall screen, taking its own glyphs past that cap.
  const keyGlyph = parseFloat(getComputedStyle(key).fontSize);
  const previewGlyph = parseFloat(getComputedStyle(preview).fontSize);
  if (previewGlyph < keyGlyph - 0.5) {
    findings.push(`press preview prints "${label}" at ${previewGlyph.toFixed(0)}px — SMALLER than the ${keyGlyph.toFixed(0)}px on the key it is magnifying`);
  }
  // And it has to read as a thing over the key, not as the key twitching.
  if (p.width < k.width * 1.05) {
    findings.push(`press preview (${p.width.toFixed(0)}px wide) is no wider than the key (${k.width.toFixed(0)}px) — it reads as the key, not a preview`);
  }
  if (p.left < -0.5 || p.top < -0.5 || p.right > window.innerWidth + 0.5 || p.bottom > window.innerHeight + 0.5) {
    findings.push('press preview is cut off by the keyboard window');
  }

  // Clearance between the glyph's ink and the preview's border.
  const ink = window.__inkBox(preview);
  if (ink) {
    const gapTop = ink.top - p.top;
    const gapBottom = p.bottom - ink.bottom;
    const gapLeft = ink.left - p.left;
    const gapRight = p.right - ink.right;
    const gapY = Math.min(gapTop, gapBottom);
    const gapX = Math.min(gapLeft, gapRight);
    if (gapY < 2) findings.push(`press preview glyph is ${gapY.toFixed(1)}px from the top/bottom border`);
    if (gapX < 4) findings.push(`press preview glyph is ${gapX.toFixed(1)}px from the left/right border`);
  }

  key.dispatchEvent(new PointerEvent('pointerup', opts));
  await new Promise(r => setTimeout(r, 30));

  return {
    findings,
    previewed: `${label}: ${k.width.toFixed(0)}x${k.height.toFixed(0)} → ${p.width.toFixed(0)}x${p.height.toFixed(0)}`,
  };
}

// An elevated surface floats over a board the same colour as itself
// (--kb-popup === --kb-surface in both themes), so its shadow is the ONLY thing
// separating it. A popover with no shadow is a slab of nothing.
export function inspectPopovers() {
  const findings = [];
  for (const sel of ['.kb-menu', '.kb-confirm', '.kb-bubble', '.kb-preview']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.boxShadow === 'none') {
      findings.push(`"${sel}" has no shadow — it floats over keys of its own colour with nothing to separate it (a var() pointing at a token nobody defines?)`);
    }
  }
  return findings;
}

// Which of the stylesheet's selectors match anything on THIS render. Unioned
// across the whole sweep, the ones that never matched are dead — a rule kept
// alive by nothing, or a state the matrix never reaches. Either is worth knowing:
// the last sweep of this codebase found a `.kb-candidate.pressed` rule for a
// class the component stopped setting, and nobody had noticed.
export function matchedSelectors(selectors) {
  const hit = [];
  for (const sel of selectors) {
    try {
      if (document.querySelector(sel)) hit.push(sel);
    }
    catch {
      // An unparseable selector is the audit's bug, not the keyboard's.
      hit.push(sel);
    }
  }
  return hit;
}

// The same sweep, with a finger held down: .kb-key.pressed and .kb-preview do
// not exist at rest, and would otherwise look dead. Each KIND of key is pressed
// in turn — a letter, enter, a function key — because the pressed styles differ
// per kind (.kb-key.enter.pressed keeps the accent), and a sweep that only ever
// pressed a letter would report the others as dead CSS.
export async function matchedWhilePressed(selectors) {
  const hit = new Set();
  const keys = [...document.querySelectorAll('.kb-key:not(.spacer)')];
  const kinds = [
    keys.find(k => k.querySelector('.glyph') && !k.classList.contains('fn') && !k.classList.contains('enter')),
    keys.find(k => k.classList.contains('enter')),
    keys.find(k => k.classList.contains('fn')),
  ];

  for (const key of kinds) {
    if (!key) continue;
    const r = key.getBoundingClientRect();
    const opts = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    key.dispatchEvent(new PointerEvent('pointerdown', opts));
    await new Promise(res => setTimeout(res, 60));
    // Inlined rather than calling matchedSelectors: Playwright serializes
    // this function alone, without its module scope.
    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) hit.add(sel);
      }
      catch { hit.add(sel); }
    }
    key.dispatchEvent(new PointerEvent('pointerup', opts));
    await new Promise(res => setTimeout(res, 20));
  }
  return [...hit];
}

// Drive the keyboard into a state that only exists at runtime (a layer, a
// long-press popover, the emoji panel).
//   glyph   — match a key by its glyph (the key's textContent includes the hint)
//   sel     — any selector
//   hold    — ms to hold the pointer down, for long-press surfaces
//   move    — [dx, dy] pointer travel before release (flick / caret drag)
//   release — false leaves the pointer down so the popover stays up
//   expectComposition — the mock composition the step must leave behind; this
//     is the behavioral check for gesture → strokes → engine-model contracts
//     (flick petals, 小゛゜'s backspace-and-respell).
export async function applyStep(step) {
  const targets = [...document.querySelectorAll(step.sel ?? '.kb-key')];
  const el = step.glyph
    ? targets.find(e => (e.querySelector('.glyph')?.textContent ?? e.textContent.trim()) === step.glyph)
    : targets[0];
  if (!el) return `step target not found (${step.sel ?? step.glyph})`;

  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  if (step.hold) await new Promise(res => setTimeout(res, step.hold));
  if (step.move) {
    el.dispatchEvent(new PointerEvent('pointermove', {
      ...opts,
      clientX: opts.clientX + step.move[0],
      clientY: opts.clientY + step.move[1],
    }));
  }
  if (step.release !== false) {
    const at = step.move
      ? { ...opts, clientX: opts.clientX + step.move[0], clientY: opts.clientY + step.move[1] }
      : opts;
    el.dispatchEvent(new PointerEvent('pointerup', at));
    // Some controls (the candidate bar's buttons) are click-driven, and an
    // untrusted PointerEvent does NOT synthesize a click — without this the
    // step would tap the right element and do nothing at all.
    el.click();
  }
  if (step.expectComposition !== undefined) {
    const got = window.__mockComposition ?? '';
    if (got !== step.expectComposition) {
      return `composition is "${got}" after the step, expected "${step.expectComposition}"`;
    }
  }
  return null;
}
