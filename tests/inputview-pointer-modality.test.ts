// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { installPointerModality, kMousePointerClass } from '../entrypoints/inputview/pointer-modality';

function press(target: EventTarget, pointerType: string, type = 'pointerdown') {
  const e = new Event(type, { bubbles: true }) as Event & { pointerType: string };
  e.pointerType = pointerType;
  target.dispatchEvent(e);
}

describe('pointer modality', () => {
  it('paints hover for a mouse and drops it the moment a finger takes over', () => {
    const root = document.createElement('div');
    const stop = installPointerModality(window, root);

    press(window, 'mouse');
    expect(root.classList.contains(kMousePointerClass)).toBe(true);

    press(window, 'touch');
    expect(root.classList.contains(kMousePointerClass)).toBe(false);

    // A mouse that only moves — never clicks — still restores the affordance.
    press(window, 'mouse', 'pointermove');
    expect(root.classList.contains(kMousePointerClass)).toBe(true);

    press(window, 'pen');
    expect(root.classList.contains(kMousePointerClass)).toBe(false);

    stop();
    press(window, 'mouse');
    expect(root.classList.contains(kMousePointerClass)).toBe(false);
  });
});
