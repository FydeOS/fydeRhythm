export const kMousePointerClass = 'kb-pointer-mouse';

export function applyPointerModality(
  pointerType: string,
  root: HTMLElement = document.body,
): void {
  root.classList.toggle(kMousePointerClass, pointerType === 'mouse');
}

// CSS media queries describe available devices, so `hover: hover` remains true
// while a finger is touching a hybrid device with an external touchpad. Track
// the actual pointer instead; touch/pen immediately disables sticky :hover,
// and the next real mouse move restores mouse hover feedback.
export function installPointerModality(
  target: Window = window,
  root: HTMLElement = document.body,
): () => void {
  const update = (event: PointerEvent) => applyPointerModality(event.pointerType, root);
  target.addEventListener('pointerdown', update, true);
  target.addEventListener('pointermove', update, true);
  return () => {
    target.removeEventListener('pointerdown', update, true);
    target.removeEventListener('pointermove', update, true);
    root.classList.remove(kMousePointerClass);
  };
}
