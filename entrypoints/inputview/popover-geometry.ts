const kViewportMargin = 4;

export function fitMenuToViewport(
  anchor: Pick<DOMRect, 'top' | 'bottom'>,
  contentHeight: number,
  viewportHeight: number,
): { top: number; maxHeight: number } {
  const maxHeight = Math.max(0, viewportHeight - kViewportMargin * 2);
  const height = Math.min(contentHeight, maxHeight);
  const above = anchor.top - height - 8;
  const top = above >= kViewportMargin
    ? above
    : Math.max(
        kViewportMargin,
        Math.min(anchor.bottom + 8, viewportHeight - height - kViewportMargin),
      );
  return { top, maxHeight };
}
